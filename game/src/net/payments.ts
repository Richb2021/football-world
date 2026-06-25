import { API_BASE_URL, PAYPAL_CLIENT_ID } from './config';
import { GAME_ID, supabase } from './supabase';
import type { PurchaseGrant } from '../game/stars/products';

export interface CapturePurchaseResponse {
  ok: boolean;
  alreadyGranted?: boolean;
  grant?: PurchaseGrant;
  error?: string;
}

export function paymentApiUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}/api/${GAME_ID}${suffix}`;
}

export function paypalSdkUrl(clientId = PAYPAL_CLIENT_ID): string {
  const params = new URLSearchParams({
    'client-id': clientId,
    currency: 'GBP',
    intent: 'capture',
    components: 'buttons',
  });
  return `https://www.paypal.com/sdk/js?${params.toString()}`;
}

export function isPurchaseGrant(value: unknown): value is PurchaseGrant {
  if (!value || typeof value !== 'object') return false;
  const grant = value as Partial<PurchaseGrant>;
  const coins = grant.coins;
  const tokens = grant.tokens;
  return (
    typeof grant.purchaseId === 'string' &&
    grant.purchaseId.length > 0 &&
    typeof grant.sku === 'string' &&
    grant.sku.length > 0 &&
    typeof coins === 'number' &&
    Number.isInteger(coins) &&
    coins >= 0 &&
    typeof tokens === 'number' &&
    Number.isInteger(tokens) &&
    tokens >= 0
  );
}

export async function authHeader(): Promise<Record<string, string>> {
  if (!supabase) throw new Error('Sign in is required before purchase.');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in is required before purchase.');
  return { Authorization: `Bearer ${token}` };
}

export async function createPayPalOrder(sku: string): Promise<string> {
  const headers = await authHeader();
  const response = await fetch(paymentApiUrl(API_BASE_URL, '/paypal/orders'), {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body?.orderId !== 'string') {
    throw new Error(body?.error ?? 'Unable to create PayPal order.');
  }
  return body.orderId;
}

export async function capturePayPalOrder(orderId: string): Promise<CapturePurchaseResponse> {
  const headers = await authHeader();
  const response = await fetch(paymentApiUrl(API_BASE_URL, `/paypal/orders/${encodeURIComponent(orderId)}/capture`), {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: body?.error ?? 'Unable to capture PayPal order.' };
  }
  if (!isPurchaseGrant(body?.grant)) {
    return { ok: false, error: 'PayPal capture did not return a valid purchase grant.' };
  }
  return { ok: true, alreadyGranted: Boolean(body.alreadyGranted), grant: body.grant };
}

export async function ensurePayPalSdk(clientId = PAYPAL_CLIENT_ID): Promise<boolean> {
  if (!clientId) return false;
  if (window.paypal?.Buttons) return true;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-paypal-sdk="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('PayPal SDK failed to load.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = paypalSdkUrl(clientId);
    script.async = true;
    script.dataset.paypalSdk = 'true';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('PayPal SDK failed to load.')), { once: true });
    document.head.appendChild(script);
  });
  return Boolean(window.paypal?.Buttons);
}
