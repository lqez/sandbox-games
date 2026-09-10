"""Real-browser monochrome export, volume selection and oblique unfolding QA."""
import argparse,base64,json,subprocess,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--page',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
def call(*args):
 r=json.loads(subprocess.check_output(['orca',*args,'--page',a.page,'--json']));assert r.get('ok',True),r;return r['result']
def js(code):
 r=call('eval','--expression',code).get('result')
 if isinstance(r,str):
  try:return json.loads(r)
  except json.JSONDecodeError:pass
 return r
def ready():
 for _ in range(120):
  if js("!!window.modelViewer?.getState().ready&&!document.getElementById('download-3mf').disabled"):return
  time.sleep(.2)
 raise AssertionError('timeout')
def shot(name):
 raw=js("document.getElementById('model').toDataURL('image/png')");(a.output/(name+'.png')).write_bytes(base64.b64decode(raw.split(',')[-1]))
def camera(**values):js('window.modelViewer.setCamera('+json.dumps(values)+');true')
call('goto','--url',(ROOT/'dist/dunchon_jugong_viewer.html').as_uri()+'?dong=324');call('viewport','--width','1280','--height','1000','--scale','1');ready()
js('window.modelViewer.randomize(324);true');ready();camera(yaw=-.93,pitch=.34,span=225);shot('after-folded')
camera(yaw=0,pitch=0,span=20,center=[51.7,-41.2,127.15]);shot('historic-mark-color')
camera(yaw=0,pitch=0,span=20,center=[51.7,-41.2,53.5]);shot('number-color')
refs=call('snapshot')['refs'];ref=next(k for k,v in refs.items() if v.get('name')=='인쇄 색상' and v.get('role')=='combobox');call('select','--element',ref,'--value','mono');ready();assert js('window.modelViewer.getState().materialSlots')==1
js("document.getElementById('mono-color').value='#b8b8b8';document.getElementById('mono-color').dispatchEvent(new Event('input'));true");ready()
camera(yaw=-.22,pitch=.1,span=18,center=[51.7,-41.2,53.5]);shot('number-mono-emboss')
camera(yaw=-.22,pitch=.1,span=18,center=[51.7,-41.2,127.15]);shot('mark-mono-emboss')
config=js('window.modelViewer.getConfiguration()');url=js('location.href');call('goto','--url',url);ready();assert config==js('window.modelViewer.getConfiguration()')
js("window.modelViewer.selectHousehold('05-B');true");camera(yaw=-.8,pitch=.24,span=80,center=[30,-35,71]);shot('selection-volume')
state=js('window.modelViewer.getState()');assert state['selectionKind']=='volume' and len(state['selectionVolumes'])==4
assert js("document.querySelectorAll('.unit-highlight').length")==0
for box in state['selectionVolumes']:assert all(hi>lo for lo,hi in zip(*box))
# Exports do not change when a selection is drawn.
async_export="(async()=>{const b=new Uint8Array(await window.modelViewer.%s().arrayBuffer());let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(s);})()"
for name,method in [('browser-mono-folded','make3mf'),('browser-mono-unfolded','makeFacade3mf')]:
 data=js(async_export%method);(a.output/(name+'.3mf')).write_bytes(base64.b64decode(data))
js("window.modelViewer.setLayout('unfolded');true");ready();camera(yaw=-1.1,pitch=.60,span=130,center=[-180,74,6]);shot('unfolded-mono-depth-selection')
assert config==js('window.modelViewer.getConfiguration()');assert js('window.modelViewer.getState().selectionVolumes.length')>=3
js("window.modelViewer.setPrintMode('color');true");ready();camera(yaw=-1.5707963267948966,pitch=.70,span=360);shot('unfolded-full-depth')
camera(yaw=-1.1,pitch=.60,span=105,center=[-185,74,6]);shot('unfolded-window-depth')
assert js('window.modelViewer.getState().materialSlots')==4
report={'native_mono_select':True,'mono_url_roundtrip':True,'fold_configuration_preserved':True,'selection':'3D translucent footprint cells','folded_cells':4,'rectangle_overlay_count':0,'mono_export_slots_expected':1,'color_restored_slots':4,'page_id':a.page}
(a.output/'browser-mono-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False))
