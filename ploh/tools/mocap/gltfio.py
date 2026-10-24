"""Minimal GLB reader/writer for swapping skeletal animations without touching mesh/skin/material data."""
import json, struct
import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}


def read_glb(path):
    b = open(path, "rb").read()
    assert b[:4] == b"glTF"
    off = 12
    j = binc = None
    while off < len(b):
        ln, typ = struct.unpack("<II", b[off:off + 8])
        chunk = b[off + 8: off + 8 + ln]
        if typ == 0x4E4F534A:
            j = json.loads(chunk)
        elif typ == 0x004E4942:
            binc = chunk
        off += 8 + ln
    return j, binc


def acc(j, binc, i):
    a = j["accessors"][i]
    bv = j["bufferViews"][a["bufferView"]]
    dt = np.dtype(CT[a["componentType"]])
    n = NC[a["type"]]
    start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride", 0)
    if stride and stride != n * dt.itemsize:
        raw = np.frombuffer(binc, np.uint8, count=stride * a["count"], offset=start).reshape(a["count"], stride)
        arr = raw[:, :n * dt.itemsize].copy().view(dt).reshape(a["count"], n)
    else:
        arr = np.frombuffer(binc, dt, count=a["count"] * n, offset=start).reshape(a["count"], n)
    arr = arr.astype(np.float64)
    if a.get("normalized"):
        if dt == np.int8: arr = np.maximum(arr / 127.0, -1)
        elif dt == np.uint8: arr = arr / 255.0
        elif dt == np.int16: arr = np.maximum(arr / 32767.0, -1)
        elif dt == np.uint16: arr = arr / 65535.0
    return arr


def node_names(j):
    return [n.get("name", f"node{i}") for i, n in enumerate(j["nodes"])]


def joint_rest(j):
    """name -> (T, R(xyzw), S) for every node."""
    out = {}
    for n in j["nodes"]:
        out[n.get("name")] = (np.array(n.get("translation", [0, 0, 0]), float),
                              np.array(n.get("rotation", [0, 0, 0, 1]), float),
                              np.array(n.get("scale", [1, 1, 1]), float))
    return out


def qnorm(q):
    return q / np.linalg.norm(q, axis=-1, keepdims=True)


def slerp(a, b, t):
    a = qnorm(a); b = qnorm(b)
    d = np.sum(a * b, -1, keepdims=True)
    b = np.where(d < 0, -b, b); d = np.abs(d)
    t = np.asarray(t, float).reshape(-1, 1) if np.ndim(t) else np.full((len(a), 1), t)
    lin = d > 0.9995
    th = np.arccos(np.clip(d, -1, 1)); s = np.sin(th)
    s = np.where(s < 1e-9, 1, s)
    wa = np.where(lin, 1 - t, np.sin((1 - t) * th) / s)
    wb = np.where(lin, t, np.sin(t * th) / s)
    return qnorm(wa * a + wb * b)


def sample(times, vals, interp, tq, rot=False):
    """sample a glTF channel at times tq."""
    times = times.reshape(-1)
    if interp == "CUBICSPLINE":
        vals = vals.reshape(len(times), 3, -1)[:, 1]
    if len(times) == 1:
        return np.repeat(vals[:1], len(tq), 0)
    idx = np.clip(np.searchsorted(times, tq, side="right") - 1, 0, len(times) - 2)
    t0, t1 = times[idx], times[idx + 1]
    u = np.clip((tq - t0) / np.maximum(t1 - t0, 1e-9), 0, 1)
    if interp == "STEP":
        u = np.where(tq >= t1, 1.0, 0.0)
    a, b = vals[idx], vals[idx + 1]
    if rot:
        return slerp(a, b, u)
    return a + (b - a) * u[:, None]


