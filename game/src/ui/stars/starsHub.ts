import type { UI } from '../screens';
import { bind } from '../screens';
import type { StarsState } from '../../game/stars/types';
import { starsCardById } from '../../game/stars/store';
import { squadRating } from '../../game/stars/squad';
import { squadChemistry } from '../../game/stars/chemistry';
import { currentRivalsDivision, ensureOwnerModeState, ownerPressureLabel } from '../../game/stars/ownerMode';
import { currentWorldTourStage, WORLD_TOUR_STAGES } from '../../game/stars/worldTour';
import { render, esc, coinsChipHtml, tokensChipHtml, STARS_BG, STARS_CREST } from './components';

export function starsHub(
  ui: UI,
  opts: {
    state: StarsState;
    onSquad: () => void;
    onStore: () => void;
    onTrade: () => void;
    onOnlineRivals: () => void;
    onWorldTour: () => void;
    onPlayFriend: () => void;
    onLeaderboard?: () => void;
    onClub: () => void;
    onBack: () => void;
  },
): void {
  const { state } = opts;
  ensureOwnerModeState(state);
  const collectionSize = Object.keys(state.owned).length;
  const starters = state.squad.starters.map((id) => (id ? starsCardById(state, id) ?? null : null));
  const incomplete = starters.some((s) => !s);
  const rating = squadRating(state);
  const chem = squadChemistry(starters, state.squad.formation);
  const division = currentRivalsDivision(state.rivals);
  const pressure = ownerPressureLabel(state.owner);
  const form = state.owner.form.length ? state.owner.form.join(' ') : 'NEW WEEK';
  const stage = currentWorldTourStage(state);
  const stageText = stage
    ? `${stage.index + 1}/${WORLD_TOUR_STAGES.length} · ${stage.title}`
    : 'COMPLETE THIS WEEK';
  const headline = state.owner.headline ?? 'A new owner era begins.';

  render(
    ui,
    `
    <div class="owner-hq-shell">
      <div class="owner-hq-top">
        <div class="owner-brand">
          <img class="hub-crest" src="${esc(STARS_CREST)}" alt="Stars crest" />
          <div>
            <div class="tag">OWNER HQ</div>
            <h1 class="h-screen owner-hq-title">${esc(state.club.name)}</h1>
          </div>
        </div>
        <div class="owner-balance-row">
          ${coinsChipHtml(state.coins)}
          ${tokensChipHtml(state.arcadeTokens.balance)}
          <span class="tag">${collectionSize} PLAYERS</span>
          ${incomplete
            ? `<span class="tag owner-danger">SQUAD INCOMPLETE</span>`
            : `<span class="tag">SQUAD <strong>${rating}</strong></span>
               <span class="tag">CHEM <strong>${chem.total}%</strong></span>`}
        </div>
      </div>

      <div class="owner-hq-grid">
        <div class="owner-feature-stack">
          <button class="owner-feature owner-feature--primary" id="hs-rivals">
            <span class="owner-feature-kicker">ONLINE FIRST</span>
            <span class="owner-feature-title">ONLINE RIVALS</span>
            <span class="owner-feature-sub">Division ${division} · ${state.rivals.points.toLocaleString()} pts · ${state.rivals.wins}-${state.rivals.draws}-${state.rivals.losses}</span>
          </button>
          <button class="owner-feature" id="hs-world-tour">
            <span class="owner-feature-kicker">WEEKLY OFFLINE</span>
            <span class="owner-feature-title">WORLD TOUR</span>
            <span class="owner-feature-sub">${esc(stageText)}${state.worldTour.completed ? ' · locked until reset' : ''}</span>
          </button>
        </div>

        <div class="owner-side-stack">
          <div class="owner-mini-card">
            <span>PRESSURE</span>
            <strong>${pressure}</strong>
            <em>Board ${state.owner.boardMood} · Fans ${state.owner.fanMood}</em>
          </div>
          <div class="owner-mini-card owner-mini-card--headline">
            <span>HEADLINE</span>
            <strong>${esc(headline)}</strong>
          </div>
          <div class="owner-mini-card">
            <span>FORM</span>
            <strong>${esc(form)}</strong>
            <em>${state.rivals.played} rivals match${state.rivals.played === 1 ? '' : 'es'} this week</em>
          </div>
        </div>
      </div>

      <div class="owner-action-grid">
        <button class="btn small" id="hs-squad">SQUAD</button>
        <button class="btn small" id="hs-store">STORE</button>
        <button class="btn small" id="hs-trade">TRADE</button>
        <button class="btn small" id="hs-friend">PLAY A FRIEND</button>
        ${opts.onLeaderboard ? '<button class="btn small" id="hs-leaderboard">LEADERBOARD</button>' : ''}
        <button class="btn small" id="hs-club">MY CLUB</button>
        <button class="btn small" id="hs-back">BACK</button>
      </div>
    </div>`,
    STARS_BG,
  );

  bind('hs-squad', opts.onSquad);
  bind('hs-store', opts.onStore);
  bind('hs-trade', opts.onTrade);
  bind('hs-rivals', opts.onOnlineRivals);
  bind('hs-world-tour', opts.onWorldTour);
  bind('hs-friend', opts.onPlayFriend);
  if (opts.onLeaderboard) bind('hs-leaderboard', opts.onLeaderboard);
  bind('hs-club', opts.onClub);
  bind('hs-back', opts.onBack);
}
