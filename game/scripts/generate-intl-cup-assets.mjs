#!/usr/bin/env node
/**
 * Generate the MODERN (2026) International Cup Story assets — the 10 new
 * character portraits and a few missing backgrounds — via Fal (GPT-Image-2.0),
 * then chroma-key / colour-grade with the shared post-processor. Everything is
 * fictional. Run: `node scripts/generate-intl-cup-assets.mjs [--dry-run] [--force] [--match <re>] [--only character|background]`.
 */
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS, download, falQueue, findUrl } from '../../tools/asset-pipeline/common.mjs';

const GAME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_ROOT = path.join(GAME_ROOT, '.tmp/intl-cup-raw');
const MODEL = process.env.FAL_IMAGE_MODEL ?? 'openai/gpt-image-2';

const args = parseArgs(process.argv.slice(2));
const dryRun = Boolean(args['dry-run']);
const force = Boolean(args.force);
const only = new Set(String(args.only ?? 'all').split(',').map((s) => s.trim()).filter(Boolean));
const match = args.match ? new RegExp(String(args.match)) : null;
const concurrency = Math.max(1, Math.min(Number(args.concurrency ?? 2) || 2, 4));

const CHAR_SHARED = [
  'Asset type: transparent full-body Story Mode character sprite for a modern football drama video game.',
  'Style/medium: realistic painterly modern (2020s) international football drama character cutout, premium sports broadcast still.',
  'Composition/framing: full body, standing upright, centered, facing slightly toward camera, generous padding, no cropping of feet or head.',
  'Lighting/mood: studio cutout lighting with subtle stadium-drama contrast.',
  'Background: perfectly flat solid #00ff00 chroma-key background only, no shadow, no floor, no texture.',
  'Constraints: entirely fictional person, no real-world likeness, no real club crest, no sponsor, no readable text, no numbers, no watermark; do not use the colour #00ff00 anywhere on the person or clothing.',
  'Output: portrait PNG for background removal.',
].join(' ');

const BG_SHARED = [
  'Asset type: prerendered Story Mode background for a modern football drama video game.',
  'Style/medium: cinematic realistic digital matte painting, modern (2020s) international football setting, high-end TV still.',
  'Composition/framing: wide empty environment, no foreground person, leave a clean lower third and side space for overlaid character sprites and dialogue UI.',
  'Lighting/mood: dramatic but readable, modern natural or floodlit lighting.',
  'Constraints: no readable text, no real club badge, no sponsor, no trademark, no watermarks, no people in the scene.',
  'Output: 16:9 landscape PNG.',
].join(' ');

const CHARACTERS = [
  ['rival_dane', 'Marcus Dane, a cocky young rival forward in his mid-20s, athletic, wearing a plain modern navy training kit, arms folded, smug confident smirk, swagger.'],
  ['mentor_okafor', 'Eddie Okafor, a warm wise veteran assistant coach in his 50s, a former international, salt-and-pepper hair, modern dark coaching jacket and polo, calm encouraging presence, hands clasped.'],
  ['chairman_voss', 'Gerald Voss, a shrewd club chairman in his early 60s, sharp tailored charcoal suit, open collar, plain lapel pin, composed authoritative half-smile.'],
  ['sister_mia', 'Mia, a blunt loyal younger sister in her early 20s, casual modern hoodie and jeans, arms crossed, fond exasperated expression, relatable everyday look.'],
  ['agent_rival_sharpe', 'Dominic Sharpe, a slick predatory super-agent in his 40s, expensive slim charcoal suit, no tie, holding a smartphone, glossy confident charm bordering on smarmy.'],
  ['pundit_grady', 'Ron Grady, a loud old-school TV football pundit in his early 60s, bold burgundy blazer, broad build, opinionated theatrical expression mid-gesture, broadcast-studio polish.'],
  ['physio_lane', 'Sara Lane, a focused caring club physiotherapist in her 30s, modern teal medical polo, lanyard, holding a strapping roll, kind professional expression.'],
  ['teammate_reyes', 'Hugo Reyes, a playful flair winger in his mid-20s, lean and quick, modern red training kit, grinning joker expression, relaxed energetic posture.'],
  ['england_roommate_fox', 'Daniel Fox, a quiet reliable young national-team teammate in his early 20s, plain modern white training top, friendly understated expression, calm.'],
  ['national_manager_strand', 'Coach Strand, an exacting calm national-team manager in his 50s, smart dark technical coat over a training top, unreadable composed expression, gravitas, hands behind back.'],
];

