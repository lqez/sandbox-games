"""공식 3면도(실사 비율, 약 6.4등신)를 PLOH 영웅 비율(약 4.5등신)로 바꾼다: 머리를 목 축을 중심으로 키우고(s배), 턱 아래 몸은
세로로만 조금 줄인다(k배). 세 인물이 같은 행에 서 있으므로 세로 변환은 하나, 가로 확대는 인물마다 목 축 열을 중심으로 한다.
턱 행(chin) 위는 s배, 아래는 k배이고 그 사이(chin-40 .. chin+140, 출력 행)에서 배율이 매끄럽게 바뀐다(마스크·옆머리가 꺾이지 않게).
가로 배율은 턱 아래에서 1.0으로 돌아간다(어깨·몸 폭은 그대로).
사용: python chibi_warp.py <in.png> <out.png> <chin_row> <neck_axis_x,...> [s=1.42] [k=0.92]
"""
import sys
import numpy as np
from PIL import Image

src, out, chin = sys.argv[1], sys.argv[2], int(sys.argv[3])
axes = [int(v) for v in sys.argv[4].split(",")]
s = float(sys.argv[5]) if len(sys.argv) > 5 else 1.42
k = float(sys.argv[6]) if len(sys.argv) > 6 else 0.92
im = Image.open(src).convert("RGB"); a = np.asarray(im).astype(np.float32)
H, W, _ = a.shape
bg = np.median(np.concatenate([a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3), a[:, :8].reshape(-1, 3), a[:, -8:].reshape(-1, 3)]), 0)
ya, yb = chin - 40, chin + 140                     # output rows of the blend zone
yo = np.arange(H, dtype=np.float64)
t = np.clip((yo - ya) / (yb - ya), 0, 1); t = t * t * (3 - 2 * t)
sig_v = s + (k - s) * t                            # local vertical magnification (output px per source px)
sig_h = s + (1.0 - s) * t                          # local horizontal magnification about the neck axis
# source row for each output row: integrate 1/sig_v from the chin (fixed point)
inv = 1.0 / sig_v
ys = np.empty(H)
ys[chin] = chin
for y in range(chin + 1, H):
    ys[y] = ys[y - 1] + 0.5 * (inv[y] + inv[y - 1])
for y in range(chin - 1, -1, -1):
    ys[y] = ys[y + 1] - 0.5 * (inv[y] + inv[y + 1])
# horizontal: each output column belongs to the nearest neck axis (figures are far apart)
xo = np.arange(W, dtype=np.float64)
axes_a = np.array(axes, float)
near = axes_a[np.argmin(np.abs(xo[:, None] - axes_a[None, :]), 1)]
xs = near[None, :] + (xo[None, :] - near[None, :]) / sig_h[:, None]       # (H, W)
ysg = np.broadcast_to(ys[:, None], (H, W))
# bilinear sample
x0 = np.floor(xs).astype(int); y0 = np.floor(ysg).astype(int)
fx = (xs - x0).astype(np.float32); fy = (ysg - y0).astype(np.float32)
valid = (x0 >= 0) & (x0 < W - 1) & (y0 >= 0) & (y0 < H - 1)
x0c = np.clip(x0, 0, W - 2); y0c = np.clip(y0, 0, H - 2)
c00 = a[y0c, x0c]; c10 = a[y0c, x0c + 1]; c01 = a[y0c + 1, x0c]; c11 = a[y0c + 1, x0c + 1]
res = (c00 * ((1 - fx) * (1 - fy))[..., None] + c10 * (fx * (1 - fy))[..., None]
       + c01 * ((1 - fx) * fy)[..., None] + c11 * (fx * fy)[..., None])
res[~valid] = bg
Image.fromarray(np.clip(res, 0, 255).astype(np.uint8)).save(out)
fg = np.abs(res - bg).sum(2) > 30
rows = np.where(fg.sum(1) > 2)[0]
skull = int(sys.argv[7]) if len(sys.argv) > 7 else None       # source row of the skull top (for the head-count estimate)
if skull is not None:
    top_out = int(np.argmin(np.abs(ys - skull)))
    print("heads", round((rows.max() - top_out) / (chin - top_out), 2), "head_px", chin - top_out)
print("warped", out, "rows", int(rows.min()), int(rows.max()), "chin", chin)
