// Generate the vibrant WC26-palette menu backdrop pool + a recoloured Grayson
// Games logo for the main menu, via fal.ai openai/gpt-image-2 (GPT-Image-2.0).
//
//   node scripts/generate-menu-backdrops.mjs            # generate missing
//   node scripts/generate-menu-backdrops.mjs --force    # regenerate all
//   node scripts/generate-menu-backdrops.mjs --dry-run  # print prompts only
//   node scripts/generate-menu-backdrops.mjs --only logo,menu_bg_6
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS, download, falQueue, findUrl } from '../../tools/asset-pipeline/common.mjs';

const GAME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_ROOT = path.join(GAME_ROOT, '.tmp/menu-raw');
const MODEL = process.env.FAL_IMAGE_MODEL ?? 'openai/gpt-image-2';
const EDIT_MODEL = 'openai/gpt-image-2/edit';

const args = parseArgs(process.argv.slice(2));
const dryRun = Boolean(args['dry-run']);
const force = Boolean(args.force);
const only = args.only ? new Set(String(args.only).split(',').map((s) => s.trim()).filter(Boolean)) : null;
const concurrency = Math.max(1, Math.min(Number(args.concurrency ?? 3) || 3, 6));

// Shared art direction: vibrant FIFA-2026-style palette, but dark/atmospheric so
// the bright menu UI reads on top. Explicitly bans FIFA/World Cup branding.
const BG = [
  'Asset type: prerendered menu backdrop for a modern, premium arcade football (soccer) video game.',
  'Visual style: bold contemporary sports-broadcast art direction built on a vibrant multi-colour palette —',
  'crimson red #e61d25, electric orange #ff4500, bright yellow #eaff3a, lime #aadb2a, green #00c853,',
  'teal-mint #5fffd0, sky blue #1f8fff, royal blue #2f4fe0, electric purple #6610f2, hot pink #e91e63.',
  'Mood: energetic and festival-like but DARK and atmospheric, with deep shadows and a clean, darker,',
  'uncluttered centre and lower third so bright menu buttons and text overlay clearly on top.',
  'Strictly NO text, NO letters or numbers, NO real club badges, NO sponsors, NO trademarks, NO watermark,',
  'NO FIFA or World Cup logos or trophies, NO recognisable real people or faces.',
  '16:9 landscape, high quality.',
].join(' ');

const BACKDROPS = [
  { key: 'menu_bg_1', scene: 'Scene: a packed modern football stadium at night seen from high in the stands, sweeping beams of coloured stage light in red, blue, purple and green cutting through a hazy atmosphere over a vivid green pitch far below, drifting confetti and bokeh, cinematic depth, the electric build-up to a big match.' },
  { key: 'menu_bg_2', scene: 'Scene: a dramatic low ground-level view across a lush floodlit football pitch with crisp mowing stripes, the blurred stands behind colour-blocked in bold panels of the vibrant palette, a single football resting on the grass, deep night sky, shallow depth of field.' },
  { key: 'menu_bg_3', scene: 'Scene: a vast stadium crowd holding up a giant abstract card mosaic / tifo display rendered in bold blocks and diagonal stripes of the vibrant multi-colour palette, slightly out of focus and darkened toward the edges, pure colour and energy, no readable shapes or symbols.' },
  { key: 'menu_bg_4', scene: 'Scene: a hero product-style shot of a modern football and a pair of football boots on a dark reflective studio floor, lit from the sides with vivid coloured gel lights (magenta, blue, orange) raking across them, lots of dark negative space around the subject, premium and sleek.' },
  { key: 'menu_bg_5', scene: "Scene: a cinematic view down a dark players' tunnel toward a brilliantly floodlit pitch, the opening glowing with vibrant multi-colour light and haze, silhouetted architecture framing the bright exit, very dark foreground, dramatic and moody." },
  { key: 'menu_bg_6', scene: 'Scene: a sleek abstract broadcast motion-graphic backdrop — large smooth flowing waves and concentric arcs of the vibrant multi-colour palette sweeping across a dark field, with a subtle ghosted classic black-and-white football silhouette and soft grain, modern, clean and high-end, darker toward the centre.' },
];