const BACKGROUNDS = [
  ['press_room_intl', 'A modern international football press conference room: a long top table with several unbranded microphones, a softly blue-lit backdrop wall (no readable logos), TV cameras and soft flashbulbs implied at the edges, empty seats, clean and contemporary.'],
  ['car_interior_night', 'The interior of a modern car at night seen from the back seats, city street lights and a stadium glow blurred through rain-flecked windows, empty seats, intimate quiet mood.'],
  ['physio_room_intl', 'A modern football club physiotherapy treatment room: a padded treatment table, neat shelves of strapping and recovery equipment, an ice bath in the corner, clean clinical lighting, empty.'],
];

function entries() {
  const chars = CHARACTERS.map(([file, prompt]) => ({
    kind: 'character', key: file, file,
    outAssetRel: `journey/characters/${file}.png`,
    prompt: `${CHAR_SHARED} Primary subject: ${prompt}`,
    image_size: 'portrait_4_3',
  }));
  const bgs = BACKGROUNDS.map(([file, prompt]) => ({
    kind: 'background', key: file, file,
    outAssetRel: `journey/backgrounds/${file}.png`,
    prompt: `${BG_SHARED} Primary scene: ${prompt}`,
    image_size: 'landscape_16_9',
  }));
  return [...chars, ...bgs]
    .filter((e) => only.has('all') || only.has(e.kind))
    .filter((e) => !match || match.test(e.key));
}

const list = entries();
console.log(`Intl Cup asset generation: ${list.length} entries using ${MODEL} via Fal, concurrency ${concurrency}`);
if (dryRun) {
  for (const e of list) console.log(`\n${e.key} (${e.kind}) -> assets/${e.outAssetRel}\n${e.prompt}`);
  process.exit(0);
}

let generated = 0, skipped = 0, failed = 0, next = 0;
await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
console.log(`\nDone: ${generated} generated, ${skipped} skipped, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

async function worker() {
  for (;;) {
    const e = list[next++];
    if (!e) return;
    await run(e);
  }
}

async function run(e) {
  const outAbs = path.join(ASSETS, e.outAssetRel);
  if (!force && await exists(outAbs)) { skipped++; console.log(`skipped ${e.key} (exists)`); return; }
  try {
    const result = await falQueue(MODEL, {
      prompt: e.prompt, image_size: e.image_size, num_images: 1, quality: 'high', output_format: 'png',
    }, { pollMs: 3000, timeoutMs: 900000 });
    const rawAbs = path.join(RAW_ROOT, `${e.key}.png`);
    await saveImageResult(result, rawAbs);
    execFileSync('python3', ['scripts/postprocess-journey-asset.py', '--kind', e.kind, '--input', rawAbs, '--output', outAbs], { cwd: GAME_ROOT, stdio: 'inherit' });
    generated++;
    console.log(`generated ${e.key} -> ${e.outAssetRel}`);
  } catch (err) {
    failed++;
    console.error(`failed ${e.key}: ${err.message}`);
  }
}

async function saveImageResult(result, dest) {
  const url = findUrl(result, ['png', 'jpg', 'jpeg', 'webp']) || findUrl(result, []);
  if (url) { await download(url, dest); return; }
  const dataUri = findDataUri(result);
  if (dataUri) {
    const b64 = dataUri.split(',', 2)[1];
    fsSync.mkdirSync(path.dirname(dest), { recursive: true });
    fsSync.writeFileSync(dest, Buffer.from(b64, 'base64'));
    return;
  }
  throw new Error(`Fal response had no image: ${JSON.stringify(result).slice(0, 300)}`);
}

function findDataUri(obj) {
  const stack = [obj];
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === 'string' && v.startsWith('data:image/')) return v;
    if (v && typeof v === 'object') stack.push(...Object.values(v));
  }
  return null;
}

async function exists(f) { try { await fs.access(f); return true; } catch { return false; } }

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const n = argv[i + 1];
    if (!n || n.startsWith('--')) out[k] = true; else { out[k] = n; i++; }
  }
  return out;
}
