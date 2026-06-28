import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import * as playerVisuals from '../playerVisuals';
import {
  badgeDrawRectForAlphaBounds,
  gpuHandlesMatchPlayerShader,
  isBadgeBackgroundPixel,
  nextVisualYawForFacing,
} from '../playerVisuals';

describe('custom player shader GPU gate', () => {
  it('disables the flourish on Qualcomm Adreno (Snapdragon Copilot+ PCs render players black)', () => {
    expect(gpuHandlesMatchPlayerShader('ANGLE (Qualcomm, Adreno (TM) 741, OpenGL ES 3.2)')).toBe(false);
    expect(gpuHandlesMatchPlayerShader('Qualcomm(R) Adreno(TM) GPU')).toBe(false);
  });

  it('disables the flourish on software / fallback renderers', () => {
    expect(gpuHandlesMatchPlayerShader('Google SwiftShader')).toBe(false);
    expect(gpuHandlesMatchPlayerShader('llvmpipe (LLVM 15.0)')).toBe(false);
    expect(gpuHandlesMatchPlayerShader('Microsoft Basic Render Driver')).toBe(false);
  });

  it('keeps the flourish on desktop/laptop GPUs and when the name is unknown', () => {
    expect(gpuHandlesMatchPlayerShader('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070, D3D11)')).toBe(true);
    expect(gpuHandlesMatchPlayerShader('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, D3D11)')).toBe(true);
    expect(gpuHandlesMatchPlayerShader('Apple M2')).toBe(true);
    expect(gpuHandlesMatchPlayerShader('')).toBe(true);
  });

  it('installs the shader chunk when enabled and skips it (keeping base props) when disabled', () => {
    const enabled = new THREE.MeshStandardMaterial();
    playerVisuals.applyMatchPlayerShading(enabled, 'kit');
    expect(enabled.customProgramCacheKey()).toContain('match-player-shape');
    expect(enabled.roughness).toBeCloseTo(0.84);

    try {
      playerVisuals.setMatchPlayerShaderEnabled(false);
      const disabled = new THREE.MeshStandardMaterial();
      playerVisuals.applyMatchPlayerShading(disabled, 'kit');
      // no fragile shader injection, but the safe base material props still apply
      expect(disabled.customProgramCacheKey()).not.toContain('match-player-shape');
      expect(disabled.roughness).toBeCloseTo(0.84);
      expect(disabled.metalness).toBe(0);
    } finally {
      playerVisuals.setMatchPlayerShaderEnabled(true);
    }
  });
});

