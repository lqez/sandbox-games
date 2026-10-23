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
    # smoothing can lower the peak; scale so the worst frame is still reachable
    if over.max() > 1e-4:
        chest = g["Spine"][1]
        ER = g["RightForeArm"][0] - g["RightArm"][0]; ER = ER / np.linalg.norm(ER, axis=1)[:, None]
        pole_r = _smooth(pole_mix * ER + (1 - pole_mix) * _vec(chest, np.array([-0.55, -0.8, -0.25])), smooth)
        tw_r = PR0 + shift
        c = _ik_pole(rig, c, "Right", tw_r, pole_r, np.ones(n), RR0)
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
    return c
