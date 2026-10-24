# 정리된 GLB에 KayKit 한손검(weapon_sword, RightHand 본 자식)과 오른손 주먹을 넣고,
# idle/attack_1-3/spin/cast를 키포즈+IK로 만들어 베이크한다. run은 오른팔만 덮어쓴다. dodge/hit/death는 그대로 둔다.
# 사용: /Applications/Blender.app/Contents/MacOS/Blender -b --python astrid_author_sword.py -- <refine 결과 glb> <out.glb> <B_mid|C_sd>
# 입력은 refine 결과(검 없는 GLB)여야 한다. 결과 GLB를 다시 넣지 말 것.
import bpy, sys, math, json
import numpy as np
from mathutils import Vector, Matrix, Quaternion
A = sys.argv[sys.argv.index("--")+1:]
SRC, OUT, VAR = A[0], A[1], A[2]
SD = VAR == "C_sd"
KNIGHT = "/Users/lqez/dev/sandbox-games/ploh/game/assets/kaykit/heroes/Knight.glb"
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene; sc.render.fps = 30
# --- sword mesh from KayKit ---
before = set(bpy.data.actions)
bpy.ops.import_scene.gltf(filepath=KNIGHT)
sw_src = bpy.data.objects["1H_Sword"]; sw_me = sw_src.data.copy(); sw_me.name = "weapon_sword"
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
for a in set(bpy.data.actions) - before: bpy.data.actions.remove(a)
# --- character ---
bpy.ops.import_scene.gltf(filepath=SRC)
for o in list(bpy.data.objects):
    if o.type == "MESH" and o.parent is None: bpy.data.objects.remove(o)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
mesh = next(o for o in bpy.data.objects if o.type == "MESH")
ad = arm.animation_data_create()
for t in list(ad.nla_tracks): ad.nla_tracks.remove(t)
ad.action = None
BONES = arm.data.bones; PB = arm.pose.bones
def rest_q(n): return BONES[n].matrix_local.to_quaternion()
def rest_head(n): return BONES[n].head_local.copy()
def rest_dir(n): return (BONES[n].tail_local - BONES[n].head_local).normalized()
H = max(v.co.z for v in mesh.data.vertices); S = H / 1.25
LA = (rest_head("RightHand") - rest_head("RightArm")).length
def W(x, y, z): return Vector((-x, -y, z))      # body (right, forward, up) -> world
# --- fist on right hand (base mesh) ---
vg = mesh.vertex_groups["RightHand"].index
wr = rest_head("RightHand"); h = rest_dir("RightHand")
ids, pts = [], []
for v in mesh.data.vertices:
    w = next((g.weight for g in v.groups if g.group == vg), 0.0)
    if w > 0.3 and (v.co - wr).dot(h) > -0.005: ids.append(v.index); pts.append(v.co.copy())
P = np.array([list(p) for p in pts]); ts = (P - np.array(wr)) @ np.array(h)
tmax = float(ts.max()); t0 = 0.42 * tmax
C = P - P.mean(0); ev, evec = np.linalg.eigh(C.T @ C)
n = Vector(evec[:, 0]); n = (n - h * n.dot(h)).normalized()
if n.dot(Vector((1, 0, 0))) < 0: n = -n          # right palm faces +X (toward body)
near = [p for p, t in zip(pts, ts) if abs(t - t0) < tmax * 0.08]
K = sum(near, Vector()) / len(near)
Lf = tmax - t0; r = Lf / (0.8 * math.pi)
Cc = K + n * r
for i, p, t in zip(ids, pts, ts):
    if t <= t0: continue
    d = p - K; tp = d.dot(h); u = d.dot(n); side = d - h * tp - n * u
    phi = tp / r; rho = r - u
    mesh.data.vertices[i].co = Cc - n * rho * math.cos(phi) + h * rho * math.sin(phi) + side
