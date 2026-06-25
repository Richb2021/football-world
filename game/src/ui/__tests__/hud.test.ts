import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { SimPlayer } from '../../sim/types';
import { buildSubstitutionGraphicHtml, formatHudPlayerLabel } from '../hud';

function player(overrides: Partial<SimPlayer> = {}): SimPlayer {
  return {
    idx: 1,
    team: 0,
    attrs: {
      name: 'Tony Adams',
      pos: 'DF',
      age: 27,
      pace: 65,
      pass: 70,
      shoot: 45,
      tackle: 86,
      keeping: 10,
    },
    squadIdx: 1,
    isGK: false,
    slot: { x: 0, y: 0 },
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    facing: 0,
    stamina: 1,
    staminaCeiling: 1,
    control: true,
    yellowCards: 0,
    foulsCommitted: 0,
    sentOff: false,
    kickCooldown: 0,
    slideTimer: 0,
    anim: 'idle',
    ...overrides,
  };
}

describe('HUD player label', () => {
  it('shows a yellow-card marker beside booked players', () => {
    expect(formatHudPlayerLabel(player({ yellowCards: 1 }), true, ['ARS', 'CHE'])).toBe('ON BALL · ARS: Tony Adams · YC');
  });

  it('keeps unbooked players clean', () => {
    expect(formatHudPlayerLabel(player(), false, ['ARS', 'CHE'])).toBe('SELECTED · ARS: Tony Adams');
  });
});

describe('HUD substitution graphic', () => {
  it('renders two substitution pairs in the same graphic', () => {
    const html = buildSubstitutionGraphicHtml('ENG', '#ffffff', [
      { offName: 'Bellingham & Kane', onName: 'Palmer' },
      { offName: 'Saka', onName: 'Gordon <LW>' },
    ]);

    expect(html.match(/<span class="sg-sub-tag">OFF<\/span>/g) ?? []).toHaveLength(2);
    expect(html.match(/<span class="sg-sub-tag">ON<\/span>/g) ?? []).toHaveLength(2);
    expect(html).toContain('Bellingham &amp; Kane');
    expect(html).toContain('Palmer');
    expect(html).toContain('Saka');
    expect(html).toContain('Gordon &lt;LW&gt;');
  });

  it('uses the score graphic surface with explicit players on and off', () => {
    const hud = readFileSync(new URL('../hud.ts', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');

    expect(hud).toContain('score-graphic--sub');
    expect(hud).toContain('SUBSTITUTION');
    expect(hud).toContain('sg-sub-off');
    expect(hud).toContain('sg-sub-on');
    expect(hud).toContain('scoreGraphicSubActive');
    expect(hud).toContain('hud-sub-priority');
    expect(hud).toContain('subGraphicEntries');
    expect(hud).toContain('renderSubBanner');
    expect(hud).toContain('restartSubGraphicAnimation');
    expect(hud).toContain('void el.offsetWidth');
    expect(hud).toContain('sg-sub-on--slide');
    expect(hud).toContain('${escapeHudHtml(offName)}');
    expect(hud).toContain('${escapeHudHtml(onName)}');
    expect(hud).toContain('this.subGraphicEntries.push({ offName, onName })');
    expect(hud).toContain('buildSubstitutionGraphicHtml(team, color, this.subGraphicEntries)');
    expect(css).toContain('#hud.hud-sub-priority');
    expect(css).toContain('.score-graphic--sub');
    expect(css).toContain('.sg-sub-tag');
    expect(css).toContain('@keyframes sg-sub-on-cross');
    expect(css).toContain('.sg-sub-on--slide');
  });
});
