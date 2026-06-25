import { describe, expect, it } from 'vitest';
import { baseKitRegionForPixel, goalkeeperKit, pickKits, shouldMaskGeneratedKitOverlay } from '../kitTint';
import type { KitColors } from '../../sim/types';

const kit = (shirt: string): KitColors => ({ shirt, shorts: '#ffffff', socks: shirt });
const stripedKit = (shirt: string, secondary: string): KitColors => ({
  shirt,
  shorts: '#ffffff',
  socks: shirt,
  style: { pattern: 'stripes', secondary },
});

describe('kit tint overlay mask', () => {
  it('allows generated kit overlays on shirt and shorts pixels only', () => {
    expect(shouldMaskGeneratedKitOverlay(245, 245, 245)).toBe(true);
    expect(shouldMaskGeneratedKitOverlay(120, 120, 120)).toBe(true);
  });

  it('does not apply generated kit overlays to skin or boot-like pixels', () => {
    expect(shouldMaskGeneratedKitOverlay(176, 112, 74)).toBe(false);
    expect(shouldMaskGeneratedKitOverlay(28, 22, 20)).toBe(false);
  });

  it('treats the default brown kit fabric as shorts without catching skin or hair', () => {
    expect(baseKitRegionForPixel(144, 96, 48)).toBe('shorts');
    expect(baseKitRegionForPixel(192, 160, 128)).toBe(null);
    expect(baseKitRegionForPixel(80, 64, 48)).toBe(null);
  });
});

describe('overhead kit clash resolution', () => {
  it('keeps the away home kit when shirts read clearly different from above', () => {
    const home = { home: kit('#d4262c'), away: kit('#ffffff') }; // red
    const away = { home: kit('#2a44c8'), away: kit('#101418') }; // blue
    expect(pickKits(home, away)[1].shirt).toBe('#2a44c8');
  });

  it('switches the away team when two dark shirts would merge overhead', () => {
    const home = { home: kit('#1a2a55'), away: kit('#dddddd') }; // navy
    const away = { home: kit('#101418'), away: kit('#e0b020') }; // near-black -> switch to amber
    expect(pickKits(home, away)[1].shirt).toBe('#e0b020');
  });

  it('falls back to an emergency colour when both stored away kits still clash', () => {
    const home = { home: kit('#d4262c'), away: kit('#ffffff') }; // red
    const away = { home: kit('#d42680'), away: kit('#e84a8a') }; // magenta + pink, both clash with red
    const chosen = pickKits(home, away)[1].shirt;
    expect(chosen).not.toBe('#d42680');
    expect(chosen).not.toBe('#e84a8a');
  });

  it('switches the away team when a striped home kit shares either stripe colour', () => {
    const home = { home: stripedKit('#75aadb', '#ffffff'), away: kit('#101418') };
    const away = { home: kit('#ffffff'), away: kit('#d4262c') };

    expect(pickKits(home, away)[1].shirt).toBe('#d4262c');
  });

  it('treats both teams striped colours as clash candidates from above', () => {
    const home = { home: stripedKit('#75aadb', '#ffffff'), away: kit('#101418') };
    const away = { home: stripedKit('#e21a1a', '#ffffff'), away: kit('#ffd400') };

    expect(pickKits(home, away)[1].shirt).toBe('#ffd400');
  });

  it('gives the keeper a colour clashing with neither outfield kit', () => {
    const gk = goalkeeperKit(kit('#d4262c'), kit('#2a44c8')).shirt;
    expect(gk).not.toBe('#d4262c');
    expect(gk).not.toBe('#2a44c8');
  });

  it('switches one of two identical white home kits to the alternate (England vs Germany)', () => {
    // both nations wear white at home — the away team must not also be left in white
    const england = { home: kit('#FFFFFF'), away: kit('#FF0000') };
    const germany = { home: kit('#FFFFFF'), away: kit('#E30A17') };
    const [a1, b1] = pickKits(england, germany);
    expect(a1.shirt).toBe('#FFFFFF');
    expect(b1.shirt).not.toBe('#FFFFFF'); // Germany flips to red
    // and symmetrically when the home/away designation is reversed
    const [, b2] = pickKits(germany, england);
    expect(b2.shirt).not.toBe('#FFFFFF');
  });
});
