import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { falQueue, download } from '../../tools/asset-pipeline/common.mjs';

const GAME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(GAME_ROOT, 'public/assets/journey/backgrounds');
const TMP_DIR = path.join(GAME_ROOT, '.tmp/journey-story-raw');

const jobs = [
  {
    key: 'hospital_room_1992',
    file: 'hospital_room_1992.png',
    prompt: 'Prerendered story mode background for a soccer video game. A 1990s British hospital room still, dramatic natural lighting through window, clean lower third for UI, cinematic realistic digital matte painting style, grit, no people, 16:9 landscape.'
  },
  {
    key: 'media_press_room_1992',
    file: 'media_press_room_1992.png',
    prompt: 'Prerendered story mode background for a soccer video game. A 1990s press room, microphones on table, folding chairs, flashbulbs, dramatic realistic digital matte painting style, grit, no people, 16:9 landscape.'
  }
];

// Helper to find URL in Fal response
const findUrl = (obj) => {
  const stack = [obj];
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === 'string' && (v.startsWith('http') || v.startsWith('data:image/'))) return v;
    if (v && typeof v === 'object') stack.push(...Object.values(v));
  }
  return null;
};

await fs.mkdir(TMP_DIR, { recursive: true });
await fs.mkdir(OUT_DIR, { recursive: true });

for (const job of jobs) {
  console.log(`Generating background: ${job.key}...`);
  const result = await falQueue('openai/gpt-image-2', {
    prompt: job.prompt,
    image_size: 'landscape_16_9',
    num_images: 1,
    quality: 'high',
    output_format: 'png',
  }, { pollMs: 3000, timeoutMs: 900000 });

  const url = findUrl(result);
  if (!url) throw new Error('No image in response for ' + job.key);

  const rawAbs = path.join(TMP_DIR, `${job.key}.png`);
  const outAbs = path.join(OUT_DIR, job.file);

  if (url.startsWith('data:image/')) {
    const b64 = url.split(',', 2)[1];
    await fs.writeFile(rawAbs, Buffer.from(b64, 'base64'));
  } else {
    await download(url, rawAbs);
  }

  console.log(`Post-processing background: ${job.key}...`);
  execFileSync('python3', [
    'scripts/postprocess-journey-asset.py',
    '--kind', 'background',
    '--input', rawAbs,
    '--output', outAbs
  ], { cwd: GAME_ROOT, stdio: 'inherit' });

  console.log(`Saved background: ${job.file}`);
}

console.log('All missing backgrounds successfully generated and saved!');
