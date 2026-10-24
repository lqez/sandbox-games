"""Two-handed grip for weapons parented to RightHand (Schneider's mace).
The left fist is fixed on the shaft `spacing` metres toward the shaft end from the right fist, with the knuckles lined up with
the right fist (mirrored hand frames), so both fists wrap the same shaft without per-frame flips. The left arm is solved
with two-bone IK (elbow pole: the mocap elbow blended with 'down and out from the chest', smoothed over time).
If the left arm cannot reach, the right hand (weapon orientation kept) is pulled toward the left shoulder; the pull is
smoothed over time so the weapon path stays continuous."""
import numpy as np
import fk, motion as M


def _vec(R, v):
    return np.einsum('nij,j->ni', R, v)


def _smooth(x, k=3):
    if k <= 0 or len(x) < 3:
        return x
    w = np.exp(-0.5 * (np.arange(-k, k + 1) / (k / 2)) ** 2); w /= w.sum()
    pad = np.concatenate([np.repeat(x[:1], k, 0), x, np.repeat(x[-1:], k, 0)])
    return np.stack([np.convolve(pad[:, i], w, mode="valid") for i in range(x.shape[1])], 1)


def _kabsch(A, B):
    """rotation R with R @ A[i] ~ B[i]"""
    H = sum(np.outer(a, b) for a, b in zip(A, B))
    U, _, Vt = np.linalg.svd(H)
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    return Vt.T @ np.diag([1, 1, d]) @ U.T


def shaft_ik(rig, c, wname, spacing=0.15, reach=0.985, pole_mix=0.5, smooth=3, weight=None):
    W = rig.weapons[wname]
    Tw = np.array(rig.rest[wname][0]); ax_l = W["axis"]; kn_l = W["edge"]
    Mx = np.diag([-1.0, 1, 1])
    gripL = Mx @ Tw
    B = _kabsch([Mx @ ax_l, Mx @ kn_l], [ax_l, kn_l])          # left-hand local -> right-hand local (same grip)
    n = M.nframes(c)
    wgt = np.ones(n) if weight is None else weight
    g0 = M.globals_(rig, c)
    PR0, RR0 = g0["RightHand"][0].copy(), g0["RightHand"][1].copy()
    a = np.linalg.norm(g0["LeftForeArm"][0] - g0["LeftArm"][0], axis=1)
    b = np.linalg.norm(g0["LeftHand"][0] - g0["LeftForeArm"][0], axis=1)
    fist0 = g0["LeftHand"][0] + _vec(g0["LeftHand"][1], gripL)

    def targets(g):
        PR, RR = g["RightHand"]
        base = PR + _vec(RR, Tw); ax = _vec(RR, ax_l)
        tf = base - ax * spacing
        RL = RR @ B
        return tf, RL, tf - _vec(RL, gripL)

    # pull the right hand in where the left arm is too short (smoothed)
    g = g0
    tf, RL, tw = targets(g)
    Sh = g["LeftArm"][0]
    d = tw - Sh; L = np.linalg.norm(d, axis=1)
    over = np.maximum(L - (a + b) * reach, 0)
    shift = -d / L[:, None] * over[:, None] * 1.08
    shift = _smooth(shift, smooth)
    if weight is not None:                                   # frames with weight 0 stay exactly as they are
        shift = shift * wgt[:, None]
    # smoothing can lower the peak; scale so the worst frame is still reachable
    if over.max() > 1e-4:
        chest = g["Spine"][1]
        ER = g["RightForeArm"][0] - g["RightArm"][0]; ER = ER / np.linalg.norm(ER, axis=1)[:, None]
        pole_r = _smooth(pole_mix * ER + (1 - pole_mix) * _vec(chest, np.array([-0.55, -0.8, -0.25])), smooth)
        tw_r = PR0 + shift
        c = _ik_pole(rig, c, "Right", tw_r, pole_r, np.ones(n) if weight is None else (wgt > 0).astype(float), RR0)
        g = M.globals_(rig, c)
        tf, RL, tw = targets(g)
    # elbow pole: mocap elbow mixed with down-and-out of the chest, smoothed
    chest = g["Spine"][1]
    pole_def = _vec(chest, np.array([0.55, -0.8, -0.25]))
    E0 = g["LeftForeArm"][0] - g["LeftArm"][0]
    E0 = E0 / np.linalg.norm(E0, axis=1)[:, None]
    pole = _smooth(pole_mix * E0 + (1 - pole_mix) * pole_def, smooth)
    c = _ik_pole(rig, c, "Left", tw, pole, wgt, RL)
    g = M.globals_(rig, c)
    fistL = g["LeftHand"][0] + _vec(g["LeftHand"][1], gripL)
    gap = np.linalg.norm(fistL - tf, axis=1)
    return c, gap, np.linalg.norm(g["RightHand"][0] - PR0, axis=1), np.linalg.norm(fistL - fist0, axis=1)


