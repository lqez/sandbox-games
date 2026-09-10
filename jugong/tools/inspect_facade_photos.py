"""Archive source metadata and lossless detail crops for repeatable facade inspection."""
import argparse, hashlib, json
from pathlib import Path
from PIL import Image
p=argparse.ArgumentParser();p.add_argument('--source',type=Path,default=Path.home()/'Desktop');p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
regions={'17.51.41':{'mark':(.66,.21,.76,.32),'number':(.74,.70,.88,.87),'windows':(.15,.28,.46,.80)},'17.51.37':{'number':(.77,.18,.88,.32),'small-room':(.57,.13,.74,.45),'ac':(.27,.30,.36,.46)},'17.51.23':{'mark':(.24,.13,.35,.21),'small-ac':(.39,.28,.54,.40),'windows':(.68,.43,.87,.65)},'17.51.18':{'windows':(.28,.22,.69,.57),'small-ac':(.18,.54,.30,.74)},'17.51.01':{'mark':(.77,.10,.88,.16),'small-roofs':(.64,.29,.89,.67),'ac':(.61,.58,.72,.68)}}
metadata=[]
for stamp,crops in regions.items():
 path=a.source/f'Screenshot 2026-09-10 at {stamp}.png';im=Image.open(path);record={'file':str(path),'size':im.size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'crops':{}}
 for name,r in crops.items():
  box=tuple(round(v*im.size[i%2]) for i,v in enumerate(r));out=f'{stamp}-{name}.png';im.crop(box).resize(((box[2]-box[0])*3,(box[3]-box[1])*3)).save(a.output/out);record['crops'][name]={'box':box,'file':out,'scale':3}
 metadata.append(record)
(a.output/'sources.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n')
