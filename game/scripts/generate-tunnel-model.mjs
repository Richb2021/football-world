/**
 * Meshy image-to-3D: turn the Fal/GPT-Image-2 tunnel concept art into a 3D .glb
 * the match renderer loads as the pitchside players' tunnel.
 * Run: node scripts/generate-tunnel-model.mjs [tunnel_1|tunnel_2]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS, log, meshyPost, meshyWait, download, updateManifest, findUrl } from '../../tools/asset-pipeline/common.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MODELS = path.join(ASSETS, 'models');
const which = process.argv[2] || 'tunnel_2';
const src = path.join(here, '..', '.tmp/tunnel-concept', `${which}.png`);

fs.mkdirSync(MODELS, { recursive: true });
const dataUri = `data:image/png;base64,${fs.readFileSync(src).toString('base64')}`;

log(`--- tunnel: image-to-3d from ${which} ---`);
const sub = await meshyPost('/openapi/v1/image-to-3d', {
  image_url: dataUri,
  ai_model: 'meshy-5',
  should_texture: true,
  should_remesh: true,
  target_polycount: 14000,
  enable_pbr: false,
  target_formats: ['glb'],
});
const task = await meshyWait('/openapi/v1/image-to-3d', sub.result || sub.id, { pollMs: 8000, timeoutMs: 1500000 });
fs.writeFileSync(path.join(MODELS, 'tunnel.task.json'), JSON.stringify(task, null, 2));
const glb = task.model_urls?.glb || findUrl(task, ['glb']);
if (!glb) throw new Error(`no glb in task: ${JSON.stringify(task).slice(0, 300)}`);
await download(glb, path.join(MODELS, 'tunnel.glb'));
updateManifest({ tunnel: 'assets/models/tunnel.glb' });
log('tunnel model done -> assets/models/tunnel.glb');
