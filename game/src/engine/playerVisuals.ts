import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { KitColors, KitStyle, PlayerAppearance, SimPlayer } from '../sim/types';
import type { GameAssets } from './assets';
import { buildKitVisualKey } from './appearance';
import { bakeBodyMap, type BodyMap } from './kitBodyMap';
import { tintKitTexture } from './kitTint';

const TARGET_HEIGHT = 1.92;
const GOALKEEPER_RECOVERY_DURATION = 0.72;
// flat-on-the-ground orientation for the selection ring, plus reusable scratch
const RING_FLAT_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const _ringQ = new THREE.Quaternion();
const _ringV = new THREE.Vector3();

export interface PlayerCreateOptions {
  kit: KitColors;
  appearance: PlayerAppearance;
  kitStyle: KitStyle;
  shirtNumber: number;
  teamId: string;
  side: 'home' | 'away' | 'gk';
  badgeTexture?: THREE.Texture;
  kitOverlayTexture?: THREE.Texture;
  kitOverlayMode?: 'pattern' | 'uv';
}

export interface PlayerActions {
  run?: THREE.AnimationAction;
  walk?: THREE.AnimationAction;
  idle?: THREE.AnimationAction;
  tired?: THREE.AnimationAction;
  gkDiveR?: THREE.AnimationAction;
  gkDiveL?: THREE.AnimationAction;
  smother?: THREE.AnimationAction;
  gkThrow?: THREE.AnimationAction;
  header?: THREE.AnimationAction;
  kick?: THREE.AnimationAction;
  slide?: THREE.AnimationAction;
  tackle?: THREE.AnimationAction;
  fall?: THREE.AnimationAction;
  fallForward?: THREE.AnimationAction;
  getup?: THREE.AnimationAction;
  getupFront?: THREE.AnimationAction;
  celebrate?: THREE.AnimationAction[];
}

export interface PlayerVisual {
  group: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  actions: PlayerActions;
  ring: THREE.Mesh;
  current: string;
  baseRotY: number;
  visualRotY: number;
  /** the one-shot/looping special action currently playing, if any */
  special?: THREE.AnimationAction | null;
  /** elapsed seconds inside the current procedural dive/smother */
  diveTime?: number;
  /** direction of the roll/dive (computed once at initiation) */
  diveSide?: number;
  /** pose held at the end of a dive, unwound during recovery */
  diveRoll?: number;
  divePitch?: number;
  /** yaw held through a save so the keeper does not snap toward the dive vector */
  diveYaw?: number;
  /** seconds left of getting back to his feet */
  recoverTime?: number;
  /** elapsed seconds inside a procedural 'fall' (foul / hard tackle), the side he
   * topples, and how hard the hit was (captured at fall start, drives the size) */
  fallTime?: number;
  fallSide?: number;
  fallPower?: number;
  /** which mocap clip is playing during a fall: the knock-down or the get-up */
  fallStage?: 'down' | 'up';
  /** latched idle<->run state, with hysteresis, so a player hovering at the speed
   * threshold doesn't flicker between standing and running every frame */
  locoMoving?: boolean;
  /** whether the current/last keeper save was a forward rush-out (smother/spread) vs a
   * lateral line dive — latched at dive start so the held-ball renderer stays correct even
   * after the sim clears diveKind mid-hold */
  diveRunOut?: boolean;
  /** arm bones for the procedural throw-in pose, resolved lazily */
  armBones?: { upper: THREE.Object3D; lower: THREE.Object3D; hand: THREE.Object3D | null; side: 1 | -1 }[] | null;
  /** smoothed (rendered) ground position. Lags the sim position ONLY across a sudden
   * snap (e.g. a keeper's body aligned to the ball as he makes a save) so it slides in
   * rather than teleporting. Normal running tracks the sim exactly; large jumps (resets)
   * snap. Render-only — never read by the sim. */
  rx?: number;
  rz?: number;
  rInit?: boolean;
}

type PlayerMaterialRole = 'kit' | 'skin' | 'hair' | 'boot';

const MATCH_PLAYER_SHADER_KEY = 'match-player-shape-v1';

// The custom rim/ground-shade injection is a cosmetic flourish. Some GPUs (notably
// Qualcomm Adreno on Snapdragon Windows-on-ARM, and software renderers) mis-handle
// the injected shader chunk and render every player solid black. On those we skip
// the injection entirely — players keep their correct kit materials and scene
// lighting, just without the subtle rim/ground gradient. See setMatchPlayerShaderEnabled.
let matchPlayerShaderEnabled = true;
export function setMatchPlayerShaderEnabled(on: boolean) { matchPlayerShaderEnabled = on; }

/**
 * Given an unmasked WebGL renderer string, decide whether this GPU can be trusted
 * with the custom player-shading chunk. Qualcomm Adreno (Snapdragon Windows-on-ARM
 * / Copilot+ PCs) and software renderers draw every player solid black with it, so
 * they opt out. An empty/unknown string is treated as capable (desktop/laptop GPUs
 * handle it fine, and we don't want to needlessly drop the flourish everywhere).
 */
export function gpuHandlesMatchPlayerShader(rendererName: string): boolean {
  const name = (rendererName || '').toLowerCase();
  if (!name) return true;
  return !/adreno|qualcomm|swiftshader|software|llvmpipe|microsoft basic/.test(name);
}

export function applyMatchPlayerShading(mat: THREE.MeshStandardMaterial, role: PlayerMaterialRole = 'kit') {
  if (mat.userData.matchPlayerShader) return;
  const profile = {
    kit: { roughness: 0.84, rim: 0.07, ground: 0.24, env: 0.28 },
    skin: { roughness: 0.7, rim: 0.045, ground: 0.16, env: 0.18 },
    hair: { roughness: 0.78, rim: 0.035, ground: 0.12, env: 0.12 },
    boot: { roughness: 0.62, rim: 0.04, ground: 0.2, env: 0.22 },
  }[role];
  mat.roughness = profile.roughness;
  mat.metalness = 0;
  mat.envMapIntensity = profile.env;
  mat.flatShading = false;
  mat.userData.matchPlayerShader = true;
  // base material props above are safe everywhere; only the shader injection below
  // is GPU-fragile, so bail out here on renderers that can't handle it
  if (!matchPlayerShaderEnabled) return;
  const previousCompile = mat.onBeforeCompile.bind(mat);
  const previousKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    previousCompile(shader, renderer);
    shader.uniforms.matchRimColor = { value: new THREE.Color(0xffffff) };
    shader.uniforms.matchRimStrength = { value: profile.rim };
    shader.uniforms.matchGroundShade = { value: profile.ground };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vMatchWorldPosition;',
      )
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvMatchWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vMatchWorldPosition;\nuniform vec3 matchRimColor;\nuniform float matchRimStrength;\nuniform float matchGroundShade;',
      )
      .replace(
        '#include <dithering_fragment>',
        [
          'float matchRim = pow(1.0 - saturate(abs(dot(normalize(normal), normalize(vViewPosition)))), 2.0);',
          'float matchLowerBody = saturate(1.0 - vMatchWorldPosition.y * 0.72);',
          'gl_FragColor.rgb *= 1.0 - matchLowerBody * matchGroundShade;',
          'gl_FragColor.rgb += matchRimColor * matchRim * matchRimStrength;',
          '#include <dithering_fragment>',
        ].join('\n'),
      );
  };
  mat.customProgramCacheKey = () => `${previousKey()}|${MATCH_PLAYER_SHADER_KEY}|${role}`;
  mat.needsUpdate = true;
}

