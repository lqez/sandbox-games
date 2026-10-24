# 프라우(아스트리드 레몽) 기준 GLB(raw/astrid_handkeyed.glb)를 공식 3면도로 만든 Meshy 리그에서 만든다(헤드리스 Blender 5).
# 이름은 예전 손 키 버전과 같지만 손 키 동작은 없다. mocap_build.py가 이 파일의 몸·스킨·무기 노드를 그대로 쓰고
# 동작은 Meshy 라이브러리 모캡으로 채운다(archer_base.py와 같은 구조).
#  1) Meshy rigged.glb(공식 3면도 → multi-image-to-3d → rigging) 몸 메시 `char1` + 휴머노이드 24본
#  2) 키 1.25 m, 발바닥 원점, 수평 중심, 변환 적용, 노멀 재계산(감김 방향 통일), 스무스 셰이딩, 텍스처 2048²
#  3) 오른손을 주먹으로 말고(메시 자체 수정) 절차적 검 weapon_sword를 RightHand 본에 붙인다
#     검은 원화 `프라우_무기.jpg`의 단일 칼날 스케치·FrauWeaponBasicE 색(건메탈 몸체, 라임 날, 마젠타 상감, 라임 '눈' 리벳)을 따른다
#     검 로컬 축: +Z = 칼날(엄지 쪽), +X = 주먹 마디 쪽, 원점 = 주먹 안 손잡이 중심
# 사용: /Applications/Blender.app/Contents/MacOS/Blender -b --python astrid_build.py -- <rigged.glb> <out.glb>
import bpy, bmesh, sys, os, math, json
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import soldier_lib as L

A = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = A[0], A[1]
HEIGHT = 1.25
sc = L.clear()


def upd():
    bpy.context.view_layer.update()


bpy.ops.import_scene.gltf(filepath=SRC)
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
mesh = next(o for o in bpy.data.objects if o.type == "MESH" and o.parent == arm)
for o in list(bpy.data.objects):
    if o not in (arm, mesh):
        bpy.data.objects.remove(o)
arm.name = "Armature"; mesh.name = "char1"; mesh.data.name = "char1"
ad = arm.animation_data_create()
for t in list(ad.nla_tracks):
    ad.nla_tracks.remove(t)
ad.action = None


def bbox(o):
    dg = bpy.context.evaluated_depsgraph_get(); e = o.evaluated_get(dg)
    pts = [e.matrix_world @ v.co for v in e.data.vertices]
    return (Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))),
            Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))))


arm.data.pose_position = "REST"; upd()
lo, hi = bbox(mesh); k = HEIGHT / (hi.z - lo.z)
arm.scale = arm.scale * k; upd()
lo, hi = bbox(mesh)
arm.location -= Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z)); upd()
for o in bpy.data.objects:
    o.select_set(o in (arm, mesh))
bpy.context.view_layer.objects.active = arm
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = mesh.data
bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)       # one winding per shell (the game shader tolerates flips, but add none)
bm.to_mesh(me); bm.free()
for p in me.polygons:
    p.use_smooth = True
for im in bpy.data.images:
    if max(im.size) > 2048:
        im.scale(2048, 2048)
    im.name = "Material_0_baseColor"
for m in me.materials:
    m.name = "Material_0"
arm.data.pose_position = "POSE"; upd()
BONES = arm.data.bones


def mat(name, rgb, metal=0.0, rough=0.6, emit=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True; b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1); b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1); b.inputs["Emission Strength"].default_value = 1.0
    return m


