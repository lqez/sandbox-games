# 파티 영웅(프람·슈나이더) 최종 GLB를 만든다(헤드리스 Blender 5). 병사용 ploh/tools/blender/soldier_build.py와
# 프라우용 astrid_author_sword.py의 흐름(정리 → 주먹 → 무기 → 키포즈+2본 IK 베이크)을 따르되 다음을 더했다.
#  - 스킨 가중치 보정(Meshy 자동 리깅 오류): (d) 허리·허벅지 정점에 붙은 팔 가중치 제거, (e) 허벅지에 묶인 손가락 끝을 손으로,
#    (a) 프람의 망토·긴 머리, (b) 슈나이더 꼬리를 척추 사슬·골반으로, (c) 등·가슴 가운데로 샌 팔 가중치 제거,
#    (f) 턱 아래 목도리·옷깃의 머리 가중치를 neck으로. 바꾼 영역은 위치 기준으로 한 번 더 고르게 한다
#  - 프람 망토 텍스처: Meshy가 빨갛게 칠한 망토 바깥면을 3면도대로 흰색으로 되돌린다(raw/fram_basecolor.png)
#  - 주먹: 손가락 정점을 손바닥 쪽으로 말아 손잡이를 쥔 모양으로 만든다(메시 자체 수정, 양손)
#  - 채널별 키(골반·가슴·머리·발·팔·무기)와 구간별 가감속(in/out/io), 골반이 앞서고 무기가 뒤따르는 시차(overlapping action)
#  - 손 위치는 어깨 기준 구면 좌표로, 무기 방향은 방위각·고도로 보간해 호를 그리며 휘두른다
#  - 양손 무기(슈나이더 메이스)는 오른손 자식으로 두고, 두 주먹을 매 프레임 자루 위에 IK로 붙인다.
#    팔이 닿지 않으면 손잡이 중심을 가슴 앞쪽으로 당긴다(clips_schneider.py의 gc)
#  - 방패(프람)는 왼손 자식. 방패 앞면과 위쪽 방향을 키로 준다
#  - 동작 키는 clips_<hero>.py에 있다. 마지막에 칼끝(게임 weapon.gd와 같은 정의) 속도로 타격 프레임을 재서 INFO에 남긴다
# 사용: /Applications/Blender.app/Contents/MacOS/Blender -b --python hero_build.py -- <fram|schneider> <out.glb> [클립,...]
import bpy, bmesh, sys, os, math, json
import numpy as np
from mathutils import Vector, Matrix, Quaternion
sys.path.insert(0, "/Users/lqez/dev/sandbox-games/ploh/tools/blender")
import soldier_lib as L

A = sys.argv[sys.argv.index("--") + 1:]
HERO, OUT = A[0], A[1]
ONLY = A[2].split(",") if len(A) > 2 and A[2] else None
RAW = f"/Users/lqez/dev/sandbox-games/ploh/game/assets/{HERO}/raw/"
HEIGHT = 1.25
FR, SN = HERO == "fram", HERO == "schneider"
sc = L.clear()


def upd():
    bpy.context.view_layer.update()


# ---------------------------------------------------------------- import (soldier_build.py와 같음)
def import_glb(path):
    b_obj, b_act = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in b_obj], [a for a in bpy.data.actions if a not in b_act]


def purge(objs):
    datas = [o.data for o in objs if o.data is not None]
    mats = {m for o in objs if o.type == "MESH" for m in o.data.materials if m}
    for o in objs:
        bpy.data.objects.remove(o)
    for d in datas:
        if d.users == 0:
            (bpy.data.meshes if isinstance(d, bpy.types.Mesh) else bpy.data.armatures).remove(d)
    for m in mats:
        if m.users == 0:
            bpy.data.materials.remove(m)
    for im in list(bpy.data.images):
        if im.users == 0:
            bpy.data.images.remove(im)


objs, acts = import_glb(RAW + "rigged.glb")
for a in acts:
    bpy.data.actions.remove(a)
arm = next(o for o in objs if o.type == "ARMATURE")
mesh = next(o for o in objs if o.type == "MESH" and o.parent == arm)
purge([o for o in objs if o.type == "MESH" and o.parent is None])
arm.name = "Armature"; mesh.name = "body"; mesh.data.name = "body"
ad = arm.animation_data_create()
for t in list(ad.nla_tracks):
    ad.nla_tracks.remove(t)
ad.action = None
MAP = {"Run_02": "run", "Roll_Dodge": "dodge", "Hit_Reaction": "hit", "Dead": "death"}
o2, a2 = import_glb(RAW + "animations.glb")
for a in a2:
    key = next((k for k in MAP if a.name.endswith(k)), None)
    if key:
        a.name = MAP[key]
    else:
        bpy.data.actions.remove(a)
purge(o2)


# ---------------------------------------------------------------- normalize
def bbox(objs_):
    dg = bpy.context.evaluated_depsgraph_get(); pts = []
    for o in objs_:
        e = o.evaluated_get(dg); pts += [e.matrix_world @ v.co for v in e.data.vertices]
    return (Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))),
            Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))))


arm.data.pose_position = "REST"; upd()
lo, hi = bbox([mesh]); k = HEIGHT / (hi.z - lo.z)
arm.scale = arm.scale * k; upd()
lo, hi = bbox([mesh])
arm.location -= Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z)); upd()
s_applied = arm.scale.x
for o in bpy.data.objects:
    o.select_set(o in (arm, mesh))
bpy.context.view_layer.objects.active = arm
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for a in bpy.data.actions:
    f0 = a.frame_range[0]
    for fc in L.fcurves(a):
        for kp in fc.keyframe_points:
            kp.co.x -= f0; kp.handle_left.x -= f0; kp.handle_right.x -= f0
            if fc.data_path.endswith(".location"):
                kp.co.y *= s_applied; kp.handle_left.y *= s_applied; kp.handle_right.y *= s_applied
        fc.update()
me = mesh.data; bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
for p in me.polygons:
    p.use_smooth = True
IMG = None
for m in me.materials:
    m.name = f"{HERO}_body"
    for nd in m.node_tree.nodes:
        if nd.type == "TEX_IMAGE" and nd.image:
            IMG = nd.image
IMG.name = f"{HERO}_basecolor"
arm.data.pose_position = "POSE"; upd()

BONES = arm.data.bones; PB = arm.pose.bones


def rest_q(n): return BONES[n].matrix_local.to_quaternion()
def rest_head(n): return BONES[n].head_local.copy()
def rest_dir(n): return (BONES[n].tail_local - BONES[n].head_local).normalized()
def W(x, y, z): return Vector((-x, -y, z))      # body (right, forward, up) -> world (character faces -Y)


H = max(v.co.z for v in me.vertices); S = H / 1.25
LA = (rest_head("RightHand") - rest_head("RightArm")).length
info = {"LA": round(LA, 4), "height": round(H, 4)}


