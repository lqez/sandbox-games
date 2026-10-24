"""생성한 그림(src/)을 Live2D식 레이어로 자른다 → ploh/web/loading/*.webp
  body       머리카락을 벗긴 몸(눈은 원본 눈을 다시 붙임)
  hair_front 앞머리·옆머리(눈 타원은 뺀다: 눈이 머리와 함께 흔들리면 안 된다)
  hair_tail  포니테일(따로 더 크게 흔든다)
  eyes_open / eyes_closed  눈 부분 크롭(깜빡임 교차 페이드)
  blade, bg
"""
import sys
from collections import deque
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

root = Path(__file__).resolve().parents[2] / "web" / "loading"
src = root / "src"
base = Image.open(src / "base.png").convert("RGBA")
nohair = Image.open(src / "nohair.png").convert("RGBA")
closed = Image.open(src / "eyes_closed.png").convert("RGBA")
hair_raw = Image.open(src / "mask_hair_raw.png").convert("L")
W, H = base.size
EYES = [(345, 520, 500, 640), (505, 470, 650, 580)]
EYE_BOX = (330, 450, 670, 660)
TAIL_X = 760

# 큰 덩어리만 남긴다(재킷의 보랏빛 점들은 머리카락이 아니다)
px = hair_raw.load()
seen = bytearray(W * H)
keep = Image.new("L", (W, H), 0)
kp = keep.load()
for y0 in range(H):
    for x0 in range(W):
        if px[x0, y0] < 128 or seen[y0 * W + x0]:
            continue
        comp = []
        dq = deque([(x0, y0)])
        seen[y0 * W + x0] = 1
        while dq:
            x, y = dq.popleft()
            comp.append((x, y))
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < W and 0 <= ny < H and not seen[ny * W + nx] and px[nx, ny] >= 128:
                    seen[ny * W + nx] = 1
                    dq.append((nx, ny))
        if len(comp) >= 2500:
            for x, y in comp:
                kp[x, y] = 255
hair = keep.filter(ImageFilter.GaussianBlur(1.2))

# 눈 타원(부드러운 가장자리)
eye_m = Image.new("L", (W, H), 0)
d = ImageDraw.Draw(eye_m)
for e in EYES:
    d.ellipse(e, fill=255)
eye_m = eye_m.filter(ImageFilter.GaussianBlur(4))

# 몸: 머리 벗긴 그림에 원본 눈을 되붙인다(편집이 눈 색을 바꿨다)
body = nohair.copy()
body.paste(base, (0, 0), eye_m)

def masked(img, m):
    out = img.copy()
    a = out.getchannel("A")
    a = Image.eval(Image.merge("L", [a]), lambda v: v)  # copy
    a = Image.composite(a, Image.new("L", (W, H), 0), m)
    out.putalpha(a)
    return out

# 앞머리: 머리카락 − 눈 타원, x ≤ TAIL_X
tail_m = Image.new("L", (W, H), 0)
ImageDraw.Draw(tail_m).rectangle((TAIL_X, 0, W, H), fill=255)
tail_m = tail_m.filter(ImageFilter.GaussianBlur(6))
inv_eye = Image.eval(eye_m, lambda v: 255 - v)
front_m = Image.composite(hair, Image.new("L", (W, H), 0), inv_eye)
front_m = Image.composite(Image.new("L", (W, H), 0), front_m, tail_m)
tail_hair = Image.composite(hair, Image.new("L", (W, H), 0), tail_m)
hair_front = masked(base, front_m)
hair_tail = masked(base, tail_hair)

def bbox_crop(img, m, pad=4):
    bb = m.getbbox()
    if bb is None:
        return img, (0, 0)
    bb = (max(bb[0] - pad, 0), max(bb[1] - pad, 0), min(bb[2] + pad, W), min(bb[3] + pad, H))
    return img.crop(bb), (bb[0], bb[1])

# 눈 크롭(열림/감김), 같은 상자
eyes_open = base.crop(EYE_BOX)
eyes_closed = closed.crop(EYE_BOX)
# 타원 밖은 투명하게(머리카락 레이어와 겹치지 않게)
em = eye_m.crop(EYE_BOX)
for im in (eyes_open, eyes_closed):
    a = im.getchannel("A")
    im.putalpha(Image.composite(a, Image.new("L", im.size, 0), em))

front_c, front_o = bbox_crop(hair_front, front_m)
tail_c, tail_o = bbox_crop(hair_tail, tail_hair)
body_c, body_o = bbox_crop(body, body.getchannel("A"))

def save(im, name, q=88):
    im.save(root / f"{name}.webp", "WEBP", quality=q, method=6)

save(body_c, "body"); save(front_c, "hair_front"); save(tail_c, "hair_tail")
save(eyes_open, "eyes_open", 92); save(eyes_closed, "eyes_closed", 92)
blade = Image.open(src / "blade.png").convert("RGBA")
bb = blade.getchannel("A").getbbox(); blade = blade.crop(bb); blade.thumbnail((700, 700)); save(blade, "blade", 90)
bg = Image.open(src / "bg.png").convert("RGB"); save(bg, "bg", 80)
meta = {"canvas": [W, H], "body": body_o, "hair_front": front_o, "hair_tail": tail_o, "eyes": (EYE_BOX[0], EYE_BOX[1]),
        "eye_box": EYE_BOX, "sizes": {"body": body_c.size, "hair_front": front_c.size, "hair_tail": tail_c.size, "eyes": eyes_open.size, "blade": blade.size}}
import json; (root / "layers.json").write_text(json.dumps(meta))
print(json.dumps(meta))
# 확인용 합성
comp = Image.new("RGBA", (W, H), (70, 70, 70, 255))
comp.alpha_composite(body); comp.alpha_composite(hair_tail); comp.alpha_composite(hair_front)
comp.save("/private/tmp/claude-501/-Users-lqez-dev-sandbox-games/3d0f4ba1-cf9a-489c-bbfa-a734e2d3f64c/scratchpad/comp.png")
