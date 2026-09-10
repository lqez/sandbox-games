#!/usr/bin/env python3
"""Verify the 40-household schema, embedded layers, and representative fused outputs."""
from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
import re
import sys
import tempfile
from pathlib import Path

import trimesh

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
import jugong_10f_model as model  # noqa: E402


def mesh_facts(raw: bytes) -> dict:
    with tempfile.NamedTemporaryFile(suffix='.stl') as handle:
        handle.write(raw)
        handle.flush()
        mesh = trimesh.load_mesh(handle.name, process=True)
    components = mesh.split(only_watertight=False)
    assert mesh.is_watertight and mesh.is_winding_consistent
    assert all(part.is_volume for part in components)
    return {
        'triangles': len(mesh.faces),
        'watertight': True,
        'component_count': len(components),
        'bounds': mesh.bounds.round(3).tolist(),
    }


def stl_material_counts(raw: bytes) -> dict[str, int]:
    assert len(raw) >= 84
    triangles = int.from_bytes(raw[80:84], 'little')
    assert len(raw) == 84 + triangles * 50
    counts = {item['key']: 0 for item in model.MATERIALS}
    for index in range(triangles):
        material = int.from_bytes(raw[84 + index * 50 + 48:84 + index * 50 + 50], 'little')
        assert 0 <= material < 4
        counts[model.MATERIALS[material]['key']] += 1
    assert all(counts.values())
    return counts


def read_payload() -> dict:
    html = (ROOT / 'dist/dunchon_jugong_viewer.html').read_text(encoding='utf-8')
    match = re.search(r'<script id="mesh-data" type="application/json">(.*?)</script>', html, re.S)
    assert match, 'viewer payload missing'
    assert "sash:'none',ac:'none'" in html, 'viewer default is not all off'
    assert '302동 · 사진 확인' in html and '324동 · 사진 확인' in html and '420동 · 사진 확인' in html
    assert 'textContent=config.dong' in html, 'dong label must use textContent'
    return json.loads(match.group(1))


def validate_payload(payload: dict) -> dict:
    assert payload['schemaVersion'] == 2
    assert payload['materials'] == [dict(item) for item in model.MATERIALS]
    entries = payload['households']
    assert len(entries) == 40
    ids = [entry['id'] for entry in entries]
    assert ids == model.sorted_household_ids() and len(ids) == len(set(ids))
    expected_facades = {
        'A': ('front-left', 'front (-Y)'), 'B': ('front-right', 'front (-Y)'),
        'C': ('rear-left', 'left side (-X)'), 'D': ('rear-right', 'right side (+X)'),
    }
    layer_count = 0
    triangle_count = 0
    for entry in entries:
        floor, line = int(entry['id'][:2]), entry['line']
        assert entry['floor'] == floor and expected_facades[line] == (entry['position'], entry['facade'])
        assert entry['estimated_unit'] == str(floor * 100 + ord(line) - 64)
        assert set(entry['meshes']) == set(model.LAYER_NAMES)
        assert set(entry['unfolded_meshes']) == set(entry['meshes'])
        for name,layer in entry['meshes'].items():
            raw = gzip.decompress(base64.b64decode(layer['data']))
            assert hashlib.sha256(raw).hexdigest() == layer['sha256']
            assert len(raw) == layer['bytes'] and layer['solid_count'] > 0
            source = ROOT / 'work/configurator' / layer['name']
            if source.exists():
                assert source.read_bytes() == raw
            facts = mesh_facts(raw)
            low, high = facts['bounds']
            assert model.LEVELS[floor - 1] - 1.5 <= low[2] <= model.LEVELS[floor - 1] + 12
            assert high[2] <= (model.ROOF + .1 if floor == 10 else model.LEVELS[floor] + .1)
            if name.startswith('small__') or '__small_' in name:
                assert low[2]>=model.LEVELS[floor-1]+1
                assert (high[0]<0 if line in ('A','C') else low[0]>0)
            elif line in ('A', 'B'):
                assert high[1] < -53
            elif line == 'C':
                assert high[0] < -44
            else:
                assert low[0] > 44
            layer_count += 1
            triangle_count += facts['triangles']
        for layer in entry['unfolded_meshes'].values():
            raw = gzip.decompress(base64.b64decode(layer['data']))
            assert hashlib.sha256(raw).hexdigest() == layer['sha256']
            facts = mesh_facts(raw)
            assert facts['bounds'][0][2] >= model.PANEL_THICKNESS - .2
            assert facts['bounds'][1][2] <= model.PANEL_THICKNESS + 1.2
    base_raw = gzip.decompress(base64.b64decode(payload['base']['data']))
    assert hashlib.sha256(base_raw).hexdigest() == payload['base']['sha256']
    assert base_raw == (ROOT / 'work/configurator/base_material.stl').read_bytes()
    material_triangles = stl_material_counts(base_raw)
    base = mesh_facts(base_raw)
    assert base['component_count'] == 1
    flat_raw = gzip.decompress(base64.b64decode(payload['unfoldedBase']['data']))
    assert hashlib.sha256(flat_raw).hexdigest() == payload['unfoldedBase']['sha256']
    flat = mesh_facts(flat_raw)
    assert flat['component_count'] == 1
    assert payload['printKit']['panelOrder'] == list(model.PANEL_ORDER)
    return {'households': 40, 'addressable_layers': layer_count,
            'layer_triangles': triangle_count, 'base': base,
            'unfolded_base': flat,'unfolded_addressable_layers': layer_count,
            'default_all_off': True, 'facade_mapping_checked': True,
            'material_slots': 4, 'material_triangles': material_triangles}


