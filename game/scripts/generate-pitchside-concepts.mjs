/**
 * Fal / GPT-Image-2 concept art for two pitchside props — the players' TUNNEL
 * and the team DUGOUT/BENCH — to drive Meshy image-to-3D replacements that look
 * more realistic than the current models.
 * Output: game/.tmp/pitchside-concept/<key>.png (+ a contact sheet).
 * Run: node scripts/generate-pitchside-concepts.mjs
 */
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { download, falQueue, findUrl } from '../../tools/asset-pipeline/common.mjs';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp/pitchside-concept');
const MODEL = 'openai/gpt-image-2';

const BASE = [
  'Concept art for a SINGLE isolated 3D GAME ASSET prop on a plain pale neutral studio background.',
  'Clean three-quarter FRONT view from the pitch side, centered, the whole prop visible with generous margin, slight elevation.',
  'Even neutral studio lighting, soft contact shadow. Realistic broadcast-football look but clean, simple readable forms suitable for converting to a low-poly 3D model.',
  'No people, no crowd, no pitch markings, no text, no logos, no watermark, no extra scenery.',
].join(' ');

const VARIANTS = [
  ['tunnel_a', 'Subject: a modern retractable STADIUM PLAYERS\' TUNNEL — a low wide telescopic concertina tunnel of dark anthracite metal ribs and translucent smoked-glass panels, a clean illuminated arched mouth surround with a thin cool-white LED rim, dark recessed interior, short grass apron in front. Sleek, premium, broadcast-realistic.'],
  ['tunnel_b', 'Subject: a modern STADIUM PLAYERS\' TUNNEL built into a clean concrete-and-steel stand base, a wide rounded rectangular mouth with brushed-aluminium frame and a soft blue LED surround glow, dark recessed interior, low and wide proportions. Understated and realistic.'],
  ['dugout_a', 'Subject: a modern football TEAM DUGOUT / technical-area bench — a long low curved shelter with a clear smoked polycarbonate wrap-around roof and back on a dark anthracite metal frame, a single row of about ten black padded bucket seats facing forward, open front facing the pitch. Sleek Premier-League-style, broadcast-realistic.'],
  ['dugout_b', 'Subject: a modern football TEAM DUGOUT bench shelter — gently curved transparent roof on slim dark posts, a row of ~10 dark grey padded stadium seats, low wide proportions, clean metal-and-glass construction, open toward the pitch. Premium and realistic.'],
];

await fs.mkdir(OUT, { recursive: true });
let next = 0;
await Promise.all([0, 1, 2, 3].map(worker));
try {
  execFileSync('python3', ['-c', `
from PIL import Image; import glob
fs=sorted(glob.glob('${OUT}/*.png'))
fs=[f for f in fs if '_sheet' not in f]
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
      const r = await falQueue(MODEL, { prompt: `${BASE} ${desc}`, image_size: 'square_hd', num_images: 1, quality: 'high', output_format: 'png' }, { pollMs: 3000, timeoutMs: 900000 });
      const url = findUrl(r, ['png', 'jpg', 'jpeg', 'webp']) || findUrl(r, []);
      if (!url) throw new Error('no image url');
      await download(url, path.join(OUT, `${key}.png`));
      console.log('generated', key);
    } catch (e) { console.error('failed', key, e.message); }
  }
}
