"""Replace a PLOH character's hand-keyed clips with Meshy library mocap clips (requested on the character's own rigging task).

The body mesh, skin, texture and weapon nodes are copied byte-for-byte from the hand-keyed GLB (raw/<name>_handkeyed.glb);
only the animations are rebuilt (30 fps, a key on every frame, T/R/S for all 24 joints, LINEAR).
Per clip: trim -> (two-handed grip IK) -> strip horizontal Hips motion -> ease the edges into the idle pose -> loop fix.
The removed Hips X/Z goes to <name>_root.json next to the GLB.

usage: uv run --no-project --with numpy python mocap_build.py <character> [out.glb]
characters: astrid fram schneider conscript shieldbearer boss
"""
import sys, os, json, shutil, subprocess
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gltfio as G, fk, motion as M, twohand

ASSETS = "/Users/lqez/dev/sandbox-games/ploh/game/assets/"
ATTACKS = ("attack_1", "attack_2", "attack_3", "cast", "spin", "shield_bash")
BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"
DECIMATE = {"hero": 12000, "soldier": 8000}      # body triangle targets for mobile (weapons untouched)


def decimated_body(backup, raw, stem, target, opts=()):
    """Blender collapse-decimate the body once and cache it as raw/<stem>_body<target>.glb"""
    out = raw + f"{stem}_body{target}.glb"
    if not os.path.exists(out) or os.path.getmtime(out) < os.path.getmtime(os.path.join(HERE, "decimate_body.py")):
        r = subprocess.run([BLENDER, "-b", "--python", os.path.join(HERE, "decimate_body.py"), "--", backup, out, str(target)]
                           + [str(o) for o in opts], capture_output=True, text=True)
        line = next((l for l in r.stdout.splitlines() if l.startswith("DECIMATE")), None)
        if line is None:
            raise SystemExit("decimate failed:\n" + r.stdout[-2000:] + r.stderr[-2000:])
        print(line)
    return out

