// Shared building blocks for the International Cup Stars UI. Keeping the player
// card markup in one place guarantees it matches the .player-card CSS and looks
// identical across the squad builder, store reveal, and trade portal.
import { TEAMS } from '../../data/teams';
import type { PlayerCard, Rarity } from '../../data/cards';
import type { UI } from '../screens';

const BASE = import.meta.env.BASE_URL;

/** Absolute URL for a generated UI asset (falls back gracefully if missing). */
export function starsAsset(file: string): string {
  return `${BASE}assets/ui/${file}`;
}
export const STARS_BG = starsAsset('stars_hub.webp');
export const ONLINE_BG = starsAsset('online_hub.webp');
export const STARS_CREST = starsAsset('stars_crest.webp');
export const PACK_BURST = starsAsset('pack_burst.webp');
export function packArt(tier: string): string {
  return starsAsset(`pack_${tier}.webp`);
}
export function frameArt(rarity: Rarity): string {
  return starsAsset(`frame_${rarity}.webp`);
}

/** Render an inner-HTML screen via the UI class's private screen() method
 * (the same cast careerScreens.ts uses), with an optional background image. */
export function render(ui: UI, inner: string, bg?: string): HTMLElement {
  return (ui as unknown as { screen: (inner: string, bg?: string) => HTMLElement }).screen(inner, bg);
}

/** Minimal HTML-escape (screens.ts keeps its own private one). */
export function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const RARITY_CLASS: Record<Rarity, string> = {
  bronze: 'pc-bronze',
  silver: 'pc-silver',
  gold: 'pc-gold',
  special: 'pc-special',
};

// teamId -> home shirt colour + 3-letter code, for the club badge on each card.
const TEAM_SHIRT = new Map<string, string>(TEAMS.map((t) => [t.id, t.colors.home.shirt]));
const TEAM_SHORT = new Map<string, string>(TEAMS.map((t) => [t.id, t.short]));

/** Pick black or white text for readability over a hex background colour. */
function readableInk(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#0b1020' : '#fff';
}

export interface PlayerCardOpts {
  selected?: boolean;
  /** show a quick-sell coin value badge (top-right) */
  sellBadge?: number;
  /** small badge in the bottom-left corner (e.g. "×3" or "IN XI"), pre-escaped */
  cornerBadge?: string;
  /** extra attributes on the root (e.g. data-id="..."), pre-escaped */
  attrs?: string;
  extraClass?: string;
  /** skip the ornate frame overlay (e.g. on the small squad-pitch cards) */
  noFrame?: boolean;
}

/** Markup for one collectible player card. */
export function playerCardHtml(card: PlayerCard, opts: PlayerCardOpts = {}): string {
  const shirt = TEAM_SHIRT.get(card.teamId) ?? '#888';
  const cls = `player-card ${RARITY_CLASS[card.rarity]}${opts.noFrame ? '' : ' pc-framed'}${opts.selected ? ' selected' : ''}${opts.extraClass ? ' ' + opts.extraClass : ''}`;
  const a = card.attrs;
  const short = TEAM_SHORT.get(card.teamId) ?? card.nation.slice(0, 3).toUpperCase();
  const badgeBg = `radial-gradient(circle at 36% 30%, ${esc(shirt)}, ${esc(shirt)} 52%, rgba(0,0,0,0.4))`;
  const sell = opts.sellBadge !== undefined ? `<span class="sell-badge">${opts.sellBadge.toLocaleString()}</span>` : '';
  const corner = opts.cornerBadge ? `<span class="pc-corner">${opts.cornerBadge}</span>` : '';
  const frameStyle = opts.noFrame ? '' : ` style="--pc-frame-img:url('${frameArt(card.rarity)}')"`;
  return `<div class="${cls}"${frameStyle} ${opts.attrs ?? ''}>
      ${sell}${corner}
      <div class="pc-top">
        <span class="pc-ovr">${card.overall}</span>
        <span class="pc-pos">${esc(card.pos)}</span>
      </div>
      <span class="pc-badge" style="background:${badgeBg};color:${readableInk(shirt)}">${esc(short)}</span>
      <div class="pc-name">${esc(card.name)}</div>
      <div class="pc-nation">${esc(card.nation)}</div>
      <div class="pc-attrs">
        <div class="pc-attr"><span class="pc-attr-lbl">PAC</span><span class="pc-attr-val">${a.pace}</span></div>
        <div class="pc-attr"><span class="pc-attr-lbl">SHO</span><span class="pc-attr-val">${a.shoot}</span></div>
        <div class="pc-attr"><span class="pc-attr-lbl">PAS</span><span class="pc-attr-val">${a.pass}</span></div>
        <div class="pc-attr"><span class="pc-attr-lbl">${card.pos === 'GK' ? 'DIV' : 'DEF'}</span><span class="pc-attr-val">${card.pos === 'GK' ? a.keeping : a.tackle}</span></div>
      </div>
    </div>`;
}

/** An empty squad slot placeholder (optionally tagged with the slot position). */
export function emptyCardHtml(attrs = ''): string {
  return `<div class="player-card empty" ${attrs}></div>`;
}

/** The gold coins balance pill used in hubs. */
export function coinsChipHtml(coins: number): string {
  return `<span class="coins-chip"><span class="coin"></span><span class="money">${coins.toLocaleString()}</span></span>`;
}

/** Arcade tokens are used for Challenge Chronicle entries. */
export function tokensChipHtml(tokens: number): string {
  return `<span class="coins-chip token-chip"><span class="coin token"></span><span class="money">${tokens.toLocaleString()}</span><span class="token-label">TOKENS</span></span>`;
}

// --- Shared card filter / sort controls (trade portal + squad picker) --------

export type RarityFilter = 'all' | Rarity;
export type CardSortKey = 'rating' | 'value' | 'name';

export const RARITY_FILTER_OPTS: { v: RarityFilter; label: string }[] = [
  { v: 'all', label: 'All' }, { v: 'bronze', label: 'Brz' }, { v: 'silver', label: 'Slv' },
  { v: 'gold', label: 'Gld' }, { v: 'special', label: 'Spc' },
];
export const CARD_SORT_OPTS: { v: CardSortKey; label: string }[] = [
  { v: 'rating', label: 'Rating' }, { v: 'value', label: 'Value' }, { v: 'name', label: 'Name' },
];

/** A wrapping segmented-button group; each button carries `data-<group>="<v>"`. */
export function segHtml(group: string, opts: { v: string; label: string }[], active: string): string {
  return `<div class="seg wrap">${opts
    .map((o) => `<button data-${group}="${esc(o.v)}" class="${o.v === active ? 'on' : ''}">${esc(o.label)}</button>`)
    .join('')}</div>`;
}

/** Sort a card list by the shared sort key (rating | quick-sell value | name). */
export function sortCards(cards: PlayerCard[], sort: CardSortKey, valueOf: (c: PlayerCard) => number): PlayerCard[] {
  return cards.slice().sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'value') return valueOf(b) - valueOf(a);
    return b.overall - a.overall;
  });
}
