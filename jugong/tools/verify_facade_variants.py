"""Check seeded overrides, all variant layer mappings, and printable fused sweeps."""
import argparse,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'))
import jugong_10f_model as m
from facade_variants import CATALOG,resolve_state,selected_layers
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
base,households=m.build_base();flat,flat_households=m.build_unfolded_layers();reports=[]
for seed in (0,324,20260910):
 raw=m.default_configuration('324');raw['seed']=seed
 config=m.normalize_configuration(raw);assert config==m.normalize_configuration(raw)
 override=dict(config['households']['05-B']);override.update(sash='none',smallWindow='roof',acPosition='small_top',explicit=['sash','smallWindow','acPosition'])
 raw['households']['05-B']=override;raw['seed']=seed+1
 chosen=m.normalize_configuration(raw)['households']['05-B'];assert chosen['sash']=='none' and chosen['smallWindow']=='roof' and chosen['acPosition']=='small_top'
 path=a.output/f'seed-{seed}.json';path.write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n')
 folded=m.export_checked(m.union(m.configuration_parts(base,households,config)),a.output/f'seed-{seed}.stl')
 flat_report=m.export_checked(m.configuration_unfolded_material_shape(flat,flat_households,config),a.output/f'seed-{seed}-facade.stl')
 reports.append({'seed':seed,'counts':{f:{c[0]:sum(s[f]==c[0] for s in config['households'].values()) for c in choices} for f,choices in CATALOG.items()},'folded':folded,'unfolded':flat_report,'explicit_override':True})
sweep=m.default_configuration('303')
for i,(key,state) in enumerate(sweep['households'].items()):
 state.update(sash='full',ac='unit',sashVariant=CATALOG['sashVariant'][i%4][0],smallWindow=CATALOG['smallWindow'][1+i%3][0],acPosition=CATALOG['acPosition'][i%5][0],frameFinish=CATALOG['frameFinish'][i%3][0]);state['explicit']=list(CATALOG)
 for name,_mat in selected_layers(state):assert name in households[key] and name in flat_households[key]
(a.output/'variant-sweep.json').write_text(json.dumps(sweep,ensure_ascii=False,indent=2)+'\n')
reports.append({'sweep':m.export_checked(m.union(m.configuration_parts(base,households,sweep)),a.output/'variant-sweep.stl'),'flat':m.export_checked(m.configuration_unfolded_material_shape(flat,flat_households,sweep),a.output/'variant-sweep-facade.stl')})
color_base,color_households=m.build_material_base();colored=m.configuration_material_shape(color_base,color_households,sweep)
m.write_color_3mf(colored,a.output/'variant-sweep.3mf',sweep)
for seed in (-1,4294967296,True,2.5,'324'):
 raw=m.default_configuration();raw['seed']=seed
 try:m.normalize_configuration(raw)
 except ValueError:pass
 else:raise AssertionError(f'invalid seed accepted: {seed}')
legacy=m.default_configuration();legacy.pop('seed');legacy['households']={key:{'sash':'partial','ac':'bracket'} for key in m.sorted_household_ids()};normalized=m.normalize_configuration(legacy)
assert all(s['sash']=='partial' and set(s['explicit'])=={'sash','ac'} for s in normalized['households'].values())
(a.output/'validation.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2)+'\n');print('PASS: seeds, overrides, legacy configuration, every variant, folded and flat fused exports')
