# beauty.png(정면 3/4, idle 0프레임, Eevee 1024²)와 ingame.png(4×4 m 바닥, 세로 화각 50°, 피치 38°, 요 45°, 발 위 1 m 지점에서 8 m,
# 720×1280, attack_1 타격 프레임)를 렌더한다. 프라우 astrid_render.py와 같은 조명·카메라이고, 공장 초기화 대신 soldier_lib.clear()를 쓴다.
# 사용: Blender -b --python hero_render.py -- <glb> <출력 폴더> <attack_1 타격 프레임> [beauty 방위각=35] [접두사] [beauty 거리(키 배수)=2.75]
import bpy, sys, math
sys.path.insert(0, "/Users/lqez/dev/sandbox-games/ploh/tools/blender")
import soldier_lib as L
from mathutils import Vector

A = sys.argv[sys.argv.index("--") + 1:]
glb, outdir, strike = A[0], A[1], int(A[2])
az_b = float(A[3]) if len(A) > 3 else 35.0
pre = A[4] if len(A) > 4 else ""
dist_k = float(A[5]) if len(A) > 5 else 2.75       # beauty camera distance in heights (long weapons need more)
sc = L.clear()
bpy.ops.import_scene.gltf(filepath=glb)
for o in list(bpy.data.objects):
    if o.type == "MESH" and o.parent is None:
        bpy.data.objects.remove(o)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
ad = arm.animation_data_create()
for t in list(ad.nla_tracks):
    ad.nla_tracks.remove(t)
try:
    sc.render.engine = "BLENDER_EEVEE"
except TypeError:
    sc.render.engine = "BLENDER_EEVEE_NEXT"
sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
bg = w.node_tree.nodes["Background"]; bg.inputs[0].default_value = (0.82, 0.83, 0.85, 1); bg.inputs[1].default_value = 0.9
for name, rot, e in (("key", (45, 0, 30), 3.5), ("fill", (60, 0, -120), 1.2)):
    Ld = bpy.data.lights.new(name, "SUN"); Ld.energy = e
    o = bpy.data.objects.new(name, Ld); sc.collection.objects.link(o); o.rotation_euler = [math.radians(r) for r in rot]
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
# beauty
L.set_action(arm, bpy.data.actions["idle"], 0)
h = 1.25
sc.render.resolution_x = sc.render.resolution_y = 1024
cam.data.lens = 85; dist = h * dist_k; az = math.radians(az_b)
L.look(cam, (dist * math.sin(az), -dist * math.cos(az), h * 0.6), (0, 0, h * 0.5))
sc.render.filepath = f"{outdir}/{pre}beauty.png"; bpy.ops.render.render(write_still=True)
# ingame
bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, 0)); fl = bpy.context.active_object
m = bpy.data.materials.new("floor"); m.use_nodes = True
m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.35, 0.35, 0.36, 1); fl.data.materials.append(m)
bg.inputs[0].default_value = (0.12, 0.13, 0.15, 1)
L.set_action(arm, bpy.data.actions["attack_1"], strike)
sc.render.resolution_x, sc.render.resolution_y = 720, 1280
cam.data.lens_unit = "FOV"; cam.data.sensor_fit = "VERTICAL"; cam.data.angle_y = math.radians(50)
pitch, yaw, D = math.radians(38), math.radians(45), 8.0
tgt = Vector((0, 0, 1.0))
L.look(cam, tgt + D * Vector((math.cos(pitch) * math.sin(yaw), -math.cos(pitch) * math.cos(yaw), math.sin(pitch))), tgt)
sc.render.filepath = f"{outdir}/{pre}ingame.png"; bpy.ops.render.render(write_still=True)
print("RENDERED", outdir, "strike", strike)
