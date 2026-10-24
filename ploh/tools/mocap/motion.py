"""Clip operations on glTF skeletal clips (numpy). Clip = {"n": frames, "bones": {name: {"T":(n,3),"R":(n,4) xyzw,"S":(n,3)}}}
Coordinates are glTF (Y up, +Z forward, +X = character's left), metres at model scale."""
import copy
import numpy as np
import gltfio as G
import fk


def load(paths, scale=0.01):
    out = {}
    for p in paths:
        _, c = G.read_clips(p)
        for k, v in c.items():
            for b in v["bones"].values():
                b["T"] = b["T"] * scale
            if "|" in k:                      # single-action downloads are named "Armature|<Name>|baselayer"
                k = k.split("|")[1]
            out[k] = v
    return out


def nframes(c):
    return next(iter(c["bones"].values()))["R"].shape[0]


def sub(c, a, b):
    """frames a..b inclusive (b may be -1 for last)"""
    n = nframes(c)
    b = n - 1 if b is None or b < 0 else b
    return {"n": b - a + 1, "bones": {k: {kk: vv[a:b + 1].copy() for kk, vv in v.items()} for k, v in c["bones"].items()}}


def concat(c1, c2):
    """append c2 after c1 (c2's first frame replaces nothing: frames are appended, caller handles overlap)"""
    return {"n": nframes(c1) + nframes(c2), "bones": {k: {kk: np.concatenate([c1["bones"][k][kk], c2["bones"][k][kk]]) for kk in v}
                                                     for k, v in c1["bones"].items()}}


def frame_pose(c, f):
    return {k: {kk: vv[f].copy() for kk, vv in v.items()} for k, v in c["bones"].items()}


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def qfix(R):
    """make quaternion track sign-continuous"""
    R = R.copy()
    for i in range(1, len(R)):
        if np.dot(R[i], R[i - 1]) < 0:
            R[i] = -R[i]
    return R


def blend_pose(c, pose, k, at="start", bones=None, hips_y=True):
    """ease the first/last k frames toward a static pose (pose at the clip edge, fading to the clip over k frames)."""
    n = nframes(c)
    k = min(k, n - 1)
    for b, v in c["bones"].items():
        if bones is not None and b not in bones:
            continue
        for i in range(k + 1):
            f = i if at == "start" else n - 1 - i
            w = 1.0 - smooth(i / k)          # 1 at the edge, 0 at k frames in
            v["R"][f] = G.slerp(v["R"][f:f + 1], pose[b]["R"][None], w)[0]
            if b == "Hips" and hips_y:
                v["T"][f, 1] = (1 - w) * v["T"][f, 1] + w * pose[b]["T"][1]
    return c


def loop_fix(c, k):
    """distribute the end->start mismatch over the last k frames so frame n-1 == frame 0 (seamless loop)."""
    n = nframes(c)
    k = min(k, n - 1)
    for b, v in c["bones"].items():
        R = qfix(v["R"])
        d = fk.qmul(R[0], fk.qinv(R[-1]))      # delta that maps last -> first (global-ish, left multiply)
        for i in range(n - k, n):
            w = smooth((i - (n - k - 1)) / k)
            dq = G.slerp(np.array([[0, 0, 0, 1.0]]), d[None], w)[0]
            R[i] = fk.qmul(dq, R[i])
        v["R"] = R
        if b == "Hips":
            T = v["T"]
            dT = T[0] - T[-1]
            for i in range(n - k, n):
                w = smooth((i - (n - k - 1)) / k)
                T[i] = T[i] + dT * w
    return c


def strip_root(rig, c, mode="full"):
    """remove horizontal Hips motion. returns removed offsets (n,2) [x,z] relative to frame 0.
    full: Hips X/Z pinned to rest X/Z. loop: keep the sway around the mean, remove mean + linear drift."""
    T = c["bones"]["Hips"]["T"]
    rest = rig.rest["Hips"][0]
    d = T[:, [0, 2]] - rest[[0, 2]]
    n = len(d)
    if mode == "loop":
        t = np.arange(n) / max(n - 1, 1)
        line = d[0] + (d[-1] - d[0]) * t[:, None]
        res = d - line
        res = res - res.mean(0)
        removed = d - res
    else:
        removed = d.copy()
        res = np.zeros_like(d)
    T[:, 0] = rest[0] + res[:, 0]
    T[:, 2] = rest[2] + res[:, 1]
    return removed - removed[0]


def rotate_yaw(c, deg):
    """rotate the whole clip about the vertical axis (Hips is the root joint)."""
    a = np.radians(deg)
    q = np.array([0, np.sin(a / 2), 0, np.cos(a / 2)])
    h = c["bones"]["Hips"]
    h["R"] = fk.qmul(np.repeat(q[None], len(h["R"]), 0), h["R"])
    ca, sa = np.cos(a), np.sin(a)
    x, z = h["T"][:, 0].copy(), h["T"][:, 2].copy()
    h["T"][:, 0] = ca * x + sa * z
    h["T"][:, 2] = -sa * x + ca * z
    return c


def resample(c, factor):
    """time-scale a clip: factor>1 slows (more frames)."""
    n = nframes(c)
    m = int(round((n - 1) * factor)) + 1
    tq = np.linspace(0, n - 1, m)
    t = np.arange(n, dtype=float)
    out = {"n": m, "bones": {}}
    for b, v in c["bones"].items():
        out["bones"][b] = {"T": G.sample(t, v["T"], "LINEAR", tq), "R": G.sample(t, qfix(v["R"]), "LINEAR", tq, rot=True),
                           "S": G.sample(t, v["S"], "LINEAR", tq)}
    return out


# ------------------------------------------------------------------ global <-> local
def globals_(rig, c):
    return rig.fk(c["bones"])


def set_local_from_global(rig, c, g, bone, Rg_new, frames=None):
    """set bone local rotation so that its global rotation becomes Rg_new (n,3,3), given parents' globals in g."""
    p = rig.parent[bone]
    Pr = g[p][1]
    L = np.einsum("nji,njk->nik", Pr, Rg_new)
    q = fk.m2q(L)
    if frames is None:
        c["bones"][bone]["R"] = q
    else:
        c["bones"][bone]["R"][frames] = q[frames]


def rot_between(a, b):
    """minimal rotation matrices (n,3,3) taking unit vectors a->b"""
    a = a / np.linalg.norm(a, axis=-1, keepdims=True)
    b = b / np.linalg.norm(b, axis=-1, keepdims=True)
    v = np.cross(a, b)
    cth = np.sum(a * b, -1)
    out = np.empty(a.shape[:-1] + (3, 3))
    for i in range(len(a)):
        vx = np.array([[0, -v[i, 2], v[i, 1]], [v[i, 2], 0, -v[i, 0]], [-v[i, 1], v[i, 0], 0]])
        if cth[i] < -0.9999:
            ax = np.cross(a[i], [1, 0, 0])
            if np.linalg.norm(ax) < 1e-6: ax = np.cross(a[i], [0, 1, 0])
            ax /= np.linalg.norm(ax)
            out[i] = 2 * np.outer(ax, ax) - np.eye(3)
        else:
            out[i] = np.eye(3) + vx + vx @ vx / (1 + cth[i])
    return out


