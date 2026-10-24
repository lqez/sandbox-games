"""gpt-image 생성·편집 도우미(research/look 그림을 만든 스크립트).
사용: set -a; . <.env 경로>; set +a   # OPENAI_API_KEY를 환경에 올린다(키를 출력하지 않는다)
      uv run --no-project --with openai --with pillow python ploh/tools/look/gen_image.py \
          <out.png> <model> <size> <quality> <prompt.txt> [입력 이미지...]
입력 이미지가 있으면 images.edit(이미지→이미지), 없으면 images.generate. 투명 PNG 입력은 회색(200) 바탕에 얹어 보낸다.
기록은 출력 폴더의 log.jsonl(모델, 크기, 품질, 프롬프트 파일, 입력, 걸린 시간)에 한 줄씩 남는다.
크기는 1024x1792(9:16, 게임 화면 720x1280과 같은 비율)도 받는다(gpt-image-2.5-*, 2026-10 확인).
"""
import base64, json, sys, time, io
from pathlib import Path
from openai import OpenAI
from PIL import Image

out, model, size, quality, pfile = sys.argv[1:6]
inputs = sys.argv[6:]
prompt = Path(pfile).read_text()
cl = OpenAI()
t0 = time.time()

def prep(p):
    im = Image.open(p)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (200, 200, 200, 255)); bg.alpha_composite(im); im = bg
    im = im.convert("RGB")
    b = io.BytesIO(); im.save(b, "PNG"); b.seek(0); b.name = Path(p).name
    return b

kw = dict(model=model, prompt=prompt, size=size, quality=quality)
try:
    if inputs:
        r = cl.images.edit(image=[prep(p) for p in inputs], **kw)
    else:
        r = cl.images.generate(**kw)
except Exception as e:
    print("FAIL", out, type(e).__name__, str(e)[:400]); sys.exit(1)
Path(out).parent.mkdir(parents=True, exist_ok=True)
Path(out).write_bytes(base64.b64decode(r.data[0].b64_json))
rec = {"out": out, "model": model, "size": size, "quality": quality, "prompt_file": pfile, "inputs": inputs, "sec": round(time.time() - t0, 1)}
with open(Path(out).parent / "log.jsonl", "a") as f:
    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
print("OK", out, rec["sec"], "s")
