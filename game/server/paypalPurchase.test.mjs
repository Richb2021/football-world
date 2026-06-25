import assert from 'node:assert/strict';
import test from 'node:test';

import { productBySku } from './paypalProducts.mjs';
import { grantProductToSaveData } from './paypalPurchase.mjs';

test('server validates the fixed PayPal bundle catalogue', () => {
  assert.equal(productBySku('tokens_5').amount, '0.99');
  assert.equal(productBySku('bundle_60000_15').tokens, 15);
  assert.equal(productBySku('paid_random_pack'), null);
});

test('server purchase grant is idempotent and preserves wrapped Stars saves', () => {
  const save = {
    meta: { id: 'main', name: 'CUP STARS' },
    payload: {
      version: 1,
      coins: 100,
      purchaseIds: [],
      arcadeTokens: {
        balance: 19,
        lastDailyGrantDay: '2026-06-20',
        lastWeeklyGrantWeek: '2026-W25',
      },
    },
  };
  const product = productBySku('bundle_60000_15');

  const first = grantProductToSaveData(save, product, 'paypal-order-123');
  const second = grantProductToSaveData(first.data, product, 'paypal-order-123');

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(second.data.payload.coins, 60100);
  assert.equal(second.data.payload.arcadeTokens.balance, 34);
  assert.deepEqual(second.data.payload.purchaseIds, ['paypal-order-123']);
});