def two_bone_ik(rig, c, side, target, weight=None, hand_rot=None):
    """move <side>Arm/<side>ForeArm so the <side>Hand head reaches target (n,3); keep the original elbow plane.
    hand_rot: optional desired global hand rotation (n,3,3). weight: (n,) blend 0..1."""
    up, lo, hd = side + "Arm", side + "ForeArm", side + "Hand"
    n = nframes(c)
    w = np.ones(n) if weight is None else weight
    g = globals_(rig, c)
    S, E, Wp = g[up][0], g[lo][0], g[hd][0]
    a = np.linalg.norm(E - S, axis=1); b = np.linalg.norm(Wp - E, axis=1)
    tgt = Wp + (target - Wp) * w[:, None]
    d = tgt - S
    L = np.linalg.norm(d, axis=1)
    Lc = np.clip(L, np.abs(a - b) + 1e-4, (a + b) * 0.999)
    dn = d / L[:, None]
    tgt_c = S + dn * Lc[:, None]
    # elbow plane: original elbow offset from the shoulder->target line
    pole = E - S
    pole = pole - dn * np.sum(pole * dn, 1)[:, None]
    pn = np.linalg.norm(pole, axis=1)
    bad = pn < 1e-5
    pole[bad] = np.cross(dn[bad], [0, 1, 0])
    pole = pole / np.linalg.norm(pole, axis=1)[:, None]
    cosA = np.clip((a * a + Lc * Lc - b * b) / (2 * a * Lc), -1, 1)
    sinA = np.sqrt(1 - cosA ** 2)
    E2 = S + (dn * cosA[:, None] + pole * sinA[:, None]) * a[:, None]
    # upper arm
    R_up = rot_between(E - S, E2 - S) @ g[up][1]
    set_local_from_global(rig, c, g, up, R_up)
    g = globals_(rig, c)
    R_lo = rot_between(g[hd][0] - g[lo][0], tgt_c - g[lo][0]) @ g[lo][1]
    set_local_from_global(rig, c, g, lo, R_lo)
    g = globals_(rig, c)
    if hand_rot is not None:
        # blend hand global rotation
        cur = fk.m2q(g[hd][1]); des = fk.m2q(hand_rot)
        q = G.slerp(cur, des, w)
        set_local_from_global(rig, c, g, hd, fk.q2m(q))
    return c, np.linalg.norm(target - tgt_c, axis=1)


# ------------------------------------------------------------------ retarget between rigs (preview only)
def retarget(src_rig, dst_rig, c):
    """world-space rest-relative retarget: G_dst = (G_src * G_src_rest^-1) * G_dst_rest. Hips translation scaled by hip height."""
    sb = {b: {"T": src_rig.rest[b][0][None], "R": src_rig.rest[b][1][None], "S": src_rig.rest[b][2][None]} for b in src_rig.joints}
    db = {b: {"T": dst_rig.rest[b][0][None], "R": dst_rig.rest[b][1][None], "S": dst_rig.rest[b][2][None]} for b in dst_rig.joints}
    gs_r, gd_r = src_rig.fk(sb), dst_rig.fk(db)
    gs = src_rig.fk(c["bones"])
    n = nframes(c)
    out = {"n": n, "bones": {}}
    Gd = {}
    k = dst_rig.rest["Hips"][0][1] / src_rig.rest["Hips"][0][1]
    for b in dst_rig.order:
        Rg = gs[b][1] @ gs_r[b][1][0].T @ gd_r[b][1][0]
        p = dst_rig.parent.get(b)
        if p in Gd:
            Lr = np.einsum("nji,njk->nik", Gd[p], Rg)
        else:
            Lr = Rg
        Gd[b] = Rg
        T = np.repeat(dst_rig.rest[b][0][None], n, 0)
        if b == "Hips":
            T = c["bones"]["Hips"]["T"] * k
        out["bones"][b] = {"T": T, "R": fk.m2q(Lr), "S": np.ones((n, 3))}
    return out


def cut(c, ranges):
    """remove frame ranges [(c0, c1), ...] (c0..c1-1 removed). Hips X/Z after a cut is shifted to stay continuous.
    Use on near-static holds so the splice is invisible."""
    for c0, c1 in sorted(ranges, reverse=True):
        a = sub(c, 0, c0 - 1); b = sub(c, c1, -1)
        T = b["bones"]["Hips"]["T"]
        d = T[0, [0, 2]] - a["bones"]["Hips"]["T"][-1, [0, 2]]
        T[:, 0] -= d[0]; T[:, 2] -= d[1]
        c = concat(a, b)
    return c


def tail(c, pose, k):
    """append k frames easing from the last frame into a static pose (a short recovery into idle)."""
    last = frame_pose(c, nframes(c) - 1)
    add = {"n": k, "bones": {}}
    w = smooth(np.arange(1, k + 1) / k)
    for b, v in c["bones"].items():
        R = G.slerp(np.repeat(last[b]["R"][None], k, 0), np.repeat(pose[b]["R"][None], k, 0), w)
        T = last[b]["T"][None] * (1 - w[:, None]) + pose[b]["T"][None] * w[:, None]
        if b == "Hips":   # keep horizontal position (already stripped), ease height only
            T[:, 0] = last[b]["T"][0]; T[:, 2] = last[b]["T"][2]
        add["bones"][b] = {"T": T, "R": R, "S": np.ones((k, 3))}
    return concat(c, add)


def bones_from_pose(c, pose, bones, w=1.0):
    """replace (w=1) or blend the local rotations of the given bones with a static pose (e.g. keep the weapon arm in guard)."""
    for b in bones:
        R = c["bones"][b]["R"]
        c["bones"][b]["R"] = G.slerp(R, np.repeat(pose[b]["R"][None], len(R), 0), w)
    return c


def chain_ik(rig, c, up, lo, end, target, w, keep_end_rot=True):
    """two-bone IK on an arbitrary chain (up -> lo -> end head reaches target), elbow/knee stays in its current plane.
    w: (n,) weights; frames with w == 0 are left untouched."""
    n = nframes(c)
    g = globals_(rig, c)
    S, E, Wp = g[up][0], g[lo][0], g[end][0]
    R_end0 = g[end][1].copy()
    a = np.linalg.norm(E - S, axis=1); b = np.linalg.norm(Wp - E, axis=1)
    tgt = Wp + (target - Wp) * w[:, None]
    d = tgt - S; L = np.linalg.norm(d, axis=1)
    Lc = np.clip(L, np.abs(a - b) + 1e-4, (a + b) * 0.999)
    dn = d / L[:, None]
    tgt_c = S + dn * Lc[:, None]
    pole = E - S
    pole = pole - dn * np.sum(pole * dn, 1)[:, None]
    pole = pole / np.maximum(np.linalg.norm(pole, axis=1), 1e-9)[:, None]
    cosA = np.clip((a * a + Lc * Lc - b * b) / (2 * a * Lc), -1, 1); sinA = np.sqrt(1 - cosA ** 2)
    E2 = S + (dn * cosA[:, None] + pole * sinA[:, None]) * a[:, None]
    m = w > 0
    R_up = rot_between(E - S, E2 - S) @ g[up][1]
    old = {k: c["bones"][k]["R"].copy() for k in (up, lo, end)}
    set_local_from_global(rig, c, g, up, R_up)
    g = globals_(rig, c)
    set_local_from_global(rig, c, g, lo, rot_between(g[end][0] - g[lo][0], tgt_c - g[lo][0]) @ g[lo][1])
    if keep_end_rot:
        g = globals_(rig, c)
        set_local_from_global(rig, c, g, end, R_end0)
    for k in (up, lo, end):                       # untouched frames keep their exact rotations
        c["bones"][k]["R"][~m] = old[k][~m]
    return c


