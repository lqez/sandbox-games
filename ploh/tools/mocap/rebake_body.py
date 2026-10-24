# Re-texture a decimated body (headless Blender 5): fresh UV atlas + base colour baked from the full-res textured body.
# Why: the Meshy atlas is shattered into hundreds of tiny UV islands packed edge to edge. Collapse decimation (decimate_body.py)
# merges vertices across those islands, so many decimated triangles span two islands and sample colours from unrelated parts
# of the atlas (white / skin slivers in black hair, blotches). Even untouched, the atlas has no padding between islands, so
# mipmaps bleed neighbouring islands at a distance. Here the decimated body gets a new atlas (xatlas charts grown over the
# welded surface, packed with a texel padding; tools/mocap/xatlas_uv.py, run with uv) and the colour is baked from the
# ORIGINAL full-res mesh + atlas (Cycles, selected-to-active, diffuse colour only, no lighting); the gaps between charts are
# filled by dilating the chart borders, so mipmaps only blend a chart with its own colours.
# The decimated body's geometry, per-corner normals and skin weights are kept: co-located vertex copies (old UV seams) are
# welded so the new charts can cross the old seams (copies with opposite normals, i.e. the two layers of two-sided hair cards,
# stay apart), and the old corner normals are restored as custom normals.
# Exports armature + body + the baked texture (JPEG); mocap_build.py transplants the body and replaces the body's base colour
# image in the final GLB (gltfio.body_from / write_glb).
# usage: Blender -b --python rebake_body.py -- <full.glb> <decimated.glb> <out.glb> <out_image.png> [res=2048] [pad_px=8]
#        [extrude_tiers_m=0.002,0.008,0.025] [max_ray_m=0.03] [weld_dot=-0.5]
import bpy, bmesh, sys, os, json, math, shutil, subprocess, tempfile
import numpy as np
sys.path.insert(0, "/Users/lqez/dev/sandbox-games/ploh/tools/blender")
import soldier_lib as L
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
A = sys.argv[sys.argv.index("--") + 1:]
full, dec, out, out_img = A[0], A[1], A[2], A[3]
res = int(A[4]) if len(A) > 4 else 2048
pad_px = int(A[5]) if len(A) > 5 else 8
tiers = [float(x) for x in (A[6] if len(A) > 6 else "0.002,0.008,0.025").split(",")]
max_ray = float(A[7]) if len(A) > 7 else 0.03
weld_dot = float(A[8]) if len(A) > 8 else -0.5
margin_px = 16                                   # Cycles bake margin (the dilation below fills the rest of the gaps)
MAGENTA = (1.0, 0.0, 1.0, 1.0)


def import_body(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == "ARMATURE")
    body = next(o for o in new if o.type == "MESH" and o.parent == arm and o.parent_type != "BONE"
                and any(m.type == "ARMATURE" for m in o.modifiers))
    for o in new:
        if o not in (arm, body):
            bpy.data.objects.remove(o)
    ad = arm.animation_data
    if ad:
        ad.action = None
        for t in list(ad.nla_tracks):
            ad.nla_tracks.remove(t)
    for m in body.modifiers:                       # bake in bind space (both meshes come from the same bind pose)
        if m.type == "ARMATURE":
            m.show_viewport = m.show_render = False
    return arm, body


sc = L.clear()
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
src_arm, src = import_body(full)
dst_arm, dst = import_body(dec)
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
me = dst.data
tris0 = sum(len(p.vertices) - 2 for p in me.polygons)

# weld the co-located vertex copies of the decimated body (old UV seams) so the unwrap is not forced to follow the old
# seams. Copies whose normals point opposite ways (front/back layers of two-sided hair cards, ear flaps) stay apart.
# The decimated body's per-corner normals are restored afterwards as custom normals, so shading does not change.
loop_n = [tuple(cn_.vector) for cn_ in me.corner_normals]
loop0 = [p.loop_start for p in me.polygons]
fi_attr = me.attributes.new("orig_fi", "INT", "FACE")      # survives the weld; maps faces back to their old corners
fi_attr.data.foreach_set("value", list(range(len(me.polygons))))
vnorm = [None] * len(me.vertices)
for li, lp in enumerate(me.loops):
    if vnorm[lp.vertex_index] is None:
        vnorm[lp.vertex_index] = Vector(loop_n[li])
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
        r = next((r for r in reps if (vnorm[r] or Vector((0, 0, 1))).dot(n) > weld_dot), None)
        if r is None:
            reps.append(i)
        else:
            tmap[bm.verts[i]] = bm.verts[r]
bmesh.ops.weld_verts(bm, targetmap=tmap)
nv1 = len(bm.verts)
bm.to_mesh(me); bm.free()
for p in me.polygons:
    p.use_smooth = True
ofi = [0] * len(me.polygons); me.attributes["orig_fi"].data.foreach_get("value", ofi)
new_n = [None] * len(me.loops)
for p, k in zip(me.polygons, ofi):
    for j, li_ in enumerate(p.loop_indices):
        new_n[li_] = loop_n[loop0[k] + j]
