// PLAY screen for International Cup Stars — Squad Battles, Challenge ladder,
// and a gateway tile into Cup Stars. Mirrors the broadcast-style hub look used
// across the other stars screens (storeScreen, tradeScreen, …).
import type { UI } from '../screens';
import { bind } from '../screens';
import type { StarsState } from '../../game/stars/types';
import {
  matchReward,
  CHALLENGE_TIERS,
  packById,
  type ChallengeTier,
} from '../../game/stars/economy';
import {
  battleOpponents,
  challengeOpponent,
  type Opponent,
} from '../../game/stars/opponents';
import { squadRating } from '../../game/stars/squad';
import { addCoins } from '../../game/stars/store';
import { addArcadeTokens } from '../../game/stars/arcadeTokens';
import { resetIfNewWeek, weekKeyFor, isCupWeekendOpen } from '../../game/stars/weekly';
import { markCupQualified } from '../../game/stars/cupStars';
import { applyWeeklyRivalsResult } from '../../game/stars/ownerMode';
import { render, esc, coinsChipHtml, tokensChipHtml, STARS_BG } from './components';

type Outcome = { score: [number, number]; winner: -1 | 0 | 1 };
type PlayFn = (opponent: Opponent, onResult: (outcome: Outcome) => void) => void;

export interface PlayOpts {
  state: StarsState;
  commit: () => void;
  onBack: () => void;
  play: PlayFn;
  onCupStars: () => void;
  /** other players' real published squads to face in Squad Battles (online) */
  realOpponents?: Opponent[];
  onLeaderboard?: () => void;
  /** push weekly challenge/cup points to the shared leaderboard (best-effort) */
  submitScore?: (board: 'rivals' | 'challenge' | 'cup', points: number, weekKey: string) => void;
}

/** Battle/challenge points awarded by match result. */
function pointsFor(result: 'win' | 'draw' | 'loss'): number {
  return result === 'win' ? 100 : result === 'draw' ? 40 : 12;
}

/** Map a sim outcome (user is always the HOME side, team 0) into our terms. */
function readOutcome(o: Outcome): {
  result: 'win' | 'draw' | 'loss';
  gf: number;
  ga: number;
} {
  const result = o.winner === 0 ? 'win' : o.winner === 1 ? 'loss' : 'draw';
  return { result, gf: o.score[0], ga: o.score[1] };
}

/** The reward for fully reaching a challenge/cup tier (coins, or pack value). */
function tierAmount(tier: ChallengeTier): number {
  if (tier.coins !== undefined) return tier.coins;
  if (tier.packId) return packById(tier.packId)?.price ?? 0;
  return 0;
}

