"""Render traced sign silhouettes with dimensions beside the original photo crops."""
import argparse,json,sys
from pathlib import Path
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'))
import jugong_10f_model as m
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
previous=ROOT/'scratchpad/2026-09-10/facade-mark-window-ac-variants/photo-details'
records={}
for name,source,section in [('mark','17.51.41-mark.png',m.jugong_symbol()),('324','17.51.37-number.png',m.sign_section('324')[0])]:
    picture=Image.open(previous/source).convert('RGB');picture.thumbnail((600,430))
    canvas=Image.new('RGB',(1200,510),'#eeeee8');canvas.paste(picture,((600-picture.width)//2,45+(430-picture.height)//2));draw=ImageDraw.Draw(canvas)
    x0,y0,x1,y1=section.bounds();scale=min(450/(x1-x0),310/(y1-y0));ox=900-(x1+x0)*scale/2;oy=255+(y1+y0)*scale/2
    # Even/odd fill preserves the white doorway and the 4's triangular counter.
    mask=Image.new('1',canvas.size);import PIL.ImageChops
    for poly in section.to_polygons():
        contour=Image.new('1',canvas.size);ImageDraw.Draw(contour).polygon([(ox+x*scale,oy-y*scale) for x,y in poly],fill=1);mask=PIL.ImageChops.logical_xor(mask,contour)
    canvas.paste('#4F7397' if name=='mark' else '#454C4F',(0,0),mask)
    draw.text((25,15),'Original photo (camera perspective retained)',fill='black');draw.text((660,15),'Model: orthographic filled outline',fill='black')
    draw.text((660,465),f'{name}: {x1-x0:.3f} x {y1-y0:.3f} mm; aspect {(x1-x0)/(y1-y0):.3f}',fill='black')
    canvas.save(a.output/f'photo-outline-{name}.png');records[name]={'width_mm':x1-x0,'height_mm':y1-y0,'source':source}
records['comparison']={'previous_mark_mm':[13.2,8.8],'previous_number_width_mm':13,'current_frame_outer_mm':[.26,.32],'previous_frame_outer_mm':[.55,.75],'leaf_frame_mm':.16,'glass_thickness_mm':.12,'paint_depth_mm':m.SIGN_PAINT_DEPTH}
(a.output/'measurements.json').write_text(json.dumps(records,indent=2)+'\n')
