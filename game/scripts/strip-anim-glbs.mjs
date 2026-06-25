// Strip meshes/materials/textures from Meshy animation GLBs, keeping only the
// skeleton + animation tracks. The engine only reads animations[0] from these
// files (assets.ts clip donors), so the 5.8MB embedded mesh+texture is dead
// weight in the PWA precache. Output: player_candidate_anim_<name>_armature.glb
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';

const MODELS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'models');
const RAW = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools', 'asset-pipeline', 'raw');

const io = new NodeIO();
const files = (await fs.readdir(RAW)).filter(
  (f) => /^player_candidate_anim_.+\.glb$/.test(f)
    && !f.includes('_armature')
    && !f.includes('_glb_url'), // legacy meshy rigging outputs keep their names
);

for (const file of files) {
  const src = path.join(RAW, file);
  const dest = path.join(MODELS, file.replace(/\.glb$/, '_armature.glb'));
  const doc = await io.read(src);
  const root = doc.getRoot();
  for (const node of root.listNodes()) {
    if (node.getMesh()) node.setMesh(null);
    if (node.getSkin()) node.setSkin(null);
  }
  for (const skin of root.listSkins()) skin.dispose();
  for (const mesh of root.listMeshes()) mesh.dispose();
  for (const mat of root.listMaterials()) mat.dispose();
  for (const tex of root.listTextures()) tex.dispose();
  await doc.transform(prune());
  await io.write(dest, doc);
  const before = (await fs.stat(src)).size;
  const after = (await fs.stat(dest)).size;
  console.log(`${file} -> ${path.basename(dest)}: ${(before / 1e6).toFixed(1)}MB -> ${(after / 1e3).toFixed(0)}kB`);
}
console.log('done');