# ---------------------------------------------------------------- cloak texture (fram): red outer face -> white
def recolor_cloak():
    Wd, Ht = IMG.size
    px = np.array(IMG.pixels[:], dtype=np.float32).reshape(Ht, Wd, 4)
    mask = np.zeros((Ht, Wd), bool)
    uv = me.uv_layers.active.data
    z_top = 0.86 * S
    nsel = 0
    for poly in me.polygons:
        c = poly.center; n = poly.normal
        if not (0.40 * S < c.z < z_top and abs(c.x) < 0.27 * S):
            continue
        back = c.y > 0.055 * S and n.y > -0.2
        side = (abs(c.x) > 0.09 * S and c.y > 0.0 and n.x * math.copysign(1, c.x) > 0.3) or \
               (abs(c.x) > 0.12 * S and c.y > -0.06 * S and c.z < 0.84 * S and n.x * math.copysign(1, c.x) > 0.15)
        if not (back or side):
            continue
        nsel += 1
        P = np.array([[uv[li].uv[0] * Wd, uv[li].uv[1] * Ht] for li in poly.loop_indices])
        x0, y0 = np.floor(P.min(0)).astype(int); x1, y1 = np.ceil(P.max(0)).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, Wd - 1), min(y1, Ht - 1)
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        for t in range(1, len(P) - 1):                       # fan triangulation
            a, b, cc = P[0], P[t], P[t + 1]
            d = (b[1] - cc[1]) * (a[0] - cc[0]) + (cc[0] - b[0]) * (a[1] - cc[1])
            if abs(d) < 1e-9:
                continue
            l1 = ((b[1] - cc[1]) * (gx - cc[0]) + (cc[0] - b[0]) * (gy - cc[1])) / d
            l2 = ((cc[1] - a[1]) * (gx - cc[0]) + (a[0] - cc[0]) * (gy - cc[1])) / d
            inside = (l1 >= -0.02) & (l2 >= -0.02) & (l1 + l2 <= 1.02)
            mask[y0:y1 + 1, x0:x1 + 1] |= inside
    for _ in range(3):                                        # cover seam padding
        mask = mask | np.roll(mask, 1, 0) | np.roll(mask, -1, 0) | np.roll(mask, 1, 1) | np.roll(mask, -1, 1)
    r, g, b_ = px[..., 0], px[..., 1], px[..., 2]
    V = np.maximum(np.maximum(r, g), b_); mn = np.minimum(np.minimum(r, g), b_)
    sat = (V - mn) / np.maximum(V, 1e-4)
    red = mask & (r >= g) & (r >= b_) & (sat > 0.42) & ((g - b_) < 0.25 * (r - mn) + 0.02) & (V > 0.08)
    vr = V[red]; ref = np.percentile(vr, 92) if vr.size else 1.0
    shade = np.clip(V / ref, 0.35, 1.05)
    white = np.array([0.93, 0.92, 0.90], np.float32)
    for ch in range(3):
        px[..., ch] = np.where(red, white[ch] * (0.30 + 0.70 * shade), px[..., ch])
    IMG.pixels[:] = px.ravel()
    IMG.filepath_raw = RAW + f"{HERO}_basecolor.png"; IMG.file_format = "PNG"; IMG.save()
    info["cloak_recolor"] = {"faces": nsel, "pixels": int(red.sum())}


if FR:
    recolor_cloak()


# ---------------------------------------------------------------- skin weight fixes
def seg_dist(p, a, b):
    ab = b - a; t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (a + ab * t - p).length


def smooth01(x):
    x = max(0.0, min(1.0, x)); return x * x * (3 - 2 * x)


