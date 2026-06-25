import { describe, it, expect } from 'vitest';
import {
  CHALLENGE_TIERS,
  CUP_TIERS,
  PACKS,
  matchReward,
  quickSell,
} from '../economy';
import { CARDS, cardValue } from '../../../data/cards';

// ---------------------------------------------------------------------------
// Pack odds
// ---------------------------------------------------------------------------

describe('pack odds', () => {
  for (const pack of PACKS) {
    it(`${pack.id} odds sum to 1 (±1e-9)`, () => {
      const sum = Object.values(pack.odds).reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    });
  }
});

describe('arcade token rewards', () => {
  it('lets weekly Stars Challenge tiers award extra Challenge Chronicle tokens', () => {
    expect(CHALLENGE_TIERS.some((tier) => (tier.tokens ?? 0) > 0)).toBe(true);
  });

  it('lets Cup Stars tiers award bonus Challenge Chronicle tokens', () => {
    expect(CUP_TIERS.some((tier) => (tier.tokens ?? 0) > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// matchReward
// ---------------------------------------------------------------------------

describe('matchReward', () => {
  it('win 2-0 = 400 + 50 + 75 = 525', () => {
    expect(matchReward('win', 2, 0)).toBe(525);
  });

  it('loss 0-3 = 60 (no clean sheet, no goals)', () => {
    expect(matchReward('loss', 0, 3)).toBe(60);
  });

  it('draw 1-1 = 150 + 25 = 175 (no clean sheet)', () => {
    expect(matchReward('draw', 1, 1)).toBe(175);
  });

  it('draw 0-0 = 150 + 75 clean sheet = 225', () => {
    expect(matchReward('draw', 0, 0)).toBe(225);
  });

  it('win 3-0 with mult 2 = (400 + 75 + 75) * 2 = 1100', () => {
    expect(matchReward('win', 3, 0, 2)).toBe(1100);
  });

  it('loss with clean sheet should not award clean sheet bonus', () => {
    // loss + goalsAgainst=0 is weird but the spec says result!=='loss'
    expect(matchReward('loss', 0, 0)).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// quickSell
// ---------------------------------------------------------------------------

describe('quickSell', () => {
  it('is positive for a sample gold card', () => {
    const gold = CARDS.find((c) => c.rarity === 'gold');
    expect(gold).toBeDefined();
    const qs = quickSell(gold!);
    expect(qs).toBeGreaterThan(0);
  });

  it('equals Math.round(cardValue * 0.33) for every rarity sample', () => {
    const rarities = ['bronze', 'silver', 'gold', 'special'] as const;
    for (const rarity of rarities) {
      const card = CARDS.find((c) => c.rarity === rarity);
      if (!card) continue; // skip if no card of this rarity exists
      const expected = Math.round(cardValue(card) * 0.33);
      expect(quickSell(card)).toBe(expected);
    }
  });
});
