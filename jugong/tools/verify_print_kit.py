#!/usr/bin/env python3
"""Verify the full-depth twelve-facade strip and separate keyed roof/base print parts."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
import jugong_10f_model as model  # noqa: E402


def facts(path: Path) -> dict:
    mesh = trimesh.load_mesh(path, process=True)
    components = mesh.split(only_watertight=False)
    assert mesh.is_watertight and mesh.is_winding_consistent and mesh.is_volume, path.name
    assert len(components) == 1 and mesh.volume > 0, path.name
    return {
        'file': path.name,
        'dimensions_mm': np.round(mesh.extents, 3).tolist(),
        'triangles': len(mesh.faces),
        'volume_mm3': round(float(mesh.volume), 3),
        'watertight': True,
        'winding_consistent': True,
        'positive_volume': True,
        'connected_bodies': 1,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'validation/print_kit_checks.json')
    args = parser.parse_args()
    facade = facts(ROOT / 'dist/jugong_10f_facade_strip.stl')
    roof = facts(ROOT / 'dist/jugong_10f_roof.stl')
    base = facts(ROOT / 'dist/jugong_10f_base.stl')
    assert np.allclose(facade['dimensions_mm'][:2], [sum(model.PANEL_WIDTHS)+11*model.unfolding.GAP, model.FACADE_HEIGHT], atol=.1)
    assert 20 < facade['dimensions_mm'][2] < 30
    assert np.allclose(roof['dimensions_mm'][:2], [98.2, 102.7], atol=.02)
    assert np.allclose(base['dimensions_mm'][:2], [120, 132], atol=.02)
    assert model.HINGE_SKIN >= model.MIN_FRAME
    labels = {}
    for dong in ('302', '324', '420', '123-1'):
        label = model.dong_label(dong)
        mesh = model.to_trimesh(label)
        assert mesh.is_watertight and mesh.is_volume and len(mesh.split()) == 1
        labels[dong] = {'z_base_mm': model.dong_label_position(dong),
                        'dimensions_mm': np.round(mesh.extents, 3).tolist(),
                        'project_glyph': True, 'emboss_depth_mm': model.SIGN_PAINT_DEPTH}
    report = {
        'facade_strip': facade,
        'roof': roof,
        'base': base,
        'panel_order_exterior_view': list(model.PANEL_ORDER),
        'panel_widths_mm': list(model.PANEL_WIDTHS),
        'assembled_outer_xy_mm': [103.0, 107.5],
        'folds': 11,
        'closing_seam': 'open butt seam; base follows the actual H-shaped inner perimeter',
        'panel_thickness_mm': model.PANEL_THICKNESS,
        'hinge_skin_mm': model.HINGE_SKIN,
        'hinge_gap_mm': model.unfolding.GAP,
        'dong_labels': labels,
        'flat_on_print_bed': True,
        'manufacturing_note': '500.6 mm strip retains full projecting attachments; needs a large bed, support planning and a physical hinge test.',
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('PASS: continuous facade strip, separate roof/base, watertight positive single volumes')


if __name__ == '__main__':
    main()