me.normals_split_custom_set(new_n)
me.attributes.remove(me.attributes["orig_fi"])
tris_dropped = tris0 - len(me.polygons)                     # faces that became degenerate in the weld (a few at most)
tris1 = sum(len(p.vertices) - 2 for p in me.polygons)

# fresh atlas: xatlas on the welded triangles (separate Python with uv: xatlas is not in Blender's Python)
assert all(len(p.vertices) == 3 for p in me.polygons)
tmp = tempfile.mkdtemp(prefix="rebake_")
np.savez(os.path.join(tmp, "in.npz"), V=np.array([v.co[:] for v in me.vertices], np.float32),
         F=np.array([p.vertices[:] for p in me.polygons], np.uint32))
uvbin = shutil.which("uv") or next((p for p in ("/opt/homebrew/bin/uv", os.path.expanduser("~/.local/bin/uv"),
                                                 os.path.expanduser("~/.cargo/bin/uv")) if os.path.exists(p)), "uv")
r = subprocess.run([uvbin, "run", "--no-project", "--python", "3.12", "--with", "xatlas", "--with", "numpy", "python",
                    os.path.join(HERE, "xatlas_uv.py"), os.path.join(tmp, "in.npz"), os.path.join(tmp, "out.npz"), str(res),
                    str(pad_px)], capture_output=True, text=True)
if r.returncode != 0:
    raise SystemExit("xatlas failed:\n" + r.stdout[-2000:] + r.stderr[-2000:])
xat = np.load(os.path.join(tmp, "out.npz"))
UV = xat["UV"]
xat = {k: xat[k] for k in ("charts", "utilization")}
shutil.rmtree(tmp, ignore_errors=True)
for uv in list(me.uv_layers):
    me.uv_layers.remove(uv)
uvl = me.uv_layers.new(name="UVMap")
me.uv_layers.active = uvl
uvl.active_render = True
li = np.array([list(p.loop_indices) for p in me.polygons]).reshape(-1)
flat = np.zeros((len(me.loops), 2), np.float32); flat[li] = UV.reshape(-1, 2)
uvl.data.foreach_set("uv", flat.reshape(-1))
me.update()
# island count (connected faces in UV space)
bm = bmesh.new(); bm.from_mesh(me)
uvk = bm.loops.layers.uv.active
seen = set(); islands = 0
bm.faces.ensure_lookup_table()
for f0 in bm.faces:
    if f0.index in seen:
        continue
    islands += 1
    stack = [f0]; seen.add(f0.index)
    while stack:
        f = stack.pop()
        for l in f.loops:
            e = l.edge
            for l2 in e.link_loops:
                g = l2.face
                if g.index in seen or g is f:
                    continue
                a1, b1 = l[uvk].uv, l.link_loop_next[uvk].uv
                a2, b2 = l2[uvk].uv, l2.link_loop_next[uvk].uv
                if ((a1 - b2).length < 1e-6 and (b1 - a2).length < 1e-6) or ((a1 - a2).length < 1e-6 and (b1 - b2).length < 1e-6):
                    seen.add(g.index); stack.append(g)
uv_tris = [[tuple(l[uvk].uv) for l in f.loops] for f in bm.faces]
bm.free()

# bake target material
img = bpy.data.images.new("baked", res, res, alpha=False)
img.generated_color = MAGENTA
mat = bpy.data.materials.new("baked"); mat.use_nodes = True
nt = mat.node_tree
tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Roughness"].default_value = 0.8
if "Metallic" in bsdf.inputs:
    bsdf.inputs["Metallic"].default_value = 0.0
nt.nodes.active = tex
me.materials.clear(); me.materials.append(mat)

sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = 4
sc.render.bake.use_selected_to_active = True
sc.render.bake.max_ray_distance = max_ray
sc.render.bake.margin = margin_px
sc.render.bake.margin_type = "EXTEND"
sc.render.bake.use_pass_direct = False
sc.render.bake.use_pass_indirect = False
sc.render.bake.use_pass_color = True
for o in bpy.data.objects:
    o.select_set(False)
src.select_set(True); dst.select_set(True)
bpy.context.view_layer.objects.active = dst
# tiered cage: rays start `extrude` outside the decimated surface and take the first surface they meet, so a deep cage picks
# up layers in front (fram's bangs over the eyes) while a shallow one misses where the collapse moved the surface inward.
# Each texel takes the shallowest tier that hit something (a miss bakes pure black; the Meshy atlases have no pure black).
W = H = res
px = None; tier_hits = []
for ext in tiers:
    sc.render.bake.cage_extrusion = ext
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, use_selected_to_active=True, cage_extrusion=ext,
                        max_ray_distance=max_ray, margin=margin_px, margin_type="EXTEND", target="IMAGE_TEXTURES")
    q = np.empty(W * H * 4, np.float32); img.pixels.foreach_get(q); q = q.reshape(H, W, 4)
    if px is None:
        px = q.copy(); tier_hits.append(int((q[..., :3].max(2) > 1e-6).sum()))
    else:
        take = (px[..., :3].max(2) <= 1e-6) & (q[..., :3].max(2) > 1e-6)
        px[take] = q[take]; tier_hits.append(int(take.sum()))
nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])     # linked only now (the bake target must not feed itself)

# missed texels: magenta / untouched texels inside the UV triangles (rasterised here at texel centres)
mag = (px[..., 0] > 0.98) & (px[..., 1] < 0.02) & (px[..., 2] > 0.98)
mask = np.zeros((H, W), bool)
for t in uv_tris:
    for k in range(1, len(t) - 1):
        P = np.array([t[0], t[k], t[k + 1]], float) * [W, H] - 0.5
        (x0, y0), (x1, y1), (x2, y2) = P
        d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(d) < 1e-12:
            continue
        xa, xb = max(int(np.floor(P[:, 0].min())), 0), min(int(np.ceil(P[:, 0].max())), W - 1)
        ya, yb = max(int(np.floor(P[:, 1].min())), 0), min(int(np.ceil(P[:, 1].max())), H - 1)
        if xb < xa or yb < ya:
            continue
        X, Y = np.meshgrid(np.arange(xa, xb + 1), np.arange(ya, yb + 1))
        l1 = ((y1 - y2) * (X - x2) + (x2 - x1) * (Y - y2)) / d
        l2 = ((y2 - y0) * (X - x2) + (x0 - x2) * (Y - y2)) / d
        mask[ya:yb + 1, xa:xb + 1] |= (l1 >= -1e-6) & (l2 >= -1e-6) & (1 - l1 - l2 >= -1e-6)
blank = (px[..., 0] < 1e-6) & (px[..., 1] < 1e-6) & (px[..., 2] < 1e-6)
inside = int(mask.sum()); missed = int((mask & (mag | blank)).sum())
if os.environ.get("REBAKE_DEBUG"):                         # missed texels in red over the raw bake, for inspection
    dbg = bpy.data.images.new("dbg", W, H, alpha=False); q = px.copy(); q[mask & (mag | blank)] = (1, 0, 0, 1)
    dbg.pixels.foreach_set(q.reshape(-1)); dbg.filepath_raw = os.path.splitext(out_img)[0] + "_missed.png"
    dbg.file_format = "PNG"; dbg.save()
# fill the remaining magenta (missed rays and the unused space past the bake margin) from the nearest baked texels:
# repeated 4-neighbour dilation, so mipmaps of the gaps carry the colours of the islands they border
rgb = px[..., :3].copy(); bad = ~mask | mag | blank
for it in range(256):
    if not bad.any():
        break
    acc = np.zeros_like(rgb); cnt = np.zeros((H, W), np.float32)
    good = ~bad
    for sl_dst, sl_src in (((slice(None), slice(1, None)), (slice(None), slice(None, -1))),
                           ((slice(None), slice(None, -1)), (slice(None), slice(1, None))),
                           ((slice(1, None), slice(None)), (slice(None, -1), slice(None))),
                           ((slice(None, -1), slice(None)), (slice(1, None), slice(None)))):
        g = good[sl_src]
        acc[sl_dst] += rgb[sl_src] * g[..., None]; cnt[sl_dst] += g
    upd = bad & (cnt > 0)
    rgb[upd] = acc[upd] / cnt[upd][:, None]; bad[upd] = False
left = int(bad.sum())
rgb[bad] = 0.5
px[..., :3] = rgb; px[..., 3] = 1.0
img.pixels.foreach_set(px.reshape(-1))
img.update()
img.filepath_raw = out_img
img.file_format = "PNG"
img.save()

# export armature + re-textured body (texture embedded as JPEG)
for m in dst.modifiers:
    if m.type == "ARMATURE":
        m.show_viewport = m.show_render = True
bpy.data.objects.remove(src)
bpy.data.objects.remove(src_arm)
for o in bpy.data.objects:
    o.select_set(o in (dst_arm, dst))
bpy.context.view_layer.objects.active = dst
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_animations=False, export_skins=True,
                          export_yup=True, export_normals=True, export_texcoords=True, export_materials="EXPORT",
                          export_image_format="JPEG", export_jpeg_quality=92, export_apply=False)
print("REBAKE", json.dumps({"full": full, "dec": dec, "out": out, "image": out_img, "res": res, "pad_px": pad_px, "bake_margin_px": margin_px,
                            "extrude_tiers_m": tiers, "tier_texels": tier_hits, "max_ray_m": max_ray, "xatlas_charts": int(xat["charts"]),
                            "xatlas_utilization": round(float(xat["utilization"]), 3),
                            "tris_dec": tris0, "tris_out": tris1, "tris_dropped_in_weld": tris_dropped, "verts_before_weld": nv0, "verts_welded": nv1, "weld_dot": weld_dot,
                            "uv_coverage_pct": round(100.0 * inside / (res * res), 1),
                            "uv_islands": islands, "texels_inside": inside, "missed_texels": missed,
                            "missed_pct": round(100.0 * missed / max(inside, 1), 3), "unfilled": left}))
