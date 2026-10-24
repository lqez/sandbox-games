"""로딩 화면 레이어용 gpt-image 호출(생성·편집·투명 배경·마스크).
사용: set -a; . .env; set +a; uv run --no-project --with openai --with pillow python ploh/tools/loading/gen.py \
       <out.png> <model> <size> <prompt.txt> [--mask mask.png] [--opaque] [입력 이미지...]
기본은 background=transparent. --mask는 첫 입력 이미지에 대한 편집 마스크(투명한 곳이 바뀐다).
"""
import base64, io, json, sys, time
from pathlib import Path
from openai import OpenAI
from PIL import Image

args = sys.argv[1:]
out, model, size, pfile = args[:4]
rest = args[4:]
mask = None
opaque = False
inputs = []
i = 0
while i < len(rest):
    if rest[i] == "--mask":
        mask = rest[i + 1]; i += 2
    elif rest[i] == "--opaque":
        opaque = True; i += 1
    else:
        inputs.append(rest[i]); i += 1
prompt = Path(pfile).read_text()
cl = OpenAI()
t0 = time.time()

def fobj(p):
    b = io.BytesIO(Path(p).read_bytes()); b.name = Path(p).name
    return b

kw = dict(model=model, prompt=prompt, size=size, quality="high")
if not opaque:
    kw["background"] = "transparent"
try:
    if inputs:
        if mask:
            r = cl.images.edit(image=fobj(inputs[0]), mask=fobj(mask), **kw)
        else:
            r = cl.images.edit(image=[fobj(p) for p in inputs], **kw)
    else:
        r = cl.images.generate(**kw)
except Exception as e:
    print("FAIL", out, type(e).__name__, str(e)[:500]); sys.exit(1)
Path(out).parent.mkdir(parents=True, exist_ok=True)
Path(out).write_bytes(base64.b64decode(r.data[0].b64_json))
rec = {"out": out, "model": model, "size": size, "prompt_file": pfile, "inputs": inputs, "mask": mask, "sec": round(time.time() - t0, 1)}
with open(Path(out).parent / "log.jsonl", "a") as f:
    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
print("OK", out, rec["sec"], "s")