def step_feet(rig, c, f0, f1, lift=0.07, min_travel=0.04, root=None):
    """turn a foot slide inside the blend window f0..f1 into a small step: the ankle follows its blended horizontal path
    but is lifted on a sine arc (scaled by the travel), never below the lower of its window-end heights.
    root: optional (n,2) stripped X/Z (glTF) so travel is measured as the game will show it."""
    n = nframes(c)
    f0, f1 = max(0, f0), min(n - 1, f1)
    if f1 - f0 < 2:
        return c
    off = np.zeros((n, 3))
    if root is not None:
        off[:, 0] = root[:, 0]; off[:, 2] = root[:, 1]
    g = globals_(rig, c)
    for side in ("Left", "Right"):
        P = g[side + "Foot"][0]
        Pw = P + off
        travel = np.linalg.norm(Pw[f1, [0, 2]] - Pw[f0, [0, 2]])
        if travel < min_travel:
            continue
        fr = np.arange(f0, f1 + 1)
        u = (fr - f0) / (f1 - f0)
        tgt = P.copy()
        floor = min(P[f0, 1], P[f1, 1])
        tgt[fr, 1] = np.maximum(P[fr, 1], floor) + lift * min(1.0, travel / 0.15) * np.sin(np.pi * u)
        w = np.zeros(n); w[fr] = 1.0
        c = chain_ik(rig, c, side + "UpLeg", side + "Leg", side + "Foot", tgt, w)
    return c


def mirror(rig, c):
    """left/right mirror of a clip (glTF X is the character's left/right axis). Works on world-space deltas from each
    bone's rest so slightly asymmetric rests are handled: G'(mb) = Mx (G(b) G_rest(b)^-1) Mx G_rest(mb)."""
    n = nframes(c)
    Mx = np.diag([-1.0, 1, 1])
    sw = lambda b: ("Right" + b[4:]) if b.startswith("Left") else (("Left" + b[5:]) if b.startswith("Right") else b)
    rb = {b: {"T": rig.rest[b][0][None], "R": rig.rest[b][1][None], "S": rig.rest[b][2][None]} for b in rig.joints}
    gr = rig.fk(rb); g = rig.fk(c["bones"])
    Gn = {}
    out = {"n": n, "bones": {}}
    for b in rig.order:
        src = sw(b)
        D = g[src][1] @ gr[src][1][0].T
        Gb = np.einsum("ij,njk,kl->nil", Mx, D, Mx) @ gr[b][1][0]
        p = rig.parent.get(b)
        L = np.einsum("nji,njk->nik", Gn[p], Gb) if p in Gn else Gb
        Gn[b] = Gb
        T = np.repeat(rig.rest[b][0][None], n, 0)
        if b == "Hips":
            T = c["bones"]["Hips"]["T"].copy(); T[:, 0] = 2 * rig.rest["Hips"][0][0] - T[:, 0]
        out["bones"][b] = {"T": T, "R": fk.m2q(L), "S": np.ones((n, 3))}
    return out


# ------------------------------------------------------------------ weapon / prop orientation overrides (parry, thrust, shield)
def ramp(n, a, b, c, d):
    """weights (n,): 0 before a, smooth 0->1 over a..b, 1 over b..c, 1->0 over c..d, 0 after d (frames; d may exceed n)."""
    f = np.arange(n, dtype=float)
    up = smooth((f - a) / max(b - a, 1e-6)) if b > a else (f >= a).astype(float)
    dn = 1.0 - smooth((f - c) / max(d - c, 1e-6)) if d > c else (f <= c).astype(float)
    return np.minimum(up, dn)


def rest_globals(rig):
    rb = {b: {"T": rig.rest[b][0][None], "R": rig.rest[b][1][None], "S": rig.rest[b][2][None]} for b in rig.joints}
    return rig.fk(rb)


def _frame_dirs(rig, g, v, frame):
    """direction(s) given in the character frame ('char', glTF axes) or the chest frame ('chest': the Spine bone's rotation
    relative to its rest, so at rest both frames agree)."""
    v = np.asarray(v, float)
    if frame == "chest":
        Rr = rest_globals(rig)["Spine"][1][0]
        return np.einsum("nij,j->ni", g["Spine"][1] @ Rr.T[None], v)
    return np.broadcast_to(v, (len(g["Hips"][0]), 3)).copy()


def weapon_axis(rig, pose_or_clip, wname):
    """world weapon axis (n,3) of a clip, or (3,) of a single pose dict"""
    c = pose_or_clip if "bones" in pose_or_clip else {"n": 1, "bones": {b: {k: np.asarray(v[k])[None] for k in v} for b, v in pose_or_clip.items()}}
    W = rig.weapons[wname]; g = globals_(rig, c)
    ax = np.einsum("nij,j->ni", g[W["bone"]][1], W["axis"])
    return ax if "bones" in pose_or_clip else ax[0]


def aim_weapon(rig, c, wname, direction, w, base=None, frame="char"):
    """rotate the weapon's hand (minimal rotation) so the weapon axis (grip -> tip) points along direction (character frame,
    (3,) or (n,3)). Without base, w (n,) blends between the mocap hand and the aimed hand. With base (a direction, e.g. the
    idle guard's weapon axis) the target direction itself travels base -> direction -> base by w and is applied fully on
    every frame, so the wrist of the source clip never swings the weapon (used to turn a straight punch into a thrust)."""
    W = rig.weapons[wname]; hb = W["bone"]
    g = globals_(rig, c)
    R = g[hb][1]
    ax = np.einsum("nij,j->ni", R, W["axis"])
    d = _frame_dirs(rig, g, direction, frame) if frame != "char" else np.broadcast_to(np.asarray(direction, float), ax.shape).copy()
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    if base is not None:
        b = np.asarray(base, float) / np.linalg.norm(base)
        dq = fk.m2q(rot_between(np.repeat(b[None], len(d), 0), d))
        d = np.einsum("nij,j->ni", fk.q2m(G.slerp(np.tile([0, 0, 0, 1.0], (len(d), 1)), dq, w)), b)
        w = np.ones(len(d))
    Q = rot_between(ax, d) @ R
    q = G.slerp(fk.m2q(R), fk.m2q(Q), w)
    set_local_from_global(rig, c, g, hb, fk.q2m(q))
    return c


def warp(c, pts):
    """piecewise-linear retime: pts = [(source frame, output frame), ...] increasing; output length = last output frame + 1."""
    src = np.array([p[0] for p in pts], float); dst = np.array([p[1] for p in pts], float)
    m = int(dst[-1]) + 1
    tq = np.interp(np.arange(m), dst, src)
    t = np.arange(nframes(c), dtype=float)
    return {"n": m, "bones": {b: {"T": G.sample(t, v["T"], "LINEAR", tq), "R": G.sample(t, qfix(v["R"]), "LINEAR", tq, rot=True),
                                  "S": G.sample(t, v["S"], "LINEAR", tq)} for b, v in c["bones"].items()}}


