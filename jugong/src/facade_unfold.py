"""Rigid unfolding of the actual twelve wall planes; attachments retain depth.

No balcony/window surrogate is generated here. Every source attachment is
assigned to its original wall plane, then transformed with an orthonormal
matrix. Narrow flexible links connect adjacent panels for one-piece printing.
"""
import math
import numpy as np

FOOTPRINT=((-51.5,-53.75),(51.5,-53.75),(51.5,-9.75),(28.5,-9.75),
           (28.5,2.25),(44,2.25),(44,53.75),(-44,53.75),(-44,2.25),
           (-28.5,2.25),(-28.5,-9.75),(-51.5,-9.75))
NAMES=('front','right_front','right_front_return','right_core','right_rear_return','right_rear',
       'back','left_rear','left_rear_return','left_core','left_front_return','left_front')
WALL=2.2
GAP=1.6
SKIN=.45


def panels(base=2.4):
    out=[];cursor=0.
    for i,(a,b) in enumerate(zip(FOOTPRINT,FOOTPRINT[1:]+FOOTPRINT[:1])):
        a=np.array(a);b=np.array(b);length=float(np.linalg.norm(b-a));t=(b-a)/length;n=np.array((t[1],-t[0]))
        matrix=np.array(((t[0],t[1],0,cursor-np.dot(t,a)),(0,0,1,-base),(n[0],n[1],0,WALL-np.dot(n,a))))
        out.append(dict(id=i,name=NAMES[i],origin=a.tolist(),tangent=t.tolist(),normal=n.tolist(),width=length,start=cursor,matrix=matrix.tolist()))
        cursor+=length+GAP
    total=cursor-GAP
    for p in out:p['start']-=total/2;p['matrix'][0][3]-=total/2
    return out


def panel_for(shape,registry,items):
    owner=registry.get(shape)
    if owner:
        point,normal=owner
        return next((p for p in items if np.allclose(p['normal'],normal,atol=1e-6) and abs(np.dot(normal,np.array(p['origin'])-point))<1e-5),None)
    bounds=np.array(shape.bounding_box()).reshape(2,3);c=bounds.mean(axis=0);choices=[]
    for p in items:
        q=c[:2]-p['origin'];u=float(np.dot(q,p['tangent']));d=float(np.dot(q,p['normal']))
        if -.5<=u<=p['width']+.5 and -WALL<=d<=30:choices.append((abs(d),p['id'],p))
    return min(choices,key=lambda x:x[:2])[2] if choices else None


def transform(shape,p):return shape.transform(p['matrix'])


def inverse_points(points,p,base=2.4):
    points=np.asarray(points);r=np.asarray(p['matrix'])[:,:3];offset=np.asarray(p['matrix'])[:,3]
    return (points-offset)@r


def is_roof_equipment(shape,roof):
    b=np.asarray(shape.bounding_box());extent=b[3:]-b[:3]
    return b[2]>=roof-.20 and b[5]>roof and not (extent[2]<=6.1 and min(extent[:2])<=1.6 and max(extent[:2])>10)