def fix_weights():
    vg = {g.name: g for g in mesh.vertex_groups}; gname = {g.index: g.name for g in mesh.vertex_groups}
    chain = [(n, rest_head(n).z) for n in ("Hips", "Spine02", "Spine01", "Spine", "neck", "Head")]
    zH = chain[0][1]
    ARMB = ("Arm", "ForeArm", "Hand")
    caps = []
    for s in ("Left", "Right"):
        hand = rest_head(s + "Hand"); tipp = hand + rest_dir(s + "Hand") * 0.17 * S
        caps += [(rest_head(s + "Arm"), rest_head(s + "ForeArm")), (rest_head(s + "ForeArm"), hand), (hand, tipp)]
    lsign = 1 if rest_head("LeftUpLeg").x > 0 else -1

    def target(p, legw):
        t = {}
        if p.z <= zH:
            t["Hips"] = 1.0
        elif p.z >= chain[-1][1]:
            t["Head"] = 1.0
        else:
            for (n0, z0), (n1, z1) in zip(chain, chain[1:]):
                if z0 <= p.z <= z1:
                    u = (p.z - z0) / max(z1 - z0, 1e-6); t[n0] = 1 - u; t[n1] = u; break
        if legw > 0:
            sl = smooth01(0.5 + lsign * p.x / (0.10 * S))
            for k in t:
                t[k] *= 1 - legw
            t["LeftUpLeg"] = legw * sl; t["RightUpLeg"] = legw * (1 - sl)
        return t

    BODY = ("Hips", "Spine02", "Spine01", "Spine", "LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg")
    segs = {n: (rest_head(n), BONES[n].tail_local.copy()) for n in BODY}
    z_arm = min(rest_head("LeftArm").z, rest_head("RightArm").z)
    from mathutils.kdtree import KDTree
    kd = KDTree(len(me.vertices))
    for v in me.vertices:
        kd.insert(v.co, v.index)
    kd.balance()
    hsegs = [(rest_head(sd + "Hand"), rest_head(sd + "Hand") + rest_dir(sd + "Hand") * 0.19 * S) for sd in ("Left", "Right")]
    hand_zone = {v.index for v in me.vertices if min(seg_dist(v.co, a, b) for a, b in hsegs) < 0.075 * S}
    stray = 0; stray_ids = []
    for v in me.vertices:                                       # (d) waist/thigh vertices that auto-weighting tied to the arms
        ws = {gname[g.group]: g.weight for g in v.groups}
        armw = sum(w for n, w in ws.items() if n.endswith(ARMB))
        if armw < 1e-4 or v.index in hand_zone:
            continue
        fd = smooth01((z_arm - 0.07 * S - v.co.z) / (0.08 * S)) * smooth01((min(seg_dist(v.co, a, b) for a, b in caps) - 0.045 * S) / (0.03 * S))
        if fd <= 1e-3:
            continue
        rest = {n: w for n, w in ws.items() if not n.endswith(ARMB) and w > 1e-4}
        if sum(rest.values()) < 0.05:
            near = min(BODY, key=lambda n: seg_dist(v.co, *segs[n])); rest = {near: 1.0}
        tot = sum(rest.values())
        new = {n: (w * (1 - fd) if n.endswith(ARMB) else w) for n, w in ws.items()}
        for n, w in rest.items():
            new[n] = new.get(n, 0.0) * 0 + w + armw * fd * w / tot
        tot2 = sum(new.values())
        for n, w in new.items():
            if w / tot2 > 1e-4:
                vg[n].add([v.index], w / tot2, "REPLACE")
            else:
                vg[n].remove([v.index])
        stray += 1; stray_ids.append(v.index)
    info["weights_stray_arm_verts"] = stray
    tips = 0                                                    # (e) fingertips that auto-weighting tied to the thighs:
    nbr = [[] for _ in me.vertices]                             #     flood from hand vertices along mesh edges (and across UV-seam
    for e in me.edges:                                          #     splits via co-located vertices), inside the hand region
        a_, b_ = e.vertices; nbr[a_].append(b_); nbr[b_].append(a_)
    for i in hand_zone:
        for _, j, _ in kd.find_range(me.vertices[i].co, 0.004 * S):
            if j != i:
                nbr[i].append(j)
    for sd in ("Left", "Right"):
        own = (sd + "Hand", sd + "ForeArm", sd + "Arm")
        hd = rest_head(sd + "Hand"); hdir = rest_dir(sd + "Hand"); end = hd + hdir * 0.19 * S
        hgi = vg[sd + "Hand"].index

        def wmap(v):
            return {gname[g.group]: g.weight for g in me.vertices[v].groups}

        def in_region(v):
            co = me.vertices[v].co
            return seg_dist(co, hd, end) < 0.075 * S and (co - hd).dot(hdir) > 0.02 * S
        front = {v.index for v in me.vertices if any(g.group == hgi and g.weight > 0.5 for g in v.groups) and in_region(v.index)}
        seen = set(front)
        for _ in range(6):
            nxt = set()
            for v in front:
                for u in nbr[v]:
                    if u in seen or not in_region(u):
                        continue
                    seen.add(u)
                    ws = wmap(u); other = sum(w for n, w in ws.items() if n not in own)
                    if other > 1e-4:
                        for n in ws:
                            if n not in own:
                                vg[n].remove([u])
                        vg[sd + "Hand"].add([u], min(1.0, ws.get(sd + "Hand", 0.0) + other), "REPLACE")
                        tips += 1
                    nxt.add(u)
            front = nxt
    info["weights_fingertip_verts"] = tips
    changed = 0; changed_ids = []
    for v in me.vertices:
        p = v.co
        armd = min(seg_dist(p, a, b) for a, b in caps)
        keep_arm = smooth01((armd - 0.035 * S) / (0.035 * S))   # 0 inside the arm, 1 clear of it (soft, no seam)
        if keep_arm <= 0.0:
            continue                                            # genuine arm/hand
        f = 0.0; legw = 0.0
        # (a) Fram: cloak + long hair behind the back and on the back sides
        if FR and 0.40 * S < p.z < 1.02 * S and abs(p.x) < 0.27 * S:
            f = max(f, smooth01((p.y - 0.05 * S) / (0.03 * S)))
            if abs(p.x) > 0.09 * S:
                f = max(f, smooth01((p.y - 0.0) / (0.04 * S)) * smooth01((0.95 * S - p.z) / (0.05 * S)))
            legw = 0.3 * smooth01((zH - 0.03 * S - p.z) / (0.2 * S))
        # (b) Schneider: tail
        if SN and 0.40 * S < p.z < 0.74 * S and abs(p.x) < 0.08 * S:
            f = max(f, smooth01((p.y - 0.07 * S) / (0.045 * S)))
        # (c) both: arm weight leaking into the middle of the back/chest
        ws = {gname[g.group]: g.weight for g in v.groups}
        armw = sum(w for n, w in ws.items() if n.endswith(ARMB) and not n.endswith("Shoulder"))
        if armw > 0 and zH < p.z < rest_head("neck").z and abs(p.x) < 0.13 * S:
            f = max(f, (1 - smooth01((abs(p.x) - 0.06 * S) / (0.06 * S))) * min(1.0, armw * 3))
        f *= keep_arm
        if f <= 1e-3:
            continue
        t = target(p, legw)
        new = {n: w * (1 - f) for n, w in ws.items()}
        for n, w in t.items():
            new[n] = new.get(n, 0.0) + w * f
        tot = sum(new.values())
        for n, w in new.items():
            if n not in vg:
                vg[n] = mesh.vertex_groups.new(name=n)
            if w / tot > 1e-4:
                vg[n].add([v.index], w / tot, "REPLACE")
            else:
                vg[n].remove([v.index])
        changed += 1; changed_ids.append(v.index)
    # spatial smoothing of the reweighted region (mesh is split at UV seams, so use positions, not edges)
    collar = []                                                 # (f) collar/scarf below the chin follows the neck, not the head
    zc = rest_head("neck").z + 0.01 * S
    for v in me.vertices:
        if v.co.z > zc or v.index in hand_zone:
            continue
        ws = {gname[g.group]: g.weight for g in v.groups}
        hw = ws.get("Head", 0.0) + ws.get("headfront", 0.0) + ws.get("head_end", 0.0)
        if hw < 1e-3:
            continue
        for n in ("Head", "headfront", "head_end"):
            if n in ws:
                vg[n].remove([v.index])
        vg["neck"].add([v.index], min(1.0, ws.get("neck", 0.0) + hw), "REPLACE")
        collar.append(v.index)
    info["weights_collar_verts"] = len(collar)
    region = set(changed_ids) | set(stray_ids) | set(collar)
    for i in list(region):
        for _, j, _ in kd.find_range(me.vertices[i].co, 0.02 * S):
            region.add(j)
    region = [i for i in region if i not in hand_zone and min(seg_dist(me.vertices[i].co, a, b) for a, b in caps) > 0.03 * S]
    for _ in range(3):
        cur = {i: {gname[g.group]: g.weight for g in me.vertices[i].groups} for i in region}
        for i in region:
            acc = {}; n_ = 0
            for _, j, _ in kd.find_range(me.vertices[i].co, 0.025 * S):
                if j in hand_zone:
                    continue
                for nm, w in ({gname[g.group]: g.weight for g in me.vertices[j].groups} if j not in cur else cur[j]).items():
                    acc[nm] = acc.get(nm, 0.0) + w
                n_ += 1
            tot = sum(acc.values())
            if tot <= 0:
                continue
            for nm in set(acc) | set(cur[i]):
                w = acc.get(nm, 0.0) / tot if tot else 0.0
                if w > 1e-3:
                    vg[nm].add([i], w, "REPLACE")
                elif nm in cur[i]:
                    vg[nm].remove([i])
    info["weights_fixed_verts"] = changed
    info["weights_smoothed_verts"] = len(region)


fix_weights()


# ---------------------------------------------------------------- fist (base mesh), soldier_build.py와 같은 방식
FIST_DBG = {}


def make_fist(side):
    hb = side + "Hand"; vgi = mesh.vertex_groups[hb].index
    wr = rest_head(hb); h = rest_dir(hb)
    ids, pts = [], []
    for v in me.vertices:
        w = next((g.weight for g in v.groups if g.group == vgi), 0.0)
        t = (v.co - wr).dot(h)
        if w > 0.3 and -0.005 < t < 0.2 * S and (v.co - wr - h * t).length < 0.08 * S:
            ids.append(v.index); pts.append(v.co.copy())
    P = np.array([list(p) for p in pts]); ts = (P - np.array(wr)) @ np.array(h)
    tmax = float(ts.max()); t0 = 0.42 * tmax
    C = P - P.mean(0); ev, evec = np.linalg.eigh(C.T @ C)
    n = Vector(evec[:, 0]); n = (n - h * n.dot(h)).normalized()
    inward = Vector((1, 0, 0)) if rest_head(hb).x < 0 else Vector((-1, 0, 0))
    if n.dot(inward) < 0:
        n = -n                                   # palm faces the body
    n_in = (inward - h * inward.dot(h)).normalized()
    FIST_DBG[side] = {"pca_vs_inward_deg": round(math.degrees(n.angle(n_in)), 1), "len": round(tmax, 3)}
    # PCA normal is thrown off by spread/gloved fingers; average it with "palm faces the thigh" (A-pose sheet)
    n = n_in if n.angle(n_in) > math.radians(35) else (n + n_in).normalized()
    near = [p for p, t in zip(pts, ts) if abs(t - t0) < tmax * 0.08]
    K = sum(near, Vector()) / len(near)
    r = (tmax - t0) / (0.8 * math.pi); Cc = K + n * r
    for i, p, t in zip(ids, pts, ts):
        if t <= t0:
            continue
        d = p - K; tp = d.dot(h); u = d.dot(n); sd = d - h * tp - n * u
        phi = tp / r; rho = r - u
        me.vertices[i].co = Cc - n * rho * math.cos(phi) + h * rho * math.sin(phi) + sd
    me.update()
    a_ax = h.cross(n).normalized()
    if a_ax.dot(Vector((0, -1, 0))) < 0:
        a_ax = -a_ax                             # grip axis (thumb side) points forward in rest
    h_perp = (h - a_ax * h.dot(a_ax)).normalized()
    return {"C": Cc, "S": a_ax, "K": h_perp, "N": n, "wr": wr.copy(), "r": r, "nv": len(ids)}