def reach(rig, c, side, add, w, direction=(0, 0, 1.0)):
    """push the hand further along direction (character frame) by add*w metres with two-bone IK (hand rotation kept)."""
    g = globals_(rig, c)
    hd = side + "Hand"
    tgt = g[hd][0] + np.asarray(direction, float)[None] * (add * w)[:, None]
    return two_bone_ik(rig, c, side, tgt, None, g[hd][1])[0]


def orient_prop(rig, c, wname, face_local, up_local, face, up, w, frame="char"):
    """set the full orientation of a hand prop (shield): prop-local face normal -> face, prop-local up -> up (projected),
    blended by w. face_local/up_local are in the prop node's local axes (glTF); face/up in the character or chest frame."""
    W = rig.weapons[wname]; hb = W["bone"]
    Rn = fk.q2m(np.asarray(rig.rest[wname][1]))               # node rotation in the hand bone
    fh = Rn @ np.asarray(face_local, float); uh = Rn @ np.asarray(up_local, float)
    g = globals_(rig, c)
    R = g[hb][1]; n = len(R)
    F = _frame_dirs(rig, g, face, frame); U = _frame_dirs(rig, g, up, frame)
    F /= np.linalg.norm(F, axis=1, keepdims=True)
    U = U - F * np.sum(U * F, 1)[:, None]; U /= np.linalg.norm(U, axis=1, keepdims=True)
    # hand basis in hand space (fh, uh', fh x uh') -> world basis (F, U, F x U)
    uh2 = uh - fh * fh.dot(uh); uh2 /= np.linalg.norm(uh2); fh2 = fh / np.linalg.norm(fh)
    Bh = np.stack([fh2, uh2, np.cross(fh2, uh2)], 1)
    Bw = np.stack([F, U, np.cross(F, U)], 2)
    Q = Bw @ Bh.T[None]
    q = G.slerp(fk.m2q(R), fk.m2q(Q), w)
    set_local_from_global(rig, c, g, hb, fk.q2m(q))
    return c


def hold_first(c, k):
    """prepend k copies of the first frame (a held pose that a start blend can ease into)."""
    if k <= 0:
        return c
    return concat({"n": k, "bones": {b: {kk: np.repeat(v[kk][:1], k, 0) for kk in v} for b, v in c["bones"].items()}}, c)


def seq(lib, parts, xfade=0):
    """concatenate clip segments [(src, a, b), ...]; the Hips X/Z of each segment is shifted to continue the previous one.
    xfade > 0: the first xfade frames of each later segment are eased from the previous segment's last pose (segments from
    different takes that do not meet)."""
    out = None
    for src, a, b in parts:
        s = sub(lib[src], a, b)
        if out is not None:
            T = s["bones"]["Hips"]["T"]
            d = T[0, [0, 2]] - out["bones"]["Hips"]["T"][-1, [0, 2]]
            T[:, 0] -= d[0]; T[:, 2] -= d[1]
            s = sub(s, 1, -1) if np.allclose(frame_pose(s, 0)["Hips"]["R"], out["bones"]["Hips"]["R"][-1], atol=1e-4) else s
            if xfade:
                blend_pose(s, frame_pose(out, nframes(out) - 1), xfade, "start")
        out = s if out is None else concat(out, s)
    return out


def sidestep(rig, pose, side, dist=0.5, n=14, lift=0.06, dip=0.035, lean=9.0):
    """procedural lateral dash from a static pose (idle frame 0): the lead foot (on the travel side) steps out, the hips glide,
    the trail foot follows; hips dip and the chest leans into the travel, then everything settles back into the pose.
    side: +1 = character's left (+X), -1 = right. Returns a clip whose Hips X carries the travel (stripped later into root json)."""
    c = {"n": n, "bones": {b: {k: np.repeat(np.asarray(v[k])[None], n, 0).astype(float) for k in ("T", "R", "S")}
                           for b, v in pose.items()}}
    u = np.arange(n) / (n - 1)
    sm = lambda x: smooth(np.clip(x, 0, 1))
    lead, trail = ("Left", "Right") if side > 0 else ("Right", "Left")
    steps = {lead: (0.02, 0.44), trail: (0.30, 0.80)}
    kf = {ft: sm((u - a) / (b - a)) for ft, (a, b) in steps.items()}
    hx = dist * (0.55 * kf[lead] + 0.45 * kf[trail])      # hips ride between the feet, a little toward the lead foot
    H = c["bones"]["Hips"]["T"]
    H[:, 0] += side * hx
    H[:, 1] -= dip * np.sin(np.pi * np.clip(u / 0.92, 0, 1)) ** 1.5
    # lean the chest into the travel (roll about the forward axis), peaking early (push-off), gone by the end
    lw = np.sin(np.pi * np.clip(u / 0.85, 0, 1)) * np.exp(-1.2 * u)
    lw /= lw.max()
    g = globals_(rig, c)
    for bn, k in (("Spine02", 0.35), ("Spine01", 0.35), ("Spine", 0.3)):
        a = np.radians(-side * lean * k) * lw
        Rr = np.stack([np.array([[np.cos(t), -np.sin(t), 0], [np.sin(t), np.cos(t), 0], [0, 0, 1]]) for t in a])  # about +Z (forward)
        g = globals_(rig, c)
        set_local_from_global(rig, c, g, bn, Rr @ g[bn][1])
    # feet: planted in the world, lead foot first then trail foot, each lifted on an arc
    g0 = globals_(rig, {"n": 1, "bones": {b: {k: v[k][:1] for k in v} for b, v in c["bones"].items()}})
    for ft in (lead, trail):
        u0, u1 = steps[ft]
        P0 = np.repeat(g0[ft + "Foot"][0], n, 0)
        k = kf[ft]
        tgt = P0.copy()
        tgt[:, 0] += side * dist * k
        tgt[:, 1] += lift * np.sin(np.pi * np.clip((u - u0) / (u1 - u0), 0, 1))
        c = chain_ik(rig, c, ft + "UpLeg", ft + "Leg", ft + "Foot", tgt, np.ones(n))
    return c


# ------------------------------------------------------------------ foot plants for clips that travel (stumble, get-up)
def plant_segments(rig, c, root=None, h_tol=0.03, v_tol=0.4, min_len=3, gap=2):
    """frames where each foot is planted: low (min of ankle/toe height within h_tol of that foot's lowest point in the clip)
    and slow (ankle or toe horizontal speed under v_tol m/s, so a heel/toe roll still counts), with the stripped root
    re-applied. Gaps up to `gap` frames are closed, segments shorter than min_len dropped. returns {side: [(a, b), ...]}"""
    n = nframes(c)
    off = np.zeros((n, 3))
    if root is not None:
        off[:, 0] = root[:, 0]; off[:, 2] = root[:, 1]
    g = globals_(rig, c)
    out = {}
    for s in ("Left", "Right"):
        ank = g[s + "Foot"][0] + off; toe = g[s + "ToeBase"][0] + off
        y = np.minimum(ank[:, 1], toe[:, 1])
        sp = lambda P: np.r_[0, np.linalg.norm(np.diff(P[:, [0, 2]], axis=0), axis=1)] * 30
        pl = (y < y.min() + h_tol) & (np.minimum(sp(ank), sp(toe)) < v_tol)
        seg, f = [], 0
        while f < n:
            if pl[f]:
                e = f
                while e + 1 < n and pl[e + 1]:
                    e += 1
                seg.append([f, e]); f = e + 1
            else:
                f += 1
        merged = []
        for a, b in seg:
            if merged and a - merged[-1][1] - 1 <= gap:
                merged[-1][1] = b
            else:
                merged.append([a, b])
        out[s] = [tuple(x) for x in merged if x[1] - x[0] + 1 >= min_len]
    return out


