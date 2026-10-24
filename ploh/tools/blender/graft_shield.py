# 징집병 방패 변형(conscript_shield)의 기준 GLB를 만든다(헤드리스 Blender).
# 징집병 기준 GLB(raw/conscript_handkeyed.glb: 몸·스킨·weapon_sword)에 방벽병의 탑 방패 weapon_shield 메시를 그대로 가져와
# 왼손 주먹(메시를 말아 만듦)에 방벽병과 같은 축 규칙으로 붙인다(+X = 방패 바깥면 = 주먹 마디 쪽, 세로 = 엄지 축과 직각).
# 사용: Blender -b --python graft_shield.py -- <base.glb> <shield source.glb> <out.glb> [scale=0.85]
import bpy, sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import soldier_lib as L
from mathutils import Matrix

A = sys.argv[sys.argv.index("--") + 1:]
BASE, SRC, OUT = A[0], A[1], A[2]
SCALE = float(A[3]) if len(A) > 3 else 0.85
sc = L.clear()


def import_glb(path):
    b = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in b]


objs = import_glb(BASE)
arm = next(o for o in objs if o.type == "ARMATURE")
body = next(o for o in objs if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
base_actions = set(bpy.data.actions)
src = import_glb(SRC)
shield = next(o for o in src if o.name.startswith("weapon_shield"))
# keep only the shield mesh data (and its flat-colour materials) from the source file
me = shield.data
for o in src:
    if o.data is not me:
        d = o.data
        bpy.data.objects.remove(o)
        if d is not None and d.users == 0:
            (bpy.data.meshes if isinstance(d, bpy.types.Mesh) else bpy.data.armatures).remove(d)
    else:
        bpy.data.objects.remove(o)
for a in list(bpy.data.actions):
    if a not in base_actions:
        bpy.data.actions.remove(a)
for o in list(bpy.data.objects):
    if o.type == "MESH" and o not in (body,) and not o.name.startswith("weapon_"):
        bpy.data.objects.remove(o)          # stray helper meshes from the base file
me.name = "weapon_shield"
new = bpy.data.objects.new("weapon_shield", me); sc.collection.objects.link(new)
# the imported glTF mesh is in Blender axes: undo the glTF->Blender node basis by baking the source node's local axes
# (the source shield node had local X = face, Y = height, Z = grip axis in Blender; the mesh data already is in that frame)
me.transform(Matrix.Scale(SCALE, 4))
Cc, S0, H0, nv = L.make_fist(body, arm, "Left")
L.attach_to_bone(new, arm, "LeftHand", Cc, H0, S0)
ad = arm.animation_data
if ad:
    ad.action = None
    for t in list(ad.nla_tracks):
        ad.nla_tracks.remove(t)
    for a in bpy.data.actions:
        t = ad.nla_tracks.new(); t.name = a.name
        st = t.strips.new(a.name, int(a.frame_range[0]), a); st.name = a.name
for pb in arm.pose.bones:
    pb.rotation_mode = "QUATERNION"; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
bpy.context.view_layer.update()
for o in bpy.data.objects:
    o.select_set(o.type in ("ARMATURE", "MESH"))
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_animation_mode="ACTIONS",
                          export_yup=True, export_force_sampling=True, export_frame_step=1,
                          export_optimize_animation_size=False, export_image_format="AUTO")
print("INFO", json.dumps({"fist_left_verts": nv, "shield_tris": sum(len(p.vertices) - 2 for p in me.polygons), "scale": SCALE,
                          "objects": [o.name for o in bpy.data.objects]}))
