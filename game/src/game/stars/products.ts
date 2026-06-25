import rawProducts from './purchaseProducts.json';
import type { StarsState } from './types';
import { addPaidArcadeTokens } from './arcadeTokens';

export interface PurchaseProduct {
  sku: string;
  name: string;
  description: string;
  currency: 'GBP';
  pricePence: number;
  priceLabel: string;
  coins: number;
  tokens: number;
  art: string;
}

export interface PurchaseGrant {
  purchaseId: string;
  sku: string;
  coins: number;
  tokens: number;
}

export interface PurchaseApplyResult {
  applied: boolean;
  reason?: 'duplicate';
}

export const PURCHASE_PRODUCTS: PurchaseProduct[] = rawProducts as PurchaseProduct[];

export function productBySku(sku: string): PurchaseProduct | undefined {
  return PURCHASE_PRODUCTS.find((product) => product.sku === sku);
}

export function applyPurchaseGrant(state: StarsState, grant: PurchaseGrant): PurchaseApplyResult {
  state.purchaseIds ??= [];
  if (state.purchaseIds.includes(grant.purchaseId)) {
    return { applied: false, reason: 'duplicate' };
  }
  state.coins = Math.max(0, state.coins + Math.max(0, Math.floor(grant.coins)));
  if (grant.tokens > 0) addPaidArcadeTokens(state.arcadeTokens, grant.tokens);
  state.purchaseIds.push(grant.purchaseId);
  return { applied: true };
}
