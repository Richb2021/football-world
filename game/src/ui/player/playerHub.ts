/**
 * Football World — PLAYER CAREER UI. A New-Star-Soccer-style dashboard for your
 * single footballer, plus stats / training / headlines / season-review screens.
 */
import type { UI } from '../screens';
import { bind } from '../screens';
import { esc } from '../stars/components';
import type { PlayerCareerState, PlayerTrainingFocus } from '../../game/playercareer/types';
import { avatarOf } from '../../game/playercareer/engine';
import { overallRating } from '../../sim/formations';
import { anyTeamById } from '../../data/teams';
import { playerValue } from '../../game/transfers';

function uiScreen(ui: UI, inner: string, bg?: string): void {
  (ui as unknown as { screen: (inner: string, bg?: string) => HTMLElement }).screen(inner, bg ?? ui.bgUrl);
}

export interface PlayerHubNav {
  onPlay: () => void;
  onQuickSim: () => void;
  onStats: () => void;
  onTraining: () => void;
  onHeadlines: () => void;
  onExit: () => void;
}

export function playerHub(ui: UI, pcs: PlayerCareerState, nav: PlayerHubNav): void {
  if (pcs.phase === 'retired') { nav.onExit(); return; }
  if (pcs.phase === 'season-end') { nav.onStats(); return; } // season review handled by app
  const av = avatarOf(pcs);
  const club = anyTeamById(pcs.world.userClubId)?.name ?? pcs.world.userClubId;
  const fx = pcs.world.pendingUserFixture;
  const opp = fx ? anyTeamById(fx.homeClubId === pcs.world.userClubId ? fx.awayClubId : fx.homeClubId)?.name : null;
  const where = fx ? (fx.homeClubId === pcs.world.userClubId ? 'HOME' : 'AWAY') : null;
  const ovr = av ? Math.round(overallRating(av)) : 0;
  const nextLabel = fx ? `${club.toUpperCase()} vs ${opp?.toUpperCase()} (${where}) · MD ${pcs.world.matchday + 1}` : 'NO FIXTURE';

  uiScreen(ui, `
    <h1 class="h-screen">${esc(pcs.playerName.toUpperCase())} <span class="accent">· ${pcs.pos}</span></h1>
    <div class="row spread" style="margin-bottom:10px">
      <span class="tag">${esc(club.toUpperCase())}</span>
      <span class="tag">OVR ${ovr}</span>
      <span class="tag">AGE ${av?.age ?? '–'}</span>
      <span class="tag">REP ${Math.round(pcs.reputation)}</span>
    </div>
    <div class="panel career-summary-panel" style="text-align:center">
      <div class="subtle">UP NEXT</div>
      <div style="font-size:22px;font-weight:800;margin:8px 0">${esc(nextLabel)}</div>
      <div class="row" style="justify-content:center;gap:8px;flex-wrap:wrap">
        <span class="tag">SEASON ${pcs.apps} apps · ${pcs.goals}G · ${pcs.assists}A</span>
        <span class="tag">RATING ${pcs.avgRating ? pcs.avgRating.toFixed(1) : '–'}</span>
        ${pcs.internationalCaps ? `<span class="tag">${pcs.internationalCaps} CAPS · ${pcs.internationalGoals}G</span>` : ''}
      </div>
      <div class="row" style="justify-content:center;gap:8px;margin-top:6px">
        <span class="tag">TRAINING ${pcs.trainingFocus.toUpperCase()}</span>
        <span class="tag">XP ${pcs.trainingXp}</span>
      </div>
    </div>
    <div class="menu-col" style="margin-top:12px">
      ${fx ? '<button class="btn primary" id="p-play">PLAY AS YOURSELF ▶</button>' : ''}
      ${fx ? '<button class="btn small" id="p-sim">QUICK-SIM MATCH</button>' : ''}
      <button class="btn small" id="p-stats">PROFILE & STATS</button>
      <button class="btn small" id="p-train">TRAINING</button>
      <button class="btn small" id="p-news">HEADLINES</button>
      <button class="btn small" id="p-exit">SAVE & EXIT</button>
    </div>`);
  if (fx) bind('p-play', nav.onPlay);
  if (fx) bind('p-sim', nav.onQuickSim);
  bind('p-stats', nav.onStats);
  bind('p-train', nav.onTraining);
  bind('p-news', nav.onHeadlines);
  bind('p-exit', nav.onExit);
}

export function playerStats(ui: UI, pcs: PlayerCareerState, onBack: () => void): void {
  const av = avatarOf(pcs);
  const a = av ?? { pace: 0, pass: 0, shoot: 0, tackle: 0, keeping: 0 } as never;
  const attrRow = (label: string, v: number) => `<div class="row spread"><span>${label}</span><span class="tag">${v}</span></div>`;
  const recent = pcs.history.slice(-8).reverse().map((h) => `<tr>
      <td class="num">${h.season}.${h.matchday}</td><td style="text-align:left">${esc(h.opponent)}</td>
      <td class="num">${h.result === 'win' ? 'W' : h.result === 'loss' ? 'L' : 'D'}</td>
      <td class="num">${h.goals}</td><td class="num">${h.assists}</td><td class="num">${h.rating.toFixed(1)}</td>
    </tr>`).join('');
  uiScreen(ui, `
    <h1 class="h-screen">${esc(pcs.playerName.toUpperCase())} <span class="accent">· ${pcs.pos}</span></h1>
    <div class="panel">
      <div class="row spread"><span class="subtle">OVERALL</span><b>${av ? Math.round(overallRating(av)) : '–'}</b></div>
      <div class="row spread"><span class="subtle">POTENTIAL</span><b>${av?.potential ?? '–'}</b></div>
      <div class="row spread"><span class="subtle">AGE · VALUE</span><b>${av?.age ?? '–'} · ${av ? '£' + (playerValue(av) / 1000).toFixed(2) + 'M' : '–'}</b></div>
      <hr style="border:0;border-top:1px solid rgba(255,255,255,0.1);margin:10px 0" />
      ${attrRow('PACE', a.pace)}${attrRow('PASS', a.pass)}${attrRow('SHOOT', a.shoot)}${attrRow('TACKLE', a.tackle)}${attrRow('KEEPING', a.keeping)}
    </div>
    <div class="panel">
      <div class="row spread"><span class="subtle">CAREER</span><b>${pcs.careerApps} apps · ${pcs.careerGoals}G · ${pcs.careerAssists}A</b></div>
      <div class="row spread"><span class="subtle">REPUTATION · CAPS</span><b>${Math.round(pcs.reputation)} · ${pcs.internationalCaps}</b></div>
    </div>
    <div class="panel">
      <table class="tbl"><tr><th>DATE</th><th style="text-align:left">VS</th><th>R</th><th>G</th><th>A</th><th>RAT</th></tr>${recent || '<tr><td colspan="6" class="subtle">No matches yet.</td></tr>'}</table>
    </div>
    <div class="menu-col" style="margin-top:10px"><button class="btn small" id="back">◀ BACK</button></div>`);
  bind('back', onBack);
}