describe('player visual facing', () => {
  it('turns quickly enough to match running direction during replay-visible movement', () => {
    const current = 0;
    const targetFacing = Math.PI / 2;

    const next = nextVisualYawForFacing(current, targetFacing, 1 / 60, 6.5, false);

    expect(Math.abs(next - targetFacing)).toBeLessThan(0.25);
  });

  it('snaps even harder during replay frames', () => {
    const current = 0;
    const targetFacing = -Math.PI / 2;

    const next = nextVisualYawForFacing(current, targetFacing, 1 / 60, 4.5, true);

    expect(Math.abs(next - targetFacing)).toBeLessThan(0.08);
  });

  it('can identify plain generated badge background without erasing crest colours', () => {
    expect(isBadgeBackgroundPixel(246, 244, 238, [248, 247, 244])).toBe(true);
    expect(isBadgeBackgroundPixel(220, 12, 28, [248, 247, 244])).toBe(false);
    expect(isBadgeBackgroundPixel(18, 28, 48, [248, 247, 244])).toBe(false);
  });

  it('centres visible badge alpha bounds inside the decal texture', () => {
    const rect = badgeDrawRectForAlphaBounds({ minX: 58, minY: 24, maxX: 112, maxY: 88 }, 128, 128, 12);

    expect(rect.x + rect.width / 2).toBeCloseTo(64, 4);
    expect(rect.y + rect.height / 2).toBeCloseTo(64, 4);
    expect(Math.max(rect.width, rect.height)).toBeLessThanOrEqual(104);
    expect(rect.height).toBeCloseTo(104, 0);
  });

  it('applies a match-day shading hook to player materials', () => {
    const apply = (playerVisuals as unknown as {
      applyMatchPlayerShading?: (mat: THREE.MeshStandardMaterial, role?: 'kit' | 'skin' | 'hair' | 'boot') => void;
    }).applyMatchPlayerShading;
    expect(apply).toBeTypeOf('function');

    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    apply!(mat, 'kit');

    expect(mat.userData.matchPlayerShader).toBe(true);
    expect(mat.roughness).toBeGreaterThan(0.6);
    expect(mat.metalness).toBe(0);
    expect(mat.customProgramCacheKey()).toContain('match-player');

    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <worldpos_vertex>',
      fragmentShader: '#include <common>\n#include <dithering_fragment>',
    } as Parameters<THREE.MeshStandardMaterial['onBeforeCompile']>[0];
    mat.onBeforeCompile(shader, {} as THREE.WebGLRenderer);

    expect(shader.uniforms.matchRimStrength).toBeDefined();
    expect(shader.fragmentShader).toContain('matchRim');
    expect(shader.fragmentShader).toContain('matchGroundShade');
  });

  it('prefers the sim-provided goalkeeper dive side over changing velocity', () => {
    const resolve = (playerVisuals as unknown as {
      resolvePlayerDiveSide?: (p: { facing: number; vel: { x: number; y: number }; diveSide?: -1 | 0 | 1 }) => number;
    }).resolvePlayerDiveSide;
    expect(resolve).toBeTypeOf('function');

    expect(resolve!({ facing: 0, vel: { x: 1, y: -8 }, diveSide: 1 })).toBe(1);
    expect(resolve!({ facing: 0, vel: { x: 1, y: -8 } })).toBe(-1);
  });

  it('gets the keeper up off his side onto his feet (not a reversed dive)', () => {
    const recoveryPose = (playerVisuals as unknown as {
      goalkeeperRecoveryPose?: (
        remaining: number,
        roll: number,
        pitch: number,
      ) => { roll: number; pitch: number; height: number; diveWeight: number; standWeight: number };
    }).goalkeeperRecoveryPose;
    expect(recoveryPose).toBeTypeOf('function');

    // starts from the dive lay so the pose is continuous with the save
    const start = recoveryPose!(0.72, 1.3, 0);
    expect(start.roll).toBeCloseTo(1.3, 2);
    expect(start.height).toBeCloseTo(0.14, 2);
    expect(start.diveWeight).toBeGreaterThan(0.9);

    // a quarter in: the sideways lay is already coming off fast (a getup gathers
    // off the side early — it does NOT slowly rewind the fall)
    const quarter = recoveryPose!(0.54, 1.3, 0);
    expect(quarter.roll).toBeLessThan(0.7);

    // halfway: off his side, leaning forward to push up to his feet
    const mid = recoveryPose!(0.36, 1.3, 0);
    expect(mid.roll).toBeLessThan(0.1);   // gathered off the side, not still rolled over
    expect(mid.pitch).toBeLessThan(-0.1); // forward crouch lean as he pushes up
    expect(mid.height).toBeGreaterThan(0);
    expect(mid.diveWeight).toBeLessThan(0.08);
    expect(mid.standWeight).toBeGreaterThan(0.9);

    const end = recoveryPose!(0, 1.3, 0);
    expect(end.roll).toBe(0);
    expect(end.pitch).toBe(0);
    expect(end.height).toBe(0);
    expect(end.diveWeight).toBe(0);
    expect(end.standWeight).toBe(1);
  });

  it('chooses visible kit number ink and outline from the resolved kit style', () => {
    const paletteForNumber = (playerVisuals as unknown as {
      kitNumberPalette?: (numberColor: string | undefined, shirtColor: string) => { fill: string; stroke: string };
    }).kitNumberPalette;
    expect(paletteForNumber).toBeTypeOf('function');

    expect(paletteForNumber!(undefined, '#f0d21b')).toEqual({ fill: '#111111', stroke: '#ffffff' });
    expect(paletteForNumber!('#ffd400', '#b00020')).toEqual({ fill: '#ffd400', stroke: '#111111' });
    expect(paletteForNumber!('#111111', '#ffffff')).toEqual({ fill: '#111111', stroke: '#ffffff' });
  });
});

