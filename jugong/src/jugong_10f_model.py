"""Dunchon Jugong, pre-redevelopment 10-storey T-type apartment, revision 2.

Reference: https://junglim.info/archives/6466 — original 25T A/B plans,
section and period photographs, cross-checked against the six user photos.
Front (-Y): two large balcony stacks. Rear (+Y): four windows per floor.
Left/right: one large balcony stack each and recessed entrances on BOTH sides.
The rear block is narrower than the front block. This is NOT rotationally
symmetric. Floor layout uses two 8.8 x 10.3 m units at the rear and two
10.3 x 8.8 m units at the front, connected by the circulation core.
The main balconies project 1.5 m, stepping to 1.2 m beside the bedrooms.

At default size, 1 real metre = 5 model mm (1:200). Structural dimensions
are based on the published type drawings; minor details / site level / roof
plan are reconstructed, not an as-built survey of a particular building.

DEFAULT: no added outer balcony enclosure; no AC mounting brackets.
Original room windows and balcony guards are always retained.

Requirements: pip install numpy manifold3d trimesh networkx
Run: python jugong_10f_model.py --output jugong_10f.stl
     python jugong_10f_model.py --show-balcony-sashes --show-ac-brackets
     python jugong_10f_model.py --all-variants --output jugong_10f.stl
STL is a fused solid and cannot store layer visibility. Use the accompanying
viewer for independent show/hide and download of the corresponding fused STL.
"""
from pathlib import Path
import argparse
import json
import numpy as np
import manifold3d as md
import trimesh

FLOORS=10
BASE=2.4
F0=BASE+6.5
LEVELS=[F0+i*14.0 for i in range(FLOORS)]
ROOF=LEVELS[-1]+15.0
FRONT=-53.75
REAR=53.75
MIN_FRAME=.45


def box(a,b,c,d,e,f):
    assert b>a and d>c and f>e,(a,b,c,d,e,f)
    return md.Manifold.cube((b-a,d-c,f-e)).translate((a,c,e))


def union(parts):
    return md.Manifold.batch_boolean(parts,md.OpType.Add)


def subtract(body,cuts):
    return md.Manifold.batch_boolean([body]+cuts,md.OpType.Subtract)


class Solids(list):
    def __init__(self, values=()):
        super().__init__(values)
        self.window_details=[]


class Facade:
    """Local U is horizontal; D is positive OUT from the structural wall."""
    def __init__(self,face,angle=0,mirror=False):
        self.face=face;self.angle=angle;self.mirror=mirror
    def transform(self,m):
        m=m.rotate((0,0,self.angle))
        return m.mirror((1,0,0)) if self.mirror else m
    def b(self,u0,u1,d0,d1,z0,z1):
        return self.transform(box(u0,u1,self.face-d1,self.face-d0,z0,z1))
    def hull(self,points):
        p=np.asarray([(u,self.face-d,z) for u,d,z in points])
        return self.transform(md.Manifold.hull_points(p))


def frame(parts,fac,u0,u1,z0,z1,depth,panes=2,outer=.65,inner=.45,glaze=True):
    """Outer jamb + separate sliding sash perimeter + inset backing per pane."""
    b=fac.b
    # Main perimeter projects farther than the individual sliding leaves.
    for a,c in ((u0,u0+outer),(u1-outer,u1)):
        parts.append(b(a,c,depth-.95,depth,z0,z1))
    for e,f in ((z0,z0+outer),(z1-outer,z1)):
        parts.append(b(u0,u1,depth-.95,depth,e,f))
    left=u0+outer-.12;right=u1-outer+.12
    bottom=z0+outer-.12;top=z1-outer+.12
    w=(right-left)/panes
    for i in range(panes):
        a=left+i*w-.04;c=left+(i+1)*w+.04
        # Alternating tracks make the individual overlapping leaves legible.
        p=depth-.16-(.27 if i%2 else 0)
        for x,y in ((a,a+inner),(c-inner,c)):
            parts.append(b(x,y,p-.65,p,bottom,top))
        for e,f in ((bottom,bottom+inner),(top-inner,top)):
            parts.append(b(a,c,p-.65,p,e,f))
        if glaze:
            parts.append(b(a+.18,c-.18,depth-1.12,depth-.70,bottom+.18,top-.18))
    # Two narrow, visibly separate bottom tracks.
    parts.append(b(u0,u1,depth-.55,depth+.18,z0-.13,z0+.29))


