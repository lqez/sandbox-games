# Meshy 애니메이션 GLB를 정리해 한 GLB로 내보낸다: 액션 이름 변경(idle, run, attack_1...), 키 맞춤, 발바닥 원점, 변환 적용, 노멀 재계산.
# 사용: /Applications/Blender.app/Contents/MacOS/Blender -b --python astrid_refine.py -- <meshy animations.glb> <out.glb> <height_m>
import bpy, bmesh, sys, json
from mathutils import Vector
args = sys.argv[sys.argv.index("--")+1:]
src, out, target_h = args[0], args[1], float(args[2])
MAP = {"Idle":"idle","Run_02":"run","Left_Slash":"attack_1","Right_Hand_Sword_Slash":"attack_2","Charged_Slash":"attack_3",
       "Double_Blade_Spin":"spin","Roll_Dodge":"dodge","Hit_Reaction":"hit","Dead":"death","Charged_Spell_Cast":"cast"}
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene; sc.render.fps = 30
bpy.ops.import_scene.gltf(filepath=src)
for o in list(bpy.data.objects):
    if o.type == "MESH" and o.parent is None: bpy.data.objects.remove(o)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
mesh = next(o for o in bpy.data.objects if o.type == "MESH")
def fcurves(act):
    if hasattr(act, "fcurves") and not hasattr(act, "layers"): return list(act.fcurves)
    res = []
    for L in act.layers:
        for s in L.strips:
            for cb in s.channelbags: res += list(cb.fcurves)
    return res
# rename actions, drop unknowns
for a in list(bpy.data.actions):
    if a.name in MAP: a.name = MAP[a.name]
    elif a.name not in MAP.values(): print("UNMAPPED", a.name)
# rest pose bbox
arm.data.pose_position = "REST"; bpy.context.view_layer.update()
def bbox():
    dg = bpy.context.evaluated_depsgraph_get(); e = mesh.evaluated_get(dg)
    vs = [e.matrix_world @ v.co for v in e.data.vertices]
    return Vector((min(v.x for v in vs),min(v.y for v in vs),min(v.z for v in vs))), Vector((max(v.x for v in vs),max(v.y for v in vs),max(v.z for v in vs)))
lo, hi = bbox(); h = hi.z - lo.z; k = target_h / h
print("orig height", h, "k", k)
# scale + move so feet on origin, centered
arm.scale = arm.scale * k
bpy.context.view_layer.update()
lo, hi = bbox()
arm.location -= Vector(((lo.x+hi.x)/2, (lo.y+hi.y)/2, lo.z))
bpy.context.view_layer.update()
s_applied = arm.scale.x
for o in bpy.data.objects: o.select_set(o in (arm, mesh))
bpy.context.view_layer.objects.active = arm
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
# also apply on mesh child (already identity usually)
for a in bpy.data.actions:
    for fc in fcurves(a):
        if fc.data_path.endswith(".location"):
            for kp in fc.keyframe_points:
                kp.co.y *= s_applied; kp.handle_left.y *= s_applied; kp.handle_right.y *= s_applied
# normals
bpy.context.view_layer.objects.active = mesh
me = mesh.data; bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
for p in me.polygons: p.use_smooth = True
arm.data.pose_position = "POSE"
lo, hi = bbox_rest = (None, None)
arm.data.pose_position = "REST"; bpy.context.view_layer.update(); lo, hi = bbox(); arm.data.pose_position = "POSE"
tris = sum(len(p.vertices)-2 for p in me.polygons)
for img in bpy.data.images:
    if max(img.size) > 2048: img.scale(2048, 2048)
info = {"height": round(hi.z-lo.z,4), "bbox_min": [round(v,3) for v in lo], "bbox_max": [round(v,3) for v in hi], "tris": tris,
        "actions": {a.name: round((a.frame_range[1]-a.frame_range[0])/sc.render.fps, 3) for a in bpy.data.actions},
        "frames": {a.name: list(a.frame_range) for a in bpy.data.actions}, "images": {i.name: list(i.size) for i in bpy.data.images}}
# ensure every action is on an NLA track so exporter picks them all
arm.animation_data_create()
if arm.animation_data.action: arm.animation_data.action = None
names = {t.name for t in arm.animation_data.nla_tracks}
for a in bpy.data.actions:
    if not any(st.action == a for t in arm.animation_data.nla_tracks for st in t.strips):
        t = arm.animation_data.nla_tracks.new(); t.name = a.name; st = t.strips.new(a.name, int(a.frame_range[0]), a)
for t in arm.animation_data.nla_tracks:
    for st in t.strips:
        if st.action: t.name = st.action.name; st.name = st.action.name
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_animation_mode="ACTIONS", export_yup=True,
    export_force_sampling=True, export_frame_step=1, export_optimize_animation_size=False, export_image_format="AUTO")
print("INFO", json.dumps(info))
