"""QA for built GLBs (foot sliding is measured with <name>_root.json re-applied): weapon-through-body clearance, foot sliding, frame-to-frame pops, loop seams.
usage: uv run --no-project --with numpy python qa.py <glb> [clip,...]"""
import sys, os
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gltfio as G, fk

def seg_dist(p, a, b):
    ab = b - a; t = np.clip(np.sum((p - a) * ab, -1) / np.maximum(np.sum(ab * ab, -1), 1e-9), 0, 1)
    return np.linalg.norm(a + ab * t[..., None] - p, axis=-1)

def run(glb, names=None):
    rig = fk.Rig(glb)
    _, clips = G.read_clips(glb)
    import json as _j
    side = os.path.splitext(glb)[0] + "_root.json"
    root = _j.load(open(side))["clips"] if os.path.exists(side) else {}
    H = rig.rest["Hips"][0][1]
    k = H / 0.69                                   # body radii scale with hip height
    caps = [("torso", "Hips", "Spine", 0.105 * k), ("chest", "Spine", "neck", 0.10 * k), ("head", "Head", "head_end", 0.13 * k),
            ("Lthigh", "LeftUpLeg", "LeftLeg", 0.065 * k), ("Rthigh", "RightUpLeg", "RightLeg", 0.065 * k),
            ("Lshin", "LeftLeg", "LeftFoot", 0.05 * k), ("Rshin", "RightLeg", "RightFoot", 0.05 * k)]
    out = {}
    for cn, c in clips.items():
        if names and cn not in names:
            continue
        g = rig.fk(c["bones"]); n = c["n"]
        res = {"frames": n}
        for wn, W in rig.weapons.items():
            if wn == "weapon_shield":
                continue
            P, R = g[W["bone"]]
            tip = P + np.einsum("nij,j->ni", R, W["tip"])
            base = P + np.einsum("nij,j->ni", R, np.array(rig.rest[wn][0]))
            worst = np.full(n, 9.0); who = [""] * n
            for s in np.linspace(0.3, 1.0, 8):
                pt = base + (tip - base) * s
                for nm, a, b, r in caps:
                    hb = g[b][0]
                    if nm == "head":   # head capsule: Head joint up to head_end (top), shifted slightly forward
                        pass
                    d = seg_dist(pt, g[a][0], hb) - r
                    m = d < worst
                    worst = np.where(m, d, worst)
                    for i in np.where(m)[0]: who[i] = nm
            bad = np.where(worst < -0.02)[0]
            res[wn] = {"pen_frames": len(bad), "worst_cm": round(float(-worst.min()) * 100, 1), "worst_frame": int(np.argmin(worst)),
                       "worst_part": who[int(np.argmin(worst))], "bad": bad.tolist()[:40]}
        # foot sliding: horizontal speed of a foot while it is near its lowest height (planted)
        sl = {}
        off = np.zeros((n, 3))
        if cn in root:               # measure sliding with the stripped root motion re-applied (as the game does)
            off[:, 0] = root[cn]["x"]; off[:, 2] = root[cn]["z"]
        for side in ("Left", "Right"):
            toe = g[side + "ToeBase"][0] + off; ft = g[side + "Foot"][0] + off
            y = np.minimum(toe[:, 1], ft[:, 1])
            planted = y < (y.min() + 0.02)
            v = np.r_[0, np.linalg.norm(np.diff(toe[:, [0, 2]], axis=0), axis=1)] * 30
            sl[side] = round(float(np.percentile(v[planted], 90)) if planted.any() else 0.0, 2)
        res["foot_slide_p90_mps"] = sl
        # pops: max per-frame joint rotation change
        mx = 0; mf = 0; mb = ""
        for b, v in c["bones"].items():
            a = fk.qang(v["R"][1:], v["R"][:-1])
            if a.max() > mx:
                mx, mf, mb = float(a.max()), int(np.argmax(a)) + 1, b
        res["max_rot_step_deg"] = [round(mx, 1), mf, mb]
        out[cn] = res
    return out

if __name__ == "__main__":
    import json
    r = run(sys.argv[1], sys.argv[2].split(",") if len(sys.argv) > 2 else None)
    for k, v in r.items():
        print(k, json.dumps(v))
