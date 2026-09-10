"""Capture an existing Orca page without printing its image payload."""
import argparse,base64,json,os,subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--canvas',action='store_true');p.add_argument('--page',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
cli=os.environ.get('ORCA_CLI_COMMAND') or ('orca-dev' if os.environ.get('ORCA_DEV_REPO_ROOT') else 'orca')
command=([cli,'eval','--page',a.page,'--expression',"document.getElementById('model').toDataURL('image/png')",'--json'] if a.canvas else [cli,'screenshot','--page',a.page,'--json'])
r=json.loads(subprocess.check_output(command))
result=r['result'];data=next(v for k,v in result.items() if isinstance(v,str) and len(v)>1000)
a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_bytes(base64.b64decode(data.split(',')[-1]));print(a.output)