FIST = {s: make_fist(s) for s in ("Right", "Left")}
info["fist_verts"] = {s: FIST[s]["nv"] for s in FIST}
info["fist_dbg"] = FIST_DBG


# ---------------------------------------------------------------- props
def mat(name, rgb, metal=0.0, rough=0.6, emit=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True; b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1); b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1); b.inputs["Emission Strength"].default_value = 1.0
    return m


class Builder:
    def __init__(self, name):
        self.bm = bmesh.new(); self.mats = []; self.name = name

    def _mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def loft(self, rings, m, cap0=True, cap1=True, capm0=None):
        bm = self.bm; mi = self._mi(m); vr = []
        for r in rings:
            vr.append([bm.verts.new(p) for p in (r if isinstance(r[0], (tuple, list)) else [r])])
        for a, b in zip(vr, vr[1:]):
            if len(a) == 1 or len(b) == 1:
                apex, ring = (a[0], b) if len(a) == 1 else (b[0], a)
                for i in range(len(ring)):
                    bm.faces.new((ring[i], ring[(i + 1) % len(ring)], apex)).material_index = mi
            else:
                for i in range(len(a)):
                    bm.faces.new((a[i], a[(i + 1) % len(a)], b[(i + 1) % len(b)], b[i])).material_index = mi
        if cap0 and len(vr[0]) > 2:
            bm.faces.new(list(reversed(vr[0]))).material_index = self._mi(capm0) if capm0 else mi
        if cap1 and len(vr[-1]) > 2:
            bm.faces.new(vr[-1]).material_index = mi

    def ring(self, r, z, n=10, ph=0.0, sx=1.0, sy=1.0):
        return [(r * sx * math.cos(2 * math.pi * i / n + ph), r * sy * math.sin(2 * math.pi * i / n + ph), z) for i in range(n)]

    def cyl(self, r, z0, z1, m, n=10):
        self.loft([self.ring(r, z0, n), self.ring(r, z1, n)], m)

    def box(self, c, s, m):
        x, y, z = c; a, b, d = (s[0] / 2, s[1] / 2, s[2] / 2)
        self.loft([[(x - a, y - b, z - d), (x + a, y - b, z - d), (x + a, y + b, z - d), (x - a, y + b, z - d)],
                   [(x - a, y - b, z + d), (x + a, y - b, z + d), (x + a, y + b, z + d), (x - a, y + b, z + d)]], m)

    def spike(self, base, direction, length, r, m, n=4):
        d = Vector(direction).normalized(); bv = Vector(base)
        u = d.orthogonal().normalized(); w = d.cross(u)
        ring = [tuple(bv + (u * math.cos(2 * math.pi * i / n) + w * math.sin(2 * math.pi * i / n)) * r) for i in range(n)]
        self.loft([ring, tuple(bv + d * length)], m)

    def finish(self):
        mesh_ = bpy.data.meshes.new(self.name)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        self.bm.to_mesh(mesh_); self.bm.free()
        for m in self.mats:
            mesh_.materials.append(m)
        for p in mesh_.polygons:
            p.use_smooth = False
        ob = bpy.data.objects.new(self.name, mesh_); sc.collection.objects.link(ob)
        return ob


def build_durandal():
    """프람(불)의 듀랜달을 한손 브로드소드 크기로. 로컬 +Z = 칼날, +X = 날(주먹 마디 쪽), 원점 = 손잡이 중심."""
    steel = mat("prop_steel", (0.62, 0.64, 0.68), 0.8, 0.35)
    dark = mat("prop_gunmetal", (0.22, 0.23, 0.26), 0.8, 0.45)
    gold = mat("prop_gold", (0.86, 0.64, 0.22), 0.9, 0.35)
    brown = mat("prop_bronze", (0.42, 0.26, 0.12), 0.6, 0.5)
    black = mat("prop_black", (0.06, 0.06, 0.07), 0.2, 0.6)
    red = mat("prop_red", (0.72, 0.06, 0.06), 0.2, 0.5)
    b = Builder("weapon_sword")
    b.cyl(0.017, -0.06, 0.06, black, 10)                              # grip
    b.loft([b.ring(0.024, -0.095, 10), b.ring(0.026, -0.075, 10), b.ring(0.02, -0.06, 10)], gold)   # pommel
    b.loft([b.ring(0.03, 0.06, 12), b.ring(0.04, 0.075, 12), b.ring(0.04, 0.155, 12), b.ring(0.032, 0.17, 12)], gold)  # gold cylinder hilt
    for z in (0.095, 0.13):
        b.cyl(0.0415, z, z + 0.012, brown, 12)                         # bronze bands
    # blade: broad, angular, with a stepped mechanical spine
    t = 0.011

    def sec(z, w, xo=0.0, tt=t):
        return [(xo + w / 2, 0, z), (xo + w * 0.15, tt, z), (xo - w * 0.35, tt * 0.9, z), (xo - w / 2, 0, z),
                (xo - w * 0.35, -tt * 0.9, z), (xo + w * 0.15, -tt, z)]
    z0, Lb = 0.165, 0.56
    b.loft([sec(z0, 0.095), sec(z0 + 0.1, 0.09), sec(z0 + Lb * 0.78, 0.078), sec(z0 + Lb * 0.92, 0.06, 0.012),
            (0.03, 0, z0 + Lb)], steel)
    # dark mechanical fins near the hilt, and a red inlay groove along the flat
    for sg in (1, -1):
        b.loft([[(0.055, sg * 0.004, z0), (0.085, sg * 0.004, z0 + 0.04), (0.06, sg * 0.004, z0 + 0.16), (0.05, sg * 0.004, z0 + 0.12)],
                [(0.055, sg * 0.014, z0), (0.085, sg * 0.014, z0 + 0.04), (0.06, sg * 0.014, z0 + 0.16), (0.05, sg * 0.014, z0 + 0.12)]], dark)
        b.loft([[(-0.055, sg * 0.004, z0), (-0.08, sg * 0.004, z0 + 0.03), (-0.06, sg * 0.004, z0 + 0.22), (-0.045, sg * 0.004, z0 + 0.1)],
                [(-0.055, sg * 0.013, z0), (-0.08, sg * 0.013, z0 + 0.03), (-0.06, sg * 0.013, z0 + 0.22), (-0.045, sg * 0.013, z0 + 0.1)]], dark)
    b.box((-0.005, 0.0, z0 + 0.05 + Lb * 0.31), (0.022, 2 * t * 0.95 + 0.004, Lb * 0.62), red)   # red inlay through the flat
    return b.finish()


