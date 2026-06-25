// Fal GPT-Image-2.0 texture / art generation.
// Usage: node fal-images.mjs [key ...]  (default: all)
import path from 'node:path';
import fs from 'node:fs';
import { ASSETS, falQueue, findUrl, download, updateManifest, log } from './common.mjs';

const JOBS = {
  grass: {
    dir: 'textures', file: 'grass.png', size: 'square_hd',
    prompt:
      'Seamless tileable texture of lush football pitch grass viewed directly from above, ' +
      'top-down orthographic, fine green grass blades, even lighting, no shadows, no objects, ' +
      'no lines, uniform tone suitable for tiling in a video game',
  },
  crowd: {
    dir: 'textures', file: 'crowd.png', size: 'square_hd',
    prompt:
      'Seamless tileable texture of a packed football stadium crowd seen from a distance, ' +
      'thousands of tiny fans in seats, colourful scarves and jackets in muted varied colours, ' +
      'flat even lighting, no large structures, fills entire frame edge to edge, video game texture',
  },
  menuHero: {
    dir: 'ui', file: 'menu_hero.png', size: 'landscape_16_9',
    prompt:
      'Dramatic stylized illustration for a retro-modern football video game title screen: ' +
      'low camera angle of a 1990s English footballer in generic unbranded red kit striking a ball, ' +
      'floodlit stadium at night behind, bold graphic shapes, teal and magenta rim lighting, ' +
      'clean modern flat-shaded art style with halftone accents, no text, no logos',
  },
  teamSelect: {
    dir: 'ui', file: 'team_select_bg.png', size: 'landscape_16_9',
    prompt:
      'Atmospheric wide shot of an empty 1990s English football stadium at dusk, floodlights glowing, ' +
      'mist over the pitch, terraces and stands in shadow, cinematic teal-and-orange grade, ' +
      'soft focus background plate for a video game menu, no people, no text',
  },
  icon: {
    dir: 'ui', file: 'icon.png', size: 'square_hd',
    prompt:
      'Flat bold app icon emblem for a football game: stylized white football over a green and dark-navy ' +
      'shield, retro 90s geometric stripes, crisp vector style, centered, plain dark background, no text',
  },
  pitchDetail: {
    dir: 'textures', file: 'pitch_dirt.png', size: 'square_hd',
    prompt:
      'Seamless tileable top-down texture of slightly worn football pitch grass with subtle mud patches ' +
      'and stud marks, mostly green, even flat lighting, video game ground texture, no lines no objects',
  },
  stadiumBowl: {
    dir: 'textures', file: 'stadium_bowl.png', size: 'landscape_16_9',
    prompt:
      'Seamless horizontally tileable panorama of a packed 1990s English football stadium upper tier seen ' +
      'from the pitch: two decks of crowded terraces full of tiny fans, steel roof with floodlight glow ' +
      'spilling over the rim, dusk sky strip above, advertising boards line at the bottom edge, ' +
      'even lighting, edges must wrap perfectly left to right, prerendered video game backdrop, no text',
  },
  stadiumBowlNight: {
    dir: 'textures', file: 'stadium_bowl_night.png', size: 'landscape_16_9',
    prompt:
      'Seamless horizontally tileable panorama of a packed football stadium upper tier at night under ' +
      'floodlights: dark steel roof, two glowing terraces of thousands of tiny fans, deep navy night sky ' +
      'strip above the roofline, camera flashes sparkling in the crowd, edges wrap perfectly left to ' +
      'right, prerendered video game backdrop, no text, no logos',
  },
};

async function run(key) {
  const job = JOBS[key];
  const dest = path.join(ASSETS, job.dir, job.file);
  log('--- image:', key, '---');
  const res = await falQueue('openai/gpt-image-2', {
    prompt: job.prompt,
    image_size: job.size,
    num_images: 1,
    quality: 'high',
    output_format: 'png',
  });
  const url = findUrl(res, ['png', 'jpg', 'jpeg', 'webp']) || findUrl(res, []);
  if (!url) throw new Error(`no image url for ${key}: ${JSON.stringify(res).slice(0, 400)}`);
  if (url.startsWith('data:')) {
    const b64 = url.split(',', 2)[1];
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(b64, 'base64'));
    log('saved (data uri)', dest);
  } else {
    await download(url, dest);
  }
  updateManifest({ [key]: `assets/${job.dir}/${job.file}` });
}

const keys = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(JOBS);
let failed = 0;
for (const key of keys) {
  try { await run(key); } catch (e) { failed++; console.error(`IMAGE ${key} FAILED:`, e.message); }
}
log(`FAL IMAGES DONE (${keys.length - failed}/${keys.length} ok)`);
process.exitCode = failed === keys.length ? 1 : 0;