export function resolvePlayerDiveSide(p: Pick<SimPlayer, 'diveSide' | 'facing' | 'vel'>): number {
  if (p.diveSide === -1 || p.diveSide === 1) return p.diveSide;
  const f = { x: Math.cos(p.facing), y: Math.sin(p.facing) };
  return Math.sign(f.x * p.vel.y - f.y * p.vel.x) || 1;
}

export function goalkeeperRecoveryPose(
  remaining: number,
  roll: number,
  pitch: number,
): { roll: number; pitch: number; height: number; diveWeight: number; standWeight: number } {
  const elapsed = clamp01(1 - remaining / GOALKEEPER_RECOVERY_DURATION);
  // A real getup is NOT the dive played backwards. The keeper first rolls off his
  // side onto his front, plants and leans forward to push up, then rises to his
  // feet — an asymmetric sequence, so each component runs on its own curve.
  // 1) come off the side quickly (no slow rewind of the fall)
  const offSide = 1 - smoothstep(clamp01(elapsed / 0.38));
  // 2) push up onto the feet over the back half
  const rise = smoothstep(clamp01((elapsed - 0.28) / 0.62));
  // 3) a forward crouch lean while planting and pushing up — a hump, gone by the end
  const push = Math.sin(clamp01(elapsed) * Math.PI);
  const CROUCH_LEAN = 0.5;
  // the dive limb-clip leaves the blend almost immediately so the keeper isn't
  // frozen in the save pose while he gathers himself
  const diveWeight = 1 - smoothstep(clamp01((elapsed - 0.05) / 0.16));
  const stand = 1 - rise;
  return {
    roll: roll * offSide,
    pitch: pitch * offSide - CROUCH_LEAN * push * stand,
    height: 0.14 * stand,
    diveWeight,
    standWeight: 1 - diveWeight,
  };
}

export function kitNumberPalette(numberColor: string | undefined, shirtColor: string): { fill: string; stroke: string } {
  const fill = normalizeHexColor(numberColor ?? readableTextColor(shirtColor));
  return {
    fill,
    stroke: readableTextColor(fill),
  };
}

/** Build per-kit tinted materials once, then clone the rig for each player. */
export class PlayerFactory {
  private assets: GameAssets;
  private kitTexCache = new Map<string, THREE.Texture>();
  private modelYaw = Math.PI / 2; // most humanoid rigs face +z; align them to sim +x
  private bodyMap: BodyMap | null;

  constructor(assets: GameAssets) {
    this.assets = assets;
    // one-time UV->body bake so kit patterns paint in body space
    this.bodyMap = assets.player ? bakeBodyMap(assets.player.scene) : null;
  }

