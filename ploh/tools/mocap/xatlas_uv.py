"""UV atlas for a re-textured body (called by rebake_body.py): xatlas charts + packing of a triangle mesh.
Blender's Smart UV Project splits the decimated Meshy bodies into ~1500 small islands that cover only ~20 % of the texture;
xatlas grows charts over the welded surface and packs them to ~80 % with a texel padding between charts.
usage: uv run --no-project --python 3.12 --with xatlas --with numpy python xatlas_uv.py <in.npz: V (n,3), F (m,3)> <out.npz>
       [resolution=2048] [padding_px=8]
out.npz: UV (m,3,2) per face corner in [0,1] (Blender convention, v up), charts, utilization"""
import sys
import numpy as np
import xatlas

src, dst = sys.argv[1], sys.argv[2]
res = int(sys.argv[3]) if len(sys.argv) > 3 else 2048
pad = int(sys.argv[4]) if len(sys.argv) > 4 else 8
d = np.load(src)
V, F = d["V"].astype(np.float32), d["F"].astype(np.uint32)
atlas = xatlas.Atlas()
atlas.add_mesh(V, F)
co = xatlas.ChartOptions()
co.max_iterations = 2
po = xatlas.PackOptions()
po.resolution = res
po.padding = pad
po.bilinear = True
po.rotate_charts = True
atlas.generate(co, po)
vmap, idx, uv = atlas[0]
assert len(idx) == len(F)
# xatlas may return a slightly larger atlas than requested: the uvs are normalised to its size, keep the square aspect
w, h = atlas.width, atlas.height
s = max(w, h)
uv = uv * np.array([w / s, h / s])
UV = uv[idx]                                        # (m,3,2)
UV[..., 1] = 1.0 - UV[..., 1]                       # xatlas v grows down
np.savez(dst, UV=UV.astype(np.float32), charts=atlas.chart_count, utilization=atlas.utilization, size=[w, h])
print("XATLAS", atlas.chart_count, round(float(atlas.utilization), 3), w, h)
