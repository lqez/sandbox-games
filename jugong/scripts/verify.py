"""Check STL geometry and byte-for-byte agreement of embedded viewer models.

Does not test WebGL or browser interaction. See CONTINUE.md.
"""
import base64
import gzip
import hashlib
import json
import re
from pathlib import Path
import trimesh

ROOT = Path(__file__).resolve().parents[1]


def main():
    html = (ROOT / 'dist/dunchon_jugong_viewer.html').read_text(encoding='utf-8')
    match = re.search(r'<script id="mesh-data" type="application/json">(.*?)</script>', html, re.S)
    assert match, 'Viewer has no embedded mesh data'
    packed = json.loads(match.group(1))
    assert set(packed) == {'0', '1', '2', '3'}
    results = []
    for key in ('0', '1', '2', '3'):
        entry = packed[key]
        path = ROOT / 'dist' / entry['name']
        raw = path.read_bytes()
        assert gzip.decompress(base64.b64decode(entry['data'])) == raw, path.name
        mesh = trimesh.load_mesh(path, process=True)
        assert mesh.is_watertight and mesh.is_volume and mesh.is_winding_consistent, path.name
        assert len(mesh.split(only_watertight=False)) == 1, path.name
        results.append(dict(file=path.name, triangles=len(mesh.faces),
                            dimensions_mm=mesh.extents.round(3).tolist(),
                            watertight=True, connected_bodies=1,
                            embedded_bytes_match=True,
                            sha256=hashlib.sha256(raw).hexdigest()))
    for name in ('sashes', 'brackets'):
        tag = re.search(r'<input\b[^>]*id="' + name + r'"[^>]*>', html)
        assert tag and not re.search(r'\bchecked\b', tag.group()), name
    report = {'mesh_checks': results, 'options_default_hidden': True,
              'browser_execution': 'NOT VERIFIED in the originating environment'}
    (ROOT / 'validation').mkdir(exist_ok=True)
    (ROOT / 'validation/handoff_checks.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print('PASS: four connected, watertight STL solids; viewer payloads match; options off.')
    print('Browser interaction and visual accuracy still require review.')


if __name__ == '__main__':
    main()
