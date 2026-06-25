import { describe, expect, it } from 'vitest';
import {
  isPurchaseGrant,
  paypalSdkUrl,
  paymentApiUrl,
} from '../payments';

describe('payment client helpers', () => {
  it('builds game-scoped API URLs from a configured base', () => {
    expect(paymentApiUrl('https://api.example.com/', '/paypal/orders')).toBe(
      'https://api.example.com/api/soccer/paypal/orders',
    );
  });

  it('builds a GBP PayPal SDK URL for the public client id', () => {
    const url = paypalSdkUrl('client_123');

    expect(url).toContain('client-id=client_123');
    expect(url).toContain('currency=GBP');
    expect(url).toContain('intent=capture');
  });

  it('validates captured purchase grants before local application', () => {
    expect(isPurchaseGrant({
      purchaseId: 'paypal-order-123',
      sku: 'tokens_5',
      coins: 0,
      tokens: 5,
    })).toBe(true);
    expect(isPurchaseGrant({ purchaseId: 'x', sku: 'tokens_5', coins: -1, tokens: 5 })).toBe(false);
    expect(isPurchaseGrant({ sku: 'tokens_5', coins: 0, tokens: 5 })).toBe(false);
  });
});
