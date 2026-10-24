"""Weapon-through-body check and fix for PLOH characters, against the real skinned body (not capsules).

Body: the ORIGINAL closed body mesh of raw/<name>_handkeyed.glb (the decimated mobile body has cracks along UV seams and bad
normals; vertex-normal and closest-face sign tests both gave false hits up to 10 cm outside the body), skinned per frame with
the GLB's own skin (linear blend).

Inside test: per frame the skinned body is voxelised at 1 cm (vertical ray parity per column: every triangle is rasterised into
the columns it covers, the sorted crossings pair up into inside intervals). Each inside voxel takes the body part of its nearest
vertex. For each weapon the voxels of the ignored parts are cleared (the holding hand and forearm; for two-handed weapons also
the other hand and forearm; for shields and bows the whole holding arm) and a Euclidean distance transform gives the depth of
every inside voxel. Weapon samples (mesh vertices + one point per cm along grip -> tip; the handle in the fist is skipped) read
the depth by trilinear interpolation. Blades are also tested against the character's own shield (its local bounding box), and
with --floor every weapon against the floor (model y = 0; part "floor"; ground strikes touch it on purpose).

declip(): fixes a clip by turning the weapon hand (wrist) so the weapon clears the body: per bad frame the smallest rotation
(axes perpendicular to the weapon, 6-50 deg) that brings the depth under half the tolerance is chosen, the per-frame rotations
are eased in/out over neighbouring frames and smoothed, and the pass repeats (5 passes, total turn capped at 60 deg). Frames
still inside then get the hand moved out of the body with arm IK (along the outward gradient of the depth field; weapon
direction kept), eased the same way (up to 6 passes). A blade inside the character's own shield leaves through the nearest face
of the shield box while the shield hand moves the other way by the same amount.

usage: uv run --no-project --with numpy --with scipy python clipcheck.py <glb> [clip,...] [--tol 0.01] [--json out.json]
       [--twohand] [--base raw/<name>_handkeyed.glb] [--floor]
prints one line per clip and weapon: worst depth (cm), worst frame, body part, number of frames deeper than tol, frame list.
"""
import sys, os, json
import numpy as np
from scipy.spatial import cKDTree
from scipy import ndimage
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gltfio as G, fk

PART = {"Head": "head", "neck": "head", "head_end": "head", "headfront": "head",
        "Hips": "torso", "Spine02": "torso", "Spine01": "torso", "Spine": "torso"}
for s in ("Left", "Right"):
    for b in ("Shoulder", "Arm", "ForeArm", "Hand"):
        PART[s + b] = s[0] + "arm"
    for b in ("UpLeg", "Leg", "Foot", "ToeBase"):
        PART[s + b] = s[0] + "leg"
H = 0.01                                     # voxel size (m)


