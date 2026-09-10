"""Arrange browser captures with filenames as labels for visual comparison."""
import argparse,math
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
p=argparse.ArgumentParser();p.add_argument('images',type=Path,nargs='+');p.add_argument('--output',type=Path,required=True);p.add_argument('--columns',type=int,default=2);a=p.parse_args()
width=680;height=410;label=32;rows=math.ceil(len(a.images)/a.columns);result=Image.new('RGB',(width*a.columns,(height+label)*rows),'#e8ebe4');draw=ImageDraw.Draw(result)
for i,path in enumerate(a.images):
 im=Image.open(path).convert('RGB');im.thumbnail((width,height));x=(i%a.columns)*width;y=(i//a.columns)*(height+label);result.paste(im,(x+(width-im.width)//2,y+label+(height-im.height)//2));draw.text((x+12,y+8),path.stem,fill='#243326')
a.output.parent.mkdir(parents=True,exist_ok=True);result.save(a.output);print(a.output)