def _ik_pole(rig, c, side, target, pole_dir, w, hand_rot):
    """two-bone IK with an explicit pole direction (n,3) in armature space."""
    up, lo, hd = side + "Arm", side + "ForeArm", side + "Hand"
    old = {k: c["bones"][k]["R"].copy() for k in (up, lo, hd)}
    g = M.globals_(rig, c)
    S, E, Wp = g[up][0], g[lo][0], g[hd][0]
    a = np.linalg.norm(E - S, axis=1); b = np.linalg.norm(Wp - E, axis=1)
    tgt = Wp + (target - Wp) * w[:, None]
    d = tgt - S; L = np.linalg.norm(d, axis=1)
    Lc = np.clip(L, np.abs(a - b) + 1e-4, (a + b) * 0.999)
    dn = d / L[:, None]
    tgt_c = S + dn * Lc[:, None]
    pole = pole_dir - dn * np.sum(pole_dir * dn, 1)[:, None]
    pn = np.linalg.norm(pole, axis=1)
    bad = pn < 1e-5
    if bad.any():
        pole[bad] = np.cross(dn[bad], [0, 1, 0])
    pole = pole / np.linalg.norm(pole, axis=1)[:, None]
    cosA = np.clip((a * a + Lc * Lc - b * b) / (2 * a * Lc), -1, 1); sinA = np.sqrt(1 - cosA ** 2)
    E2 = S + (dn * cosA[:, None] + pole * sinA[:, None]) * a[:, None]
    M.set_local_from_global(rig, c, g, up, M.rot_between(E - S, E2 - S) @ g[up][1])
    g = M.globals_(rig, c)
    M.set_local_from_global(rig, c, g, lo, M.rot_between(g[hd][0] - g[lo][0], tgt_c - g[lo][0]) @ g[lo][1])
    g = M.globals_(rig, c)
    cur = fk.m2q(g[hd][1]); des = fk.m2q(hand_rot)
    M.set_local_from_global(rig, c, g, hd, fk.q2m(M.G.slerp(cur, des, w)))
    z = np.asarray(w) <= 0                                   # weight-0 frames keep their exact rotations
    for k in (up, lo, hd):
        c["bones"][k]["R"][z] = old[k][z]
    return c


def hand_axes(base_glb, rig, side="Left"):
    """(finger direction, palm normal, hand length, half thickness) of a hand in its bone's local frame, from the skinned hand vertices of the original
    body: fingers = mean direction to the farthest 10% of the vertices dominated by the hand bone, palm = the flattest
    principal axis (orthogonal to the fingers), signed to face the body's midline at rest (A-pose, palms toward the thighs)."""
    import clipcheck
    b = clipcheck.load_body(base_glb)
    k = b["joints"].index(side + "Hand")
    m = b["dom"] == side + "Hand"
    V = (np.c_[b["P"][m], np.ones(m.sum())] @ b["ibm"][k].T)[:, :3]
    r = np.linalg.norm(V, axis=1); far = V[r > np.percentile(r, 90)].mean(0)
    fing = far / np.linalg.norm(far)
    _, _, Vt = np.linalg.svd(V - V.mean(0), full_matrices=False)
    palm = Vt[2] - fing * np.dot(Vt[2], fing); palm /= np.linalg.norm(palm)
    pw = M.rest_globals(rig)[side + "Hand"][1][0] @ palm
    if (side == "Left") == (pw[0] > 0):
        palm = -palm
    length = float(np.percentile(V @ fing, 98))          # wrist joint -> fingertips
    half = float(np.percentile(np.abs((V - V.mean(0)) @ palm), 90))   # half the hand's thickness
    return fing, palm, length, half