def replant(rig, c, root, segs, start_pose=None, end_pose=None, min_lift=0.04, win=(0, 0), far=0.06):
    """re-plant the feet of a travelling clip so every plant is a fixed spot on the ground (no slip) and the first/last
    plants land exactly on the stance of the poses it blends from/into (so no extra shuffle is needed at the blends).
    segs: plant_segments() of the clip before the edge blends (same frame numbering; frames appended later by tail()
    extend the last plant). root: (n,2) stripped X/Z. A plant that starts on frame 0 is moved to start_pose's foot, one
    that reaches the source end goes to end_pose's foot (plus the root travel); the others stay where the mocap put them
    (mean position, mid-plant foot rotation). win = (blend-in, blend-out) frames: a first/last plant that reaches beyond
    its blend window and whose blend pose spot is more than `far` from the mocap spot keeps the mocap spot and the foot steps
    onto/off the blend pose's spot inside the window instead (a long crouch-to-stand plant cannot hold the idle stance spot).
    Between plants the foot follows its mocap swing, offset smoothly from the
    old to the new end points, lifted at least min_lift (sine arc). Before the first plant (if it does not start on frame
    0) the foot keeps the clip's own path, eased into the first plant. Legs: two-bone IK, then the foot's global rotation.
    returns (clip, max IK miss in metres per side, {side: [(first, last) frame of each locked plant]})"""
    n = nframes(c)
    root = np.asarray(root, float)
    if len(root) < n:
        root = np.concatenate([root, np.repeat(root[-1:], n - len(root), 0)])
    off = np.zeros((n, 3)); off[:, 0] = root[:n, 0]; off[:, 2] = root[:n, 1]

    def pose_g(p):
        return globals_(rig, {"n": 1, "bones": {b: {k: np.asarray(v[k])[None] for k in ("T", "R", "S")} for b, v in p.items()}})
    gs = pose_g(start_pose) if start_pose is not None else None
    ge = pose_g(end_pose) if end_pose is not None else None
    g = globals_(rig, c)
    miss, locked = {}, {}
    for s in ("Left", "Right"):
        P = g[s + "Foot"][0] + off                       # world ankle path of the clip as it is now
        Rq = fk.m2q(g[s + "Foot"][1])
        sg = [list(x) for x in segs.get(s, [])]
        if not sg:
            continue
        n_src = max(b for _, b in sg) + 1
        tgt = P.copy(); rq = Rq.copy()
        keys = []                                          # (a, b, world pos, rot quat)
        pre, post = [], []
        for k, (a, b) in enumerate(sg):
            mid = (a + b) // 2
            pos = P[a:b + 1].mean(0); rot = Rq[mid]
            if k == 0 and a == 0 and gs is not None:
                ps, rs = gs[s + "Foot"][0][0].copy(), fk.m2q(gs[s + "Foot"][1])[0]
                if b > win[0] + 2 and np.linalg.norm((ps - pos)[[0, 2]]) > far:
                    pre = [[0, 0, ps, rs]]; a = max(win[0], 1)      # step off the start stance inside the blend-in
                else:
                    pos, rot = ps, rs
            if k == len(sg) - 1 and ge is not None:
                if b < n - 1 and b >= n_src - 1:
                    b = n - 1                              # tail frames: keep standing on it
                if b == n - 1:
                    pe, re_ = ge[s + "Foot"][0][0] + off[n - 1], fk.m2q(ge[s + "Foot"][1])[0]
                    if a < n - 1 - win[1] - 2 and np.linalg.norm((pe - pos)[[0, 2]]) > far:
                        post = [[n - 1, n - 1, pe, re_]]; b = min(b, n - 2 - win[1])   # step onto the end stance
                    else:
                        pos, rot = pe, re_
            keys.append([a, b, pos, rot])
        keys = pre + keys + post
        if ge is not None and keys[-1][1] < n - 1:      # still moving at the end: one more step onto the end stance
            keys.append([n - 1, n - 1, ge[s + "Foot"][0][0] + off[n - 1], fk.m2q(ge[s + "Foot"][1])[0]])
        locked[s] = [(int(a_), int(b_)) for a_, b_, _, _ in keys]
        floor = min(k_[2][1] for k_ in keys)
        for a, b, pos, rot in keys:
            tgt[a:b + 1] = pos; rq[a:b + 1] = rot
        for (a0, b0, p0, r0), (a1, b1, p1, r1) in zip(keys[:-1], keys[1:]):
            fr = np.arange(b0 + 1, a1)
            if not len(fr):
                continue
            u = smooth((fr - b0) / (a1 - b0))
            d0 = p0 - P[b0]; d1 = p1 - P[a1]
            tgt[fr] = P[fr] + d0[None] * (1 - u)[:, None] + d1[None] * u[:, None]
            arc = np.sin(np.pi * (fr - b0) / (a1 - b0))
            lift = tgt[fr, 1] - floor
            need = max(0.0, min_lift - float(lift.max())) if np.linalg.norm((p1 - p0)[[0, 2]]) > 0.03 else 0.0
            tgt[fr, 1] = np.maximum(tgt[fr, 1], floor) + need * arc
            q0 = fk.qmul(r0, fk.qinv(Rq[b0])); q1 = fk.qmul(r1, fk.qinv(Rq[a1]))
            dq = G.slerp(np.repeat(q0[None], len(fr), 0), np.repeat(q1[None], len(fr), 0), u)
            rq[fr] = fk.qmul(dq, Rq[fr])
        a0, _, p0, r0 = keys[0]
        wik = np.ones(n)
        if a0 > 0:                                         # before the first plant: own path eased into it
            fr = np.arange(0, a0)
            u = smooth(fr / a0)
            tgt[fr] = P[fr] + (p0 - P[a0])[None] * u[:, None]
            wik[fr] = u                                    # (frame 0 untouched: a straight leg would get re-bent by the IK)
            q0 = fk.qmul(r0, fk.qinv(Rq[a0]))
            dq = G.slerp(np.repeat(np.array([[0, 0, 0, 1.0]]), len(fr), 0), np.repeat(q0[None], len(fr), 0), u)
            rq[fr] = fk.qmul(dq, Rq[fr])
        _, b9, p9, r9 = keys[-1]
        if b9 < n - 1:                                     # after the last plant (no end pose): eased back onto its own path
            fr = np.arange(b9 + 1, n)
            u = 1.0 - smooth((fr - b9) / (n - 1 - b9))
            tgt[fr] = P[fr] + (p9 - P[b9])[None] * u[:, None]
            q9 = fk.qmul(r9, fk.qinv(Rq[b9]))
            dq = G.slerp(np.repeat(np.array([[0, 0, 0, 1.0]]), len(fr), 0), np.repeat(q9[None], len(fr), 0), u)
            rq[fr] = fk.qmul(dq, Rq[fr])
            wik[fr] = np.maximum(wik[fr], u)
        local = tgt - off
        c = chain_ik(rig, c, s + "UpLeg", s + "Leg", s + "Foot", local, wik)
        g = globals_(rig, c)
        qcur = fk.m2q(g[s + "Foot"][1])
        set_local_from_global(rig, c, g, s + "Foot", fk.q2m(G.slerp(qcur, G.qnorm(rq), wik)))
        g = globals_(rig, c)
        miss[s] = float(np.linalg.norm(g[s + "Foot"][0] - local, axis=1).max())
    return c, miss, locked


