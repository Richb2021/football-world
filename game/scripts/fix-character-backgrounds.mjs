#!/usr/bin/env node
/**
 * Some generated character sprites came back on a flat WHITE studio background
 * instead of the #00ff00 chroma key, so the green-key left an opaque box behind
 * them. This removes that background with a border flood-fill (only near-white /
 * already-transparent pixels CONNECTED to the frame edge are cleared, so white
 * clothing in the interior is preserved), then re-fits the figure into the
 * sprite canvas. Idempotent and safe on already-clean cutouts.
 * Run: node scripts/fix-character-backgrounds.mjs
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public/assets/journey/characters');
const py = `
import sys, glob, os
import numpy as np
from collections import deque
from PIL import Image

CANVAS=(280,380)
def is_bglike(r,g,b,a):
    return a < 28 or (min(r,g,b) > 198 and (max(r,g,b)-min(r,g,b)) < 42)

changed=0
for f in sorted(glob.glob(os.path.join(${JSON.stringify(dir)}, '*.png'))):
    if 'character_sheet' in f: continue
    im=Image.open(f).convert('RGBA')
    a=np.asarray(im).astype(np.int16)
    h,w=a.shape[:2]
    r,g,b,al=a[...,0],a[...,1],a[...,2],a[...,3]
    bglike=((al<28)|((np.minimum(np.minimum(r,g),b)>198)&((np.maximum(np.maximum(r,g),b)-np.minimum(np.minimum(r,g),b))<42)))
    # flood from border through bglike pixels
    bg=np.zeros((h,w),bool)
    dq=deque()
    for x in range(w):
        for y in (0,h-1):
            if bglike[y,x] and not bg[y,x]: bg[y,x]=True; dq.append((y,x))
    for y in range(h):
        for x in (0,w-1):
            if bglike[y,x] and not bg[y,x]: bg[y,x]=True; dq.append((y,x))
    while dq:
        y,x=dq.popleft()
        for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
            ny,nx=y+dy,x+dx
            if 0<=ny<h and 0<=nx<w and not bg[ny,nx] and bglike[ny,nx]:
                bg[ny,nx]=True; dq.append((ny,nx))
    out=np.asarray(im).copy()
    before=int((out[...,3]<16).sum())
    out[bg,3]=0
    after=int((out[...,3]<16).sum())
    # only rewrite if we actually cleared a meaningful background
    if after-before < 1500:
        continue
    res=Image.fromarray(out,'RGBA')
    bbox=res.getchannel('A').getbbox()
    if bbox: res=res.crop(bbox)
    tw,th=CANVAS
    scale=min((tw*0.88)/res.width,(th*0.96)/res.height)
    res=res.resize((max(1,round(res.width*scale)),max(1,round(res.height*scale))),Image.Resampling.LANCZOS)
    canvas=Image.new('RGBA',CANVAS,(0,0,0,0))
    canvas.alpha_composite(res,((tw-res.width)//2, th-res.height-2))
    canvas.save(f)
    changed+=1
    print('fixed', os.path.basename(f), 'cleared', after-before, 'px')
print('done, fixed', changed, 'characters')
`;
execFileSync('python3', ['-c', py], { stdio: 'inherit' });
