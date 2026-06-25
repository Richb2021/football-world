import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS, download, falQueue, findUrl, updateManifest } from '../../tools/asset-pipeline/common.mjs';

const GAME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEAMS_DIR = path.join(GAME_ROOT, 'src/data/teams');
const OUT_DIR = path.join(ASSETS, 'generated');
const MODEL = 'openai/gpt-image-2';
const EDIT_MODEL = 'openai/gpt-image-2/edit';
const TEMPLATE_DIR = path.join(ASSETS, 'generated/templates');
const UV_BASE = path.join(TEMPLATE_DIR, 'player_kit_uv_base.png');
const UV_MASK = path.join(TEMPLATE_DIR, 'player_kit_uv_mask.png');
const UV_GUIDE = path.join(TEMPLATE_DIR, 'player_kit_uv_guide.png');

const args = parseArgs(process.argv.slice(2));
const dryRun = Boolean(args['dry-run']);
const force = Boolean(args.force);
const only = new Set((args.only ?? 'badges').split(',').map((s) => s.trim()).filter(Boolean));
const teamFilter = args.team ? new Set(String(args.team).split(',').map((s) => s.trim())) : null;
const limit = args.limit ? Number(args.limit) : Infinity;
const model = args.model ?? process.env.FAL_IMAGE_MODEL ?? MODEL;
const imageSize = args.size ?? process.env.FAL_IMAGE_SIZE ?? 'square_hd';
const editQuality = args['edit-quality'] ?? process.env.FAL_IMAGE_EDIT_QUALITY ?? 'medium';
const concurrency = Math.max(1, Math.min(Number(args.concurrency ?? process.env.FAL_IMAGE_CONCURRENCY ?? 4) || 4, 8));
const allowKitUvEdits = Boolean(args['experimental-kit-uv-edits']);

if ((only.has('kits') || only.has('kit')) && !allowKitUvEdits) {
  throw new Error('Kit image generation is disabled by default because GPT-edited UV sheets were visually unreliable. Use procedural kit mapping, or pass --experimental-kit-uv-edits for manual testing only.');
}

const teams = (await loadTeams()).filter((team) => !teamFilter || teamFilter.has(team.id));
const entries = buildEntries(teams).slice(0, limit);

console.log(`Visual asset generation: ${entries.length} entries using ${model} via Fal (GPT-Image-2.0), concurrency ${concurrency}`);
if (dryRun) {
  for (const entry of entries) {
    console.log(`${entry.key} -> ${entry.outRel}\n${entry.prompt}\n`);
  }
  process.exit(0);
}

await fs.mkdir(OUT_DIR, { recursive: true });

let generated = 0;
let skipped = 0;
let failed = 0;
let nextEntry = 0;

await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, runWorker));