def wall_window(parts,cuts,fac,u,w,z,h=7.0,panes=2):
    a=u-w/2;c=u+w/2
    cuts.append(fac.b(a+.50,c-.50,-1.75,.35,z+.48,z+h-.48))
    target=parts.window_details
    frame(target,fac,a,c,z,z+h,.36,panes=panes,outer=.60,glaze=False)
    target.append(fac.b(a+.44,c-.44,-1.90,-.34,z+.42,z+h-.42))


def guard(parts,fac,a,c,depth,z0,z1,posts=True):
    parts.append(fac.b(a,c,depth-.40,depth+.24,z1-.58,z1))
    parts.append(fac.b(a,c,depth-.36,depth+.18,z0,z0+.43))
    if posts:
        n=max(2,round((c-a)/1.7))
        for u in np.linspace(a+.22,c-.22,n):
            parts.append(fac.b(u-.24,u+.24,depth-.32,depth+.15,z0-.10,z1-.10))


def juliet(parts,cuts,fac,u,z,width=8.1):
    wall_window(parts,cuts,fac,u,width,z+4.20,h=7.0,panes=2)
    a=u-width/2-.45;c=u+width/2+.45;deep=3.25
    pts=[]
    for x in (a,c):
        pts.extend([(x,-.20,z+3.36),(x,deep,z+3.83),(x,deep,z+4.35),(x,-.20,z+4.35)])
    parts.append(fac.hull(pts))
    # Low concrete apron, cheeks and metal guard above it.
    parts.append(fac.b(a,c,deep-.62,deep,z+4.2,z+5.25))
    parts.append(fac.b(a,a+.65,-.12,deep,z+4.0,z+6.72))
    parts.append(fac.b(c-.65,c,-.12,deep,z+4.0,z+6.72))
    guard(parts,fac,a+.5,c-.5,deep-.10,z+5.1,z+6.75)