def read_clips(path, fps=30):
    """Return (json, {clip: {"n": frames, "bones": {name: {"T":(n,3),"R":(n,4),"S":(n,3)}}}}) resampled at fps.
    Channels missing for a bone are filled from its rest TRS."""
    j, binc = read_glb(path)
    names = node_names(j)
    rest = joint_rest(j)
    skin_joints = [names[i] for i in j["skins"][0]["joints"]]
    clips = {}
    for a in j.get("animations", []):
        tmax = 0.0
        for ch in a["channels"]:
            s = a["samplers"][ch["sampler"]]
            tmax = max(tmax, j["accessors"][s["input"]]["max"][0])
        tmin = min(j["accessors"][a["samplers"][ch["sampler"]]["input"]]["min"][0] for ch in a["channels"])
        n = int(round((tmax - tmin) * fps)) + 1
        tq = tmin + np.arange(n) / fps
        bones = {b: {"T": np.repeat(rest[b][0][None], n, 0), "R": np.repeat(rest[b][1][None], n, 0),
                     "S": np.repeat(rest[b][2][None], n, 0)} for b in skin_joints}
        for ch in a["channels"]:
            nm = names[ch["target"]["node"]]
            if nm not in bones:
                continue
            s = a["samplers"][ch["sampler"]]
            t = acc(j, binc, s["input"]); v = acc(j, binc, s["output"])
            path_ = ch["target"]["path"]
            key = {"translation": "T", "rotation": "R", "scale": "S"}.get(path_)
            if key:
                bones[nm][key] = sample(t, v, s.get("interpolation", "LINEAR"), tq, rot=(key == "R"))
        clips[a["name"]] = {"n": n, "bones": bones}
    return j, clips


def _pad4(b):
    return b + b"\x00" * ((4 - len(b) % 4) % 4)


def body_from(glb_path, base_j):
    """read the single skinned mesh primitive of glb_path (e.g. a decimated export) with JOINTS_0 remapped
    to base_j's skin joint order by node name. returns dict attr -> array, plus 'indices'."""
    j, binc = read_glb(glb_path)
    names = node_names(j)
    mesh_i = next(n["mesh"] for n in j["nodes"] if "mesh" in n and "skin" in n)
    pr = j["meshes"][mesh_i]["primitives"]
    assert len(pr) == 1
    pr = pr[0]
    out = {k: acc(j, binc, v) for k, v in pr["attributes"].items()}
    out["indices"] = acc(j, binc, pr["indices"]).reshape(-1).astype(np.uint32)
    src_joints = [names[i] for i in j["skins"][0]["joints"]]
    bnames = node_names(base_j)
    dst = {bnames[i]: k for k, i in enumerate(base_j["skins"][0]["joints"])}
    remap = np.array([dst[n] for n in src_joints])
    out["JOINTS_0"] = remap[out["JOINTS_0"].astype(int)]
    out["ibm"] = acc(j, binc, j["skins"][0]["inverseBindMatrices"]).reshape(-1, 4, 4)
    out["ibm_joints"] = src_joints
    # a re-textured body (rebake_body.py) carries its own base colour image: write_glb swaps it in for the body material's
    tex = (j.get("materials") or [{}])[pr["material"]].get("pbrMetallicRoughness", {}).get("baseColorTexture") \
        if "material" in pr else None
    if tex is not None:
        im = j["images"][j["textures"][tex["index"]]["source"]]
        bv = j["bufferViews"][im["bufferView"]]
        out["image"] = {"bytes": bytes(binc[bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]]),
                        "mimeType": im.get("mimeType", "image/jpeg")}
    return out