  create(options: PlayerCreateOptions, scale = 1): PlayerVisual {
    const { kit, appearance, kitStyle } = options;
    const group = new THREE.Group();
    let mixer: THREE.AnimationMixer | null = null;
    const actions: PlayerVisual['actions'] = {};

    if (this.assets.player) {
      const rig = skeletonClone(this.assets.player.scene);
      // normalize size — Box3.setFromObject ignores bone transforms on skinned
      // meshes, so measure with the skeleton applied
      const box = measureRig(rig);
      const h = box.max.y - box.min.y || 1;
      const s = (TARGET_HEIGHT / h) * scale;
      rig.scale.setScalar(s);
      rig.position.y = -box.min.y * s;
      rig.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.frustumCulled = false; // skinned meshes pop otherwise
          const mat = mesh.material as THREE.MeshStandardMaterial;
          const label = `${mesh.name} ${mat?.name ?? ''}`.toLowerCase();
          if (mat?.map) {
            const key = `${buildKitVisualKey(kit, kitStyle, options.shirtNumber, options.teamId, options.side)}|${appearance.skinTone}|${mat.map.uuid}|${options.kitOverlayTexture?.uuid ?? ''}`;
            let tex = this.kitTexCache.get(key);
            if (!tex) {
              tex = tintKitTexture(mat.map, kit, {
                appearance,
                style: kitStyle,
                kitOverlayImage: options.kitOverlayTexture?.image as CanvasImageSource | undefined,
                kitOverlayMode: options.kitOverlayMode,
                bodyMap: this.bodyMap,
                shirtNumber: options.shirtNumber,
              });
              this.kitTexCache.set(key, tex);
            }
            const newMat = mat.clone();
            newMat.map = tex;
            // Meshy exports fully-emissive materials (emissiveTexture + factor 1):
            // the untinted emissive layer washes out the kit tint, so drop it and
            // let the scene lights do the shading
            newMat.emissive = new THREE.Color(0x000000);
            newMat.emissiveMap = null;
            applyMatchPlayerShading(newMat, 'kit');
            mesh.material = newMat;
          } else if (mat) {
            const newMat = mat.clone();
            applyCosmeticMaterial(newMat, label, appearance);
            applyMatchPlayerShading(newMat, materialRoleFromLabel(label));
            mesh.material = newMat;
          }
        }
      });
      group.add(rig);
      // numbers and badges are baked into the kit texture when a body map
      // exists; floating decal planes are only needed for the fallback player
      if (!this.bodyMap) group.add(buildKitDecals(options, scale));
      mixer = new THREE.AnimationMixer(rig);
      for (const clip of this.assets.player.clips) {
        const name = clip.name.toLowerCase();
        const action = mixer.clipAction(clip);
        action.enabled = true;
        if (name === 'gkdive') actions.gkDiveR = action;
        else if (name === 'gkdivemirror') actions.gkDiveL = action;
        else if (name === 'gkdivelow') actions.smother = action;
        else if (name === 'gksmother') { if (!actions.smother) actions.smother = action; }
        else if (name === 'gkthrowclip') actions.gkThrow = action;
        else if (name === 'headerjump') actions.header = action;
        else if (name === 'kickball') actions.kick = action;
        else if (name === 'slidetackle') actions.slide = action;
        else if (name === 'standtackle') actions.tackle = action;
        else if (name === 'fall') actions.fall = action;
        else if (name === 'fallforward') actions.fallForward = action;
        else if (name === 'getup') actions.getup = action;
        else if (name === 'getupfront') actions.getupFront = action;
        else if (name.startsWith('celebrate')) (actions.celebrate ??= []).push(action);
        else if (name === 'idlestand') actions.idle = action;
        else if (name === 'idletired') actions.tired = action;
        else if (name.includes('run')) actions.run = action;
        else if (name.includes('walk')) actions.walk = action;
        else if (!actions.run) actions.run = action;
      }
      (actions.run ?? actions.walk)?.play();
    } else {
      group.add(buildFallbackPlayer(options, scale));
    }

    // selection ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.75, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe24a, transparent: true, opacity: 0.95, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    ring.visible = false;
    group.add(ring);

    // blob shadow (cheap, in addition to soft shadow map)
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.02;
    group.add(blob);

    return { group, mixer, actions, ring, current: 'idle', baseRotY: this.modelYaw, visualRotY: this.modelYaw, special: null };
  }

  /** advance animation according to sim state */
  update(v: PlayerVisual, p: SimPlayer, dt: number, replay = false, smooth = false) {
    v.group.visible = !p.sentOff;
    if (p.sentOff) return;
    // Keep the selection ring flat on the pitch at a fixed ground height, no matter how the
    // body tilts or drops during a dive/tackle. It's a child of the body group, so without
    // this it rotates with the body and sinks through the turf. Counter the group's world
    // rotation and vertical offset. (Uses the previous frame's body transform — a flat ring
    // is rotationally symmetric, so the sub-degree lag is invisible.)
    if (v.ring.visible) {
      const inv = _ringQ.copy(v.group.quaternion).invert();
      v.ring.quaternion.copy(inv).multiply(RING_FLAT_Q);
      _ringV.set(0, 0.05 - v.group.position.y, 0).applyQuaternion(inv);
      v.ring.position.copy(_ringV);
    }
    const speed = Math.hypot(p.vel.x, p.vel.y);
    // Render-side de-teleport. The sim resolves a save by snapping a body into place
    // (a keeper's y aligned to the ball, ~up to 2m) and the renderer otherwise sets the
    // ground position straight from the sim, so that snap reads as a teleport. Ease the
    // RENDERED position toward the sim one with a velocity-aware cap: genuine running
    // (gap <= cap) tracks exactly, a save snap slides in over a few frames, and a large
    // jump (a reset/restart, gap > 4m) is placed instantly. Off during replay / non-play.
    if (!smooth || !v.rInit) {
      v.rx = p.pos.x; v.rz = p.pos.y; v.rInit = true;
    } else {
      const dx = p.pos.x - (v.rx ?? p.pos.x);
      const dz = p.pos.y - (v.rz ?? p.pos.y);
      const gap = Math.hypot(dx, dz);
      const cap = (speed + 22) * dt;
      if (gap > 4 || gap <= cap || gap < 1e-4) {
        v.rx = p.pos.x; v.rz = p.pos.y;
      } else {
        v.rx = (v.rx ?? p.pos.x) + (dx / gap) * cap;
        v.rz = (v.rz ?? p.pos.y) + (dz / gap) * cap;
      }
    }
    v.group.position.set(v.rx ?? p.pos.x, 0, v.rz ?? p.pos.y);
    const a = v.actions;

    // resolve the sim state to a skeletal clip where one exists.
    // `fit` = the sim's window for the move (the clip is paced to land inside
    // it); `skip` = fraction of wind-up frames to jump so the actual action —
    // the leap, the strike — shows instead of the anticipation pose
    let special: { key: string; action: THREE.AnimationAction; fit?: number; skip?: number; loop?: boolean } | null = null;
    // NOTE: 'dive' and 'smother' deliberately stay procedural — the library
    // leap clips never go horizontal and read as a standing hop, not a save
    if (p.anim === 'slide' && a.slide) {
      special = { key: 'slide', action: a.slide, fit: 0.42, skip: 0.15 };
    } else if (p.anim === 'tackle' && a.tackle) {
      special = { key: 'tackle', action: a.tackle, fit: 0.5, skip: 0.1 };
    } else if (p.anim === 'header' && a.header) {
      special = { key: 'header', action: a.header, fit: 0.55, skip: 0.12 };
    } else if (p.anim === 'kick' && a.kick) {
      special = { key: 'kick', action: a.kick, fit: 0.45, skip: 0.25 };
    } else if (p.anim === 'gkthrow' && a.gkThrow) {
      special = { key: 'gkthrow', action: a.gkThrow, fit: 0.5, skip: 0.1 };
    } else if (p.anim === 'celebrate' && a.celebrate?.length) {
      special = { key: 'celebrate', action: a.celebrate[p.idx % a.celebrate.length], loop: true };
    }

    // sim plane (x, y) maps to three (x, z); facing 0 = +x. A clip-driven dive
    // keeps its pre-dive orientation: the keeper falls sideways, he doesn't
    // pirouette to face the direction of travel first.
    // a fall also holds its yaw at the body's facing (not the shove direction) so the
    // forward/backward knock-down clip topples the right way in the world — otherwise
    // the yaw chases the push and every fall reads as a backward topple.
    const freezeYaw = p.anim === 'dive' || p.anim === 'smother' || p.anim === 'fall'
      || ((v.recoverTime ?? 0) > 0 && (v.current === 'dive' || v.current === 'smother' || v.current === 'recover'));
    if (!freezeYaw) {
      v.diveYaw = undefined;
      // Outfielders turn to face the way they run. A keeper instead stays SQUARE to
      // the ball (sim already points p.facing at it) and sidesteps/backpedals — so
      // his yaw doesn't flick back and forth every time he adjusts left or right.
      const visualFacing = p.isGK ? p.facing : (speed > 0.28 ? Math.atan2(p.vel.y, p.vel.x) : p.facing);
      const targetRotY = yawForSimFacing(visualFacing, v.baseRotY);
      // a keeper faces the ball (not his run direction), and that facing is set by a few
      // different rules across the keeper logic; rotating his body at full sprint-rate
      // toward it makes any frame-to-frame disagreement read as a fast body twitch on a
      // 1-on-1. Cap his turn rate so the body always swings smoothly, never snaps.
      const yawSpeed = p.isGK ? Math.min(speed, 1.0) : speed;
      v.visualRotY = nextVisualYawForFacing(v.visualRotY, targetRotY, dt, yawSpeed, replay);
    } else {
      // capture the yaw to hold through the save. Use the SIM facing the keeper logic set
      // at dive commit (it points at the shot), NOT the damped visual yaw — visualRotY lags
      // behind p.facing, so capturing it laid the dive toward where he WAS looking and sent
      // him the wrong way across goal ("diving backwards").
      if ((p.anim === 'dive' || p.anim === 'smother') && v.current !== p.anim) {
        v.diveYaw = yawForSimFacing(p.facing, v.baseRotY);
      }
      v.visualRotY = v.diveYaw ?? yawForSimFacing(p.facing, v.baseRotY);
    }
    v.group.rotation.y = v.visualRotY;
    v.ring.visible = p.control;

    if (!v.mixer) {
      // fallback bobbing
      const bob = speed > 0.4 ? Math.abs(Math.sin(performance.now() * 0.012 * (1 + speed * 0.1))) * 0.12 : 0;
      v.group.position.y = bob + (p.anim === 'slide' ? -0.2 : 0);
      v.group.rotation.x = p.anim === 'slide' ? -1.0 : 0;
      v.current = p.anim;
      return;
    }

    const run = a.run;
    const walk = a.walk;

    if (special) {
      if (v.current !== special.key) {
        v.special?.stop();
        run?.stop();
        walk?.stop();
        a.idle?.stop();
        a.tired?.stop();
        const act = special.action;
        act.reset();
        if (special.loop) {
          act.setLoop(THREE.LoopRepeat, Infinity);
          act.timeScale = 1;
        } else {
          act.setLoop(THREE.LoopOnce, 1);
          act.clampWhenFinished = true;
          // jump the wind-up, then pace the remainder into the sim's window
          const dur = act.getClip().duration || 1;
          const skip = special.skip ?? 0;
          act.time = dur * skip;
          act.timeScale = special.fit
            ? Math.max(0.65, (dur * (1 - skip)) / Math.max(0.25, special.fit))
            : 1;
        }
        act.weight = 1;
        act.play();
        v.special = act;
        v.current = special.key;
      }
      // slide and tackle clips need body adjustments so the player reads as
      // on the turf, not kicking in mid-air. The clip animates the limbs but
      // root motion often leaves the body at standing height.
      if (special.key === 'slide') {
        v.group.rotation.x = -1.0;   // pitch forward onto the turf
        v.group.position.y = -0.15;  // drop to ground level
      } else if (special.key === 'tackle') {
        v.group.rotation.x = -0.3;   // slight forward crouch for a standing tackle
        v.group.position.y = -0.08;  // lower so the kick connects at ground level
      } else {
        v.group.rotation.x = 0;
        v.group.position.y = 0;
      }
      v.group.rotation.z = 0;
      v.mixer.update(dt);
      return;
    }

    // leaving a clip-driven special state: hand back to locomotion. Several states OWN
    // their special across many frames and drive it themselves: 'throw' holds an overhead
    // pose; 'fall' plays the knock-down then the get-up; and the keeper's 'dive'/'smother'
    // play the leap/slide clip while he lays out, then 'recover' plays the get-up. This
    // generic teardown must skip ALL of them — otherwise it stops the clip the very next
    // frame, leaving only the bind pose (the stiff "T-pose" dive and get-up).
    if (
      v.special
      && v.current !== 'throw' && v.current !== 'fall'
      && v.current !== 'dive' && v.current !== 'smother' && v.current !== 'recover'
    ) {
      v.special.stop();
      v.special = null;
      (run ?? walk)?.play();
    }

    if (p.anim === 'throw') {
      // freeze the locomotion clips (a skeleton.pose() reset would lose the
      // bone scales Meshy rigs store their real size in), then steer the
      // arms overhead from the frozen pose
      if (v.current !== 'throw') {
        run?.stop();
        walk?.stop();
      }
      v.group.rotation.x = 0;
      applyThrowPose(v);
      v.current = p.anim;
      return;
    }
    if (v.current === 'throw') {
      // resuming after a throw: restart locomotion clips
      (run ?? walk)?.play();
    }
    if (p.anim === 'fall' && a.fall) {
      // Real mocap fall: the knock-down clip drops him to the turf (its vertical root
      // motion + bone rotations lay the body out), it clamps on the lying pose, then
      // the get-up clip lifts him back to his feet over the last stretch of downTimer.
      // The clips carry the whole motion, so no procedural body pose is applied.
      const down = p.downTimer ?? 0;
      const GETUP = 0.8; // play the get-up over the last ~0.8s of being down
      // forward-only: once the get-up has started it must never revert to the
      // knock-down, or the boundary frame where downTimer ticks to ~0 (while anim is
      // still 'fall') would restart the fall clip from standing — a pop just before he
      // rises. So 'up' latches once entered, and only a fresh fall resets it to 'down'.
      const stage: 'down' | 'up' = (a.getup && (v.fallStage === 'up' || (down > 0 && down < GETUP)))
        ? 'up' : 'down';
      if (v.current !== 'fall' || v.fallStage !== stage) {
        run?.stop();
        walk?.stop();
        a.idle?.stop();
        a.tired?.stop();
        const prev = v.special;
        // pitched onto his front when the shove went with his facing (clipped from
        // behind); toppled backward otherwise. The get-up matches: a prone push-up off
        // the front, or the sit-up-and-rise from the back.
        const forward = !!(p.fallForward && a.fallForward);
        const downClip = forward ? a.fallForward! : a.fall;
        const upClip = (p.fallForward && a.getupFront) ? a.getupFront : a.getup!;
        const act = stage === 'up' ? upClip : downClip;
        act.reset();
        act.setLoop(THREE.LoopOnce, 1);
        act.clampWhenFinished = true;
        const dur = act.getClip().duration || 1;
        // the library clips run long (knock-down ~2.5s, stand-up ~8s); pace them into
        // the game's beat so the fall is snappy and the get-up isn't a slow grind
        const target = stage === 'up' ? GETUP : 0.9;
        act.timeScale = Math.min(14, Math.max(0.5, dur / target));
        act.setEffectiveWeight(1);
        act.play();
        if (prev && prev !== act) prev.crossFadeTo(act, 0.12, false);
        v.special = act;
        v.fallStage = stage;
      }
      v.group.rotation.x = 0;
      v.group.rotation.z = 0;
      v.group.position.y = 0;
      v.mixer.update(dt);
      v.current = 'fall';
      return;
    }
    if (p.anim === 'fall') {
      // no mocap clip loaded — procedural fallback: topple sideways onto the turf,
      // lie there, then push back up to his feet. The tip-over runs on its own
      // accumulator; the getup is driven off the sim's downTimer.
      if (v.current !== 'fall') {
        run?.stop();
        walk?.stop();
        a.tired?.stop();
        v.special?.stop();
        v.special = undefined;
        v.fallTime = 0;
        v.fallSide = p.idx % 2 === 0 ? 1 : -1;
        v.fallPower = clamp01(p.fallPower ?? 0.5);
        a.idle?.reset();
        a.idle?.play();
      }
      v.fallTime = (v.fallTime ?? 0) + dt;
      const t = v.fallTime ?? 0;
      const power = v.fallPower ?? 0.5;       // 0 = clean-tackle stumble .. 1 = heavy foul
      const side = v.fallSide ?? 1;
      const GETUP = 0.34;                     // last stretch of downTimer spent rising
      const down = p.downTimer ?? 0;
      const rise = down < GETUP ? smoothstep(clamp01(1 - down / GETUP)) : 0;
      // airborne arc: the challenge takes his legs and he's off the ground for a beat,
      // higher and longer the harder the hit, before he comes down and skids.
      const airDur = 0.16 + power * 0.22;
      const airT = clamp01(t / airDur);
      const flight = Math.sin(airT * Math.PI);            // 0 → 1 → 0 across the flight
      // how laid out he is (0 upright .. 1 flat); eases in fast, unwinds on the getup
      const amt = smoothstep(clamp01(t / 0.12)) * (1 - rise);
      // tip onto the turf, with an extra spin mid-flight so he rolls as he lands
      // (capped short of a full flip — from a top-down view he reads as a tumble)
      v.group.rotation.z = side * (amt * 1.4 + flight * power * 0.95 * (1 - rise));
      // pitch forward — face/chest first on a heavy challenge
      v.group.rotation.x = -(amt * 0.18 + flight * power * 0.6 * (1 - rise));
      // height: the airborne arc, then settle to ground level
      v.group.position.y = flight * (0.14 + power * 0.6) * (1 - rise) + amt * 0.05;
      // throw an arm out to break the fall, biggest at the moment of impact
      applyFallArm(v, amt * (0.55 + power * 0.45), side);
      v.mixer.update(dt);
      v.current = 'fall';
      return;
    }
    if (v.current === 'fall') {
      // back on his feet: drop the fall clip, clear any laid-out pose, restart locomotion
      if (v.special) { v.special.stop(); v.special = undefined; }
      v.fallStage = undefined;
      v.group.rotation.x = 0;
      v.group.rotation.z = 0;
      v.group.position.y = 0;
      (run ?? walk)?.play();
    }
    if (p.anim === 'dive' || p.anim === 'smother') {
      // A real save = the LIMBS move (the skeletal dive clip animates the reach,
      // the leg kick, the body extension — root motion is stripped so it plays in
      // place) WHILE the whole body lays from upright to a full horizontal stretch.
      // The old version skipped the mixer, so the skeleton stayed in a standing
      // pose and the body just tipped over rigidly — which read as a flick.
      // A rushed-out save (smother at feet, or a spread charge at an attacker) slides
      // him out FORWARD with the slide clip — legs trailing, not a sideways lay with a
      // running cycle. A lateral line save still dives to his side.
      const runOut = p.anim === 'smother' || p.diveKind === 'spread';
      if (v.current !== p.anim) {
        v.diveRunOut = runOut; // latch for the held-ball renderer (sim clears diveKind later)
        run?.stop();
        walk?.stop();
        a.idle?.stop();
        a.tired?.stop();
        v.special?.stop();
        v.diveTime = 0;
        v.diveSide = runOut ? 0 : resolvePlayerDiveSide(p);
        const clip = runOut
          ? (a.slide ?? a.smother ?? a.gkDiveR)
          : ((v.diveSide ?? 1) < 0 ? (a.gkDiveL ?? a.gkDiveR) : a.gkDiveR);
        if (clip) {
          clip.reset();
          clip.setLoop(THREE.LoopOnce, 1);
          clip.clampWhenFinished = true;
          const dur = clip.getClip().duration || 1;
          clip.time = dur * 0.05;            // skip a touch of the wind-up
          // The slide clip loops stand→slide-low→stand. For a run-out we drive its time
          // by hand (below) so he settles into the low slide and HOLDS, instead of the
          // clip standing his legs back up while he's flat on the turf ("running on the
          // ground"). The lateral leap clip plays through normally.
          clip.timeScale = runOut ? 0 : Math.max(0.7, (dur * 0.95) / 0.7);
          clip.play();
          v.special = clip;
        } else {
          // no dive clip available: make sure no stale special keeps animating the
          // limbs while the body rotates procedurally
          v.special?.stop();
          v.special = undefined;
        }
      }
      v.diveTime = (v.diveTime ?? 0) + dt;
      const t = v.diveTime;
      const side = v.diveSide ?? 1;
      if (runOut) {
        // slide out at the attacker: pitch forward and low onto the turf (the slide clip
        // trails the legs). He's already facing the attacker, so this carries him in.
        const k = Math.min(1, t / 0.22);
        v.group.rotation.z = 0;
        v.group.rotation.x = -1.05 * (k * k);
        v.group.position.y = -0.13 * k;
        // drive the slide clip into its low-slide pose (~40% through) in step with the
        // body going down, then hold it there — never play on to the standing tail.
        if (v.special) v.special.time = k * 0.4 * (v.special.getClip().duration || 1);
      } else {
        // ease the body from upright to flat on the turf while the clip animates
        // the reach — no rigid snap, no static standing pose
        const SET = 0.1;
        const AIR = 0.34;
        if (t < SET) {
          const e = (t / SET) ** 2;
          v.group.rotation.z = side * 0.18 * e;
          v.group.position.y = -0.04 * e;
        } else if (t < SET + AIR) {
          const k = (t - SET) / AIR;
          const e = 1 - (1 - k) * (1 - k);
          v.group.rotation.z = side * (0.18 + 1.12 * e);
          v.group.position.y = 0.14 * (k * k) + Math.sin(k * Math.PI) * 0.5; // airborne arc into the landing
        } else {
          v.group.rotation.z = side * 1.3;
          v.group.position.y = 0.14;
        }
        v.group.rotation.x = 0; // the clip supplies any pitch; the lay is purely sideways
      }
      v.diveRoll = v.group.rotation.z;
      v.divePitch = v.group.rotation.x;
      v.recoverTime = GOALKEEPER_RECOVERY_DURATION;
      v.mixer.update(dt); // <-- drive the limbs through the dive clip
      // a lateral shot-stop has no real mocap (the library has none), so reach his arms
      // out at the ball over the leap clip's stiff T-pose. The run-out saves already
      // slide in with the proper slide-clip arms, so leave those.
      if (!runOut) applyDiveArm(v);
      v.current = p.anim;
      return;
    }
    // back to his feet after a save. He ROLLS onto his FRONT, then pushes up — two phases:
    //   1. roll: unwind the sideways lay to flat while the prone push-up clip is HELD on its
    //      first (face-down) frame, so he turns from on-his-side to lying face-DOWN, his arms
    //      planted under him — not sitting up from his back with his arms out (the T-pose).
    //   2. push up: flat on his front, the clip plays through and lifts him to standing.
    // We drive the clip's time ourselves (timeScale 0) so it stays prone through the roll.
    if (v.recoverTime && v.recoverTime > 0) {
      v.recoverTime -= dt;
      const elapsed = clamp01(1 - v.recoverTime / GOALKEEPER_RECOVERY_DURATION);
      const recoverClip = a.getupFront ?? a.getup;
      if (recoverClip) {
        if (v.current === 'dive' || v.current === 'smother') {
          run?.stop();
          walk?.stop();
          a.idle?.stop();
          a.tired?.stop();
          const prev = v.special;
          const act = recoverClip;
          act.reset();
          act.setLoop(THREE.LoopOnce, 1);
          act.clampWhenFinished = true;
          act.timeScale = 0;            // we set .time manually so it can hold prone
          act.setEffectiveWeight(1);
          act.play();
          // hard cut to the prone pose: a crossfade would blend the dive-leap arms back in
          if (prev && prev !== act) prev.stop();
          v.special = act;
          v.current = 'recover';
        }
        const ROLL = 0.32; // fraction of the recovery spent rolling onto his front
        const dur = recoverClip.getClip().duration || 1;
        // the get-up clip runs one-way prone→standing (it ENDS on his feet), so the roll
        // holds it on its prone first frame, then the push-up plays it through to the end.
        if (elapsed < ROLL) {
          // phase 1 — roll flat onto his front, clip held on its prone first frame
          const k = smoothstep(clamp01(elapsed / ROLL));
          v.group.rotation.z = (v.diveRoll ?? 0) * (1 - k);
          v.group.rotation.x = (v.divePitch ?? 0) * (1 - k);
          recoverClip.time = 0;
        } else {
          // phase 2 — push up from prone to standing; the clip drives the rise
          v.group.rotation.z = 0;
          v.group.rotation.x = 0;
          recoverClip.time = clamp01((elapsed - ROLL) / (1 - ROLL)) * dur;
        }
        v.group.position.y = 0;
        v.mixer.update(dt);
        return;
      }
      // procedural fallback (no get-up clip loaded): unwind the roll and push up
      const recovery = goalkeeperRecoveryPose(
        Math.max(0, v.recoverTime),
        v.diveRoll ?? 0,
        v.divePitch ?? 0,
      );
      v.group.rotation.z = recovery.roll;
      v.group.rotation.x = recovery.pitch;
      v.group.position.y = recovery.height;
      const stand = a.idle ?? walk ?? run;
      if (v.current === 'dive' || v.current === 'smother') {
        if (stand && !stand.isRunning()) {
          stand.reset();
          stand.setLoop(THREE.LoopRepeat, Infinity);
          stand.play();
        }
        v.current = 'recover';
      }
      if (v.special) {
        v.special.setEffectiveWeight(recovery.diveWeight);
        if (recovery.diveWeight <= 0.01) {
          v.special.stop();
          v.special = undefined;
        }
      }
      if (stand) stand.setEffectiveWeight(recovery.standWeight);
      v.mixer.update(dt);
      return;
    }
    v.group.rotation.z = 0;
    v.group.position.y = 0; // ground him: recovery left a small vertical offset
    v.diveYaw = undefined;
    v.diveSide = undefined;
    if (v.current === 'dive' || v.current === 'recover') {
      // done getting up: drop the dive clip entirely so its clamped end-pose can
      // never bleed into the run/idle cycle, and restore full locomotion weight
      if (v.special) { v.special.stop(); v.special = undefined; }
      run?.setEffectiveWeight(1);
      walk?.setEffectiveWeight(1);
      a.idle?.setEffectiveWeight(1);
      (run ?? walk)?.play();
    }
    if (p.anim === 'slide') {
      // no clip fallback: pitch the body forward over a slowed run cycle
      v.group.rotation.x = -1.1;
      v.group.position.y = 0.15;
      if (run) run.timeScale = 0.2;
    } else {
      v.group.rotation.x = 0;
      if (p.anim === 'celebrate') {
        v.group.position.y = Math.abs(Math.sin(performance.now() * 0.008)) * 0.4;
        if (run) run.timeScale = 1.4;
      } else if (!(v.locoMoving = v.locoMoving ? speed > 0.28 : speed > 0.6)) {
        // hysteresis: enter "running" at 0.6, drop back to idle only below 0.28. A hard
        // single threshold made a near-stationary player (a keeper holding his ground)
        // strobe between the idle and run clips as his speed wobbled across the line.
        const idleAct = (p.stamina < 0.3 ? a.tired : null) ?? a.idle;
        if (idleAct) {
          // a real standing idle (catching breath when leggy)
          if (run) run.weight = 0;
          if (walk) walk.weight = 0;
          if (!idleAct.isRunning()) {
            idleAct.reset();
            idleAct.setLoop(THREE.LoopRepeat, Infinity);
            idleAct.play();
          }
          idleAct.weight = 1;
          idleAct.timeScale = 1;
        } else if (run && walk) {
          // idle: slow-walk in place reads as shifting weight
          run.weight = 0; walk.weight = 1; walk.play(); walk.timeScale = 0.25;
        } else if (run) {
          run.timeScale = 0.12;
        }
      } else {
        if (a.idle?.isRunning()) a.idle.stop();
        if (a.tired?.isRunning()) a.tired.stop();
        const sprinting = p.anim === 'sprint';
        if (run && walk) {
          const wRun = Math.min(1, speed / 4.5);
          run.weight = wRun; walk.weight = 1 - wRun;
          run.play(); walk.play();
          run.timeScale = 0.75 + speed * 0.1 + (sprinting ? 0.25 : 0);
          walk.timeScale = 0.8 + speed * 0.12;
        } else if (run) {
          run.timeScale = 0.4 + speed * 0.12;
        }
      }
    }
    // Safety net against the bind-pose "T-pose": a rare state handoff (notably just after a
    // keeper's get-up) can leave every clip stopped or zero-weight for a frame. Guarantee at
    // least one locomotion clip is actually driving the skeleton.
    const driving = [run, walk, a.idle, a.tired].some(
      (act) => act && act.isRunning() && act.getEffectiveWeight() > 0.01,
    );
    if (!driving) {
      const fb = a.idle ?? run ?? walk;
      if (fb) {
        if (!fb.isRunning()) { fb.reset(); fb.setLoop(THREE.LoopRepeat, Infinity); fb.play(); }
        fb.setEffectiveWeight(1);
      }
    }
    v.mixer.update(dt);
    v.current = p.anim;
  }
}

