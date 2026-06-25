// Seasons mode UI — single-player promotion/relegation ladder.
// Uses the same broadcast look as careerScreens / cupStarsScreen.
import type { UI } from './screens';
import { bind } from './screens';
import { stars } from './screens';
import { TEAMS } from '../data/teams';
import {
  type SeasonsState,
  GAMES_PER_SEASON,
  divisionName,
  opponentFor,
  recordResult,
  promotionThreshold,
  relegationThreshold,
} from '../game/seasons/ladder';
import { render, esc } from './stars/components';

export type { UI } from './screens';
export type { SeasonsState } from '../game/seasons/ladder';

const STADIUM_BG = import.meta.env.BASE_URL + 'assets/ui/team_select_bg.webp';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function kitSwatches(teamIdx: number): string {
  const t = TEAMS[teamIdx];
  if (!t) return '';
  return `
    <div style="display:flex;gap:4px;justify-content:center;margin:6px 0">
      <div style="width:22px;height:28px;background:${esc(t.colors.home.shirt)};border-radius:4px 4px 7px 7px;border:1px solid rgba(255,255,255,.2)"></div>
      <div style="width:22px;height:28px;background:${esc(t.colors.home.shorts)};border-radius:4px 4px 7px 7px;border:1px solid rgba(255,255,255,.2)"></div>
      <div style="width:22px;height:28px;background:${esc(t.colors.home.socks)};border-radius:4px 4px 7px 7px;border:1px solid rgba(255,255,255,.2)"></div>
    </div>`;
}

function outcomeBanner(lastOutcome: SeasonsState['lastOutcome'], division: number): string {
  if (!lastOutcome) return '';
  const label =
    lastOutcome === 'champion'  ? 'CHAMPIONS!' :
    lastOutcome === 'promoted'  ? 'PROMOTED!' :
    lastOutcome === 'relegated' ? 'RELEGATED' :
                                  'SEASON COMPLETE';
  const color =
    lastOutcome === 'champion'  ? '#f5c518' :
    lastOutcome === 'promoted'  ? '#36c24f' :
    lastOutcome === 'relegated' ? '#e04040' :
                                  '#aaa';
  return `
    <div class="panel" style="max-width:560px;text-align:center;border:2px solid ${color};margin-bottom:12px">
      <div style="font-size:clamp(22px,5vw,36px);font-weight:900;color:${color};letter-spacing:.05em">${label}</div>
      <div class="subtle" style="margin-top:4px">${esc(divisionName(division))}</div>
    </div>`;
}

