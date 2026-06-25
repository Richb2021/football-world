// Meshy pipeline: rigged footballer (preview -> refine -> rig) + trophy.
// Usage: node meshy.mjs [player|trophy|all]
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  ASSETS, log, meshyPost, meshyWait, download, updateManifest, findUrl,
} from './common.mjs';

const MODELS = path.join(ASSETS, 'models');

async function buildPlayer({ candidate = false, candidateModel = 'meshy-6' } = {}) {
  const prefix = candidate ? 'player_candidate' : 'player';
  const prompt = candidate
    ? 'Stylized low-poly association football soccer player in clean T-pose, athletic adult proportions, wearing only a simple soccer kit: plain white short sleeve jersey, plain neutral grey soccer shorts, plain white knee socks, black soccer boots, natural skin, short dark hair. No helmet, no shoulder pads, no gloves, no American football gear, no gridiron uniform.'
    : 'Stylized low-poly male soccer football player character, athletic build, plain white short-sleeve football shirt, light grey shorts, white socks, black boots, short dark hair, simple friendly face, game-ready character, clean silhouette';
  const texturePrompt = candidate
    ? 'Association football soccer kit only. Flat clean game texture. Jersey must be pure plain white. Soccer shorts must be pure neutral mid grey, not brown, tan, gold, orange, muddy, black or patterned. Knee socks pure plain white. Boots matte black. Skin and hair natural. No helmet, no shoulder pads, no gloves, no logos, no text, no badges, no numbers, no stripes, no patches, no dirt.'
    : 'Plain bright white football shirt with no logos or sponsors, plain mid-grey shorts, plain white socks, black boots, natural skin tone, short dark hair. Flat clean colors, no patterns, no text, bright and evenly lit.';

  log('--- player: preview ---');
  const preview = await meshyPost('/openapi/v2/text-to-3d', {
    mode: 'preview',
    prompt,
    negative_prompt: 'American football, gridiron football, helmet, shoulder pads, protective pads, gloves, black jersey, black shirt, black shorts, brown shorts, orange shorts, armor, mask, facemask, rugby',
    ai_model: candidate ? candidateModel : 'meshy-5',
    topology: 'quad',
    target_polycount: candidate ? 7000 : 9000,
    pose_mode: 't-pose',
    should_remesh: true,
    target_formats: ['glb'],
  });
  const previewTask = await meshyWait('/openapi/v2/text-to-3d', preview.result || preview.id);
  log('preview done', previewTask.id);
  fs.writeFileSync(path.join(MODELS, `${prefix}.preview.json`), JSON.stringify(previewTask, null, 2));
  if (candidate && previewTask.model_urls?.glb) {
    await download(previewTask.model_urls.glb, path.join(MODELS, `${prefix}_preview.glb`));
  }

  log('--- player: refine ---');
  const refine = await meshyPost('/openapi/v2/text-to-3d', {
    mode: 'refine',
    preview_task_id: previewTask.id,
    enable_pbr: false,
    texture_prompt: texturePrompt,
    target_formats: ['glb'],
    auto_size: true,
  });
  const refineTask = await meshyWait('/openapi/v2/text-to-3d', refine.result || refine.id);
  log('refine done', refineTask.id);
  fs.writeFileSync(path.join(MODELS, `${prefix}.refine.json`), JSON.stringify(refineTask, null, 2));
  if (refineTask.model_urls?.glb) {
    await download(refineTask.model_urls.glb, path.join(MODELS, `${prefix}_static.glb`));
  }

  log('--- player: rigging ---');
  const rig = await meshyPost('/openapi/v1/rigging', {
    input_task_id: refineTask.id,
    height_meters: 1.8,
  });
  const rigTask = await meshyWait('/openapi/v1/rigging', rig.result || rig.id);
  fs.writeFileSync(path.join(MODELS, `${prefix}.rig.json`), JSON.stringify(rigTask, null, 2));

  const r = rigTask.result || rigTask;
  const riggedGlb = findUrl(r.rigged_character_glb_url ? { u: r.rigged_character_glb_url } : r, ['glb']);
  const saved = {};
  if (r.rigged_character_glb_url) {
    await download(r.rigged_character_glb_url, path.join(MODELS, `${prefix}_rigged.glb`));
    saved.playerRigged = `assets/models/${prefix}_rigged.glb`;
  } else if (riggedGlb) {
    await download(riggedGlb, path.join(MODELS, `${prefix}_rigged.glb`));
    saved.playerRigged = `assets/models/${prefix}_rigged.glb`;
  }
  // Animation outputs: walking/running glbs, names vary; grab everything glb-ish under animations
  const anims = r.basic_animations || r.animations || {};
  let i = 0;
  for (const [name, val] of Object.entries(anims)) {
    const url = typeof val === 'string' ? val : findUrl(val, ['glb']);
    if (url && /glb/i.test(url)) {
      const file = `${prefix}_anim_${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.glb`;
      await download(url, path.join(MODELS, file));
      saved[`playerAnim_${name}`] = `assets/models/${file}`;
      i++;
    }
  }
  if (!candidate) updateManifest({ ...saved, playerStatic: `assets/models/${prefix}_static.glb` });
  log('player pipeline complete,', i, 'animation files');
}

