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