mesh.data.update()
a_ax = h.cross(n).normalized()
if a_ax.dot(Vector((0, -1, 0))) < 0: a_ax = -a_ax
h_perp = (h - a_ax * h.dot(a_ax)).normalized()
S0, H0 = a_ax.copy(), h_perp.copy()       # rest blade dir, rest knuckle dir
# --- sword object ---
L_SWORD = (0.52 if SD else 0.72)
k = L_SWORD / 1.775
sw = bpy.data.objects.new("weapon_sword", sw_me); sc.collection.objects.link(sw)
rot = Matrix((H0, S0.cross(H0), S0)).transposed()
M = Matrix.Translation(Cc) @ rot.to_4x4() @ Matrix.Scale(k, 4)
sw_me.transform(Matrix.Scale(k, 4)); M = Matrix.Translation(Cc) @ rot.to_4x4()
arm.data.pose_position = "REST"; bpy.context.view_layer.update()
sw.parent = arm; sw.parent_type = "BONE"; sw.parent_bone = "RightHand"
bpy.context.view_layer.update(); sw.matrix_world = M; bpy.context.view_layer.update()
arm.data.pose_position = "POSE"
# --- posing ---
def upd(): bpy.context.view_layer.update()
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
def ik(up, lo, target, pole):
    upd(); Sp = PB[up].matrix.translation.copy()
    a = (rest_head(lo) - rest_head(up)).length; b = BONES[lo].length if lo.endswith("Leg") else (rest_head(lo.replace("ForeArm", "Hand")) - rest_head(lo)).length
    if lo.endswith("Leg"): b = (rest_head(lo.replace("Leg", "Foot")) - rest_head(lo)).length
    D = target - Sp; d = min(max(D.length, 1e-4), (a + b) * 0.999); u = D.normalized()
    ca = (a*a + d*d - b*b) / (2*a*d); sa = math.sqrt(max(0, 1 - ca*ca))
    p = (pole - u * u.dot(pole)).normalized()
    e = Sp + u * a * ca + p * a * sa
    aim(up, e - Sp); aim(lo, Sp + u * d - e)
def hand_frame(n, blade, knuck0, s0, h0):
    s = blade.normalized(); hh = knuck0 - s * knuck0.dot(s)
    if hh.length < 1e-3: hh = Vector((0, 0, 1)) - s * s.z
    hh.normalize()
    M0 = Matrix((h0, s0, h0.cross(s0))).transposed(); M1 = Matrix((hh, s, hh.cross(s))).transposed()
    R = (M1 @ M0.transposed()).to_quaternion()
    set_world(n, R @ rest_q(n))
def Rz(deg): return Quaternion((0, 0, 1), math.radians(deg))
def Rx(deg): return Quaternion((1, 0, 0), math.radians(deg))
RS_REST = {s: rest_head(s + "Arm") for s in ("Right", "Left")}
CH_REST = rest_head("Spine")
def apply_pose(p):
    reset(); upd()
    yaw = p.get("yaw", 0); cy = p.get("cyaw", 0); cp = p.get("cpitch", 0)
    Ry = Rz(yaw)
    off = Ry @ W(*[c * S for c in p.get("hip", (0, 0, 0))])
    set_world("Hips", Ry @ Rx(p.get("hpitch", 0)) @ rest_q("Hips"), head=Ry @ rest_head("Hips") + off)
    for f, bn in ((1/3, "Spine02"), (2/3, "Spine01"), (1.0, "Spine")):
        set_world(bn, Rz(yaw + cy * f) @ Rx(cp * f) @ rest_q(bn))
    for bn in ("neck", "Head"):
        set_world(bn, Rz(yaw + p.get("hyaw", 0)) @ Rx(-cp * 0.6 + p.get("hpitchH", 0)) @ rest_q(bn))
    # legs
    for side, key in (("Right", "rf"), ("Left", "lf")):
        o = p.get(key, (0, 0, 0)); ft = Ry @ rest_head(side + "Foot") + Ry @ W(*[c * S for c in o])
        pole = Ry @ W(0.15 if side == "Right" else -0.15, 1, 0)
        ik(side + "UpLeg", side + "Leg", ft, pole)
        set_world(side + "Foot", Ry @ Rz(o[3] if len(o) > 3 else 0) @ rest_q(side + "Foot"))
    # arms (targets relative to rest shoulder in hips-yaw frame)
    for side, hk, bk in (("Right", "rh", "rb"), ("Left", "lh", "lb")):
        if hk not in p: continue
        sgn = 1 if side == "Right" else -1
        Tt = Ry @ (RS_REST[side] + off * 0.7) + Ry @ W(*[c * LA for c in p[hk]])
        pole = Ry @ Rz(cy) @ W(sgn * 0.8, -0.6, -1.0)
        ik(side + "Arm", side + "ForeArm", Tt, pole)
        if side == "Right":
            upd(); fore = (PB["RightHand"].matrix.translation - PB["RightForeArm"].matrix.translation)
            hand_frame("RightHand", Ry @ W(*p[bk]), fore, S0, H0)
        else:
            upd(); fore = (PB["LeftHand"].matrix.translation - PB["LeftForeArm"].matrix.translation)
            aim("LeftHand", fore)
    upd()