/**
 * Raise both arms overhead for a throw-in. Runs after the mixer so it
 * overrides whatever the locomotion clips put on the arm bones this frame.
 * Works in world space, so it holds for any rig orientation.
 */
function resolveArmBones(v: PlayerVisual) {
  if (v.armBones !== undefined) return;
  const find = (name: string) => v.group.getObjectByName(name) ?? null;
  const pairs: PlayerVisual['armBones'] = [];
  const left = find('LeftArm');
  const leftLower = find('LeftForeArm');
  const leftHand = find('LeftHand');
  const right = find('RightArm');
  const rightLower = find('RightForeArm');
  const rightHand = find('RightHand');
  if (left && leftLower) pairs.push({ upper: left, lower: leftLower, hand: leftHand, side: -1 });
  if (right && rightLower) pairs.push({ upper: right, lower: rightLower, hand: rightHand, side: 1 });
  v.armBones = pairs.length ? pairs : null;
}

/** Fling the arms out as he goes down: the arm on the side he's toppling toward
 * braces out and toward the turf, the other flails up and across — eased in by
 * `reach` (0 = arms by his sides, 1 = full flail). Runs after the mixer. */
function applyFallArm(v: PlayerVisual, reach: number, side: number) {
  resolveArmBones(v);
  if (!v.armBones) return;
  const r = clamp01(reach);
  if (r < 0.02) return;
  const groupQuat = new THREE.Quaternion();
  v.group.getWorldQuaternion(groupQuat);
  const lateral = new THREE.Vector3(1, 0, 0).applyQuaternion(groupQuat);
  const groupPos = new THREE.Vector3();
  v.group.getWorldPosition(groupPos);
  const shoulderPos = new THREE.Vector3();
  for (const { upper, lower, hand } of v.armBones) {
    upper.updateWorldMatrix(true, false);
    shoulderPos.setFromMatrixPosition(upper.matrixWorld).sub(groupPos);
    const armSide = Math.sign(shoulderPos.dot(lateral)) || 1;
    const bracing = armSide === (side >= 0 ? 1 : -1);
    const rest = new THREE.Vector3(0, -1, 0).addScaledVector(lateral, armSide * 0.18).normalize();
    const fling = new THREE.Vector3(0, bracing ? -0.35 : 0.55, 0)
      .addScaledVector(lateral, armSide * (bracing ? 1 : 0.75))
      .normalize();
    const target = rest.lerp(fling, r).normalize();
    rotateBoneTowards(upper, lower, target);
    if (hand) rotateBoneTowards(lower, hand, target);
  }
}

