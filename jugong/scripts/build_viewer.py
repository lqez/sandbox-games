"""Embed the four current fused STLs in the self-contained HTML viewer."""
import base64
import gzip
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAMES = [
    'jugong_10f.stl',
    'jugong_10f_sashes.stl',
    'jugong_10f_ac_brackets.stl',
    'jugong_10f_sashes_ac_brackets.stl',
]


def main():
    data = {}
    for key, name in enumerate(NAMES):
        source = ROOT / 'dist' / name
        data[key] = {'name': name, 'data': base64.b64encode(
            gzip.compress(source.read_bytes(), compresslevel=9, mtime=0)
        ).decode('ascii')}
    template = (ROOT / 'viewer/viewer_template.html').read_text(encoding='utf-8')
    assert template.count('__MESH_DATA__') == 1
    output = template.replace('__MESH_DATA__', json.dumps(data, separators=(',', ':')))
    path = ROOT / 'dist/dunchon_jugong_viewer.html'
    path.write_text(output, encoding='utf-8')
    print(f'Built {path.name}: {path.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