def lerp(a, b, t):
    if isinstance(a, (int, float)): return a + (b - a) * t
    return tuple(x + (y - x) * t for x, y in zip(a, b))
def ease(t): return t * t * (3 - 2 * t)
def interp(keys, f):
    ks = sorted(keys)
    if f <= ks[0][0]: return dict(ks[0][1])
    for (f0, p0), (f1, p1) in zip(ks, ks[1:]):
        if f0 <= f <= f1:
            t = ease((f - f0) / (f1 - f0)); out = {}
            for kk in set(p0) | set(p1):
                a = p0.get(kk, p1.get(kk)); b = p1.get(kk, p0.get(kk)); out[kk] = lerp(a, b, t)
            return out
    return dict(ks[-1][1])
BAKE = [b.name for b in BONES]
def bake(name, keys, nframes, loop=False):
    frames = {}
    prev = {}
    for f in range(nframes + 1):
        apply_pose(interp(keys, f))
        fr = {}
        for bn in BAKE:
            q = PB[bn].rotation_quaternion.copy()
            if bn in prev and q.dot(prev[bn]) < 0: q = -q
            prev[bn] = q; fr[bn] = (q, PB[bn].location.copy())
        frames[f] = fr
    act = bpy.data.actions.new(name); ad.action = act
    write(act, frames)
    return act
def write(act, frames, bones=None):
    ad.action = act
    if hasattr(ad, "action_slot") and act.slots: ad.action_slot = act.slots[0]
    fs = sorted(frames)
    for bn in (bones or BAKE):
        chans = [("rotation_quaternion", 4, lambda fr, i: fr[bn][0][i])]
        if bn == "Hips" and bones is None: chans.append(("location", 3, lambda fr, i: fr[bn][1][i]))
        for prop, nc, get in chans:
            path = f'pose.bones["{bn}"].{prop}'
            for i in range(nc):
                fc = act.fcurve_ensure_for_datablock(arm, path, index=i, group_name=bn)
                fc.keyframe_points.clear(); fc.keyframe_points.add(len(fs))
                co = []
                for f in fs: co += [float(f), float(get(frames[f], i))]
                fc.keyframe_points.foreach_set("co", co)
                for kp in fc.keyframe_points: kp.interpolation = "LINEAR"
                fc.update()
# ---------- key poses ----------
G = {"yaw": 0, "cyaw": 15, "cpitch": 5, "hip": (0, 0, -0.035), "rf": (0.02, 0.07, 0), "lf": (-0.02, -0.06, 0),
     "rh": (0.15, 0.75, -0.55), "rb": (-0.15, 0.75, 0.6), "lh": (-0.1, 0.25, -0.85), "hyaw": -10}
