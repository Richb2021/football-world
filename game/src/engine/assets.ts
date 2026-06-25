import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CommentaryManifest } from './commentary';

export interface GameAssets {
  baseUrl: string;
  manifest: Record<string, string>;
  commentaryManifest: CommentaryManifest | null;
  textures: Partial<Record<'grass' | 'crowd' | 'pitchDetail' | 'stadiumBowl' | 'stadiumBowlNight', THREE.Texture>>;
  visualTextures: Record<string, THREE.Texture>;
  uiUrls: Partial<Record<'menuHero' | 'teamSelect' | 'prematchStadium' | 'icon', string>>;
  player: { scene: THREE.Group; clips: THREE.AnimationClip[] } | null;
  trophy: THREE.Group | null;
  dugout: THREE.Group | null;
  tunnel: THREE.Group | null;
  audio: Record<string, AudioBuffer>;
  audioCtx: AudioContext;
  /** resolves when the deferred (menu "radio") music has finished loading in the
   *  background — those tracks are NOT on the startup critical path */
  audioReady: Promise<void>;
}

const BASE = import.meta.env.BASE_URL;

/**
 * Remove root motion from a clip. The sim owns the player's displacement —
 * a clip that also travels (slides, leaps) makes the visual race metres
 * ahead of the sim position and snap back when it ends. ALL position
 * components freeze at their first-frame values: the Meshy rig's track axes
 * don't line up with world axes (a "vertical" component can be lateral
 * drift), so poses come from the rotation tracks alone.
 */
function stripRootMotion(clip: THREE.AnimationClip) {
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.position')) continue;
    const v = track.values;
    for (let i = 3; i < v.length; i += 3) {
      v[i] = v[0];
      v[i + 1] = v[1];
      v[i + 2] = v[2];
    }
  }
}

/**
 * Mirror a skeletal clip across the rig's lateral (X) axis: Left/Right bone
 * tracks swap, X positions negate, and quaternions conjugate through the
 * mirror plane (negate y and z). Standard mixamo-style rig mirroring.
 */
function mirrorClip(src: THREE.AnimationClip, name: string): THREE.AnimationClip {
  const clip = src.clone();
  clip.name = name;
  for (const track of clip.tracks) {
    track.name = track.name.replace(/(Left|Right)/g, (m) => (m === 'Left' ? 'Right' : 'Left'));
    const values = track.values;
    if (track.name.endsWith('.position')) {
      for (let i = 0; i < values.length; i += 3) values[i] = -values[i];
    } else if (track.name.endsWith('.quaternion')) {
      for (let i = 0; i < values.length; i += 4) {
        values[i + 1] = -values[i + 1];
        values[i + 2] = -values[i + 2];
      }
    }
  }
  return clip;
}

export function audioAssetKeys(manifest: Record<string, string>): string[] {
  return Object.keys(manifest).filter((k) => k.startsWith('sfx_') || k.startsWith('music_'));
}

