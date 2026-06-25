import { describe, expect, it } from 'vitest';
import { MatchSim } from '../matchSim';
import { autoLineup } from '../formations';
import { NULL_INPUT } from '../types';
import type { MatchConfig, PadInput } from '../types';
import { TEAMS } from '../../data/teams';

const idle: [PadInput, PadInput] = [{ ...NULL_INPUT }, { ...NULL_INPUT }];

describe('focusPlayer (Be-A-Pro) control pin', () => {
  it('locks human control to the avatar player across the match', () => {
    const a = TEAMS[0], b = TEAMS[1];
    const starters = autoLineup(a.players, '4-3-3');
    const focusSquadIdx = starters[5]; // a midfielder starter
    const cfg: MatchConfig = {
      teams: [
        { data: a, lineup: { formation: '4-3-3', starters }, kit: a.colors.home, controller: 'human' },
        { data: b, lineup: { formation: '4-4-2', starters: autoLineup(b.players, '4-4-2') }, kit: b.colors.away, controller: 'ai' },
      ],
      halfLengthSec: 30, difficulty: 1, cupTie: false, seed: 42,
      focusPlayer: { team: 0, squadIdx: focusSquadIdx },
    };
    const sim = new MatchSim(cfg);
    const fp = sim.state.players.find((p) => p.team === 0 && p.squadIdx === focusSquadIdx)!;
    expect(fp).toBeTruthy();
    for (let i = 0; i < 900; i++) {
      sim.step(idle);
      if (sim.state.phase === 'finished') break;
      // control must never leave the avatar while the match is live
      expect(sim.state.controlledIdx[0]).toBe(fp.idx);
      // exactly one player on team 0 is human-controlled, and it's the avatar
      const controlled = sim.state.players.filter((p) => p.team === 0 && p.control);
      expect(controlled.length).toBe(1);
      expect(controlled[0].idx).toBe(fp.idx);
    }
  });

  it('does not affect a normal (non-focus) human match', () => {
    const a = TEAMS[0], b = TEAMS[1];
    const cfg: MatchConfig = {
      teams: [
        { data: a, lineup: { formation: '4-4-2', starters: autoLineup(a.players, '4-4-2') }, kit: a.colors.home, controller: 'human' },
        { data: b, lineup: { formation: '4-4-2', starters: autoLineup(b.players, '4-4-2') }, kit: b.colors.away, controller: 'ai' },
      ],
      halfLengthSec: 20, difficulty: 1, cupTie: false, seed: 7,
    };
    const sim = new MatchSim(cfg);
    sim.step(idle);
    // normal auto-switching is free to move control around (not pinned to one idx)
    expect(sim.state.controlledIdx[0]).toBeGreaterThanOrEqual(0);
  });
});
