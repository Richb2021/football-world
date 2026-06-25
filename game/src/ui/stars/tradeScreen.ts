// Trade Portal for International Cup Stars — sell spare players for coins, with
// search / position / rarity filters and sorting so a big collection stays usable.
import type { UI } from '../screens';
import { bind } from '../screens';
import type { StarsState } from '../../game/stars/types';
import { quickSell } from '../../game/stars/economy';
import { removeCard, addCoins, starsCardById } from '../../game/stars/store';
import { showConfirm } from '../modal';
import type { PlayerCard } from '../../data/cards';
import type { Pos } from '../../sim/types';
import {
  render, esc, playerCardHtml, coinsChipHtml, STARS_BG,
  segHtml, sortCards, RARITY_FILTER_OPTS, CARD_SORT_OPTS,
  type RarityFilter, type CardSortKey,
} from './components';

type PosFilter = 'all' | Pos;

const POS_OPTS: { v: PosFilter; label: string }[] = [
  { v: 'all', label: 'All' }, { v: 'GK', label: 'GK' }, { v: 'DF', label: 'DF' },
  { v: 'MF', label: 'MF' }, { v: 'FW', label: 'FW' },
];

export function tradeScreen(
  ui: UI,
  opts: { state: StarsState; commit: () => void; onBack: () => void },
): void {
  const { state } = opts;

  // Filter/sort state persists across re-renders within this screen visit.
  let search = '';
  let posFilter: PosFilter = 'all';
  let rarityFilter: RarityFilter = 'all';
  let sort: CardSortKey = 'rating';

  /** Live name search over the already-rendered grid (no re-render → keeps focus). */
  const applySearch = (): void => {
    const q = search.trim().toLowerCase();
    let visible = 0;
    ui.root.querySelectorAll<HTMLElement>('.card-grid .player-card').forEach((el) => {
      const name = el.getAttribute('data-name') ?? '';
      const show = !q || name.includes(q);
      el.classList.toggle('is-hidden', !show);
      if (show) visible++;
    });
    const empty = ui.root.querySelector<HTMLElement>('#tp-empty');
    if (empty) empty.classList.toggle('is-hidden', visible > 0);
  };

  const draw = (): void => {
    const ownedIds = Object.keys(state.owned);

    if (ownedIds.length === 0) {
      render(
        ui,
        `
        <h1 class="h-screen" style="margin:4px 0 10px">TRADE PORTAL</h1>
        <div class="panel" style="text-align:center;padding:40px 24px;margin-top:24px">
          <p style="margin:0;font-weight:700;font-size:1.1em">Your club is empty — open some packs!</p>
        </div>
        <div class="menu-col" style="margin-top:20px">
          <button class="btn small" id="tp-back">&#9664; BACK</button>
        </div>`,
        STARS_BG,
      );
      bind('tp-back', opts.onBack);
      return;
    }

    // How many of each id are locked into the starting XI (can't be sold).
    const starterCount: Record<string, number> = {};
    for (const id of state.squad.starters) {
      if (id) starterCount[id] = (starterCount[id] ?? 0) + 1;
    }

    const totalOwned = ownedIds.reduce((sum, id) => sum + (state.owned[id] ?? 0), 0);

    // Resolve → filter by position + rarity → sort.
    let cards = ownedIds
      .map((id) => starsCardById(state, id))
      .filter((c): c is PlayerCard => !!c);
    if (posFilter !== 'all') cards = cards.filter((c) => c.pos === posFilter);
    if (rarityFilter !== 'all') cards = cards.filter((c) => c.rarity === rarityFilter);
    cards = sortCards(cards, sort, quickSell);

    const gridHtml = cards
      .map((card) => {
        const ownedCount = state.owned[card.id] ?? 0;
        const sellable = ownedCount - (starterCount[card.id] ?? 0);
        const common = `data-name="${esc(card.name.toLowerCase())}"`;
        if (sellable > 0) {
          return playerCardHtml(card, {
            sellBadge: quickSell(card),
            cornerBadge: ownedCount > 1 ? `×${ownedCount}` : undefined,
            attrs: `data-id="${esc(card.id)}" data-sellable="1" ${common} role="button" tabindex="0"`,
          });
        }
        return playerCardHtml(card, {
          extraClass: 'locked-card',
          cornerBadge: 'IN XI',
          attrs: `data-sellable="0" ${common} title="In your starting XI"`,
        });
      })
      .join('');

    render(
      ui,
      `
      <h1 class="h-screen" style="margin:4px 0 8px">TRADE PORTAL</h1>
      <div class="row spread" style="margin-bottom:8px">
        ${coinsChipHtml(state.coins)}
        <span class="tag">${totalOwned} PLAYER${totalOwned !== 1 ? 'S' : ''}</span>
      </div>
      <p class="trade-tip">Sell spare players for coins. Players in your starting XI can't be sold.</p>
      <div class="filter-bar">
        <input id="tp-search" class="filter-search" type="text" placeholder="Search players…"
          autocomplete="off" spellcheck="false" value="${esc(search)}" />
        ${segHtml('pos', POS_OPTS, posFilter)}
        ${segHtml('rarity', RARITY_FILTER_OPTS, rarityFilter)}
        <span class="filter-label">Sort</span>${segHtml('sort', CARD_SORT_OPTS, sort)}
      </div>
      <div class="card-grid">
        ${gridHtml}
      </div>
      <div class="trade-empty is-hidden" id="tp-empty">No players match your filters.</div>
      <div class="menu-col" style="margin-top:16px">
        <button class="btn small" id="tp-back">&#9664; BACK</button>
      </div>`,
      STARS_BG,
    );

    // Sellable card → confirm + sell.
    ui.root.querySelectorAll<HTMLElement>('.player-card[data-sellable="1"]').forEach((el) => {
      el.addEventListener('click', async () => {
        const id = el.getAttribute('data-id');
        if (!id) return;
        const card = starsCardById(state, id);
        if (!card) return;
        const value = quickSell(card);
        const ok = await showConfirm({
          title: 'SELL PLAYER?',
          message: `Sell ${card.name} for ${value.toLocaleString()} coins?`,
          confirmLabel: 'SELL',
        });
        if (!ok) return;
        removeCard(state, id, 1);
        addCoins(state, value);
        opts.commit();
        draw();
      });
    });

    // Filter / sort controls re-render (preserving the search text via closure).
    ui.root.querySelectorAll<HTMLElement>('[data-pos]').forEach((el) =>
      el.addEventListener('click', () => { posFilter = el.getAttribute('data-pos') as PosFilter; draw(); }));
    ui.root.querySelectorAll<HTMLElement>('[data-rarity]').forEach((el) =>
      el.addEventListener('click', () => { rarityFilter = el.getAttribute('data-rarity') as RarityFilter; draw(); }));
    ui.root.querySelectorAll<HTMLElement>('[data-sort]').forEach((el) =>
      el.addEventListener('click', () => { sort = el.getAttribute('data-sort') as CardSortKey; draw(); }));

    // Live search filters the rendered grid without a re-render (keeps focus).
    const searchEl = ui.root.querySelector<HTMLInputElement>('#tp-search');
    if (searchEl) {
      searchEl.addEventListener('input', () => { search = searchEl.value; applySearch(); });
    }

    bind('tp-back', opts.onBack);
    applySearch();
  };

  draw();
}