# ------------------------------------------------------------------ shield held out, heavy attacks (v3)
def place_hand(rig, c, side, at, w, ref=None, keep_motion=True, frame0=0):
    """move a hand with IK (hand rotation kept) to a point given in the character frame (glTF axes, +Z forward) relative to
    the same side's shoulder joint (<side>Arm), e.g. at=(-0.05, -0.04, 0.30) = held out in front of the shoulder, a little
    toward the middle. keep_motion: the clip's own hand motion relative to the shoulder is kept on top (a knock-back or a
    punch still shows), measured from frame0. w: (n,) weights."""
    g = globals_(rig, c)
    hd = side + "Hand"; sh = g[ref or side + "Arm"][0]
    tgt = sh + np.asarray(at, float)[None]
    if keep_motion:
        rel = g[hd][0] - sh
        tgt = tgt + (rel - rel[frame0])
    tgt = g[hd][0] + (tgt - g[hd][0]) * np.asarray(w, float)[:, None]
    return two_bone_ik(rig, c, side, tgt, None, g[hd][1])[0]


def lean(rig, c, deg, w, bones=(("Spine02", 0.4), ("Spine01", 0.35), ("Spine", 0.25)), axis=(1.0, 0, 0)):
    """add a rotation of deg*w (n,) about a character-frame axis, spread over the spine bones (global, applied from the
    root up). axis (1,0,0) with deg < 0 leans the torso back (counterbalance), > 0 forward."""
    ax = np.asarray(axis, float); ax /= np.linalg.norm(ax)
    for bn, k in bones:
        a = np.radians(deg * k) * np.asarray(w, float)
        q = np.concatenate([np.sin(a / 2)[:, None] * ax[None], np.cos(a / 2)[:, None]], 1)
        g = globals_(rig, c)
        set_local_from_global(rig, c, g, bn, fk.q2m(q) @ g[bn][1])
    return c


# ------------------------------------------------------------------ flat lying pose (start of the get-ups, end of the knockdown)
def lying_pose(rig, ref_pose, body, face="up", arm_out=20.0, elbow=15.0, weapons=None, shield_axes=None, clear=0.004,
               neck_max=25.0):
    """a clean flat lying pose built from the rest pose: body straight, legs as in the rest pose, arms relaxed (on the back:
    beside the body, arm_out degrees from the torso, elbows bent `elbow` degrees; on the front: elbows out, hands on the floor
    beside the head), then the whole body turned onto its back
    (face='up': head toward -Z, as after falling backward) or front ('down': head toward +Z, as after falling forward), the
    hips lowered until the skinned body (clipcheck.Body) touches the floor (lowest vertex at `clear`), and the head/neck
    tilted (at most neck_max degrees) so the head rests on the floor as well. weapons: {weapon node: direction} in the
    character frame for hand-held props laid flat beside the body (e.g. a blade pointing out to the side); a shield
    (shield_axes given) lies flat, face up, its top toward the head. returns a pose dict like frame_pose()."""
    pose = {b: {"T": np.asarray(rig.rest[b][0], float).copy(), "R": np.asarray(rig.rest[b][1], float).copy(),
                "S": np.ones(3)} for b in ref_pose}
    c = {"n": 1, "bones": {b: {k: v[k][None].copy() for k in v} for b, v in pose.items()}}
    # arms. on the back: upper arm down and slightly out in the frontal plane, forearm bent toward the front (hands by the
    # hips). on the front: elbows out to the sides, forearms toward the head, hands on the floor beside the head (the relaxed
    # prone pose, close to a push-up start, so get-ups do not swing the elbows through the floor)
    for side, sx in (("Left", 1.0), ("Right", -1.0)):
        g = globals_(rig, c)
        up, lo, hd = side + "Arm", side + "ForeArm", side + "Hand"
        if face == "up":
            a = np.radians(arm_out)
            tgt = np.array([[sx * np.sin(a), -np.cos(a), 0.0]])
        else:
            tgt = np.array([[sx * 0.94, -0.34, 0.0]])
        set_local_from_global(rig, c, g, up, rot_between(g[lo][0] - g[up][0], tgt) @ g[up][1])
        g = globals_(rig, c)
        d = (g[hd][0] - g[lo][0])[0]; d /= np.linalg.norm(d)
        if face == "up":
            e = np.radians(elbow)
            fw = np.array([0, 0, 1.0]); fw = fw - d * d.dot(fw); fw /= np.linalg.norm(fw)
            nd = np.cos(e) * d + np.sin(e) * fw
        else:
            nd = np.array([sx * 0.15, 0.93, 0.33]); nd /= np.linalg.norm(nd)
        set_local_from_global(rig, c, g, lo, rot_between((g[hd][0] - g[lo][0]), nd[None]) @ g[lo][1])
    if face == "down":                                    # pointed feet (instep on the floor), not toes dug into it
        for side in ("Left", "Right"):
            g = globals_(rig, c)
            t = np.radians(70.0)
            Rf = np.array([[1, 0, 0], [0, np.cos(t), -np.sin(t)], [0, np.sin(t), np.cos(t)]])
            set_local_from_global(rig, c, g, side + "Foot", Rf[None] @ g[side + "Foot"][1])
    # lay the body down: rotate the root (Hips) about +X
    th = np.radians(-90.0 if face == "up" else 90.0)
    Rx = np.array([[1, 0, 0], [0, np.cos(th), -np.sin(th)], [0, np.sin(th), np.cos(th)]])
    c["bones"]["Hips"]["R"] = fk.m2q(Rx[None] @ fk.q2m(c["bones"]["Hips"]["R"]))
    feet_dir = np.array([0, 0, 1.0 if face == "up" else -1.0])
    for wn, dvec in (weapons or {}).items():
        if wn in rig.weapons:                             # laid flat: axis along dvec, edge (node +X) horizontal
            dv = np.asarray(dvec, float); dv = dv / np.linalg.norm(dv)
            Rn = fk.q2m(np.asarray(rig.rest[wn][1], float)); fl = Rn.T @ rig.weapons[wn]["axis"]
            ul = np.array([1.0, 0, 0]); ul = ul - fl * fl.dot(ul); ul /= np.linalg.norm(ul)
            hz = np.cross([0, 1.0, 0], dv); hz /= np.linalg.norm(hz)
            c = orient_prop(rig, c, wn, fl, ul, dv, hz, np.ones(1))
    if shield_axes is not None and "weapon_shield" in rig.weapons:
        c = orient_prop(rig, c, "weapon_shield", shield_axes["face"], shield_axes["up"], [0, 1, 0], list(-feet_dir), np.ones(1))
    dom = body.b["dom"]
    head = np.isin(dom, ["Head", "neck", "head_end", "headfront"])
    arms = np.array([d.endswith(("Arm", "ForeArm", "Hand", "Shoulder")) for d in dom])
    # the body rests on the back/chest, shoulders and legs; Hips-skinned cloth (capes, coat tails, skirts: rigid with the
    # pelvis, e.g. fram's cape flares 26 cm behind the hips) may sink into the floor instead of propping the body up
    trunk = np.isin(dom, ["Spine02", "Spine01", "Spine", "LeftShoulder", "RightShoulder", "LeftUpLeg", "RightUpLeg",
                          "LeftLeg", "RightLeg", "LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase"])
    trunk_all = ~head & ~arms
    spine = np.isin(dom, ["Spine02", "Spine01", "Spine"])
    limbs = trunk & ~spine

    def low(cc):
        v = body.skin(globals_(rig, cc), 0)
        ts, tl = v[spine, 1].min(), v[limbs, 1].min()
        cloth = tl - ts > 0.05                            # spine-skinned cape reaching far past the back (fram): let it sink
        t = tl if cloth else min(ts, tl)
        keep = ~(trunk_all & ~trunk) & ~(spine if cloth else np.zeros(len(dom), bool))
        return t, v[head, 1].min(), v[keep, 1].min()
    t0, h0, _ = low(c)
    c["bones"]["Hips"]["T"][0, 1] += clear - t0          # trunk (torso, legs) on the floor
    # head: bend the neck (about the body's left-right axis, half in neck, half in Head) by the smallest angle that brings
    # the head onto the floor without sinking it (the big head of these characters reaches the floor before the back)
    g = globals_(rig, c)
    ax = (g["LeftArm"][0] - g["RightArm"][0])[0]; ax /= np.linalg.norm(ax)
    base = {bn: c["bones"][bn]["R"].copy() for bn in ("neck", "Head")}

    def bend(phi):
        for bn in ("neck", "Head"):
            c["bones"][bn]["R"] = base[bn].copy()
        for bn in ("neck", "Head"):
            q = np.r_[np.sin(phi / 4) * ax, np.cos(phi / 4)]
            gg = globals_(rig, c)
            set_local_from_global(rig, c, gg, bn, fk.q2m(q)[None] @ gg[bn][1])
        return low(c)[1]
    best = (abs(bend(0.0) - clear), 0.0)
    for phi in np.radians(np.arange(-neck_max, neck_max + 0.1, 2.5)):
        h = bend(phi)
        if h >= clear - 0.002 and (abs(h - clear), abs(phi)) < (best[0] + 1e-9, abs(best[1])) or best[0] > 0.004 and abs(h - clear) < best[0]:
            best = (abs(h - clear), phi)
    bend(best[1])
    # hands (with their props) rest on the floor: move each hand joint straight down/up with arm IK, hand rotation kept
    for side in ("Left", "Right"):
        hm = dom == side + "Hand"
        v = body.skin(globals_(rig, c), 0)
        g = globals_(rig, c)
        tgt = g[side + "Hand"][0].copy(); tgt[0, 1] += clear + 0.002 - v[hm, 1].min()
        c = two_bone_ik(rig, c, side, tgt, None, g[side + "Hand"][1])[0]
    t0, h0, a0 = low(c)
    if a0 < 0:                                            # an arm (or the head) still below the floor: raise everything
        c["bones"]["Hips"]["T"][0, 1] += clear - a0
    return frame_pose(c, 0)