/** Stretch the keeper's arms out at the ball as he dives, over the library leap clip's
 * stiff arms-out (T-pose) pose. Both arms reach TOGETHER toward the way he's going (once
 * he's laid over, his "overhead" points at the corner he's diving for) — converging like
 * a real save, not spread out to the sides. Modelled on the throw-in pose (which works).
 * Runs after the mixer so it overrides the clip's arm bones. */
function applyDiveArm(v: PlayerVisual) {
  resolveArmBones(v);
  if (!v.armBones) return;
  const groupQuat = new THREE.Quaternion();
  v.group.getWorldQuaternion(groupQuat);
  const reachDir = new THREE.Vector3(0, 1, 0).applyQuaternion(groupQuat); // his "overhead" = the dive line
  const lateral = new THREE.Vector3(1, 0, 0).applyQuaternion(groupQuat);
  const groupPos = new THREE.Vector3();
  v.group.getWorldPosition(groupPos);
  const shoulderPos = new THREE.Vector3();
  for (const { upper, lower, hand } of v.armBones) {
    upper.updateWorldMatrix(true, false);
    shoulderPos.setFromMatrixPosition(upper.matrixWorld).sub(groupPos);
    const side = Math.sign(shoulderPos.dot(lateral)) || 1; // physical side, never trust bone names
    // both arms stretch along the dive line; a slight outward lean keeps the hands a
    // shoulder-width apart (extended at the ball) rather than crossed or fanned wide
    const upperTarget = new THREE.Vector3().copy(reachDir).addScaledVector(lateral, side * 0.16).normalize();
    rotateBoneTowards(upper, lower, upperTarget);
    if (hand) {
      const lowerTarget = new THREE.Vector3().copy(reachDir).addScaledVector(lateral, side * 0.05).normalize();
      rotateBoneTowards(lower, hand, lowerTarget);
    }
  }
}

