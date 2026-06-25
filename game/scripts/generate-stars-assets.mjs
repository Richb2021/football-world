#!/usr/bin/env node
/**
 * Generate the art for the new ONLINE / International Cup Stars modes via Fal
 * (GPT-Image-2.0), matching the existing cinematic broadcast style. Everything
 * fictional, no real brands/crests. Player cards themselves are CSS, not art.
 * Run: `node scripts/generate-stars-assets.mjs [--dry-run] [--force] [--match <re>]`.
 */
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS, download, falQueue, findUrl, updateManifest } from '../../tools/asset-pipeline/common.mjs';

const GAME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_ROOT = path.join(GAME_ROOT, '.tmp/stars-raw');
const MODEL = process.env.FAL_IMAGE_MODEL ?? 'openai/gpt-image-2';
const args = parseArgs(process.argv.slice(2));
const dryRun = Boolean(args['dry-run']);
const force = Boolean(args.force);
const match = args.match ? new RegExp(String(args.match)) : null;
const concurrency = Math.max(1, Math.min(Number(args.concurrency ?? 3) || 3, 4));

const BG_SHARED = 'Asset type: prerendered background for a modern football video game menu. Style: cinematic realistic digital matte painting, modern (2020s), high-end broadcast TV still. Composition: wide empty environment, no foreground person, leave clean space for overlaid UI. Constraints: no readable text, no real club badge, no sponsor, no trademark, no watermark, no people. Output: 16:9 landscape PNG.';
// Transparent emblem/pack art: GPT-Image-2 paints a flat green key we strip to alpha.
const CHROMA = 'on a perfectly flat solid #00ff00 chroma-key background only, no shadow, no floor, no texture; do not use the colour #00ff00 anywhere on the subject itself.';
const PACK_SHARED = `A premium sealed digital trading-card pack for a football game, a glossy upright foil pack/envelope with a glowing football-star emblem on the front, dramatic studio rim light, crisp esports/broadcast quality, iconic and collectible. Centred ${CHROMA} No text, no letters, no numbers, no real brand.`;

const FRAME_TIERS = [
  { id: 'bronze',  desc: 'Weathered bronze and dark copper metal with a warm patina and an entry-tier, understated look.' },
  { id: 'silver',  desc: 'Brushed silver and bright chrome metal, cool, clean and crisp.' },
  { id: 'gold',    desc: 'Polished radiant gold metal with ornate filigree detailing, luxurious and high-tier.' },
  { id: 'special', desc: 'Iridescent holographic chrome shifting between gold, electric blue and magenta, prismatic and dazzling — the rarest tier.' },
];

