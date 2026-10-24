"""Replace a PLOH character's hand-keyed clips with Meshy library mocap clips (requested on the character's own rigging task).

The skin and weapon nodes are copied from the hand-keyed GLB (raw/<name>_handkeyed.glb); the body is the mobile decimation
(decimate_body.py) re-textured with a fresh UV atlas baked from the full-res body (rebake_body.py; NO_REBAKE=1 keeps the old
decimated atlas). The animations are rebuilt (30 fps, a key on every frame, T/R/S for all 24 joints, LINEAR).
Per clip: trim / sequence / procedural -> retime -> hand overrides (reach IK, weapon aim, shield facing) -> (two-handed grip IK)
-> strip horizontal Hips motion -> ease the edges into the idle pose (or a lying pose) -> foot plants (step_feet / replant)
-> late overrides -> loop fix -> weapon-through-body fix (clipcheck.declip) -> off hand on the blade / weapon on the floor.
The removed Hips X/Z goes to <name>_root.json next to the GLB.
Characters without a hand-keyed GLB (archer, conscript_shield) use a base built in Blender with the same name
(tools/blender/archer_base.py, graft_shield.py).

usage: uv run --no-project --with numpy --with scipy python mocap_build.py <character> [out.glb]   (NO_DECLIP=1 skips the weapon fix)
characters: astrid fram schneider conscript shieldbearer conscript_shield boss archer
"""
import sys, os, json, shutil, subprocess
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gltfio as G, fk, motion as M, twohand, clipcheck

ASSETS = "/Users/lqez/dev/sandbox-games/ploh/game/assets/"
ATTACKS = ("attack_1", "attack_2", "attack_3", "cast", "spin", "shield_bash", "thrust", "counter")
BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"
DECIMATE = {"hero": 12000, "soldier": 8000}      # body triangle targets for mobile (weapons untouched)


def decimated_body(backup, raw, stem, target, opts=(), tag=""):
    """Blender collapse-decimate the body once and cache it as raw/<stem>_body<target><tag>.glb"""
    out = raw + f"{stem}_body{target}{tag}.glb"
    if not os.path.exists(out) or os.path.getmtime(out) < os.path.getmtime(os.path.join(HERE, "decimate_body.py")):
        r = subprocess.run([BLENDER, "-b", "--python", os.path.join(HERE, "decimate_body.py"), "--", backup, out, str(target)]
                           + [str(o) for o in opts], capture_output=True, text=True)
        line = next((l for l in r.stdout.splitlines() if l.startswith("DECIMATE")), None)
        if line is None:
            raise SystemExit("decimate failed:\n" + r.stdout[-2000:] + r.stderr[-2000:])
        print(line)
    return out


def rebake_dec_opts(opts=()):
    """decimate_body.py options for a body that will be re-textured: the old UV seams need no protection (seam_keep=1),
    which leaves the triangle budget to the shape (hair strands and the face stay close to the full-res mesh)"""
    o = list(opts) + [0.1, 0.2, 0.0, 0.35, 10.0][len(opts):]      # decimate_body.py defaults
    o[3] = 1.0
    return tuple(o)


def rebaked_body(backup, raw, stem, target, dec):
    """decimated body with a fresh UV atlas and its base colour baked from the full-res body (rebake_body.py), cached as
    raw/<stem>_body<target>_baked.glb (+ _baked.png). The collapse drags UVs across the tiny Meshy atlas islands (white/skin
    slivers in hair); the bake removes that. Rebuilt when missing or older than the decimated body or the scripts."""
    out = raw + f"{stem}_body{target}_baked.glb"
    deps = [dec, os.path.join(HERE, "rebake_body.py"), os.path.join(HERE, "xatlas_uv.py")]
    if not os.path.exists(out) or os.path.getmtime(out) < max(os.path.getmtime(p) for p in deps):
        r = subprocess.run([BLENDER, "-b", "--python", os.path.join(HERE, "rebake_body.py"), "--", backup, dec, out,
                            raw + f"{stem}_body{target}_baked.png"], capture_output=True, text=True)
        line = next((l for l in r.stdout.splitlines() if l.startswith("REBAKE")), None)
        if line is None:
            raise SystemExit("rebake failed:\n" + r.stdout[-2000:] + r.stderr[-2000:])
        print(line)
    return out