function applyThrowPose(v: PlayerVisual) {
  resolveArmBones(v);
  if (!v.armBones) return;
  const groupQuat = new THREE.Quaternion();
  v.group.getWorldQuaternion(groupQuat);
  const lateral = new THREE.Vector3(1, 0, 0).applyQuaternion(groupQuat);
  const groupPos = new THREE.Vector3();
  v.group.getWorldPosition(groupPos);
  const shoulderPos = new THREE.Vector3();
  for (const { upper, lower, hand } of v.armBones) {
    // which side this arm is PHYSICALLY on — never trust bone-name handedness,
    // a wrong sign here is exactly how arms end up crossed
    upper.updateWorldMatrix(true, false);
    shoulderPos.setFromMatrixPosition(upper.matrixWorld).sub(groupPos);
    const side = Math.sign(shoulderPos.dot(lateral)) || 1;
    // both segments aim straight up with a slight outward lean: hands finish
    // shoulder-width apart above the head, never crossed
    const upperTarget = new THREE.Vector3(0, 1, 0)
      .addScaledVector(lateral, side * 0.28)
      .normalize();
    rotateBoneTowards(upper, lower, upperTarget);
    if (hand) {
      const lowerTarget = new THREE.Vector3(0, 1, 0)
        .addScaledVector(lateral, side * 0.08)
        .normalize();
      rotateBoneTowards(lower, hand, lowerTarget);
    }
  }
}