def load_body(glb):
    j, binc = G.read_glb(glb)
    names = G.node_names(j)
    mi = next(n["mesh"] for n in j["nodes"] if "mesh" in n and "skin" in n)
    pr = j["meshes"][mi]["primitives"][0]
    P = G.acc(j, binc, pr["attributes"]["POSITION"])
    J = G.acc(j, binc, pr["attributes"]["JOINTS_0"]).astype(int); W = G.acc(j, binc, pr["attributes"]["WEIGHTS_0"])
    joints = [names[i] for i in j["skins"][0]["joints"]]
    ibm = G.acc(j, binc, j["skins"][0]["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)   # column-major
    tri = G.acc(j, binc, pr["indices"]).reshape(-1, 3).astype(int)
    dom = np.array([joints[J[i, np.argmax(W[i])]] for i in range(len(P))])
    return dict(P=P, J=J, W=W, joints=joints, ibm=ibm, tri=tri, dom=dom)


def excluded(wn, hand_bone, twohand=False):
    side = hand_bone[:-4]
    ex = {side + "Hand", side + "ForeArm"}
    if wn in ("weapon_shield", "weapon_bow"):
        ex |= {side + "Arm"}
    elif twohand:
        ex |= {"LeftHand", "LeftForeArm", "RightHand", "RightForeArm"}
    return frozenset(ex)


class Body:
    """skinned original body + per-frame voxel inside/depth fields"""
    def __init__(self, base_glb):
        self.b = load_body(base_glb)
        self._cache = {}

    def skin(self, g, f):
        b = self.b
        M = np.zeros((len(b["joints"]), 4, 4))
        for k, j in enumerate(b["joints"]):
            M[k, :3, :3] = g[j][1][f]; M[k, :3, 3] = g[j][0][f]; M[k, 3, 3] = 1
        S = M @ b["ibm"]
        Ph = np.c_[b["P"], np.ones(len(b["P"]))]
        v = np.zeros((len(Ph), 3))
        for c in range(4):
            v += b["W"][:, c, None] * np.einsum("nij,nj->ni", S[b["J"][:, c]], Ph)[:, :3]
        return v

    def field(self, g, f, key, ex_sets):
        """voxel depth fields for one frame. key identifies (clip, frame) for caching."""
        ck = (key, f)
        if ck in self._cache:
            return self._cache[ck]
        v = self.skin(g, f); tri = self.b["tri"]
        lo = v.min(0) - 3 * H; hi = v.max(0) + 3 * H
        dims = np.ceil((hi - lo) / H).astype(int) + 1
        jit = np.array([0.37e-4, 0, 0.61e-4])              # keep column centres off exact mesh edges
        A, B, C = v[tri[:, 0]], v[tri[:, 1]], v[tri[:, 2]]
        tmin = np.minimum(np.minimum(A, B), C); tmax = np.maximum(np.maximum(A, B), C)
        ix0 = np.ceil((tmin[:, 0] - lo[0] - jit[0]) / H).astype(int); ix1 = np.floor((tmax[:, 0] - lo[0] - jit[0]) / H).astype(int)
        iz0 = np.ceil((tmin[:, 2] - lo[2] - jit[2]) / H).astype(int); iz1 = np.floor((tmax[:, 2] - lo[2] - jit[2]) / H).astype(int)
        nx = np.maximum(ix1 - ix0 + 1, 0); nz = np.maximum(iz1 - iz0 + 1, 0); cnt = nx * nz
        ti = np.repeat(np.arange(len(tri)), cnt)
        off = np.arange(cnt.sum()) - np.repeat(np.cumsum(cnt) - cnt, cnt)
        cx = ix0[ti] + off // np.maximum(nz[ti], 1); cz = iz0[ti] + off % np.maximum(nz[ti], 1)
        px = lo[0] + jit[0] + cx * H; pz = lo[2] + jit[2] + cz * H
        a, b_, c_ = A[ti], B[ti], C[ti]
        v0x, v0z = c_[:, 0] - a[:, 0], c_[:, 2] - a[:, 2]; v1x, v1z = b_[:, 0] - a[:, 0], b_[:, 2] - a[:, 2]
        v2x, v2z = px - a[:, 0], pz - a[:, 2]
        den = v0x * v1z - v1x * v0z
        ok = np.abs(den) > 1e-14
        den = np.where(ok, den, 1)
        u = (v2x * v1z - v1x * v2z) / den; w = (v0x * v2z - v2x * v0z) / den
        hit = ok & (u >= 0) & (w >= 0) & (u + w <= 1)
        y = a[:, 1] + u * (c_[:, 1] - a[:, 1]) + w * (b_[:, 1] - a[:, 1])
        cx, cz, y = cx[hit], cz[hit], y[hit]
        col = cx * dims[2] + cz
        o = np.lexsort((y, col)); col, y = col[o], y[o]
        occ = np.zeros((dims[0], dims[1] + 1, dims[2]), np.int16)
        # pair consecutive crossings within each column: [y0, y1], [y2, y3], ...
        starts = np.r_[0, np.where(np.diff(col) != 0)[0] + 1]
        rank = np.arange(len(col)) - np.repeat(starts, np.diff(np.r_[starts, len(col)]))
        ii = np.where(rank % 2 == 0)[0]; ii = ii[ii + 1 < len(col)]
        ii = ii[col[ii + 1] == col[ii]]
        y0 = np.ceil((y[ii] - lo[1]) / H).astype(int); y1 = np.floor((y[ii + 1] - lo[1]) / H).astype(int)
        good = y1 >= y0
        cc = col[ii][good]; y0, y1 = y0[good], np.minimum(y1[good], dims[1] - 1)
        np.add.at(occ, (cc // dims[2], y0, cc % dims[2]), 1)
        np.add.at(occ, (cc // dims[2], y1 + 1, cc % dims[2]), -1)
        inside = np.cumsum(occ, 1)[:, :dims[1], :] > 0
        idx = np.argwhere(inside)
        tree = cKDTree(v)
        _, nv = tree.query(lo + idx * H, k=1)
        lab = self.b["dom"][nv]
        fields = {}
        for ex in ex_sets:
            m = inside.copy()
            if ex:
                bad = np.isin(lab, list(ex))
                m[tuple(idx[bad].T)] = False
            edt = ndimage.distance_transform_edt(m) * H
            fields[ex] = np.maximum(edt - 0.5 * H, 0) * m
        res = {"lo": lo, "dims": dims, "fields": fields, "tree": tree}
        self._cache[ck] = res
        if len(self._cache) > 160:                  # ~15 MB per frame
            self._cache.pop(next(iter(self._cache)))
        return res

    def part(self, fr, p):
        _, k = fr["tree"].query(p)
        return PART.get(self.b["dom"][k], self.b["dom"][k])


def sample_field(fr, ex, pts):
    F = fr["fields"][ex]; lo = fr["lo"]; dims = fr["dims"]
    q = (pts - lo) / H
    i0 = np.floor(q).astype(int); t = q - i0
    out = np.zeros(len(pts))
    okm = np.all((i0 >= 0) & (i0 < dims - 1), 1)
    if not okm.any():
        return out
    i0 = i0[okm]; t = t[okm]; acc = np.zeros(len(i0))
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (t[:, 0] if dx else 1 - t[:, 0]) * (t[:, 1] if dy else 1 - t[:, 1]) * (t[:, 2] if dz else 1 - t[:, 2])
                acc += w * F[i0[:, 0] + dx, i0[:, 1] + dy, i0[:, 2] + dz]
    out[okm] = acc
    return out


def weapon_samples(rig, wn, grip=None):
    W = rig.weapons[wn]
    T = np.array(rig.rest[wn][0])
    grip = grip if grip is not None else (0.09 if wn in ("weapon_shield", "weapon_bow") else 0.07)
    pts = [W["verts"]]
    if wn not in ("weapon_shield", "weapon_bow"):
        L = np.linalg.norm(W["tip"] - T)
        pts.append(T + np.outer(np.arange(0, L, 0.01), W["axis"]))
    pts = np.concatenate(pts)
    return pts[np.linalg.norm(pts - T, axis=1) > grip]


class Checker:
    def __init__(self, rig, base_glb, twohand=False):
        self.rig = rig; self.body = Body(base_glb); self.twohand = twohand
        self.floor = False                        # count weapon samples below y = 0 as hits (--floor; declip per clip)
        self.samples = {wn: weapon_samples(rig, wn) for wn in rig.weapons}
        self.ex = {wn: excluded(wn, rig.weapons[wn]["bone"], twohand) for wn in rig.weapons}
        sh = rig.weapons.get("weapon_shield")
        if sh is not None:
            Rn = fk.q2m(np.asarray(rig.rest["weapon_shield"][1])); Tn = np.asarray(rig.rest["weapon_shield"][0])
            loc = (sh["verts"] - Tn) @ Rn
            self.shield = (Rn, Tn, loc.min(0), loc.max(0))
        else:
            self.shield = None

    def depth_points(self, g, f, key, wn, pts):
        """depth (m) of world points pts for weapon wn at frame f, and which part (body/shield) is deepest"""
        fr = self.body.field(g, f, key, set(self.ex.values()))
        d = sample_field(fr, self.ex[wn], pts)
        who = "body"
        fl = np.maximum(-pts[:, 1], 0) if self.floor else np.zeros(len(pts))    # below the floor (model y = 0)
        if fl.max() > d.max():
            who = "floor"
        d = np.maximum(d, fl)
        if self.shield is not None and wn not in ("weapon_shield", "weapon_bow"):
            Rn, Tn, lo_, hi_ = self.shield; hb = self.rig.weapons["weapon_shield"]["bone"]
            Rs = g[hb][1][f] @ Rn; Ts = g[hb][0][f] + g[hb][1][f] @ Tn
            q = (pts - Ts) @ Rs
            ins = np.all((q > lo_) & (q < hi_), 1)
            if ins.any():
                ds = np.zeros(len(pts)); ds[ins] = np.min(np.minimum(q[ins] - lo_, hi_ - q[ins]), 1)
                if ds.max() > d.max():
                    who = "shield"
                d = np.maximum(d, ds)
        return d, who, fr

    def weapon_pts(self, g, f, wn, R=None):
        hb = self.rig.weapons[wn]["bone"]
        rot = g[hb][1][f] if R is None else R
        return g[hb][0][f] + self.samples[wn] @ rot.T

    def check_clip(self, c, key, weapons=None, tol=0.01):
        g = self.rig.fk(c["bones"]); n = c["n"]
        out = {}
        for wn in (weapons or list(self.rig.weapons)):
            depth = np.zeros(n); part = [""] * n
            for f in range(n):
                pts = self.weapon_pts(g, f, wn)
                d, who, fr = self.depth_points(g, f, key, wn, pts)
                depth[f] = d.max()
                if depth[f] > 0:
                    part[f] = who if who in ("shield", "floor") else self.body.part(fr, pts[int(np.argmax(d))])
            bad = np.where(depth > tol)[0]
            wf = int(np.argmax(depth))
            out[wn] = {"worst_cm": round(float(depth.max()) * 100, 1), "worst_frame": wf, "part": part[wf],
                       "frames_over_tol": int(len(bad)), "bad": bad.tolist(), "parts": sorted(set(part[i] for i in bad)),
                       "depth": depth}
        return out


def _rotvec_to_m(rv):
    rv = np.asarray(rv, float)
    th = np.linalg.norm(rv, axis=-1, keepdims=True)
    k = rv / np.maximum(th, 1e-12)
    K = np.zeros(rv.shape[:-1] + (3, 3))
    K[..., 0, 1], K[..., 0, 2], K[..., 1, 2] = -k[..., 2], k[..., 1], -k[..., 0]
    K[..., 1, 0], K[..., 2, 0], K[..., 2, 1] = k[..., 2], -k[..., 1], k[..., 0]
    s, c = np.sin(th)[..., None], np.cos(th)[..., None]
    return np.eye(3) + s * K + (1 - c) * (K @ K)


def declip(chk, c, key, wn, tol=0.01, loop=False, protect=(), max_deg=50, passes=5, ease=4, max_total_deg=60, floor=False,
           sigma=0.8):
    """turn the weapon hand (world rotation about the wrist) so the weapon leaves the body. protect: frames left untouched.
    floor: also lift weapons out of the floor (off for ground strikes, where the contact is the point). returns (clip, report)."""
    import motion as M
    chk.floor = floor
    rig = chk.rig; hb = rig.weapons[wn]["bone"]
    n = c["n"]
    protect = set(int(x) for x in protect)
    before = chk.check_clip(c, key, [wn], tol)[wn]
    rep = {"before_cm": before["worst_cm"], "before_frames": before["frames_over_tol"], "before_bad": before["bad"],
           "before_parts": before["parts"]}
    if before["frames_over_tol"] == 0:
        rep.update(after_cm=before["worst_cm"], after_frames=0, max_turn_deg=0.0, turned_frames=0, max_push_cm=0.0, pushed_frames=0)
        return c, rep
    base = {b: {k: v.copy() for k, v in c["bones"][b].items()} for b in c["bones"]}
    angles = np.radians([6, 12, 18, 26, 34, 42, max_deg])
    total = np.zeros((n, 3))
    k_ = key
    for it in range(passes):
        g = rig.fk(c["bones"])
        need = np.zeros((n, 3)); anyfix = False
        for f in range(n):
            if f in protect:
                continue
            pts = chk.weapon_pts(g, f, wn)
            d0, _, _ = chk.depth_points(g, f, k_, wn, pts)
            if d0.max() <= tol:
                continue
            anyfix = True
            R = g[hb][1][f]; P = g[hb][0][f]
            ax = R @ rig.weapons[wn]["axis"]
            u = np.cross(ax, [0, 1, 0.0])
            if np.linalg.norm(u) < 1e-3:
                u = np.cross(ax, [1, 0, 0.0])
            u /= np.linalg.norm(u); w = np.cross(ax, u)
            dirs = [np.cos(t) * u + np.sin(t) * w for t in np.linspace(0, 2 * np.pi, 12, endpoint=False)]
            best = None
            for a in angles:
                for dv in dirs:
                    Rr = _rotvec_to_m(dv * a)
                    d, _, _ = chk.depth_points(g, f, k_, wn, P + chk.samples[wn] @ (Rr @ R).T)
                    sc = float(d.max())
                    if best is None or sc < best[0] - 1e-4:
                        best = (sc, dv * a)
                if best[0] <= tol * 0.5:
                    break
            need[f] = best[1]
        if not anyfix:
            break
        add = np.zeros((n, 3))
        for f in np.where(np.linalg.norm(need, axis=1) > 0)[0]:
            for k in range(-ease, ease + 1):
                ff = (f + k) % n if loop else f + k
                if 0 <= ff < n and ff not in protect:
                    cand = need[f] * (0.5 + 0.5 * np.cos(np.pi * k / (ease + 1)))
                    if np.linalg.norm(cand) > np.linalg.norm(add[ff]):
                        add[ff] = cand
        add = ndimage.gaussian_filter1d(add, sigma, axis=0, mode="wrap" if loop else "nearest")
        for f in protect:
            if 0 <= f < n:
                add[f] = 0
        total = total + add
        tn = np.linalg.norm(total, axis=1, keepdims=True)                 # cap the accumulated wrist turn
        total = total * np.minimum(1.0, np.radians(max_total_deg) / np.maximum(tn, 1e-9))
        c["bones"] = {b: {k: v.copy() for k, v in base[b].items()} for b in base}
        g0 = rig.fk(c["bones"])
        M.set_local_from_global(rig, c, g0, hb, _rotvec_to_m(total) @ g0[hb][1])
        # the hand moved: voxel part labels near it change (a fist that sat on the head hid head voxels), so re-skin
        k_ = (key, "turn", it)
        chk.body._cache = {kk: vv for kk, vv in chk.body._cache.items() if kk[0] != (key, "turn", it - 1)}
    rep.update(max_turn_deg=round(float(np.degrees(np.linalg.norm(total, axis=1).max())), 1),
               turned_frames=int((np.linalg.norm(total, axis=1) > np.radians(1)).sum()))
    # second stage: where turning the wrist was not enough, move the hand out of the body with arm IK (weapon direction kept)
    after = chk.check_clip(c, k_, [wn], tol)[wn]
    pushed = np.zeros(n)
    for it in range(6 if after["frames_over_tol"] else 0):
        g = rig.fk(c["bones"])
        offs = np.zeros((n, 3)); soffs = np.zeros((n, 3))     # blade hand / shield hand offsets
        for f in after["bad"]:
            if f in protect:
                continue
            pts = chk.weapon_pts(g, f, wn)
            d, who, fr = chk.depth_points(g, f, k_, wn, pts)
            k = int(np.argmax(d))
            if who == "shield":
                # blade inside the own shield: the blade leaves through the nearest box face, the shield yields the other way
                Rn, Tn, lo_, hi_ = chk.shield; sb = rig.weapons["weapon_shield"]["bone"]
                Rs = g[sb][1][f] @ Rn; Ts = g[sb][0][f] + g[sb][1][f] @ Tn
                q = (pts - Ts) @ Rs
                ins = np.all((q > lo_) & (q < hi_), 1)
                qd = np.minimum(q - lo_, hi_ - q); qd[~ins] = 0
                k = int(np.argmax(qd.min(1)))
                gap = np.r_[q[k] - lo_, hi_ - q[k]]                     # distances to -X,-Y,-Z,+X,+Y,+Z faces
                face = int(np.argmin(gap)); e = np.zeros(3); e[face % 3] = 1.0 if face >= 3 else -1.0
                out_dir = Rs @ e
                half = 0.5 * float(gap[face]) + 0.006
                offs[f] = out_dir * half; soffs[f] = -out_dir * half
                continue
            elif who == "floor":
                out_dir = np.array([0, 1.0, 0])
            else:
                e = np.eye(3) * 0.01
                grad = np.array([sample_field(fr, chk.ex[wn], pts[k:k + 1] + e[i])[0] - sample_field(fr, chk.ex[wn], pts[k:k + 1] - e[i])[0]
                                 for i in range(3)])
                out_dir = -grad / max(np.linalg.norm(grad), 1e-9)
            offs[f] = out_dir * (d[k] + 0.008)
        add = np.zeros((n, 3))
        for f in np.where(np.linalg.norm(offs, axis=1) > 0)[0]:
            for kk in range(-ease, ease + 1):
                ff = (f + kk) % n if loop else f + kk
                if 0 <= ff < n and ff not in protect:
                    cand = offs[f] * (0.5 + 0.5 * np.cos(np.pi * kk / (ease + 1)))
                    if np.linalg.norm(cand) > np.linalg.norm(add[ff]):
                        add[ff] = cand
        add = ndimage.gaussian_filter1d(add, sigma, axis=0, mode="wrap" if loop else "nearest")
        for f in protect:
            if 0 <= f < n:
                add[f] = 0
        side = hb[:-4]
        c, _ = M.two_bone_ik(rig, c, side, g[hb][0] + add, None, g[hb][1])
        if np.abs(soffs).max() > 0:
            sadd = np.zeros((n, 3))
            for f in np.where(np.linalg.norm(soffs, axis=1) > 0)[0]:
                for kk in range(-ease, ease + 1):
                    ff = (f + kk) % n if loop else f + kk
                    if 0 <= ff < n and ff not in protect:
                        cand = soffs[f] * (0.5 + 0.5 * np.cos(np.pi * kk / (ease + 1)))
                        if np.linalg.norm(cand) > np.linalg.norm(sadd[ff]):
                            sadd[ff] = cand
            sadd = ndimage.gaussian_filter1d(sadd, sigma, axis=0, mode="wrap" if loop else "nearest")
            sb = rig.weapons["weapon_shield"]["bone"]; g2 = rig.fk(c["bones"])
            c, _ = M.two_bone_ik(rig, c, sb[:-4], g2[sb][0] + sadd, None, g2[sb][1])
        pushed += np.linalg.norm(add, axis=1)
        k_ = (key, "push", it)                      # the arm moved: the skinned body (upper arm) changed, new field cache
        after = chk.check_clip(c, k_, [wn], tol)[wn]
        if not after["frames_over_tol"]:
            break
    rep.update(after_cm=after["worst_cm"], after_frames=after["frames_over_tol"], after_bad=after["bad"],
               max_push_cm=round(float(pushed.max()) * 100, 1), pushed_frames=int((pushed > 0.005).sum()))
    chk.floor = False
    return c, rep


def check(glb, names=None, tol=0.01, twohand=False, base=None, floor=False):
    rig = fk.Rig(glb)
    _, clips = G.read_clips(glb)
    stem = os.path.splitext(os.path.basename(glb))[0]
    src = base or os.path.join(os.path.dirname(glb), "raw", stem + "_handkeyed.glb")
    src = src if os.path.exists(src) else glb
    chk = Checker(rig, src, twohand)
    chk.floor = floor
    res = {}
    for cn, c in clips.items():
        if names and cn not in names:
            continue
        r = chk.check_clip(c, cn, None, tol)
        for x in r.values():
            x["depth_cm"] = [round(float(v) * 100, 1) for v in x.pop("depth")]
        res[cn] = r
    return res


if __name__ == "__main__":
    a = sys.argv[1:]
    glb = a[0]
    names = a[1].split(",") if len(a) > 1 and not a[1].startswith("--") and a[1] else None
    tol = float(a[a.index("--tol") + 1]) if "--tol" in a else 0.01
    r = check(glb, names, tol, "--twohand" in a, base=a[a.index("--base") + 1] if "--base" in a else None, floor="--floor" in a)
    for cn, v in r.items():
        for wn, x in v.items():
            print(f"{cn:12s} {wn:15s} worst={x['worst_cm']:5.1f}cm @{x['worst_frame']:3d} {x['part']:6s} n>{tol*100:.0f}cm={x['frames_over_tol']:3d} {x['parts']} {x['bad'][:30]}")
    if "--json" in a:
        json.dump(r, open(a[a.index("--json") + 1], "w"), indent=1)