const FOCUSES: { v: PlayerTrainingFocus; label: string }[] = [
  { v: 'balanced', label: 'BALANCED' },
  { v: 'pace', label: 'PACE' },
  { v: 'passing', label: 'PASSING' },
  { v: 'shooting', label: 'SHOOTING' },
  { v: 'tackling', label: 'TACKLING' },
  { v: 'physical', label: 'PHYSICAL' },
];

export function playerTraining(ui: UI, pcs: PlayerCareerState, onFocus: (f: PlayerTrainingFocus) => void, onBack: () => void): void {
  const av = avatarOf(pcs);
  uiScreen(ui, `
    <h1 class="h-screen">TRAINING <span class="accent">· XP ${pcs.trainingXp}</span></h1>
    <div class="row" style="margin-bottom:10px">
      <div class="seg wrap" id="focus">
        ${FOCUSES.map((f) => `<button data-f="${f.v}" class="${pcs.trainingFocus === f.v ? 'on' : ''}">${f.label}</button>`).join('')}
      </div>
    </div>
    <div class="panel">
      <div class="row spread"><span class="subtle">CURRENT OVERALL</span><b>${av ? Math.round(overallRating(av)) : '–'}</b></div>
      <div class="row spread"><span class="subtle">POTENTIAL CEILING</span><b>${av?.potential ?? '–'}</b></div>
    </div>
    <div class="notice">Earn XP from appearances (more for strong ratings), then spend it at season's end growing toward your potential.</div>
    <div class="menu-col" style="margin-top:10px"><button class="btn small" id="back">◀ BACK</button></div>`);
  document.getElementById('focus')?.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => onFocus((b as HTMLElement).dataset.f as PlayerTrainingFocus));
  });
  bind('back', onBack);
}

export function playerHeadlines(ui: UI, pcs: PlayerCareerState, onBack: () => void): void {
  const items = pcs.headlines.slice(-20).reverse();
  const rows = items.map((h) => `<div class="headline-card ${h.tone}">
      <div class="headline-source">${esc(h.source)}</div>
      <div class="headline-title">${esc(h.title)}</div>
    </div>`).join('');
  uiScreen(ui, `
    <h1 class="h-screen">YOUR <span class="accent">HEADLINES</span></h1>
    <div class="headline-feed">${rows || '<div class="panel">No headlines yet — make a name for yourself.</div>'}</div>
    <div class="menu-col" style="margin-top:10px"><button class="btn small" id="back">◀ BACK</button></div>`);
  bind('back', onBack);
}

export function playerSeasonReview(
  ui: UI,
  pcs: PlayerCareerState,
  onAcceptOffer: () => void,
  onDeclineOffer: () => void,
  onContinue: () => void,
): void {
  const offerHtml = pcs.transferOffer
    ? `<div class="panel" style="text-align:center">
         <div class="subtle">TRANSFER OFFER</div>
         <div style="font-size:20px;font-weight:800;margin:8px 0">${esc(pcs.transferOffer.clubName)} want to sign you</div>
         <div class="row" style="justify-content:center;gap:8px;margin-top:8px">
           <button class="btn primary" id="sr-accept">SIGN ▶</button>
           <button class="btn small" id="sr-decline">STAY</button>
         </div>
       </div>`
    : '';
  uiScreen(ui, `
    <h1 class="h-screen">SEASON <span class="accent">REVIEW</span></h1>
    <div class="panel" style="font-size:17px;line-height:1.8">${pcs.lastReview.map((l) => `<div>${l}</div>`).join('')}</div>
    ${offerHtml}
    <div class="menu-col" style="margin-top:12px"><button class="btn small" id="sr-cont">CONTINUE ▶</button></div>`);
  if (pcs.transferOffer) {
    bind('sr-accept', onAcceptOffer);
    bind('sr-decline', onDeclineOffer);
  }
  bind('sr-cont', onContinue);
}

export function playerRetired(ui: UI, pcs: PlayerCareerState, onMenu: () => void): void {
  uiScreen(ui, `
    <h1 class="h-screen">A CAREER <span class="accent">COMPLETE</span></h1>
    <div class="panel" style="font-size:17px;line-height:1.9">${pcs.lastReview.map((l) => `<div>${l}</div>`).join('')}</div>
    <div class="menu-col" style="margin-top:12px"><button class="btn small" id="r-menu">◀ MAIN MENU</button></div>`);
  bind('r-menu', onMenu);
}