function rotateBoneTowards(upper: THREE.Object3D, child: THREE.Object3D, targetDirWorld: THREE.Vector3) {
  upper.updateWorldMatrix(true, false);
  child.updateWorldMatrix(true, false);
  const upperPos = new THREE.Vector3().setFromMatrixPosition(upper.matrixWorld);
  const childPos = new THREE.Vector3().setFromMatrixPosition(child.matrixWorld);
  const current = childPos.sub(upperPos);
  if (current.lengthSq() < 1e-8) return;
  current.normalize();
  const delta = new THREE.Quaternion().setFromUnitVectors(current, targetDirWorld);
  const parentQuat = new THREE.Quaternion();
  upper.parent?.getWorldQuaternion(parentQuat);
  const localDelta = parentQuat.clone().invert().multiply(delta).multiply(parentQuat);
  upper.quaternion.premultiply(localDelta);
}

export function nextVisualYawForFacing(current: number, target: number, dt: number, speed: number, replay = false): number {
  const rate = replay ? 220 : speed > 3.2 ? 122 : speed > 0.6 ? 44 : 18;
  return dampAngle(current, target, 1 - Math.exp(-rate * dt));
}

export function yawForSimFacing(facing: number, baseRotY = Math.PI / 2): number {
  return -facing + baseRotY;
}

function dampAngle(current: number, target: number, alpha: number): number {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * alpha;
}

/** world-space bounds including skeleton-driven vertex positions */
function measureRig(rig: THREE.Object3D): THREE.Box3 {
  rig.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  rig.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (sm.isSkinnedMesh) {
      sm.skeleton.update();
      sm.computeBoundingBox();
      tmp.copy(sm.boundingBox!).applyMatrix4(sm.matrixWorld);
      box.union(tmp);
    } else if ((o as THREE.Mesh).isMesh) {
      tmp.setFromObject(o);
      box.union(tmp);
    }
  });
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1.8, 0.5));
  return box;
}

/** chunky low-poly fallback player so the game works without the Meshy asset */
function buildFallbackPlayer(options: PlayerCreateOptions, scale: number): THREE.Group {
  const { kit, appearance } = options;
  const g = new THREE.Group();
  const shirt = makePlayerMaterial(kit.shirt, 'kit');
  const shorts = makePlayerMaterial(kit.shorts, 'kit');
  const skin = makePlayerMaterial(appearance.skinTone, 'skin');
  const boot = makePlayerMaterial(appearance.bootColor ?? '#151515', 'boot');
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.5, 4, 8), shirt);
  torso.position.y = 1.05;
  torso.castShadow = true;
  g.add(torso);
  const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.3, 8), shorts);
  hips.position.y = 0.62;
  g.add(hips);
  const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.5, 6), skin);
  legL.position.set(0, 0.27, -0.12);
  g.add(legL);
  const legR = legL.clone();
  legR.position.z = 0.12;
  g.add(legR);
  const bootL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.22), boot);
  bootL.position.set(0.03, 0.02, -0.13);
  const bootR = bootL.clone();
  bootR.position.z = 0.13;
  g.add(bootL, bootR);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), skin);
  head.position.y = 1.62;
  head.castShadow = true;
  g.add(head);
  g.add(buildKitDecals(options, scale));
  g.scale.setScalar(scale);
  return g;
}

function makePlayerMaterial(color: string, role: PlayerMaterialRole): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color) });
  applyMatchPlayerShading(mat, role);
  return mat;
}