def build_heater_shield():
    """기사 방패. 로컬 +X = 바깥 면 법선, +Z = 방패 위쪽, Y = 폭 방향. 원점 = 방패 중심 뒤쪽(팔뚝이 닿는 면)."""
    steel = mat("prop_steel", (0.62, 0.64, 0.68), 0.8, 0.35)
    gold = mat("prop_gold", (0.86, 0.64, 0.22), 0.9, 0.35)
    red = mat("prop_red", (0.72, 0.06, 0.06), 0.2, 0.5)
    leather = mat("prop_leather", (0.28, 0.16, 0.09), 0.0, 0.8)
    b = Builder("weapon_shield")
    Wd, Ht = 0.30, 0.40

    def outline(s, x, bow=0.0):
        pts = []
        hw, top, bot = Wd / 2 * s, Ht * 0.42 * s, -Ht * 0.58 * s
        for i in range(7):                                             # flat top, rounded sides, pointed bottom
            u = i / 6; y = -hw + 2 * hw * u
            pts.append((x - bow * (y / hw) ** 2 if hw else x, y, top))
        for i in range(1, 9):
            u = i / 9; ang = u * math.pi / 2
            y = hw * math.cos(ang) ** 0.9; z = top - (top - bot) * (u ** 1.15)
            pts.append((x - bow * (y / hw) ** 2, y, z))
        pts.append((x, 0.0, bot))
        for i in range(8, 0, -1):
            u = i / 9; ang = u * math.pi / 2
            y = -hw * math.cos(ang) ** 0.9; z = top - (top - bot) * (u ** 1.15)
            pts.append((x - bow * (y / hw) ** 2, y, z))
        return pts
    b.loft([outline(1.0, 0.020, 0.03), outline(1.0, 0.040, 0.03)], gold, capm0=leather)   # rim, leather back
    b.loft([outline(0.93, 0.030, 0.03), outline(0.93, 0.052, 0.03)], steel)         # plate
    b.loft([outline(0.72, 0.050, 0.025), outline(0.72, 0.058, 0.025)], red)         # red field
    # gold chevron emblem (Fram's breastplate motif)
    for zc in (0.045, -0.03):
        e = [(-0.09, zc + 0.05), (0.0, zc - 0.015), (0.09, zc + 0.05), (0.09, zc + 0.02), (0.0, zc - 0.045), (-0.09, zc + 0.02)]
        b.loft([[(0.059, y, z) for y, z in e], [(0.066, y, z) for y, z in e]], gold)
    for y in (-0.06, 0.06):
        b.box((0.008, y, -0.02), (0.02, 0.03, 0.11), leather)                       # arm straps
    return b.finish()


def build_mace():
    """슈나이더(물)의 대형 가시 메이스. 로컬 +Z = 머리 쪽, 원점 = 오른손 손잡이 중심. 파란 자루, 은색 원통형 가시 머리."""
    steel = mat("prop_steel", (0.62, 0.64, 0.68), 0.8, 0.35)
    dark = mat("prop_gunmetal", (0.30, 0.31, 0.34), 0.85, 0.4)
    gold = mat("prop_gold", (0.86, 0.64, 0.22), 0.9, 0.35)
    blue = mat("prop_blue", (0.08, 0.20, 0.55), 0.3, 0.45)
    b = Builder("weapon_mace")
    b.loft([b.ring(0.024, -0.43, 10), b.ring(0.03, -0.41, 10), b.ring(0.03, -0.385, 10), b.ring(0.022, -0.37, 10)], steel)  # butt cap
    b.cyl(0.021, -0.37, 0.40, blue, 10)                                # shaft
    for z in (-0.32, 0.30):
        b.cyl(0.026, z, z + 0.025, gold, 10)                            # gold rings
    b.loft([b.ring(0.024, 0.36, 10), b.ring(0.04, 0.40, 10), b.ring(0.045, 0.43, 10)], steel)  # collar
    zh0, zh1, R = 0.43, 0.75, 0.085
    b.loft([b.ring(0.06, zh0, 12), b.ring(R, zh0 + 0.03, 12), b.ring(R * 1.06, (zh0 + zh1) / 2, 12),
            b.ring(R, zh1 - 0.03, 12), b.ring(0.05, zh1, 12)], steel)    # barrel head
    for z in (zh0 + 0.03, zh1 - 0.03):
        b.cyl(R + 0.008, z - 0.01, z + 0.01, dark, 12)                  # flanges
    for ri, z in enumerate((zh0 + 0.075, (zh0 + zh1) / 2, zh1 - 0.075)):
        for i in range(7):
            a = 2 * math.pi * i / 7 + (ri % 2) * math.pi / 7
            d = (math.cos(a), math.sin(a), 0.0)
            b.spike((R * 0.95 * d[0], R * 0.95 * d[1], z), d, 0.075, 0.03, dark)
    b.spike((0, 0, zh1 - 0.005), (0, 0, 1), 0.07, 0.035, dark, 6)     # top spike
    return b.finish()


def attach(ob, bone, M):
    arm.data.pose_position = "REST"; upd()
    ob.parent = arm; ob.parent_type = "BONE"; ob.parent_bone = bone
    upd(); ob.matrix_world = M; upd()
    arm.data.pose_position = "POSE"; upd()


def basis(X, Z, origin):
    X = X.normalized(); Z = (Z - X * Z.dot(X)).normalized(); Y = Z.cross(X)
    return Matrix.Translation(origin) @ Matrix((X, Y, Z)).transposed().to_4x4()


fr, fl = FIST["Right"], FIST["Left"]
if FR:
    WEAPON = build_durandal()
    attach(WEAPON, "RightHand", basis(fr["K"], fr["S"], fr["C"]))
    SHIELD = build_heater_shield()
    # strapped on the left forearm: face = back of the hand, up = thumb axis, centre a little toward the elbow
    back = -fl["N"]
    attach(SHIELD, "LeftHand", basis(back, fl["S"], fl["C"] - fl["K"] * 0.05 * S + back * 0.035 * S))
else:
    WEAPON = build_mace()
    attach(WEAPON, "RightHand", basis(fr["K"], fr["S"], fr["C"]))
    SHIELD = None
GRIP_L = -0.24 * S          # left hand position along the mace shaft (below the right hand)


# ---------------------------------------------------------------- posing helpers
def reset():
    for pb in PB:
        pb.rotation_mode = "QUATERNION"; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)


def cur_q(n): return PB[n].matrix.to_quaternion()


def set_world(n, q, head=None):
    upd(); hd = PB[n].matrix.translation.copy() if head is None else head
    PB[n].matrix = Matrix.LocRotScale(hd, q, Vector((1, 1, 1)))


def follow_q(n):
    par = BONES[n].parent.name
    return (cur_q(par) @ rest_q(par).inverted()) @ rest_q(n)


def aim(n, d):
    upd(); qb = follow_q(n); db = qb @ Vector((0, 1, 0))
    set_world(n, db.rotation_difference(d.normalized()) @ qb)


def ik(up, lo_, target, pole):
    upd(); Sp = PB[up].matrix.translation.copy()
    a = (rest_head(lo_) - rest_head(up)).length
    end = lo_.replace("ForeArm", "Hand") if "ForeArm" in lo_ else lo_.replace("Leg", "Foot")
    b = (rest_head(end) - rest_head(lo_)).length
    D = target - Sp; d = min(max(D.length, 1e-4), (a + b) * 0.999); u = D.normalized()
    ca = (a * a + d * d - b * b) / (2 * a * d); sa = math.sqrt(max(0, 1 - ca * ca))
    p = (pole - u * u.dot(pole)).normalized()
    e = Sp + u * a * ca + p * a * sa
    aim(up, e - Sp); aim(lo_, Sp + u * d - e)
    return max(0.0, D.length - (a + b) * 0.999)


def frame_rot(a0, b0, a1, b1):
    a0 = a0.normalized(); b0 = (b0 - a0 * b0.dot(a0)).normalized()
    a1 = a1.normalized(); b1 = b1 - a1 * b1.dot(a1)
    if b1.length < 1e-4:
        b1 = a1.orthogonal()
    b1.normalize()
    M0 = Matrix((a0, b0, a0.cross(b0))).transposed(); M1 = Matrix((a1, b1, a1.cross(b1))).transposed()
    return (M1 @ M0.transposed()).to_quaternion()