# clip spec: src = Meshy clip name, a/b = frame range (inclusive, b=-1 last), loop, bi/bo = frames eased from/into idle frame 0,
# lf = loop-fix frames, ik = two-handed grip (characters with "twohand"), speed = time scale (>1 slower),
# mirror = left/right mirror (applied first), measure = weapon used for the strike frame (default: the character's weapon), bi_prev = clip whose last frame is the blend-in pose (combo chaining), cut = [(f0, f1)] source frames f0..f1-1 removed (static holds), tail = frames appended easing from the last frame into idle,
# arms = bones whose local rotation is taken from idle frame 0 (weapon arm stays in guard during a flinch)
# v2 (2026-10-24): proc="sidestep" (+side, dist, n) = procedural lateral dash from idle (motion.sidestep); seq = [(src, a, b), ...]
# segments played back to back; warp = [(source frame - a, output frame), ...] piecewise retime; hold0 = hold the first frame k
# frames (a blend-in then raises into it fast); arms_from = (src, frame) arm pose from another library clip (arms_bones);
# reach = dict(side, add, dir, ramp) hand moved along dir with IK; aim = dict(dir, ramp, frame) weapon pointed along dir
# (motion.aim_weapon, from the idle weapon direction and back); shield = dict(face, up, ramp, frame) or list: shield squared to a
# direction (motion.orient_prop, needs the character's shield_axes); to = clip whose frame 0 is the bo/tail target (else idle);
# window = (first, last) parry/guard frames reported; release = first frame to search for the bow release; declip_* = options of
# the weapon-through-body fix (declip_ends 'first' for clips nothing follows, declip_floor, declip_skip, declip_protect).
# ramp = (a, b, c, d): weight 0 before a, up to 1 by b, 1 until c, back to 0 by d (frames of the clip at that step).
# v3 (2026-10-24): replant = True or dict(min_lift, h_tol, v_tol): lock every foot plant of a travelling clip (zero slip) and put
# the first/last plants on the blend poses' stance (M.replant; replaces step_feet); step_feet = False / 'start';
# bi_from = 'lie_up' / 'lie_down': blend in from a generated flat lying pose (M.lying_pose; get-ups), to = 'lie_up': settle into it;
# settle = (-k,): over the last k frames the hands go round the outside of the lying body, props laid outward (M.settle_arms);
# floor_hands: hands lifted out of the floor (M.hands_above_floor); aim = dict(..., late=True): aim after the edge blends
# ('dir' may be 'lie_up' / 'lie_down' = the weapon as laid in that pose); shield_late = dict(face, up, ramp): same for the shield;
# orient = dict(face, up, ramp[, weapon]): full blade orientation (axis + edge); place = dict(side, at, ref, keep_motion, ramp):
# hand to a point in front of its shoulder (M.place_hand; at may be {"x", "y", "fwd": fraction of the arm length});
# press = dict(frac, ramp): off-hand palm on the flat of the blade (twohand.blade_press); load = dict(lean, dip, ramp): heavy
# wind-up (torso back, hips down, feet kept); plant = (f0, f1): weapon held on the floor (M.plant_weapon); resmooth /
# resmooth_late = [(bone, f0, f1)]: eased slerp over a pop (before / after the blends); arms_ramp = ramp for `arms`;
# ik_ramp = weight ramp of the two-handed grip IK; xfade = crossfade frames between seq segments; root_from_feet: travel of an
# in-place library walk rebuilt from the supporting foot; face_fwd = clip name: torso turned to that clip's chest facing.
ARMS_R = ["RightShoulder", "RightArm", "RightForeArm", "RightHand"]
ARMS = ARMS_R + ["LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand"]
# hero parry / side-dash / counter thrust (shared by the three heroes; schneider's mace gets the two-handed grip IK on top)
# parry: Sword Parry Backward (148) = blade raised across the body, knocked back and recovered. The first source pose is held
#   3 frames so the blend from idle raises the guard in 0.1 s, the recoil plays 1.5x fast, then 5 frames back into idle.
# thrust: Right Jab from Guard (192) drives the fist straight out with a lunge; the hand is turned so the weapon points
#   forward (slightly down) from the wind-up through the extension, which makes the jab a stab.
# sidestep_l/_r: no library clip is a clean lateral dash (Stand Dodge 1 turns 77 deg, Stand Dodge 3 ends cross-legged, the
#   fight strafes are in-place diagonal runs), so it is generated from the idle pose (motion.sidestep).
# roll: the weapon is carried down along the right side of the body (chest frame) instead of the mocap's forward-held blade,
# which cut through the legs and head while rolling; clipcheck.declip cleans up the rest
DODGE_AIM = dict(dir=[-0.2, -1, 0], ramp=(2, 8, 30, 37), frame="chest", from_idle=False)   # (+ declip_floor in the spec)
HERO_NEW = {
    "parry": dict(src="Sword_Parry_Backward", a=0, b=13, speed=0.65, hold0=3, bi=3, tail=5, window=(3, -5), measure=True),
    "sidestep_l": dict(proc="sidestep", side=1, dist=0.5, n=14),
    "sidestep_r": dict(proc="sidestep", side=-1, dist=0.5, n=14),
    "thrust": dict(src="Right_Jab_from_Guard", a=6, b=30, warp=[(0, 0), (7, 10), (11, 12), (14, 16), (24, 24)], bi=8, tail=10,
                   reach=dict(add=0.10, ramp=(10, 12, 15, 20)), aim=dict(dir=[0, -0.08, 1], ramp=(0, 9, 17, 24))),
}
# shield soldiers (shieldbearer, conscript_shield): block -> parry (shield punch deflect) -> counter (thrust).
# The library has no shield block; Block2/Block4 (boxing high guard / weave) give the body and the shield arm, the boxing fist
# would lay the shield flat over the head, so the shield is squared to the front (orient_prop) and lowered 10 cm (IK).
# The sword arm keeps the idle guard (the boxing guard put the blade through the helmet).
ARMS_L = ["LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand"]
SB_FACE = dict(face=[0, 0.12, 1], up=[0, 1, 0])
LOWER_L = dict(side="Left", add=0.10, dir=(0, -1, 0), ramp=(-1, 0, 9999, 10000))
SHIELD_NEW = {
    "block": dict(src="Block2", loop=True, lf=4, arms=ARMS_R, reach=[LOWER_L], shield=SB_FACE),
    # Block4 = the guard knocked back toward the chest and recovered: played 1.7x fast from and back into block
    "block_hit": dict(src="Block4", a=0, b=32, speed=0.6, arms=ARMS_R, reach=[LOWER_L], shield=SB_FACE, bi=3, bi_prev="block",
                      bo=4, to="block"),
    # Left Jab from Guard: the shield arm punches out (deflect) and comes back; the punch is retimed to 3 frames
    "parry": dict(src="Left_Jab_from_Guard", a=2, b=40, warp=[(0, 0), (4, 2), (12, 5), (16, 8), (38, 20)], arms=ARMS_R,
                  reach=[LOWER_L], shield=SB_FACE, bi=3, bi_prev="block", tail=4, to="block", window=(3, 9), measure="weapon_shield"),
    # same thrust as the heroes (Right Jab + weapon aimed forward), shield kept up in front, from the parry's end into idle
    # the shield swings open to the left while the blade goes out (otherwise the thrust passes through it)
    "counter": dict(src="Right_Jab_from_Guard", a=6, b=30, warp=[(0, 0), (7, 10), (11, 12), (14, 16), (24, 24)], bi=6,
                    bi_prev="parry", tail=10, reach=[dict(add=0.10, ramp=(10, 12, 15, 20)), LOWER_L,
                                                     dict(side="Left", add=0.16, dir=(0.9, 0, -0.45), ramp=(4, 10, 16, 26))],
                    aim=dict(dir=[0, -0.08, 1], ramp=(0, 9, 17, 24)),
                    shield=[SB_FACE, dict(face=[0.75, 0.1, 0.65], up=[0, 1, 0], ramp=(4, 10, 16, 26))]),
}
# v3 (2026-10-24): heavy-hit reactions for every character (library actions requested on each rig as 'react' / 'prone'):
# stumble: Crouch and Step Back (404) from the moment the chest is thrown back (source 16-60, 1.25x): a backward hop on the
#   left foot, then right-left-right steps; arms keep the idle guard; replant locks every foot plant (no slip) and puts the first
#   and last plants on the idle stance. No library hit reaction has clean backward steps (Hit Reaction 178 slides sideways, the
#   face-punch reactions stay planted, Walk Backward is a calm walk), this one does.
# knockdown: Shot and Blown Back (182) from the hit (source 22): thrown off the feet, lands on the back, settles into the flat
#   lying pose (lie_up). getup: Spin Down and Stand Up (100) from its lying phase (source 96-212, played 1.43x fast):
#   sits up, rolls onto a knee, stands into the stance; starts from lie_up = the knockdown's last frame. getup_front: Stand Up 8
#   (351) from lying face down (lie_down): push-up, crouch, stand.
# lie_up / lie_down (M.lying_pose): body straight, arms relaxed beside it, props flat on the floor beside the body.
def react(two_handed=False, bow=False):
    r = {
        "stumble": dict(src="Crouch_and_Step_Back", a=16, b=60, speed=0.8, bi=4, bo=8, arms=ARMS, replant=dict(min_lift=0.06, v_tol=0.6)),
        # settling into lie_up, the hands go round the outside of the body and the weapon is laid down pointing outward (the
        # mocap ends with the sword hand above the head and the blade across beyond the crown; a plain pose blend dragged it
        # over the face)
        "knockdown": dict(src="Shot_and_Blown_Back", a=22, b=68, bi=4, tail=16, to="lie_up", step_feet="start", declip_floor=True,
                          floor_hands=True, settle=(-17,)),
        "getup": dict(src="Rightward_Spin", a=96, b=212, speed=0.7, bi=12, bi_from="lie_up", bo=8, replant=dict(min_lift=0.05),
                      declip_floor=True, floor_hands=True, aim=dict(dir="lie_up", ramp=(-1, 0, 8, 24), late=True),
                      resmooth_late=[(b_, 0, 12) for b_ in ("LeftForeArm", "LeftHand", "RightForeArm", "RightHand")]),
        # the push-up holds the blade flat on the floor pointing ahead (toward the head; the mocap lays it across under the
        # body and drives it up to 43 cm into the floor while rising), handed back to the mocap while standing up; the
        # source's 47-degree left wrist flip at frame 26 is eased out
        "getup_front": dict(src="Stand_Up8", bi=12, bi_from="lie_down", bo=8, replant=dict(min_lift=0.05), declip_floor=True, floor_hands=True,
                            aim=dict(dir="lie_down", ramp=(-1, 0, 26, 44), late=True),
                            shield_late=dict(face=[0, 1, 0], up=[0, 0, 1], ramp=(-1, 0, 24, 40)),   # shield face up over the forearm
                            resmooth=[("LeftHand", 22, 31)], resmooth_late=[("LeftHand", 22, 42)]),   # one eased turn back
    }
    if bow:              # standing up, the arms go into the idle's bow hold (the sword-and-shield mocap swings the bow through the legs)
        r["getup"].update(arms=ARMS, arms_ramp=(52, 68, 9999, 10000)); r["getup_front"].update(arms=ARMS, arms_ramp=(36, 52, 9999, 10000))
    if two_handed:       # arms from idle keep the grip; lying and getting up the off hand lets go and re-grips while standing
        r["stumble"]["ik"] = False; r["knockdown"]["ik"] = False
        r["getup"]["ik_ramp"] = (55, 70, 9999, 10000); r["getup_front"]["ik_ramp"] = (45, 60, 9999, 10000)
        # the long mace stays flat along the floor while sitting up (the sword mocap drives it 20 cm into the floor)
        r["getup"]["aim"] = dict(dir="lie_up", ramp=(-1, 0, 30, 52), late=True)
    return r


