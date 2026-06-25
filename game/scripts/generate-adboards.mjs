/**
 * Fal / GPT-Image-2 fictional parody-sponsor advertising banners for the pitchside
 * LED boards (made-up brands that evoke real categories — cola, sportswear, etc. —
 * WITHOUT copying any real logo or trademark). Tiles are composited into one long
 * strip at game/public/assets/ui/adboards.png.
 * Run: node scripts/generate-adboards.mjs [--force]
 */
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS, download, falQueue, findUrl } from '../../tools/asset-pipeline/common.mjs';

const RAW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp/adboards-raw');
const OUT = path.join(ASSETS, 'ui', 'adboards.png');
const MODEL = 'openai/gpt-image-2';
const force = process.argv.includes('--force');

const SHARED = [
  'A single pitchside LED advertising hoarding banner for a FICTIONAL, made-up sponsor brand.',
  'Clean modern flat advertising design: a bold invented wordmark/logo and a short punchy slogan, bright saturated brand colours, high contrast and very readable.',
  'It should evoke the GENERAL look of its product category but must NOT copy, trace or resemble any real company\'s actual logo, trademark, exact wording or brand identity.',
  'Composition: horizontal banner, the logo and text centred and filling the frame, plain simple background, no people, no photos, no watermark, no real brand names.',
].join(' ');

const ADS = [
  ['kola_pop', "Brand 'KOLA-POP', a fizzy cola drink. Red and white, energetic, bubbles motif."],
  ['pepz', "Brand 'PEPZ MAX', a cola soft drink. Deep blue with a red accent, bold sporty."],
  ['adibas', "Brand 'ADIBAS', a sportswear maker. Black and white, three angled bars motif, athletic."],
  ['redox', "Brand 'REDOX ENERGY', an energy drink. Blue and silver with red, dynamic charging-bull-free abstract."],
  ['sansung', "Brand 'SANSUNG', a consumer electronics company. Clean blue and white, modern tech."],
  ['gulfjet', "Brand 'GULF JET AIRWAYS', an airline. Maroon and gold, elegant, a stylised wing."],
  ['betfrenzy', "Brand 'BETFRENZY', a sports betting company. Green and black with neon, bold."],
  ['viso', "Brand 'VISO PAY', a payment card network. Royal blue and gold, sleek financial look."],
];

await fs.mkdir(RAW, { recursive: true });
await fs.mkdir(path.dirname(OUT), { recursive: true });
let next = 0;
await Promise.all([0, 1].map(worker));

// composite the tiles into one long strip (each cropped to a wide banner)
execFileSync('python3', ['-c', `
from PIL import Image
import glob, os
raw='${RAW}'
keys=${JSON.stringify(ADS.map((a) => a[0]))}
tiles=[]
TW,TH=640,240
for k in keys:
    p=os.path.join(raw,k+'.png')
    if not os.path.exists(p): continue
    im=Image.open(p).convert('RGB')
    w,h=im.size
    # centre-crop to a wide 8:3 banner then resize
    bw,bh=w, int(w*TH/TW)
    if bh>h: bh=h; bw=int(h*TW/TH)
    im=im.crop(((w-bw)//2,(h-bh)//2,(w-bw)//2+bw,(h-bh)//2+bh)).resize((TW,TH),Image.Resampling.LANCZOS)
    tiles.append(im)
if tiles:
    strip=Image.new('RGB',(TW*len(tiles),TH),(12,16,22))
    for i,t in enumerate(tiles): strip.paste(t,(i*TW,0))
    strip.save('${OUT}')
    print('adboards strip', strip.size, '->', '${OUT}')
else:
    print('no tiles generated')
`], { stdio: 'inherit' });

async function worker() {
  for (;;) {
    const ad = ADS[next++];
    if (!ad) return;
    const [key, desc] = ad;
    const dest = path.join(RAW, `${key}.png`);
    if (!force) { try { await fs.access(dest); console.log('skip', key); continue; } catch {} }
    try {
      const r = await falQueue(MODEL, { prompt: `${SHARED} Brand: ${desc}`, image_size: 'landscape_16_9', num_images: 1, quality: 'high', output_format: 'png' }, { pollMs: 3000, timeoutMs: 900000 });
      const url = findUrl(r, ['png', 'jpg', 'jpeg', 'webp']) || findUrl(r, []);
      if (!url) throw new Error('no image url');
      await download(url, dest);
      console.log('generated', key);
    } catch (e) { console.error('failed', key, e.message); }
  }
}
