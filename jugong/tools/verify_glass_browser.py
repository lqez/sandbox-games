"""Capture same-camera glass on/off and verify optional-only transparency in Orca."""
import argparse,base64,json,os,subprocess,time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--page',required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--url');a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
cli=os.environ.get('ORCA_CLI_COMMAND') or ('orca-dev' if os.environ.get('ORCA_DEV_REPO_ROOT') else 'orca')
def call(*args):
    r=json.loads(subprocess.check_output([cli,*args,'--page',a.page,'--json']));assert r.get('ok',True),r;return r['result']
def js(code):
    r=call('eval','--expression',code)['result']
    try:return json.loads(r)
    except (TypeError,json.JSONDecodeError):return r
if a.url:call('goto','--url',a.url)
def ready():
    for _ in range(100):
        if js("!!window.modelViewer?.getState().ready&&!document.getElementById('download-3mf').disabled"):return
        time.sleep(.15)
    raise AssertionError('viewer timeout')
def capture(name):
    data=js("document.getElementById('model').toDataURL('image/png')")
    (a.output/(name+'.png')).write_bytes(base64.b64decode(data.split(',')[-1]))
ready();call('viewport','--width','1280','--height','1000','--scale','1')
js("window.modelViewer.setLayout('folded');document.getElementById('render-mode').value='physical';document.getElementById('render-mode').dispatchEvent(new Event('change'));true")
config=js('window.modelViewer.getConfiguration()');config['seed']=None
for s in config['households'].values():s.update(sash='none',ac='none',smallWindow='none',explicit=[])
js('window.modelViewer.loadConfiguration('+json.dumps(config)+');true');ready();assert js('window.modelViewer.getState().glassTriangles')==0
js("window.modelViewer.setCamera({yaw:-1.35,pitch:.04,span:23,center:[22,-59,72]});true");capture('glass-off')
records=[]
for finish in ('metal','light','dark'):
    js('window.modelViewer.setVariants("05-B",'+json.dumps(dict(sash='full',sashVariant='three',frameFinish=finish))+');true');ready()
    count=js('window.modelViewer.getState().glassTriangles');assert count>0
    records.append(dict(finish=finish,glass_triangles=count));capture('glass-'+finish)
assert len({r['glass_triangles'] for r in records})==1
for yaw in (-1.57,-.9,-.2,1.2):
    js('window.modelViewer.setCamera('+json.dumps(dict(yaw=yaw,pitch=.04,span=23,center=[22,-59,72]))+');true')
    assert js("document.getElementById('model').getContext('webgl2').getError()") == 0
js("window.modelViewer.setVariants('05-B',{sash:'none',smallWindow:'roof'});true");ready();assert js('window.modelViewer.getState().glassTriangles')>0
js("window.modelViewer.setCamera({yaw:-.25,pitch:.06,span:17,center:[53,-26.5,73]});true");capture('small-glass')
js("window.modelViewer.setVariants('05-B',{smallWindow:'none'});true");ready();assert js('window.modelViewer.getState().glassTriangles')==0
assert js('window.modelViewer.getState().materialSlots')==4
report=dict(only_optional_sash_transparent=True,mark_remains_opaque=True,frame_finishes=records,small_room_glass=True,orbit_gl_errors=0,material_slots=4)
(a.output/'glass-browser-validation.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