function thresholdPanel(points: number): string {
  const promo = promotionThreshold();
  const rel   = relegationThreshold();
  const pct   = (n: number) => Math.min(100, Math.round((n / promo) * 100));

  const barStyle = (pts: number): string => {
    const color =
      pts >= promo ? '#36c24f' :
      pts <= rel   ? '#e04040' : '#f5c518';
    return `background:${color};width:${pct(pts)}%;height:100%;border-radius:4px;transition:width .3s`;
  };

  return `
    <div class="panel" style="max-width:480px;padding:10px 14px">
      <div class="row spread" style="margin-bottom:6px">
        <span class="tag" style="background:rgba(54,194,79,.2);color:#36c24f">PROMO ≥${promo} PTS</span>
        <span class="tag" style="background:rgba(224,64,64,.2);color:#e04040">REL ≤${rel} PTS</span>
      </div>
      <div style="background:rgba(255,255,255,.1);border-radius:4px;height:8px;overflow:hidden">
        <div style="${barStyle(points)}"></div>
      </div>
      <div class="subtle" style="margin-top:4px;text-align:center">Current: <strong>${points}</strong> pts</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export interface SeasonsScreenOpts {
  state: SeasonsState | null;
  onPickTeam: (teamIdx: number) => void;
  commit: () => void;
  onBack: () => void;
  play: (
    oppTeamIdx: number,
    onResult: (outcome: { score: [number, number]; winner: -1 | 0 | 1 }) => void,
  ) => void;
}

export function seasonsScreen(ui: UI, opts: SeasonsScreenOpts): void {
  // -------------------------------------------------------------------------
  // Team picker (no existing save)
  // -------------------------------------------------------------------------
  if (opts.state === null) {
    const cards = TEAMS.map((t, i) => `
      <button class="team-card" data-team="${i}" style="text-align:center">
        ${kitSwatches(i)}
        <div class="tname">${esc(t.name)}</div>
        <div class="stars" style="margin:2px 0">${stars(t.strength)}</div>
      </button>`).join('');

    render(
      ui,
      `
      <h1 class="h-screen">SEASONS &mdash; PICK YOUR <span class="accent">CLUB</span></h1>
      <div class="team-grid">${cards}</div>
      <div class="menu-col" style="margin-top:14px;width:min(300px,80vw)">
        <button class="btn small" id="sn-back">&#9664; BACK</button>
      </div>`,
      STADIUM_BG,
    );

    ui.root.querySelectorAll<HTMLElement>('[data-team]').forEach((el) => {
      el.addEventListener('click', () => opts.onPickTeam(parseInt(el.dataset.team!, 10)));
    });
    bind('sn-back', opts.onBack);
    return;
  }

  // -------------------------------------------------------------------------
  // Season dashboard
  // -------------------------------------------------------------------------
  const state = opts.state;

  // Show lastOutcome banner only at the start of a fresh season (step === 0),
  // then clear it so it appears only once.
  const banner = outcomeBanner(
    state.step === 0 ? state.lastOutcome : undefined,
    state.division,
  );
  if (state.step === 0 && state.lastOutcome !== undefined) {
    state.lastOutcome = undefined;
    opts.commit();
  }

  const myTeam = TEAMS[state.teamIdx];
  const nextOppIdx = opponentFor(state, state.step);
  const nextOpp = TEAMS[nextOppIdx];
  const canPlay = state.step < GAMES_PER_SEASON;

  const wdl = `${state.wins}W ${state.draws}D ${state.losses}L`;

  render(
    ui,
    `
    <h1 class="h-screen" style="margin:4px 0 2px">
      ${esc(divisionName(state.division))} &middot; <span class="accent">${esc(myTeam?.name ?? '?')}</span>
    </h1>

    <div class="row spread" style="flex-wrap:wrap;gap:6px;margin-bottom:12px">
      <span class="tag">SEASON ${state.seasonNo}</span>
      <span class="tag">P ${state.step}/${GAMES_PER_SEASON}</span>
      <span class="tag">PTS ${state.points}</span>
      <span class="tag">${wdl}</span>
      <span class="tag" style="background:rgba(245,197,24,.15);color:#f5c518">TITLES ${state.titles}</span>
    </div>

    ${banner}
    ${thresholdPanel(state.points)}

    <div class="panel" style="max-width:480px;margin-top:10px">
      ${canPlay ? `
        <div class="subtle" style="margin-bottom:6px">NEXT MATCH &mdash; HOME vs <strong>${esc(nextOpp?.name ?? '?')}</strong></div>
        <button class="btn primary" id="sn-play">PLAY VS ${esc(nextOpp?.short ?? nextOpp?.name ?? '?')} <span class="arrow">&#9654;</span></button>
      ` : `
        <div class="subtle" style="text-align:center">Season complete — no more fixtures.</div>
      `}
    </div>

    <div class="menu-col" style="margin-top:14px;width:min(300px,80vw)">
      <button class="btn small" id="sn-back">&#9664; BACK</button>
    </div>`,
    STADIUM_BG,
  );

  if (canPlay) {
    bind('sn-play', () => {
      opts.play(nextOppIdx, (outcome) => {
        recordResult(state, outcome);
        opts.commit();
        seasonsScreen(ui, opts);
      });
    });
  }

  bind('sn-back', opts.onBack);
}
