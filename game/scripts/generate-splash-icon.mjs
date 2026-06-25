import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { falQueue, download, ASSETS } from '../../tools/asset-pipeline/common.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const prompt = [
  'A bold retro sports badge icon for a soccer video game set in the 1992/93 season.',
  'Centre: a classic black-and-white soccer ball (association football, round ball with black hexagonal panels on white).',
  'Surrounding shape: a classic five-sided shield / crest outline in gold (#ffd400).',
  'Style: clean vector graphic, bold thick outlines, slightly worn retro feel matching early-1990s arcade games.',
  'The shield should have a thin double-border inner line in gold.',
  'No text, no letters, no wordmark.',
  'Fully transparent background — nothing outside the badge shape.',
  'The subject is soccer (association football) — round ball with black pentagon patches — NOT American football, NOT rugby.',
].join(' ');

console.log('Requesting icon from fal / gpt-image-2…');
const result = await falQueue('openai/gpt-image-2', {
  prompt,
  image_size: 'square_hd',
  num_images: 1,
  quality: 'high',
  output_format: 'png',
  background: 'transparent',
});

// Handle URL or inline data URI
const findUrl = (obj) => {
  const stack = [obj];
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === 'string' && (v.startsWith('http') || v.startsWith('data:image/'))) return v;
    if (v && typeof v === 'object') stack.push(...Object.values(v));
  }
  return null;
};

const url = findUrl(result);
if (!url) throw new Error('No image in response: ' + JSON.stringify(result).slice(0, 300));

await fs.mkdir(OUT, { recursive: true });
const dest512 = path.join(OUT, 'icon-512.png');
const dest192 = path.join(OUT, 'icon-192.png');

if (url.startsWith('data:image/')) {
  const b64 = url.split(',', 2)[1];
  const buf = Buffer.from(b64, 'base64');
  await fs.writeFile(dest512, buf);
  console.log('Saved icon-512.png', buf.length, 'bytes');
} else {
  await download(url, dest512);
}

await fs.copyFile(dest512, dest192);
console.log('Done — icons written to public/icons/');
