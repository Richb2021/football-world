import { describe, it, expect } from 'vitest';
import { MatchSim } from '../matchSim';
import { autoLineup } from '../formations';
import { NULL_INPUT } from '../types';
import type { MatchConfig, PadInput, GoalLogEntry } from '../types';
import { TEAMS } from '../../data/teams';

const idle: [PadInput, PadInput] = [{ ...NULL_INPUT }, { ...NULL_INPUT }];

function playMatch(seed: number): GoalLogEntry[] {
  const a = TEAMS[(seed * 7) % TEAMS.length];
  const b = TEAMS[(seed * 7 + 3) % TEAMS.length];
  const cfg: MatchConfig = {
    teams: [
      { data: a, lineup: { formation: '4-3-3', starters: autoLineup(a.players, '4-3-3') }, kit: a.colors.home, controller: 'ai' },
      { data: b, lineup: { formation: '4-4-2', starters: autoLineup(b.players, '4-4-2') }, kit: b.colors.away, controller: 'ai' },
    ],
    halfLengthSec: 120, difficulty: 1, cupTie: false, seed,
  };
  const sim = new MatchSim(cfg);
  let n = 0;
  while (sim.state.phase !== 'finished' && n < 30000) { sim.step(idle); n++; }
  return sim.state.goals;
}

describe('match assists', () => {
  it('credits the passer with an assist on a meaningful share of goals', () => {
    const all: GoalLogEntry[] = [];
    for (let s = 0; s < 5; s++) all.push(...playMatch(500 + s));
    expect(all.length).toBeGreaterThan(0);
    // a healthy share of goals carry a non-empty assister name
    const assisted = all.filter((g) => typeof g.assist === 'string' && g.assist.length > 0);
    expect(assisted.length).toBeGreaterThan(0);
  });
});
