# 제국 궁수(archer)의 기준 GLB(raw/archer_handkeyed.glb)를 만든다(헤드리스 Blender). 손 키 동작은 만들지 않는다.
# mocap_build.py가 이 파일의 몸·스킨·소품 노드를 그대로 쓰고 동작만 Meshy 라이브러리 모캡으로 채운다(다른 병사와 같은 구조).
#  1) Meshy rigged.glb + basic_walking/basic_running 액션
#  2) 키 1.25 m, 발바닥 원점, 변환 적용, 노멀 재계산, 텍스처 1024² (soldier_build.py와 같은 정리)
#  3) 왼손을 주먹으로 말고(메시 자체 수정) 절차적 활 weapon_bow를 LeftHand 본에 붙인다
#     활 로컬 축: +Z = 위쪽 날개(엄지 쪽), +X = 활 등(주먹 마디 쪽 = 겨누는 쪽), 시위는 -X 쪽, 원점 = 주먹 안 손잡이
# 사용: /Applications/Blender.app/Contents/MacOS/Blender -b --python archer_base.py -- <out.glb>
import bpy, bmesh, sys, os, math, json
import numpy as np
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import soldier_lib as L

A = sys.argv[sys.argv.index("--") + 1:]
OUT = A[0]
TYPE = "archer"
RAW = f"/Users/lqez/dev/sandbox-games/ploh/game/assets/soldiers/{TYPE}/raw/"
HEIGHT = 1.25
sc = L.clear()


def upd():
    bpy.context.view_layer.update()


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
for name, fn in {"walk": "basic_walking.glb", "run": "basic_running.glb"}.items():
    o2, a2 = import_glb(RAW + fn)
    a2[0].name = name
    for extra in a2[1:]:
        bpy.data.actions.remove(extra)
    purge(o2)


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
for im in bpy.data.images:
    if max(im.size) > 1024:
        im.scale(1024, 1024)
    im.name = f"{TYPE}_basecolor"
for m in me.materials:
    m.name = f"{TYPE}_body"
arm.data.pose_position = "POSE"; upd()
BONES = arm.data.bones


def rest_head(n): return BONES[n].head_local.copy()
def rest_dir(n): return (BONES[n].tail_local - BONES[n].head_local).normalized()


def make_fist(side):
    """same mesh fist as soldier_build.py: curl the finger vertices ~145 deg toward the palm."""
    hb = side + "Hand"; vg = mesh.vertex_groups[hb].index
    wr = rest_head(hb); h = rest_dir(hb)
    ids, pts = [], []
    for v in mesh.data.vertices:
        w = next((g.weight for g in v.groups if g.group == vg), 0.0)
        if w > 0.3 and (v.co - wr).dot(h) > -0.005:
            ids.append(v.index); pts.append(v.co.copy())
    P = np.array([list(p) for p in pts]); ts = (P - np.array(wr)) @ np.array(h)
    tmax = float(ts.max()); t0 = 0.42 * tmax
    C = P - P.mean(0); ev, evec = np.linalg.eigh(C.T @ C)
    n = Vector(evec[:, 0]); n = (n - h * n.dot(h)).normalized()
    inward = Vector((1, 0, 0)) if side == "Right" else Vector((-1, 0, 0))
    if n.dot(inward) < 0:
        n = -n
    near = [p for p, t in zip(pts, ts) if abs(t - t0) < tmax * 0.08]
    K = sum(near, Vector()) / len(near)
    r = (tmax - t0) / (0.8 * math.pi); Cc = K + n * r
    for i, p, t in zip(ids, pts, ts):
        if t <= t0:
            continue
        d = p - K; tp = d.dot(h); u = d.dot(n); sd = d - h * tp - n * u
        phi = tp / r; rho = r - u
        mesh.data.vertices[i].co = Cc - n * rho * math.cos(phi) + h * rho * math.sin(phi) + sd
    mesh.data.update()
    a_ax = h.cross(n).normalized()
    if a_ax.dot(Vector((0, -1, 0))) < 0:
        a_ax = -a_ax
    h_perp = (h - a_ax * h.dot(a_ax)).normalized()
    return Cc, a_ax, h_perp, len(ids)


def mat(name, rgb, metal=0.0, rough=0.6, emit=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True; b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1); b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1); b.inputs["Emission Strength"].default_value = 1.0
    return m