def balcony(parts,cuts,sashes,brackets,fac,start):
    """One 7.6 m stack: 0.85 m store, 2.85 m bedroom, 3.9 m living room."""
    a=start;b=start+4.25;split=start+18.5;c=start+38.0
    # Original end storage and outer wall; it belongs to the basic building.
    parts.append(fac.b(a,b,-.22,6.0,F0-.30,ROOF+.15))
    for i,z in enumerate(LEVELS):
        top=LEVELS[i+1] if i+1<FLOORS else ROOF
        # The slab follows the actual 300 mm step in balcony depth.
        parts.append(fac.b(a,split+.15,-.22,6.18,z-.88,z+.10))
        parts.append(fac.b(split-.15,c,-.22,7.68,z-.88,z+.10))
        # Bedroom privacy apron and lower living-room apron.
        parts.append(fac.b(b-.12,split+.15,5.48,6.15,z-.05,z+4.65))
        parts.append(fac.b(split-.05,c,6.96,7.65,z-.05,z+1.82))
        parts.append(fac.b(c-.68,c,-.18,7.65,z-.05,z+1.82))
        # Privacy return at the step; metal rail continues across the living bay.
        parts.append(fac.b(split-.36,split+.33,5.45,7.66,z-.05,z+4.65))
        guard(parts,fac,split+.18,c-.32,7.42,z+1.7,z+5.28)
        # Side return guard, looking through an open balcony from an oblique view.
        parts.append(fac.b(c-.56,c+.02,.12,7.45,z+4.74,z+5.30))
        for d in np.linspace(.5,7.1,5):
            parts.append(fac.b(c-.50,c-.02,d-.23,d+.23,z+1.62,z+5.13))
        # Original sliding room windows are on the recessed structural wall.
        wall_window(parts,cuts,fac,(b+split)/2,12.2,z+.7,h=11.6,panes=3)
        wall_window(parts,cuts,fac,(split+c)/2,15.7,z+.65,h=11.65,panes=4)
        # Storage door, visible from the balcony, represented by a narrow reveal.
        # Optional additions are kept in their own layer until export.
        frame(sashes,fac,b-.06,split+.12,z+4.48,top-.79,5.99,panes=2,glaze=False)
        frame(sashes,fac,split+.12,c-.12,z+1.82,top-.79,7.49,panes=(3,4,3,4,3,3,4,3,4,3)[i],glaze=False)
        # Enclosure end return: two individual panes across the balcony depth.
        for d0,d1 in ((.10,3.50),(3.50,7.45)):
            sashes.append(fac.b(c-.56,c+.02,d0,d1,z+1.82,z+2.36))
            sashes.append(fac.b(c-.56,c+.02,d0,d1,top-1.35,top-.79))
            for dd in (d0,d1-.5):
                sashes.append(fac.b(c-.56,c+.02,dd,dd+.50,z+1.82,top-.79))
        # Glazed return at the 300 mm depth step.
        sashes.append(fac.b(split-.34,split+.24,5.65,7.50,z+4.52,z+5.09))
        sashes.append(fac.b(split-.34,split+.24,5.65,7.50,top-1.32,top-.77))
        for dd in (5.65,7.00):
            sashes.append(fac.b(split-.34,split+.24,dd,dd+.50,z+4.52,top-.79))
        # Empty AC mounting rack, never an AC unit. Only selected historical positions.
        if i in (1,3,5,7,9):
            l=b+2.0;r=l+4.6;zz=z+2.25
            for u in (l,r-.58):
                brackets.append(fac.b(u,u+.58,5.85,6.55,zz-.72,zz+2.30))
                brackets.append(fac.b(u,u+.58,5.85,9.00,zz-.05,zz+.55))
                pp=[]
                for xx in (u,u+.58):
                    pp.extend([(xx,6.12,zz-1.13),(xx,8.66,zz+.13),(xx,8.66,zz+.67),(xx,6.12,zz-.53)])
                brackets.append(fac.hull(pp))
            brackets.append(fac.b(l,r,8.41,9.00,zz-.02,zz+.57))
    # Roof cover follows both balcony depths, below the main wall parapet.
    parts.append(fac.b(a-.12,split+.14,-.18,6.50,ROOF-.87,ROOF+.12))
    parts.append(fac.b(split-.14,c+.18,-.18,7.98,ROOF-.87,ROOF+.12))


