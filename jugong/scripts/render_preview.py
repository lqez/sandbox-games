"""Render the actual STL using a small orthographic software rasterizer."""
from pathlib import Path
import numpy as np
import trimesh
from numba import njit
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
(ROOT/'work').mkdir(parents=True,exist_ok=True)
mesh=trimesh.load_mesh(ROOT/'dist/jugong_10f.stl')
verts=np.asarray(mesh.vertices,dtype=np.float64)
faces=np.asarray(mesh.faces,dtype=np.int64)
normals=np.asarray(mesh.face_normals,dtype=np.float64)

def basis(direction):
    d=np.asarray(direction,dtype=float)
    d/=np.linalg.norm(d)
    right=np.cross((0,0,1),d)
    right/=np.linalg.norm(right)
    up=np.cross(d,right)
    return np.stack((right,up,d),axis=1)

@njit(cache=True)
def raster(p,faces,normals,w,h):
    zbuffer=np.full((h,w),-1e20,np.float64)
    nbuffer=np.zeros((h,w,3),np.float32)
    for i in range(len(faces)):
        a,b,c=p[faces[i,0]],p[faces[i,1]],p[faces[i,2]]
        xmin=max(0,int(np.floor(min(a[0],b[0],c[0]))))
        xmax=min(w-1,int(np.ceil(max(a[0],b[0],c[0]))))
        ymin=max(0,int(np.floor(min(a[1],b[1],c[1]))))
        ymax=min(h-1,int(np.ceil(max(a[1],b[1],c[1]))))
        det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(det)<1e-10: continue
        for y in range(ymin,ymax+1):
            for x in range(xmin,xmax+1):
                s=((b[1]-c[1])*(x+.5-c[0])+(c[0]-b[0])*(y+.5-c[1]))/det
                t=((c[1]-a[1])*(x+.5-c[0])+(a[0]-c[0])*(y+.5-c[1]))/det
                u=1-s-t
                if s>=-1e-7 and t>=-1e-7 and u>=-1e-7:
                    z=s*a[2]+t*b[2]+u*c[2]
                    if z>zbuffer[y,x]:
                        zbuffer[y,x]=z
                        nbuffer[y,x]=normals[i]
    return zbuffer,nbuffer

def project(v,mat,w,h,pad=20,scale=None):
    vv=v@mat
    mid=(vv.min(0)+vv.max(0))/2
    span=np.ptp(vv,axis=0)
    if scale is None: scale=min((w-2*pad)/span[0],(h-2*pad)/span[1])
    pp=vv.copy()
    pp[:,0]=(vv[:,0]-mid[0])*scale+w/2
    pp[:,1]=-(vv[:,1]-mid[1])*scale+h/2
    return pp,mid,scale

# Directional shadows sampled from multiple sky positions.
lights=[]
for direction,weight in [((-.8,-1.5,2.4),.48),((.7,-.6,2.8),.18),
                          ((-1.4,.9,1.8),.12),((1.6,.8,2.0),.12),((0,-2,.7),.10)]:
    bm=basis(direction)
    pp,mid,sc=project(verts,bm,1800,1800,pad=15)
    zb,_=raster(pp,faces,normals,1800,1800)
    lights.append((bm,mid,sc,zb,weight))

def render(direction,w,h,scale=None):
    bm=basis(direction)
    pp,mid,sc=project(verts,bm,w,h,pad=25,scale=scale)
    zb,nb=raster(pp,faces,normals,w,h)
    mask=zb>-1e10
    yy,xx=np.nonzero(mask)
    coords=np.stack(((xx+.5-w/2)/sc+mid[0],-(yy+.5-h/2)/sc+mid[1],zb[yy,xx]),axis=1)@bm.T
    ns=nb[yy,xx]
    illumination=np.full(len(xx),.23,dtype=float)
    for lm,lmid,lscale,lzb,weight in lights:
        lp=coords@lm
        lx=(lp[:,0]-lmid[0])*lscale+lzb.shape[1]/2
        ly=-(lp[:,1]-lmid[1])*lscale+lzb.shape[0]/2
        visible=np.zeros(len(xx))
        for dx,dy in ((0,0),(-1,0),(1,0),(0,-1),(0,1)):
            xi=np.clip(np.floor(lx+dx).astype(int),0,lzb.shape[1]-1)
            yi=np.clip(np.floor(ly+dy).astype(int),0,lzb.shape[0]-1)
            visible+=(lp[:,2]>=lzb[yi,xi]-.24)/5
        dot=np.maximum(0,ns@lm[:,2])
        illumination+=weight*(.14+.76*dot)*visible
    # Gentle contact darkening at geometric recesses, derived from the depth map.
    occlusion=np.zeros(len(xx))
    for dx,dy in ((3,0),(-3,0),(0,3),(0,-3),(3,3),(-3,-3),(3,-3),(-3,3)):
        xi=np.clip(xx+dx,0,w-1)
        yi=np.clip(yy+dy,0,h-1)
        diff=zb[yi,xi]-zb[yy,xx]
        occlusion+=((diff>.35)&(diff<4.5))/8
    illumination*=1-.18*occlusion
    rgb=np.zeros((h,w,3),np.uint8)
    bg=np.array([242,243,239])
    rgb[:]=bg
    mat=np.array([235,232,220])
    rgb[yy,xx]=np.clip(mat[None,:]*illumination[:,None]**.72,0,255).astype(np.uint8)
    # Soft ground contact shadow restricted to the lower image margin.
    return Image.fromarray(rgb)

def font(sz,bold=False):
    candidates = [
        'DejaVuSans'+('-Bold' if bold else '')+'.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans'+('-Bold' if bold else '')+'.ttf',
        '/System/Library/Fonts/Supplemental/Arial'+(' Bold' if bold else '')+'.ttf',
        'C:/Windows/Fonts/arial'+('bd' if bold else '')+'.ttf',
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate,sz)
        except OSError:
            pass
    return ImageFont.load_default(size=sz)

print('Rendering corrected front, rear and both sides...',flush=True)
canvas=Image.new('RGB',(2400,1700),(242,243,239))
d=ImageDraw.Draw(canvas)
d.text((65,43),'DUNCHON JUGONG  /  10F',font=font(44,True),fill='#263832')
d.text((67,108),'Original T-type layout  ·  Balconies open  ·  Entrances on both sides',font=font(23),fill='#64726b')
d.line((66,152,2334,152),fill='#c8cec7',width=2)
main=render((1.35,-1.8,.90),1160,1390)
canvas.paste(main,(0,190))
views=[('FRONT · 2 BALCONIES',(0,-1,.008),(1190,225)),('REAR · WINDOWS',(0,1,.008),(1790,225)),('LEFT · ENTRANCE',(-1,0,.008),(1190,925)),('RIGHT · ENTRANCE',(1,0,.008),(1790,925))]
for title,direction,(xx,yy) in views:
 canvas.paste(render(direction,540,620),(xx,yy+35))
 ImageDraw.Draw(canvas).text((xx+40,yy),title,font=font(20,True),fill='#53645c')
d=ImageDraw.Draw(canvas)
d.text((65,1585),'120 × 132 × 174.2 mm  /  approx. 1:200',font=font(26,True),fill='#263832')
d.line((66,1635,2334,1635),fill='#c8cec7',width=2)
d.text((67,1650),'Based on Junglim 25T-type drawings and supplied photos. Later balcony enclosures / AC racks are optional.',font=font(20),fill='#68746d')
canvas.save(ROOT/'dist/jugong_10f_preview.png')
main.save(ROOT/'work/isometric_v2.png')
print('Preview saved.',flush=True)
