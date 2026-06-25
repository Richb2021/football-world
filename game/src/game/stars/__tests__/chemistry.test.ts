import { describe, it, expect } from 'vitest';
import { squadChemistry, formBoost } from '../chemistry';
import type { PlayerCard } from '../../../data/cards';
import type { FormationId } from '../../../sim/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCard(pos: PlayerCard['pos'], teamId: string, id = `${teamId}:${pos}`): PlayerCard {
  return {
    id,
    name: 'Test Player',
    teamId,
    nation: teamId,
    pos,
    overall: 80,
    rarity: 'gold',
    attrs: { pace: 80, pass: 80, shoot: 80, tackle: 80, keeping: 80 },
    age: 25,
  };
}

// 4-4-2 slot positions: GK, DF, DF, DF, DF, MF, MF, MF, MF, FW, FW
const FORMATION: FormationId = '4-4-2';

// ---------------------------------------------------------------------------
// Full in-position XI, all from one nation
// ---------------------------------------------------------------------------
describe('squadChemistry: full in-position XI, one nation', () => {
  const starters: PlayerCard[] = [
    makeCard('GK', 'england', 'england:gk'),
    makeCard('DF', 'england', 'england:df1'),
    makeCard('DF', 'england', 'england:df2'),
    makeCard('DF', 'england', 'england:df3'),
    makeCard('DF', 'england', 'england:df4'),
    makeCard('MF', 'england', 'england:mf1'),
    makeCard('MF', 'england', 'england:mf2'),
    makeCard('MF', 'england', 'england:mf3'),
    makeCard('MF', 'england', 'england:mf4'),
    makeCard('FW', 'england', 'england:fw1'),
    makeCard('FW', 'england', 'england:fw2'),
  ];

  const result = squadChemistry(starters, FORMATION);

  it('total is 100', () => {
    expect(result.total).toBe(100);
  });

  it('all perSlot values are 10', () => {
    for (const score of result.perSlot) {
      expect(score).toBe(10);
    }
  });

  it('perSlot has length 11', () => {
    expect(result.perSlot).toHaveLength(11);
  });
});

// ---------------------------------------------------------------------------
// All out-of-position squad (10 GKs + 1 DF all in wrong slots)
// ---------------------------------------------------------------------------
describe('squadChemistry: all out-of-position', () => {
  // 4-4-2 needs: GK, DF, DF, DF, DF, MF, MF, MF, MF, FW, FW
  // Put FWs in DF slots, GKs in MF/FW slots, etc.
  const starters: PlayerCard[] = [
    makeCard('FW', 'england', 'e:fw-in-gk'),   // slot 0 needs GK
    makeCard('GK', 'england', 'e:gk-in-df1'),   // slot 1 needs DF
    makeCard('GK', 'england', 'e:gk-in-df2'),
    makeCard('GK', 'england', 'e:gk-in-df3'),
    makeCard('GK', 'england', 'e:gk-in-df4'),
    makeCard('FW', 'england', 'e:fw-in-mf1'),   // slot 5 needs MF
    makeCard('FW', 'england', 'e:fw-in-mf2'),
    makeCard('FW', 'england', 'e:fw-in-mf3'),
    makeCard('FW', 'england', 'e:fw-in-mf4'),
    makeCard('DF', 'england', 'e:df-in-fw1'),   // slot 9 needs FW
    makeCard('DF', 'england', 'e:df-in-fw2'),
  ];

  const result = squadChemistry(starters, FORMATION);

  it('total is 0', () => {
    expect(result.total).toBe(0);
  });

  it('all perSlot values are 0', () => {
    for (const score of result.perSlot) {
      expect(score).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Bounds: total always 0..100
// ---------------------------------------------------------------------------
describe('squadChemistry: bounds', () => {
  it('null squad has total 0', () => {
    const result = squadChemistry(new Array(11).fill(null), FORMATION);
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(100);
    expect(result.total).toBe(0);
  });

  it('mixed squad total is in range 0..100', () => {
    const starters: (PlayerCard | null)[] = [
      makeCard('GK', 'france', 'f:gk'),
      makeCard('DF', 'france', 'f:df1'),
      makeCard('DF', 'spain', 's:df2'),
      null,
      makeCard('DF', 'france', 'f:df3'),
      makeCard('MF', 'spain', 's:mf1'),
      null,
      makeCard('MF', 'france', 'f:mf2'),
      makeCard('MF', 'spain', 's:mf3'),
      makeCard('FW', 'france', 'f:fw1'),
      null,
    ];
    const result = squadChemistry(starters, FORMATION);
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// formBoost
// ---------------------------------------------------------------------------
describe('formBoost', () => {
  it('formBoost(0) === 50', () => {
    expect(formBoost(0)).toBe(50);
  });

  it('formBoost(100) is approximately 62', () => {
    expect(formBoost(100)).toBeCloseTo(62, 0);
  });

  it('is monotonically non-decreasing', () => {
    for (let i = 0; i < 100; i++) {
      expect(formBoost(i + 1)).toBeGreaterThanOrEqual(formBoost(i));
    }
  });

  it('clamps below 0', () => {
    expect(formBoost(-50)).toBe(50);
  });

  it('clamps above 100', () => {
    expect(formBoost(150)).toBe(formBoost(100));
  });
});
