"""Capture revisions in identical viewport, cameras and household configuration."""
import argparse,base64,json,os,subprocess,time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--page',required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--prefix',required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
cli=os.environ.get('ORCA_CLI_COMMAND') or ('orca-dev' if os.environ.get('ORCA_DEV_REPO_ROOT') else 'orca')
def call(*args):
 r=json.loads(subprocess.check_output([cli,*args,'--page',a.page,'--json']));assert r.get('ok',True),r;return r['result']
def js(code):
 r=call('eval','--expression',code)['result']
 try:return json.loads(r)
 except (TypeError,json.JSONDecodeError):return r
def ready():
 for _ in range(100):
  if js("!!window.modelViewer?.getState().ready&&!document.getElementById('download-3mf').disabled"):return
  time.sleep(.1)
 raise AssertionError('not ready')
ready();call('viewport','--width','1280','--height','1000','--scale','1');config=js('window.modelViewer.getConfiguration()');config['seed']=None;config['dong']='324'
for s in config['households'].values():s.update(sash='none',ac='none',smallWindow='none',explicit=[])
js('window.modelViewer.loadConfiguration('+json.dumps(config)+');true');ready()
js("window.modelViewer.setLayout('folded');document.getElementById('render-mode').value='physical';document.getElementById('render-mode').dispatchEvent(new Event('change'));true")
scenes={'right':dict(yaw=0,pitch=0,span=210),'mark':dict(yaw=0,pitch=0,span=22,center=[51.7,-41.2,127.15]),'number':dict(yaw=0,pitch=0,span=22,center=[51.7,-41.2,53.5]),'sash':dict(yaw=-1.35,pitch=.04,span=23,center=[22,-59,72]),'small':dict(yaw=-.25,pitch=.06,span=17,center=[53,-26.5,73]),'iso':dict(yaw=-.93,pitch=.34,span=225)}
for name,camera in scenes.items():
 if name=='sash':js("window.modelViewer.setVariants('05-B',{sash:'full',sashVariant:'three',frameFinish:'metal',smallWindow:'roof'});true");ready()
 js('window.modelViewer.setCamera('+json.dumps(camera)+');true')
 data=js("document.getElementById('model').toDataURL('image/png')");(a.output/f'{a.prefix}-{name}.png').write_bytes(base64.b64decode(data.split(',')[-1]))
(a.output/f'{a.prefix}-cameras.json').write_text(json.dumps(scenes,indent=2)+'\n')
