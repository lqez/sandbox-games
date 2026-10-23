"""GLB를 데이터가 내장된 glTF JSON으로 바꾼다(바이너리 버퍼를 base64 data URI로).

GLB를 서빙하지 못하는 곳(아티팩트 등)에서 3D 뷰어로 모델을 보여 줄 때 쓴다.
사용: python3 glb_to_json.py in.glb out.json
"""
import base64
import json
import struct
import sys

src, dst = sys.argv[1], sys.argv[2]
data = open(src, "rb").read()
magic, version, length = struct.unpack_from("<4sII", data, 0)
assert magic == b"glTF", "not a GLB"
off = 12
doc, binary = None, b""
while off < length:
    clen, ctype = struct.unpack_from("<II", data, off)
    chunk = data[off + 8: off + 8 + clen]
    if ctype == 0x4E4F534A:
        doc = json.loads(chunk.decode("utf-8"))
    elif ctype == 0x004E4942:
        binary = chunk
    off += 8 + clen
doc["buffers"][0]["uri"] = "data:application/octet-stream;base64," + base64.b64encode(binary).decode("ascii")
doc["buffers"][0]["byteLength"] = len(binary)
open(dst, "w").write(json.dumps(doc, separators=(",", ":")))
print(dst, len(open(dst).read()))