const LOGO_PROMPT = [
  'Edit the supplied logo image. It is the "GRAYSON GAMES" game-studio logo: a stylised interlocking letter G monogram inside a rounded-square badge, with the word GRAYSON in outlined capitals and GAMES on a bar beneath it.',
  'Keep the EXACT same shapes, geometry, letterforms and composition — do not redraw, move, add or remove any element and do not change any text.',
  'Only change the colours: recolour the G monogram into a bold vibrant modern sports gradient blending crimson red #e61d25, electric blue #1f8fff, royal blue #2f4fe0, electric purple #6610f2, lime green #00c853 and hot pink #e91e63, with a subtle premium metallic sheen.',
  'Render the GRAYSON GAMES wordmark in clean bright white with a thin vibrant coloured accent.',
  'Place the recoloured logo perfectly centred on a completely flat solid pure green #00ff00 background with nothing else and no shadow.',
  'Do not use the colour #00ff00 anywhere on the logo itself. No new text, no extra graphics.',
].join(' ');

const ENTRIES = [
  ...BACKDROPS.map((b) => ({
    key: b.key,
    kind: 'background',
    out: `ui/${b.key}.webp`,
    endpoint: MODEL,
    prompt: `${BG} ${b.scene}`,
  })),
  {
    key: 'grayson_games_color',
    kind: 'logo',
    out: 'ui/grayson_games_color.webp',
    endpoint: EDIT_MODEL,
    prompt: LOGO_PROMPT,
    editImage: path.join(ASSETS, 'ui/grayson_games.webp'),
  },
].filter((e) => !only || only.has(e.key));

console.log(`Menu backdrop generation: ${ENTRIES.length} entries using ${MODEL} via Fal, concurrency ${concurrency}`);
if (dryRun) {
  for (const e of ENTRIES) console.log(`\n${e.key} (${e.kind}) -> assets/${e.out}\n${e.prompt}`);
  process.exit(0);
}

await fs.mkdir(RAW_ROOT, { recursive: true });
let generated = 0, skipped = 0, failed = 0, next = 0;
await Promise.all(Array.from({ length: Math.min(concurrency, ENTRIES.length) }, worker));
console.log(`\nDone: ${generated} generated, ${skipped} skipped, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

async function worker() { for (;;) { const e = ENTRIES[next++]; if (!e) return; await run(e); } }

async function run(e) {
  const outAbs = path.join(ASSETS, e.out);
  if (!force && await exists(outAbs)) { skipped++; console.log(`skipped ${e.key}`); return; }
  try {
    const payload = e.kind === 'logo'
      ? { prompt: e.prompt, image_urls: [dataUri(e.editImage)], image_size: 'auto', num_images: 1, quality: 'high', output_format: 'png' }
      : { prompt: e.prompt, image_size: 'landscape_16_9', num_images: 1, quality: 'high', output_format: 'png' };
    const result = await falQueue(e.endpoint, payload, { pollMs: 3000, timeoutMs: 900000 });
    const rawAbs = path.join(RAW_ROOT, `${e.key}.png`);
    await saveImageResult(result, rawAbs);
    execFileSync('python3', ['scripts/postprocess-journey-asset.py', '--kind', e.kind, '--input', rawAbs, '--output', outAbs], { cwd: GAME_ROOT, stdio: 'inherit' });
    generated++;
    console.log(`generated ${e.key} -> ${e.out}`);
  } catch (err) { failed++; console.error(`failed ${e.key}: ${err.message}`); }
}

function dataUri(file) {
  const buf = fsSync.readFileSync(file);
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = ext === 'webp' ? 'image/webp' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function saveImageResult(result, dest) {
  const url = findUrl(result, ['png', 'jpg', 'jpeg', 'webp']) || findUrl(result, []);
  if (url) { await download(url, dest); return; }
  const d = findDataUri(result);
  if (d) { fsSync.mkdirSync(path.dirname(dest), { recursive: true }); fsSync.writeFileSync(dest, Buffer.from(d.split(',', 2)[1], 'base64')); return; }
  throw new Error(`Fal response had no image: ${JSON.stringify(result).slice(0, 300)}`);
}
function findDataUri(obj) { const s = [obj]; while (s.length) { const v = s.pop(); if (typeof v === 'string' && v.startsWith('data:image/')) return v; if (v && typeof v === 'object') s.push(...Object.values(v)); } return null; }
async function exists(f) { try { await fs.access(f); return true; } catch { return false; } }
function parseArgs(argv) { const o = {}; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (!a.startsWith('--')) continue; const k = a.slice(2); const n = argv[i + 1]; if (!n || n.startsWith('--')) o[k] = true; else { o[k] = n; i++; } } return o; }
