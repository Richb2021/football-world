#!/usr/bin/env node
/**
 * Generate the modern UI art (logo + menu backgrounds) and modern (2026) story
 * backgrounds via Fal (GPT-Image-2.0), replacing the placeholder/1992 assets.
 * Everything fictional. Run: `node scripts/generate-ui-and-bg-assets.mjs [--dry-run] [--force] [--match <re>]`.
 */
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS, download, falQueue, findUrl } from '../../tools/asset-pipeline/common.mjs';

const GAME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_ROOT = path.join(GAME_ROOT, '.tmp/ui-raw');
const MODEL = process.env.FAL_IMAGE_MODEL ?? 'openai/gpt-image-2';
const args = parseArgs(process.argv.slice(2));
const dryRun = Boolean(args['dry-run']);
const force = Boolean(args.force);
const match = args.match ? new RegExp(String(args.match)) : null;
const concurrency = Math.max(1, Math.min(Number(args.concurrency ?? 3) || 3, 4));

const BG_SHARED = 'Asset type: prerendered background for a modern football drama video game. Style: cinematic realistic digital matte painting, modern (2020s), high-end TV still. Composition: wide empty environment, no foreground person, leave a clean lower third and side space for overlaid UI. Constraints: no readable text, no real club badge, no sponsor, no trademark, no watermark, no people. Output: 16:9 landscape PNG.';

const ENTRIES = [
  // ---- UI: logo + menu backgrounds (overwrite assets/ui/*) ----
  { key: 'icon', kind: 'logo', out: 'ui/icon.png', size: 'square_hd',
    prompt: 'A modern, sleek emblem badge for an international football tournament. A stylized golden trophy and football fused inside a clean contemporary rounded shield, premium metallic gold and deep navy blue, crisp flat-modern vector style with subtle depth and a soft sheen, esports/broadcast quality, bold and iconic. Centered emblem on a perfectly flat solid #00ff00 chroma-key background only, no shadow. No text, no letters, no numbers, no real club crest, no sponsor, no watermark; do not use the colour #00ff00 on the emblem itself.' },
  { key: 'menu_hero', kind: 'background', out: 'ui/menu_hero.png', size: 'landscape_16_9',
    prompt: `${BG_SHARED} Primary scene: an epic cinematic football title-screen hero shot — a packed modern international stadium at night under brilliant floodlights, golden confetti and lens flare, the electric atmosphere of a major tournament final, deep blues and gold, dramatic depth, space left for an overlaid game title.` },
  { key: 'team_select_bg', kind: 'background', out: 'ui/team_select_bg.png', size: 'landscape_16_9',
    prompt: `${BG_SHARED} Primary scene: a modern football stadium menu backdrop — a softly out-of-focus floodlit stadium interior with a vivid green pitch, deep blue and emerald tones, darkened and atmospheric so bright menu UI reads clearly on top, premium and clean.` },
  // ---- Modern story backgrounds (overwrite the 1992-reuse mappings) ----
  { key: 'bedroom_intl', kind: 'background', out: 'journey/backgrounds/bedroom_intl.png', size: 'landscape_16_9',
    prompt: `${BG_SHARED} Primary scene: a modern young footballer's bedroom in a city apartment, contemporary furniture, a big window with a dusk city skyline, football boots and a ball in the corner, a warm lamp, tidy and personal.` },
  { key: 'kitchen_intl', kind: 'background', out: 'journey/backgrounds/kitchen_intl.png', size: 'landscape_16_9',
    prompt: `${BG_SHARED} Primary scene: a modern family kitchen in a contemporary home, clean counters and island, soft morning light, a phone and keys on the side, lived-in but tidy and warm.` },
  { key: 'training_intl', kind: 'background', out: 'journey/backgrounds/training_intl.png', size: 'landscape_16_9',
    prompt: `${BG_SHARED} Primary scene: a modern professional football training ground, immaculate green pitch, training cones and coloured bibs, a low modern stand and goals, bright overcast morning.` },
  { key: 'manager_office_intl', kind: 'background', out: 'journey/backgrounds/manager_office_intl.png', size: 'landscape_16_9',
    prompt: `${BG_SHARED} Primary scene: a modern football manager's office at a training complex, glass and wood, a desk, wall-mounted tactics screens, a shelf of unbranded trophies, a window onto the pitch.` },
  { key: 'locker_room_intl', kind: 'background', out: 'journey/backgrounds/locker_room_intl.png', size: 'landscape_16_9',
    prompt: `${BG_SHARED} Primary scene: a modern professional football dressing room, sleek illuminated wooden lockers, plain kit hanging, leather benches, a tactics screen, moody premium ambient lighting.` },
  { key: 'pub_intl', kind: 'background', out: 'journey/backgrounds/pub_intl.png', size: 'landscape_16_9',
    prompt: `${BG_SHARED} Primary scene: a modern sports bar at night, several large blank screens, warm amber lighting, stools and tables, an inviting empty atmosphere.` },
  { key: 'pitch_intl', kind: 'background', out: 'journey/backgrounds/pitch_intl.png', size: 'landscape_16_9',
    prompt: `${BG_SHARED} Primary scene: a modern football stadium pitch view on matchday, lush green grass with mowing stripes, bright floodlights and packed blurred stands, the charged hush before kick-off, no readable signage.` },
  { key: 'hospital_intl', kind: 'background', out: 'journey/backgrounds/hospital_intl.png', size: 'landscape_16_9',
    prompt: `${BG_SHARED} Primary scene: a modern private medical clinic room, clean contemporary design, an examination bed, soft daylight through blinds, a calm clinical mood.` },
].filter((e) => !match || match.test(e.key));

