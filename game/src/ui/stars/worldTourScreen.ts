import type { UI } from '../screens';
import { bind } from '../screens';
import type { StarsState } from '../../game/stars/types';
import { WORLD_TOUR_STAGES, currentWorldTourStage, type WorldTourHandicap } from '../../game/stars/worldTour';
import { ensureOwnerModeState } from '../../game/stars/ownerMode';
import { render, esc, coinsChipHtml, tokensChipHtml, STARS_BG } from './components';

export interface WorldTourScreenOpts {
  state: StarsState;
  weekKey: string;
  onPlayStage: (stageIndex: number) => void;
  onBack: () => void;
}

export function handicapLabel(handicap: WorldTourHandicap): string {
  if (handicap === 'no-chemistry') return 'No chemistry boost';
  if (handicap === 'negative-momentum') return 'Start under pressure';
  if (handicap === 'hostile-press') return 'Hostile press week';
  if (handicap === 'tired-legs') return 'Tired legs';
  return 'Must win by two';
}

export function worldTourScreen(ui: UI, opts: WorldTourScreenOpts): void {
  const { state } = opts;
  ensureOwnerModeState(state);
  const current = currentWorldTourStage(state);
  const currentIndex = current?.index ?? state.worldTour.currentMatch;
  const locked = state.worldTour.completed;
  const rows = WORLD_TOUR_STAGES.map((stage) => {
    const cleared = state.worldTour.stageRewardsClaimed.includes(stage.index);
    const currentStage = stage.index === currentIndex && !locked;
    const status = cleared ? 'CLEARED' : currentStage ? 'CURRENT' : 'LOCKED';
    return `
      <div class="world-tour-stage world-tour-stage--${status.toLowerCase()}">
        <span class="world-tour-node">${stage.index + 1}</span>
        <div>
          <strong>${esc(stage.title)}</strong>
          <span>${esc(handicapLabel(stage.handicap))}</span>
        </div>
        <em>${status}</em>
      </div>`;
  }).join('');

  render(
    ui,
    `
    <div class="world-tour-shell">
      <div class="row spread world-tour-top">
        <div>
          <div class="tag">WEEK ${esc(opts.weekKey)}</div>
          <h1 class="h-screen world-tour-title">WORLD TOUR</h1>
        </div>
        <div class="owner-balance-row">
          ${coinsChipHtml(state.coins)}
          ${tokensChipHtml(state.arcadeTokens.balance)}
        </div>
      </div>
      <div class="world-tour-card">
        <div class="world-tour-ladder">${rows}</div>
        <div class="world-tour-summary">
          <span>${locked ? 'LOCKED UNTIL WEEKLY RESET' : 'CURRENT STAGE'}</span>
          <strong>${locked ? 'Tour complete' : esc(current?.title ?? 'Ready')}</strong>
          <em>${locked ? 'Come back next week for a new five-match route.' : esc(current ? handicapLabel(current.handicap) : 'Weekly route ready')}</em>
          <button class="btn primary" id="wt-play"${locked || !current ? ' disabled' : ''}>PLAY CURRENT STAGE <span class="arrow">▶</span></button>
          <button class="btn small" id="wt-back">BACK</button>
        </div>
      </div>
    </div>`,
    STARS_BG,
  );

  if (current && !locked) bind('wt-play', () => opts.onPlayStage(current.index));
  bind('wt-back', opts.onBack);
}
