import { describe, expect, it } from 'vitest';
import type { KitColors, PlayerAttrs } from '../../sim/types';
import {
  buildKitVisualKey,
  defaultAppearanceForPlayer,
  defaultKitStyleForTeam,
  resolveAppearance,
  resolveKitStyle,
  shirtNumberForPlayer,
} from '../appearance';

const player = (name: string, over: Partial<PlayerAttrs> = {}): PlayerAttrs => ({
  name,
  pos: 'MF',
  age: 24,
  pace: 70,
  pass: 70,
  shoot: 60,
  tackle: 55,
  keeping: 5,
  ...over,
});

const kit: KitColors = { shirt: '#EF0107', shorts: '#FFFFFF', socks: '#EF0107' };

describe('appearance defaults', () => {
  it('creates deterministic player appearance without requiring team JSON edits', () => {
    const a = defaultAppearanceForPlayer(player('Alex Example'), 'arsenal', 7);
    const b = defaultAppearanceForPlayer(player('Alex Example'), 'arsenal', 7);

    expect(a).toEqual(b);
    expect(a.skinTone).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(a.hairColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(['short', 'crop', 'curly', 'bald', 'long']).toContain(a.hairStyle);
  });

  it('keeps explicit cosmetic choices while filling safe defaults', () => {
    const explicit = player('Custom Player', {
      appearance: {
        skinTone: '#6d3b22',
        hairColor: '#101010',
        hairStyle: 'bald',
        facialHair: 'beard',
      },
    });

    const resolved = resolveAppearance(explicit, 'custom', 4);

    expect(resolved.skinTone).toBe('#6d3b22');
    expect(resolved.hairStyle).toBe('bald');
    expect(resolved.facialHair).toBe('beard');
    expect(resolved.bootColor).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('creates lightweight deterministic kit styles and stable visual cache keys', () => {
    const style = defaultKitStyleForTeam('arsenal', 'home', kit, 'ARS');
    const resolved = resolveKitStyle(kit, 'arsenal', 'home', 'ARS');

    expect(resolved).toEqual(style);
    expect(['solid', 'stripes', 'hoops', 'halves', 'sash', 'sleeves']).toContain(style.pattern);
    expect(style.badgeText).toBe('ARS');
    expect(style.numberColor).toMatch(/^#[0-9a-fA-F]{6}$/);

    const keyA = buildKitVisualKey(kit, style, 9, 'arsenal', 'home');
    const keyB = buildKitVisualKey(kit, style, 10, 'arsenal', 'home');
    expect(keyA).not.toBe(keyB);
    expect(keyA).toContain('arsenal');
  });

  it('uses stable shirt numbers from squad index without extra data', () => {
    expect(shirtNumberForPlayer({ squadIdx: 0 })).toBe(1);
    expect(shirtNumberForPlayer({ squadIdx: 17 })).toBe(18);
    expect(shirtNumberForPlayer({ squadIdx: 99 })).toBe(99);
  });
});