console.log(`UI/BG asset generation: ${ENTRIES.length} entries using ${MODEL} via Fal, concurrency ${concurrency}`);
if (dryRun) { for (const e of ENTRIES) console.log(`\n${e.key} (${e.kind}) -> assets/${e.out}\n${e.prompt}`); process.exit(0); }

let generated = 0, skipped = 0, failed = 0, next = 0;
await Promise.all(Array.from({ length: Math.min(concurrency, ENTRIES.length) }, worker));
console.log(`\nDone: ${generated} generated, ${skipped} skipped, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

async function worker() { for (;;) { const e = ENTRIES[next++]; if (!e) return; await run(e); } }

async function run(e) {
  const outAbs = path.join(ASSETS, e.out);
  if (!force && await exists(outAbs)) { skipped++; console.log(`skipped ${e.key}`); return; }
  try {
    const result = await falQueue(MODEL, { prompt: e.prompt, image_size: e.size, num_images: 1, quality: 'high', output_format: 'png' }, { pollMs: 3000, timeoutMs: 900000 });
    const rawAbs = path.join(RAW_ROOT, `${e.key}.png`);
    await saveImageResult(result, rawAbs);
    execFileSync('python3', ['scripts/postprocess-journey-asset.py', '--kind', e.kind, '--input', rawAbs, '--output', outAbs], { cwd: GAME_ROOT, stdio: 'inherit' });
    generated++;
    console.log(`generated ${e.key} -> ${e.out}`);
  } catch (err) { failed++; console.error(`failed ${e.key}: ${err.message}`); }
}

async function saveImageResult(result, dest) {
  const url = findUrl(result, ['png', 'jpg', 'jpeg', 'webp']) || findUrl(result, []);
  if (url) { await download(url, dest); return; }
  const dataUri = findDataUri(result);
  if (dataUri) { fsSync.mkdirSync(path.dirname(dest), { recursive: true }); fsSync.writeFileSync(dest, Buffer.from(dataUri.split(',', 2)[1], 'base64')); return; }
  throw new Error(`Fal response had no image: ${JSON.stringify(result).slice(0, 300)}`);
}
function findDataUri(obj) { const s = [obj]; while (s.length) { const v = s.pop(); if (typeof v === 'string' && v.startsWith('data:image/')) return v; if (v && typeof v === 'object') s.push(...Object.values(v)); } return null; }
async function exists(f) { try { await fs.access(f); return true; } catch { return false; } }
function parseArgs(argv) { const o = {}; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (!a.startsWith('--')) continue; const k = a.slice(2); const n = argv[i + 1]; if (!n || n.startsWith('--')) o[k] = true; else { o[k] = n; i++; } } return o; }
