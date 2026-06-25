import { describe, expect, it } from 'vitest';
import { createArcadeTokensState } from '../arcadeTokens';
import {
  PURCHASE_PRODUCTS,
  applyPurchaseGrant,
  productBySku,
} from '../products';
import { newStars } from '../store';

describe('Stars purchase products', () => {
  it('defines the approved fixed PayPal bundles in GBP', () => {
    expect(PURCHASE_PRODUCTS.map((p) => p.sku)).toEqual([
      'tokens_5',
      'coins_10000',
      'bundle_25000_5',
      'bundle_60000_15',
    ]);
    expect(productBySku('tokens_5')?.pricePence).toBe(99);
    expect(productBySku('coins_10000')?.coins).toBe(10_000);
    expect(productBySku('bundle_60000_15')?.tokens).toBe(15);
    expect(PURCHASE_PRODUCTS.every((p) => p.currency === 'GBP')).toBe(true);
  });

  it('rejects unknown product ids', () => {
    expect(productBySku('paid_random_pack')).toBeUndefined();
  });

  it('applies a captured purchase once and bypasses the free token cap for paid tokens', () => {
    const state = newStars();
    state.coins = 100;
    state.arcadeTokens = createArcadeTokensState(Date.UTC(2026, 5, 20));
    state.arcadeTokens.balance = 19;

    const first = applyPurchaseGrant(state, {
      purchaseId: 'paypal-order-123',
      sku: 'bundle_60000_15',
      coins: 60_000,
      tokens: 15,
    });
    const second = applyPurchaseGrant(state, {
      purchaseId: 'paypal-order-123',
      sku: 'bundle_60000_15',
      coins: 60_000,
      tokens: 15,
    });

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(state.coins).toBe(60_100);
    expect(state.arcadeTokens.balance).toBe(34);
    expect(state.purchaseIds).toEqual(['paypal-order-123']);
  });
});
