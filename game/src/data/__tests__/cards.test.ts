import { describe, expect, it } from 'vitest';
import { CARDS, CARD_BY_ID, cardById, rarityOf, cardValue } from '../cards';
import type { Rarity } from '../cards';

describe('CARDS catalog', () => {
  it('has more than 1000 cards with valid fields', () => {
    expect(CARDS.length).toBeGreaterThan(1000);

    for (const card of CARDS) {
      expect(card.id.length).toBeGreaterThan(0);
      expect(['GK', 'DF', 'MF', 'FW']).toContain(card.pos);
      expect(Number.isFinite(card.overall)).toBe(true);
      expect(card.overall).toBeGreaterThanOrEqual(1);
      expect(card.overall).toBeLessThanOrEqual(100);
    }
  });

  it('has globally unique ids', () => {
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
  });
});

describe('rarityOf', () => {
  it('applies the correct thresholds', () => {
    expect(rarityOf(69)).toBe<Rarity>('bronze');
    expect(rarityOf(70)).toBe<Rarity>('silver');
    expect(rarityOf(79)).toBe<Rarity>('silver');
    expect(rarityOf(80)).toBe<Rarity>('gold');
    expect(rarityOf(87)).toBe<Rarity>('gold');
    expect(rarityOf(88)).toBe<Rarity>('special');
  });
});

describe('cardValue', () => {
  it('is always positive', () => {
    for (const card of CARDS) {
      expect(cardValue(card)).toBeGreaterThan(0);
    }
  });

  it('special-tier value exceeds bronze-tier value', () => {
    const bronzeCard = CARDS.find((c) => c.rarity === 'bronze');
    const specialCard = CARDS.find((c) => c.rarity === 'special');
    expect(bronzeCard).toBeTruthy();
    expect(specialCard).toBeTruthy();
    expect(cardValue(specialCard!)).toBeGreaterThan(cardValue(bronzeCard!));
  });

  it('honors an explicit zero value for custom reward cards', () => {
    expect(cardValue({ ...CARDS[0], id: 'custom:zero-value', value: 0 })).toBe(0);
  });
});

describe('CARD_BY_ID and cardById', () => {
  it('CARD_BY_ID resolves the first card', () => {
    expect(CARD_BY_ID.get(CARDS[0].id)).toBe(CARDS[0]);
  });

  it('cardById returns undefined for a missing id', () => {
    expect(cardById('nope__missing')).toBeUndefined();
  });
});
