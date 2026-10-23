# Decimate a character's skinned body mesh for mobile (headless Blender 5). Weapons are not touched.
# Collapse decimation on the merged-vertex body with a protection vertex group: face/hair (Head-weighted) and hands keep
# more triangles. UVs and skin weights are carried by the collapse (customdata interpolation). Exports armature + body only;
# mocap_build.py transplants this body primitive into the hand-keyed GLB structure (same node/skin layout).
# usage: Blender -b --python decimate_body.py -- <in.glb> <out.glb> <target_tris> [head_keep=0.35] [hand_keep=0.2] [face_keep=0]
#        [seam_keep=0.35] [vg_factor=10]   (weights: 1 = decimate freely, 0 = keep)
import bpy, bmesh, sys, os, json
sys.path.insert(0, "/Users/lqez/dev/sandbox-games/ploh/tools/blender")
import soldier_lib as L
from mathutils import Vector

A = sys.argv[sys.argv.index("--") + 1:]
src, out, target = A[0], A[1], int(A[2])
head_keep = float(A[3]) if len(A) > 3 else 0.1
hand_keep = float(A[4]) if len(A) > 4 else 0.2
face_keep = float(A[5]) if len(A) > 5 else 0.0
seam_keep = float(A[6]) if len(A) > 6 else 0.35
vg_factor = float(A[7]) if len(A) > 7 else 10.0     # Blender adds (2 - w1 - w2) * edge length * factor to the collapse cost
sc = L.clear()
bpy.ops.import_scene.gltf(filepath=src, merge_vertices=True)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
body = next(o for o in bpy.data.objects if o.type == "MESH" and o.parent == arm and o.parent_type != "BONE"
            and any(m.type == "ARMATURE" for m in o.modifiers))
for o in list(bpy.data.objects):
    if o not in (arm, body):
        bpy.data.objects.remove(o)
ad = arm.animation_data
if ad:
    ad.action = None
    for t in list(ad.nla_tracks):
        ad.nla_tracks.remove(t)
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
me = body.data
tris0 = sum(len(p.vertices) - 2 for p in me.polygons)
# untouched copy (original split normals from the glTF) to transfer normals back after the weld + collapse
ref = body.copy(); ref.data = body.data.copy(); ref.name = "ref"
bpy.context.scene.collection.objects.link(ref)
for m in list(ref.modifiers):
    ref.modifiers.remove(m)
ref.hide_render = True

# protection weights: 1 = decimate freely, lower = keep detail
vg = {g.index: g.name for g in body.vertex_groups}
keep = body.vertex_groups.new(name="decimate_weight")
head_names = {"Head", "head_end", "headfront", "neck"}
hand_names = {"LeftHand", "RightHand"}
hb = arm.data.bones["Head"]
hc = arm.matrix_world @ hb.head_local                      # head joint (base of skull)
# the body is split into many islands along UV seams (normals differ, so the importer cannot merge them).
# weld co-located vertices so the decimator sees one connected surface (UVs stay per-corner, weights are identical)
# only co-located vertices whose original normals agree are welded (UV-seam duplicates); the front and back layers of thin
# two-sided parts (hair cards, ear flaps) share positions but face opposite ways and must stay apart
vnorm = [None] * len(me.vertices)
cn = me.corner_normals
for li, lp in enumerate(me.loops):
    if vnorm[lp.vertex_index] is None:
        vnorm[lp.vertex_index] = Vector(cn[li].vector)
groups = {}
for v in me.vertices:
    groups.setdefault(tuple(round(c * 1e5) for c in v.co), []).append(v.index)
bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
nv0 = len(bm.verts)
tmap = {}
for ids in groups.values():
    reps = []
    for i in ids:
        n = vnorm[i] or Vector((0, 0, 1))
        r = next((r for r in reps if (vnorm[r] or Vector((0, 0, 1))).dot(n) > 0.3), None)
        if r is None:
            reps.append(i)
        else:
            tmap[bm.verts[i]] = bm.verts[r]
bmesh.ops.weld_verts(bm, targetmap=tmap)
nv1 = len(bm.verts)
bm.to_mesh(me); bm.free()
print("weld", nv0, "->", nv1)
# UV seam vertices: collapsing across a seam smears texture from another island (dark slivers), so they are kept
bm = bmesh.new(); bm.from_mesh(me)
uvl = bm.loops.layers.uv.active
seam_v = set()
for e in bm.edges:
    if len(e.link_loops) != 2:
        seam_v.update(v.index for v in e.verts); continue
    l1, l2 = e.link_loops
    # the two faces share the edge; compare UVs of each edge vertex as seen from both faces
    for v in e.verts:
        a = next(l for l in l1.face.loops if l.vert == v)[uvl].uv
        b = next(l for l in l2.face.loops if l.vert == v)[uvl].uv
        if (a - b).length > 1e-5:
            seam_v.update(x.index for x in e.verts); break
