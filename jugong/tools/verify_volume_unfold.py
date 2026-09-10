"""Verify rigid facade transforms, historic logo proportions and mono exports."""
import argparse,json,sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT/'src'),str(ROOT/'tools')]
import jugong_10f_model as m
import facade_unfold as u
import facade_signs as signs
from verify_color_3mf import validate
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
base,flat,meta=m._unfolded_bundle(True)
source,cuts,households=m.build_layers();registry=dict(m.FACADE_SOURCES)
count=0;error=0.
for key,h in households.items():
 for name in m.LAYER_NAMES:
  assert len(h[name])==len(flat[key][name])
  for original,moved in zip(h[name],flat[key][name]):
   panel=u.panel_for(original,registry,meta['panels']);r=np.array(panel['matrix'])[:,:3]
   assert np.allclose(r@r.T,np.eye(3)) and np.isclose(np.linalg.det(r),1)
   assert np.isclose(original.volume(),moved.volume(),rtol=1e-7,atol=1e-7)
   v=np.array(moved.to_mesh().vert_properties)[:,:3];restored=u.inverse_points(v,panel)
   delta=np.max(abs(np.r_[restored.min(axis=0),restored.max(axis=0)]-original.bounding_box()))
   error=max(error,float(delta));assert delta<.0001
   count+=1
assert meta['folds']==11 and len(meta['panels'])==12 and meta['maxVolumeDelta']<1e-7
assert meta['totalWidth']==500.6
assert signs.MARK_WIDTH==signs.MARK_HEIGHT==8.6
symbol=signs.symbol();bounds=np.array(symbol.bounds());assert np.allclose(bounds[2:]-bounds[:2],[8.6,8.6])
for mono in (False,True):
 label=m.dong_label('324',monochrome=mono)
 assert np.isclose(label.bounding_box()[3],51.535+(signs.SIGN_EMBOSS_DEPTH if mono else signs.SIGN_PAINT_DEPTH))
normal,options=m.build_material_base();config=m.default_configuration('324');config['seed']=324;config['printMode']='mono';config['monoColor']='#B8B8B8';config=m.normalize_configuration(config)
(a.output/'mono-configuration.json').write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n')
exports=[]
for name,shape in [('mono-folded',m.configuration_material_shape(normal,options,config)),('mono-unfolded',m.configuration_unfolded_material_shape(base,flat,config))]:
 stl=m.export_checked(shape,a.output/(name+'.stl'));assert stl['connected_bodies']==1
 m.write_color_3mf(shape,a.output/(name+'.3mf'),config)
 package=validate(a.output/(name+'.3mf'),require_fused=True);assert package['material_slots']==1
 exports.append({'stl':stl,'3mf':package})
report=dict(rigid_option_parts=count,max_inverse_bounds_error_mm=error,source_attachment_count=meta['preservedAttachmentCount'],max_attachment_volume_error_mm3=meta['maxVolumeDelta'],panels=12,folds=11,logo_mm=[8.6,8.6],mono_emboss_mm=.65,exports=exports)
(a.output/'volume-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False))