def Rz(deg): return Quaternion((0, 0, 1), math.radians(deg))
def Rx(deg): return Quaternion((1, 0, 0), math.radians(deg))
def Ryw(deg): return Quaternion((0, 1, 0), math.radians(deg))


def nrm(v): return Vector(v).normalized()


IKERR = {"max": 0.0}


def place_grip(side, grip, axis, knuck_hint, pole, record=True):
    """fist centre at `grip`, thumb axis along `axis`."""
    F = FIST[side]; hb = side + "Hand"
    kn = knuck_hint
    for _ in range(4):                     # the wrist target depends on the hand rotation, which follows the forearm
        R = frame_rot(F["S"], F["K"], axis, kn)
        wrist = grip - R @ (F["C"] - F["wr"])
        ik(side + "Arm", side + "ForeArm", wrist, pole)
        upd(); kn = PB[hb].matrix.translation - PB[side + "ForeArm"].matrix.translation
    set_world(hb, R @ rest_q(hb)); upd()   # same R that produced the wrist target
    fist = PB[hb].matrix.translation + (R @ (F["C"] - F["wr"]))
    e = (fist - grip).length
    if not record:
        return R, e
    IKERR["max"] = max(IKERR["max"], e)
    if e > 0.012:
        IKERR.setdefault("bad", {}).setdefault(IKERR.get("cur", "?"), set()).add(IKERR.get("f", -1))
    return R


GRIP_S = 0.15 * S         # distance between the two fists on the mace shaft


CHAIN = {s: (rest_head(s + "ForeArm") - rest_head(s + "Arm")).length + (rest_head(s + "Hand") - rest_head(s + "ForeArm")).length
         for s in ("Right", "Left")}
PULLED = {"n": 0, "max": 0.0}


def two_hand(axis, Rframe, gc, gs, Rpole):
    """Both fists on the shaft around grip centre gc. If a fist is out of reach, slide the grip centre toward a
    comfortable point in front of the sternum (short arms: the weapon is held close rather than letting a hand slip off)."""
    axis = axis.normalized()
    shp = {s: PB[s + "Arm"].matrix.translation.copy() for s in ("Right", "Left")}
    mid = (shp["Right"] + shp["Left"]) / 2
    c0 = mid + Rframe @ W(*[v * LA for v in gc])
    home = mid + Rframe @ W(0.0, 0.5, -0.6) * LA

    def fists(c):
        return {"Right": c + axis * gs / 2, "Left": c - axis * gs / 2}

    def ok(c):
        fs = fists(c)
        for s_, f_ in fs.items():                      # wrist implied by the fist rotation must be within the arm chain
            F = FIST[s_]; hint = (f_ - shp[s_]) - axis * (f_ - shp[s_]).dot(axis)
            wr_ = f_ - frame_rot(F["S"], F["K"], axis, hint) @ (F["C"] - F["wr"])
            if (wr_ - shp[s_]).length > CHAIN[s_] * 0.985:
                return False
        return True
    c = c0
    if not ok(c0):
        lo_, hi_ = 0.0, 1.0
        for _ in range(14):
            t = (lo_ + hi_) / 2
            if ok(home + (c0 - home) * t):
                lo_ = t
            else:
                hi_ = t
        c = home + (c0 - home) * lo_
        PULLED["n"] += 1; PULLED["max"] = max(PULLED["max"], (c - c0).length)
    t = 1.0 if c is c0 else lo_
    for attempt in range(10):                          # fallback: keep sliding toward home until both fists hold the shaft
        c = home + (c0 - home) * t
        fs = fists(c); worst = 0.0
        for side, sg in (("Right", 1), ("Left", -1)):
            sh = shp[side]; hint = (fs[side] - sh) - axis * (fs[side] - sh).dot(axis)
            worst = max(worst, place_grip(side, fs[side], axis, hint, Rpole @ W(sg * 0.8, -0.5, -1.0), record=False)[1])
        if worst < 0.006 * S or t <= 0.0:
            break
        t = max(0.0, t - 0.1)
        PULLED["n"] += 1; PULLED["max"] = max(PULLED["max"], (c - c0).length)
    for side, sg in (("Right", 1), ("Left", -1)):        # final placement, recorded
        sh = shp[side]; hint = (fs[side] - sh) - axis * (fs[side] - sh).dot(axis)
        place_grip(side, fs[side], axis, hint, Rpole @ W(sg * 0.8, -0.5, -1.0))


def apply_pose(p):
    reset(); upd()
    yaw = p.get("yaw", 0.0); pyaw = p.get("pyaw", 0.0); cy = p.get("cyaw", 0.0); cp = p.get("cpitch", 0.0)
    cr = p.get("croll", 0.0)
    Ry = Rz(yaw)
    off = Ry @ W(*[c * S for c in p.get("hip", (0, 0, 0))])
    set_world("Hips", Ry @ Rz(pyaw) @ Rx(p.get("hpitch", 0.0)) @ Ryw(p.get("hroll", 0.0)) @ rest_q("Hips"),
              head=Ry @ rest_head("Hips") + off)
    for f, bn in ((1 / 3, "Spine02"), (2 / 3, "Spine01"), (1.0, "Spine")):
        set_world(bn, Ry @ Rz(pyaw + cy * f) @ Rx(cp * f) @ Ryw(cr * f) @ rest_q(bn))
    hy = p.get("hyaw", 0.0); hp = p.get("hp", 0.0)
    set_world("neck", Ry @ Rz(pyaw + cy + hy * 0.5) @ Rx(cp * 0.4 + hp * 0.5) @ Ryw(cr * 0.5) @ rest_q("neck"))
    set_world("Head", Ry @ Rz(pyaw + cy + hy) @ Rx(cp * 0.2 + hp) @ rest_q("Head"))
    # legs: foot = (right, fwd, up, yaw, heel-pitch)
    for side, key in (("Right", "rf"), ("Left", "lf")):
        o = list(p.get(key, (0, 0, 0, 0, 0))) + [0, 0]
        Rf = Ry @ Rz(o[3]); Rp = Rx(o[4])
        toe = rest_head(side + "ToeBase"); v = rest_head(side + "Foot") - toe
        toe_t = Ry @ toe + Ry @ W(o[0] * S, o[1] * S, o[2] * S)
        ankle = toe_t + Rf @ (Rp @ v)
        sg = 1 if side == "Right" else -1
        ik(side + "UpLeg", side + "Leg", ankle, Rf @ W(sg * 0.35, 1, 0))       # knees track over the toes, a bit outward
        set_world(side + "Foot", Rf @ Rp @ rest_q(side + "Foot"))
        set_world(side + "ToeBase", Rf @ rest_q(side + "ToeBase"))
    upd()
    if "gc" in p:                     # two-handed: grip centre relative to the shoulder midpoint, both fists on the shaft
        two_hand(Ry @ W(*p["rb"]), Ry, p["gc"], p.get("gs", GRIP_S), Ry @ Rz(pyaw + cy))
        upd(); return
    # right hand: wrist target relative to the current right shoulder (ground frame), weapon direction
    sh = PB["RightArm"].matrix.translation.copy()
    T = sh + Ry @ W(*[c * LA for c in p["rh"]])
    pole = Ry @ Rz(pyaw + cy) @ W(0.8, -0.6, -1.0)
    ik("RightArm", "RightForeArm", T, pole)
    upd(); fore = PB["RightHand"].matrix.translation - PB["RightForeArm"].matrix.translation
    kn = Ry @ W(*p["rk"]) if "rk" in p else fore
    Rr = frame_rot(fr["S"], fr["K"], Ry @ W(*p["rb"]), kn)
    set_world("RightHand", Rr @ rest_q("RightHand")); upd()
    if FR:
        shl = PB["LeftArm"].matrix.translation.copy()
        T = shl + Ry @ W(*[c * LA for c in p["lh"]])
        ik("LeftArm", "LeftForeArm", T, Ry @ Rz(pyaw + cy) @ W(-0.8, -0.6, -1.0))
        upd()
        # shield: face normal `ln`, up `lu` -> hand frame maps (back-of-hand, thumb) onto them
        Rl = frame_rot(fl["S"], -fl["N"], Ry @ W(*p.get("lu", (0, 0, 1))), Ry @ W(*p["ln"]))
        set_world("LeftHand", Rl @ rest_q("LeftHand")); upd()
    else:
        fist_r = PB["RightHand"].matrix.translation + Rr @ (fr["C"] - fr["wr"])
        axis = Rr @ fr["S"]
        grip = fist_r + axis * p.get("lg", GRIP_L)
        shl = PB["LeftArm"].matrix.translation
        hint = (grip - shl) - axis * (grip - shl).dot(axis)
        place_grip("Left", grip, axis, hint, Ry @ Rz(pyaw + cy) @ W(-0.8, -0.5, -1.0))
    upd()


