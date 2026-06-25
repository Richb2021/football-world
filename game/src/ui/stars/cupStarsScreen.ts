// CUP STARS screen — the weekend league. Qualified squads play up to 10 games
// across Sat/Sun; reward ladder pays out by wins. Matches the broadcast hub look.
import type { UI } from '../screens';
import { bind } from '../screens';
import type { StarsState } from '../../game/stars/types';
import { matchReward, CUP_TIERS, packById } from '../../game/stars/economy';
import { cupOpponent, type Opponent } from '../../game/stars/opponents';
import { addCoins } from '../../game/stars/store';
import { addArcadeTokens } from '../../game/stars/arcadeTokens';
import { resetIfNewWeek, isCupWeekendOpen, weekKeyFor } from '../../game/stars/weekly';
import {
  cupCanEnter,
  cupRecord,
  cupRewards,
} from '../../game/stars/cupStars';
import { render, esc, coinsChipHtml, tokensChipHtml, STARS_BG } from './components';
import { showReward } from './playScreen';

type Outcome = { score: [number, number]; winner: -1 | 0 | 1 };
type PlayFn = (opponent: Opponent, onResult: (outcome: Outcome) => void) => void;

export interface CupStarsOpts {
  state: StarsState;
  commit: () => void;
  onBack: () => void;
  play: PlayFn;
  /** push cup standing (wins) to the shared weekly leaderboard (best-effort) */
  submitScore?: (board: 'challenge' | 'cup', points: number, weekKey: string) => void;
}

const HEADER = `
  <h1 class="h-screen" style="margin:4px 0 2px">CUP STARS</h1>
  <div class="subtle" style="margin-bottom:12px">Weekend League · max 10 games</div>`;

function qualifiedBadge(): string {
  return `<span class="tag" style="background:rgba(54,194,79,0.2)">QUALIFIED</span>`;
}