export function playScreen(ui: UI, opts: PlayOpts): void {
  const { state } = opts;

  // Idempotent weekly rollover before reading any weekly counters.
  resetIfNewWeek(state, Date.now());
  opts.commit();
  const weekKey = weekKeyFor(Date.now());

  const rating = squadRating(state);
  const incomplete = state.squad.starters.some((s) => !s);

  if (incomplete) {
    render(
      ui,
      `
    <h1 class="h-screen" style="margin:4px 0 10px">ONLINE RIVALS</h1>
      <div class="row spread" style="margin-bottom:14px">
        ${coinsChipHtml(state.coins)}
        ${tokensChipHtml(state.arcadeTokens.balance)}
        <span class="squad-rating">${rating}</span>
      </div>
      <div class="panel" style="max-width:520px;text-align:center">
        <p class="subtle" style="margin:0 0 4px">Build a full XI in SQUAD before playing.</p>
      </div>
      <div class="menu-col" style="margin-top:16px">
        <button class="btn small" id="pl-back">&#9664; BACK</button>
      </div>`,
      STARS_BG,
    );
    bind('pl-back', opts.onBack);
    return;
  }

  // --- ONLINE RIVALS ------------------------------------------------------
  // Prefer other players' real published squads (online), fill with generated.
  const battles = [...(opts.realOpponents ?? []), ...battleOpponents(state, weekKey)].slice(0, 5);
  const battleTiles = battles
    .map((opp, i) => {
      const online = opp.id.startsWith('real-');
      return `
        <div class="hub-tile" data-battle="${i}" role="button" tabindex="0">
          <div class="hub-tile-label">${esc(opp.label)}${online ? ' <span class="tag" style="background:rgba(54,194,79,.22);color:var(--grass)">ONLINE</span>' : ''}</div>
          <div class="row" style="gap:8px;margin-top:2px">
            <span class="tag">OVR ${opp.overall}</span>
            <span class="tag">${'★'.repeat(opp.stars)}</span>
          </div>
        </div>`;
    })
    .join('');

  // --- CHALLENGE LADDER ----------------------------------------------------
  const claimed = state.challenge.rewardsClaimed;
  const tiersHtml = CHALLENGE_TIERS.map((tier, i) => {
    const isClaimed = claimed.includes(i);
    const reached = state.challenge.points >= tier.points;
    const mark = isClaimed ? '✓' : reached ? '●' : '○';
    const cls = isClaimed ? 'you' : '';
    const rewardLabel = tier.coins !== undefined
      ? `${tier.coins.toLocaleString()} coins`
      : `${esc(packById(tier.packId ?? '')?.name ?? 'Pack')}`;
    const tokens = tier.tokens ? ` · +${tier.tokens} token${tier.tokens === 1 ? '' : 's'}` : '';
    const cup = tier.qualifiesCup ? ' · Cup spot' : '';
    return `
      <tr class="${cls}">
        <td>${mark}</td>
        <td>Tier ${i + 1}</td>
        <td class="num">${tier.points.toLocaleString()}</td>
        <td>${rewardLabel}${tokens}${cup}</td>
      </tr>`;
  }).join('');

  const cupReady = state.cup.qualified;

  // --- CUP STARS STATUS ----------------------------------------------------
  const cupOpen = isCupWeekendOpen(Date.now());
  const cupStatus = cupOpen && cupReady
    ? 'OPEN — qualified'
    : cupReady
      ? 'Opens Sat/Sun'
      : 'Qualify via Challenge';

  render(
    ui,
    `
    <h1 class="h-screen" style="margin:4px 0 10px">ONLINE RIVALS</h1>
    <div class="row spread" style="margin-bottom:14px">
      ${coinsChipHtml(state.coins)}
      ${tokensChipHtml(state.arcadeTokens.balance)}
      <span class="squad-rating">${rating}</span>
    </div>

    <div style="width:min(1060px,94vw);display:flex;flex-direction:column;gap:16px">
      <section>
        <div class="row spread" style="margin-bottom:8px">
          <h2 class="h-screen" style="font-size:18px;margin:0">ONLINE RIVALS</h2>
          <span class="subtle">${state.rivals.points.toLocaleString()} pts · ${state.rivals.played} played</span>
        </div>
        <div class="hub-tiles">
          ${battleTiles}
        </div>
      </section>

      <section class="panel" style="max-width:none;width:auto">
        <div class="row spread" style="margin-bottom:8px">
          <h2 class="h-screen" style="font-size:18px;margin:0">CHALLENGE</h2>
          <span class="subtle">${state.challenge.points.toLocaleString()} pts · ${state.challenge.played} played${cupReady ? ' · Cup qualified' : ''}</span>
        </div>
        <table class="tbl">
          <thead>
            <tr><th></th><th>Tier</th><th class="num">Points</th><th>Reward</th></tr>
          </thead>
          <tbody>${tiersHtml}</tbody>
        </table>
        <div class="menu-col" style="margin-top:12px">
          <button class="btn primary small" id="pl-challenge">PLAY CHALLENGE MATCH</button>
        </div>
      </section>

      <section>
        <div class="hub-tiles">
          <div class="hub-tile" id="pl-cup" role="button" tabindex="0" style="flex:1 1 100%">
            <div class="hub-tile-icon">\u{1F3C6}</div>
            <div class="hub-tile-label">CUP STARS</div>
            <div class="hub-tile-sub">${cupStatus}</div>
          </div>
        </div>
      </section>
    </div>

    <div class="menu-col" style="margin-top:16px">
      ${opts.onLeaderboard ? `<button class="btn small" id="pl-leaderboard">\u{1F3C5} LEADERBOARD</button>` : ''}
      <button class="btn small" id="pl-back">&#9664; BACK</button>
    </div>`,
    STARS_BG,
  );

  // --- Battle taps ---------------------------------------------------------
  ui.root.querySelectorAll<HTMLElement>('[data-battle]').forEach((el) => {
    el.addEventListener('click', () => {
      const idx = Number(el.getAttribute('data-battle'));
      const opp = battles[idx];
      if (!opp) return;
      opts.play(opp, (outcome) => {
        const { result, gf, ga } = readOutcome(outcome);
        const coins = matchReward(result, gf, ga);
        addCoins(state, coins);
        const rivalsSummary = applyWeeklyRivalsResult(state, outcome, Date.now());
        opts.commit();
        opts.submitScore?.('rivals', state.rivals.points, weekKey);
        showReward(ui, {
          title: result === 'win' ? 'WIN!' : result === 'loss' ? 'DEFEAT' : 'DRAW',
          coins,
          lines: rivalsSummary.lines,
          onDone: () => playScreen(ui, opts),
        });
      });
    });
  });

  // --- Challenge match -----------------------------------------------------
  bind('pl-challenge', () => {
    const opp = challengeOpponent(state, state.challenge.played);
    opts.play(opp, (outcome) => {
      const { result, gf, ga } = readOutcome(outcome);
      state.challenge.weekKey = weekKey;
      state.challenge.points += pointsFor(result);
      state.challenge.played += 1;
      const coins = matchReward(result, gf, ga);
      addCoins(state, coins);

      // Claim every newly-reached, unclaimed tier.
      const lines: string[] = ['Challenge points +' + pointsFor(result)];
      let tokens = 0;
      for (let t = 0; t < CHALLENGE_TIERS.length; t++) {
        const tier = CHALLENGE_TIERS[t];
        if (state.challenge.rewardsClaimed.includes(t)) continue;
        if (state.challenge.points < tier.points) continue;
        const amount = tierAmount(tier);
        if (amount > 0) addCoins(state, amount);
        if (tier.tokens) {
          addArcadeTokens(state.arcadeTokens, tier.tokens);
          tokens += tier.tokens;
          lines.push('Tier ' + (t + 1) + ': +' + tier.tokens + ' Challenge token' + (tier.tokens === 1 ? '' : 's'));
        }
        if (tier.qualifiesCup) {
          markCupQualified(state);
          lines.push('Tier ' + (t + 1) + ': qualified for Cup Stars!');
        }
        if (amount > 0) {
          lines.push('Tier ' + (t + 1) + ': +' + amount.toLocaleString() + ' coins');
        }
        state.challenge.rewardsClaimed.push(t);
      }

      opts.commit();
      opts.submitScore?.('challenge', state.challenge.points, weekKey);
      showReward(ui, {
        title: result === 'win' ? 'WIN!' : result === 'loss' ? 'DEFEAT' : 'DRAW',
        coins,
        tokens,
        lines,
        onDone: () => playScreen(ui, opts),
      });
    });
  });

  bind('pl-cup', opts.onCupStars);
  if (opts.onLeaderboard) bind('pl-leaderboard', opts.onLeaderboard);
  bind('pl-back', opts.onBack);
}

// ---------------------------------------------------------------------------
// showReward — shared post-match reward panel used by both screens.
// ---------------------------------------------------------------------------

export function showReward(
  ui: UI,
  o: { title: string; coins: number; tokens?: number; lines?: string[]; onDone: () => void },
): void {
  const linesHtml = (o.lines ?? [])
    .map((l) => `<div class="subtle">${esc(l)}</div>`)
    .join('');

  render(
    ui,
    `
    <div class="reward-summary">
      <div class="reward-title">${esc(o.title)}</div>
      <div class="reward-big">+${o.coins.toLocaleString()}</div>
      <div class="reward-label">Coins earned</div>
      ${o.tokens ? `<div class="reward-token-bonus">+${o.tokens.toLocaleString()} TOKEN${o.tokens === 1 ? '' : 'S'}</div>` : ''}
      ${linesHtml ? `<div style="display:flex;flex-direction:column;gap:4px;margin-top:8px">${linesHtml}</div>` : ''}
      <button class="btn primary" id="rw-done" style="margin-top:16px">CONTINUE <span class="arrow">▶</span></button>
    </div>`,
    STARS_BG,
  );
  bind('rw-done', o.onDone);
}
