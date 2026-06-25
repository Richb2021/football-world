/**
 * Builds head-and-shoulders phone/press avatars for the STORY (journey) cast by
 * cropping the head region out of each full-body character sprite. This reuses
 * the existing story art so every journey phone contact shows the right face
 * (Mia looks like Mia, the agent like the agent, etc.) instead of a generic
 * stand-in. Output: public/assets/avatars/journey/<seed>.png (square, 300px,
 * transparent — the circular avatar frame crops it).
 * Run: node scripts/crop-journey-avatars.mjs
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public/assets');
// seed (avatarSeed used in phone messages / NPC id) -> source full-body sprite
const MAP = {
  sister_mia: 'journey/characters/sister_mia.png',
  dad: 'journey/characters/dad_casual.png',
  mentor_okafor: 'journey/characters/mentor_okafor.png',
  pundit_grady: 'journey/characters/pundit_grady.png',
  physio_lane: 'journey/characters/physio_lane.png',
  rival_dane: 'journey/characters/rival_dane.png',
  national_manager_strand: 'journey/characters/national_manager_strand.png',
  germany_captain_adler: 'journey/characters/germany_defender.png',
  agent_rival_sharpe: 'journey/characters/agent_rival_sharpe.png',
  manager_clough: 'journey/characters/manager_overcoat.png',
  doctor_evans: 'journey/characters/physio_bag.png',
  reporter_local: 'journey/characters/reporter_notepad.png',
  captain_whitlock: 'journey/characters/captain_red_kit.png',
  england_roommate_fox: 'journey/characters/young_teammate_red_kit.png',
  teammate_reyes: 'journey/characters/rival_training_top.png',
  ty_coach_bell: 'journey/characters/ty_coach_bell.png',
  chairman_voss: 'journey/characters/chairman_voss.png',
  ld_daughter_lina: 'journey/characters/ld_daughter_lina.png',
  tp_grandmother_ana: 'journey/characters/tp_grandmother_ana.png',
};

const py = `
import os, numpy as np
from PIL import Image
root=${JSON.stringify(root)}
MAP=${JSON.stringify(MAP)}
outdir=os.path.join(root,'avatars','journey')
os.makedirs(outdir,exist_ok=True)
OUT=300
for seed,src in MAP.items():
    p=os.path.join(root,src)
    if not os.path.exists(p):
        print('MISSING',src); continue
    im=Image.open(p).convert('RGBA')
    a=np.asarray(im)[...,3]
    ys,xs=np.where(a>24)
    if len(xs)==0:
        print('empty',seed); continue
    l,r,t,b=xs.min(),xs.max(),ys.min(),ys.max()
    fw=r-l+1; fh=b-t+1
    cx=(l+r)/2.0
    # head+shoulders square: side ~ shoulder width, anchored at the top of the figure
    side=min(fw*1.18, fh*0.5)
    top=max(0, int(t - side*0.04))
    left=int(cx - side/2)
    side=int(side)
    # clamp horizontally
    left=max(0, min(left, im.width-side))
    crop=im.crop((left, top, left+side, top+side)).resize((OUT,OUT), Image.Resampling.LANCZOS)
    crop.save(os.path.join(outdir, seed+'.png'))
    print('cropped',seed, crop.size)
print('done')
`;
execFileSync('python3', ['-c', py], { stdio: 'inherit' });
