import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildSubstitutionRoster,
  exitPresentationModeForConfig,
  presentationFrameDelta,
  presentationPyroEnabled,
  shouldSkipMatchPresentation,
} from '../matchRunner';
import type { PlayerAttrs, Pos, SimPlayer } from '../../sim/types';

function attrs(squadIdx: number, pos: Pos): PlayerAttrs {
  return { name: `P${squadIdx}`, pos, age: 25, pace: 70, pass: 70, shoot: 70, tackle: 70, keeping: 70 };
}
function simPlayer(idx: number, squadIdx: number, team: 0 | 1, pos: Pos, sentOff = false): SimPlayer {
  return {
    idx, team, squadIdx, attrs: attrs(squadIdx, pos), isGK: pos === 'GK',
    stamina: 1, staminaCeiling: 1, yellowCards: 0, sentOff,
  } as unknown as SimPlayer;
}
function squadOf(n: number): PlayerAttrs[] {
  return Array.from({ length: n }, (_, i) => attrs(i, i === 0 ? 'GK' : 'MF'));
}
// on-pitch SimPlayers for team 0 (squad indices 0..10), one optionally sent off
function onPitch(sentOffSquad?: number): SimPlayer[] {
  return Array.from({ length: 11 }, (_, i) => simPlayer(i, i, 0, i === 0 ? 'GK' : 'MF', i === sentOffSquad));
}

describe('substitution roster', () => {
  const starters = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it('shows eleven on the pitch and the rest on the bench with a full team', () => {
    const { starters: xi, bench } = buildSubstitutionRoster(onPitch(), 0, starters, squadOf(16), []);
    expect(xi).toHaveLength(11);
    expect(bench.map((b) => b.squadIdx)).toEqual([11, 12, 13, 14, 15]);
  });

  it('drops a sent-off player from the pitch and never offers him on the bench', () => {
    const { starters: xi, bench } = buildSubstitutionRoster(onPitch(5), 0, starters, squadOf(16), []);
    expect(xi).toHaveLength(10);
    expect(xi.some((s) => s.squadIdx === 5)).toBe(false);
    expect(bench.some((b) => b.squadIdx === 5)).toBe(false);
    expect(bench).toHaveLength(5); // a red is one fewer outfielder, not a free bench spot
  });

  it('keeps an already subbed-off player off the bench', () => {
    const { bench } = buildSubstitutionRoster(onPitch(), 0, starters, squadOf(16), [12]);
    expect(bench.map((b) => b.squadIdx)).toEqual([11, 13, 14, 15]);
  });
});

describe('match presentation launch rules', () => {
  it('skips the walkout presentation when a caller asks to skip the intro', () => {
    expect(shouldSkipMatchPresentation({ skipIntro: true })).toBe(true);
  });

  it('skips the presentation for matches that join in progress', () => {
    expect(shouldSkipMatchPresentation({ startTimeSec: 58 })).toBe(true);
  });

  it('keeps the presentation for a normal fresh match launch', () => {
    expect(shouldSkipMatchPresentation({})).toBe(false);
  });

  it('uses wall-clock frame time for presentation timers so slow intro frames do not strand kickoff', () => {
    expect(presentationFrameDelta(0.016)).toBeCloseTo(0.016);
    expect(presentationFrameDelta(0.35)).toBeCloseTo(0.35);
    expect(presentationFrameDelta(2)).toBe(1);
  });
});

describe('match presentation pyrotechnics', () => {
  it('uses the era fireworks flag for walkout and trophy presentation modes', () => {
    expect(presentationPyroEnabled({ era: { year: 1909, substitutionLimit: 0, fireworks: false } })).toBe(false);
    expect(presentationPyroEnabled({ era: { year: 2026, substitutionLimit: 5, fireworks: true } })).toBe(true);
  });

  it('keeps pyrotechnics enabled for legacy match configs without era rules', () => {
    expect(presentationPyroEnabled({})).toBe(true);
  });
});

describe('match full-time celebration modes', () => {
  it('separates trophy lifts from trophy-free winner celebrations', () => {
    expect(exitPresentationModeForConfig('halfTime', {}, 0)).toBe('halfTimeExit');
    expect(exitPresentationModeForConfig('fullTime', {}, 0)).toBe('fullTimeExit');
    expect(exitPresentationModeForConfig('fullTime', { celebrationWin: true }, 0)).toBe('winnerCelebration');
    expect(exitPresentationModeForConfig('fullTime', { trophyWin: true }, 0)).toBe('trophyLift');
    expect(exitPresentationModeForConfig('fullTime', { celebrationWin: true, celebrationTeam: 1 }, -1)).toBe('winnerCelebration');
    expect(exitPresentationModeForConfig('fullTime', { celebrationWin: true }, -1)).toBe('fullTimeExit');
  });
});

describe('match substitution flow', () => {
  it('queues pause-menu substitutions and commits them only when play resumes', () => {
    const runner = readFileSync(new URL('../matchRunner.ts', import.meta.url), 'utf8');
    const onSubStart = runner.indexOf('onSub: (offPlayerIdx, onSquadIdx) => {');
    const onFormationStart = runner.indexOf('onFormationChange:', onSubStart);
    const onSubBlock = runner.slice(onSubStart, onFormationStart);

    expect(runner).toContain('pendingSubstitutions');
    expect(runner).toContain('queueSubstitution');
    expect(runner).toContain('commitPendingSubstitutions');
    expect(runner).toContain('renderSubstitutionPresentation');
    expect(onSubBlock).toContain('this.queueSubstitution');
    expect(onSubBlock).not.toContain('sim.substitute(team, offPlayerIdx, onSquadIdx)');
    expect(onSubBlock).not.toContain('hud.subBanner');
  });

  it('frames substitution presentations with a touchline camera', () => {
    const runner = readFileSync(new URL('../matchRunner.ts', import.meta.url), 'utf8');
    const renderStart = runner.indexOf('private renderSubstitutionPresentation');
    const renderEnd = runner.indexOf('private startExitPresentation', renderStart);
    const renderBlock = runner.slice(renderStart, renderEnd);

    expect(renderBlock).toContain("presentation: 'substitution'");
    expect(renderBlock).toContain('substitutionPresentationFocus');
    expect(renderBlock).not.toContain('this.cameraModeForState(state)');
  });
});