def write_glb(base_path, out_path, clips, fps=30, order=None, body=None, node_override=None):
    """Copy base GLB, drop its animations (and their buffer data), add clips. clips: name -> {"bones": {bone: {T,R,S}}}
    body: optional dict from body_from() that replaces the skinned body primitive's geometry (material kept)."""
    j, binc = read_glb(base_path)
    j = json.loads(json.dumps(j))
    for n in j["nodes"]:
        n.update((node_override or {}).get(n.get("name"), {}))
    names = node_names(j)
    nid = {n: i for i, n in enumerate(names)}
    # accessors used by animations only
    anim_acc = set()
    for a in j.get("animations", []):
        for s in a["samplers"]:
            anim_acc.add(s["input"]); anim_acc.add(s["output"])
    used_acc = set()
    body_mesh = next(n["mesh"] for n in j["nodes"] if "mesh" in n and "skin" in n) if body is not None else None
    for mi, m in enumerate(j.get("meshes", [])):
        if mi == body_mesh:
            continue
        for p in m["primitives"]:
            used_acc.update(p["attributes"].values())
            if "indices" in p: used_acc.add(p["indices"])
            for tg in p.get("targets", []):
                used_acc.update(tg.values())
    for s in j.get("skins", []):
        if "inverseBindMatrices" in s: used_acc.add(s["inverseBindMatrices"])
    rep_img = None
    if body is not None and body.get("image"):
        # the body's base colour image is replaced (re-textured body). The image keeps its name (Godot extracts it to the
        # same file); if another material uses the same texture/image, a new image + texture is added for the body instead
        pr0 = j["meshes"][body_mesh]["primitives"][0]
        bmat = j["materials"][pr0["material"]]
        bct = bmat["pbrMetallicRoughness"]["baseColorTexture"]
        img_i = j["textures"][bct["index"]]["source"]
        users = []
        for mi, m in enumerate(j["materials"]):
            t_ = m.get("pbrMetallicRoughness", {}).get("baseColorTexture")
            if mi != pr0["material"] and t_ is not None and j["textures"][t_["index"]]["source"] == img_i:
                users.append(mi)
        if users:
            j["images"].append({"name": j["images"][img_i].get("name", "body") + "_baked"})
            j["textures"].append(dict(j["textures"][bct["index"]], source=len(j["images"]) - 1))
            bct["index"] = len(j["textures"]) - 1
            rep_img = len(j["images"]) - 1
        else:
            rep_img = img_i
            j["images"][img_i].pop("bufferView", None)      # old atlas bytes are dropped from the buffer
        bct.pop("texCoord", None)
    keep_acc = sorted(used_acc)
    used_bv = set(j["accessors"][i]["bufferView"] for i in keep_acc if "bufferView" in j["accessors"][i])
    for im in j.get("images", []):
        if "bufferView" in im: used_bv.add(im["bufferView"])
    keep_bv = sorted(used_bv)
    # rebuild buffer
    out = bytearray(); bv_map = {}; new_bv = []
    for i in keep_bv:
        bv = dict(j["bufferViews"][i])
        data = binc[bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]]
        while len(out) % 4: out.append(0)
        bv["byteOffset"] = len(out); bv["buffer"] = 0
        out += data
        bv_map[i] = len(new_bv); new_bv.append(bv)
    acc_map = {}; new_acc = []
    for i in keep_acc:
        a = dict(j["accessors"][i])
        if "bufferView" in a: a["bufferView"] = bv_map[a["bufferView"]]
        acc_map[i] = len(new_acc); new_acc.append(a)
    for mi, m in enumerate(j.get("meshes", [])):
        if mi == body_mesh:
            continue
        for p in m["primitives"]:
            p["attributes"] = {k: acc_map[v] for k, v in p["attributes"].items()}
            if "indices" in p: p["indices"] = acc_map[p["indices"]]
            if "targets" in p: p["targets"] = [{k: acc_map[v] for k, v in tg.items()} for tg in p["targets"]]
    for s in j.get("skins", []):
        if "inverseBindMatrices" in s: s["inverseBindMatrices"] = acc_map[s["inverseBindMatrices"]]
    for im in j.get("images", []):
        if "bufferView" in im: im["bufferView"] = bv_map[im["bufferView"]]

    def add(arr, typ):
        arr = np.ascontiguousarray(arr, np.float32)
        while len(out) % 4: out.append(0)
        bv = {"buffer": 0, "byteOffset": len(out), "byteLength": arr.nbytes}
        out.extend(arr.tobytes())
        new_bv.append(bv)
        a = {"bufferView": len(new_bv) - 1, "componentType": 5126, "count": int(arr.shape[0]), "type": typ}
        if typ == "SCALAR":
            a["min"] = [float(arr.min())]; a["max"] = [float(arr.max())]
        new_acc.append(a)
        return len(new_acc) - 1

    if body is not None:
        mesh_i = next(n["mesh"] for n in j["nodes"] if "mesh" in n and "skin" in n)
        pr = j["meshes"][mesh_i]["primitives"][0]
        def add_typed(arr, typ, ct, normalized=False, minmax=False):
            dt = CT[ct]
            arr = np.ascontiguousarray(arr, dt)
            while len(out) % 4: out.append(0)
            bv = {"buffer": 0, "byteOffset": len(out), "byteLength": arr.nbytes}
            if typ != "SCALAR":
                bv["target"] = 34962
            else:
                bv["target"] = 34963
            out.extend(arr.tobytes()); new_bv.append(bv)
            a = {"bufferView": len(new_bv) - 1, "componentType": ct, "count": int(arr.shape[0]), "type": typ}
            if normalized: a["normalized"] = True
            if minmax:
                a["min"] = [float(x) for x in arr.min(0)]; a["max"] = [float(x) for x in arr.max(0)]
            new_acc.append(a); return len(new_acc) - 1
        attrs = {}
        attrs["POSITION"] = add_typed(body["POSITION"], "VEC3", 5126, minmax=True)
        attrs["NORMAL"] = add_typed(body["NORMAL"], "VEC3", 5126)
        attrs["TEXCOORD_0"] = add_typed(body["TEXCOORD_0"], "VEC2", 5126)
        attrs["JOINTS_0"] = add_typed(body["JOINTS_0"], "VEC4", 5123)
        w = body["WEIGHTS_0"]; w = w / np.maximum(w.sum(1, keepdims=True), 1e-9)
        attrs["WEIGHTS_0"] = add_typed(w, "VEC4", 5126)
        pr["attributes"] = attrs
        idx = body["indices"]
        pr["indices"] = add_typed(idx.reshape(-1, 1), "SCALAR", 5125 if idx.max() > 65535 else 5123)
        for a in ("targets",):
            pr.pop(a, None)
        if rep_img is not None:
            data = body["image"]["bytes"]
            while len(out) % 4: out.append(0)
            new_bv.append({"buffer": 0, "byteOffset": len(out), "byteLength": len(data)})
            out.extend(data)
            j["images"][rep_img]["bufferView"] = len(new_bv) - 1
            j["images"][rep_img]["mimeType"] = body["image"]["mimeType"]
            j["images"][rep_img].pop("uri", None)

    anims = []
    for cname in (order or sorted(clips)):
        c = clips[cname]
        n = next(iter(c["bones"].values()))["R"].shape[0]
        t_acc = add(np.arange(n, dtype=np.float32).reshape(-1, 1) / fps, "SCALAR")
        samplers, channels = [], []
        for b in sorted(c["bones"], key=lambda x: nid[x]):
            for key, path_, typ in (("T", "translation", "VEC3"), ("R", "rotation", "VEC4"), ("S", "scale", "VEC3")):
                v = c["bones"][b][key]
                if key == "R":
                    v = qnorm(v)
                samplers.append({"input": t_acc, "output": add(v, typ), "interpolation": "LINEAR"})
                channels.append({"sampler": len(samplers) - 1, "target": {"node": nid[b], "path": path_}})
        anims.append({"name": cname, "samplers": samplers, "channels": channels})
    j["animations"] = anims
    j["accessors"] = new_acc; j["bufferViews"] = new_bv
    j["buffers"] = [{"byteLength": len(out)}]
    js = _pad4(json.dumps(j, separators=(",", ":")).encode())
    js = js + b" " * 0  # already padded with zeros; glTF wants spaces
    js = js.rstrip(b"\x00"); js = js + b" " * ((4 - len(js) % 4) % 4)
    binb = _pad4(bytes(out))
    total = 12 + 8 + len(js) + 8 + len(binb)
    with open(out_path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack("<II", len(binb), 0x004E4942)); f.write(binb)
    return out_path