def build_bow(half=0.44):
    """recurve bow, tip to tip 2*half m. +Z = upper limb, +X = back of the bow (target side), string on -X."""
    wood = mat("prop_wood", (0.30, 0.17, 0.09), 0.0, 0.7)
    brass = mat("prop_brass", (0.80, 0.60, 0.24), 0.9, 0.4)
    leather = mat("prop_leather", (0.28, 0.16, 0.09), 0.0, 0.8)
    cyan = mat("prop_cyan", (0.35, 0.95, 1.0), 0.0, 0.3, emit=(0.2, 0.85, 1.0))
    string = mat("prop_string", (0.85, 0.85, 0.80), 0.0, 0.6)
    bm = bmesh.new(); mats = []

    def mi(m):
        if m not in mats:
            mats.append(m)
        return mats.index(m)

    def ring(c, t, w, d, m):     # rectangle section centred at c, spanning t (thickness dir X) and w (width dir Y)
        x, y, z = c
        return [bm.verts.new((x - t, y - w, z)), bm.verts.new((x + t, y - w, z)), bm.verts.new((x + t, y + w, z)),
                bm.verts.new((x - t, y + w, z))]

    def loft(rings, m, caps=True):
        k = mi(m)
        for a, b in zip(rings, rings[1:]):
            for i in range(4):
                bm.faces.new((a[i], a[(i + 1) % 4], b[(i + 1) % 4], b[i])).material_index = k
        if caps:
            bm.faces.new(list(reversed(rings[0]))).material_index = k
            bm.faces.new(rings[-1]).material_index = k

    # limb centre line: x(z) bends back toward the string side, tips recurve forward
    def limb_x(u):   # u = |z| / half in 0..1
        return -0.10 * u ** 1.6 + 0.05 * max(0.0, u - 0.82) ** 2 / 0.0324 * 0.9
    for sg in (1, -1):
        rs = []
        for i in range(9):
            u = 0.09 + 0.91 * i / 8
            z = sg * u * half
            th = 0.014 * (1 - 0.55 * u); wd = 0.018 * (1 - 0.5 * u)
            rs.append(ring((limb_x(u), 0, z), th, wd, 0, wood))
        if sg < 0:
            rs = rs[::-1]
        loft(rs, wood)
        # brass tip caps
        u = 1.0; z = sg * half
        loft([ring((limb_x(0.97), 0, sg * 0.97 * half), 0.008, 0.011, 0, brass), ring((limb_x(1.0) + 0.004, 0, z + sg * 0.012), 0.004, 0.006, 0, brass)], brass)
    # riser (grip) with brass fittings and a cyan crystal on the back
    loft([ring((0.0, 0, -0.06), 0.018, 0.016, 0, leather), ring((0.0, 0, 0.06), 0.018, 0.016, 0, leather)], leather)
    loft([ring((0.004, 0, 0.06), 0.02, 0.018, 0, brass), ring((0.0, 0, 0.09), 0.016, 0.018, 0, brass)], brass)
    loft([ring((0.004, 0, -0.09), 0.016, 0.018, 0, brass), ring((0.004, 0, -0.06), 0.02, 0.018, 0, brass)], brass)
    loft([ring((0.022, 0, -0.03), 0.006, 0.008, 0, cyan), ring((0.026, 0, 0.03), 0.006, 0.008, 0, cyan)], cyan)
    # string (thin box) between the tips, on the -X side
    xt = limb_x(1.0) - 0.006
    loft([ring((xt, 0, -half * 0.995), 0.0025, 0.0025, 0, string), ring((xt, 0, half * 0.995), 0.0025, 0.0025, 0, string)], string)
    me_ = bpy.data.meshes.new("weapon_bow")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me_); bm.free()
    for m in mats:
        me_.materials.append(m)
    ob = bpy.data.objects.new("weapon_bow", me_); sc.collection.objects.link(ob)
    return ob


def attach(ob, bone, Cc, X, Z):
    Y = Z.cross(X)
    M = Matrix.Translation(Cc) @ Matrix((X, Y, Z)).transposed().to_4x4()
    arm.data.pose_position = "REST"; upd()
    ob.parent = arm; ob.parent_type = "BONE"; ob.parent_bone = bone
    upd(); ob.matrix_world = M; upd()
    arm.data.pose_position = "POSE"; upd()


H = max(v.co.z for v in mesh.data.vertices)
info = {}
Cc, S0, H0, nv = make_fist("Left"); info["fist_left_verts"] = nv
bow = build_bow()
attach(bow, "LeftHand", Cc, H0, S0)

ad.action = None
for t in list(ad.nla_tracks):
    ad.nla_tracks.remove(t)
for a in bpy.data.actions:
    a.use_fake_user = False
    t = ad.nla_tracks.new(); t.name = a.name
    st = t.strips.new(a.name, int(a.frame_range[0]), a); st.name = a.name
for pb in arm.pose.bones:
    pb.rotation_mode = "QUATERNION"; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
upd()
for o in bpy.data.objects:
    o.select_set(o.type in ("ARMATURE", "MESH"))
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_animation_mode="ACTIONS",
                          export_yup=True, export_force_sampling=True, export_frame_step=1,
                          export_optimize_animation_size=False, export_image_format="AUTO")
info.update({"height": round(H, 4), "tris_body": sum(len(p.vertices) - 2 for p in mesh.data.polygons),
             "tris_bow": sum(len(p.vertices) - 2 for p in bow.data.polygons),
             "images": {i.name: list(i.size) for i in bpy.data.images}, "bones": [b.name for b in BONES],
             "actions": [a.name for a in bpy.data.actions]})
print("INFO", json.dumps(info))
