"""HUD 초상화를 영웅 beauty.png(Blender 렌더, 회색 배경)에서 잘라 만든다.
사용: uv run --no-project --with pillow --with numpy python ploh/tools/ui/make_portraits.py
출력: ploh/game/assets/ui/portrait_<id>.png(둥근 사각, 192²), portrait_<id>_round.png(원, 192²)
배경 회색(223,224,226)은 테두리에서 이어진 부분만 투명하게 지운다(얼굴 안의 비슷한 색은 남긴다).
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

PLOH = Path(__file__).resolve().parents[2]
A = PLOH / "game/assets"
OUT = A / "ui"
# 얼굴이 가운데 오는 정사각 영역(1024² beauty.png 좌표)
HEROES = {
    # 프라우: 쉬는 자세 얼굴 렌더(tests/portrait.tscn, 정면 3/4, 1024²)
    "frau": ("astrid/B_mid/portrait_src.png", (200, 360, 700, 860)),
    "fram": ("fram/beauty.png", (372, 92, 592, 312)),
    "schneider": ("schneider/beauty.png", (382, 172, 632, 422)),
}
BG = np.array([223, 224, 226], np.float32)
SIZE = 192


def key(im):
    rgb = np.asarray(im.convert("RGB"), np.float32)
    d = np.sqrt(((rgb - BG) ** 2).sum(-1))
    near = (d < 22).astype(np.uint8) * 255
    # 테두리에서 이어진 배경만 고른다
    m = Image.fromarray(near, "L").copy()   # fromarray 이미지는 읽기 전용이라 floodfill이 먹지 않는다
    w, h = m.size
    for x, y in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (0, h // 2), (w - 1, h // 2)]:
        if m.getpixel((x, y)) == 255:
            ImageDraw.floodfill(m, (x, y), 128)
    bg = np.asarray(m) == 128
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    a = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(0.8))
    out = im.convert("RGBA")
    out.putalpha(a)
    return out


def mask(shape, size):
    s = size * 4
    m = Image.new("L", (s, s), 0)
    dr = ImageDraw.Draw(m)
    if shape == "round":
        dr.ellipse((0, 0, s - 1, s - 1), fill=255)
    else:
        dr.rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.18), fill=255)
    return m.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
for hid, (src, box) in HEROES.items():
    im = Image.open(A / src).crop(box).resize((SIZE, SIZE), Image.LANCZOS)
    k = key(im)
    for shape, suffix in [("rect", ""), ("round", "_round")]:
        o = k.copy()
        a = np.minimum(np.asarray(o.split()[3], np.uint16), np.asarray(mask(shape, SIZE), np.uint16)).astype(np.uint8)
        o.putalpha(Image.fromarray(a, "L"))
        o.save(OUT / f"portrait_{hid}{suffix}.png", optimize=True)
        print("saved", OUT / f"portrait_{hid}{suffix}.png")