def build(m,material=True):
    source,cuts,households=m.build_layers();registry=dict(m.FACADE_SOURCES);items=panels(m.BASE)
    height=m.ROOF+5.9-m.BASE;attached={p['id']:[] for p in items};cutters={p['id']:[] for p in items}
    preserved=[]
    for shape in cuts:
        p=panel_for(shape,registry,items)
        if p:cutters[p['id']].append(transform(m.materialized(shape,0),p))
    for shapes,mats in ((source[3:],source.materials[3:]),(source.window_details,source.window_details.materials)):
        for shape,mat in zip(shapes,mats):
            bounds=shape.bounding_box()
            if bounds[5]<=m.BASE+.01 or is_roof_equipment(shape,m.ROOF):continue
            p=panel_for(shape,registry,items)
            if not p:continue  # lift plant and freestanding roof equipment remain in roof part
            moved=transform(m.materialized(shape,m.MATERIAL_INDEX[mat]),p)
            attached[p['id']].append(moved)
            preserved.append(dict(panel=p['id'],volume=shape.volume(),transformed_volume=moved.volume()))
    result=[]
    for p in items:
        wall=m.materialized(m.box(p['start'],p['start']+p['width'],0,height,0,WALL),0)
        result.append(m.union([m.subtract(wall,cutters[p['id']]),*attached[p['id']]]))
    # Thin back webs flex while the twelve facade panels remain rigid. The
    # opening gap prevents an overhanging canopy from welding adjacent panels.
    for p in items[:-1]:
        seam=p['start']+p['width'];result.append(m.materialized(m.box(seam-.15,seam+GAP+.15,0,height,0,SKIN),0))
    flat={key:{name:[] for name in m.LAYER_NAMES} for key in households}
    ownership={key:{} for key in households}
    for key,h in households.items():
        for name in m.LAYER_NAMES:
            ownership[key][name]=[]
            for shape in h[name]:
                p=panel_for(shape,registry,items)
                assert p is not None,(key,name,shape.bounding_box())
                flat[key][name].append(transform(shape,p));ownership[key][name].append(p['id'])
    base_shape=m.union(result).simplify(.0005)
    if not material:base_shape=m.materialized(base_shape,0)
    metadata=dict(panels=items,panelOrder=list(NAMES),panelWidths=[p['width'] for p in items],
        panelThickness=WALL,hingeSkin=SKIN,hingeGap=GAP,facadeHeight=height,
        totalWidth=items[-1]['start']+items[-1]['width']-items[0]['start'],
        folds=len(items)-1,foldAngles=[round(math.degrees(math.atan2(a['tangent'][0]*b['tangent'][1]-a['tangent'][1]*b['tangent'][0],np.dot(a['tangent'],b['tangent'])))) for a,b in zip(items,items[1:])],
        preservedAttachmentCount=len(preserved),maxVolumeDelta=max(abs(r['volume']-r['transformed_volume']) for r in preserved),
        householdPanelIds={key:sorted({i for ids in h.values() for i in ids}) for key,h in ownership.items()})
    return base_shape,flat,metadata


def selection_cells(floor,line,base=2.4):
    """Actual unit footprint plus projecting bays; common stair core excluded."""
    z=base+6.5+(floor-1)*14-.35;top=z+14
    if line in ('A','B'):
        ranges=[((0,-53.75),(51.5,-9.75)),((0,-61.55),(38.1,-53.65)),
                ((40,-57.6),(49.8,-53.65)),((51.4,-31.1),(55.5,-21.9))]
    else:
        ranges=[((0,2.25),(44,53.75)),((43.9,2.25),(51.8,40.4)),
                ((43.9,42.5),(48.0,51.3)),((11.0,53.65),(20.1,57.6))]
    folded=[]
    for lo,hi in ranges:
        a=[lo[0],lo[1],z];b=[hi[0],hi[1],top]
        if line in ('A','C'):a[0],b[0]=-b[0],-a[0]
        folded.append([a,b])
    ids={'A':(0,10,11),'B':(0,1,2),'C':(6,7,8),'D':(4,5,6)}[line]
    flat=[]
    for p in panels(base):
        if p['id'] not in ids:continue
        for lo,hi in folded:
            vertices=np.array([[x,y,h,1] for x in (lo[0],hi[0]) for y in (lo[1],hi[1]) for h in (lo[2],hi[2])])
            moved=vertices@np.asarray(p['matrix']).T;a=moved.min(axis=0);b=moved.max(axis=0)
            a[0]=max(a[0],p['start']);b[0]=min(b[0],p['start']+p['width']);a[2]=max(0,a[2])
            if np.all(b-a>.01):flat.append([a.tolist(),b.tolist()])
    return dict(folded=folded,unfolded=flat)