# clip spec: src = Meshy clip name, a/b = frame range (inclusive, b=-1 last), loop, bi/bo = frames eased from/into idle frame 0,
# lf = loop-fix frames, ik = two-handed grip (characters with "twohand"), speed = time scale (>1 slower),
# mirror = left/right mirror (applied first), measure = weapon used for the strike frame (default: the character's weapon), bi_prev = clip whose last frame is the blend-in pose (combo chaining), cut = [(f0, f1)] source frames f0..f1-1 removed (static holds), tail = frames appended easing from the last frame into idle,
# arms = bones whose local rotation is taken from idle frame 0 (weapon arm stays in guard during a flinch)
ARMS_R = ["RightShoulder", "RightArm", "RightForeArm", "RightHand"]
ARMS = ARMS_R + ["LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand"]
SPEC = {
    # 프라우: 한손검, 민첩. 콤보는 Double Combo Attack(92, 검을 들고 찍은 모캡) 한 벌을 칼끝 속도가 가장 느린 멈춤에서 셋으로 나눈다
    "astrid": {
        "tris": DECIMATE["hero"],
        "glb": "astrid/B_mid/astrid.glb", "weapon": "weapon_sword",
        "src": ["animations.glb", "animations_mocap.glb", "animations_prop.glb"],
        "clips": {
            "idle": dict(src="Combat_Stance", loop=True, lf=4),
            "run": dict(src="Run_02", loop=True, lf=4),
            "attack_1": dict(src="Double_Combo_Attack", a=0, b=30, bi=6),
            "attack_2": dict(src="Double_Combo_Attack", a=30, b=45),
            # the tail of Double Combo Attack is a slow recovery swing (no strike); the third hit is Charged Upward Slash,
            # blended in from attack_2's last pose so the chain stays continuous
            "attack_3": dict(src="Charged_Upward_Slash", a=14, b=72, bi=8, bi_prev="attack_2", bo=12),
            "cast": dict(src="Sword_Judgment", a=10, b=84, bi=8, bo=12),
            "spin": dict(src="Axe_Spin_Attack", a=0, b=60, bi=6, bo=10),
            "dodge": dict(src="Roll_Dodge_1", bi=4, bo=6),
            "hit": dict(src="Hit_Reaction_1", a=0, b=22, bi=3, bo=8, arms=ARMS),
            "death": dict(src="Dead", bi=4),
        },
    },
    # 프람: 검과 방패. 콤보는 Triple Combo Attack(105)을 셋으로 나눈다
    "fram": {
        "tris": DECIMATE["hero"],
        "glb": "fram/fram.glb", "weapon": "weapon_sword",
        "src": ["animations.glb", "animations_survey1.glb", "animations_survey2.glb", "animations_survey3.glb", "animations_mocap.glb"],
        "clips": {
            "idle": dict(src="Combat_Stance", loop=True, lf=4),
            "run": dict(src="Run_02", loop=True, lf=4),
            "attack_1": dict(src="Triple_Combo_Attack", a=0, b=36, bi=6),
            "attack_2": dict(src="Triple_Combo_Attack", a=36, b=60),
            "attack_3": dict(src="Triple_Combo_Attack", a=60, b=92, bo=12),
            "cast": dict(src="Basic_Jump", a=32, b=122, bi=6, bo=12),
            "spin": dict(src="Axe_Spin_Attack", a=0, b=60, bi=6, bo=10),
            "dodge": dict(src="Roll_Dodge_1", bi=4, bo=6),
            "hit": dict(src="Hit_Reaction_1", a=0, b=22, bi=3, bo=8, arms=ARMS),
            "death": dict(src="Dead", bi=4),
        },
    },
    # 슈나이더: 양손 메이스. 모든 무기 동작에서 왼 주먹을 자루에 붙인다(twohand.shaft_ik)
    "schneider": {
        "tris": DECIMATE["hero"],
        "glb": "schneider/schneider.glb", "weapon": "weapon_mace", "twohand": True,
        "src": ["animations.glb", "animations_mocap.glb"],
        "clips": {
            "idle": dict(src="Combat_Stance", loop=True, lf=4),
            "run": dict(src="Run_02", loop=True, lf=4, ik=False),
            "attack_1": dict(src="Attack", a=0, b=50, bi=10, tail=14),
            "attack_2": dict(src="Heavy_Hammer_Swing", a=0, b=-1, bi=14, tail=16),
            "attack_3": dict(src="Charged_Ground_Slam", a=0, b=-1, cut=[(18, 33)], bi=6, bo=6),
            "cast": dict(src="Basic_Jump", a=32, b=122, bi=6, bo=12),
            "spin": dict(src="Axe_Spin_Attack", a=0, b=60, bi=6, bo=10),
            "dodge": dict(src="Roll_Dodge_1", bi=4, bo=6, ik=False),
            "hit": dict(src="Hit_Reaction_1", a=0, b=22, bi=3, bo=8, arms=ARMS, ik=False),
            "death": dict(src="Dead", bi=4, ik=False),
        },
    },
    # 징집병: 한손검
    "conscript": {
        "tris": DECIMATE["soldier"],
        "glb": "soldiers/conscript/conscript.glb", "weapon": "weapon_sword",
        "src": ["animations.glb", "basic_running.glb", "animations_mocap.glb", "animations_prop.glb"],
        "clips": {
            "idle": dict(src="Combat_Stance", loop=True, lf=4),
            "walk": dict(src="Walk_Fight_Forward", loop=True, lf=4),
            "run": dict(src="running", loop=True, lf=4),
            "attack_1": dict(src="Left_Slash", a=0, b=34, bi=6, tail=12),
            "attack_2": dict(src="Double_Combo_Attack", a=0, b=30, bi=6, tail=12),
            "hit": dict(src="Hit_Reaction_1", a=0, b=22, bi=3, bo=8, arms=ARMS),
            "death": dict(src="dying_backwards", bi=4),
        },
    },
    # 방패병: 검과 방패
    "shieldbearer": {
        "tris": DECIMATE["soldier"],
        "glb": "soldiers/shieldbearer/shieldbearer.glb", "weapon": "weapon_sword",
        "src": ["animations.glb", "basic_running.glb", "animations_mocap.glb", "animations_prop.glb", "animations_bash.glb"],
        "clips": {
            "idle": dict(src="Combat_Stance", loop=True, lf=4),
            "walk": dict(src="Walk_Fight_Forward", loop=True, lf=4),
            "run": dict(src="running", loop=True, lf=4),
            "attack_1": dict(src="Triple_Combo_Attack", a=0, b=29, bi=6, tail=14),
            # the library push sweeps the shield to the character's left; turned -80 deg so the sweep lands in front
            # no shield bash in the library; Shield Push Left swings the shield edge-on to the side. A straight punch drives
            # the knuckles (= shield face) forward, so Boxing Guard, Prep Straight Punch (210) is mirrored onto the shield arm
            "shield_bash": dict(src="Boxing_Guard_Prep_Straight_Punch", a=30, b=84, mirror=True, bi=10, bo=12,
                                measure="weapon_shield", arms=ARMS_R),   # sword arm stays in guard (the boxing guard put the blade through the helmet)
            "block": dict(src="Sword_Parry", loop=True, lf=4),
            "block_hit": dict(src="Sword_Parry_Backward", a=0, b=-1),
            "hit": dict(src="Hit_Reaction_1", a=0, b=22, bi=3, bo=8, arms=ARMS),
            "death": dict(src="Fall_Dead_from_Abdominal_Injury", bi=4),
        },
    },
    # 요슈아(보스): 한손 펜듈럼 메이스
    "boss": {
        "tris": DECIMATE["soldier"],
        "glb": "soldiers/boss/boss.glb", "weapon": "weapon_pendulum",
        # the hand-keyed build aimed the pendulum out of the back of the hand; mocap needs the sword convention (thumb side)
        "weapon_dir": {"weapon_pendulum": [-0.58, 0.0, 0.81]},
        "src": ["animations.glb", "basic_running.glb", "animations_mocap.glb"],
        "clips": {
            "idle": dict(src="Combat_Stance", loop=True, lf=4),
            "walk": dict(src="Walk_Fight_Forward", loop=True, lf=4),
            "run": dict(src="running", loop=True, lf=4),
            "attack_1": dict(src="Charged_Ground_Slam", bi=6, bo=6),
            "attack_2": dict(src="Charged_Slash", a=0, b=60, bi=6, bo=8),
            "cast": dict(src="Basic_Jump", a=32, b=122, bi=6, bo=12),
            "hit": dict(src="Hit_Reaction_1", a=0, b=22, bi=3, bo=8, arms=ARMS),
            "death": dict(src="dying_backwards", bi=4),
        },
    },
}


