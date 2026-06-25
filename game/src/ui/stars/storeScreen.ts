// Store screen for International Cup Stars — browse and buy packs.
import type { UI } from '../screens';
import { bind } from '../screens';
import type { AuthUser } from '../../net/auth';
import type { StarsState } from '../../game/stars/types';
import { PACKS } from '../../game/stars/economy';
import { openPack } from '../../game/stars/packs';
import { PURCHASE_PRODUCTS, applyPurchaseGrant, type PurchaseProduct } from '../../game/stars/products';
import { PAYPAL_CLIENT_ID } from '../../net/config';
import { capturePayPalOrder, createPayPalOrder, ensurePayPalSdk } from '../../net/payments';
import {
  render,
  esc,
  coinsChipHtml,
  tokensChipHtml,
  packArt,
  starsAsset,
  STARS_BG,
} from './components';
import { packOpenScreen } from './packOpen';
import { showReward } from './playScreen';

type StoreTab = 'packs' | 'topup';

export function storeScreen(
  ui: UI,
  opts: {
    state: StarsState;
    commit: () => void;
    onBack: () => void;
    authUser?: AuthUser | null;
    onAccount?: () => void;
  },
  tab: StoreTab = 'packs',
  notice = '',
): void {
  const { state } = opts;

  const bodyHtml = tab === 'packs'
    ? `<div class="pack-grid">${packsHtml(state)}</div>`
    : topUpHtml(opts.authUser ?? null);

  render(
    ui,
    `
    <h1 class="h-screen" style="margin:4px 0 10px">STORE</h1>
    <div class="row spread store-balance-row">
      ${coinsChipHtml(state.coins)}
      ${tokensChipHtml(state.arcadeTokens.balance)}
    </div>
    <div class="store-tabs">
      <button id="st-tab-packs" class="${tab === 'packs' ? 'on' : ''}">PACKS</button>
      <button id="st-tab-topup" class="${tab === 'topup' ? 'on' : ''}">TOP UP</button>
    </div>
    ${notice ? `<div class="store-message">${esc(notice)}</div>` : ''}
    ${bodyHtml}
    <div class="menu-col" style="margin-top:16px">
      <button class="btn small" id="st-back">&#9664; BACK</button>
    </div>`,
    STARS_BG,
  );

  bind('st-tab-packs', () => storeScreen(ui, opts, 'packs'));
  bind('st-tab-topup', () => storeScreen(ui, opts, 'topup'));
  bind('st-back', opts.onBack);

  if (tab === 'packs') bindPackTiles(ui, opts);
  else bindTopUp(ui, opts);
}

function packsHtml(state: StarsState): string {
  return PACKS.map((pack) => {
    const affordable = state.coins >= pack.price;
    const cls = `pack-tile${affordable ? '' : ' locked'}`;
    const dataAttr = affordable ? `data-pack="${esc(pack.id)}"` : '';
    return `
      <div class="${cls}" ${dataAttr} role="button" tabindex="0">
        <img class="pack-art" src="${packArt(pack.id)}" alt="${esc(pack.name)}">
        <div class="pack-name">${esc(pack.name)}</div>
        <div class="pack-price">&#9678; <span class="money">${pack.price.toLocaleString()}</span></div>
        <div class="pack-size" style="font-size:0.7em;opacity:0.75;margin-top:2px">${pack.size} players</div>
        ${!affordable ? `<div class="tag" style="margin-top:4px;font-size:0.65em">NEED ${(pack.price - state.coins).toLocaleString()} MORE</div>` : ''}
      </div>`;
  }).join('');
}

function topUpHtml(user: AuthUser | null): string {
  if (!user) {
    return `
      <div class="panel store-signin-panel">
        <div class="pack-name">SIGN IN TO TOP UP</div>
        <p class="subtle" style="margin:0">Purchases are attached to your Grayson Games account so they can be restored across devices.</p>
        <button class="btn primary small" id="st-account">ACCOUNT <span class="arrow">▶</span></button>
      </div>`;
  }

  const products = PURCHASE_PRODUCTS.map((product) => topUpCardHtml(product)).join('');
  return `
    <div class="topup-grid">
      ${products}
    </div>`;
}