if SD: G["rb"] = (-0.1, 0.9, 0.3); G["rh"] = (0.25, 0.8, -0.55)
def P(**kw): d = dict(G); d.update(kw); return d
up = 0.55 if SD else 0.95     # SD: keep the sword hand lower / further forward (big head)
fw = 0.35 if SD else 0.0
CLIPS = {}
CLIPS["idle"] = (60, [(0, G), (30, P(hip=(0, 0, -0.05), cpitch=8, rh=(0.15, 0.73, -0.6), rb=(-0.15, 0.7, 0.6), lh=(-0.1, 0.22, -0.88))), (60, G)])
CLIPS["attack_1"] = (24, [(0, G),
    (7, P(cyaw=-40, yaw=-15, hyaw=15, rh=(0.85, -0.05 + fw, 0.05), rb=(0.3, -0.6 + fw * 1.5, 0.75), lh=(-0.4, 0.55, -0.35))),
    (10, P(cyaw=20, yaw=0, hyaw=-10, rh=(0.25, 0.95, -0.05), rb=(-1.0, 0.45, 0.0), hip=(0, 0.04, -0.05), rf=(0.02, 0.12, 0))),
    (13, P(cyaw=45, yaw=5, hyaw=-15, rh=(-0.4, 0.65, -0.2), rb=(-0.55, -0.6, -0.15), hip=(0, 0.06, -0.06), rf=(0.02, 0.15, 0), lh=(-0.6, -0.1, -0.5))),
    (24, G)])
CLIPS["attack_2"] = (24, [(0, G),
    (7, P(cyaw=45, yaw=10, hyaw=-20, rh=(-0.4, 0.5, -0.65), rb=(-0.5, -0.3, -0.8), lh=(-0.6, -0.1, -0.5))),
    (10, P(cyaw=0, yaw=0, rh=(0.35, 0.9, 0.05 + 0.1 * (not SD)), rb=(0.6, 0.6, 0.55), hip=(0, 0.04, -0.04))),
    (13, P(cyaw=-35, yaw=-10, hyaw=10, rh=(0.85, 0.45, 0.25 + 0.3 * (not SD)), rb=(0.5, -0.2, 0.85), hip=(0, 0.05, -0.04), lh=(-0.45, 0.5, -0.4))),
    (24, G)])
CLIPS["attack_3"] = (30, [(0, G),
    (9, P(cpitch=-8, cyaw=5, rh=(0.25 + 0.4 * SD, 0.35 + fw, up), rb=(0.0, -0.45 + fw * 2.0, 0.9), lh=(-0.3, 0.45, 0.0), hip=(0, -0.03, -0.02))),
    (13, P(cpitch=25, cyaw=10, rh=(0.1, 1.0, -0.4), rb=(0.0, 0.7, -0.7), lh=(-0.45, 0.2, -0.6), hip=(0, 0.13, -0.09), rf=(0.02, 0.24, 0), lf=(-0.02, -0.12, 0))),
    (17, P(cpitch=28, cyaw=10, rh=(0.1, 0.95, -0.5), rb=(0.0, 0.6, -0.8), lh=(-0.45, 0.2, -0.6), hip=(0, 0.13, -0.1), rf=(0.02, 0.24, 0), lf=(-0.02, -0.12, 0))),
    (30, G)])
SPIN_ARM = dict(rh=(1.0, 0.15, -0.1), rb=(0.9, 0.35, 0.05), lh=(-0.85, 0.1, -0.25), cyaw=0, hyaw=0, hip=(0, 0, -0.07))
CLIPS["spin"] = (30, [(0, G),
    (6, P(yaw=-40, **SPIN_ARM)),
    (13, P(yaw=150, **SPIN_ARM)),
    (20, P(yaw=330, **SPIN_ARM)),
    (30, P(yaw=360))])
