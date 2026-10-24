#!/bin/zsh
# PLOH 웹 빌드: Godot로 내보낸 뒤 index.html의 GODOT_CONFIG에 mainPack을 "index.pck?v=<커밋>"으로 넣어
# 브라우저가 지난 꾸러미(같은 이름의 34MB 파일)를 캐시에서 쓰지 않게 한다. GitHub Pages는 쿼리를 무시하고 같은 파일을 준다
set -e
cd "$(dirname "$0")/../game"
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --export-release "Web" ../play/index.html >/dev/null 2>&1
V=$(git rev-parse --short HEAD)$(date +%H%M)
python3 - "$V" <<'PY'
import sys, re
v = sys.argv[1]
p = "../play/index.html"
s = open(p).read()
s = re.sub(r'"mainPack":"[^"]*",', '', s)
s = s.replace('const GODOT_CONFIG = {', 'const GODOT_CONFIG = {"mainPack":"index.pck?v=%s",' % v, 1)
open(p, "w").write(s)
print("mainPack version", v)
PY
# 로딩 화면 레이어(web/loading/*.webp)를 빌드 옆에 둔다(셸 web/shell.html이 loading/… 상대 경로로 읽는다)
mkdir -p ../play/loading
cp ../web/loading/*.webp ../play/loading/