console.log(`Visual generation complete: ${generated} generated, ${skipped} skipped, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

async function runWorker() {
  for (;;) {
    const entry = entries[nextEntry++];
    if (!entry) return;
    await runEntry(entry);
  }
}

async function runEntry(entry) {
  const outAbs = path.join(ASSETS, entry.outAssetRel);
  if (!force && await exists(outAbs)) {
    skipped++;
    updateManifest({ [entry.key]: entry.outRel });
    console.log(`skipped ${entry.key}`);
    return;
  }

  try {
    if (entry.kind === 'kit') await ensureUvTemplateAssets();
    const result = await falQueue(entry.endpoint, buildPayload(entry));
    await saveImageResult(result, outAbs);
    updateManifest({ [entry.key]: entry.outRel });
    generated++;
    console.log(`generated ${entry.key}`);
  } catch (e) {
    failed++;
    console.error(`failed ${entry.key}: ${e.message}`);
  }
}

function buildEntries(teams) {
  const entries = [];
  if (only.has('store') || only.has('topup') || only.has('purchase')) {
    entries.push(...storeAssetEntries());
  }
  for (const team of teams) {
    if (only.has('badges') || only.has('badge')) {
      entries.push({
        kind: 'badge',
        endpoint: model,
        key: `badge_${team.id}`,
        outRel: `assets/generated/badge_${team.id}.png`,
        outAssetRel: `generated/badge_${team.id}.png`,
        prompt: badgePrompt(team),
      });
    }
    if (only.has('kits') || only.has('kit')) {
      for (const side of ['home', 'away']) {
        entries.push({
          kind: 'kit',
          endpoint: EDIT_MODEL,
          key: `kit_${team.id}_${side}`,
          outRel: `assets/generated/kit_uv_${team.id}_${side}.png`,
          outAssetRel: `generated/kit_uv_${team.id}_${side}.png`,
          prompt: kitUvPrompt(team, side),
        });
      }
    }
  }
  return entries;
}

function storeAssetEntries() {
  return [
    {
      key: 'store_token_stack',
      outRel: 'assets/ui/store_token_stack.webp',
      outAssetRel: 'ui/store_token_stack.webp',
      prompt: storeAssetPrompt('a stack of glowing blue arcade challenge tokens, beveled square chips, energetic association football soccer arcade styling'),
    },
    {
      key: 'store_coin_bundle_small',
      outRel: 'assets/ui/store_coin_bundle_small.webp',
      outAssetRel: 'ui/store_coin_bundle_small.webp',
      prompt: storeAssetPrompt('a compact pile of gold arcade soccer coins with subtle classic black-and-white soccer ball embossing, bright highlights, satisfying starter bundle feeling'),
    },
    {
      key: 'store_combo_bundle',
      outRel: 'assets/ui/store_combo_bundle.webp',
      outAssetRel: 'ui/store_combo_bundle.webp',
      prompt: storeAssetPrompt('gold arcade soccer coins mixed with blue challenge tokens, premium mid-tier association football game store bundle'),
    },
    {
      key: 'store_coin_bundle_large',
      outRel: 'assets/ui/store_coin_bundle_large.webp',
      outAssetRel: 'ui/store_coin_bundle_large.webp',
      prompt: storeAssetPrompt('a large jackpot pile of gold arcade soccer coins with a few blue tokens and subtle soccer ball embossing, top-value store bundle'),
    },
  ].map((entry) => ({
    kind: 'store',
    endpoint: model,
    ...entry,
  }));
}

function storeAssetPrompt(subject) {
  return [
    'Create a fictional retro 1990s arcade association football (soccer) game store asset.',
    `Subject: ${subject}.`,
    'Style: polished game UI item art, chunky readable silhouette, glossy highlights, dark transparent-friendly background, no text.',
    'Important: association football/soccer only. No American footballs, no rugby balls, no helmets, no pads, no real brands, no payment logos, no club crests, no trademarks, no player likenesses, no words or numbers.',
    'Output as a clean product icon that works inside a small in-game purchase card.',
  ].join(' ');
}

function badgePrompt(team) {
  const home = team.colors.home;
  return [
    'Create a fictional football club badge for a retro 1993 arcade football game.',
    `Club name: ${team.name}. Use only the initials "${team.short}".`,
    `Use the colours ${home.shirt}, ${home.shorts}, and ${home.socks}.`,
    'Style: bold readable crest, simple shapes, thick outlines, transparent or plain background.',
    'Important: do not copy or imitate any real club crest, sponsor, brand, trademark, cannon, liver bird, or official logo.',
    'Output should work at tiny in-game size, centred, clean silhouette, no photorealism.',
  ].join(' ');
}

function kitUvPrompt(team, side) {
  const kit = team.colors[side];
  return [
    'Edit the first image, which is a football player model UV texture sheet.',
    `Team: ${team.name}; kit side: ${side}.`,
    `Palette: shirt ${kit.shirt}, shorts ${kit.shorts}, socks ${kit.socks}.`,
    'Use the black and white mask to edit only the kit UV islands. Preserve every UV island position, edge, seam, scale, orientation, face, skin, hair, boot, shadow and non-kit pixel outside the mask.',
    'Use the second reference image only as a guide: red-tinted areas are shirt/sleeve/sock kit regions and blue-tinted areas are shorts regions.',
    'Apply a clean fictional retro football kit design to the shirt regions: stripes, hoops, sash, sleeve trim, pinstripes, chevrons, or geometric panels are all acceptable.',
    'Keep shorts visibly different from the shirt and mostly plain in the shorts colour. Use socks colour on sock-like white lower-leg regions where clear.',
    'No sponsors, no manufacturer logos, no real club crests, no official branding, no player number and no new text.',
    'Return one PNG UV texture sheet with the same layout and dimensions as the input.',
  ].join(' ');
}

function buildPayload(entry) {
  if (entry.kind === 'kit') {
    return {
      prompt: entry.prompt,
      image_urls: [dataUri(UV_BASE), dataUri(UV_GUIDE)],
      mask_image_url: dataUri(UV_MASK),
      image_size: 'auto',
      num_images: 1,
      quality: editQuality,
      output_format: 'png',
    };
  }
  return {
    prompt: entry.prompt,
    image_size: imageSize,
    num_images: 1,
    quality: 'high',
    output_format: entry.kind === 'store' ? 'webp' : 'png',
  };
}

async function ensureUvTemplateAssets() {
  if (await exists(UV_BASE) && await exists(UV_MASK) && await exists(UV_GUIDE)) return;
  execFileSync('python3', ['scripts/build-kit-uv-template.py'], { cwd: GAME_ROOT, stdio: 'inherit' });
}

function dataUri(file) {
  const b64 = fsSync.readFileSync(file).toString('base64');
  return `data:image/png;base64,${b64}`;
}

async function saveImageResult(result, dest) {
  const url = findUrl(result, ['png', 'jpg', 'jpeg', 'webp']) || findUrl(result, []);
  if (url) {
    await download(url, dest);
    return;
  }

  const dataUri = findDataUri(result);
  if (dataUri) {
    const b64 = dataUri.split(',', 2)[1];
    fsSync.mkdirSync(path.dirname(dest), { recursive: true });
    fsSync.writeFileSync(dest, Buffer.from(b64, 'base64'));
    return;
  }

  throw new Error(`Fal response did not include an image URL: ${JSON.stringify(result).slice(0, 400)}`);
}

function findDataUri(obj) {
  const stack = [obj];
  while (stack.length) {
    const value = stack.pop();
    if (typeof value === 'string' && value.startsWith('data:image/')) return value;
    if (value && typeof value === 'object') stack.push(...Object.values(value));
  }
  return null;
}

async function loadTeams() {
  const files = (await fs.readdir(TEAMS_DIR)).filter((f) => f.endsWith('.json')).sort();
  return Promise.all(files.map(async (file) => JSON.parse(await fs.readFile(path.join(TEAMS_DIR, file), 'utf8'))));
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}