// The renderer's PlayerFactory.update reads only (v, p, dt) — it never touches `this` — so we
// can drive the fall/get-up state machine in a pure unit by building a real three.js
// AnimationMixer over a bare object with synthetic clips, calling update.call({}, ...), and
// inspecting which AnimationAction is the active, full-weight, looping one. AnimationMixer is
// pure math (no WebGL), so this runs headless.
describe('post-foul get-up cross-fade hands off to locomotion', () => {
  const update = (playerVisuals.PlayerFactory.prototype as unknown as {
    update: (v: unknown, p: unknown, dt: number) => void;
  }).update;

  // a 1s clip with a single dummy track on a target node, named so the rig binds it
  function clip(name: string, dur: number, target: THREE.Object3D): THREE.AnimationClip {
    const track = new THREE.NumberKeyframeTrack(`${target.uuid}.scale[x]`, [0, dur], [1, 1]);
    return new THREE.AnimationClip(name, dur, [track]);
  }

  function harness() {
    const root = new THREE.Object3D();
    root.name = 'root';
    const mixer = new THREE.AnimationMixer(root);
    const mk = (name: string, dur: number) => mixer.clipAction(clip(name, dur, root));
    // mirror the real durations: getup library clip is long (8.3s), paced into the GETUP window
    const getup = mk('getup', 8.3);
    const fall = mk('fall', 2.5);
    const idle = mk('idle', 1);
    const run = mk('run', 1);
    const actions = { getup, fall, idle, run };
    const v = {
      group: new THREE.Group(),
      ring: { visible: false } as { visible: boolean },
      mixer,
      actions,
      current: 'idle',
      baseRotY: Math.PI / 2,
      visualRotY: Math.PI / 2,
      special: null as THREE.AnimationAction | null,
      fallStage: undefined as 'down' | 'up' | undefined,
      fallDone: undefined as boolean | undefined,
    };
    return { v, actions };
  }

  function simPlayer(over: Record<string, unknown>) {
    return {
      idx: 0, isGK: false, anim: 'fall', facing: 0, sentOff: false,
      control: false, stamina: 1,
      pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 },
      downTimer: 0.8, fallForward: false,
      ...over,
    };
  }

  // run the fall state forward until the get-up clamps at its end, fire the completion frame
  // at down≈0, then let the ~0.18s cross-fade settle so the loco clip is at full weight and
  // the faded get-up is back to weight 0 (so we observe the settled handoff, not the in-flight
  // transition frame where both clips still carry partial weight)
  function runToHandoff(v: unknown, p: { downTimer: number }, vel: { x: number; y: number }) {
    const dt = 1 / 60;
    // ~0.8s of being down: drain downTimer through the GETUP window so the get-up plays + clamps
    for (let t = 0.8; t > 0.02; t -= dt) {
      (p as Record<string, unknown>).downTimer = Math.max(0, t);
      (p as Record<string, unknown>).vel = vel;
      update(v, p, dt);
    }
    (p as Record<string, unknown>).downTimer = 0;
    (p as Record<string, unknown>).vel = vel;
    update(v, p, dt); // the completion frame: kicks off the cross-fade
    for (let i = 0; i < 15; i++) update(v, p, dt); // settle the 0.18s cross-fade
  }

  // the looping locomotion clips that are actually driving the skeleton at full weight
  function activeLoop(actions: { idle: THREE.AnimationAction; run: THREE.AnimationAction; getup: THREE.AnimationAction }) {
    const winners: string[] = [];
    for (const [name, act] of Object.entries(actions)) {
      if (act.isRunning() && act.getEffectiveWeight() > 0.5 && act.loop === THREE.LoopRepeat) {
        winners.push(name);
      }
    }
    return winners;
  }

  it('a stationary fouled victim lands on the LOOPING idle, not the clamped one-shot get-up', () => {
    const { v, actions } = harness();
    const p = simPlayer({ vel: { x: 0, y: 0 } });
    runToHandoff(v, p, { x: 0, y: 0 });

    // the one-shot get-up is no longer the active special clamped at full weight
    expect((v as { special: unknown }).special).toBeNull();
    expect((v as { fallDone?: boolean }).fallDone).toBe(true);
    // a looping locomotion clip now drives the skeleton; idle wins because he's ~stationary
    expect(activeLoop(actions)).toContain('idle');
    // the get-up is NOT a full-weight looping action (it's faded out, one-shot)
    expect(actions.getup.loop).toBe(THREE.LoopOnce);
  });

  it('a moving open-play riser lands on the LOOPING run', () => {
    const { v, actions } = harness();
    const p = simPlayer({ vel: { x: 4, y: 0 } });
    runToHandoff(v, p, { x: 4, y: 0 });

    expect((v as { special: unknown }).special).toBeNull();
    expect((v as { fallDone?: boolean }).fallDone).toBe(true);
    expect(activeLoop(actions)).toContain('run');
  });

  it('does not re-grab the clamped get-up while p.anim stays "fall" after the handoff', () => {
    const { v } = harness();
    const p = simPlayer({ vel: { x: 0, y: 0 } });
    runToHandoff(v, p, { x: 0, y: 0 });
    expect((v as { fallDone?: boolean }).fallDone).toBe(true);

    // several more frames with anim still 'fall' and downTimer drained: the handoff latch
    // must hold so the get-up is never re-selected as the active special
    for (let i = 0; i < 10; i++) update(v, p, 1 / 60);
    expect((v as { special: unknown }).special).toBeNull();
    expect((v as { fallDone?: boolean }).fallDone).toBe(true);

    // once the sim leaves the fall state the latch clears so the next fall works again
    (p as Record<string, unknown>).anim = 'idle';
    update(v, p, 1 / 60);
    expect((v as { fallDone?: boolean }).fallDone).toBe(false);
  });
});