class Builder:
    def __init__(self, name):
        self.bm = bmesh.new(); self.mats = []; self.name = name

    def _mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def loft(self, rings, m, cap0=True, cap1=True):
        bm = self.bm; mi = self._mi(m); vr = []
        for r in rings:
            vr.append([bm.verts.new(p) for p in (r if isinstance(r[0], (tuple, list)) else [r])])
        for a, b in zip(vr, vr[1:]):
            if len(a) == 1 or len(b) == 1:
                apex, ring = (a[0], b) if len(a) == 1 else (b[0], a)
                for i in range(len(ring)):
                    bm.faces.new((ring[i], ring[(i + 1) % len(ring)], apex)).material_index = mi
            else:
                for i in range(len(a)):
                    bm.faces.new((a[i], a[(i + 1) % len(a)], b[(i + 1) % len(b)], b[i])).material_index = mi
        if cap0 and len(vr[0]) > 2:
            bm.faces.new(list(reversed(vr[0]))).material_index = mi
        if cap1 and len(vr[-1]) > 2:
            bm.faces.new(vr[-1]).material_index = mi

    def ring(self, r, z, n=8, ph=0.0, sx=1.0, sy=1.0, cx=0.0):
        return [(cx + r * sx * math.cos(2 * math.pi * i / n + ph), r * sy * math.sin(2 * math.pi * i / n + ph), z) for i in range(n)]

    def cyl(self, r, z0, z1, m, n=8, cx=0.0):
        self.loft([self.ring(r, z0, n, cx=cx), self.ring(r, z1, n, cx=cx)], m)

    def box(self, c, s, m):
        x, y, z = c; a, b, d = (s[0] / 2, s[1] / 2, s[2] / 2)
        self.loft([[(x - a, y - b, z - d), (x + a, y - b, z - d), (x + a, y + b, z - d), (x - a, y + b, z - d)],
                   [(x - a, y - b, z + d), (x + a, y - b, z + d), (x + a, y + b, z + d), (x - a, y + b, z + d)]], m)

    def finish(self):
        mesh_ = bpy.data.meshes.new(self.name)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        self.bm.to_mesh(mesh_); self.bm.free()
        for m in self.mats:
            mesh_.materials.append(m)
        for p in mesh_.polygons:
            p.use_smooth = False
        ob = bpy.data.objects.new(self.name, mesh_); sc.collection.objects.link(ob)
        return ob


