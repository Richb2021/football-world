// Pack-open reveal screen for International Cup Stars.
// Cards animate in via @keyframes poReveal (already in style.css); each card
// gets an inline animation-delay so they stagger in one by one.
import type { UI } from '../screens';
import type { StarsState } from '../../game/stars/types';
import type { PlayerCard } from '../../data/cards';
import { quickSell } from '../../game/stars/economy';
import { addCoins, removeCard, ownedCount } from '../../game/stars/store';
import {
  render,
  esc,
  playerCardHtml,
  STARS_BG,
  PACK_BURST,
} from './components';

export function packOpenScreen(
  ui: UI,
  opts: {
    pulled: PlayerCard[];
    state: StarsState;
    commit: () => void;
    onDone: () => void;
  },
  _sold: Set<number> = new Set(),
): void {
  const { pulled, state } = opts;
  const sold = _sold; // closure tracking which indices have been quick-sold

  // Build card markup with per-card animation delay
  const cardsHtml = pulled
    .map((card, i) => {
      const isGoldOrSpecial = card.rarity === 'gold' || card.rarity === 'special';
      const isSold = sold.has(i);
      const sellValue = quickSell(card);

      const soldBadge = `<span class="tag sell-badge" style="margin-top:4px;display:block">SOLD +${sellValue.toLocaleString()}</span>`;
      const sellBtn = `<button class="btn small" data-sell="${i}" style="margin-top:4px">QUICK SELL ${sellValue.toLocaleString()}</button>`;

      const owned = ownedCount(state, card.id);
      return `
        <div class="po-card${isGoldOrSpecial ? ' walkout' : ''}" style="animation-delay:${(i * 0.12).toFixed(2)}s">
          ${playerCardHtml(card, { attrs: `data-idx="${i}"`, cornerBadge: owned > 1 ? `×${owned}` : 'NEW' })}
          ${isSold ? soldBadge : sellBtn}
        </div>`;
    })
    .join('');

  // Check if any cards remain to be sold
  const allSold = pulled.every((_, i) => sold.has(i));

  render(
    ui,
    `
    <div class="pack-open">
      <img class="po-burst" src="${esc(PACK_BURST)}" alt="">
      <div class="po-cards">
        ${cardsHtml}
      </div>
      <div class="po-actions">
        ${
          !allSold
            ? `<button class="btn small" id="po-sell-all">QUICK SELL ALL</button>`
            : ''
        }
        <button class="btn primary" id="po-done">DONE</button>
      </div>
    </div>`,
    STARS_BG,
  );

  // Per-card quick sell
  ui.root.querySelectorAll<HTMLButtonElement>('[data-sell]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-sell'));
      if (sold.has(idx)) return; // already sold
      const card = pulled[idx];
      if (!card) return;
      // Guard: only sell if card still owned
      if (ownedCount(state, card.id) <= 0) return;
      removeCard(state, card.id);
      addCoins(state, quickSell(card));
      opts.commit();
      sold.add(idx);
      // Re-draw with updated sold set
      packOpenScreen(ui, opts, sold);
    });
  });

  // Sell all remaining cards
  ui.root.querySelector('#po-sell-all')?.addEventListener('click', () => {
    pulled.forEach((card, i) => {
      if (sold.has(i)) return;
      if (ownedCount(state, card.id) <= 0) return;
      removeCard(state, card.id);
      addCoins(state, quickSell(card));
      sold.add(i);
    });
    opts.commit();
    packOpenScreen(ui, opts, sold);
  });

  ui.root.querySelector('#po-done')?.addEventListener('click', () => opts.onDone());
}