# v3 hero guard set (hold-to-guard control): guard idle + guarded walks + run stop + trip. Library actions requested on each
# hero's rig as 'guard' (Walk Fight Forward 21, Walk Backward with Sword 546, Walk Left with Gun 528, Sprint and Sudden Stop 531,
# Hit in Back While Running 416). The guard holds Sword Parry Backward's raised-blade arms (frame 6) on the stance body;
# astrid presses the off hand on the blade, fram holds the shield straight out with the sword in the idle guard, schneider
# keeps the two-handed grip. The walks are sped up to about 0.75-0.8 m/s at model scale (1.2-1.3 m/s at the heroes' 1.6).
# Walk Fight Forward is in place: its travel is rebuilt from the supporting foot (M.root_from_feet). The gun walk steps to the
# character's right with the torso turned away: face_fwd turns the torso to face straight ahead; mirrored for the left.
# The walk loops lock their foot plants (replant on loops).
LOOP_PLANTS = dict(min_lift=0.03, v_tol=0.8)


def guard_set(kind):
    if kind == "press":
        g = dict(arms_from=("Sword_Parry_Backward", 6), press=dict(frac=0.55, ramp=(-1, 0, 9999, 10000)))
    elif kind == "shield":      # sword-and-shield guard: shield straight out in front, sword arm in the idle guard (the raised
        g = dict(arms=ARMS_R, place=SB_OUT, shield=SB_FRONT)    # parry blade crossed into the shield on every walking step)
    else:
        g = dict(arms_from=("Sword_Parry_Backward", 6))
    return {
        "guard": dict(src="Combat_Stance", loop=True, lf=4, **g),
        "guard_fwd": dict(src="Walk_Fight_Forward", loop=True, lf=4, root_from_feet=True, speed=0.7, replant=LOOP_PLANTS, **g),
        "guard_back": dict(src="Walk_Backward_with_Sword", loop=True, lf=4, speed=0.57, replant=LOOP_PLANTS, **g),
        "strafe_r": dict(src="Walk_Left_with_Gun", loop=True, lf=4, speed=0.6, face_fwd=0.0, replant=LOOP_PLANTS, **g),
        "strafe_l": dict(src="Walk_Left_with_Gun", loop=True, lf=4, speed=0.6, mirror=True, face_fwd=0.0, replant=LOOP_PLANTS, **g),
        # sprint -> three braking steps with the weight back -> combat idle (arms keep the idle guard)
        "run_stop": dict(src="Sprint_and_Sudden_Stop", a=8, b=55, bi=4, bi_prev="run", bo=10, arms=ARMS,
                         replant=dict(min_lift=0.05, v_tol=0.6, start=False)),
        # near trip out of the run: lurch forward, arms flail, a big catching step, recover into idle (1.25x)
        "trip": dict(src="Hit_in_Back_While_Running", a=12, b=52, speed=0.8, bi=6, bi_prev="run", bo=10,
                     replant=dict(min_lift=0.05, v_tol=0.6, start=False),
                     **(dict(ik_ramp=(22, 30, 9999, 10000)) if kind == "twohand" else {})),   # flailing: the off hand lets go
    } | ({"run_stop": dict(src="Sprint_and_Sudden_Stop", a=8, b=55, bi=4, bi_prev="run", bo=10, arms=ARMS, ik=False,
                           replant=dict(min_lift=0.05, v_tol=0.6, start=False))} if kind == "twohand" else {})


# hero parry, half-sword guard (astrid; fram's off hand holds his shield): the off-hand palm on the flat of the blade at 55% of its length while the guard
# is up (twohand.blade_press, after the weapon fix)
PRESS = dict(frac=0.55, ramp=(0, 3, 11, 16))
# shield soldiers v3: the shield held straight out in front (the attacker is straight ahead): left hand 80% of the arm length in
# front of the shoulder, 4 cm toward the middle, 5 cm down, the clip's own hand motion on top; face square to +Z, top up
SB_OUT = dict(side="Left", at={"x": -0.04, "y": -0.05, "fwd": 0.8})
SB_FRONT = dict(face=[0, 0, 1], up=[0, 1, 0])
SHIELD_NEW = dict(SHIELD_NEW,
                  block=dict(SHIELD_NEW["block"], reach=None, place=SB_OUT, shield=SB_FRONT),
                  # (6 cm further out to the left: knocked back toward the chest the shield otherwise meets the guarding sword)
                  block_hit=dict(SHIELD_NEW["block_hit"], reach=None, place=dict(SB_OUT, at={"x": 0.06, "y": -0.05, "fwd": 0.8}),
                                 shield=SB_FRONT),
                  parry=dict(SHIELD_NEW["parry"], reach=None, place=SB_OUT, shield=SB_FRONT))