def build_layers():
    parts=Solids([box(-51.5,51.5,-53.75,-9.75,BASE-.1,ROOF),
           box(-44,44,2.25,53.75,BASE-.1,ROOF),
           box(-28.5,28.5,-9.90,2.40,BASE-.1,ROOF)])
    cuts=[];sashes=[];brackets=[]
    pts=[]
    for z,w,d in ((0,120,132),(1.65,120,132),(BASE,118.6,130.6)):
        for x in (-w/2,w/2):
            for y in (-d/2,d/2):pts.append((x,y-2.4,z))
    parts.append(md.Manifold.hull_points(np.asarray(pts)))
    # Two front balconies and one on each side. Mirrors are along X, NOT 180° copies.
    for mirror in (False,True):
        balcony(parts,cuts,sashes,brackets,Facade(FRONT,0,mirror),0)
        balcony(parts,cuts,sashes,brackets,Facade(-44,90,mirror),2.25)
        ff=Facade(FRONT,0,mirror)
        sf=Facade(-51.5,90,mirror)
        sa=Facade(-44,90,mirror)
        for z in LEVELS:
            juliet(parts,cuts,ff,44.85,z,width=7.9)
            juliet(parts,cuts,sf,-26.50,z,width=7.9)
            wall_window(parts,cuts,sf,-14.90,4.10,z+5.35,h=5.8,panes=2)
            juliet(parts,cuts,sa,46.90,z,width=7.65)
        # Both side entrances open from the shared recessed circulation core.
        core=Facade(-28.5,90,mirror)
        u0=-9.75;u1=2.25;landing=F0-.45
        parts.append(core.b(u0+.50,u1-.50,-.22,9.80,BASE-.05,landing))
        # Equal flights facing outwards from both sides; no front/rear entrance.
        for k in range(9):
            d0=9.30+(8-k)*1.65;d1=d0+1.85
            height=BASE+(landing-BASE)*(k+1)/9
            parts.append(core.b(-8.30,.80,d0,d1,BASE-.08,height))
        for a,c in ((-9.25,-8.45),(.96,1.76)):
            pts=[]
            for u in (a,c):
                pts.extend([(u,9.1,BASE-.06),(u,24.7,BASE-.06),
                            (u,24.7,BASE+1.0),(u,9.1,landing+1.0)])
            parts.append(core.hull(pts))
        # Paired entrance doors and a projecting flat canopy.
        wall_window(parts,cuts,core,-3.75,8.9,landing+.1,h=10.4,panes=2)
        parts.append(core.b(-10.0,2.50,-.20,16.6,landing+10.65,landing+11.65))
        for i,z in enumerate(LEVELS[1:],1):
            wall_window(parts,cuts,core,-3.75,7.4,z+4.25,h=5.0,panes=3)
        # Large, restrained blank wall panel joints belong to the B wing side.
        for z in LEVELS[1:]:
            cuts.append(sf.b(-48.8,-33.2,-.25,.10,z+.04,z+.31))
        for u in (-48.8,-33.5):
            # Stop short of horizontal seams to avoid zero-width boolean edges.
            for z in LEVELS[1:-1]:
                cuts.append(sf.b(u,u+.28,-.25,.10,z+.52,z+13.55))
    # Rear is a continuous facade, with NO large balcony or door stack.
    back=Facade(-REAR,180)
    for z in LEVELS:
        for u in (-15.5,15.5):juliet(parts,cuts,back,u,z,width=8.05)
        for u in (-4.65,4.65):wall_window(parts,cuts,back,u,4.0,z+5.35,h=5.8,panes=2)
    for lo,hi in ((-39.7,-26.8),(26.8,39.7)):
        for z in LEVELS[1:]:cuts.append(back.b(lo,hi,-.23,.10,z+.04,z+.31))
    # Parapet follows the H-shaped footprint, including both recessed side entrances.
    edges=[(-51.5,51.5,-53.75,-52.55),(-51.5,-50.30,-53.75,-9.75),
           (50.30,51.5,-53.75,-9.75),(-51.5,-28.35,-10.95,-9.75),
           (28.35,51.5,-10.95,-9.75),(-28.5,-27.30,-9.90,2.40),
           (27.30,28.5,-9.90,2.40),(-44,-28.35,2.25,3.45),
           (28.35,44,2.25,3.45),(-44,-42.8,2.25,53.75),
           (42.8,44,2.25,53.75),(-44,44,52.55,53.75)]
    for a,b,c,d in edges:parts.append(box(a,b,c,d,ROOF-.12,ROOF+5.9))
    # Original two-level lift/stair plant volume; exact equipment layout is inferred.
    parts.append(box(-18.9,18.9,-20.4,14.6,ROOF-.15,ROOF+23.5))
    parts.append(box(-19.45,19.45,-20.95,15.15,ROOF+23.20,ROOF+24.3))
    # Recessed plant-room windows, access door and modest ventilation upstands.
    rf=Facade(-20.4,0)
    wall_window(parts,cuts,rf,0,5.6,ROOF+7.0,h=4.9,panes=2)
    rb=Facade(-14.6,180)
    wall_window(parts,cuts,rb,10.8,5.0,ROOF+.5,h=9.4,panes=1)
    for x,y in ((-30,36),(30,36),(-35,-28),(35,-28)):
        parts.append(box(x-1.1,x+1.1,y-1.1,y+1.1,ROOF-.1,ROOF+.65))
        parts.append(md.Manifold.cylinder(2.1,.7,.7,12).translate((x,y,ROOF+.4)))
        parts.append(md.Manifold.cylinder(.45,.95,.95,12).translate((x,y,ROOF+2.1)))
    print(f'Base: {len(parts)} solids, {len(cuts)} recesses; optional sashes {len(sashes)}, brackets {len(brackets)}.',flush=True)
    # Separate the cutters from the window detail union: cut main masses first,
    # then restore all window frames and backing panes in front of those openings.
    # Their profiles lie in/around the cut boundary. Broad recesses must never
    # cut the sash leaves themselves, so identify frame geometry in build stage.
    return parts,cuts,sashes,brackets