CLIPS["cast"] = (27, [(0, G),
    (8, P(cyaw=-30, yaw=-5, hyaw=20, rh=(0.45, -0.05, -0.45), rb=(0.0, 1.0, 0.1), lh=(-0.25, 0.75, 0.05), hip=(0, -0.04, -0.04))),
    (11, P(cyaw=25, yaw=0, hyaw=-15, rh=(0.05, 1.05, -0.1), rb=(0.0, 1.0, 0.05), lh=(-0.6, 0.05, -0.45), hip=(0, 0.13, -0.08), rf=(0.02, 0.24, 0), lf=(-0.02, -0.12, 0))),
    (15, P(cyaw=25, yaw=0, hyaw=-15, rh=(0.05, 1.0, -0.12), rb=(0.0, 1.0, 0.0), lh=(-0.6, 0.05, -0.45), hip=(0, 0.13, -0.08), rf=(0.02, 0.24, 0), lf=(-0.02, -0.12, 0))),
    (27, G)])
only = A[3].split(",") if len(A) > 3 and A[3] else list(CLIPS)
# remove Meshy clips that get replaced
for nm in CLIPS:
    if nm in bpy.data.actions: bpy.data.actions[nm].name = "_meshy_" + nm
for nm in CLIPS:
    if nm in only: bake(nm, CLIPS[nm][1], CLIPS[nm][0])
# --- run: overlay right arm (sword held low/back) on the Meshy clip ---
run = bpy.data.actions["run"]
ad.action = run
if hasattr(ad, "action_slot") and run.slots: ad.action_slot = run.slots[0]
f0, f1 = int(run.frame_range[0]), int(run.frame_range[1])
frames = {}; prev = {}
for f in range(f0, f1 + 1):
    ad.action = run; sc.frame_set(f); upd()
    Rc = cur_q("Spine") @ rest_q("Spine").inverted()
    sh = PB["RightArm"].matrix.translation.copy()
    ph = 2 * math.pi * (f - f0) / max(1, f1 - f0)
    T = sh + Rc @ W(0.35 * LA, (0.25 + 0.15 * math.sin(ph)) * LA, -0.75 * LA)
    ik("RightArm", "RightForeArm", T, Rc @ W(0.8, -0.6, -1.0))
    upd(); fore = PB["RightHand"].matrix.translation - PB["RightForeArm"].matrix.translation
    hand_frame("RightHand", Rc @ W(0.25, -0.75, -0.45), fore, S0, H0)
    fr = {}
    for bn in ("RightArm", "RightForeArm", "RightHand"):
        q = PB[bn].rotation_quaternion.copy()
        if bn in prev and q.dot(prev[bn]) < 0: q = -q
        prev[bn] = q; fr[bn] = (q, None)
    frames[f] = fr
ad.action = None
write(run, frames, bones=["RightArm", "RightForeArm", "RightHand"])
# drop replaced Meshy clips
for a in list(bpy.data.actions):
    if a.name.startswith("_meshy_"): bpy.data.actions.remove(a)
# --- NLA + export ---
ad.action = None
for t in list(ad.nla_tracks): ad.nla_tracks.remove(t)
for a in bpy.data.actions:
    t = ad.nla_tracks.new(); t.name = a.name; st = t.strips.new(a.name, int(a.frame_range[0]), a); st.name = a.name
reset(); upd()
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_animation_mode="ACTIONS", export_yup=True,
    export_force_sampling=True, export_frame_step=1, export_optimize_animation_size=False)
info = {"LA": LA, "S": S, "sword_len": L_SWORD, "tris_body": sum(len(p.vertices)-2 for p in mesh.data.polygons),
        "tris_sword": sum(len(p.vertices)-2 for p in sw_me.polygons),
        "actions": {a.name: round((a.frame_range[1]-a.frame_range[0]) / 30, 3) for a in bpy.data.actions},
        "images": {i.name: list(i.size) for i in bpy.data.images}}
print("INFO", json.dumps(info))