def blade_press(rig, c, wname, frac=0.5, w=None, palm=None, fingers=None, standoff=0.02, heel=0.04, pole_mix=0.5, smooth=3,
                side="Left"):
    """off hand pressed flat on the blade (half-sword guard): the palm lies on the flat of the blade at `frac` of the
    grip -> tip length, on the side facing the off-hand shoulder, fingers pointing up across the flat (world up projected
    on the flat; along the blade when that is degenerate). palm/fingers: the hand's palm normal and finger direction in
    its bone's local frame. standoff: palm surface -> hand joint distance along the palm normal; heel: how far the hand
    joint sits below the contact point along the fingers. The arm is solved with the two-bone IK and pole of shaft_ik.
    w: (n,) weight. returns (clip, distance from the palm contact point to the blade's mid-plane per frame)"""
    W = rig.weapons[wname]; hb = W["bone"]
    Tw = np.array(rig.rest[wname][0]); ax_l = W["axis"]; kn_l = W["edge"]
    blade = float(np.dot(W["tip"] - Tw, ax_l))
    n = M.nframes(c)
    wgt = np.ones(n) if w is None else np.asarray(w, float)
    g = M.globals_(rig, c)
    PR, RR = g[hb]
    ax = _vec(RR, ax_l); ed = _vec(RR, kn_l)
    ed = ed - ax * np.sum(ed * ax, 1)[:, None]; ed /= np.linalg.norm(ed, axis=1)[:, None]
    nr = np.cross(ax, ed)                                   # normal of the flat
    mid = PR + _vec(RR, Tw) + ax * blade * frac
    sh = g[side + "Arm"][0]
    sgn = np.sign(np.sum(nr * (sh - mid), 1)); sgn[sgn == 0] = 1
    sgn = np.sign(_smooth(sgn[:, None], smooth)[:, 0] + 1e-9)
    nr = nr * sgn[:, None]                                  # flat normal toward the off-hand shoulder
    up = np.array([0, 1.0, 0])
    fd = up[None] - nr * nr[:, 1:2]
    weak = np.linalg.norm(fd, axis=1) < 0.3
    fd[weak] = ax[weak]
    fd /= np.linalg.norm(fd, axis=1)[:, None]
    fd = _smooth(fd, smooth); fd = fd - nr * np.sum(fd * nr, 1)[:, None]; fd /= np.linalg.norm(fd, axis=1)[:, None]
    # desired hand rotation: local palm -> -nr, local fingers -> fd
    pl = np.asarray(palm, float); fl = np.asarray(fingers, float)
    fl = fl - pl * np.dot(fl, pl); fl /= np.linalg.norm(fl); pl = pl / np.linalg.norm(pl)
    Bl = np.stack([pl, fl, np.cross(pl, fl)], 1)
    pw = -nr
    Bw = np.stack([pw, fd, np.cross(pw, fd)], 2)
    RL = Bw @ Bl.T[None]
    tw = mid + nr * standoff - fd * heel
    chest = g["Spine"][1]
    pole_def = _vec(chest, np.array([0.55 if side == "Left" else -0.55, -0.8, -0.25]))
    E0 = g[side + "ForeArm"][0] - g[side + "Arm"][0]; E0 = E0 / np.linalg.norm(E0, axis=1)[:, None]
    pole = _smooth(pole_mix * E0 + (1 - pole_mix) * pole_def, smooth)
    c = _ik_pole(rig, c, side, tw, pole, wgt, RL)
    g = M.globals_(rig, c)
    contact = g[side + "Hand"][0] - _vec(g[side + "Hand"][1], pl) * standoff + _vec(g[side + "Hand"][1], fl) * heel
    PR, RR = g[hb]; ax = _vec(RR, ax_l)
    mid = PR + _vec(RR, Tw) + ax * blade * frac
    return c, np.linalg.norm(contact - mid, axis=1)