export async function loadAssets(onProgress: (msg: string, frac: number) => void): Promise<GameAssets> {
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const assets: GameAssets = {
    baseUrl: BASE,
    manifest: {},
    commentaryManifest: null,
    textures: {},
    visualTextures: {},
    uiUrls: {},
    player: null,
    trophy: null,
    dugout: null,
    tunnel: null,
    audio: {},
    audioCtx,
    audioReady: Promise.resolve(),
  };

  try {
    const res = await fetch(`${BASE}assets/manifest.json`);
    if (res.ok) assets.manifest = await res.json();
  } catch {
    console.warn('no asset manifest; using procedural fallbacks');
  }
  try {
    const res = await fetch(`${BASE}assets/commentary/manifest.json`);
    if (res.ok) assets.commentaryManifest = await res.json();
  } catch {
    // Commentary is optional; the ElevenLabs generator creates this manifest.
  }
  const m = assets.manifest;
  const url = (key: string) => (m[key] ? `${BASE}${m[key]}` : null);

  const texLoader = new THREE.TextureLoader();
  const loadTex = (key: string): Promise<THREE.Texture | null> => {
    const u = url(key);
    if (!u) return Promise.resolve(null);
    return new Promise((resolve) => {
      texLoader.load(u, (t) => resolve(t), undefined, () => resolve(null));
    });
  };

  onProgress('Mowing the pitch…', 0.1);
  const [grass, crowd, pitchDetail, stadiumBowl, stadiumBowlNight] = await Promise.all([
    loadTex('grass'), loadTex('crowd'), loadTex('pitchDetail'), loadTex('stadiumBowl'), loadTex('stadiumBowlNight'),
  ]);
  if (grass) { grass.wrapS = grass.wrapT = THREE.RepeatWrapping; grass.colorSpace = THREE.SRGBColorSpace; assets.textures.grass = grass; }
  if (crowd) { crowd.wrapS = crowd.wrapT = THREE.RepeatWrapping; crowd.colorSpace = THREE.SRGBColorSpace; assets.textures.crowd = crowd; }
  if (pitchDetail) { pitchDetail.wrapS = pitchDetail.wrapT = THREE.RepeatWrapping; pitchDetail.colorSpace = THREE.SRGBColorSpace; assets.textures.pitchDetail = pitchDetail; }
  for (const [key, tex] of [['stadiumBowl', stadiumBowl], ['stadiumBowlNight', stadiumBowlNight]] as const) {
    if (!tex) continue;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    assets.textures[key] = tex;
  }

  const visualKeys = Object.keys(m).filter((k) => k.startsWith('badge_'));
  await Promise.all(visualKeys.map(async (key) => {
    const tex = await loadTex(key);
    if (!tex) return;
    tex.colorSpace = THREE.SRGBColorSpace;
    assets.visualTextures[key] = tex;
  }));

  assets.uiUrls.menuHero = url('menuHero') ?? undefined;
  assets.uiUrls.teamSelect = url('teamSelect') ?? undefined;
  assets.uiUrls.prematchStadium = url('prematchStadium') ?? undefined;
  assets.uiUrls.icon = url('icon') ?? undefined;

  onProgress('Signing the players…', 0.3);
  const gltfLoader = new GLTFLoader();
  const loadGltf = (u: string | null) => new Promise<any | null>((resolve) => {
    if (!u) return resolve(null);
    gltfLoader.load(u, (g) => resolve(g), undefined, (e) => { console.warn('gltf failed', u, e); resolve(null); });
  });

  const riggedUrl = url('playerRigged') ?? url('playerAnim_running_glb_url');
  const rigged = await loadGltf(riggedUrl);
  if (rigged) {
    const clips: THREE.AnimationClip[] = [...(rigged.animations || [])];
    onProgress('Teaching them to run…', 0.45);
    // clip donor GLBs share the rig's skeleton; renamed clip names must avoid
    // the 'run'/'walk' substrings the action mapper keys on
    const CLIP_DONORS: [manifestKey: string, clipName: string][] = [
      ['playerAnim_running_armature_glb_url', 'run'],
      ['playerAnim_walking_armature_glb_url', 'walk'],
      ['playerAnim_gk_dive', 'gkdive'],
      ['playerAnim_gk_dive_low', 'gkdivelow'],
      ['playerAnim_gk_smother', 'gksmother'],
      ['playerAnim_gk_throw', 'gkthrowclip'],
      ['playerAnim_header', 'headerjump'],
      ['playerAnim_kick', 'kickball'],
      ['playerAnim_slide_tackle', 'slidetackle'],
      ['playerAnim_standing_tackle', 'standtackle'],
      ['playerAnim_celebrate', 'celebrate0'],
      ['playerAnim_celebrate_jump', 'celebrate1'],
      ['playerAnim_celebrate_cheer', 'celebrate2'],
      ['playerAnim_idle', 'idlestand'],
      ['playerAnim_tired_idle', 'idletired'],
    ];
    const donors = await Promise.all(CLIP_DONORS.map(([key]) => loadGltf(url(key))));
    donors.forEach((g, i) => {
      if (g?.animations?.length) {
        const clip = g.animations[0].clone();
        clip.name = CLIP_DONORS[i][1];
        // run/walk are already authored in place; the action-library clips
        // (slides, dives, leaps) carry root motion that fights the sim
        if (i >= 2) stripRootMotion(clip);
        clips.push(clip);
      }
    });
    // the library only has a dive-right clip; the dive-left is its mirror
    const dive = clips.find((c) => c.name === 'gkdive');
    if (dive) clips.push(mirrorClip(dive, 'gkdivemirror'));
    assets.player = { scene: rigged.scene, clips };
  }

  onProgress('Polishing the silverware…', 0.6);
  const trophy = await loadGltf(url('trophy'));
  if (trophy) assets.trophy = trophy.scene;
  const dugout = await loadGltf(url('dugout'));
  if (dugout) assets.dugout = dugout.scene;
  const tunnel = await loadGltf(url('tunnel'));
  if (tunnel) assets.tunnel = tunnel.scene;

  onProgress('Warming up the crowd…', 0.7);
  const loadOne = async (k: string) => {
    try {
      const res = await fetch(`${BASE}${m[k]}`);
      const buf = await res.arrayBuffer();
      assets.audio[k] = await audioCtx.decodeAudioData(buf);
    } catch (e) {
      console.warn('audio failed', k, e);
    }
  };
  const allAudio = audioAssetKeys(m);
  // The heavy menu "radio" music (~25MB+) is NOT needed to start: the title
  // track (music_menu) + match SFX are. Load those now, defer the rest to a
  // background fetch so startup isn't blocked on cellular.
  const isDeferred = (k: string) => k.startsWith('music_') && k !== 'music_menu';
  const critical = allAudio.filter((k) => !isDeferred(k));
  const deferred = allAudio.filter(isDeferred);
  let done = 0;
  await Promise.all(critical.map(async (k) => {
    await loadOne(k);
    done++;
    onProgress('Warming up the crowd…', 0.7 + 0.3 * (done / Math.max(1, critical.length)));
  }));
  assets.audioReady = Promise.all(deferred.map(loadOne)).then(() => undefined);

  onProgress('Ready', 1);
  return assets;
}
