"""Exercise the real Orca browser, capture variants, and export current 3MFs."""
import argparse,base64,json,os,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'))
import jugong_10f_model as model
p=argparse.ArgumentParser();p.add_argument('--page',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
cli=os.environ.get('ORCA_CLI_COMMAND') or ('orca-dev' if os.environ.get('ORCA_DEV_REPO_ROOT') else 'orca')
def call(*args):
 r=json.loads(subprocess.check_output([cli,*args,'--page',a.page,'--json']))
 assert r.get('ok',True),r
 return r['result']
def js(code):
 result=call('eval','--expression',code).get('result')
 if isinstance(result,str) and (result.startswith(('{','[')) or result in ('true','false','null')):
  try:return json.loads(result)
  except json.JSONDecodeError:pass
 return result
def ready():
 for _ in range(100):
  state=js("({ready:!!window.modelViewer?.getState().ready,busy:document.getElementById('download-3mf').disabled,error:document.getElementById('model-state').textContent})")
  if state['ready'] and not state['busy']:return
  assert '오류' not in state['error'],state
  time.sleep(.2)
 raise AssertionError('viewer load timeout')
def ref(name=None,role=None):
 refs=call('snapshot')['refs'];return next(k for k,v in refs.items() if (name is None or v.get('name')==name) and (role is None or v.get('role')==role))
def click(name):
 js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==='+json.dumps(name)+').scrollIntoView({block:"center"});true')
 call('click','--element',ref(name,'button'))
def capture(name,canvas=True):
 if canvas:data=js("document.getElementById('model').toDataURL('image/png')").split(',')[-1]
 else:data=next(v for v in call('screenshot').values() if isinstance(v,str) and len(v)>1000).split(',')[-1]
 (a.output/(name+'.png')).write_bytes(base64.b64decode(data))
def camera(**kwargs):js('window.modelViewer.setCamera('+json.dumps(kwargs)+');true')
call('goto','--url',(ROOT/'dist/dunchon_jugong_viewer.html').as_uri()+'?dong=324');call('viewport','--width','1280','--height','1000','--scale','1');ready()
initial=js('window.modelViewer.getState()');assert not initial['activeHouseholds'] and initial['visibleLayers']==0 and initial['materialSlots']==4
capture('after-iso');camera(yaw=0,pitch=0,span=210);capture('after-right')
camera(yaw=0,pitch=0,span=22,center=[51.7,-41.2,127.15]);capture('mark-close')
camera(yaw=0,pitch=0,span=22,center=[51.7,-41.2,53.5]);capture('number-close')
records=[]
for seed in (0,324,20260910):
 call('fill','--element',ref('배치 seed (0–4294967295)','spinbutton'),'--value',str(seed));click('사진 빈도로 랜덤 적용');ready()
 first=js('window.modelViewer.getConfiguration()');click('사진 빈도로 랜덤 적용');ready();assert first==js('window.modelViewer.getConfiguration()')
 raw=model.default_configuration('324');raw['seed']=seed;assert first==model.normalize_configuration(raw),'Python/browser seed drift'
 counts={f:len({s[f] for s in first['households'].values()}) for f in model.CATALOG};assert all(n>=2 for n in counts.values()),counts
 records.append({'seed':seed,'identical_replay':True,'python_parity':True,'distinct_values':counts})
 camera(yaw=-.93,pitch=.15,span=205);capture('seed-'+str(seed))