def representative_fused_outputs() -> list[dict]:
    base, households = model.build_base()
    cases = []
    default = model.default_configuration()
    cases.append(('default', default, 0))
    single = model.default_configuration('302')
    single['households']['05-B'] = {'sash': 'full', 'ac': 'unit'}
    cases.append(('single_05-B', single, 4))
    cross = model.default_configuration('324')
    cross['households']['02-A'] = {'sash': 'partial', 'ac': 'bracket'}
    cross['households']['09-D'] = {'sash': 'full', 'ac': 'unit'}
    cases.append(('different_floor_line', cross, 6))
    partial = model.default_configuration('420')
    for line in model.LINE_INFO:
        partial['households'][f'07-{line}'] = {'sash': 'partial', 'ac': 'none'}
    cases.append(('floor_07_partial', partial, 4))
    results = []
    with tempfile.TemporaryDirectory() as tmp:
        for name, config, expected_layers in cases:
            actual_layers = 0
            for state in config['households'].values():
                actual_layers += {'none': 0, 'partial': 1, 'full': 2}[state['sash']]
                actual_layers += {'none': 0, 'bracket': 1, 'unit': 2}[state['ac']]
            assert actual_layers == expected_layers
            parts = model.configuration_parts(base, households, config)
            path = Path(tmp) / f'{name}.stl'
            result = model.export_checked(model.union(parts), path)
            assert result['connected_bodies'] == 1 and result['watertight']
            results.append({'case': name, 'selected_layers': expected_layers, **result})
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'validation/configurator_validation.json')
    args = parser.parse_args()
    payload = read_payload()
    report = {
        'schema_and_layers': validate_payload(payload),
        'representative_fused_outputs': representative_fused_outputs(),
        'dong_validation': {
            'accepted': [model.normalize_dong(value) for value in ('302', ' ４２０동 ', '123-1')],
            'rejected': ['../302', '<script>', '123456789', '-302', '302-'],
        },
    }
    for value in report['dong_validation']['rejected']:
        try:
            model.normalize_dong(value, allow_empty=False)
        except ValueError:
            continue
        raise AssertionError(f'unsafe dong accepted: {value}')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"PASS: 40 households, 1000 addressable layers, {len(report['representative_fused_outputs'])} fused configurations")


if __name__ == '__main__':
    main()
