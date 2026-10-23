"""KayKit 던전 소품이 함께 쓰는 팔레트 아틀라스를 던전 톤으로 바꾼다.

채도가 높은 칸은 흙빛으로 옮기고 밝기를 조금 낮춘다. 칸 안에 미세한 결(노이즈)을 넣어
평평한 플라스틱 느낌을 줄인다. 원본은 그대로 두고 palette_dungeon_muted.png로 쓴다.
"""
import colorsys
import random
import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGBA")
w, h = im.size
px = im.load()
out = Image.new("RGBA", (w, h))
po = out.load()
rng = random.Random(3)
grain = [[rng.uniform(-1, 1) for _ in range(w)] for _ in range(h)]
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        hh, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        # 채도: 강한 색일수록 많이 누른다. 붉은·분홍 계열은 갈색 쪽으로 옮긴다
        s2 = s * (0.45 if s > 0.45 else 0.75)
        if hh > 0.9 or hh < 0.08:
            hh = 0.05 + (hh if hh < 0.08 else hh - 1.0) * 0.3
        v2 = v * 0.86
        # 결: 가로 결(나뭇결 흉내) + 잔 노이즈
        n = (grain[y][x] * 0.035) + (grain[y][(x * 7) % w] * 0.02)
        v2 = min(max(v2 * (1 + n), 0), 1)
        r2, g2, b2 = colorsys.hsv_to_rgb(hh % 1.0, s2, v2)
        po[x, y] = (int(r2 * 255), int(g2 * 255), int(b2 * 255), a)
out.save(dst)
print("wrote", dst)