export function cupStarsScreen(ui: UI, opts: CupStarsOpts): void {
  const { state } = opts;

  resetIfNewWeek(state, Date.now());
  opts.commit();

  const now = Date.now();

  // --- Not qualified -------------------------------------------------------
  if (!state.cup.qualified) {
    render(
      ui,
      `
      ${HEADER}
      <div class="panel" style="max-width:520px;text-align:center">
        <p class="subtle" style="margin:0">Reach the qualifying Challenge tier this week to enter.</p>
      </div>
      <div class="menu-col" style="margin-top:16px">
        <button class="btn small" id="cs-back">&#9664; BACK</button>
      </div>`,
      STARS_BG,
    );
    bind('cs-back', opts.onBack);
    return;
  }

  // --- Qualified but weekend not open --------------------------------------
  if (!isCupWeekendOpen(now)) {
    render(
      ui,
      `
      ${HEADER}
      <div class="panel" style="max-width:520px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:10px">
        ${qualifiedBadge()}
        <p class="subtle" style="margin:0">Cup Stars runs Saturday &amp; Sunday. Come back at the weekend.</p>
      </div>
      <div class="menu-col" style="margin-top:16px">
        <button class="btn small" id="cs-back">&#9664; BACK</button>
      </div>`,
      STARS_BG,
    );
    bind('cs-back', opts.onBack);
    return;
  }

  // --- Qualified + open: the live run --------------------------------------
  const { wins, losses, played } = state.cup;
  const left = Math.max(0, 10 - played);

  const ladderHtml = CUP_TIERS.map((tier) => {
    const reached = wins >= tier.wins;
    const reward = tier.coins !== undefined
      ? `${tier.coins.toLocaleString()} coins`
      : `${esc(packById(tier.packId ?? '')?.name ?? 'Pack')}`;
    const tokens = tier.tokens ? ` · +${tier.tokens} token${tier.tokens === 1 ? '' : 's'}` : '';
    return `
      <tr class="${reached ? 'you' : ''}">
        <td>${reached ? '✓' : '○'}</td>
        <td class="num">${tier.wins} W</td>
        <td>${reward}${tokens}</td>
      </tr>`;
  }).join('');

  const finished = state.cup.finished || played >= 10;

  // --- Finished run: pay out the ladder once -------------------------------
  if (finished) {
    if (!state.cup.rewardClaimed) {
      const r = cupRewards(wins);
      const packTotal = r.packIds.reduce(
        (sum, id) => sum + (packById(id)?.price ?? 0),
        0,
      );
      const total = r.coins + packTotal;
      addCoins(state, total);
      if (r.tokens > 0) addArcadeTokens(state.arcadeTokens, r.tokens);
      state.cup.rewardClaimed = true;
      opts.commit();

      const lines = [`${wins} wins · ${losses} losses`];
      if (r.coins > 0) lines.push('+' + r.coins.toLocaleString() + ' tier coins');
      if (packTotal > 0) {
        lines.push('+' + packTotal.toLocaleString() + ' in pack value (' + r.packIds.join(', ') + ')');
      }
      if (r.tokens > 0) lines.push('+' + r.tokens + ' Challenge token' + (r.tokens === 1 ? '' : 's'));
      showReward(ui, {
        title: 'CUP STARS COMPLETE',
        coins: total,
        tokens: r.tokens,
        lines,
        onDone: () => cupStarsScreen(ui, opts),
      });
      return;
    }

    render(
      ui,
      `
      ${HEADER}
      <div class="panel" style="max-width:560px;display:flex;flex-direction:column;gap:12px">
        <div class="row spread">
          <span>Final result</span>
          ${qualifiedBadge()}
        </div>
        <div class="row" style="gap:16px">
          <span class="tag">${wins} W</span>
          <span class="tag">${losses} L</span>
          <span class="tag">${played}/10 played</span>
        </div>
        <table class="tbl">
          <thead><tr><th></th><th class="num">Wins</th><th>Reward</th></tr></thead>
          <tbody>${ladderHtml}</tbody>
        </table>
        <p class="subtle" style="margin:0">Rewards claimed. New run unlocks next weekend.</p>
      </div>
      <div class="menu-col" style="margin-top:16px">
        <button class="btn small" id="cs-back">&#9664; DONE</button>
      </div>`,
      STARS_BG,
    );
    bind('cs-back', opts.onBack);
    return;
  }

  // --- Live run: show standings + next game --------------------------------
  const incomplete = state.squad.starters.some((id) => !id);
  const canEnter = cupCanEnter(state, now) && !incomplete;

  render(
    ui,
    `
    ${HEADER}
    <div class="row spread" style="margin-bottom:12px">
      ${coinsChipHtml(state.coins)}
      ${tokensChipHtml(state.arcadeTokens.balance)}
      ${qualifiedBadge()}
    </div>
    <div class="panel" style="max-width:560px;display:flex;flex-direction:column;gap:12px">
      <div class="row" style="gap:16px">
        <span class="tag">${wins} W</span>
        <span class="tag">${losses} L</span>
        <span class="tag">${played}/10 played</span>
        <span class="tag">${left} left</span>
      </div>
      <table class="tbl">
        <thead><tr><th></th><th class="num">Wins</th><th>Reward</th></tr></thead>
        <tbody>${ladderHtml}</tbody>
      </table>
      <div class="menu-col">
        <button class="btn primary" id="cs-play"${canEnter ? '' : ' disabled'}>PLAY GAME ${played + 1}/10</button>
        ${incomplete ? '<p class="subtle" style="margin:6px 0 0;text-align:center">Complete your XI in SQUAD before playing.</p>' : ''}
      </div>
    </div>
    <div class="menu-col" style="margin-top:16px">
      <button class="btn small" id="cs-back">&#9664; BACK</button>
    </div>`,
    STARS_BG,
  );

  if (canEnter) {
    bind('cs-play', () => {
      const opp = cupOpponent(state, state.cup.played);
      opts.play(opp, (outcome) => {
        const won = outcome.winner === 0;
        cupRecord(state, won);
        const result = won ? 'win' : outcome.winner === 1 ? 'loss' : 'draw';
        const coins = matchReward(result, outcome.score[0], outcome.score[1]);
        addCoins(state, coins);
        opts.commit();
        opts.submitScore?.('cup', state.cup.wins, weekKeyFor(Date.now()));
        // Re-rendering routes through the finished/claim path when played hits 10.
        showReward(ui, {
          title: won ? 'WIN' : result === 'loss' ? 'LOSS' : 'DRAW',
          coins,
          onDone: () => cupStarsScreen(ui, opts),
        });
      });
    });
  }

  bind('cs-back', opts.onBack);
}
