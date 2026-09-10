"""Condensed painted sign outlines, traced from the user's 324 / 303 photos.

Coordinates are top-down, normalized by cap height, without camera shear.
Only 0/2/3/4 are directly evidenced; other digits use the model's fallback.
Dimensions use adjacent floor spacing and small-window width, not the raw
perspective-distorted image aspect. These are photo estimates, not surveys.
"""
import re
import numpy as np
import manifold3d as md

SIGN_HEIGHT=5.3
SIGN_GAP=.105
SIGN_MAX_WIDTH=10.8
SIGN_CENTER_U=-41.2
SIGN_PAINT_DEPTH=.025
SIGN_MARGIN_X=.85
SIGN_MARGIN_Z=2.0
MARK_WIDTH=8.6
MARK_HEIGHT=MARK_WIDTH
MARK_PANEL=(10.6,10.6)
SIGN_EMBOSS_DEPTH=.65

# Filled outlines retain flat cut terminals and the closed triangular 4 counter.
PATHS={
 '3':('M0 28 L0 22 C0 8 8 0 23 0 C38 0 46 9 46 24 L46 34 C46 42 43 47 38 50 C44 54 47 61 47 71 L47 77 C47 92 39 100 23 100 C8 100 0 92 0 77 L0 68 L15 68 L15 78 C15 84 17 87 23 87 C29 87 31 84 31 77 L31 67 C31 59 28 56 19 56 L17 56 L17 43 L20 43 C29 43 31 39 31 33 L31 24 C31 17 28 14 23 14 C17 14 15 17 15 23 L15 28 Z', .44),
 '2':('M0 33 L0 24 C0 8 8 0 23 0 C38 0 48 9 48 26 C48 45 39 55 28 68 L18 82 L17 86 L48 86 L48 100 L1 100 L1 88 C1 76 9 66 20 53 C28 43 32 37 32 26 C32 18 29 14 23 14 C17 14 15 18 15 25 L15 33 Z', .44),
 '4':('M25 1 L43 1 L43 66 L52 66 L52 81 L43 81 L43 100 L28 100 L28 81 L0 81 L0 66 Z M16 66 L28 66 L28 33 Z', .48),
 '0':('M23 0 C7 0 0 11 0 28 L0 72 C0 90 7 100 23 100 C39 100 46 90 46 72 L46 28 C46 11 39 0 23 0 Z M23 14 C29 14 31 18 31 28 L31 72 C31 82 29 86 23 86 C17 86 15 82 15 72 L15 28 C15 18 17 14 23 14 Z', .44),
}


def contour(path):
    tokens=re.findall(r'[MLCZ]|-?\d+(?:\.\d+)?',path);i=0;polys=[];points=[];current=np.zeros(2)
    while i<len(tokens):
        cmd=tokens[i];i+=1
        if cmd=='Z':polys.append(points);points=[];continue
        n=6 if cmd=='C' else 2;v=np.array(list(map(float,tokens[i:i+n]))).reshape(-1,2);i+=n
        if cmd in ('M','L'):current=v[0];points.append(current.tolist())
        else:
            a=current.copy();b,c,d=v
            for t in np.linspace(0,1,13)[1:]:points.append(((1-t)**3*a+3*(1-t)**2*t*b+3*(1-t)*t*t*c+t**3*d).tolist())
            current=d
    return polys


def traced_digit(char):
    if char not in PATHS:return None
    path,width=PATHS[char];polys=contour(path);extent=max(p[0] for poly in polys for p in poly)
    return md.CrossSection([[(x/extent*width,1-y/100) for x,y in poly] for poly in polys],md.FillRule.EvenOdd),width


def symbol():
    """LHRI printed p29: circular negative mark, flat roof and pointed doorway.

    Normalized source grid is in references/knhc-logo; unlike the perspective
    apartment photos, the publication shows the true 1:1 outer proportion.
    """
    radius=MARK_WIDTH/2
    circle=md.CrossSection.circle(radius,128)
    house=[(-.39,.56),(.39,.56),(.84,-.03),(.56,-.03),(.56,-.60),
           (.17,-.60),(.17,.22),(0,.44),(-.17,.22),(-.17,-.60),
           (-.56,-.60),(-.56,-.03),(-.84,-.03)]
    return circle-md.CrossSection([[(x*radius,y*radius) for x,y in house]],md.FillRule.NonZero)
