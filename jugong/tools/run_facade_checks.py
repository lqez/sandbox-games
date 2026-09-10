"""Run the project checks and facade sweeps, retaining bounded review logs."""
import argparse,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output=a.output.resolve();a.output.mkdir(parents=True,exist_ok=True)
checks=[['scripts/verify.py'],['tools/verify_configurator.py'],['tools/verify_color_3mf.py','--fused','dist/jugong_10f_four_color.3mf'],['tools/verify_print_kit.py'],['tools/verify_facade_variants.py','--output',str(a.output/'exports')],['tools/verify_color_3mf.py','--fused',str(a.output/'exports/variant-sweep.3mf')],['scripts/render_preview.py']]
results=[]
for i,args in enumerate(checks):
 r=subprocess.run([sys.executable,*args],cwd=ROOT,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 (a.output/f'check-{i+1}.log').write_text(r.stdout);results.append({'command':'python '+' '.join(args),'exit_code':r.returncode});print(args[0],r.returncode,flush=True)
 if r.returncode:print(r.stdout);break
(a.output/'checks.json').write_text(json.dumps(results,indent=2)+'\n')
if any(r['exit_code'] for r in results):sys.exit(1)
