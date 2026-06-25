/**
 * Meshy image-to-3D: turn the chosen pitchside concept art into .glb models the
 * renderer loads for the team DUGOUT and players' TUNNEL.
 * Run: node scripts/generate-pitchside-models.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS, log, meshyPost, meshyWait, download, updateManifest, findUrl } from '../../tools/asset-pipeline/common.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MODELS = path.join(ASSETS, 'models');
const CONCEPTS = path.join(here, '..', '.tmp/pitchside-concept');
fs.mkdirSync(MODELS, { recursive: true });

const JOBS = [
  { concept: 'dugout_a', out: 'dugout.glb', key: 'dugout', poly: 16000 },
  { concept: 'tunnel_b', out: 'tunnel.glb', key: 'tunnel', poly: 16000 },
];

async function run({ concept, out, key, poly }) {
  const src = path.join(CONCEPTS, `${concept}.png`);
  const dataUri = `data:image/png;base64,${fs.readFileSync(src).toString('base64')}`;
  log(`--- ${key}: image-to-3d from ${concept} ---`);
  const sub = await meshyPost('/openapi/v1/image-to-3d', {
    image_url: dataUri,
    ai_model: 'meshy-5',
    should_texture: true,
    should_remesh: true,
    target_polycount: poly,
    enable_pbr: false,
    target_formats: ['glb'],
  });
  const task = await meshyWait('/openapi/v1/image-to-3d', sub.result || sub.id, { pollMs: 8000, timeoutMs: 1500000 });
  const glb = task.model_urls?.glb || findUrl(task, ['glb']);
  if (!glb) throw new Error(`no glb for ${key}: ${JSON.stringify(task).slice(0, 250)}`);
  await download(glb, path.join(MODELS, out));
  updateManifest({ [key]: `assets/models/${out}` });
  log(`${key} done -> assets/models/${out}`);
}

await Promise.all(JOBS.map(run));
log('pitchside models complete');
