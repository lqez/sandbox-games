"""Capture before/after viewers at identical seeds and orthographic cameras."""
import argparse,base64,json,subprocess,time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--page',required=True);p.add_argument('--before',type=Path,required=True);p.add_argument('--after',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
def call(*args):return json.loads(subprocess.check_output(['orca',*args,'--page',a.page,'--json']))['result']
def js(code):
 r=call('eval','--expression',code)['result']
 try:return json.loads(r)
 except (ValueError,TypeError):return r
def ready():
 for _ in range(150):
  if js("!!window.modelViewer?.getState().ready&&!document.getElementById('download-3mf').disabled"):return
  time.sleep(.2)
 raise AssertionError('timeout')
cameras={'folded':dict(yaw=-.93,pitch=.34,span=225,center=[0,-2.4,84]),'unfolded':dict(yaw=-1.5707963267948966,pitch=.70,span=360,center=[0,77,6]),'mark':dict(yaw=0,pitch=0,span=20,center=[51.7,-41.2,127.15])}
for name,path in [('before',a.before),('after',a.after)]:
 call('goto','--url',path.resolve().as_uri()+'?dong=324');call('viewport','--width','1280','--height','1000','--scale','1');ready();js('window.modelViewer.randomize(324);true');ready()
 for layout in ('folded','mark','unfolded'):
  js('window.modelViewer.setLayout('+json.dumps('folded' if layout=='mark' else layout)+');true');ready();js('window.modelViewer.setCamera('+json.dumps(cameras[layout])+');true')
  raw=js("document.getElementById('model').toDataURL('image/png')");(a.output/(name+'-'+layout+'.png')).write_bytes(base64.b64decode(raw.split(',')[-1]))
(a.output/'comparison-camera.json').write_text(json.dumps({'seed':324,'viewport':[1280,1000],'cameras':cameras},indent=2)+'\n');print('PASS: identical seed, viewport and cameras captured')
