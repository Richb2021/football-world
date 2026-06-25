/**
 * Generates photo-realistic head-and-shoulders PORTRAIT avatars for the phone
 * inbox and the press conference panel (replacing the procedural SVG portraits).
 * Output: game/public/assets/avatars/<key>.png, square, ~360px, photographic.
 * These are shown small and circular-cropped, so a soft photo background is fine
 * (no chroma key needed).
 * Run: node scripts/generate-avatars.mjs            (skips existing)
 *      node scripts/generate-avatars.mjs --force    (regenerate all)
 *      node scripts/generate-avatars.mjs --only reporter_1,exec_ceo
 */
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS, download, falQueue, findUrl } from '../../tools/asset-pipeline/common.mjs';

const GAME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ROOT = path.join(ASSETS, 'avatars');
const RAW_ROOT = path.join(GAME_ROOT, '.tmp/avatars-raw');
const MODEL = 'openai/gpt-image-2';

const args = parseArgs(process.argv.slice(2));
const force = Boolean(args.force);
const only = new Set(String(args.only ?? 'all').split(',').map((s) => s.trim()).filter(Boolean));
const concurrency = Math.max(1, Math.min(Number(args.concurrency ?? 2) || 2, 4));

const SHARED = [
  'Photorealistic head-and-shoulders portrait photograph of a single fictional person.',
  'Modern day (2020s). Sharp focus on the face, person looking toward the camera, natural professional lighting, shallow depth of field, background softly blurred.',
  'Realistic skin texture and detail, candid sports-media / documentary photography style, dignified and grounded.',
  'Framing: square, face centered, head and shoulders only, no hands, not cropped at the chin or top of head.',
  'Constraints: completely fictional person, no resemblance to any real or famous individual, no logos, no badges, no sponsors, no readable text, no watermark, no border.',
].join(' ');

const ENTRIES = [
  // --- International Cup phone senders ---
  ['exec_ceo', 'A national football federation chief executive: distinguished man in his late 50s, short grey hair, dark tailored suit and tie, composed authoritative expression, official building softly blurred behind.'],
  ['agent_coyle', 'A football agent in his mid 40s: smooth confident half-smile, slicked dark hair, expensive open-collar shirt and blazer, charismatic and a little sharp.'],
  ['assistant_coach', 'An assistant football coach in his early 50s: weathered friendly face, short greying hair, team training jacket, whistle lanyard, blurred training ground behind.'],
  ['home_family', 'A proud working-class mother in her mid 50s: warm emotional smile, shoulder-length greying hair, simple cardigan, cosy home softly blurred behind, eyes a little teary with pride.'],
  ['old_teammate', 'A retired footballer in his mid 40s now a friendly everyman: short cropped hair, light stubble, casual quarter-zip top, relaxed loyal expression.'],
  ['pundit_tv', 'A television football pundit in his late 50s: opinionated raised eyebrow, neat grey hair, smart suit with pocket square, studio lighting, confident broadcaster look.'],
  // --- Press conference reporters (varied) ---
  ['reporter_1', 'A male sports journalist in his 30s: short brown hair, light stubble, smart navy jacket over open shirt, attentive expression, busy press room softly blurred behind.'],
  ['reporter_2', 'A female sports journalist in her early 30s: dark hair tied back, blazer, professional focused expression, holding a small audio recorder just out of frame, press room behind.'],
  ['reporter_3', 'An older male reporter in his 50s: balding with glasses, beige jacket, seasoned sceptical expression, notebook implied, press room behind.'],
  ['reporter_4', 'A young female reporter in her mid 20s: shoulder-length auburn hair, smart casual top, keen curious expression, press room softly blurred behind.'],
  ['reporter_5', 'A male reporter in his 40s with a short dark beard: smart grey shirt, lanyard press pass, thoughtful expression, press room behind.'],
  ['reporter_6', 'A female broadcast reporter in her late 30s: blonde bob, blazer, polished on-camera expression, press room lighting behind.'],
].filter(([key]) => only.has('all') || only.has(key));

await fs.mkdir(OUT_ROOT, { recursive: true });
await fs.mkdir(RAW_ROOT, { recursive: true });

console.log(`Avatar generation: ${ENTRIES.length} portraits via ${MODEL}, concurrency ${concurrency}`);
let generated = 0, skipped = 0, failed = 0, next = 0;
await Promise.all(Array.from({ length: Math.min(concurrency, ENTRIES.length) }, worker));
console.log(`Avatar generation complete: ${generated} generated, ${skipped} skipped, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

async function worker() {
  for (;;) {
    const entry = ENTRIES[next++];
    if (!entry) return;
    await runEntry(entry);
  }
}

async function runEntry([key, desc]) {
  const outAbs = path.join(OUT_ROOT, `${key}.png`);
  if (!force && await exists(outAbs)) { skipped++; console.log(`skipped ${key}`); return; }
  try {
    const result = await falQueue(MODEL, {
      prompt: `${SHARED} Primary subject: ${desc}`,
      image_size: 'square_hd',
      num_images: 1,
      quality: 'high',
      output_format: 'png',
    }, { pollMs: 3000, timeoutMs: 900000 });
    const url = findUrl(result, ['png', 'jpg', 'jpeg', 'webp']) || findUrl(result, []);
    if (!url) throw new Error(`no image url: ${JSON.stringify(result).slice(0, 200)}`);
    const rawAbs = path.join(RAW_ROOT, `${key}.png`);
    await download(url, rawAbs);
    // center-crop to square and resize to 360 for a small, crisp circular avatar
    execFileSync('python3', ['-c', `
from PIL import Image
im=Image.open('${rawAbs}').convert('RGB')
w,h=im.size; s=min(w,h)
im=im.crop(((w-s)//2,(h-s)//2,(w-s)//2+s,(h-s)//2+s)).resize((360,360),Image.Resampling.LANCZOS)
im.save('${outAbs}')
print('  -> ${key}.png',im.size)
`], { stdio: 'inherit' });
    generated++;
    console.log(`generated ${key}`);
  } catch (e) {
    failed++;
    console.error(`failed ${key}: ${e.message}`);
  }
}

async function exists(f) { try { await fs.access(f); return true; } catch { return false; } }
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; if (!a.startsWith('--')) continue;
    const k = a.slice(2), n = argv[i + 1];
    if (!n || n.startsWith('--')) out[k] = true; else { out[k] = n; i++; }
  }
  return out;
}