# A real pointer hover and click at the centre of a known facade proxy.
camera(yaw=-1.5707963267948966,pitch=0,span=65,center=[24,-58,72.5]);js("document.getElementById('model').scrollIntoView({block:'center'});true");call('hover','--element',ref(role='Canvas'));hover=js('window.modelViewer.getState().hoverId');assert hover=='05-B',hover
call('click','--element',ref(role='Canvas'));selected=js('window.modelViewer.getState().selectedId');assert selected=='05-B',selected
camera(yaw=0,pitch=0,span=50,center=[54,-26.5,72.5]);small_pick=js("(()=>{const r=document.getElementById('model').getBoundingClientRect();return window.modelViewer.pickAt(r.x+r.width/2,r.y+r.height/2);})()");assert small_pick=='05-B',small_pick
call('select','--element',ref('작은방 섀시·차양','combobox'),'--value','roof');call('select','--element',ref('실외기 위치','combobox'),'--value','small_top');ready()
js("window.modelViewer.setHousehold('05-B','none','unit');true");ready();before=js("window.modelViewer.getConfiguration().households['05-B']")
call('fill','--element',ref('배치 seed (0–4294967295)','spinbutton'),'--value','77');click('사진 빈도로 랜덤 적용');ready();after=js("window.modelViewer.getConfiguration().households['05-B']")
for f in before['explicit']:assert before[f]==after[f]
config=js('window.modelViewer.getConfiguration()');url=js('location.href');call('goto','--url',url);ready();assert config==js('window.modelViewer.getConfiguration()')
assert config==model.normalize_configuration(config)
# Native all-off keeps the original windows and removes small-room additions.
click('전체 끄기');ready();off=js('window.modelViewer.getState()');assert off['visibleLayers']==0 and not off['activeHouseholds']
js('window.modelViewer.loadConfiguration('+json.dumps(config)+');true');ready();assert config==js('window.modelViewer.getConfiguration()')
js("document.getElementById('dong-preset').value='custom';document.getElementById('dong-preset').dispatchEvent(new Event('change'));true")
call('fill','--element',ref('직접 입력 (숫자, 내부 하이픈만)','textbox'),'--value','../324');call('keypress','--key','Enter');assert js('window.modelViewer.getState().dong')=='324'
call('fill','--element',ref('직접 입력 (숫자, 내부 하이픈만)','textbox'),'--value','303');call('keypress','--key','Enter');ready();assert js('window.modelViewer.getState().dong')=='303'
# Deliberately show each design with one household kept fixed in the camera.
js("window.modelViewer.setHousehold('05-B','full','unit');true");ready()
for variant,_,_ in model.CATALOG['sashVariant']:
 js('window.modelViewer.setVariants("05-B",'+json.dumps({'sashVariant':variant,'smallWindow':'roof','acPosition':'bedroom'})+');true');ready();camera(yaw=-1.35,pitch=.04,span=23,center=[22,-59,72]);capture('sash-'+variant)
for variant,_,_ in model.CATALOG['smallWindow']:
 js('window.modelViewer.setVariants("05-B",'+json.dumps({'smallWindow':variant,'ac':'none'})+');true');ready();camera(yaw=-.25,pitch=.06,span=17,center=[53,-26.5,73]);capture('small-'+variant)
for position,_,_ in model.CATALOG['acPosition']:
 js('window.modelViewer.setVariants("05-B",'+json.dumps({'ac':'unit','acPosition':position,'smallWindow':'roof'})+');true');ready()
 if position in ('bedroom','corner'):camera(yaw=-1.25,pitch=.1,span=24,center=[16,-59,70])
 else:camera(yaw=-.12,pitch=.06,span=24,center=[53,-23,73])
 capture('ac-'+position)
js('window.modelViewer.loadConfiguration('+json.dumps(config)+');true');ready();camera(yaw=-.93,pitch=.34,span=225);capture('configured-iso')
js("document.getElementById('render-mode').value='print';document.getElementById('render-mode').dispatchEvent(new Event('change'));true");capture('four-color')
click('4면 전개 보기');ready();camera(yaw=-1.5707963267948966,pitch=1.5607963267948965,span=410);capture('unfolded')
assert config==js('window.modelViewer.getConfiguration()')
for name,method in [('browser-folded','make3mf'),('browser-unfolded','makeFacade3mf')]:
 data=js("(async()=>{const b=new Uint8Array(await window.modelViewer."+method+"().arrayBuffer());let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(s);})()")
 (a.output/(name+'.3mf')).write_bytes(base64.b64decode(data))
(a.output/'browser-configuration.json').write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n')
call('viewport','--width','390','--height','844','--scale','1','--mobile');ready();js("document.getElementById('model').scrollIntoView({block:'center'});true");capture('mobile',False)
call('click','--element',ref('세대 편집기 닫기','button'));assert js("document.getElementById('unit-editor').hidden") is True;capture('mobile-model',False)
js("document.querySelector('tbody tr').scrollIntoView({block:'start'});true");capture('mobile-cards',False)
mobile=js("({width:innerWidth,scroll:document.documentElement.scrollWidth,cards:getComputedStyle(document.querySelector('tbody tr')).display})");assert mobile['scroll']<=mobile['width'],mobile
call('viewport','--width','1280','--height','1000','--scale','1');click('완성 건물 보기');ready()
report={'seeds':records,'real_pointer_hover':hover,'real_pointer_click':selected,'small_window_hit':small_pick,'explicit_preserved':True,'url_roundtrip':True,'json_roundtrip':True,'all_off':True,'dong_validation':True,'fold_unfold_config_preserved':True,'material_slots':4,'mobile':mobile,'page_id':a.page}
(a.output/'browser-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False))