// Apply preset animation-library actions to the existing candidate rig task.
// Library: https://docs.meshy.ai/en/api/animation-library (no soccer-specific GK/header
// presets exist; these are the closest matches, finished procedurally in the renderer).
const CANDIDATE_CLIPS = {
  gk_dive: 465,        // Leap_Right_and_Catch (dive right; mirrored for left in-engine)
  gk_smother: 419,     // Jump_to_Catch_and_Fall (high claim / smother)
  header: 466,         // Regular_Jump (head flick layered procedurally)
  slide_tackle: 517,   // slide_right (running slide)
  standing_tackle: 213, // Leg_Sweep
  kick: 410,           // Kick_a_Soccer_Ball
  gk_throw: 421,       // Over_Shoulder_Throw (GK distribution / throw-in)
  gk_dive_low: 506,    // Dive_Down_and_Land (low forward dive / smother)
  gk_sprawl: 158,      // Roll_Dodge (GK sprawl recovery)
  celebrate: 59,       // Victory_Cheer
  celebrate_jump: 61,  // happy_jump_m
  celebrate_cheer: 49, // Motivational_Cheer
  idle: 0,             // Idle (proper standing stance)
  tired_idle: 31,      // Catching_Breath (low-stamina idle)
};

async function animateCandidate() {
  // raw downloads (mesh+texture, ~6MB each) stay OUT of game/public — only the
  // stripped armature-only clips (scripts/strip-anim-glbs.mjs) ship in the PWA
  const RAW = path.join(path.dirname(fileURLToPath(import.meta.url)), 'raw');
  fs.mkdirSync(RAW, { recursive: true });
  const rigJson = JSON.parse(fs.readFileSync(path.join(MODELS, 'player_candidate.rig.json'), 'utf8'));
  const rigTaskId = rigJson.id;
  log('animating rig task', rigTaskId);
  for (const [name, actionId] of Object.entries(CANDIDATE_CLIPS)) {
    const dest = path.join(RAW, `player_candidate_anim_${name}.glb`);
    if (fs.existsSync(dest)) { log(`skip ${name} (exists)`); continue; }
    log(`--- animation: ${name} (action ${actionId}) ---`);
    const t = await meshyPost('/openapi/v1/animations', { rig_task_id: rigTaskId, action_id: actionId });
    const task = await meshyWait('/openapi/v1/animations', t.result || t.id);
    fs.writeFileSync(path.join(RAW, `player_candidate.anim.${name}.json`), JSON.stringify(task, null, 2));
    const r = task.result || task;
    const url = r.animation_glb_url || findUrl(r, ['glb']);
    if (!url) throw new Error(`no GLB url for ${name}: ${JSON.stringify(task).slice(0, 300)}`);
    await download(url, dest);
    log(`${name} saved`);
  }
  log('candidate animations complete — run `node game/scripts/strip-anim-glbs.mjs` to ship them');
}

async function buildProp(name, prompt, texturePrompt, polycount, manifestKey) {
  log(`--- ${name}: preview ---`);
  const preview = await meshyPost('/openapi/v2/text-to-3d', {
    mode: 'preview',
    prompt,
    ai_model: 'meshy-5',
    topology: 'triangle',
    target_polycount: polycount,
    should_remesh: true,
    target_formats: ['glb'],
  });
  const previewTask = await meshyWait('/openapi/v2/text-to-3d', preview.result || preview.id);
  const refine = await meshyPost('/openapi/v2/text-to-3d', {
    mode: 'refine',
    preview_task_id: previewTask.id,
    enable_pbr: false,
    texture_prompt: texturePrompt,
    target_formats: ['glb'],
  });
  const refineTask = await meshyWait('/openapi/v2/text-to-3d', refine.result || refine.id);
  if (refineTask.model_urls?.glb) {
    await download(refineTask.model_urls.glb, path.join(MODELS, `${name}.glb`));
    updateManifest({ [manifestKey]: `assets/models/${name}.glb` });
  }
  log(`${name} prop complete`);
}