function buildKitDecals(options: PlayerCreateOptions, scale: number): THREE.Group {
  const g = new THREE.Group();
  const badgeTex = options.badgeTexture
    ? makeTransparentBadgeTexture(options.badgeTexture)
    : makeBadgeTexture(options.kit, options.kitStyle);
  const badge = new THREE.Mesh(
    new THREE.PlaneGeometry(0.2 * scale, 0.2 * scale),
    new THREE.MeshBasicMaterial({ map: badgeTex, transparent: true, side: THREE.DoubleSide }),
  );
  badge.position.set(-0.12 * scale, 1.22 * scale, 0.295 * scale);
  g.add(badge);

  const number = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34 * scale, 0.32 * scale),
    new THREE.MeshBasicMaterial({
      map: makeNumberTexture(options.shirtNumber, kitNumberPalette(options.kitStyle.numberColor, options.kit.shirt)),
      transparent: true,
      side: THREE.DoubleSide,
    }),
  );
  number.position.set(0, 1.18 * scale, -0.305 * scale);
  number.rotation.y = Math.PI;
  g.add(number);
  return g;
}

function makeTransparentBadgeTexture(source: THREE.Texture): THREE.Texture {
  const image = source.image as CanvasImageSource | undefined;
  if (!image) return source;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(image, 0, 0, c.width, c.height);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  const w = c.width, h = c.height;
  const cornerBg = averageCornerColor(px, w, h);
  const seen = new Uint8Array(w * h);
  const queue: number[] = [];
  const add = (x: number, y: number) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const idx = y * w + x;
    if (seen[idx]) return;
    const p = idx * 4;
    if (!isBadgeBackgroundPixel(px[p], px[p + 1], px[p + 2], cornerBg) && px[p + 3] > 8) return;
    seen[idx] = 1;
    queue.push(idx);
  };
  for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
  for (let y = 0; y < h; y++) { add(0, y); add(w - 1, y); }
  while (queue.length) {
    const idx = queue.pop()!;
    const x = idx % w, y = Math.floor(idx / w);
    const p = idx * 4;
    px[p + 3] = 0;
    add(x - 1, y); add(x + 1, y); add(x, y - 1); add(x, y + 1);
  }
  ctx.putImageData(data, 0, 0);
  const alphaBounds = boundsForVisibleAlpha(px, w, h);
  const out = document.createElement('canvas');
  out.width = c.width; out.height = c.height;
  const outCtx = out.getContext('2d', { willReadFrequently: true })!;
  if (alphaBounds) {
    const rect = badgeDrawRectForAlphaBounds(alphaBounds, w, h, 12);
    outCtx.drawImage(
      c,
      alphaBounds.minX,
      alphaBounds.minY,
      alphaBounds.maxX - alphaBounds.minX + 1,
      alphaBounds.maxY - alphaBounds.minY + 1,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
    );
  } else {
    outCtx.drawImage(c, 0, 0);
  }
  const tex = new THREE.CanvasTexture(out);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function isBadgeBackgroundPixel(r: number, g: number, b: number, bg: [number, number, number]): boolean {
  const dist = Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const light = max / 255;
  const sat = max === 0 ? 0 : (max - min) / max;
  return dist < 64 || (sat < 0.08 && light > 0.82);
}

interface AlphaBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function badgeDrawRectForAlphaBounds(bounds: AlphaBounds, width: number, height: number, padding: number) {
  const sourceW = Math.max(1, bounds.maxX - bounds.minX + 1);
  const sourceH = Math.max(1, bounds.maxY - bounds.minY + 1);
  const availableW = Math.max(1, width - padding * 2);
  const availableH = Math.max(1, height - padding * 2);
  const scale = Math.min(availableW / sourceW, availableH / sourceH);
  const drawW = sourceW * scale;
  const drawH = sourceH * scale;
  return {
    x: (width - drawW) / 2,
    y: (height - drawH) / 2,
    width: drawW,
    height: drawH,
  };
}

function boundsForVisibleAlpha(px: Uint8ClampedArray, w: number, h: number): AlphaBounds | null {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const alpha = px[(y * w + x) * 4 + 3];
      if (alpha <= 12) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX >= minX && maxY >= minY ? { minX, minY, maxX, maxY } : null;
}

function averageCornerColor(px: Uint8ClampedArray, w: number, h: number): [number, number, number] {
  const samples: Array<[number, number]> = [
    [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
    [Math.floor(w / 2), 0], [Math.floor(w / 2), h - 1],
    [0, Math.floor(h / 2)], [w - 1, Math.floor(h / 2)],
  ];
  let r = 0, g = 0, b = 0;
  for (const [x, y] of samples) {
    const i = (y * w + x) * 4;
    r += px[i]; g += px[i + 1]; b += px[i + 2];
  }
  return [Math.round(r / samples.length), Math.round(g / samples.length), Math.round(b / samples.length)];
}

function makeBadgeTexture(kit: KitColors, style: KitStyle): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = style.trim ?? kit.socks;
  ctx.strokeStyle = style.numberColor ?? '#ffffff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  if (style.badgeShape === 'round') {
    ctx.arc(32, 32, 24, 0, Math.PI * 2);
  } else {
    ctx.moveTo(14, 10);
    ctx.lineTo(50, 10);
    ctx.lineTo(style.badgeShape === 'crest' ? 45 : 52, 38);
    ctx.lineTo(32, 56);
    ctx.lineTo(style.badgeShape === 'crest' ? 19 : 12, 38);
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = style.numberColor ?? '#ffffff';
  ctx.font = 'bold 20px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(style.badgeText ?? '', 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeNumberTexture(num: number, palette: { fill: string; stroke: string }): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 96;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, 96, 96);
  ctx.fillStyle = palette.fill;
  ctx.strokeStyle = palette.stroke;
  ctx.lineWidth = 3;
  ctx.font = 'bold 58px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const text = String(num);
  ctx.strokeText(text, 48, 50);
  ctx.fillText(text, 48, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function normalizeHexColor(color: string): string {
  const raw = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw.slice(1).split('').map((c) => c + c).join('')}`.toLowerCase();
  }
  return '#ffffff';
}

function readableTextColor(bg: string): string {
  const normalized = normalizeHexColor(bg).replace('#', '');
  const n = parseInt(normalized, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  return luminance > 0.48 ? '#111111' : '#ffffff';
}

function srgb(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function applyCosmeticMaterial(mat: THREE.MeshStandardMaterial, label: string, appearance: PlayerAppearance) {
  if (label.includes('skin') || label.includes('body') || label.includes('head')) {
    mat.color = new THREE.Color(appearance.skinTone);
  } else if (label.includes('hair')) {
    mat.color = new THREE.Color(appearance.hairColor);
  } else if (label.includes('boot') || label.includes('shoe')) {
    mat.color = new THREE.Color(appearance.bootColor ?? '#151515');
  }
}

function materialRoleFromLabel(label: string): PlayerMaterialRole {
  if (label.includes('skin') || label.includes('body') || label.includes('head')) return 'skin';
  if (label.includes('hair')) return 'hair';
  if (label.includes('boot') || label.includes('shoe')) return 'boot';
  return 'kit';
}