def build_frau_blade():
    """프라우의 한손 장검(칼날 날개 한 장과 같은 디자인). 로컬 +Z = 칼날, +X = 주먹 마디 쪽(앞날), 원점 = 손잡이 중심.
    건메탈 몸체, 양쪽 라임 날(약한 발광), 마젠타 마름모 상감, 날밑 근처 라임 '눈' 리벳, 검은 손잡이, 라임 자루끝."""
    dark = mat("prop_gunmetal", (0.17, 0.17, 0.19), 0.7, 0.45)
    black = mat("prop_black", (0.05, 0.05, 0.06), 0.2, 0.7)
    lime = mat("prop_lime", (0.55, 0.95, 0.15), 0.0, 0.35, emit=(0.30, 0.65, 0.05))
    magenta = mat("prop_magenta", (0.90, 0.10, 0.75), 0.0, 0.35, emit=(0.55, 0.04, 0.45))
    steel = mat("prop_steel", (0.55, 0.57, 0.60), 0.8, 0.4)
    b = Builder("weapon_sword")
    z0, z1 = 0.14, 0.57                                # blade root .. tip (0.43 m blade; tip 0.59 m from the wrist, as the old KayKit sword)
    zb = z0 + 0.36 * (z1 - z0)                         # barb (hook) on the back edge
    t, e = 0.0075, 0.009                               # half thickness at the spine, lime edge width
    # half widths of the blade along z: front edge (+X) straight taper, back edge (-X) with a concave cutout and a barb at z=0.30
    def wf(z):
        u = (z - z0) / (z1 - z0)
        return 0.046 * (1 - u) ** 0.85 + 0.004
    def wb(z):
        u = (z - z0) / (z1 - z0)
        base = 0.040 * (1 - u) ** 0.9 + 0.004
        if z0 <= z < zb:                                 # cutout between the ricasso and the barb (concave arc)
            s_ = (z - z0) / (zb - z0)
            return base - 0.022 * math.sin(math.pi * s_) ** 0.8 + (0.016 if s_ > 0.93 else 0.0) * ((s_ - 0.93) / 0.07)
        return base + 0.018 * max(0.0, 1 - abs(z - zb - 0.005) / 0.03)   # barb tip
    zs = [z0 + (zb - z0) * f for f in (0.0, 0.18, 0.36, 0.56, 0.76, 0.9, 1.0)] + \
         [zb + (z1 - zb) * f for f in (0.05, 0.12, 0.3, 0.5, 0.7, 0.85, 0.95)]
    core, ef, eb = [], [], []
    for z in zs:
        f, bk = wf(z), wb(z)
        tz = t * (1 - 0.5 * (z - z0) / (z1 - z0))
        core.append([(f - e, -tz), (f - e, tz), (-(bk - e), tz), (-(bk - e), -tz)])
        ef.append([(f - e, tz * 0.55), (f, 0.0), (f - e, -tz * 0.55)])
        eb.append([(-(bk - e), -tz * 0.55), (-bk, 0.0), (-(bk - e), tz * 0.55)])
    b.loft([[(x, y, z) for x, y in r] for r, z in zip(core, zs)] + [(0.0, 0.0, z1)], dark)
    b.loft([[(x, y, z) for x, y in r] for r, z in zip(ef, zs)] + [(0.002, 0.0, z1)], lime)
    b.loft([[(x, y, z) for x, y in r] for r, z in zip(eb, zs)] + [(-0.002, 0.0, z1)], lime)
    # magenta diamond inlay on both flats
    for sg in (1, -1):
        zc, xc, h, w = z0 + 0.55 * (zb - z0), 0.004, 0.04, 0.013
        b.loft([[(xc, sg * t * 0.9, zc - h / 2), (xc + w / 2, sg * t * 0.9, zc), (xc, sg * t * 0.9, zc + h / 2), (xc - w / 2, sg * t * 0.9, zc)],
                [(xc, sg * (t + 0.0025), zc - h / 2), (xc + w / 2 * 0.7, sg * (t + 0.0025), zc), (xc, sg * (t + 0.0025), zc + h / 2),
                 (xc - w / 2 * 0.7, sg * (t + 0.0025), zc)]], magenta)
    # lime 'eye' rivet at the barb root (through the flat, both sides)
    for sg in (1, -1):
        cx, cz, r = -0.010, zb - 0.01, 0.010
        ring0 = [(cx + r * math.cos(a), sg * t * 0.9, cz + r * math.sin(a)) for a in [2 * math.pi * i / 8 for i in range(8)]]
        ring1 = [(cx + r * 0.75 * math.cos(a), sg * (t + 0.004), cz + r * 0.75 * math.sin(a)) for a in [2 * math.pi * i / 8 for i in range(8)]]
        ring2 = [(cx + r * 0.4 * math.cos(a), sg * (t + 0.0045), cz + r * 0.4 * math.sin(a)) for a in [2 * math.pi * i / 8 for i in range(8)]]
        b.loft([ring0, ring1], steel, cap0=False, cap1=False)
        b.loft([ring1, ring2], lime, cap0=False)
    # guard: a slim asymmetric block (longer toward the back edge), steel face plates
    b.box((-0.008, 0.0, 0.125), (0.085, 0.024, 0.024), dark)
    b.box((-0.008, 0.0, 0.125), (0.060, 0.030, 0.012), steel)
    # grip (octagonal), wrapped look by two black bands, lime pommel cap
    b.loft([b.ring(0.016, 0.113, 8), b.ring(0.014, 0.06, 8), b.ring(0.014, -0.04, 8), b.ring(0.016, -0.075, 8)], black)
    b.loft([b.ring(0.017, -0.075, 8), b.ring(0.019, -0.088, 8), b.ring(0.012, -0.100, 8), (0.0, 0.0, -0.106)], lime)
    return b.finish()


H = max(v.co.z for v in me.vertices)
info = {"height": round(H, 4)}
Cc, S0, H0, nv = L.make_fist(mesh, arm, "Right"); info["fist_right_verts"] = nv
sword = build_frau_blade()
L.attach_to_bone(sword, arm, "RightHand", Cc, H0, S0)
upd()

for pb in arm.pose.bones:
    pb.rotation_mode = "QUATERNION"; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
upd()
for o in bpy.data.objects:
    o.select_set(o.type in ("ARMATURE", "MESH"))
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_animation_mode="ACTIONS",
                          export_yup=True, export_force_sampling=True, export_frame_step=1,
                          export_optimize_animation_size=False, export_image_format="AUTO")
tip = max((sword.matrix_world @ v.co for v in sword.data.vertices), key=lambda p: (p - (arm.matrix_world @ BONES["RightHand"].head_local)).length)
info.update({"tris_body": sum(len(p.vertices) - 2 for p in me.polygons),
             "tris_sword": sum(len(p.vertices) - 2 for p in sword.data.polygons),
             "sword_tip_from_hand_m": round((tip - (arm.matrix_world @ BONES["RightHand"].head_local)).length, 3),
             "images": {i.name: list(i.size) for i in bpy.data.images}, "bones": [b.name for b in BONES],
             "bbox_rest": [[round(v, 3) for v in lo], [round(v, 3) for v in hi]]})
print("INFO", json.dumps(info))
