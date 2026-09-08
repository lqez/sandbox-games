"""Verify legacy STL compatibility plus the household configurator payload."""
import hashlib
import json
import sys
from pathlib import Path

import trimesh

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import verify_configurator  # noqa: E402

LEGACY = [
    ('jugong_10f.stl', False, False),
    ('jugong_10f_sashes.stl', True, False),
    ('jugong_10f_ac_brackets.stl', False, True),
    ('jugong_10f_sashes_ac_brackets.stl', True, True),
]


def main():
    payload = verify_configurator.read_payload()
    configurator = verify_configurator.validate_payload(payload)
    legacy = []
    for name, sash, bracket in LEGACY:
        path = ROOT / 'dist' / name
        raw = path.read_bytes()
        mesh = trimesh.load_mesh(path, process=True)
        assert mesh.is_watertight and mesh.is_volume and mesh.is_winding_consistent, name
        assert len(mesh.split(only_watertight=False)) == 1, name
        legacy.append({
            'file': name,
            'external_sashes': sash,
            'ac_brackets': bracket,
            'policy': 'all 40 households; full sash and/or empty rack',
            'triangles': len(mesh.faces),
            'dimensions_mm': mesh.extents.round(3).tolist(),
            'watertight': True,
            'connected_bodies': 1,
            'sha256': hashlib.sha256(raw).hexdigest(),
        })
    report = {
        'legacy_mesh_checks': legacy,
        'configurator': configurator,
        'browser_execution': 'See scratchpad/2026-09-08/unit-configurator/REPORT.md',
    }
    (ROOT / 'validation').mkdir(exist_ok=True)
    (ROOT / 'validation/handoff_checks.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print('PASS: four legacy solids and 40-household configurator payload verified.')


if __name__ == '__main__':
    main()