# ---------------------------------------------------------------- keys: per-channel curves, segment easing, overlap
GROUP = {"gc": "arms", "gs": "arms", "hip": "pelvis", "pyaw": "pelvis", "hroll": "pelvis", "hpitch": "pelvis",
         "cyaw": "chest", "cpitch": "chest", "croll": "chest", "hyaw": "head", "hp": "head",
         "rf": "feet", "lf": "feet", "rh": "arms", "lh": "arms", "lg": "arms",
         "rb": "weapon", "rk": "weapon", "ln": "weapon", "lu": "weapon", "yaw": "yaw"}
SPH = {"rh", "lh", "gc"}
SPHD = {"rb"}                 # weapon direction: azimuth/elevation, so horizontal swings stay horizontal
DIRS = {"rk", "ln", "lu"}
EASE = {"io": lambda t: t * t * (3 - 2 * t), "in": lambda t: t * t, "in3": lambda t: t * t * t,
        "out": lambda t: 1 - (1 - t) ** 2, "out3": lambda t: 1 - (1 - t) ** 3, "lin": lambda t: t}


def to_sph(v):
    x, y, z = v; r = math.sqrt(x * x + y * y + z * z)
    return math.atan2(x, y), math.atan2(z, math.hypot(x, y)), r


def from_sph(az, el, r):
    return (r * math.cos(el) * math.sin(az), r * math.cos(el) * math.cos(az), r * math.sin(el))


def lerp_val(name, a, b, t):
    if isinstance(a, (int, float)):
        return a + (b - a) * t
    if name in SPH:
        a0, e0, r0 = to_sph(a); a1, e1, r1 = to_sph(b)
        da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
        return from_sph(a0 + da * t, e0 + (e1 - e0) * t, r0 + (r1 - r0) * t)
    if name in SPHD:
        a0, e0, _ = to_sph(a); a1, e1, _ = to_sph(b)
        da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
        return from_sph(a0 + da * t, e0 + (e1 - e0) * t, 1.0)
    if name in DIRS:
        va, vb = Vector(a).normalized(), Vector(b).normalized()
        q = va.rotation_difference(vb)
        return tuple(Quaternion().slerp(q, t) @ va)
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def curves(keys):
    cv = {}
    for k in keys:
        f, pose = k[0], k[1]; e = k[2] if len(k) > 2 else "io"
        for name, val in pose.items():
            cv.setdefault(name, []).append((f, val, e))
    for name in cv:
        cv[name].sort(key=lambda t: t[0])
    return cv


def eval_curve(name, ks, f):
    if f <= ks[0][0]:
        return ks[0][1]
    for (f0, v0, _), (f1, v1, e) in zip(ks, ks[1:]):
        if f0 <= f <= f1:
            return lerp_val(name, v0, v1, EASE[e]((f - f0) / max(f1 - f0, 1e-6)))
    return ks[-1][1]


LEAD = {"pelvis": 1.5, "chest": 0.8, "head": 2.0, "feet": 1.0, "arms": 0.0, "weapon": -0.7, "yaw": 0.0}


def pose_at(cv, f, n, overlap):
    p = {}
    w = min(1.0, f / 4.0, (n - f) / 4.0) if overlap else 0.0
    for name, ks in cv.items():
        g = GROUP.get(name, "arms")
        fe = min(max(f + LEAD[g] * w, 0.0), float(n))
        p[name] = eval_curve(name, ks, fe)
    return p


ALL = [b.name for b in BONES]


def write(act, frames, bones=None):
    ad.action = act
    if hasattr(ad, "action_slot") and act.slots:
        ad.action_slot = act.slots[0]
    fs = sorted(frames)
    for bn in (bones or ALL):
        chans = [("rotation_quaternion", 4, lambda fr_, i: fr_[bn][0][i])]
        if bn == "Hips" and bones is None:
            chans.append(("location", 3, lambda fr_, i: fr_[bn][1][i]))
        for prop, nc, get in chans:
            path = f'pose.bones["{bn}"].{prop}'
            for i in range(nc):
                fc = act.fcurve_ensure_for_datablock(arm, path, index=i, group_name=bn)
                fc.keyframe_points.clear(); fc.keyframe_points.add(len(fs))
                co = []
                for f in fs:
                    co += [float(f), float(get(frames[f], i))]
                fc.keyframe_points.foreach_set("co", co)
                for kp in fc.keyframe_points:
                    kp.interpolation = "LINEAR"
                fc.update()


def snapshot(bones, prev):
    fr_ = {}
    for bn in bones:
        q = PB[bn].rotation_quaternion.copy()
        if bn in prev and q.dot(prev[bn]) < 0:
            q = -q
        prev[bn] = q; fr_[bn] = (q, PB[bn].location.copy())
    return fr_


def bake(name, n, keys, overlap=True):
    ad.action = None
    cv = curves(keys)
    frames, prev = {}, {}
    IKERR["max"] = 0.0
    IKERR["cur"] = name
    for f in range(n + 1):
        IKERR["f"] = f
        apply_pose(pose_at(cv, f, n, overlap)); frames[f] = snapshot(ALL, prev)
    if name in bpy.data.actions:
        bpy.data.actions.remove(bpy.data.actions[name])
    write(bpy.data.actions.new(name), frames)
    info.setdefault("grip_err_mm", {})[name] = round(IKERR["max"] * 1000, 1)


exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), f"clips_{HERO}.py")).read())

for nm, (n, keys, ov) in CLIPS.items():
    if ONLY is None or nm in ONLY:
        bake(nm, n, keys, ov)


# ---------------------------------------------------------------- overlays on Meshy clips (run, dodge, hit, death)
def chest_frame():
    return cur_q("Spine") @ rest_q("Spine").inverted()


