import { describe, it, expect } from 'vitest';
import { autoLineup, formationDefaultTactics, lineupSlotFits, normalizeLineupForFormation, teamDefaultLineup } from '../formations';
import type { Pos, TeamData } from '../types';

type P = { pos: Pos; pace: number; pass: number; shoot: number; tackle: number; keeping: number };

// A pool where several outfield players have IDENTICAL attributes (hence equal
// overallRating ties). The chosen XI must be identical regardless of JS-engine
// sort stability — host and guest can run different browsers in online play.
function pool(): P[] {
  const gk: P = { pos: 'GK', pace: 50, pass: 50, shoot: 30, tackle: 40, keeping: 80 };
  const out = (pos: Pos): P => ({ pos, pace: 70, pass: 70, shoot: 70, tackle: 70, keeping: 30 });
  const players: P[] = [gk, gk, gk];
  for (let i = 0; i < 8; i++) players.push(out('DF'));
  for (let i = 0; i < 8; i++) players.push(out('MF'));
  for (let i = 0; i < 6; i++) players.push(out('FW'));
  return players;
}

describe('autoLineup determinism', () => {
  it('is a total order — ties break on squad index, so the XI is stable', () => {
    const players = pool();
    const a = autoLineup(players, '4-4-2');
    const b = autoLineup(players.slice(), '4-4-2');
    expect(a).toEqual(b); // same input → same output
    expect(a).toHaveLength(11);
    expect(new Set(a).size).toBe(11); // no duplicate picks
    // first GK (index 0) should be chosen over the equal GKs at 1,2
    expect(a[0]).toBe(0);
  });
});

describe('teamDefaultLineup', () => {
  it('uses a valid team default lineup before falling back to auto selection', () => {
    const players = pool();
    const team = {
      players,
      defaultLineup: { formation: '4-3-3', starters: [2, 3, 4, 5, 6, 11, 12, 13, 19, 20, 21] },
    } as TeamData;

    const lineup = teamDefaultLineup(team);
    expect(lineup.formation).toBe(team.defaultLineup!.formation);
    expect(lineup.starters).toEqual(team.defaultLineup!.starters);
    expect(lineup.tactics).toEqual(formationDefaultTactics('4-3-3'));
  });

  it('reorders a valid default XI into formation slot roles instead of trusting raw order', () => {
    const players = [
      { pos: 'GK', pace: 50, pass: 55, shoot: 30, tackle: 35, keeping: 86 },
      { pos: 'DF', pace: 78, pass: 68, shoot: 42, tackle: 79, keeping: 15 },
      { pos: 'DF', pace: 62, pass: 72, shoot: 38, tackle: 87, keeping: 12 },
      { pos: 'DF', pace: 60, pass: 71, shoot: 36, tackle: 84, keeping: 12 },
      { pos: 'DF', pace: 76, pass: 66, shoot: 40, tackle: 78, keeping: 12 },
      { pos: 'MF', pace: 68, pass: 86, shoot: 63, tackle: 78, keeping: 10 },
      { pos: 'MF', pace: 73, pass: 84, shoot: 70, tackle: 66, keeping: 10 },
      { pos: 'FW', pace: 88, pass: 77, shoot: 78, tackle: 38, keeping: 10 },
      { pos: 'MF', pace: 77, pass: 88, shoot: 77, tackle: 54, keeping: 10 },
      { pos: 'FW', pace: 90, pass: 76, shoot: 80, tackle: 34, keeping: 10 },
      { pos: 'FW', pace: 72, pass: 76, shoot: 91, tackle: 32, keeping: 10 },
    ] satisfies P[];
    const raw = [0, 1, 2, 5, 3, 4, 7, 8, 10, 6, 9];
    const lineup = normalizeLineupForFormation(players, '4-2-3-1', raw);

    expect(new Set(lineup).size).toBe(11);
    expect(lineup[0]).toBe(0);
    for (let slot = 0; slot < lineup.length; slot++) {
      expect(lineupSlotFits(players[lineup[slot]], '4-2-3-1', slot)).toBe(true);
    }
    expect(players[lineup[2]].pos).toBe('DF');
    expect(players[lineup[3]].pos).toBe('DF');
    expect(players[lineup[5]].pos).toBe('MF');
    expect(players[lineup[6]].pos).toBe('MF');
    expect(players[lineup[10]].pos).toBe('FW');
  });

  it('falls back when a default lineup is incomplete', () => {
    const players = pool();
    const team = {
      players,
      defaultLineup: { formation: '4-3-3', starters: [2, 3, 4] },
    } as TeamData;

    const lineup = teamDefaultLineup(team);

    expect(lineup.formation).toBe('4-3-3');
    expect(lineup.starters).toHaveLength(11);
    expect(new Set(lineup.starters).size).toBe(11);
    expect(players[lineup.starters[0]].pos).toBe('GK');
    expect(lineup.tactics).toEqual(formationDefaultTactics('4-3-3'));
  });
});
