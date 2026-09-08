#!/usr/bin/env python3
"""Validate Dunchon Jugong four-material 3MF packages and print-scale policy."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import zipfile
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET

import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
import jugong_10f_model as model  # noqa: E402

CORE = '{http://schemas.microsoft.com/3dmanufacturing/core/2015/02}'


def parse_mesh(node: ET.Element) -> tuple[np.ndarray, np.ndarray, list[int]]:
    vertices = np.asarray([
        [float(v.attrib['x']), float(v.attrib['y']), float(v.attrib['z'])]
        for v in node.find(f'{CORE}vertices')
    ], dtype=np.float64)
    faces = []
    materials = []
    for triangle in node.find(f'{CORE}triangles'):
        faces.append([int(triangle.attrib[key]) for key in ('v1', 'v2', 'v3')])
        assert triangle.attrib.get('pid') == '1', 'every triangle must reference basematerials id 1'
        corners = [int(triangle.attrib[key]) for key in ('p1', 'p2', 'p3')]
        assert len(set(corners)) == 1 and 0 <= corners[0] < 4
        materials.append(corners[0])
    assert len(vertices) and len(faces)
    return vertices, np.asarray(faces, dtype=np.int64), materials


def shell_key(shell: trimesh.Trimesh) -> tuple:
    return (*np.round(shell.bounds.reshape(-1), 4), round(abs(shell.volume), 4), len(shell.faces))


def validate(path: Path, *, require_fused: bool = False) -> dict:
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None
        assert {'[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model'} <= set(archive.namelist())
        xml = archive.read('3D/3dmodel.model')
    root = ET.fromstring(xml)
    assert root.attrib.get('unit') == 'millimeter'
    bases = root.find(f'{CORE}resources/{CORE}basematerials')
    assert bases is not None and bases.attrib.get('id') == '1' and len(bases) == 4
    palette = []
    for entry in bases:
        color = entry.attrib['displaycolor']
        assert len(color) == 9 and color.startswith('#') and color.endswith('FF')
        palette.append({'name': entry.attrib['name'], 'color': color[:7]})

    objects = root.findall(f'{CORE}resources/{CORE}object')
    meshes = []
    counter = Counter()
    material_area = Counter()
    keys = []
    for obj in objects:
        mesh_node = obj.find(f'{CORE}mesh')
        if mesh_node is None:
            continue
        vertices, faces, materials = parse_mesh(mesh_node)
        mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=True)
        shells = mesh.split(only_watertight=False)
        assert mesh.is_watertight and mesh.is_winding_consistent
        assert all(shell.is_volume and shell.volume > 0 for shell in shells)
        local_keys = [shell_key(shell) for shell in shells]
        assert len(local_keys) == len(set(local_keys)), f'duplicate shell inside object {obj.attrib.get("id")}'
        keys.extend(local_keys)
        counter.update(materials)
        areas = trimesh.triangles.area(vertices[faces])
        for material, area in zip(materials, areas):
            material_area[material] += float(area)
        meshes.append({
            'id': int(obj.attrib['id']),
            'name': obj.attrib.get('name', ''),
            'triangles': len(faces),
            'shells': len(shells),
            'watertight': True,
            'positive_volume': True,
            'dimensions_mm': np.round(mesh.extents, 3).tolist(),
        })
    assert meshes and set(counter) <= set(range(4)) and all(counter[index] for index in range(4))
    assert all(material_area[index] >= 100 for index in range(4)), 'material color region is too small'
    assert len(keys) == len(set(keys)), 'duplicate shell across mesh objects'
    if require_fused:
        assert len(meshes) == 1 and meshes[0]['shells'] == 1

    # Print-policy limits at the default 1:200 scale.  The smallest intentionally
    # colored frame is 0.45 mm; broad repair relief is >=3.8 mm wide and 0.40 mm
    # deep.  This is a design-bound check, not a substitute for a test print.
    assert model.MIN_FRAME >= .45
    print_limits = {
        'default_scale': '1:200',
        'minimum_colored_frame_mm': model.MIN_FRAME,
        'minimum_relief_width_mm': 3.8,
        'minimum_relief_depth_mm': .4,
        'recommended_fdm_nozzle_mm': '.25-.4',
        'recommended_layer_height_mm': '<=.2',
    }
    return {
        'file': path.name,
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'zip_crc': 'pass',
        'unit': 'millimeter',
        'material_slots': len(palette),
        'palette': palette,
        'material_triangles': {str(index): counter[index] for index in range(4)},
        'material_surface_area_mm2': {str(index): round(material_area[index], 2) for index in range(4)},
        'mesh_objects': meshes,
        'all_triangles_have_valid_material': True,
        'empty_shells': 0,
        'duplicate_shells': 0,
        'assembly_policy': ('single fused watertight volume' if require_fused else
                            'watertight material objects assembled at intentional fastening overlaps'),
        'print_limits': print_limits,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('files', nargs='*', type=Path,
                        default=[ROOT / 'dist/jugong_10f_four_color.3mf'])
    parser.add_argument('--fused', action='store_true', help='require one object and one connected shell')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    report = [validate(path, require_fused=args.fused) for path in args.files]
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'PASS: {len(report)} 3MF package(s), four valid material slots, all triangle references valid')


if __name__ == '__main__':
    main()