def overlay(act, fn, bones):
    L.set_action(arm, act)
    f0, f1 = int(round(act.frame_range[0])), int(round(act.frame_range[1]))
    hip_z = {}
    for f in range(f0, f1 + 1):
        sc.frame_set(f); upd(); hip_z[f] = PB["Hips"].matrix.translation.z
    zm = sum(hip_z.values()) / len(hip_z)
    frames, prev = {}, {}
    IKERR["max"] = 0.0
    for f in range(f0, f1 + 1):
        L.set_action(arm, act, f); upd()
        IKERR["cur"] = act.name; IKERR["f"] = f
        ph = (f - f0) / max(1, f1 - f0)
        lag = hip_z[f0 + (f - f0 - 2) % (f1 - f0)] - hip_z[f] if f1 > f0 else 0.0     # body bob seen 2 frames late
        fn(chest_frame(), ph, lag)
        frames[f] = snapshot(bones, prev)
    ad.action = None
    write(act, frames, bones=bones)
    info.setdefault("grip_err_mm", {})[act.name] = round(IKERR["max"] * 1000, 1)


def arms_overlay(spec):
    """spec: dict with rh, rb (+rk) and lh/ln/lu (fram) or lg (schneider), all in the CHEST frame."""
    def flat(d):                                   # spec["flat"]: never point the weapon into the floor (body lying down)
        if spec.get("flat") and d.z < 0.08 * d.length:
            d = Vector((d.x, d.y, 0.0)).normalized() * math.cos(0.08) + Vector((0, 0, math.sin(0.08)))
        return d

    def fn(Rc, ph, lag):
        sh = PB["RightArm"].matrix.translation.copy()
        rh = Vector(spec["rh"](ph, lag)) if callable(spec["rh"]) else Vector(spec["rh"])
        T = sh + Rc @ W(*(rh * LA))
        ik("RightArm", "RightForeArm", T, Rc @ W(0.8, -0.6, -1.0))
        upd(); fore = PB["RightHand"].matrix.translation - PB["RightForeArm"].matrix.translation
        rb = spec["rb"](ph, lag) if callable(spec["rb"]) else spec["rb"]
        Rr = frame_rot(fr["S"], fr["K"], flat(Rc @ W(*rb)), fore)
        set_world("RightHand", Rr @ rest_q("RightHand")); upd()
        if FR:
            shl = PB["LeftArm"].matrix.translation.copy()
            lh = Vector(spec["lh"](ph, lag)) if callable(spec["lh"]) else Vector(spec["lh"])
            ik("LeftArm", "LeftForeArm", shl + Rc @ W(*(lh * LA)), Rc @ W(-0.8, -0.6, -1.0)); upd()
            Rl = frame_rot(fl["S"], -fl["N"], Rc @ W(*spec.get("lu", (0, 0, 1))), Rc @ W(*spec["ln"]))
            set_world("LeftHand", Rl @ rest_q("LeftHand")); upd()
    def fn2(Rc, ph, lag):
        gc = spec["gc"](ph, lag) if callable(spec["gc"]) else spec["gc"]
        rb = spec["rb"](ph, lag) if callable(spec["rb"]) else spec["rb"]
        two_hand(flat(Rc @ W(*rb)), Rc, gc, spec.get("gs", GRIP_S), Rc)
    return fn2 if "gc" in spec else fn


ARMS = ["RightArm", "RightForeArm", "RightHand", "LeftArm", "LeftForeArm", "LeftHand"]
for nm, spec in OVERLAYS.items():
    if nm in bpy.data.actions and (ONLY is None or nm in ONLY):
        overlay(bpy.data.actions[nm], arms_overlay(spec), ARMS)
for nm in ("run", "dodge", "hit", "death"):
    if nm in bpy.data.actions:
        act = bpy.data.actions[nm]
        for fc in L.fcurves(act):
            if fc.data_path == 'pose.bones["Hips"].location':
                vals = [kp.co.y for kp in fc.keyframe_points]
                info.setdefault("hips_range_m", {})[f"{nm}_{fc.array_index}"] = round(max(vals) - min(vals), 3)


# ---------------------------------------------------------------- strike measurement (game weapon.gd와 같은 칼끝 정의)
def measure(name):
    act = bpy.data.actions[name]; n = int(round(act.frame_range[1]))
    arm.data.pose_position = "REST"; upd()
    Mb = arm.matrix_world @ PB[WEAPON.parent_bone].matrix
    loc = [Mb.inverted() @ (WEAPON.matrix_world @ v.co) for v in WEAPON.data.vertices]
    arm.data.pose_position = "POSE"; upd()
    tip_l = max(loc, key=lambda q: q.length)
    tips, hips = [], []
    for f in range(n + 1):
        L.set_action(arm, act, f); upd()
        tips.append(arm.matrix_world @ (PB[WEAPON.parent_bone].matrix @ tip_l)); hips.append(PB["Hips"].matrix.translation.copy())
    sp = [0.0] + [(tips[i] - tips[i - 1]).length * 30 for i in range(1, n + 1)]
    pk = max(range(n + 1), key=lambda i: sp[i])
    lo_, hi_ = pk, pk
    while lo_ > 1 and sp[lo_ - 1] >= 0.25 * sp[pk]:
        lo_ -= 1
    while hi_ < n and sp[hi_ + 1] >= 0.25 * sp[pk]:
        hi_ += 1
    d = tips[pk] - hips[pk]
    win = [tips[i] - hips[i] for i in range(lo_, hi_ + 1)]
    return {"frames": n, "strike": pk, "frac": round(pk / n, 3), "peak_mps": round(sp[pk], 1), "fast": [lo_, hi_, hi_ - lo_ + 1],
            "win_tip_xy": [round(min(v.xy.length for v in win), 2), round(max(v.xy.length for v in win), 2)],
            "win_tip_z": [round(min(t.z for t in tips[lo_:hi_ + 1]), 2), round(max(t.z for t in tips[lo_:hi_ + 1]), 2)],
            "tip_from_hips_xy": round(d.xy.length, 3), "tip_z": round(tips[pk].z, 3), "min_tip_z": round(min(t.z for t in tips), 3)}


info["grip_pulled"] = {"frames": PULLED["n"], "max_m": round(PULLED["max"], 3)}
info["grip_bad_frames"] = {k: sorted(v) for k, v in IKERR.get("bad", {}).items()}
info["strike"] = {nm: measure(nm) for nm in ("attack_1", "attack_2", "attack_3", "cast", "spin") if nm in bpy.data.actions}

# ---------------------------------------------------------------- export
ad.action = None
for t in list(ad.nla_tracks):
    ad.nla_tracks.remove(t)
ORDER = ["idle", "run", "attack_1", "attack_2", "attack_3", "cast", "spin", "dodge", "hit", "death"]
for a in sorted(bpy.data.actions, key=lambda a: ORDER.index(a.name) if a.name in ORDER else 99):
    a.use_fake_user = False
    t = ad.nla_tracks.new(); t.name = a.name
    st = t.strips.new(a.name, int(a.frame_range[0]), a); st.name = a.name
reset(); upd()
for o in bpy.data.objects:
    o.select_set(o.type in ("ARMATURE", "MESH"))
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_animation_mode="ACTIONS",
                          export_yup=True, export_force_sampling=True, export_frame_step=1,
                          export_optimize_animation_size=False, export_image_format="JPEG", export_jpeg_quality=92)
props = [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("weapon_")]
info.update({
    "tris_body": sum(len(p.vertices) - 2 for p in me.polygons),
    "tris_props": {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in props},
    "actions": {a.name: [round((a.frame_range[1] - a.frame_range[0]) / 30, 3), int(a.frame_range[1] - a.frame_range[0])] for a in bpy.data.actions},
    "images": {i.name: list(i.size) for i in bpy.data.images},
    "bones": [b.name for b in BONES]})
print("INFO", json.dumps(info))
