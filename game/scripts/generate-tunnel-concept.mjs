/**
 * Fal / GPT-Image-2 concept art for the pitchside PLAYERS' TUNNEL — the structure
 * the two teams emerge from between the benches before kickoff. This concept art
 * then drives a Meshy image-to-3D model.
 * Output: game/.tmp/tunnel-concept/tunnel_N.png (+ a contact sheet).
 * Run: node scripts/generate-tunnel-concept.mjs
 */
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { download, falQueue, findUrl } from '../../tools/asset-pipeline/common.mjs';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp/tunnel-concept');
const MODEL = 'openai/gpt-image-2';

const SHARED = [
  'Concept art for a single 3D GAME ASSET prop, presented in isolation on a plain pale neutral background.',
  'Subject: a modern football stadium PLAYERS\' TUNNEL — a wide, low, arched tunnel mouth that two teams of players walk out of onto the pitch, sited pitchside between the team dugouts.',
  'Design: sleek dark brushed-steel and frosted-glass frame with a clean LED-lit branded surround arch (NO readable text or logos), a dark recessed mouth, short grass apron in front.',
  'View: clean three-quarter FRONT view from the pitch side, centered, the whole prop visible with generous margin, slight elevation.',
  'Lighting: even neutral studio lighting, soft shadow, no harsh highlights.',
  'Style: realistic but clean, simple readable forms suitable for converting to a low-poly 3D model. No people, no crowd, no text, no logos, no watermark, no extra scenery.',
].join(' ');

const VARIANTS = [
  ['tunnel_1', 'Stadium grey concrete and steel arch with a thin blue LED rim and translucent side panels; understated and broadcast-realistic.'],
  ['tunnel_2', 'A bolder inflatable-style branded arch tunnel in dark navy with gold trim and a glowing entrance, like a cup-final walk-out tunnel.'],
];

await fs.mkdir(OUT, { recursive: true });
let next = 0;
await Promise.all([0, 1].map(worker));
// contact sheet
try {
  execFileSync('python3', ['-c', `
from PIL import Image; import glob,os
fs=sorted(glob.glob('${OUT}/*.png'))
if fs:
  c=520; sheet=Image.new('RGB',(c*len(fs),c),(28,32,40))
  for i,f in enumerate(fs):
    im=Image.open(f).convert('RGB'); im.thumbnail((c-12,c-12)); sheet.paste(im,(i*c+6,6))
  sheet.save('${OUT}/_sheet.png'); print('sheet',sheet.size)
`], { stdio: 'inherit' });
} catch {}

async function worker() {
  for (;;) {
    const v = VARIANTS[next++];
    if (!v) return;
    const [key, desc] = v;
    try {
      const r = await falQueue(MODEL, { prompt: `${SHARED} Variation: ${desc}`, image_size: 'square_hd', num_images: 1, quality: 'high', output_format: 'png' }, { pollMs: 3000, timeoutMs: 900000 });
      const url = findUrl(r, ['png', 'jpg', 'jpeg', 'webp']) || findUrl(r, []);
      if (!url) throw new Error('no image url');
      await download(url, path.join(OUT, `${key}.png`));
      console.log('generated', key);
    } catch (e) { console.error('failed', key, e.message); }
  }
}