def build_base():
    parts,cuts,sashes,brackets=build_layers()
    # Cut structural openings before attaching the original window frames.
    base=union([subtract(union(parts),cuts)]+parts.window_details).simplify(.00002)
    return base,union(sashes).simplify(.00002),union(brackets).simplify(.00002)


def to_trimesh(shape):
    assert shape.status()==md.Error.NoError,shape.status()
    raw=shape.to_mesh64()
    t=trimesh.Trimesh(vertices=np.asarray(raw.vert_properties)[:,:3],faces=np.asarray(raw.tri_verts),process=True)
    t.fix_normals(multibody=False)
    return t


def export_checked(shape,path):
    t=to_trimesh(shape.simplify(.00003))
    assert t.is_watertight,'Mesh has a boundary / non-manifold edge'
    assert t.is_volume and t.is_winding_consistent,'Invalid oriented volume'
    assert len(t.split(only_watertight=False))==1,'Disconnected parts'
    t.export(path,file_type='stl')
    r=trimesh.load_mesh(path,process=True)
    assert r.is_watertight and r.is_volume and len(r.split(only_watertight=False))==1
    return dict(file=path.name,dimensions_mm=np.round(r.extents,3).tolist(),
                triangles=len(r.faces),watertight=True,connected_bodies=1,
                file_bytes=path.stat().st_size)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output',default='jugong_10f.stl')
    p.add_argument('--scale',type=float,default=1.0)
    p.add_argument('--show-balcony-sashes',action='store_true')
    p.add_argument('--show-ac-brackets',action='store_true')
    p.add_argument('--all-variants',action='store_true')
    args=p.parse_args()
    if args.scale<=0:p.error('--scale must be positive')
    out=Path(args.output).resolve();out.parent.mkdir(parents=True,exist_ok=True)
    base,sashes,brackets=build_base()
    report=[]
    configs=[(0,0),(1,0),(0,1),(1,1)] if args.all_variants else [(int(args.show_balcony_sashes),int(args.show_ac_brackets))]
    for sh,ac in configs:
        m=union([base]+([sashes] if sh else [])+([brackets] if ac else [])).scale((args.scale,)*3)
        suffix='' if (sh,ac)==(0,0) or not args.all_variants else ('_sashes' if sh else '')+('_ac_brackets' if ac else '')
        path=out.with_stem(out.stem+suffix)
        r=export_checked(m,path);r.update(external_sashes=bool(sh),ac_brackets=bool(ac))
        report.append(r);print(json.dumps(r,ensure_ascii=False),flush=True)
    if args.all_variants:
        # Separate display layers; exports above are independently unioned and checked.
        work=out.parent.parent/'work'
        work.mkdir(parents=True,exist_ok=True)
        for name,shape in [('base',base),('sashes',sashes),('brackets',brackets)]:
            to_trimesh(shape).export(work/f'display_{name}.ply')
        (work/'model_validation.json').write_text(json.dumps(report,indent=2))


if __name__=='__main__':main()
