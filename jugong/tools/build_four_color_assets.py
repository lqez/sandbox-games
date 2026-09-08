#!/usr/bin/env python3
"""Regenerate the static and representative four-material print assets."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
import jugong_10f_model as model  # noqa: E402


def main() -> None:
    base, households = model.build_material_base()
    default = model.default_configuration()
    model.write_color_3mf(base, ROOT / 'dist/jugong_10f_four_color.3mf', default)

    config = model.default_configuration('324')
    config['households']['02-A'] = {'sash': 'partial', 'ac': 'bracket'}
    config['households']['05-B'] = {'sash': 'full', 'ac': 'unit'}
    config['households']['09-D'] = {'sash': 'full', 'ac': 'unit'}
    out = ROOT / 'scratchpad/2026-09-08/four-color-print/exports'
    out.mkdir(parents=True, exist_ok=True)
    (out / 'representative-324.json').write_text(
        json.dumps(config, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    colored = model.configuration_material_shape(base, households, config)
    report = model.write_color_3mf(
        colored, out / 'representative-324-four-color.3mf', config,
        title='둔촌주공 324동 대표 4색 세대 구성')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
