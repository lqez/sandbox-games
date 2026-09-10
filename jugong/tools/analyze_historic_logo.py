"""Compare the archived LH emblem raster with the code-native print outline."""
import argparse,json,sys
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'))
import facade_signs as signs
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
original=Image.open(ROOT/'references/knhc-logo/lhri-old-knhc.png').convert('RGB');pixels=np.asarray(original.convert('L'));ys,xs=np.where(pixels<90);bounds=(int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1))
size=560;canvas=Image.new('RGB',(1220,690),'#f6f6f2');d=ImageDraw.Draw(canvas);font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',22)
source=original.crop(bounds).resize((size,size),Image.Resampling.NEAREST);canvas.paste(source,(30,70));d.text((30,20),'LHRI source / PDF p47',font=font,fill='black');d.text((650,20),'Model / circle 8.6 x 8.6 mm',font=font,fill='black')
contours=signs.symbol().to_polygons()
for contour in contours:
 points=np.asarray(contour);area=np.sum(points[:,0]*np.roll(points[:,1],-1)-points[:,1]*np.roll(points[:,0],-1))/2
 screen=[(650+(x/8.6+.5)*size,70+(.5-y/8.6)*size) for x,y in points]
 d.polygon(screen,fill='#4F7397' if area>0 else '#f6f6f2')
for x in (30,650):
 d.rectangle((x,70,x+size,630),outline='#ce6c36',width=2);d.line((x+size/2,70,x+size/2,630),fill='#ce6c36',width=1)
d.text((30,650),'Raster edges have about one-pixel uncertainty; source is not a certified CI vector.',font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',18),fill='#444444')
canvas.save(a.output/'historic-logo-source-comparison.png')
(a.output/'logo-measurements.json').write_text(json.dumps({'source_bounds_px':bounds,'source_ink_width_height_px':[bounds[2]-bounds[0],bounds[3]-bounds[1]],'model_width_height_mm':[signs.MARK_WIDTH,signs.MARK_HEIGHT],'source_pixel_uncertainty':1},indent=2)+'\n')
print(a.output/'historic-logo-source-comparison.png')
