"""Embed the base and addressable household meshes in the self-contained viewer."""
import base64
import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAYER_ROOT = ROOT / 'work/configurator'


def pack(path):
    raw=path.read_bytes()
    return {'name':path.name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),
            'data':base64.b64encode(gzip.compress(raw,compresslevel=9,mtime=0)).decode('ascii')}


def main():
    manifest=json.loads((LAYER_ROOT/'manifest.json').read_text(encoding='utf-8'))
    data={'schemaVersion':1,'materials':manifest['materials'],
          'base':pack(LAYER_ROOT/'base_material.stl'),'households':[]}
    for household in manifest['households']:
        item={key:household[key] for key in
              ('id','floor','line','estimated_unit','position','facade','unit_type')}
        item['meshes']={}
        for key,info in household['meshes'].items():
            packed=pack(LAYER_ROOT/info['file'])
            packed['solid_count']=info['solid_count']
            item['meshes'][key]=packed
        data['households'].append(item)
    assert len(data['households'])==40
    template = (ROOT / 'viewer/viewer_template.html').read_text(encoding='utf-8')
    assert template.count('__MESH_DATA__') == 1
    output = template.replace('__MESH_DATA__', json.dumps(data, separators=(',', ':')))
    path = ROOT / 'dist/dunchon_jugong_viewer.html'
    path.write_text(output, encoding='utf-8')
    print(f'Built {path.name}: {path.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
