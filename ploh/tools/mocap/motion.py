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


def seq(lib, parts):
    """concatenate clip segments [(src, a, b), ...]; the Hips X/Z of each segment is shifted to continue the previous one."""
    out = None
    for src, a, b in parts:
        s = sub(lib[src], a, b)
        if out is not None:
            T = s["bones"]["Hips"]["T"]
            d = T[0, [0, 2]] - out["bones"]["Hips"]["T"][-1, [0, 2]]
            T[:, 0] -= d[0]; T[:, 2] -= d[1]
            s = sub(s, 1, -1) if np.allclose(frame_pose(s, 0)["Hips"]["R"], out["bones"]["Hips"]["R"][-1], atol=1e-4) else s
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