const ENTRIES = [
  // ---- Mode backdrops ----
  { key: 'starsHub', kind: 'background', out: 'ui/stars_hub.png', size: 'landscape_16_9',
    prompt: `${BG_SHARED} Primary scene: a glamorous modern football arena at night drenched in gold and deep navy light, glittering bokeh and falling golden sparks, a premium "ultimate squad" collectible-card vibe, luxurious and aspirational, darkened lower third for UI.` },
  { key: 'onlineHub', kind: 'background', out: 'ui/online_hub.png', size: 'landscape_16_9',
    prompt: `${BG_SHARED} Primary scene: a sleek connected-online football lobby backdrop — a futuristic stadium concourse bathed in cool blue and teal light with subtle glowing network/connection motifs in the bokeh, modern and electric, deep blues with gold accents, darkened for UI.` },
  // ---- Stars crest (transparent) ----
  { key: 'starsCrest', kind: 'logo', out: 'ui/stars_crest.png', size: 'square_hd',
    prompt: `A modern premium emblem for an "all-stars" soccer collectible mode: a bold five-pointed star fused with a stylised ROUND black-and-white panelled SOCCER BALL (association football / round soccer ball — absolutely NOT an American football, NOT a rugby ball, NOT an oval ball) and a sweep of motion, polished metallic gold and chrome with deep navy facets, a subtle blue spark highlight, broadcast/esports quality, iconic and instantly readable at small size. Centred emblem ${CHROMA} No text, no letters, no numbers, no real club crest.` },
  // ---- Pack tier art (transparent) ----
  { key: 'pack_bronze', kind: 'logo', out: 'ui/pack_bronze.png', size: 'portrait_4_3',
    prompt: `${PACK_SHARED} The pack is forged bronze and dark brown with a warm copper sheen — an entry-tier pack, understated.` },
  { key: 'pack_silver', kind: 'logo', out: 'ui/pack_silver.png', size: 'portrait_4_3',
    prompt: `${PACK_SHARED} The pack is brushed silver and cool grey with a bright metallic sheen — a mid-tier pack.` },
  { key: 'pack_gold', kind: 'logo', out: 'ui/pack_gold.png', size: 'portrait_4_3',
    prompt: `${PACK_SHARED} The pack is radiant gold with a luxurious warm glow — a high-tier pack, premium and desirable.` },
  { key: 'pack_premium', kind: 'logo', out: 'ui/pack_premium.png', size: 'portrait_4_3',
    prompt: `${PACK_SHARED} The pack is deep gold and black with glowing amber edges and a jewelled crest — a premium elite pack, opulent.` },
  { key: 'pack_special', kind: 'logo', out: 'ui/pack_special.png', size: 'portrait_4_3',
    prompt: `${PACK_SHARED} The pack is iridescent gold, white and electric blue with a brilliant starburst and prismatic shimmer — the rarest "stars" pack, dazzling and special.` },
  // ---- Pack-open light burst (transparent) ----
  { key: 'packBurst', kind: 'logo', out: 'ui/pack_burst.png', size: 'square_hd',
    prompt: `A dramatic radial burst of golden and white light rays exploding outward from a bright central core, with sparkles and lens flare, for a card-pack reveal moment, energetic and celebratory. Centred symmetrical burst ${CHROMA} No text, no letters, no numbers.` },
  // ---- Ornate rarity card FRAMES (a border ring only; transparent centre + outside) ----
  ...FRAME_TIERS.map((t) => ({
    key: `frame_${t.id}`, kind: 'logo', out: `ui/frame_${t.id}.png`, size: 'portrait_4_3',
    prompt: `A single ornate metallic picture-frame BORDER for a premium collectible football trading card, portrait orientation, symmetrical, filling the image edge to edge. ${t.desc} The frame is a slim-to-medium decorative metal border ring ONLY — both the large central area inside the frame AND the area outside the frame are filled with perfectly flat solid pure #00ff00 green (chroma key) so only the metal border itself remains. Beveled and polished with subtle engraved detailing and clean angular corners; keep the border fairly slim so it leaves a large empty centre. Absolutely NO text, no numbers, no letters, no player, no photo, no logo, no symbols or crest inside or on the frame; do not use the colour #00ff00 on the metal itself.`,
  })),
].filter((e) => !match || match.test(e.key));

console.log(`Stars asset generation: ${ENTRIES.length} entries using ${MODEL} via Fal, concurrency ${concurrency}`);
if (dryRun) { for (const e of ENTRIES) console.log(`\n${e.key} (${e.kind}) -> assets/${e.out}\n${e.prompt}`); process.exit(0); }

let generated = 0, skipped = 0, failed = 0, next = 0;
await Promise.all(Array.from({ length: Math.min(concurrency, ENTRIES.length) }, worker));
console.log(`\nDone: ${generated} generated, ${skipped} skipped, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

async function worker() { for (;;) { const e = ENTRIES[next++]; if (!e) return; await run(e); } }

async function run(e) {
  const outAbs = path.join(ASSETS, e.out);
  if (!force && await exists(outAbs)) { skipped++; console.log(`skipped ${e.key}`); updateManifest({ [e.key]: `assets/${e.out}` }); return; }
  try {
    const result = await falQueue(MODEL, { prompt: e.prompt, image_size: e.size, num_images: 1, quality: 'high', output_format: 'png' }, { pollMs: 3000, timeoutMs: 900000 });
    const rawAbs = path.join(RAW_ROOT, `${e.key}.png`);
    await saveImageResult(result, rawAbs);
    execFileSync('python3', ['scripts/postprocess-journey-asset.py', '--kind', e.kind, '--input', rawAbs, '--output', outAbs], { cwd: GAME_ROOT, stdio: 'inherit' });
    updateManifest({ [e.key]: `assets/${e.out}` });
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