def pose_dist(rig, ca, fa, cb, fb):
    B = ["Hips", "Spine01", "Spine", "Head", "LeftArm", "LeftForeArm", "RightArm", "RightForeArm", "RightHand",
         "LeftUpLeg", "LeftLeg", "RightUpLeg", "RightLeg"]
    ga, gb = rig.fk(M.sub(ca, fa, fa)["bones"]), rig.fk(M.sub(cb, fb, fb)["bones"])
    return float(np.mean([fk.qang(fk.m2q(ga[b][1])[0], fk.m2q(gb[b][1])[0]) for b in B]))


def build(name, out=None):
    sp = SPEC[name]
    base = ASSETS + sp["glb"]
    raw = os.path.dirname(base) + "/raw/"
    stem = os.path.splitext(os.path.basename(base))[0]
    backup = raw + stem + "_handkeyed.glb"
    if not os.path.exists(backup):
        shutil.copy2(base, backup)
        print("backup", backup)
    out = out or base
    nov = {}
    if sp.get("weapon_dir"):                    # re-aim a weapon in its hand (grip origin kept): tip direction in hand space
        r0 = fk.Rig(backup)
        for wn, d1 in sp["weapon_dir"].items():
            T, R, S = r0.rest[wn]
            d0 = r0.weapons[wn]["axis"]; d1 = np.array(d1, float); d1 /= np.linalg.norm(d1)
            Q = M.rot_between(d0[None], d1[None])[0]
            q = fk.m2q((Q @ fk.q2m(R))[None])[0]
            nov[wn] = {"rotation": [float(x) for x in q]}
    rig = fk.Rig(backup, nov)
    body = None
    if sp.get("tris"):
        bj, _ = G.read_glb(backup)
        body = G.body_from(decimated_body(backup, raw, stem, sp["tris"], sp.get("dec_opts", ())), bj)
    lib = M.load([raw + f for f in sp["src"] if os.path.exists(raw + f)])
    clips, root, rep = {}, {}, {}
    order = ["idle"] + [k for k in sp["clips"] if k != "idle"]
    idle = None
    for cn in order:
        d = sp["clips"][cn]
        c = M.sub(lib[d["src"]], d.get("a", 0), d.get("b", -1))
        if d.get("cut"):
            c = M.cut(c, [(x0 - d.get("a", 0), x1 - d.get("a", 0)) for x0, x1 in d["cut"]])
        if d.get("mirror"):
            c = M.mirror(rig, c)
        if d.get("speed"):
            c = M.resample(c, d["speed"])
        info = {"src": d["src"], "range": [d.get("a", 0), d.get("b", -1) if d.get("b", -1) >= 0 else M.nframes(lib[d["src"]]) - 1]}
        if sp.get("twohand") and d.get("ik", True):
            c, gap, rs, lm = twohand.shaft_ik(rig, c, sp["weapon"], **sp.get("twohand_opts", {}))
            info["ik"] = {"right_shift_max_cm": round(float(rs.max()) * 100, 1), "left_move_max_cm": round(float(lm.max()) * 100, 1),
                          "gap_max_cm": round(float(gap.max()) * 100, 2)}
        if d.get("arms") and idle is not None:   # keep these bones in the idle guard (local to the chest)
            M.bones_from_pose(c, M.frame_pose(idle, 0), d["arms"], d.get("arms_w", 1.0))
        if d.get("yaw"):
            c = M.rotate_yaw(c, d["yaw"])
        off = M.strip_root(rig, c, "loop" if d.get("loop") else "full")
        if idle is not None:
            if d.get("bi"):
                # bi_prev: chain from the previous combo segment's last pose instead of idle
                src_pose = M.frame_pose(clips[d["bi_prev"]], M.nframes(clips[d["bi_prev"]]) - 1) if d.get("bi_prev") else M.frame_pose(idle, 0)
                M.blend_pose(c, src_pose, d["bi"], "start")
            if d.get("bo"):
                M.blend_pose(c, M.frame_pose(idle, 0), d["bo"], "end")
            if d.get("tail"):
                c = M.tail(c, M.frame_pose(idle, 0), d["tail"])
                off = np.concatenate([off, np.repeat(off[-1:], d["tail"], 0)])
            # blends between different stances would slide the feet: make them small steps instead
            nn = M.nframes(c)
            if d.get("bi"):
                c = M.step_feet(rig, c, 0, d["bi"], root=off)
            if d.get("bo"):
                c = M.step_feet(rig, c, nn - 1 - d["bo"], nn - 1, root=off)
            if d.get("tail"):
                c = M.step_feet(rig, c, nn - 1 - d["tail"], nn - 1, root=off)
        if d.get("loop"):
            M.loop_fix(c, d.get("lf", 6))
        for b in c["bones"].values():
            b["R"] = M.qfix(G.qnorm(b["R"]))
            b["S"] = np.ones_like(b["S"])
        if cn == "idle":
            idle = c
        n = M.nframes(c)
        clips[cn] = c
        root[cn] = {"frames": n, "x": [round(float(v), 4) for v in off[:, 0]], "z": [round(float(v), 4) for v in off[:, 1]]}
        info.update({"frames": n, "len_s": round((n - 1) / 30, 3), "net_xz": [round(float(off[-1, 0]), 3), round(float(off[-1, 1]), 3)],
                     "max_xz": round(float(np.abs(off).max()), 3)})
        if cn != "idle":
            info["start_vs_idle_deg"] = round(pose_dist(rig, c, 0, idle, 0), 1)
            info["end_vs_idle_deg"] = round(pose_dist(rig, c, n - 1, idle, 0), 1)
        if cn in ATTACKS:
            m = fk.metrics(rig, c, d.get("measure", sp["weapon"]))
            sp_ = m["speed"]; pk = int(m["strike"])
            lo = hi = pk
            while lo > 1 and sp_[lo - 1] >= 0.25 * sp_[pk]: lo -= 1
            while hi < n - 1 and sp_[hi + 1] >= 0.25 * sp_[pk]: hi += 1
            rel = m["tip"][pk] - m["g"]["Hips"][0][pk]
            info.update({"strike": pk, "strike_s": round(pk / 30, 3), "strike_frac": round(pk / (n - 1), 3), "peak_mps": round(float(sp_[pk]), 1),
                         "fast": [lo, hi], "tip_at_strike_xyz": [round(float(v), 2) for v in rel]})
        rep[cn] = info
    G.write_glb(backup, out, clips, order=order, body=body, node_override=nov)
    side = os.path.join(os.path.dirname(out), stem + "_root.json")
    json.dump({"fps": 30,
               "about": "Horizontal Hips motion removed from each clip (the clip plays in place). x[f], z[f] = removed offset at frame f "
                        "relative to frame 0, metres at model scale (multiply by the node scale used in game), character local frame: "
                        "+Z forward, +X = character's left (glTF/Godot local axes). Apply x[f]-x[f-1], z[f]-z[f-1] as body movement.",
               "clips": root}, open(side, "w"), separators=(",", ":"))
    tris = {m["name"]: sum(G.read_glb(out)[0]["accessors"][p_["indices"]]["count"] // 3 for p_ in m["primitives"])
            for m in G.read_glb(out)[0]["meshes"]}
    print("REPORT", json.dumps({"glb": out, "root": side, "tris": tris, "clips": rep}, ensure_ascii=False))
    return rep


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