def load_hips(rig, c, lean_deg, dip, w):
    """heavy wind-up: lean the torso (lean_deg about the character's X axis, < 0 = back) and sink the hips by dip metres,
    both scaled by w (n,); the feet are put back where they were with leg IK (ankle position and rotation kept)."""
    g0 = globals_(rig, c)
    feet = {s: (g0[s + "Foot"][0].copy(), g0[s + "Foot"][1].copy()) for s in ("Left", "Right")}
    c = lean(rig, c, lean_deg, w)
    c["bones"]["Hips"]["T"][:, 1] -= dip * np.asarray(w, float)
    for s in ("Left", "Right"):
        c = chain_ik(rig, c, s + "UpLeg", s + "Leg", s + "Foot", feet[s][0], np.ones(nframes(c)))
        g = globals_(rig, c)
        set_local_from_global(rig, c, g, s + "Foot", feet[s][1])
    return c


def hands_above_floor(rig, c, body, clear=0.004, sigma=1.5, keep=(False, False)):
    """lift each hand whose skinned mesh (clipcheck.Body) dips below the floor (y = clear) straight up with arm IK, hand
    rotation kept; the lift is smoothed over time (gaussian, sigma frames) and never lowers a hand. For blends between lying
    and crouching poses, which can swing an arm through the floor. keep=(first, last) leaves the clip's end frames as they
    are (eased over 4 frames), for clips that start/end exactly on a flat lying pose. returns (clip, max lift per side)."""
    from scipy.ndimage import gaussian_filter1d
    n = nframes(c)
    dom = body.b["dom"]
    out = {}
    for s in ("Left", "Right"):
        hm = dom == s + "Hand"
        g = globals_(rig, c)
        lo = np.array([body.skin(g, f)[hm, 1].min() for f in range(n)])
        need = np.maximum(clear - lo, 0)
        if need.max() <= 0:
            out[s] = 0.0
            continue
        lift = np.maximum(gaussian_filter1d(need, sigma, mode="nearest"), need)
        env = np.ones(n)                                  # keep=(first, last): leave pose-locked ends (flat poses) untouched
        if keep[0]:
            env = np.minimum(env, smooth(np.arange(n) / 4.0))
        if keep[1]:
            env = np.minimum(env, smooth((n - 1 - np.arange(n)) / 4.0))
        lift = lift * env
        tgt = g[s + "Hand"][0].copy(); tgt[:, 1] += lift
        w = (lift > 1e-5).astype(float)
        c = two_bone_ik(rig, c, s, tgt, w, g[s + "Hand"][1])[0]
        out[s] = float(lift.max())
    return c, out