# v5 (2026-10-24) astrid only: Frau's real weapon is six floating blades she commands by gesture (research/motion/FRAU_COMBAT.md);
# the game animates the blades, these are the body gestures. Library actions requested on the v4 rig as 'cmd' / 'cmd2'. The
# command frame (hand fully extended / landed) is reported as 'command' in the build report. The sword mesh is hidden in game.
CMD = {
    # Let's GO!: Mage Spell Cast 7 (136) = step-in, right arm thrust straight out, palm open; the thrust 15 -> 10 frames
    "cmd_1": dict(src="mage_soell_cast_7", a=12, b=57, warp=[(0, 0), (15, 10), (20, 13), (45, 24)], bi=4, bo=6, command="Right"),
    # mirror-ish: Mage Spell Cast 1 (130) left arm sweeps from across the body out to the left (sword arm kept in idle)
    "cmd_2": dict(src="mage_soell_cast_1", a=12, b=36, warp=[(0, 0), (12, 9), (15, 11), (24, 20)], bi=4, tail=4, arms=ARMS_R, command="Left"),
    # overhead command: Charged Spell Cast (125) both arms raised high, then slammed down into a crouch
    "cmd_3": dict(src="Charged_Spell_Cast", a=0, b=24, warp=[(0, 0), (12, 10), (15, 12), (21, 18), (24, 22)], bi=4, tail=10, command="down"),
    # Let's SHOOT!: Mage Spell Cast 6 (135) mirrored = crouch, the left arm thrust straight up (finger snap), held 0.3 s
    "cmd_fire": dict(src="mage_soell_cast_6", a=6, b=57, mirror=True, warp=[(0, 0), (12, 6), (21, 12), (27, 15), (36, 27), (51, 38)],
                     bi=4, bo=6, command="Left"),
    # Let's PARTY!: Backflip (452) = crouch, backflip, land in a crouch, rise
    "cmd_ult": dict(src="Backflip", bi=4, bo=6, command="land"),
    # guard: combat idle body with Block1's half-raised boxing guard arms, torso 6 deg back and hips 3 cm lower (weight back)
    "cmd_guard": dict(src="Combat_Stance", loop=True, lf=4, arms_from=("Block1", 0), load=dict(lean=-6, dip=0.03, ramp=(-1, 0, 9999, 10000))),
    # hero-screen stance: Hand on Hip Gesture (315) 24-52, right hand on the hip, left arm relaxed
    "cmd_idle": dict(src="Hand_on_Hip_Gesture", a=24, b=52, loop=True, lf=6),
}
SPEC = {
    # 프라우: 한손검, 민첩. 콤보는 Double Combo Attack(92, 검을 들고 찍은 모캡) 한 벌을 칼끝 속도가 가장 느린 멈춤에서 셋으로 나눈다
    # v4 (2026-10-24): 몸을 공식 3면도로 다시 만들어(raw/astrid_handkeyed.glb = tools/blender/astrid_build.py 결과, 손 키 동작 없음)
    # 라이브러리 동작을 새 리그에 세 묶음(mocap / hero2 / guard)으로 다시 요청했다. 클립 표는 그대로.
    # 감축: 보호 가중치 없이 순수 쿼드릭(dec_opts 모두 1). 머리·손을 보호하면 가는 다리·신발이 판자처럼 뭉개진다(가중치 비용이
    # 쿼드릭 오차를 압도해 자유 영역에 붕괴가 몰림). 균일 감축이면 12k에서 다리·신발·머리카락이 다 살아남는다.
    "astrid": {
        "tris": DECIMATE["hero"], "dec_opts": (1.0, 1.0, 1.0, 1.0, 10.0),
        "glb": "astrid/B_mid/astrid.glb", "weapon": "weapon_sword",
        "src": ["animations_mocap.glb", "animations_hero2.glb", "animations_guard.glb", "animations_cmd.glb", "animations_cmd2.glb"],
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
            "dodge": dict(src="Roll_Dodge_1", bi=4, bo=6, aim=DODGE_AIM, declip_floor=True),
            "hit": dict(src="Hit_Reaction_1", a=0, b=22, bi=3, bo=8, arms=ARMS),
            "death": dict(src="Dead", bi=4, declip_ends="first"),
            **HERO_NEW,
            "parry": dict(HERO_NEW["parry"], press=PRESS),
            **react(),
            **guard_set("press"),
            **CMD,
        },
    },
    # 프람: 검과 방패. 콤보는 Triple Combo Attack(105)을 셋으로 나눈다
    "fram": {
        "tris": DECIMATE["hero"],
        "glb": "fram/fram.glb", "weapon": "weapon_sword",
        "src": ["animations.glb", "animations_survey1.glb", "animations_survey2.glb", "animations_survey3.glb", "animations_mocap.glb",
                "animations_thrust.glb", "animations_react.glb", "animations_prone.glb", "animations_guard.glb"],
        "clips": {
            "idle": dict(src="Combat_Stance", loop=True, lf=4),
            "run": dict(src="Run_02", loop=True, lf=4),
            "attack_1": dict(src="Triple_Combo_Attack", a=0, b=36, bi=6),
            # v2: the sword sweeps behind the back through the shield (frames 14-20); the shield hand moves 25 cm out of its way
            "attack_2": dict(src="Triple_Combo_Attack", a=36, b=60, reach=[dict(side="Left", add=0.25, dir=(0.7, 0.5, 0.5), ramp=(9, 13, 21, 24))]),
            "attack_3": dict(src="Triple_Combo_Attack", a=60, b=92, bo=12),
            "cast": dict(src="Basic_Jump", a=32, b=122, bi=6, bo=12),
            "spin": dict(src="Axe_Spin_Attack", a=0, b=60, bi=6, bo=10),
            "dodge": dict(src="Roll_Dodge_1", bi=4, bo=6, aim=DODGE_AIM, declip_floor=True),
            "hit": dict(src="Hit_Reaction_1", a=0, b=22, bi=3, bo=8, arms=ARMS),
            "death": dict(src="Dead", bi=4, declip_ends="first"),
            **HERO_NEW,
            # the boxing guard / open-palm parry hold the fist knuckles-up, which lays the shield flat: square it to the front
            # (no half-sword press: the off hand holds the shield, which would cover the blade; tried: blade 3.8 cm in the shield)
            "parry": dict(HERO_NEW["parry"], shield=dict(face=[0, 0.15, 1], up=[0, 1, 0], ramp=(0, 3, 11, 16))),
            "thrust": dict(HERO_NEW["thrust"], shield=dict(face=[0, 0, 1], up=[0, 1, 0], ramp=(0, 8, 22, 34))),
            **react(),
            **guard_set("shield"),
        },
        "shield_axes": {"face": [1, 0, 0], "up": [0, 1, 0]},     # weapon_shield node axes (glTF): +X front face, +Y top
    },
    # 슈나이더: 양손 메이스. 모든 무기 동작에서 왼 주먹을 자루에 붙인다(twohand.shaft_ik)
    "schneider": {
        "tris": DECIMATE["hero"],
        "glb": "schneider/schneider.glb", "weapon": "weapon_mace", "twohand": True,
        "src": ["animations.glb", "animations_mocap.glb", "animations_parry.glb", "animations_react.glb", "animations_prone.glb",
                "animations_guard.glb"],
        "clips": {
            "idle": dict(src="Combat_Stance", loop=True, lf=4),
            "run": dict(src="Run_02", loop=True, lf=4, ik=False),
            "attack_1": dict(src="Attack", a=0, b=50, bi=10, tail=14),
            "attack_2": dict(src="Heavy_Hammer_Swing", a=0, b=-1, bi=14, tail=16),
            "attack_3": dict(src="Charged_Ground_Slam", a=0, b=-1, cut=[(18, 33)], bi=6, bo=6),
            "cast": dict(src="Basic_Jump", a=32, b=122, bi=6, bo=12),
            "spin": dict(src="Axe_Spin_Attack", a=0, b=60, bi=6, bo=10),
            # the long mace needs the turn to start at once (with the shared 2-8 ramp it still swept the legs on frames 5-6)
            "dodge": dict(src="Roll_Dodge_1", bi=4, bo=6, ik=False, aim=dict(DODGE_AIM, ramp=(0, 4, 30, 37)), declip_floor=True),
            "hit": dict(src="Hit_Reaction_1", a=0, b=22, bi=3, bo=8, arms=ARMS, ik=False),
            "death": dict(src="Dead", bi=4, ik=False, declip_ends="first"),
            **HERO_NEW,
            **react(two_handed=True),
            **guard_set("twohand"),
        },
    },
    # 징집병: 한손검
    "conscript": {
        "tris": DECIMATE["soldier"],
        "glb": "soldiers/conscript/conscript.glb", "weapon": "weapon_sword",
        "src": ["animations.glb", "basic_running.glb", "animations_mocap.glb", "animations_prop.glb", "animations_survey_hr1.glb",
                "animations_survey_hr2.glb"],
        "clips": {
            "idle": dict(src="Combat_Stance", loop=True, lf=4),
            "walk": dict(src="Walk_Fight_Forward", loop=True, lf=4),
            "run": dict(src="running", loop=True, lf=4),
            "attack_1": dict(src="Left_Slash", a=0, b=34, bi=6, tail=12),
            "attack_2": dict(src="Double_Combo_Attack", a=0, b=30, bi=6, tail=12),
            "hit": dict(src="Hit_Reaction_1", a=0, b=22, bi=3, bo=8, arms=ARMS),
            "death": dict(src="dying_backwards", bi=4, declip_ends="first"),
            **react(),
        },
    },
    # 방패병: 검과 방패
    "shieldbearer": {
        "tris": DECIMATE["soldier"],
        "glb": "soldiers/shieldbearer/shieldbearer.glb", "weapon": "weapon_sword",
        "src": ["animations.glb", "basic_running.glb", "animations_mocap.glb", "animations_prop.glb", "animations_bash.glb",
                "animations_parry.glb", "animations_react.glb", "animations_prone.glb"],
        "shield_axes": {"face": [1, 0, 0], "up": [0, 0, -1]},   # weapon_shield node axes (glTF): +X outer face, -Z top
        "clips": {
            "idle": dict(src="Combat_Stance", loop=True, lf=4),
            # v2: Walk Fight Forward holds the sword two-handed (the shield went through the right leg and the blade through the
            # shield on every frame) and the basic run swings the shield flat into the torso: carry the shield arm as in idle
            "walk": dict(src="Walk_Fight_Forward", loop=True, lf=4, arms_from=("Combat_Stance", 0), arms_bones=ARMS_L, shield=SB_FACE),
            "run": dict(src="running", loop=True, lf=4, arms_from=("Combat_Stance", 0), arms_bones=ARMS_L, shield=SB_FACE),
            "attack_1": dict(src="Triple_Combo_Attack", a=0, b=29, bi=6, tail=14),
            # no shield bash in the library; Shield Push Left swings the shield edge-on to the side. A straight punch drives
            # the knuckles (= shield face) forward, so Boxing Guard, Prep Straight Punch (210) is mirrored onto the shield arm.
            # v2: the punch is retimed (6 -> 3 frames) and the shield is squared to the front through the whole bash
            # (the fist alone turned it edge-on at the hit)
            "shield_bash": dict(src="Boxing_Guard_Prep_Straight_Punch", a=30, b=84, mirror=True, warp=[(0, 0), (20, 18), (27, 21), (54, 44)],
                                bi=10, bo=12, measure="weapon_shield", arms=ARMS_R, shield=dict(SB_FACE, ramp=(0, 8, 30, 44))),
            **SHIELD_NEW,
            "hit": dict(src="Hit_Reaction_1", a=0, b=22, bi=3, bo=8, arms=ARMS),
            "death": dict(src="Fall_Dead_from_Abdominal_Injury", bi=4, declip_ends="first"),
            **react(),
        },
    },
    # 방패 징집병: 징집병 몸·검 + 방벽병 방패(0.85배)를 왼손에. 라이브러리 클립은 징집병 리그(conscript/raw)에 요청한 것을 쓴다
    "conscript_shield": {
        "tris": DECIMATE["soldier"],
        "glb": "soldiers/conscript_shield/conscript_shield.glb", "weapon": "weapon_sword", "anim_raw": "soldiers/conscript/raw/",
        "src": ["animations.glb", "basic_running.glb", "animations_mocap.glb", "animations_prop.glb", "animations_shield.glb",
                "animations_survey_hr1.glb", "animations_survey_hr2.glb"],
        "shield_axes": {"face": [1, 0, 0], "up": [0, 0, -1]},
        "clips": {
            "idle": dict(src="Combat_Stance", loop=True, lf=4),
            # the walk holds the sword two-handed and the run swings the shield flat: carry the shield arm as in idle, squared
            "walk": dict(src="Walk_Fight_Forward", loop=True, lf=4, arms_from=("Combat_Stance", 0), arms_bones=ARMS_L, shield=SB_FACE),
            "run": dict(src="running", loop=True, lf=4, arms_from=("Combat_Stance", 0), arms_bones=ARMS_L, shield=SB_FACE),
            "attack_1": dict(src="Left_Slash", a=0, b=34, bi=6, tail=12),
            **{k: v for k, v in SHIELD_NEW.items() if k != "block_hit"},
            "hit": dict(src="Hit_Reaction_1", a=0, b=22, bi=3, bo=8, arms=ARMS),
            "death": dict(src="dying_backwards", bi=4, declip_ends="first"),
            **react(),
        },
    },
    # 궁수: 왼손 활(weapon_bow). 화살은 게임이 release 프레임에 오른손에서 만든다
    "archer": {
        "tris": DECIMATE["soldier"],
        "glb": "soldiers/archer/archer.glb", "weapon": "weapon_bow",
        "src": ["animations_mocap.glb", "animations_mocap2.glb", "animations_idle.glb", "basic_walking.glb", "basic_running.glb",
                "animations_react.glb", "animations_prone.glb"],
        "clips": {
            # Combat Idle body (weight shift, breathing) with both arms in the relaxed bow hold of Archery Shot (bow low in front)
            "idle": dict(src="Combat_Stance", loop=True, lf=4, arms_from=("Archery_Shot", 2)),
            "walk": dict(src="walking_man", loop=True, lf=4),
            "run": dict(src="Female_Bow_Charge_Left_Hand", loop=True, lf=4),
            # draw an arrow from the back quiver, nock, draw, hold, release. Archery Shot 1 + 2 + 3 are one take split in three
            # (their joints meet); the whole shot is turned -102 deg so the arrow flies along the character's +Z
            "shoot": dict(seq=[("Archery_Shot_1", 0, 30), ("Archery_Shot_2", 0, 8), ("Archery_Shot_3", 0, 20)], yaw=-102,
                          bi=8, tail=10, release=36),
            "hop_back": dict(src="Back_Jump", bi=4, bo=6),
            "step_back": dict(src="Step_Back", bi=4, bo=4),
            "hit": dict(src="Hit_Reaction_with_Bow", a=0, b=24, bi=3, tail=8),
            "death": dict(src="dying_backwards", bi=4, declip_ends="first"),
            **react(bow=True),
        },
    },
    # 요슈아(보스): 한손 펜듈럼 메이스
    "boss": {
        "tris": DECIMATE["soldier"],
        "glb": "soldiers/boss/boss.glb", "weapon": "weapon_pendulum",
        # the hand-keyed build aimed the pendulum out of the back of the hand; mocap needs the sword convention (thumb side)
        "weapon_dir": {"weapon_pendulum": [-0.58, 0.0, 0.81]},
        "src": ["animations.glb", "basic_running.glb", "animations_mocap.glb", "animations_react.glb", "animations_prone.glb"],
        "clips": {
            "idle": dict(src="Combat_Stance", loop=True, lf=4),
            "walk": dict(src="Walk_Fight_Forward", loop=True, lf=4),
            "run": dict(src="running", loop=True, lf=4),
            # v3 heavy: slow heave (torso leans back, hips sink) -> short hold at the top -> fast drop -> the head bites the floor
            # and stays planted -> slow drag back up (warp = [(source frame, output frame), ...])
            "attack_1": dict(src="Charged_Ground_Slam", warp=[(0, 0), (12, 30), (34, 38), (52, 44), (68, 64), (90, 100)],
                             load=dict(lean=-12, dip=0.045, ramp=(2, 28, 36, 42)), bi=6, bo=6, declip_floor=True, plant=(46, 66)),
            # the horizontal swing ends with the weapon's weight pulling its head down onto the floor (aimed forward-down)
            "attack_2": dict(src="Charged_Slash", a=0, b=60, warp=[(0, 0), (20, 30), (30, 38), (36, 41), (44, 50), (44, 62), (60, 94)],
                             load=dict(lean=-10, dip=0.04, ramp=(2, 26, 36, 40)),
                             aim=dict(dir=[0.35, -0.75, 0.55], ramp=(41, 48, 62, 80), from_idle=False), bi=6, bo=8, declip_floor=True),
            "cast": dict(src="Basic_Jump", a=32, b=122, bi=6, bo=12),
            "hit": dict(src="Hit_Reaction_1", a=0, b=22, bi=3, bo=8, arms=ARMS),
            "death": dict(src="dying_backwards", bi=4, declip_ends="first"),
            **react(),
            # throne cutscene: upright seated loop (Sit on Chair Arms Crossed body, hands from Sit to Stand's seated frame), the
            # right hand on the right thigh, the weapon lying across his lap pointing to his left (the 1.1 m weapon cannot be
            # planted head-down from a seated hand at 0.5 m)
            "throne_sit": dict(src="Sit_on_Chair_Arms_Crossed", loop=True, lf=8, arms_from=("Sit_to_Stand_Transition_M", 0),
                               place=dict(side="Right", ref="RightUpLeg", at=(0.0, 0.11, 0.16), keep_motion=False),
                               aim=dict(dir=[1.0, 0.02, 0.18], ramp=(-1, 0, 9999, 10000), from_idle=False), declip_floor=True),
            # stands up slowly and heavily (Sit to Stand 30-88) lifting the weapon off his lap, points it at the enemy (Chest
            # Pound Taunt 0-24, the taunt's opening), then into combat idle
            "throne_rise": dict(seq=[("Sit_to_Stand_Transition_M", 30, 88), ("Chest_Pound_Taunt", 0, 24)], xfade=10,
                                place=dict(side="Right", ref="RightUpLeg", at=(0.0, 0.11, 0.16), keep_motion=False, ramp=(-1, 0, 10, 30)),
                                aim=dict(dir=[1.0, 0.02, 0.18], ramp=(-1, 0, 12, 40), from_idle=False),
                                bi=12, bi_prev="throne_sit", bo=10, replant=dict(min_lift=0.04), declip_floor=True),
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
    chk = clipcheck.Checker(rig, backup, bool(sp.get("twohand"))) if sp.get("declip", True) and not os.environ.get("NO_DECLIP") else None
    body = None
    if sp.get("tris"):
        bj, _ = G.read_glb(backup)
        if os.environ.get("NO_REBAKE"):          # old behaviour: seam-protected decimation, original atlas UVs (slivers)
            body = G.body_from(decimated_body(backup, raw, stem, sp["tris"], sp.get("dec_opts", ())), bj)
        else:                                    # seam-free decimation + fresh atlas + base colour baked from the full body
            dec = decimated_body(backup, raw, stem, sp["tris"], rebake_dec_opts(sp.get("dec_opts", ())), "_free")
            body = G.body_from(rebaked_body(backup, raw, stem, sp["tris"], dec), bj)
    araw = ASSETS + sp["anim_raw"] if sp.get("anim_raw") else raw          # variants reuse the clips requested on their rig
    lib = M.load([araw + f for f in sp["src"] if os.path.exists(araw + f)])
    clips, root, rep = {}, {}, {}
    order = ["idle"] + [k for k in sp["clips"] if k != "idle"]
    idle = None
    lies, lie_axis, hand_l = {}, {}, {}

    def lie_dir(wn, face):
        """blade/bow direction in the lying poses: 17 deg out to the holding side, flat along the body, toward the feet on the
        back (as the get-up's mocap holds it) and toward the head on the front (tilted 6 deg up), so the get-ups hand it back
        to the mocap without a half-turn"""
        sx = 1.0 if rig.weapons[wn]["bone"].startswith("Left") else -1.0
        return [sx * 0.3, 0.0, 0.95] if face == "up" else [sx * 0.3, 0.1, 0.95]

    def lie(key):
        """flat lying pose 'lie_up' (on the back) / 'lie_down' (on the front), props laid flat beside the body"""
        if key not in lies:
            face = key.split("_")[1]
            bod = chk.body if chk is not None else clipcheck.Body(backup)
            wd = {wn: lie_dir(wn, face) for wn in rig.weapons if wn != "weapon_shield"}
            p = M.lying_pose(rig, M.frame_pose(idle, 0), bod, face, weapons=wd, shield_axes=sp.get("shield_axes"))
            if chk is not None:                  # props out of the body and the floor
                c3 = {"n": 3, "bones": {b: {k: np.repeat(np.asarray(v[k])[None], 3, 0) for k in ("T", "R", "S")} for b, v in p.items()}}
                for wn in sorted(rig.weapons, key=lambda w: 0 if w in ("weapon_shield", "weapon_bow") else 1):
                    c3, _ = clipcheck.declip(chk, c3, (name, key, wn, 0), wn, tol=0.01, floor=True)
                p = M.frame_pose(c3, 1)
            lies[key] = p
            lie_axis[key] = {wn: M.weapon_axis(rig, p, wn) for wn in rig.weapons}    # as laid (after the fix)
        return lies[key]
    for cn in order:
        d = sp["clips"][cn]
        if d.get("proc") == "sidestep":          # procedural lateral dash from the idle pose (no library clip fits, see README)
            c = M.sidestep(rig, M.frame_pose(idle, 0), d["side"], d.get("dist", 0.5), d.get("n", 14), d.get("lift", 0.06),
                           d.get("dip", 0.035), d.get("lean", 9.0))
            info = {"src": "procedural sidestep", "range": [0, d.get("n", 14) - 1]}
        elif d.get("seq"):                       # several library segments played back to back
            c = M.seq(lib, d["seq"], d.get("xfade", 0))
            info = {"src": "+".join(x[0] for x in d["seq"]), "range": [list(x[1:]) for x in d["seq"]]}
        else:
            c = M.sub(lib[d["src"]], d.get("a", 0), d.get("b", -1))
            info = {"src": d["src"], "range": [d.get("a", 0), d.get("b", -1) if d.get("b", -1) >= 0 else M.nframes(lib[d["src"]]) - 1]}
        if d.get("cut"):
            c = M.cut(c, [(x0 - d.get("a", 0), x1 - d.get("a", 0)) for x0, x1 in d["cut"]])
        if d.get("mirror"):
            c = M.mirror(rig, c)
        if d.get("root_from_feet"):              # in-place library walk: travel rebuilt from the supporting foot
            c, info["root_speed_mps"] = M.root_from_feet(rig, c, d["root_from_feet"] if not isinstance(d["root_from_feet"], bool) else None)
        if d.get("speed"):
            c = M.resample(c, d["speed"])
        if d.get("warp"):                        # piecewise retime [(source frame - a, output frame), ...]
            c = M.warp(c, d["warp"])
        if d.get("hold0"):                       # hold the first source pose so the blend-in raises into it quickly
            c = M.hold_first(c, d["hold0"])
        for bn, f0, f1 in d.get("resmooth", ()):  # replace a mocap pop (e.g. a wrist flip) by an eased slerp f0 -> f1
            R = c["bones"][bn]["R"]; u = M.smooth((np.arange(f0 + 1, f1) - f0) / (f1 - f0))
            R[f0 + 1:f1] = G.slerp(np.repeat(R[f0:f0 + 1], len(u), 0), np.repeat(R[f1:f1 + 1], len(u), 0), u)
        if d.get("load"):                        # heavy wind-up: torso leans back, hips sink, feet stay planted
            ld = d["load"]
            c = M.load_hips(rig, c, ld.get("lean", 0.0), ld.get("dip", 0.0), M.ramp(M.nframes(c), *ld["ramp"]))
        if d.get("face_fwd") is not None and idle is not None:   # torso turned to a facing (side-stepping walks): a number =
            ff = d["face_fwd"]                                       # degrees (0 = straight ahead), a name = that clip's chest
            tgt = float(ff) if not isinstance(ff, str) else float(M.chest_yaw(rig, M.sub(clips.get(ff, idle), 0, 0))[0])
            c, turn = M.face_yaw(rig, c, tgt)
            info["torso_turn_deg"] = round(turn, 1)
        if d.get("arms_from"):                   # arms (local) from another library clip's frame, e.g. the archer's bow hold
            src_c, src_f = d["arms_from"]
            M.bones_from_pose(c, M.frame_pose(lib[src_c], src_f), d.get("arms_bones", ARMS))
        for rc in ([d["reach"]] if isinstance(d.get("reach"), dict) else d.get("reach") or []):
            # move a hand along a direction with IK (hand rotation kept): a full-length thrust, a lowered shield
            c = M.reach(rig, c, rc.get("side", "Right"), rc["add"], M.ramp(M.nframes(c), *rc["ramp"]), rc.get("dir", (0, 0, 1.0)))
        for pc in ([d["place"]] if isinstance(d.get("place"), dict) else d.get("place") or []):
            # hand to a point in front of its shoulder (character frame), the clip's own hand motion kept on top
            w = M.ramp(M.nframes(c), *pc["ramp"]) if pc.get("ramp") else np.ones(M.nframes(c))
            at = pc["at"]
            if isinstance(at, dict):             # {"x", "y", "fwd": fraction of the arm length straight ahead}
                rg = M.rest_globals(rig); sd = pc.get("side", "Left")
                L = (np.linalg.norm(rg[sd + "ForeArm"][0] - rg[sd + "Arm"][0]) + np.linalg.norm(rg[sd + "Hand"][0] - rg[sd + "ForeArm"][0]))
                at = (at.get("x", 0.0), at.get("y", 0.0), at["fwd"] * float(L))
            c = M.place_hand(rig, c, pc.get("side", "Left"), at, w, pc.get("ref"), pc.get("keep_motion", True))
        if d.get("aim") and not d["aim"].get("late"):   # point the weapon along a direction (thrust from a straight punch)
            am = d["aim"]
            w = M.ramp(M.nframes(c), *am["ramp"])
            wn_ = am.get("weapon", sp["weapon"])
            base = M.weapon_axis(rig, M.frame_pose(idle, 0), wn_) if am.get("from_idle", True) else None
            c = M.aim_weapon(rig, c, wn_, am["dir"], w * am.get("w", 1.0), base, am.get("frame", "char"))
        for oc in ([d["orient"]] if isinstance(d.get("orient"), dict) else d.get("orient") or []):
            # full orientation of a blade/shaft (axis grip -> tip along `face`, edge along `up`), slerped with the mocap hand
            # by the ramp (stable where a minimal-rotation aim would flip, e.g. a blade the mocap drives into the floor)
            wn_ = oc.get("weapon", sp["weapon"]); Rn = fk.q2m(np.asarray(rig.rest[wn_][1], float))
            fl = Rn.T @ rig.weapons[wn_]["axis"]; ul = np.array([1.0, 0, 0]); ul = ul - fl * fl.dot(ul); ul /= np.linalg.norm(ul)
            w = M.ramp(M.nframes(c), *oc["ramp"]) if oc.get("ramp") else np.ones(M.nframes(c))
            c = M.orient_prop(rig, c, wn_, fl, ul, oc["face"], oc["up"], w, oc.get("frame", "char"))
        for sh in ([d["shield"]] if isinstance(d.get("shield"), dict) else d.get("shield") or []):
            ax = sp["shield_axes"]               # square the shield to a direction (face normal, up) in the char/chest frame
            w = M.ramp(M.nframes(c), *sh["ramp"]) if sh.get("ramp") else np.ones(M.nframes(c))
            c = M.orient_prop(rig, c, sh.get("weapon", "weapon_shield"), ax["face"], ax["up"], sh["face"], sh.get("up", [0, 1, 0]),
                              w * sh.get("w", 1.0), sh.get("frame", "char"))
        ikw = (lambda cc: M.ramp(M.nframes(cc), *d["ik_ramp"])) if d.get("ik_ramp") else (lambda cc: None)
        if sp.get("twohand") and d.get("ik", True):
            c, gap, rs, lm = twohand.shaft_ik(rig, c, sp["weapon"], weight=ikw(c), **sp.get("twohand_opts", {}))
            info["ik"] = {"right_shift_max_cm": round(float(rs.max()) * 100, 1), "left_move_max_cm": round(float(lm.max()) * 100, 1),
                          "gap_max_cm": round(float(gap.max()) * 100, 2)}
        if d.get("arms") and idle is not None:   # keep these bones in the idle guard (local to the chest)
            aw = M.ramp(M.nframes(c), *d["arms_ramp"]) if d.get("arms_ramp") else d.get("arms_w", 1.0)
            M.bones_from_pose(c, M.frame_pose(idle, 0), d["arms"], aw)
        if d.get("yaw"):
            c = M.rotate_yaw(c, d["yaw"])
        off = M.strip_root(rig, c, "loop" if d.get("loop") else "full")
        rp = d.get("replant")
        if rp:                                   # plants of the mocap before the edge blends (see M.replant)
            rp = rp if isinstance(rp, dict) else {"on": True}
            segs = M.plant_segments(rig, c, off, rp.get("h_tol", 0.03), rp.get("v_tol", 0.4))
        if rp and d.get("loop"):                 # loop: lock the plants, no blend poses (loop_fix closes the seam)
            c, miss, locked = M.replant(rig, c, off, segs, None, None, rp.get("min_lift", 0.04))
            info["replant"] = {"plants": {s: [list(x) for x in v] for s, v in locked.items()},
                               "ik_miss_cm": {s: round(v * 100, 1) for s, v in miss.items()}}
            rp = None
        if idle is not None:
            src_pose = None
            if d.get("bi"):
                # bi_prev: chain from the previous combo segment's last pose instead of idle
                # bi_from: a generated pose ('lie_up' / 'lie_down': get-ups start from a clean flat lying pose)
                src_pose = (M.frame_pose(clips[d["bi_prev"]], M.nframes(clips[d["bi_prev"]]) - 1) if d.get("bi_prev") else
                            lie(d["bi_from"]) if d.get("bi_from") else M.frame_pose(idle, 0))
                M.blend_pose(c, src_pose, d["bi"], "start")
            end_pose = (lie(d["to"]) if str(d.get("to", "")).startswith("lie_") else      # knockdown settles into the flat pose
                        M.frame_pose(clips[d["to"]], 0) if d.get("to") else M.frame_pose(idle, 0))   # e.g. back into block
            if d.get("bo"):
                M.blend_pose(c, end_pose, d["bo"], "end")
            if d.get("tail"):
                c = M.tail(c, end_pose, d["tail"])
                off = np.concatenate([off, np.repeat(off[-1:], d["tail"], 0)])
            # blends between different stances would slide the feet: make them small steps instead
            nn = M.nframes(c)
            if rp:                               # travelling clip: every plant locked, first/last plants on the blend poses
                c, miss, locked = M.replant(rig, c, off, segs, src_pose if rp.get("start", True) else None,   # (start=False: from a run,
                                            end_pose if (d.get("bo") or d.get("tail")) else None,              #  feet not planted)
                                            rp.get("min_lift", 0.04), (d.get("bi", 0), d.get("bo", 0) or d.get("tail", 0)))
                info["replant"] = {"plants": {s: [list(x) for x in v] for s, v in locked.items()},
                                   "ik_miss_cm": {s: round(v * 100, 1) for s, v in miss.items()}}
            elif d.get("step_feet", True):       # 'start': only out of the blend-in (a knockdown settling on the floor)
                sf_end = d.get("step_feet", True) is True
                if d.get("bi"):
                    c = M.step_feet(rig, c, 0, d["bi"], root=off)
                if d.get("bo") and sf_end:
                    c = M.step_feet(rig, c, nn - 1 - d["bo"], nn - 1, root=off)
                if d.get("tail") and sf_end:
                    c = M.step_feet(rig, c, nn - 1 - d["tail"], nn - 1, root=off)
        if d.get("aim") and d["aim"].get("late"):       # aim after the edge blends (ramp in final frames): the blend from a
            am = d["aim"]                                # lying pose would otherwise swing the weapon up through the air
            w = M.ramp(M.nframes(c), *am["ramp"]); wn_ = am.get("weapon", sp["weapon"])
            if isinstance(am["dir"], str):           # 'lie_up' / 'lie_down': the weapon as laid in that pose
                lie(am["dir"]); dv = lie_axis[am["dir"]][wn_]
            else:
                dv = am["dir"]
            c = M.aim_weapon(rig, c, wn_, dv, w * am.get("w", 1.0), None, am.get("frame", "char"))
        if d.get("shield_late") and "weapon_shield" in rig.weapons:   # shield held as in the lying pose (after the blends)
            sl = d["shield_late"]; ax = sp["shield_axes"]
            c = M.orient_prop(rig, c, "weapon_shield", ax["face"], ax["up"], sl["face"], sl["up"], M.ramp(M.nframes(c), *sl["ramp"]))
        for bn, f0, f1 in d.get("resmooth_late", ()):   # after the blends: an eased slerp f0 -> f1 (a blend between poses
            R = c["bones"][bn]["R"]; u = M.smooth((np.arange(f0 + 1, f1) - f0) / (f1 - f0))   # ~180 deg apart can flip)
            R[f0 + 1:f1] = G.slerp(np.repeat(R[f0:f0 + 1], len(u), 0), np.repeat(R[f1:f1 + 1], len(u), 0), u)
        if d.get("settle"):                      # lying: hands round the outside of the body onto the flat pose, props outward
            f0 = d["settle"][0] if d["settle"][0] >= 0 else M.nframes(c) + d["settle"][0]
            c = M.settle_arms(rig, c, f0, M.nframes(c) - 1, [w_ for w_ in rig.weapons if w_ != "weapon_shield"])
        if d.get("floor_hands"):                 # hands kept out of the floor (blends between lying and crouching poses)
            c, lift = M.hands_above_floor(rig, c, chk.body if chk is not None else clipcheck.Body(backup),
                                          keep=(bool(d.get("bi_from")), str(d.get("to", "")).startswith("lie_")))
            info["hands_lifted_cm"] = {k: round(v * 100, 1) for k, v in lift.items()}
        if d.get("loop"):
            M.loop_fix(c, d.get("lf", 6))
        for b in c["bones"].values():
            b["R"] = M.qfix(G.qnorm(b["R"]))
            b["S"] = np.ones_like(b["S"])
        if chk is not None and d.get("declip", True):
            # weapon-through-body fix: turn the weapon hand where the blade is inside the body (clipcheck.declip). The first and
            # last frames of one-shot clips stay put (they meet idle / the next combo segment); loops are fixed around the seam.
            info["declip"] = {}
            nn = M.nframes(c)
            ends = d.get("declip_ends", "both")      # 'first' for clips nothing follows (death)
            prot = set() if d.get("loop") else ({0, nn - 1} if ends == "both" else ({0} if ends == "first" else set()))
            prot |= set(d.get("declip_protect", ()))
            atk = cn in ATTACKS or d.get("measure")
            wl = sorted(chk.rig.weapons, key=lambda w: 0 if w in ("weapon_shield", "weapon_bow") else 1)
            wl = [w for w in wl if w not in d.get("declip_skip", ())]   # off-hand props (shield, bow) first, then the blade

            def strike_of(cl):
                m_ = fk.metrics(rig, cl, d["measure"] if isinstance(d.get("measure"), str) else sp["weapon"])
                return int(m_["strike"]), float(m_["speed"][int(m_["strike"])]), m_["speed"]

            def run_declip(cl, pr):
                rps = {}
                for wn in wl:
                    cl, rp = clipcheck.declip(chk, cl, (name, cn, wn, len(pr)), wn, tol=0.01, loop=bool(d.get("loop")), protect=pr,
                                              floor=bool(d.get("declip_floor")), ease=6 if atk else 4, sigma=1.5 if atk else 0.8)
                    rps[wn] = {k: v for k, v in rp.items() if not k.endswith("_bad")}
                return cl, rps

            if atk:
                # keep the strike: try without extra protection, then protect the strike frame +-2, then the whole fast window
                pk0, v0, sp0 = strike_of(c); lo0 = hi0 = pk0
                while lo0 > 1 and sp0[lo0 - 1] >= 0.25 * sp0[pk0]: lo0 -= 1
                while hi0 < nn - 1 and sp0[hi0 + 1] >= 0.25 * sp0[pk0]: hi0 += 1
                src_c = {b: {k: v.copy() for k, v in c["bones"][b].items()} for b in c["bones"]}
                for extra, label in ((set(), "none"), (set(range(pk0 - 2, pk0 + 3)), "strike+-2"),
                                     (set(range(max(lo0 - 2, 0), min(hi0 + 3, nn))), "fast window")):
                    cand, rps = run_declip({"n": nn, "bones": {b: {k: v.copy() for k, v in src_c[b].items()} for b in src_c}}, prot | extra)
                    pk1, v1, _ = strike_of(cand)
                    if pk1 == pk0 and abs(v1 - v0) <= 0.15 * v0:
                        break
                c = cand
                info["declip"] = rps
                info["declip_protect"] = label
            else:
                c, info["declip"] = run_declip(c, prot)
            if sp.get("twohand") and d.get("ik", True):
                for rnd in range(2):                 # re-grip the turned shaft; the grip IK can pull the hand back, so fix again
                    if not any(v["turned_frames"] or v.get("pushed_frames") for v in info["declip"].values()):
                        break
                    c, _, _, _ = twohand.shaft_ik(rig, c, sp["weapon"], weight=ikw(c), **sp.get("twohand_opts", {}))
                    if rnd == 0:
                        first = info["declip"]
                        c, again = run_declip(c, prot | (set(range(pk0 - 2, pk0 + 3)) if atk else set()))
                        for wn_, v_ in again.items():  # keep the first pass's 'before' numbers
                            first[wn_].update(after_cm=v_["after_cm"], after_frames=v_["after_frames"],
                                              max_turn_deg=max(first[wn_]["max_turn_deg"], v_["max_turn_deg"]),
                                              max_push_cm=max(first[wn_].get("max_push_cm", 0), v_.get("max_push_cm", 0)))
                        info["declip"] = first
            for b in c["bones"].values():
                b["R"] = M.qfix(G.qnorm(b["R"]))
        if d.get("plant"):                       # heavy strike: the weapon head stays on the floor (after the floor fix lifted it)
            f0, f1 = d["plant"]
            c, mv = M.plant_weapon(rig, c, sp["weapon"], f0, f1)
            info["plant"] = {"frames": [f0, f1], "hand_moved_max_cm": round(mv * 100, 1)}
        if d.get("press"):                       # half-sword guard: off-hand palm on the flat of the blade (twohand.blade_press)
            pr = d["press"]; sd = pr.get("side", "Left")
            if sd not in hand_l:
                hand_l[sd] = twohand.hand_axes(backup, rig, sd)
            fing, palm, hlen, hhalf = hand_l[sd]
            w = M.ramp(M.nframes(c), *pr["ramp"])
            c, gap = twohand.blade_press(rig, c, sp["weapon"], pr.get("frac", 0.55), w, palm=palm, fingers=fing,
                                         standoff=pr.get("standoff", hhalf + 0.004), heel=pr.get("heel", 0.45 * hlen), side=sd)
            for b in c["bones"].values():
                b["R"] = M.qfix(G.qnorm(b["R"]))
            full = w > 0.999
            info["press"] = {"frames": [int(np.argmax(full)), int(len(full) - 1 - np.argmax(full[::-1]))] if full.any() else [],
                             "palm_to_blade_mid_max_cm": round(float(gap[full].max()) * 100, 2) if full.any() else None}
            if chk is not None:                  # the blade against the body including the pressing hand and forearm
                chk.floor = False
                ck = chk.check_clip(c, (name, cn, "press"), [sp["weapon"]], 0.01)[sp["weapon"]]
                info["press"].update(blade_depth_max_cm=ck["worst_cm"], frames_over_1cm=ck["frames_over_tol"], parts=ck["parts"])
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
        if d.get("command"):                      # gesture clips: the frame the blades are launched on
            g_ = rig.fk(c["bones"]); cm = d["command"]
            if cm in ("Left", "Right"):           # the hand fully extended, farthest from the hips, first such frame
                dist = np.linalg.norm(g_[cm + "Hand"][0] - g_["Hips"][0], axis=1)
                ext = dist / (np.linalg.norm(g_[cm + "ForeArm"][0] - g_[cm + "Arm"][0], axis=1) + np.linalg.norm(g_[cm + "Hand"][0] - g_[cm + "ForeArm"][0], axis=1))
                cf = int(np.argmax(dist >= dist.max() - 0.02))
            elif cm == "down":                    # both hands at their lowest after the raise
                hy = (g_["LeftHand"][0][:, 1] + g_["RightHand"][0][:, 1]) / 2
                cf = int(np.argmin(hy))
            else:                                 # 'land': the hips' lowest point after the apex
                hy = g_["Hips"][0][:, 1]; ap = int(np.argmax(hy)); cf = ap + int(np.argmin(hy[ap:]))
            info.update({"command": cf, "command_s": round(cf / 30, 3), "command_frac": round(cf / (n - 1), 3)})
        if d.get("window"):                       # parry: frames in which the guard pose is up (raise done .. recovery starts)
            w0, w1 = d["window"]
            info["window"] = [w0, n - 1 + w1 if w1 < 0 else w1]
            info["window_s"] = [round(info["window"][0] / 30, 3), round(info["window"][1] / 30, 3)]
        if d.get("release"):                      # bow shot: the drawing hand leaves the anchor (string released)
            g_ = rig.fk(c["bones"])
            dh = np.linalg.norm(g_["RightHand"][0] - g_["Head"][0], axis=1)
            a0 = d["release"]                     # search from this frame (inside the full-draw hold)
            rf = next(f for f in range(a0, n - 1) if dh[f + 1] - dh[f] > 0.008)
            P = g_["RightHand"][0][rf] - g_["Hips"][0][rf]
            info.update({"release": rf, "release_s": round(rf / 30, 3), "right_hand_at_release_xyz": [round(float(v), 2) for v in P],
                         "bow_hand_at_release_xyz": [round(float(v), 2) for v in g_["LeftHand"][0][rf] - g_["Hips"][0][rf]]})
        if cn in ATTACKS or d.get("measure"):
            m = fk.metrics(rig, c, d["measure"] if isinstance(d.get("measure"), str) else sp["weapon"])
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