// The persistent over-head injury marker is toggled inside PlayerFactory.update purely
// off p.injuredOff. update() reads only (v, p, dt), so we can drive it headless with a
// bare visual carrying a real THREE.Sprite as injuryMark and a synthetic SimPlayer.
describe('persistent injury marker tracks injuredOff', () => {
  const update = (playerVisuals.PlayerFactory.prototype as unknown as {
    update: (v: unknown, p: unknown, dt: number) => void;
  }).update;

  function harness() {
    const injuryMark = new THREE.Sprite();
    injuryMark.position.set(0, 2.4, 0);
    injuryMark.visible = false;
    const v = {
      group: new THREE.Group(),
      ring: { visible: false } as { visible: boolean },
      mixer: null,
      actions: {},
      injuryMark,
      current: 'idle',
      baseRotY: Math.PI / 2,
      visualRotY: Math.PI / 2,
      special: null,
    };
    return { v, injuryMark };
  }

  function simPlayer(over: Record<string, unknown>) {
    return {
      idx: 0, isGK: false, anim: 'idle', facing: 0, sentOff: false,
      control: false, stamina: 1, injuredOff: false,
      pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 },
      downTimer: 0,
      ...over,
    };
  }

  it('hidden for a healthy player, shown once injuredOff, hidden again when cleared', () => {
    const { v, injuryMark } = harness();
    const p = simPlayer({ injuredOff: false });

    // healthy → no marker
    update(v, p, 1 / 60);
    expect(injuryMark.visible).toBe(false);

    // forced off → marker appears the same frame
    p.injuredOff = true;
    update(v, p, 1 / 60);
    expect(injuryMark.visible).toBe(true);

    // subbed / resolved (injuredOff cleared) → marker hides
    p.injuredOff = false;
    update(v, p, 1 / 60);
    expect(injuryMark.visible).toBe(false);
  });

  it('hides the marker when the player is sent off / man-down (group hidden)', () => {
    const { v, injuryMark } = harness();
    const p = simPlayer({ injuredOff: true, sentOff: true });
    update(v, p, 1 / 60);
    // sentOff hides the whole group (the marker rides it); injuryMark.visible is left
    // untouched from its last state but the group it parents is invisible
    expect(v.group.visible).toBe(false);
  });
});
