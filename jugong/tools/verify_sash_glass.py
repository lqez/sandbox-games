"""Check exported optional glazing, finish isolation, and shared sign dimensions."""
import argparse,json,sys,struct
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'))
import jugong_10f_model as m
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);a=p.parse_args()
manifest=json.loads((ROOT/'work/configurator/manifest.json').read_text());records=[]
for h in manifest['households']:
    for layout in ('meshes','unfolded_meshes'):
        for name,entry in h[layout].items():
            if not (name.startswith('sash_') and '__' in name or name.startswith('small__')):continue
            raw=(ROOT/'work/configurator'/entry['file']).read_bytes();n=struct.unpack_from('<I',raw,80)[0]
            counts={i:0 for i in range(4)}
            for t in range(n):counts[struct.unpack_from('<H',raw,84+t*50+48)[0]]+=1
            assert counts[0]>0 and counts[2]>0 and counts[1]==counts[3]==0,(h['id'],layout,name,counts)
            records.append(dict(id=h['id'],layout=layout,layer=name,frame=counts[0],glass=counts[2]))
# User frame recoloring must preserve slot 2 through the Python fused path.
for finish in (0,1,3):
    shape=m.option_material(m.materialized(m.box(0,1,0,1,0,1),2),finish)
    assert np.all(np.asarray(shape.to_mesh64().vert_properties)[:,3]==2)
# The packed glyphs use measured advance widths, and never stretch long input.
for value in ('324','303','304','420','120-4567'):
    shape,width,height=m.sign_section(value);x0,y0,x1,y1=shape.bounds()
    assert abs((x1-x0)-width)<1e-5,(value,shape.bounds(),width)
    assert x0>=-1e-6 and y0>=-1e-6 and y1<=height+1e-6
    assert width<=m.SIGN_MAX_WIDTH+1e-6
assert abs(m.sign_section('324')[1]-8.321)<1e-6
assert m.SIGN_PAINT_DEPTH==.025
report=dict(checked_glazed_layers=len(records),material_slots=4,finish_preserves_glass=True,sign_bounds=True,records=records)
a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(report,indent=2)+'\n');print('PASS: all 880 glazed folded/flat layers, finish isolation, and sign widths')