async function buildTrophy() {
  log('--- trophy: preview ---');
  const preview = await meshyPost('/openapi/v2/text-to-3d', {
    mode: 'preview',
    prompt:
      'Golden football trophy cup with two handles on a dark wooden base, low poly game asset, ' +
      'elegant silhouette, championship trophy',
    ai_model: 'meshy-5',
    topology: 'triangle',
    target_polycount: 5000,
    should_remesh: true,
  });
  const previewTask = await meshyWait('/openapi/v2/text-to-3d', preview.result || preview.id);
  const refine = await meshyPost('/openapi/v2/text-to-3d', {
    mode: 'refine',
    preview_task_id: previewTask.id,
    enable_pbr: true,
    texture_prompt: 'Polished reflective gold metal trophy, dark walnut wood base, pristine',
  });
  const refineTask = await meshyWait('/openapi/v2/text-to-3d', refine.result || refine.id);
  if (refineTask.model_urls?.glb) {
    await download(refineTask.model_urls.glb, path.join(MODELS, 'trophy.glb'));
    updateManifest({ trophy: 'assets/models/trophy.glb' });
  }
  log('trophy pipeline complete');
}

async function rigSegmentedPlayer() {
  log('--- segmented player: build source ---');
  execFileSync('node', ['scripts/build-segmented-player.mjs'], {
    cwd: path.join(ASSETS, '../..'),
    stdio: 'inherit',
  });
  const source = path.join(MODELS, 'player_segmented_source.glb');
  const modelUrl = `data:application/octet-stream;base64,${fs.readFileSync(source).toString('base64')}`;

  log('--- segmented player: rigging ---');
  const rig = await meshyPost('/openapi/v1/rigging', {
    model_url: modelUrl,
    height_meters: 1.8,
  });
  const rigTask = await meshyWait('/openapi/v1/rigging', rig.result || rig.id);
  fs.writeFileSync(path.join(MODELS, 'player_segmented.rig.json'), JSON.stringify(rigTask, null, 2));
  const r = rigTask.result || rigTask;
  const saved = {};
  if (r.rigged_character_glb_url) {
    await download(r.rigged_character_glb_url, path.join(MODELS, 'player_segmented_rigged.glb'));
    saved.playerRigged = 'assets/models/player_segmented_rigged.glb';
  }
  const anims = r.basic_animations || r.animations || {};
  for (const [name, val] of Object.entries(anims)) {
    const url = typeof val === 'string' ? val : findUrl(val, ['glb']);
    if (!url || !/glb/i.test(url)) continue;
    const file = `player_segmented_anim_${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.glb`;
    await download(url, path.join(MODELS, file));
    saved[`playerAnim_${name}`] = `assets/models/${file}`;
  }
  log('segmented player rig complete');
  return saved;
}

const what = process.argv[2] || 'all';
fs.mkdirSync(MODELS, { recursive: true });
try {
  if (what === 'player' || what === 'all') await buildPlayer();
  if (what === 'player-candidate') await buildPlayer({ candidate: true });
  if (what === 'player-candidate-m5') await buildPlayer({ candidate: true, candidateModel: 'meshy-5' });
  if (what === 'player-segmented-rig') await rigSegmentedPlayer();
  if (what === 'animate-candidate') await animateCandidate();
  if (what === 'dugout') await buildProp(
    'dugout',
    'Football stadium dugout shelter: low bench for substitutes under a curved clear perspex roof with dark steel frame, open front, low poly game asset, clean silhouette',
    'Dark grey steel frame, translucent frosted perspex roof panels, dark padded bench seats, clean flat colours, no text, no logos',
    4000,
    'dugout',
  );
  if (what === 'trophy' || what === 'all') await buildTrophy();
  log('MESHY PIPELINE DONE');
} catch (err) {
  console.error('MESHY PIPELINE ERROR:', err.message);
  process.exitCode = 1;
}