bm.free()
print("seam verts", len(seam_v), "of", len(me.vertices))
nverts_welded = len(me.vertices)
# face mask: Head-weighted, in front of the skull centre (character faces -Y in Blender), facing forward
nface = 0
for v in me.vertices:
    wh = sum(g.weight for g in v.groups if vg.get(g.group) in head_names)
    wn = sum(g.weight for g in v.groups if vg.get(g.group) in hand_names)
    co = body.matrix_world @ v.co
    face = wh > 0.5 and co.y < hc.y - 0.03 and v.normal.y < -0.2 and co.z > hc.z - 0.03
    w = 1.0 - (1.0 - head_keep) * min(wh, 1.0)
    if face:
        w = face_keep; nface += 1
    w = min(w, 1.0 - (1.0 - hand_keep) * min(wn, 1.0))
    if v.index in seam_v:
        w = min(w, seam_keep)
    keep.add([v.index], max(w, 0.0), "REPLACE")
print("face verts", nface)
from mathutils import kdtree
face_ids = {v.index for v in me.vertices if keep.weight(v.index) == face_keep} if nface else set()
face_pts = [body.matrix_world @ me.vertices[i].co for i in face_ids]
def uvsets(ids_or_pts, by_pos):
    uvl = me.uv_layers.active.data; out = {}
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            key = tuple(round(c, 5) for c in me.vertices[vi].co)
            if (key in ids_or_pts) if by_pos else (vi in ids_or_pts):
                out.setdefault(key, set()).add((round(uvl[li].uv[0], 4), round(uvl[li].uv[1], 4)))
    return out
uv_before = uvsets(face_ids, False)

bpy.context.view_layer.objects.active = body
body.select_set(True)
if me.has_custom_normals:
    bpy.ops.mesh.customdata_custom_splitnormals_clear()

def decimate(ratio):
    md = body.modifiers.new("dec", "DECIMATE")
    md.decimate_type = "COLLAPSE"
    md.ratio = ratio
    md.use_collapse_triangulate = True
    md.vertex_group = "decimate_weight"
    md.vertex_group_factor = vg_factor
    md.use_symmetry = True
    md.symmetry_axis = "X"
    # keep the armature modifier last so the decimate runs on the rest mesh
    while body.modifiers.find("dec") > 0:
        bpy.ops.object.modifier_move_up(modifier="dec")
    dg = bpy.context.evaluated_depsgraph_get()
    n = sum(len(p.vertices) - 2 for p in body.evaluated_get(dg).data.polygons)
    return md, n

# the armature deform changes the evaluated triangle count only by 0; search the ratio on a disabled armature modifier
armmod = next(m for m in body.modifiers if m.type == "ARMATURE")
armmod.show_viewport = False
lo, hi = 0.05, 1.0
best = None
for _ in range(14):
    r = (lo + hi) / 2
    md, n = decimate(r)
    body.modifiers.remove(md)
    if best is None or abs(n - target) < abs(best[1] - target):
        best = (r, n)
    if n > target:
        hi = r
    else:
        lo = r
md, n = decimate(best[0])
bpy.ops.object.modifier_apply(modifier="dec")
armmod.show_viewport = True
for p in me.polygons:
    p.use_smooth = True
bpy.data.objects.remove(ref)
tris1 = sum(len(p.vertices) - 2 for p in me.polygons)
kd = kdtree.KDTree(len(me.vertices))
for i, v in enumerate(me.vertices):
    kd.insert(body.matrix_world @ v.co, i)
kd.balance()
face_kept = sum(1 for p in face_pts if kd.find(p)[2] < 1e-5)
print("FACEKEPT", face_kept, "of", len(face_pts))
uv_after = uvsets(set(uv_before), True)
changed = sum(1 for k in uv_before if uv_after.get(k) != uv_before[k])
print("FACEUV changed", changed, "of", len(uv_before))
body.vertex_groups.remove(body.vertex_groups["decimate_weight"])
for o in bpy.data.objects:
    o.select_set(o in (arm, body))
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_animations=False, export_skins=True,
                          export_yup=True, export_normals=True, export_texcoords=True, export_materials="NONE",
                          export_apply=False)
print("DECIMATE", json.dumps({"src": src, "out": out, "tris_before": tris0, "tris_after": tris1, "ratio": round(best[0], 4),
                              "head_keep": head_keep, "hand_keep": hand_keep, "face_keep": face_keep, "face_verts": nface,
                              "seam_keep": seam_keep, "vg_factor": vg_factor, "seam_verts": len(seam_v), "welded_verts": nverts_welded}))
