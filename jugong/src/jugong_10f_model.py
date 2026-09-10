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

DEFAULT: all 40 dwellings have no outer balcony enclosure and no AC equipment.
Original room windows and balcony guards are always retained. Addressable keys
01-A..10-D support sash none/partial/full and AC none/bracket/unit.  A JSON
configuration can be fused into one connected STL; the four legacy STL names
remain all-household presets.

Requirements: pip install numpy manifold3d trimesh networkx
Run: python jugong_10f_model.py --output jugong_10f.stl
     python jugong_10f_model.py --show-balcony-sashes --show-ac-brackets
     python jugong_10f_model.py --all-variants --output jugong_10f.stl
STL is a fused solid and cannot store layer state. Use the accompanying viewer
for per-household visibility, JSON/URL state, and a four-material 3MF download.
The four fixed slots are aged concrete, metal frames/guards, dark glazing, and
roof/entrance/later-addition accent. Palette colors are replaceable; geometry
assignment and the maximum slot count are not.
"""
from pathlib import Path
import argparse
import sys
from functools import lru_cache
import facade_unfold as unfolding
import json
import re
import struct
import unicodedata
import zipfile
from xml.sax.saxutils import escape, quoteattr
import numpy as np
import manifold3d as md
import trimesh
from facade_signs import (traced_digit, symbol, SIGN_HEIGHT, SIGN_GAP, SIGN_MAX_WIDTH,
    SIGN_CENTER_U, SIGN_PAINT_DEPTH, SIGN_EMBOSS_DEPTH, SIGN_MARGIN_X, SIGN_MARGIN_Z, MARK_PANEL)
from facade_variants import (CATALOG, DEFAULTS, LAYER_NAMES, SASH_PROFILES,
    normalize_seed, resolve_state, selected_layers)

FLOORS=10
BASE=2.4
F0=BASE+6.5
LEVELS=[F0+i*14.0 for i in range(FLOORS)]
ROOF=LEVELS[-1]+15.0
FRONT=-53.75
REAR=53.75
FACADE_SOURCES={}
MIN_FRAME=.45
PANEL_THICKNESS=unfolding.WALL
HINGE_SKIN=.45
FACADE_HEIGHT=ROOF+5.9-BASE
PANEL_WIDTHS=tuple(p['width'] for p in unfolding.panels(BASE))
PANEL_ORDER=unfolding.NAMES

# Four fixed print-material slots.  Colors may be replaced by the user, but
# the slot count and the geometric assignment stay stable for slicers.
MATERIALS=(
    dict(key='concrete',name='노후 콘크리트·도장 외벽',color='#C5C1B2',roughness=.88),
    dict(key='metal',name='창호·난간 금속',color='#E1E4DF',roughness=.58),
    dict(key='glass',name='유리·어두운 개구부',color='#4F7397',roughness=.28),
    dict(key='accent',name='출입구·옥상·후대 부착물',color='#454C4F',roughness=.72),
)
MATERIAL_INDEX={item['key']:i for i,item in enumerate(MATERIALS)}
DEFAULT_PALETTE=tuple(item['color'] for item in MATERIALS)

# The published floor arrangement establishes four dwellings per floor, but no
# authoritative dong-by-dong unit-number schedule has been found.  These stable
# keys therefore describe model position, while ``estimated_unit`` is UI copy
# only and must always be presented as an estimate.
LINE_INFO={
    'A':dict(position='front-left',facade='front (-Y)',unit_type='25T-B'),
    'B':dict(position='front-right',facade='front (-Y)',unit_type='25T-B'),
    'C':dict(position='rear-left',facade='left side (-X)',unit_type='25T-A'),
    'D':dict(position='rear-right',facade='right side (+X)',unit_type='25T-A'),
}
SASH_STATES=('none','partial','full')
AC_STATES=('none','bracket','unit')


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
        self.materials=['concrete']*len(self)
        self.window_details=None
    def append(self, value, material='concrete'):
        super().append(value)
        self.materials.append(material)
    def add(self, value, material):
        self.append(value,material)


def add_material(parts,shape,material):
    if isinstance(parts,Solids):parts.add(shape,material)
    else:parts.append(materialized(shape,2) if material=='glass' else shape)


def materialized(shape,index):
    result=shape.set_properties(1,lambda _position,_old:[float(index)])
    if shape in FACADE_SOURCES:FACADE_SOURCES[result]=FACADE_SOURCES[shape]
    return result


class Facade:
    """Local U is horizontal; D is positive OUT from the structural wall."""
    def __init__(self,face,angle=0,mirror=False):
        self.face=face;self.angle=angle;self.mirror=mirror
    def transform(self,m):
        m=m.rotate((0,0,self.angle))
        m=m.mirror((1,0,0)) if self.mirror else m
        theta=np.radians(self.angle);point=np.array((-self.face*np.sin(theta),self.face*np.cos(theta)));normal=np.array((np.sin(theta),-np.cos(theta)))
        if self.mirror:point[0]*=-1;normal[0]*=-1
        FACADE_SOURCES[m]=(point,normal)
        return m
    def b(self,u0,u1,d0,d1,z0,z1):
        return self.transform(box(u0,u1,self.face-d1,self.face-d0,z0,z1))
    def hull(self,points):
        p=np.asarray([(u,self.face-d,z) for u,d,z in points])
        return self.transform(md.Manifold.hull_points(p))


def frame(parts,fac,u0,u1,z0,z1,depth,panes=2,outer=.30,inner=.16,glaze=True,ratios=None):
    """Outer jamb + separate sliding sash perimeter + inset backing per pane."""
    b=fac.b
    # Main perimeter projects farther than the individual sliding leaves.
    for a,c in ((u0,u0+outer),(u1-outer,u1)):
        add_material(parts,b(a,c,depth-.45,depth,z0,z1),'metal')
    for e,f in ((z0,z0+outer),(z1-outer,z1)):
        add_material(parts,b(u0,u1,depth-.45,depth,e,f),'metal')
    left=u0+outer-.06;right=u1-outer+.06
    bottom=z0+outer-.06;top=z1-outer+.06
    ratios=ratios or [1]*panes
    breaks=np.concatenate(([0],np.cumsum(ratios)/sum(ratios)))
    for i in range(len(ratios)):
        a=left+breaks[i]*(right-left)-.04;c=left+breaks[i+1]*(right-left)+.04
        # Alternating tracks make the individual overlapping leaves legible.
        p=depth-.07-(.12 if i%2 else 0)
        for x,y in ((a,a+inner),(c-inner,c)):
            add_material(parts,b(x,y,p-.28,p,bottom,top),'metal')
        for e,f in ((bottom,bottom+inner),(top-inner,top)):
            add_material(parts,b(a,c,p-.28,p,e,f),'metal')
        if glaze:
            add_material(parts,b(a+inner-.025,c-inner+.025,p-.23,p-.11,bottom+inner-.025,top-inner-.18),'glass')
    # Two narrow, visibly separate bottom tracks.
    add_material(parts,b(u0,u1,depth-.40,depth+.07,z0-.08,z0+.16),'metal')


def wall_window(parts,cuts,fac,u,w,z,h=7.0,panes=2):
    a=u-w/2;c=u+w/2
    cuts.append(fac.b(a+.50,c-.50,-1.75,.35,z+.48,z+h-.48))
    target=parts.window_details
    frame(target,fac,a,c,z,z+h,.36,panes=panes,outer=.30,glaze=False)
    target.add(fac.b(a+.44,c-.44,-1.90,-.34,z+.42,z+h-.42),'glass')


def guard(parts,fac,a,c,depth,z0,z1,posts=True):
    add_material(parts,fac.b(a,c,depth-.40,depth+.24,z1-.58,z1),'metal')
    add_material(parts,fac.b(a,c,depth-.36,depth+.18,z0,z0+.43),'metal')
    if posts:
        n=max(2,round((c-a)/1.7))
        for u in np.linspace(a+.22,c-.22,n):
            add_material(parts,fac.b(u-.24,u+.24,depth-.32,depth+.15,z0-.10,z1-.10),'metal')


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


def balcony(parts,cuts,households,fac,start,line):
    """One 7.6 m stack: 0.85 m store, 2.85 m bedroom, 3.9 m living room."""
    a=start;b=start+4.25;split=start+18.5;c=start+38.0
    # Original end storage and outer wall; it belongs to the basic building.
    parts.append(fac.b(a,b,-.22,6.0,F0-.30,ROOF+.15))
    for i,z in enumerate(LEVELS):
        household=households[f'{i+1:02d}-{line}']
        sash_partial=household['sash_partial']
        sash_full=household['sash_full']
        brackets=household['ac_bracket']
        ac_unit=household['ac_unit']
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
        parts.add(fac.b(c-.56,c+.02,.12,7.45,z+4.74,z+5.30),'metal')
        for d in np.linspace(.5,7.1,5):
            parts.add(fac.b(c-.50,c-.02,d-.23,d+.23,z+1.62,z+5.13),'metal')
        # Original sliding room windows are on the recessed structural wall.
        wall_window(parts,cuts,fac,(b+split)/2,12.2,z+.7,h=11.6,panes=3)
        wall_window(parts,cuts,fac,(split+c)/2,15.7,z+.65,h=11.65,panes=4)
        # Storage door, visible from the balcony, represented by a narrow reveal.
        # Optional additions are kept in their own layer until export.
        # "partial" means only the living-room bay is enclosed.  "full" adds
        # the bedroom bay and return frames.  Original room windows and rails
        # remain in ``parts`` regardless of this later enclosure state.
        frame(sash_full,fac,b-.06,split+.12,z+4.48,top-.79,5.99,panes=2,glaze=False)
        frame(sash_partial,fac,split+.12,c-.12,z+1.82,top-.79,7.49,panes=(3,4,3,4,3,3,4,3,4,3)[i],glaze=False)
        # Enclosure end return: two individual panes across the balcony depth.
        full_frame_count=len(sash_full)
        for d0,d1 in ((.10,3.50),(3.50,7.45)):
            sash_full.append(fac.b(c-.26,c+.02,d0,d1,z+1.82,z+2.10))
            sash_full.append(fac.b(c-.26,c+.02,d0,d1,top-1.07,top-.79))
            for dd in (d0,d1-.24):
                sash_full.append(fac.b(c-.26,c+.02,dd,dd+.24,z+1.82,top-.79))
        # Glazed return at the 300 mm depth step.
        sash_full.append(fac.b(split-.16,split+.12,5.65,7.50,z+4.52,z+4.80))
        sash_full.append(fac.b(split-.16,split+.12,5.65,7.50,top-1.05,top-.77))
        for dd in (5.65,7.26):
            sash_full.append(fac.b(split-.16,split+.12,dd,dd+.24,z+4.52,top-.79))
        # Every dwelling gets an addressable empty rack.  ``unit`` adds the
        # outdoor condenser body while retaining this rack underneath it.
        l=b+2.0;r=l+4.6;zz=z+2.25
        for u in (l,r-.58):
            brackets.append(fac.b(u,u+.58,5.85,6.55,zz-.72,zz+2.30))
            brackets.append(fac.b(u,u+.58,5.85,9.00,zz-.05,zz+.55))
            pp=[]
            for xx in (u,u+.58):
                pp.extend([(xx,6.12,zz-1.13),(xx,8.66,zz+.13),(xx,8.66,zz+.67),(xx,6.12,zz-.53)])
            brackets.append(fac.hull(pp))
        brackets.append(fac.b(l,r,8.41,9.00,zz-.02,zz+.57))
        # A simplified condenser casing, visibly distinct from the empty rack.
        ac_unit.append(fac.b(l+.18,r-.18,8.34,10.55,zz+.20,zz+3.48))
        for u in np.linspace(l+.72,r-.72,4):
            ac_unit.append(fac.b(u-.12,u+.12,10.48,10.72,zz+.62,zz+3.05))
        for variant,(ratios,thickness,transom) in SASH_PROFILES.items():
            living=household[f'sash_partial__{variant}'];bed=household[f'sash_full__{variant}']
            profile_frame(living,fac,split+.12,c-.12,z+1.82,top-.79,7.49,ratios,thickness,transom)
            profile_frame(bed,fac,b-.06,split+.12,z+4.48,top-.79,6.20,(1,1,1) if variant=='three' else ratios if variant=='four' else (1,1),thickness,False)
            bed.extend(sash_full[full_frame_count:])
            # Thin return glazing joins the rails; the open top gap vents the
            # balcony cavity so the fused printable model has no sealed void.
            for d0,d1 in ((.10,3.50),(3.50,7.45)):
                add_material(bed,fac.b(c-.20,c-.08,d0+.20,d1-.20,z+2.05,top-1.32),'glass')
            add_material(bed,fac.b(split-.10,split+.02,5.84,7.30,z+4.75,top-1.30),'glass')
        # Photographed main-wall and corner racks; separate position layers.
        ac_attachment(household,'bedroom',fac,b+4.3,5.85,z+2.2)
        ac_attachment(household,'corner',fac,split+2.6,6.98,z+1.0)
    # Roof cover follows both balcony depths, below the main wall parapet.
    parts.append(fac.b(a-.12,split+.14,-.18,6.50,ROOF-.87,ROOF+.12))
    parts.append(fac.b(split-.14,c+.18,-.18,7.98,ROOF-.87,ROOF+.12))


def profile_frame(parts,fac,a,c,z0,z1,depth,ratios,thickness,transom):
    frame(parts,fac,a,c,z0,z1,depth,outer=thickness,inner=.16,glaze=True,ratios=ratios)
    if transom:
        parts.append(fac.b(a,c,depth-.43,depth+.02,z0+2.5,z0+2.72))


def small_attachments(household,fac,u,z,*,narrow=None,ac=True):
    for variant in ('boxed','roof','transom'):
        target=household[f'small__{variant}'];a=u-4.0;c=u+4.0
        profile_frame(target,fac,a,c,z+5.10,z+11.55,3.15,(1,1),.28,variant=='transom')
        for x in (a,c-.28):
            target.append(fac.b(x,x+.28,-.15,3.2,z+4.95,z+5.40))
            target.append(fac.b(x,x+.28,-.15,3.2,z+11.25,z+11.55))
        if variant!='boxed':
            target.append(fac.hull([(x,d,h) for x in (a-.4,c+.4) for d,h in
                ((-.2,z+12.0),(3.75,z+11.6),(3.75,z+12.08),(-.2,z+12.48))]))
    if ac:
        ac_attachment(household,'small_rail',fac,u,-.12,z+4.4,reach=2.0)
        ac_attachment(household,'small_wall',fac,narrow if narrow is not None else u,-.12,z+2.0,reach=1.7)
        ac_attachment(household,'small_top',fac,u,-.12,z+11.0,reach=1.7,height=2.35)


def ac_attachment(household,position,fac,u,anchor,zz,reach=2.5,height=2.8):
    rack=household[f'ac_bracket__{position}'];unit=household[f'ac_unit__{position}']
    l=u-2.3;r=u+2.3;front=anchor+reach
    for x in (l,r-.55):
        rack.append(fac.b(x,x+.55,anchor,anchor+.65,zz-.8,zz+1.5))
        rack.append(fac.b(x,x+.55,anchor,front+.3,zz-.05,zz+.50))
        rack.append(fac.hull([(xx,d,h) for xx in (x,x+.55) for d,h in
            ((anchor,zz-.8),(front,zz+.0),(front,zz+.5),(anchor,zz-.25))]))
    rack.append(fac.b(l,r,front-.2,front+.35,zz-.05,zz+.5))
    unit.append(fac.b(l+.1,r-.1,front-1.5,front+.3,zz+.4,zz+.4+height))
    # Raised fan ring, connected to the casing, survives at 1:200 scale.
    ring=md.CrossSection.circle(.95,24)-md.CrossSection.circle(.60,24)
    fan=md.Manifold.extrude(ring,.25).rotate((90,0,0)).translate((u-.35,fac.face-front-.12,zz+.4+height/2))
    unit.append(fac.transform(fan))


def build_layers():
    FACADE_SOURCES.clear()
    parts=Solids([box(-51.5,51.5,-53.75,-9.75,BASE-.1,ROOF),
           box(-44,44,2.25,53.75,BASE-.1,ROOF),
           box(-28.5,28.5,-9.90,2.40,BASE-.1,ROOF)])
    parts.window_details=Solids()
    cuts=[]
    households={}
    for floor in range(1,FLOORS+1):
        for line,info in LINE_INFO.items():
            key=f'{floor:02d}-{line}'
            households[key]=dict(id=key,floor=floor,line=line,
                estimated_unit=str(floor*100+ord(line)-64),
                **info,**{name:[] for name in LAYER_NAMES})
    pts=[]
    for z,w,d in ((0,120,132),(1.65,120,132),(BASE,118.6,130.6)):
        for x in (-w/2,w/2):
            for y in (-d/2,d/2):pts.append((x,y-2.4,z))
    parts.append(md.Manifold.hull_points(np.asarray(pts)))
    # Two front balconies and one on each side. Mirrors are along X, NOT 180° copies.
    for mirror in (False,True):
        balcony(parts,cuts,households,Facade(FRONT,0,mirror),0,'A' if mirror else 'B')
        balcony(parts,cuts,households,Facade(-44,90,mirror),2.25,'C' if mirror else 'D')
        ff=Facade(FRONT,0,mirror)
        sf=Facade(-51.5,90,mirror)
        sa=Facade(-44,90,mirror)
        for i,z in enumerate(LEVELS):
            front_house=households[f'{i+1:02d}-{"A" if mirror else "B"}']
            side_house=households[f'{i+1:02d}-{"C" if mirror else "D"}']
            small_attachments(front_house,ff,44.85,z,ac=False)
            small_attachments(front_house,sf,-26.50,z,narrow=-14.90)
            small_attachments(side_house,sa,46.90,z,narrow=46.9)
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
        parts.add(core.b(-10.0,2.50,-.20,16.6,landing+10.65,landing+11.65),'accent')
        for i,z in enumerate(LEVELS[1:],1):
            wall_window(parts,cuts,core,-3.75,7.4,z+4.25,h=5.0,panes=3)
        # Large, restrained blank wall panel joints belong to the B wing side.
        for z in LEVELS[1:]:
            cuts.append(sf.b(-48.8,-33.2,-.25,.10,z+.04,z+.31))
        for u in (-48.8,-33.5):
            # Stop short of horizontal seams to avoid zero-width boolean edges.
            for z in LEVELS[1:-1]:
                cuts.append(sf.b(u,u+.28,-.25,.10,z+.52,z+13.55))
        # Broad repair fields translate the photographed faded patching and
        # rain streaks into nozzle-safe relief, rather than a fragile bitmap.
        for floor,u,w,h in ((3,-46.0,4.6,8.0),(6,-41.2,5.4,10.0),(7,-47.5,3.8,7.0)):
            z=LEVELS[floor-1]+2.1
            parts.append(sf.b(u,u+w,-.12,.30,z,z+h))
    for side in (1,-1):
        for shape,mat in jugong_mark(side):parts.add(shape,mat)
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
    parts.add(box(-18.9,18.9,-20.4,14.6,ROOF-.15,ROOF+23.5),'accent')
    parts.add(box(-19.45,19.45,-20.95,15.15,ROOF+23.20,ROOF+24.3),'accent')
    # Recessed plant-room windows, access door and modest ventilation upstands.
    rf=Facade(-20.4,0)
    wall_window(parts,cuts,rf,0,5.6,ROOF+7.0,h=4.9,panes=2)
    rb=Facade(-14.6,180)
    wall_window(parts,cuts,rb,10.8,5.0,ROOF+.5,h=9.4,panes=1)
    for x,y in ((-30,36),(30,36),(-35,-28),(35,-28)):
        parts.add(box(x-1.1,x+1.1,y-1.1,y+1.1,ROOF-.1,ROOF+.65),'accent')
        parts.add(md.Manifold.cylinder(2.1,.7,.7,12).translate((x,y,ROOF+.4)),'accent')
        parts.add(md.Manifold.cylinder(.45,.95,.95,12).translate((x,y,ROOF+2.1)),'accent')
    counts={name:sum(len(h[name]) for h in households.values())
            for name in ('sash_partial','sash_full','ac_bracket','ac_unit')}
    print(f'Base: {len(parts)} solids, {len(cuts)} recesses; 40 households, option solids {counts}.',flush=True)
    # Separate the cutters from the window detail union: cut main masses first,
    # then restore all window frames and backing panes in front of those openings.
    # Their profiles lie in/around the cut boundary. Broad recesses must never
    # cut the sash leaves themselves, so identify frame geometry in build stage.
    return parts,cuts,households


def build_base():
    parts,cuts,households=build_layers()
    # Cut structural openings before attaching the original window frames.
    base=union([subtract(union(parts),cuts)]+parts.window_details).simplify(.0005)
    return base,households


def build_material_base():
    """Build the same watertight base with a stable material property channel."""
    parts,cuts,households=build_layers()
    tagged=[materialized(shape,MATERIAL_INDEX[material])
            for shape,material in zip(parts,parts.materials)]
    tagged_cuts=[materialized(shape,MATERIAL_INDEX['concrete']) for shape in cuts]
    details=[materialized(shape,MATERIAL_INDEX[material])
             for shape,material in zip(parts.window_details,parts.window_details.materials)]
    base=union([subtract(union(tagged),tagged_cuts)]+details).simplify(.0005)
    return base,households


SEGMENTS={
    '0':'abcedf','1':'bc','2':'abdeg','3':'abcdg','4':'bcfg',
    '5':'acdfg','6':'acdefg','7':'abc','8':'abcdefg','9':'abcdfg','-':'g',
}

# Project-specific condensed numerals, redrawn from the painted 302/324/420
# signs in references/user.  These are deliberately not a system font: the
# shared stroke proportions, clipped corners and tight advance are stable
# geometry for both the folded model and the printable facade strip.
DONG_GLYPH_STROKES={
    '0':(((.20,.12),(.17,.82)),((.17,.82),(.34,.95)),((.34,.95),(.66,.95)),
         ((.66,.95),(.83,.82)),((.83,.82),(.80,.12)),((.80,.12),(.64,.03)),
         ((.64,.03),(.36,.03)),((.36,.03),(.20,.12))),
    '1':(((.30,.77),(.52,.95)),((.52,.95),(.52,.06)),((.27,.06),(.76,.06))),
    '2':(((.18,.80),(.32,.94)),((.32,.94),(.69,.94)),((.69,.94),(.82,.79)),
         ((.82,.79),(.78,.60)),((.78,.60),(.22,.08)),((.22,.08),(.82,.08))),
    '3':(((.18,.88),(.35,.95)),((.35,.95),(.68,.94)),((.68,.94),(.82,.80)),
         ((.82,.80),(.56,.52)),((.56,.52),(.80,.42)),((.80,.42),(.78,.16)),
         ((.78,.16),(.64,.05)),((.64,.05),(.25,.07))),
    '4':(((.69,.04),(.69,.95)),((.69,.95),(.20,.35)),((.20,.35),(.84,.35))),
    '5':(((.79,.93),(.24,.93)),((.24,.93),(.22,.53)),((.22,.53),(.67,.53)),
         ((.67,.53),(.80,.40)),((.80,.40),(.77,.16)),((.77,.16),(.63,.05)),
         ((.63,.05),(.23,.08))),
    '6':(((.77,.88),(.63,.95)),((.63,.95),(.34,.90)),((.34,.90),(.19,.67)),
         ((.19,.67),(.21,.18)),((.21,.18),(.35,.05)),((.35,.05),(.66,.05)),
         ((.66,.05),(.80,.19)),((.80,.19),(.77,.43)),((.77,.43),(.63,.53)),
         ((.63,.53),(.23,.51))),
    '7':(((.17,.93),(.83,.93)),((.83,.93),(.48,.05))),
    '8':(((.34,.51),(.20,.65)),((.20,.65),(.22,.83)),((.22,.83),(.36,.95)),
         ((.36,.95),(.65,.95)),((.65,.95),(.79,.82)),((.79,.82),(.78,.64)),
         ((.78,.64),(.65,.51)),((.65,.51),(.79,.39)),((.79,.39),(.78,.17)),
         ((.78,.17),(.64,.05)),((.64,.05),(.35,.05)),((.35,.05),(.21,.18)),
         ((.21,.18),(.22,.39)),((.22,.39),(.34,.51)),((.34,.51),(.65,.51))),
    '9':(((.78,.48),(.37,.48)),((.37,.48),(.22,.59)),((.22,.59),(.22,.82)),
         ((.22,.82),(.36,.95)),((.36,.95),(.65,.95)),((.65,.95),(.79,.81)),
         ((.79,.81),(.77,.33)),((.77,.33),(.63,.08)),((.63,.08),(.31,.04))),
    '-':(((.22,.50),(.78,.50)),),
}


def _stroke_polygon(a,b,width=.18):
    """Return a clipped-end quadrilateral around one normalized stroke."""
    ax,ay=a;bx,by=b;dx=bx-ax;dy=by-ay
    length=max((dx*dx+dy*dy)**.5,1e-9);nx=-dy/length*width/2;ny=dx/length*width/2
    return [(ax+nx,ay+ny),(bx+nx,by+ny),(bx-nx,by-ny),(ax-nx,ay-ny)]


def _glyph_cross_section(text,height):
    shapes=[];cursor=0.0
    for char in text:
        traced=traced_digit(char)
        if traced:section,width=traced
        else:
            strokes=DONG_GLYPH_STROKES[char]
            section=md.CrossSection([_stroke_polygon(a,b) for a,b in strokes],md.FillRule.NonZero)
            for a,b in strokes[:-1]:section+=md.CrossSection.circle(.09,16).translate(b)
            lo_x,lo_y,hi_x,hi_y=section.bounds()
            width=.28 if char=='1' else .32 if char=='-' else .44
            section=section.translate((-lo_x,-lo_y)).scale((width/(hi_x-lo_x),1/(hi_y-lo_y)))
            if char=='-':section=section.scale((1,.14)).translate((0,.43))
        shapes.append(section.translate((cursor,0)).scale((height,height)))
        cursor+=width+SIGN_GAP
    return md.CrossSection.batch_boolean(shapes,md.OpType.Add),(cursor-SIGN_GAP)*height


def _extrude_x(section,depth):
    """Extrude a horizontal/vertical section along +X (world side-wall normal)."""
    # CrossSection (u,v) -> extrusion (u,v,w), then cyclically map to (w,u,v).
    return md.Manifold.extrude(section,depth).transform(((0,0,1,0),(1,0,0,0),(0,1,0,0)))


def jugong_symbol():
    return symbol()


def jugong_mark(side=1):
    w,h=MARK_PANEL;z=LEVELS[8]+6.25
    panel=box(51.48,51.54,SIGN_CENTER_U-w/2,SIGN_CENTER_U+w/2,z-h/2,z+h/2)
    mark=_extrude_x(jugong_symbol(),SIGN_PAINT_DEPTH).translate((51.535,SIGN_CENTER_U,z))
    shapes=[(panel,'metal'),(mark,'glass')]
    return shapes if side==1 else [(shape.mirror((1,0,0)),mat) for shape,mat in shapes]


def dong_label_position(value):
    """Photo-based gable location; compass side remains a documented inference."""
    text=normalize_dong(value)
    return {'302':44.0,'303':48.5,'304':48.5,'324':48.5,'420':25.5}.get(text,48.5)


def normalize_dong(value, *, allow_empty=True):
    """Return a filename/geometry-safe dong identifier or raise ValueError."""
    text=unicodedata.normalize('NFKC',str(value or '')).strip()
    if text.endswith('동'):text=text[:-1].strip()
    if not text:
        if allow_empty:return ''
        raise ValueError('dong number is empty')
    if len(text)>8:raise ValueError('dong number is longer than 8 characters')
    if not re.fullmatch(r'[0-9]+(?:-[0-9]+)?',text):
        raise ValueError('dong number must contain digits and at most one internal hyphen')
    return text


def sign_section(text):
    section,width=_glyph_cross_section(text,SIGN_HEIGHT)
    if width>SIGN_MAX_WIDTH:
        scale=SIGN_MAX_WIDTH/width
        section=section.scale((scale,scale));height=SIGN_HEIGHT*scale;width=SIGN_MAX_WIDTH
    else:height=SIGN_HEIGHT
    return section,width,height


def dong_label(value,*,monochrome=False):
    text=normalize_dong(value)
    if not text:return None
    glyph,width,height=sign_section(text);z0=dong_label_position(text);y0=SIGN_CENTER_U-width/2
    plate=materialized(box(51.48,51.54,y0-SIGN_MARGIN_X,y0+width+SIGN_MARGIN_X,z0,z0+height+2*SIGN_MARGIN_Z),1)
    raised=materialized(_extrude_x(glyph,SIGN_EMBOSS_DEPTH if monochrome else SIGN_PAINT_DEPTH).translate((51.535,y0,z0+SIGN_MARGIN_Z)),3)
    return union([plate,raised]).simplify(.0005)


def normalize_palette(value=None):
    palette=list(DEFAULT_PALETTE if value is None else value)
    if len(palette)!=4 or any(not isinstance(color,str) or
        not re.fullmatch(r'#[0-9A-Fa-f]{6}',color) for color in palette):
        raise ValueError('palette must contain exactly four #RRGGBB colors')
    return [color.upper() for color in palette]


def default_configuration(dong=''):
    return dict(schemaVersion=1,dong=normalize_dong(dong),palette=normalize_palette(),seed=None,printMode='color',monoColor='#C5C1B2',households={
        key:dict(**DEFAULTS,explicit=[]) for key in sorted_household_ids()
    })


def sorted_household_ids():
    return [f'{floor:02d}-{line}' for floor in range(1,FLOORS+1) for line in LINE_INFO]


def normalize_configuration(raw):
    if not isinstance(raw,dict) or raw.get('schemaVersion')!=1:
        raise ValueError('configuration schemaVersion must be 1')
    result=default_configuration(raw.get('dong',''))
    result['palette']=normalize_palette(raw.get('palette'))
    result['seed']=normalize_seed(raw.get('seed'))
    result['printMode']=raw.get('printMode','color')
    if result['printMode'] not in ('color','mono'):raise ValueError('invalid printMode')
    color=raw.get('monoColor',DEFAULT_PALETTE[0])
    if not isinstance(color,str) or not re.fullmatch(r'#[0-9a-fA-F]{6}',color):raise ValueError('invalid monoColor')
    result['monoColor']=color.upper()
    states=raw.get('households')
    if not isinstance(states,dict) or set(states)!=set(result['households']):
        raise ValueError('configuration must contain exactly the 40 household ids')
    for key in sorted_household_ids():
        state=states[key]
        if not isinstance(state,dict) or state.get('sash') not in SASH_STATES or state.get('ac') not in AC_STATES:
            raise ValueError(f'invalid state for {key}')
        result['households'][key]=resolve_state(result['seed'],key,state)
    return result


def configuration_parts(base,households,config):
    config=normalize_configuration(config);parts=[base]
    for key,state in config['households'].items():
        for name,_mat in selected_layers(state):parts.extend(households[key][name])
    label=dong_label(config['dong'],monochrome=config['printMode']=='mono')
    if config['printMode']=='mono':parts.append(monochrome_marks())
    if label is not None:parts.append(label)
    return parts


def configuration_material_shape(base,households,config):
    return _configuration_colored(base,households,config,dong_label)


def option_material(shape,finish):
    return shape.set_properties(1,lambda _p,old:[2.0 if len(old) and old[0]==2 else float(finish)])


def _configuration_colored(base,households,config,label_builder,*,unfolded=False):
    config=normalize_configuration(config);parts=[base]
    for key,state in config['households'].items():
        for name,mat in selected_layers(state):parts.extend(option_material(shape,mat) for shape in households[key][name])
    label=label_builder(config['dong'],monochrome=config['printMode']=='mono')
    if config['printMode']=='mono':parts.append(monochrome_marks(unfolded=unfolded))
    if label is not None:parts.append(label)
    shape=union(parts).simplify(.0005)
    return materialized(shape,0) if config['printMode']=='mono' else shape


@lru_cache(maxsize=2)
def _unfolded_bundle(material=True):
    return unfolding.build(sys.modules[__name__],material)


def build_unfolded_layers(*,material=True):
    base,households,_meta=_unfolded_bundle(material)
    return base,households


def unfolded_dong_label(value,*,monochrome=False):
    shape=dong_label(value,monochrome=monochrome)
    return unfolding.transform(shape,unfolding.panels(BASE)[1]) if shape is not None else None


def monochrome_marks(*,unfolded=False):
    marks=[];planes=unfolding.panels(BASE)
    for side,pid in ((1,1),(-1,11)):
        shape=_extrude_x(jugong_symbol(),SIGN_EMBOSS_DEPTH).translate((51.535,SIGN_CENTER_U,LEVELS[8]+6.25))
        if side==-1:shape=shape.mirror((1,0,0))
        if unfolded:shape=unfolding.transform(shape,planes[pid])
        marks.append(materialized(shape,0))
    return union(marks)


def configuration_unfolded_material_shape(base,households,config):
    return _configuration_colored(base,households,config,unfolded_dong_label,unfolded=True)


def footprint_section(inset=0):
    section=md.CrossSection([np.asarray(unfolding.FOOTPRINT)])
    return section.offset(-inset,md.JoinType.Miter) if inset else section


def build_roof_part():
    # Insert at the original roof level, below the parapet already on the strip.
    slab=footprint_section(PANEL_THICKNESS+.20).extrude(1.60)
    parts,cuts,_=build_layers()
    equipment=[s for s in parts if unfolding.is_roof_equipment(s,ROOF)]
    details=[s for s in parts.window_details if s.bounding_box()[2]>=ROOF]
    roof_cuts=[s for s in cuts if s.bounding_box()[2]>=ROOF]
    plant=union([subtract(union(equipment),roof_cuts),*details])
    plant=plant^box(-60,60,-66,66,ROOF,ROOF+25)
    return union([slab,plant.translate((0,0,1.5-ROOF))]).simplify(.0005)


def build_base_part():
    slab=box(-60,60,-66,66,0,2.0)
    outer=footprint_section(PANEL_THICKNESS+.20)
    rim=(outer-outer.offset(-1.2,md.JoinType.Miter)).extrude(.85).translate((0,0,1.9))
    return union([slab,rim]).simplify(.0005)


def export_display_layers(base,households,root):
    root.mkdir(parents=True,exist_ok=True)
    base_name='base.stl'
    to_trimesh(base).export(root/base_name,file_type='stl')
    unfolded_base,unfolded_households=build_unfolded_layers(material=True)
    export_material_stl(unfolded_base,root/'unfolded_base_material.stl')
    roof=build_roof_part();base_part=build_base_part()
    to_trimesh(roof).export(root/'roof.stl',file_type='stl')
    to_trimesh(base_part).export(root/'base_part.stl',file_type='stl')
    metadata=dict(_unfolded_bundle(True)[2])
    metadata.update(base='unfolded_base_material.stl',roof='roof.stl',basePart='base_part.stl')
    export_material_stl(monochrome_marks(),root/'monochrome_marks.stl')
    export_material_stl(monochrome_marks(unfolded=True),root/'unfolded_monochrome_marks.stl')
    manifest=dict(schemaVersion=2,materials=MATERIALS,variantCatalog=CATALOG,
        printKit=metadata,households=[])
    for key in sorted_household_ids():
        source=households[key]
        item={name:source[name] for name in ('id','floor','line','estimated_unit','position','facade','unit_type')}
        item['selectionVolumes']=unfolding.selection_cells(item['floor'],item['line'],BASE)
        item['meshes']={}
        item['unfolded_meshes']={}
        for name in LAYER_NAMES:
            path=root/f'{key}_{name}.stl'
            export_material_stl(union([option_material(shape,0) for shape in source[name]]).simplify(.0005),path)
            item['meshes'][name]=dict(file=path.name,solid_count=len(source[name]))
            unfolded_source=unfolded_households[key][name]
            unfolded_path=root/f'{key}_unfolded_{name}.stl'
            export_material_stl(union([option_material(shape,0) for shape in unfolded_source]).simplify(.0005),unfolded_path)
            item['unfolded_meshes'][name]=dict(file=unfolded_path.name,solid_count=len(unfolded_source))
        manifest['households'].append(item)
    (root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    return manifest


def to_trimesh(shape):
    assert shape.status()==md.Error.NoError,shape.status()
    # Round through STL precision before export so collapsed float32 edges are
    # removed by Manifold while all material properties remain attached.
    shape=md.Manifold(shape.to_mesh())
    assert shape.status()==md.Error.NoError,shape.status()
    raw=shape.to_mesh64()
    t=trimesh.Trimesh(vertices=np.asarray(raw.vert_properties)[:,:3],faces=np.asarray(raw.tri_verts),process=True)
    t.fix_normals(multibody=False)
    return t


def material_mesh(shape):
    """Return indexed geometry and one exact material index per triangle."""
    assert shape.status()==md.Error.NoError,shape.status()
    # Round through STL precision before export so collapsed float32 edges are
    # removed by Manifold while all material properties remain attached.
    shape=md.Manifold(shape.to_mesh())
    assert shape.status()==md.Error.NoError,shape.status()
    raw=shape.to_mesh64()
    vertices=np.asarray(raw.vert_properties,dtype=np.float64)
    faces=np.asarray(raw.tri_verts,dtype=np.int64)
    assert vertices.shape[1]>=4,'material property channel is missing'
    corner=np.rint(vertices[faces,3]).astype(np.int64)
    assert np.all(corner==corner[:,:1]),'a face crosses a material boundary'
    materials=corner[:,0]
    assert np.all((0<=materials)&(materials<len(MATERIALS)))
    return vertices[:,:3],faces,materials


def export_material_stl(shape,path):
    """Binary STL for the viewer; the standard attribute word carries slot 0..3."""
    vertices,faces,materials=material_mesh(shape)
    mesh=trimesh.Trimesh(vertices=vertices,faces=faces,process=False)
    header=b'Dunchon Jugong material-index STL; attr word = 0..3'.ljust(80,b' ')
    with Path(path).open('wb') as handle:
        handle.write(header)
        handle.write(struct.pack('<I',len(faces)))
        for normal,face,material in zip(mesh.face_normals,faces,materials):
            values=[*normal,*vertices[face[0]],*vertices[face[1]],*vertices[face[2]]]
            handle.write(struct.pack('<12fH',*values,int(material)))
    return dict(file=Path(path).name,triangles=len(faces),materials={
        MATERIALS[i]['key']:int(np.count_nonzero(materials==i)) for i in range(4)})


def write_color_3mf(shape,path,config,title=None):
    """Write one fused, watertight 3MF whose every face references one of 4 slots."""
    path=Path(path)
    vertices,faces,materials=material_mesh(shape)
    palette=normalize_palette(config.get('palette'))
    mono=config.get('printMode')=='mono'
    output_materials=MATERIALS[:1] if mono else MATERIALS
    if mono:materials=np.zeros_like(materials);palette=[config['monoColor']]
    bases=''.join(f'<base name={quoteattr(item["name"])} displaycolor={quoteattr(color+"FF")}/>'
                  for item,color in zip(output_materials,palette))
    vertex_xml=''.join(f'<vertex x="{x:.9f}" y="{y:.9f}" z="{z:.9f}"/>'
                       for x,y,z in vertices)
    face_xml=''.join(f'<triangle v1="{a}" v2="{b}" v3="{c}" pid="1" p1="{m}" p2="{m}" p3="{m}"/>'
                     for (a,b,c),m in zip(faces,materials))
    safe_title=escape(title or (f'둔촌주공 {config["dong"] or "미지정"}동 {"단색 양각" if config["printMode"]=="mono" else "4색"} 구성'))
    metadata=escape(json.dumps(config,ensure_ascii=False,separators=(',',':')))
    model=(f'<?xml version="1.0" encoding="UTF-8"?>'
           f'<model unit="millimeter" xml:lang="ko-KR" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
           f'<metadata name="Title">{safe_title}</metadata>'
           f'<metadata name="Application">Dunchon Jugong material exporter</metadata>'
           f'<metadata name="https://lqez.github.io/sandbox-games/jugong/configuration">{metadata}</metadata>'
           f'<resources><basematerials id="1">{bases}</basematerials>'
           f'<object id="2" type="model" name="fused configuration"><mesh>'
           f'<vertices>{vertex_xml}</vertices><triangles>{face_xml}</triangles>'
           f'</mesh></object></resources><build><item objectid="2"/></build></model>')
    types=('<?xml version="1.0" encoding="UTF-8"?>'
           '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
           '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
           '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
           '</Types>')
    rels=('<?xml version="1.0" encoding="UTF-8"?>'
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
          '<Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
          '</Relationships>')
    path.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        archive.writestr('[Content_Types].xml',types)
        archive.writestr('_rels/.rels',rels)
        archive.writestr('3D/3dmodel.model',model)
    return dict(file=path.name,unit='millimeter',objects=1,triangles=len(faces),
                material_slots=len(output_materials),material_triangles={MATERIALS[i]['key']:int(np.count_nonzero(materials==i)) for i in range(len(output_materials))},
                file_bytes=path.stat().st_size)


def export_checked(shape,path):
    t=to_trimesh(shape.simplify(.0005))
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
    p.add_argument('--monochrome',action='store_true',help='one print material and 0.65 mm raised marks/numerals')
    p.add_argument('--configuration',type=Path,
                   help='schemaVersion 1 JSON; emits one fused STL for that household selection')
    p.add_argument('--color-3mf',type=Path,
                   help='also emit the selected configuration as a fused four-material 3MF')
    p.add_argument('--print-kit',action='store_true',
                   help='emit flat facade strip plus separate keyed roof/base print parts')
    args=p.parse_args()
    if args.scale<=0:p.error('--scale must be positive')
    out=Path(args.output).resolve();out.parent.mkdir(parents=True,exist_ok=True)
    base,households=build_base()
    report=[]
    if args.configuration:
        config=normalize_configuration(json.loads(args.configuration.read_text(encoding='utf-8')))
        if args.monochrome:config['printMode']='mono'
        m=union(configuration_parts(base,households,config)).scale((args.scale,)*3)
        r=export_checked(m,out);r.update(configuration=config)
        report.append(r);print(json.dumps(r,ensure_ascii=False),flush=True)
    else:
        configs=[(0,0),(1,0),(0,1),(1,1)] if args.all_variants else [(int(args.show_balcony_sashes),int(args.show_ac_brackets))]
        for sh,ac in configs:
            config=default_configuration()
            if args.monochrome:config['printMode']='mono'
            for state in config['households'].values():
                state['sash']='full' if sh else 'none'
                state['ac']='bracket' if ac else 'none'
            m=union(configuration_parts(base,households,config)).scale((args.scale,)*3)
            suffix='' if (sh,ac)==(0,0) or not args.all_variants else ('_sashes' if sh else '')+('_ac_brackets' if ac else '')
            path=out.with_stem(out.stem+suffix)
            r=export_checked(m,path);r.update(external_sashes=bool(sh),ac_brackets=bool(ac),
                compatibility='all 40 households: full sash / empty rack')
            report.append(r);print(json.dumps(r,ensure_ascii=False),flush=True)
    if args.all_variants:
        # Addressable display layers are embedded by scripts/build_viewer.py.
        work=out.parent.parent/'work'
        work.mkdir(parents=True,exist_ok=True)
        layer_root=work/'configurator'
        export_display_layers(base,households,layer_root)
        material_base,material_households=build_material_base()
        color_stl=export_material_stl(material_base,layer_root/'base_material.stl')
        default_3mf=write_color_3mf(material_base,out.parent/'jugong_10f_four_color.3mf',default_configuration())
        report.append({'four_color_viewer_mesh':color_stl,'four_color_3mf':default_3mf})
        report_text=json.dumps(report,indent=2)+'\n'
        (work/'model_validation.json').write_text(report_text)
        validation=out.parent.parent/'validation'
        validation.mkdir(parents=True,exist_ok=True)
        (validation/'model_validation.json').write_text(report_text)
    if args.color_3mf:
        material_base,material_households=build_material_base()
        color_config=(normalize_configuration(json.loads(args.configuration.read_text(encoding='utf-8')))
                      if args.configuration else default_configuration())
        if args.monochrome:color_config['printMode']='mono'
        colored=configuration_material_shape(material_base,material_households,color_config).scale((args.scale,)*3)
        print(json.dumps(write_color_3mf(colored,args.color_3mf,color_config),ensure_ascii=False),flush=True)
    if args.print_kit or args.all_variants:
        flat_base,flat_households=build_unfolded_layers(material=True)
        flat_config=(normalize_configuration(json.loads(args.configuration.read_text(encoding='utf-8')))
                     if args.configuration else default_configuration())
        if args.monochrome:flat_config['printMode']='mono'
        flat=configuration_unfolded_material_shape(flat_base,flat_households,flat_config).scale((args.scale,)*3)
        facade_path=out.parent/'jugong_10f_facade_strip.stl'
        facade_3mf=out.parent/'jugong_10f_facade_strip_four_color.3mf'
        roof_path=out.parent/'jugong_10f_roof.stl';base_path=out.parent/'jugong_10f_base.stl'
        kit_report={
            'facade_strip':export_checked(flat,facade_path),
            'facade_strip_3mf':write_color_3mf(flat,facade_3mf,flat_config,'둔촌주공 입체 보존 12면 파사드 스트립'),
            'roof':export_checked(build_roof_part().scale((args.scale,)*3),roof_path),
            'base':export_checked(build_base_part().scale((args.scale,)*3),base_path),
            'panel_order':PANEL_ORDER,'panel_widths_mm':PANEL_WIDTHS,
            'panel_thickness_mm':PANEL_THICKNESS,'hinge_skin_mm':HINGE_SKIN,
            'hinge_gap_mm':unfolding.GAP, 'folds':len(PANEL_ORDER)-1,
        }
        print(json.dumps(kit_report,ensure_ascii=False),flush=True)
        validation=out.parent.parent/'validation';validation.mkdir(parents=True,exist_ok=True)
        (validation/'print_kit_validation.json').write_text(json.dumps(kit_report,ensure_ascii=False,indent=2)+'\n')


if __name__=='__main__':main()