def settle_arms(rig, c, f0, f1, weapons=(), sides=("Left", "Right"), bulge=0.06, lift=0.05):
    """lying body: move each hand from its spot at f0 to its spot at f1 along an arc around its shoulder on the OUTSIDE of
    the body (the hand never passes over the torso or face), a little away from the shoulder and off the floor mid-way,
    with arm IK; hand-held props in `weapons` point radially away from the shoulder (laid down outward) on the way, turning
    in over 9 frames. The hand edits fade in over the first 3 frames and out on f1, so frame f1 (e.g. the flat pose of a knockdown's tail) is unchanged."""
    n = nframes(c)
    fr = np.arange(f0, f1 + 1)
    u = smooth((fr - f0) / max(f1 - f0, 1))
    w = np.zeros(n); w[fr] = np.minimum(smooth((fr - f0) / 3.0), 1.0) * np.minimum(1.0, (f1 - fr) / 2.0)
    w[f1] = 0.0
    wa = np.zeros(n); wa[fr] = smooth((fr - f0) / 9.0) * smooth((f1 - fr) / 3.0)   # props turn in more slowly
    for s in sides:
        sx = 1.0 if s == "Left" else -1.0
        g = globals_(rig, c)
        S = g[s + "Arm"][0]; H = g[s + "Hand"][0]
        rel0, rel1 = H[f0] - S[f0], H[f1] - S[f1]
        a0, a1 = np.arctan2(rel0[0], rel0[2]), np.arctan2(rel1[0], rel1[2])
        da = (a1 - a0 + np.pi) % (2 * np.pi) - np.pi
        if np.sign(np.sin(a0 + da / 2)) != sx:          # the short way crosses the body: go round the outside
            da = da - np.sign(da) * 2 * np.pi
        r0, r1 = np.hypot(rel0[0], rel0[2]), np.hypot(rel1[0], rel1[2])
        a = a0 + da * u; r = r0 + (r1 - r0) * u + bulge * np.sin(np.pi * u)
        tgt = H.copy()
        tgt[fr, 0] = S[fr, 0] + r * np.sin(a); tgt[fr, 2] = S[fr, 2] + r * np.cos(a)
        tgt[fr, 1] = H[f0, 1] + (H[f1, 1] - H[f0, 1]) * u + lift * np.sin(np.pi * u)
        c = two_bone_ik(rig, c, s, tgt, w, g[s + "Hand"][1])[0]
        for wn in weapons:
            if wn in rig.weapons and rig.weapons[wn]["bone"] == s + "Hand":
                g = globals_(rig, c)
                rad = g[s + "Hand"][0] - g[s + "Arm"][0]; rad[:, 1] = 0
                rad /= np.maximum(np.linalg.norm(rad, axis=1, keepdims=True), 1e-6)
                c = aim_weapon(rig, c, wn, rad, wa)
    return c


def plant_weapon(rig, c, wname, f0, f1, ease=3, clear=0.004):
    """hold a weapon on the floor (frames f0..f1, eased in/out over `ease` frames): the weapon hand moves straight down/up
    with arm IK (hand rotation kept) so the weapon's lowest vertex sits at y = clear. For a heavy strike whose head should
    stay bitten into the ground after the weapon-through-floor fix lifted it. Where the arm cannot reach (fully planted
    frames only), the weapon is tipped down at the wrist (at most ~15 deg). returns (clip, max hand move in metres)."""
    n = nframes(c)
    W = rig.weapons[wname]; hb = W["bone"]; side = hb[:-4]
    g = globals_(rig, c)
    P, R = g[hb]
    lo = (np.einsum("nij,kj->nki", R, W["verts"]) + P[:, None])[:, :, 1].min(1)
    f = np.arange(n, dtype=float)
    w = np.minimum(smooth((f - (f0 - ease)) / ease), smooth(((f1 + ease) - f) / ease))
    tgt = P.copy(); tgt[:, 1] -= (lo - clear) * w
    c = two_bone_ik(rig, c, side, tgt, (w > 0).astype(float), R)[0]
    for _ in range(3):                                    # what the arm cannot reach: tip the weapon down at the wrist
        g = globals_(rig, c); P, R = g[hb]
        V = np.einsum("nij,kj->nki", R, W["verts"]) + P[:, None]
        k = V[:, :, 1].argmin(1); low = V[np.arange(n), k]; rest_ = (low[:, 1] - clear) * (w > 0.999)   # planted frames only
        arm = low - P; hz = np.linalg.norm(arm[:, [0, 2]], axis=1)
        ang = np.arcsin(np.clip(rest_ / np.maximum(np.linalg.norm(arm, axis=1), 1e-6), -0.09, 0.09))
        ax = np.cross(arm, [0, 1.0, 0]); ax /= np.maximum(np.linalg.norm(ax, axis=1, keepdims=True), 1e-9)
        q = np.concatenate([ax * np.sin(-ang / 2)[:, None], np.cos(-ang / 2)[:, None]], 1)
        q[hz < 1e-4] = [0, 0, 0, 1.0]
        set_local_from_global(rig, c, g, hb, fk.q2m(q) @ R)
    return c, float(np.abs((lo - clear) * w).max())


def root_from_feet(rig, c, axis=None, smooth_k=5):
    """in-place locomotion loop (library clip without travel): rebuild the travel from the supporting foot. Each frame the
    lower foot is taken as planted; the body moves opposite to its horizontal velocity. The per-frame velocity is smoothed,
    replaced by its mean over the loop (constant speed), optionally projected on `axis` (character frame), and added to the
    Hips X/Z, so strip_root moves it into the root json. returns (clip, speed m/s)."""
    from scipy.ndimage import uniform_filter1d
    n = nframes(c)
    g = globals_(rig, c)
    y = {s: np.minimum(g[s + "Foot"][0][:, 1], g[s + "ToeBase"][0][:, 1]) for s in ("Left", "Right")}
    P = {s: (g[s + "Foot"][0] + g[s + "ToeBase"][0]) / 2 for s in ("Left", "Right")}
    v = np.zeros((n, 3))
    for f in range(1, n):
        s = "Left" if y["Left"][f] < y["Right"][f] else "Right"
        v[f] = -(P[s][f] - P[s][f - 1])
    v[:, 1] = 0
    v[0] = v[1]
    v = uniform_filter1d(v, smooth_k, axis=0, mode="wrap")
    m = v.mean(0)
    if axis is not None:
        a = np.asarray(axis, float); a /= np.linalg.norm(a); m = a * max(float(m @ a), 0.0)
    c["bones"]["Hips"]["T"][:, 0] += m[0] * np.arange(n)
    c["bones"]["Hips"]["T"][:, 2] += m[2] * np.arange(n)
    return c, float(np.linalg.norm(m) * 30)


def chest_yaw(rig, c):
    """facing of the chest per frame (degrees about +Y, 0 = +Z), from the shoulder line"""
    g = globals_(rig, c)
    f = np.cross(g["LeftArm"][0] - g["RightArm"][0], [0, 1.0, 0])
    return np.degrees(np.arctan2(f[:, 0], f[:, 2]))


def face_yaw(rig, c, target_deg, bones=(("Spine02", 0.4), ("Spine01", 0.35), ("Spine", 0.25))):
    """turn the torso about the vertical (spread over the spine) by one constant angle so that its mean chest facing
    becomes target_deg (e.g. a side-stepping walk whose torso is turned away, made to face forward). returns (clip, turn)."""
    cur = chest_yaw(rig, c)
    d = (target_deg - np.degrees(np.arctan2(np.sin(np.radians(cur)).mean(), np.cos(np.radians(cur)).mean())) + 180) % 360 - 180
    n = nframes(c)
    for bn, k in bones:
        a = np.radians(d * k)
        q = np.tile([0, np.sin(a / 2), 0, np.cos(a / 2)], (n, 1))
        g = globals_(rig, c)
        set_local_from_global(rig, c, g, bn, fk.q2m(q) @ g[bn][1])
    return c, float(d)