function topUpCardHtml(product: PurchaseProduct): string {
  const reward = [
    product.coins > 0 ? `${product.coins.toLocaleString()} coins` : '',
    product.tokens > 0 ? `${product.tokens.toLocaleString()} tokens` : '',
  ].filter(Boolean).join(' + ');
  return `
    <div class="topup-card" data-sku="${esc(product.sku)}">
      <img class="topup-art" src="${starsAsset(product.art)}" alt="${esc(product.name)}">
      <div class="pack-name">${esc(product.name)}</div>
      <div class="topup-reward">${esc(reward)}</div>
      <div class="topup-copy">${esc(product.description)}</div>
      <div class="topup-price">${esc(product.priceLabel)}</div>
      <div class="paypal-slot" id="paypal-${esc(product.sku)}">${PAYPAL_CLIENT_ID ? 'Loading checkout...' : 'Checkout unavailable'}</div>
    </div>`;
}

function bindPackTiles(
  ui: UI,
  opts: { state: StarsState; commit: () => void; onBack: () => void; authUser?: AuthUser | null; onAccount?: () => void },
): void {
  ui.root.querySelectorAll<HTMLElement>('[data-pack]').forEach((el) => {
    el.addEventListener('click', () => {
      const packId = el.getAttribute('data-pack');
      if (!packId) return;
      try {
        const res = openPack(opts.state, packId);
        opts.commit();
        packOpenScreen(ui, {
          pulled: res.pulled,
          state: opts.state,
          commit: opts.commit,
          onDone: () => storeScreen(ui, opts),
        });
      } catch (err) {
        // Shouldn't normally fire (tile is hidden when locked), but guard anyway.
        console.warn('pack open failed', err);
      }
    });
  });
}

function bindTopUp(
  ui: UI,
  opts: { state: StarsState; commit: () => void; onBack: () => void; authUser?: AuthUser | null; onAccount?: () => void },
): void {
  if (!opts.authUser) {
    bind('st-account', opts.onAccount ?? opts.onBack);
    return;
  }
  if (!PAYPAL_CLIENT_ID) return;
  for (const product of PURCHASE_PRODUCTS) {
    void mountPayPalButton(ui, opts, product);
  }
}

async function mountPayPalButton(
  ui: UI,
  opts: { state: StarsState; commit: () => void; onBack: () => void; authUser?: AuthUser | null; onAccount?: () => void },
  product: PurchaseProduct,
): Promise<void> {
  const slot = ui.root.querySelector<HTMLElement>(`#paypal-${product.sku}`);
  if (!slot) return;
  try {
    const ready = await ensurePayPalSdk();
    if (!ready || !window.paypal?.Buttons) {
      slot.textContent = 'Checkout unavailable';
      return;
    }
    slot.innerHTML = '';
    await window.paypal.Buttons({
      createOrder: () => createPayPalOrder(product.sku),
      onApprove: async (data) => {
        slot.textContent = 'Confirming...';
        const result = await capturePayPalOrder(data.orderID);
        if (!result.ok || !result.grant) {
          storeScreen(ui, opts, 'topup', result.error ?? 'Purchase could not be completed.');
          return;
        }
        const applied = applyPurchaseGrant(opts.state, result.grant);
        opts.commit();
        const lines = [
          product.name,
          applied.applied ? 'Added to your club.' : 'Already claimed on this device.',
        ];
        showReward(ui, {
          title: 'PURCHASE COMPLETE',
          coins: result.grant.coins,
          tokens: result.grant.tokens,
          lines,
          onDone: () => storeScreen(ui, opts, 'topup'),
        });
      },
      onError: (err) => {
        console.warn('PayPal checkout failed', err);
        storeScreen(ui, opts, 'topup', 'PayPal checkout failed. Please try again.');
      },
      onCancel: () => storeScreen(ui, opts, 'topup', 'Purchase cancelled.'),
    }).render(slot);
  } catch (err) {
    console.warn('PayPal checkout unavailable', err);
    slot.textContent = 'Checkout unavailable';
  }
}
