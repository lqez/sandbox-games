# beauty.png(정면 3/4, idle 0프레임, 1024²)와 ingame.png(4×4 m 바닥, 세로 화각 50°, 피치 38°, 요 45°, 8 m, 720×1280, attack_1 10프레임)를 Eevee로 렌더한다.
# 사용: /Applications/Blender.app/Contents/MacOS/Blender -b --python astrid_render.py -- <astrid.glb> <출력 폴더>
import bpy, sys, math
from mathutils import Vector
args = sys.argv[sys.argv.index("--")+1:]
glb, outdir = args[0], args[1]
atk_frac = float(args[2]) if len(args) > 2 else 0.45
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene; sc.render.fps = 30
bpy.ops.import_scene.gltf(filepath=glb)
for o in list(bpy.data.objects):
    if o.type == "MESH" and o.parent is None: bpy.data.objects.remove(o)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
mesh = next(o for o in bpy.data.objects if o.type == "MESH" and o.name != "weapon_sword")
print("ACTIONS", sorted(a.name for a in bpy.data.actions))
for a in bpy.data.actions: print("DUR", a.name, a.frame_range[:])
arm.animation_data_create()
for t in list(arm.animation_data.nla_tracks): arm.animation_data.nla_tracks.remove(t)
def set_action(name, frame):
    a = bpy.data.actions[name]; arm.animation_data.action = a
    if hasattr(arm.animation_data, "action_slot") and a.slots: arm.animation_data.action_slot = a.slots[0]
    sc.frame_set(int(frame))
try: sc.render.engine = "BLENDER_EEVEE"
except TypeError: sc.render.engine = "BLENDER_EEVEE_NEXT"
sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
bg = w.node_tree.nodes["Background"]; bg.inputs[0].default_value = (0.82, 0.83, 0.85, 1); bg.inputs[1].default_value = 0.9
def light(name, typ, rot, energy, size=None):
    L = bpy.data.lights.new(name, typ); L.energy = energy
    o = bpy.data.objects.new(name, L); sc.collection.objects.link(o); o.rotation_euler = [math.radians(r) for r in rot]; return o
light("key", "SUN", (45, 0, 30), 3.5); light("fill", "SUN", (60, 0, -120), 1.2)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
def look(pos, target):
    cam.location = pos; d = Vector(target) - Vector(pos)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
H = mesh.dimensions.z if False else None
# beauty
set_action("idle", 0)
dg = bpy.context.evaluated_depsgraph_get(); e = mesh.evaluated_get(dg)
zs = [ (e.matrix_world @ v.co).z for v in e.data.vertices]; h = max(zs)
sc.render.resolution_x = sc.render.resolution_y = 1024
cam.data.lens = 85; dist = h * 2.75
az = math.radians(35)  # character faces -Y; camera front-right
look((dist*math.sin(az), -dist*math.cos(az), h*0.6), (0, 0, h*0.5))
sc.render.filepath = outdir + "/beauty.png"; bpy.ops.render.render(write_still=True)
arm.data.pose_position = "POSE"
# ingame
bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, 0)); fl = bpy.context.active_object
m = bpy.data.materials.new("floor"); m.use_nodes = True
m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.35, 0.35, 0.36, 1); fl.data.materials.append(m)
bg.inputs[0].default_value = (0.12, 0.13, 0.15, 1)
a = bpy.data.actions["attack_1"]; best = (-1, 0)
for fr in range(int(a.frame_range[0]), int(a.frame_range[1])+1, 2):
    set_action("attack_1", fr)
    pb = arm.pose.bones; hp = arm.matrix_world @ pb["Hips"].head
    d = max(((arm.matrix_world @ pb[n].head) - hp).xy.length for n in ("RightHand", "LeftHand"))
    best = max(best, (d, fr))
f = 10; set_action("attack_1", f)
sc.render.resolution_x, sc.render.resolution_y = 720, 1280
cam.data.sensor_fit = "VERTICAL"; cam.data.angle_y = math.radians(50)
pitch, yaw, D = math.radians(38), math.radians(45), 8.0
tgt = Vector((0, 0, 1.0))
pos = tgt + D*Vector((math.cos(pitch)*math.sin(yaw), -math.cos(pitch)*math.cos(yaw), math.sin(pitch)))
look(pos, tgt)
sc.eevee.use_shadows = True if hasattr(sc.eevee, "use_shadows") else None
sc.render.filepath = outdir + "/ingame.png"; bpy.ops.render.render(write_still=True)
print("RENDERED frame", f)
