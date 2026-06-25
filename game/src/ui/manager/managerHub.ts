/**
 * Football World — MANAGER MODE UI. Hub dashboard + sub-screens (standings, squad,
 * training, transfers, scouting, phone, press, headlines, board, season summary,
 * job offers). Mirrors careerScreens.ts conventions: each screen mounts via the
 * UI's private screen() (through render()) and wires buttons with bind().
 */
import type { UI } from '../screens';
import { bind } from '../screens';
import { render, esc } from '../stars/components';
import { showConfirm } from '../modal';
import type { ManagerState } from '../../game/manager/types';
import { moneyM } from '../../game/manager/types';
import { clubNameOf } from '../../game/manager/utils';
import { standingsForUserLeague, userLeagueId, currentTierOf } from '../../game/manager/engine';
import type { ManagerTransferListing, BidResult } from '../../game/manager/market';
import { freeAgentFee } from '../../game/manager/market';
import type { PressConference, PressQuestion, PressAnswer } from '../../meta/metaTypes';
import { evaluateTarget, type JobOffer } from '../../game/manager/targets';
import { overallRating } from '../../sim/formations';
import { playerValue } from '../../game/transfers';
import { anyTeamById } from '../../data/teams';
import { nationById } from '../../data/nations';

function uiScreen(ui: UI, inner: string, bg?: string): void {
  (ui as unknown as { screen: (inner: string, bg?: string) => HTMLElement }).screen(inner, bg ?? ui.bgUrl);
}

const formColour = (f: number) => (f >= 68 ? '#39d98a' : f >= 45 ? '#e0c14a' : '#e0644a');
const formArrow = (f: number) => (f >= 68 ? '▲' : f >= 45 ? '▬' : '▼');

export interface ManagerHubNav {
  onPlay: () => void;
  onQuickSim: () => void;
  onStandings: () => void;
  onCup: () => void;
  onSquad: () => void;
  onTraining: () => void;
  onTransfers: () => void;
  onScout: () => void;
  onPhone: () => void;
  onPress: () => void;
  onHeadlines: () => void;
  onBoard: () => void;
  onSeasonEnd: () => void;
  onSaveExit: () => void;
}

export function managerHub(ui: UI, state: ManagerState, nav: ManagerHubNav): void {
  const clubName = clubNameOf(state, state.userClubId);
  const fx = state.pendingUserFixture;
  const tierName = nationById(state.nationId)?.type === 'pyramid'
    ? (nationById(state.nationId)!.tiers?.find((t) => t.tier === currentTierOf(state, state.userClubId))?.name ?? `Tier ${currentTierOf(state, state.userClubId)}`)
    : nationById(state.nationId)?.name ?? 'League';
  const standings = standingsForUserLeague(state);
  const pos = standings.findIndex((r) => r.clubId === state.userClubId) + 1;
  const ev = evaluateTarget(state);
  const s = state.sentiment;
  const opp = fx ? clubNameOf(state, fx.homeClubId === state.userClubId ? fx.awayClubId : fx.homeClubId) : null;
  const where = fx ? (fx.homeClubId === state.userClubId ? 'HOME' : 'AWAY') : null;
  const unread = state.inbox.messages.filter((m) => !m.read).length;

  const nextLabel = state.phase === 'season-end'
    ? 'SEASON COMPLETE'
    : state.phase === 'job-offers'
      ? 'SACKED — FIND A NEW CLUB'
      : fx ? `${tierName.toUpperCase()} · MD ${state.matchday + 1} · vs ${opp?.toUpperCase()} (${where})`
        : 'NO FIXTURE';
  const actionLabel = state.phase === 'season-end' ? 'REVIEW SEASON ▶' : state.phase === 'job-offers' ? 'VIEW JOB OFFERS ▶' : fx ? 'PLAY MATCH ▶' : 'CONTINUE ▶';
  const action = state.phase === 'season-end' ? nav.onSeasonEnd : state.phase === 'job-offers' ? nav.onSeasonEnd : fx ? nav.onPlay : nav.onQuickSim;

  const headlinePreview = state.headlines.slice(-2).reverse().map((h) => `<div class="news">${esc(h.source.toUpperCase())} · ${esc(h.title)}</div>`).join('');

  uiScreen(ui, `
    <h1 class="h-screen">${esc(clubName.toUpperCase())} <span class="accent">· MANAGER</span></h1>
    <div class="row spread" style="margin-bottom:10px">
      <span class="tag">${esc(tierName.toUpperCase())} · P${pos || '–'}</span>
      <span class="tag">SEASON ${state.season} · MD ${Math.min(state.matchday + 1, state.totalRounds)}/${state.totalRounds}</span>
      <span class="tag">BUDGET <span class="money">${moneyM(state.transferBudget)}</span></span>
    </div>
    <div class="panel career-summary-panel" style="text-align:center">
      <div class="subtle">UP NEXT</div>
      <div style="font-size:24px;font-weight:800;margin:8px 0">${esc(nextLabel)}</div>
      <div class="row" style="justify-content:center;gap:8px;flex-wrap:wrap">
        <span class="tag">TARGET ${esc(state.board.target.description.toUpperCase())}</span>
        <span class="tag">BOARD ${Math.round(state.board.confidence)}%</span>
        <span class="tag">FANS ${Math.round(s.fans)}%</span>
        <span class="tag">PRESSURE ${Math.round(s.pressure)}%</span>
        ${state.windowPhase !== 'closed' ? `<span class="tag">${state.windowPhase.toUpperCase()} WINDOW OPEN</span>` : ''}
      </div>
      ${headlinePreview}
    </div>
    <div class="menu-col" style="margin-top:12px">
      <button class="btn primary" id="mh-action">${actionLabel}</button>
      ${fx ? '<button class="btn small" id="mh-sim">QUICK-SIM MATCHDAY</button>' : ''}
      <div class="cup-meta-tabs">
        <button class="btn small ${unread ? '' : ''}" id="mh-phone">PHONE${unread ? ` <span class="badge">${unread}</span>` : ''}</button>
        <button class="btn small" id="mh-press">PRESS</button>
        <button class="btn small" id="mh-headlines">HEADLINES${state.headlines.length ? ` <span class="badge">${state.headlines.length}</span>` : ''}</button>
      </div>
      <button class="btn small" id="mh-table">LEAGUE TABLE</button>
      <button class="btn small" id="mh-cup">${state.cup ? `${esc(state.cup.name.toUpperCase())} BRACKET` : 'NO CUP'}</button>
      <button class="btn small" id="mh-squad">SQUAD</button>
      <button class="btn small" id="mh-training">TRAINING</button>
      <button class="btn small" id="mh-transfers">TRANSFER MARKET</button>
      <button class="btn small" id="mh-scout">SCOUTING</button>
      <button class="btn small" id="mh-board">BOARD & TARGET</button>
      <button class="btn small" id="mh-exit">SAVE & EXIT</button>
    </div>`);
  bind('mh-action', action);
  if (fx) bind('mh-sim', nav.onQuickSim);
  bind('mh-phone', nav.onPhone);
  bind('mh-press', nav.onPress);
  bind('mh-headlines', nav.onHeadlines);
  bind('mh-table', nav.onStandings);
  bind('mh-cup', nav.onCup);
  bind('mh-squad', nav.onSquad);
  bind('mh-training', nav.onTraining);
  bind('mh-transfers', nav.onTransfers);
  bind('mh-scout', nav.onScout);
  bind('mh-board', nav.onBoard);
  bind('mh-exit', nav.onSaveExit);
}

export function managerStandings(ui: UI, state: ManagerState, onBack: () => void): void {
  const leagueId = userLeagueId(state);
  const tier = currentTierOf(state, state.userClubId);
  const nation = nationById(state.nationId);
  const prom = nation?.promotion ?? 3;
  const rel = nation?.relegation ?? 3;
  const teamCount = state.leagueTeamIds[leagueId]?.length ?? 0;
  const standings = standingsForUserLeague(state);
  const rows = standings.map((r, i) => {
    const isYou = r.clubId === state.userClubId;
    const zone = i < prom ? 'zone-title' : i >= teamCount - rel ? 'zone-rel' : '';
    return `<tr class="${isYou ? 'you' : ''} ${zone}">
      <td class="num">${i + 1}</td>
      <td>${esc(clubNameOf(state, r.clubId))}</td>
      <td class="num">${r.played}</td><td class="num">${r.won}</td><td class="num">${r.drawn}</td><td class="num">${r.lost}</td>
      <td class="num">${r.gf}</td><td class="num">${r.ga}</td><td class="num">${r.gf - r.ga}</td><td class="num"><b>${r.points}</b></td>
    </tr>`;
  }).join('');
  uiScreen(ui, `
    <h1 class="h-screen">LEAGUE <span class="accent">TABLE</span></h1>
    <div class="panel">
      <table class="tbl">
        <tr><th>#</th><th>CLUB</th><th>P</th><th>W</th><th>D</th><th>L</th><th>F</th><th>A</th><th>GD</th><th>PTS</th></tr>
        ${rows}
      </table>
      <div class="subtle" style="margin-top:8px">Top ${prom} promoted · Bottom ${rel} relegated${tier === 1 ? '' : ` (from Tier ${tier})`}</div>
    </div>
    <div class="menu-col" style="margin-top:12px;width:min(300px,80vw)"><button class="btn small" id="back">◀ BACK</button></div>`);
  bind('back', onBack);
}

export function managerSquad(ui: UI, state: ManagerState, onBack: () => void): void {
  const squad = state.squads[state.userClubId] ?? [];
  const rows = squad.map((p, i) => `<tr>
      <td>${esc(p.pos)}</td><td>${esc(p.name)}</td><td class="num">${p.age}</td>
      <td class="num">${Math.round(overallRating(p))}</td>
      <td class="num" style="color:${formColour(p.form)}">${formArrow(p.form)} ${Math.round(p.form)}</td>
      <td class="num">${Math.round(p.morale)}</td>
      <td class="num">${Math.round(p.fitness)}</td>
      <td class="num subtle">${moneyM(playerValue(p))}</td>
      <td class="num subtle">${p.contractYears}y</td>
    </tr>`).join('');
  uiScreen(ui, `
    <h1 class="h-screen">SQUAD <span class="accent">· ${squad.length}</span></h1>
    <div class="panel">
      <table class="tbl">
        <tr><th>POS</th><th>PLAYER</th><th>AGE</th><th>OVR</th><th>FORM</th><th>MOR</th><th>FIT</th><th>VALUE</th><th>CT</th></tr>
        ${rows}
      </table>
    </div>
    <div class="notice">Pick your XI from the match screen before kickoff. Training and morale shift form between matches.</div>
    <div class="menu-col" style="margin-top:12px;width:min(300px,80vw)"><button class="btn small" id="back">◀ BACK</button></div>`);
  bind('back', onBack);
}

const FOCUSES: { v: ManagerState['trainingFocus']; label: string }[] = [
  { v: 'balanced', label: 'BALANCED' },
  { v: 'fitness', label: 'FITNESS' },
  { v: 'attacking', label: 'ATTACKING' },
  { v: 'defensive', label: 'DEFENSIVE' },
  { v: 'technical', label: 'TECHNICAL' },
  { v: 'youth', label: 'YOUTH' },
];

export function managerTraining(ui: UI, state: ManagerState, onFocus: (f: ManagerState['trainingFocus']) => void, onBack: () => void): void {
  const squad = state.squads[state.userClubId] ?? [];
  const rows = squad.map((p) => `<tr>
      <td>${esc(p.pos)}</td><td>${esc(p.name)}</td><td class="num">${p.age}</td>
      <td class="num">${Math.round(overallRating(p))}</td>
      <td class="num">${Math.round(p.fitness)}</td>
      <td class="num" style="color:${formColour(p.form)}">${Math.round(p.form)}</td>
      <td class="num">${Math.round(p.morale)}</td>
      <td class="num subtle">${p.potential}</td>
    </tr>`).join('');
  uiScreen(ui, `
    <h1 class="h-screen">TRAINING <span class="accent">GROUND</span></h1>
    <div class="row" style="margin-bottom:10px">
      <div class="seg wrap" id="focus">
        ${FOCUSES.map((f) => `<button data-f="${f.v}" class="${state.trainingFocus === f.v ? 'on' : ''}">${f.label}</button>`).join('')}
      </div>
    </div>
    <div class="panel">
      <table class="tbl">
        <tr><th>POS</th><th>PLAYER</th><th>AGE</th><th>OVR</th><th>FIT</th><th>FORM</th><th>MOR</th><th>POT</th></tr>
        ${rows}
      </table>
    </div>
    <div class="notice">Focus shapes development between matchdays. Youth focus fast-tracks your prospects toward their potential.</div>
    <div class="menu-col" style="margin-top:12px;width:min(300px,80vw)"><button class="btn small" id="back">◀ BACK</button></div>`);
  document.getElementById('focus')?.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => onFocus((b as HTMLElement).dataset.f as ManagerState['trainingFocus']));
  });
  bind('back', onBack);
}

export function managerTransfers(
  ui: UI,
  state: ManagerState,
  listings: ManagerTransferListing[],
  onBid: (clubId: string, squadIdx: number, offer: number) => BidResult,
  onSell: (squadIdx: number, asking: number) => BidResult,
  onSignFA: (faIdx: number) => BidResult,
  onBack: () => void,
): void {
  let tab: 'buy' | 'sell' | 'free' = 'buy';
  const squad = state.squads[state.userClubId] ?? [];
  const render = (msg = '') => {
    let body = '';
    if (tab === 'buy') {
      const list = listings.slice(0, 80);
      body = `<table class="tbl">
        <tr><th>POS</th><th>PLAYER</th><th>CLUB</th><th>OVR</th><th>VALUE</th><th>ASK</th><th></th></tr>
        ${list.map((l) => {
          const clubShort = anyTeamById(l.clubId)?.short ?? '???';
          const reveal = l.revealed ? '' : ' style="opacity:0.6"';
          const open = Math.round(l.asking * 0.86 / 10) * 10;
          return `<tr${reveal}>
            <td>${esc(l.player.pos)}</td><td>${esc(l.player.name)}</td>
            <td class="subtle">${esc(clubShort)}</td>
            <td class="num">${l.revealed ? Math.round(overallRating(l.player)) : '??'}</td>
            <td class="num money">${moneyM(l.value)}</td>
            <td class="num money">${moneyM(l.asking)}</td>
            <td class="row" style="gap:4px;justify-content:flex-end">
              <button class="btn small" data-buy="${l.clubId}|${l.squadIdx}|${open}" ${state.transferBudget < open ? 'disabled' : ''}>BID</button>
              <button class="btn small" data-buy="${l.clubId}|${l.squadIdx}|${l.asking}" ${state.transferBudget < l.asking ? 'disabled' : ''}>MEET</button>
            </td>
          </tr>`;
        }).join('')}
      </table>`;
    } else if (tab === 'free') {
      const fas = state.freeAgents;
      body = fas.length
        ? `<table class="tbl">
            <tr><th>POS</th><th>PLAYER</th><th>AGE</th><th>OVR</th><th>FEE</th><th></th></tr>
            ${fas.map((p, i) => {
              const fee = freeAgentFee(p);
              const afford = state.transferBudget >= fee && squad.length < 27;
              return `<tr>
                <td>${esc(p.pos)}</td><td>${esc(p.name)}</td>
                <td class="num">${p.age}</td>
                <td class="num">${Math.round(overallRating(p))}</td>
                <td class="num money">${moneyM(fee)}</td>
                <td class="row" style="gap:4px;justify-content:flex-end">
                  <button class="btn small" data-fa="${i}" ${afford ? '' : 'disabled'}>SIGN</button>
                </td>
              </tr>`;
            }).join('')}
          </table>`
        : '<div class="notice">No free agents available right now — the pool refreshes each off-season.</div>';
    } else {
      body = `<table class="tbl">
        <tr><th>POS</th><th>PLAYER</th><th>OVR</th><th>VALUE</th><th></th></tr>
        ${squad.map((p, i) => `<tr>
          <td>${esc(p.pos)}</td><td>${esc(p.name)}</td>
          <td class="num">${Math.round(overallRating(p))}</td>
          <td class="num money">${moneyM(playerValue(p))}</td>
          <td class="row" style="gap:4px;justify-content:flex-end">
            <button class="btn small" data-sell="${i}|${Math.round(playerValue(p) * 0.9)}" ${squad.length <= 14 ? 'disabled' : ''}>QUICK</button>
            <button class="btn small danger" data-sell="${i}|${playerValue(p)}" ${squad.length <= 14 ? 'disabled' : ''}>LIST</button>
          </td>
        </tr>`).join('')}
      </table>`;
    }
    uiScreen(ui, `
      <h1 class="h-screen">TRANSFER <span class="accent">MARKET</span></h1>
      <div class="row spread" style="margin-bottom:10px">
        <div class="seg">
          <button id="tab-buy" class="${tab === 'buy' ? 'on' : ''}">BUY</button>
          <button id="tab-sell" class="${tab === 'sell' ? 'on' : ''}">SELL</button>
          <button id="tab-free" class="${tab === 'free' ? 'on' : ''}">FREE</button>
        </div>
        <span class="tag">BUDGET <span class="money">${moneyM(state.transferBudget)}</span></span>
        <span class="tag">SQUAD ${squad.length}/27</span>
      </div>
      ${tab === 'buy' ? '<div class="notice">Unscouted players show "??" — assign a scout to reveal their true rating. Stars may hold out for a bigger club; overpay to convince them.</div>' : ''}
      ${msg ? `<div class="notice" style="margin-bottom:8px">${esc(msg)}</div>` : ''}
      <div class="panel">${body}</div>
      <div class="menu-col" style="margin-top:12px;width:min(300px,80vw)">
        <button class="btn small" id="back">◀ DONE</button>
      </div>`);
    bind('tab-buy', () => { tab = 'buy'; render(); });
    bind('tab-sell', () => { tab = 'sell'; render(); });
    bind('tab-free', () => { tab = 'free'; render(); });
    bind('back', onBack);
    ui.root.querySelectorAll<HTMLElement>('[data-buy]').forEach((b) => {
      b.addEventListener('click', () => {
        const [cid, idx, offer] = b.dataset.buy!.split('|');
        const r = onBid(cid, parseInt(idx, 10), parseInt(offer, 10));
        render(r.message);
      });
    });
    ui.root.querySelectorAll<HTMLElement>('[data-sell]').forEach((b) => {
      b.addEventListener('click', () => {
        const [idx, asking] = b.dataset.sell!.split('|');
        const r = onSell(parseInt(idx, 10), parseInt(asking, 10));
        render(r.message);
      });
    });
    ui.root.querySelectorAll<HTMLElement>('[data-fa]').forEach((b) => {
      b.addEventListener('click', () => {
        const r = onSignFA(parseInt(b.dataset.fa!, 10));
        render(r.message);
      });
    });
  };
  render();
}

export function managerScout(
  ui: UI,
  state: ManagerState,
  clubs: { clubId: string; name: string; tier: number; revealed: boolean }[],
  onAssign: (clubId: string) => void,
  onBack: () => void,
): void {
  const rows = clubs.map((c) => `<tr>
      <td>${esc(c.name)}</td><td class="num">T${c.tier}</td>
      <td>${c.revealed ? 'ASSESSED' : '—'}</td>
      <td><button class="btn small" data-scout="${c.clubId}" ${state.scoutAssignments.length >= 3 || state.scoutAssignments.some((a) => a.targetClubId === c.clubId) ? 'disabled' : ''}>SCOUT</button></td>
    </tr>`).join('');
  uiScreen(ui, `
    <h1 class="h-screen">SCOUTING <span class="accent">NETWORK</span></h1>
    <div class="row spread" style="margin-bottom:10px">
      <span class="tag">ASSIGNMENTS ${state.scoutAssignments.length}/3</span>
      <span class="subtle">Scouting reveals a club's players so you can bid with confidence.</span>
    </div>
    <div class="panel"><table class="tbl"><tr><th>CLUB</th><th>TIER</th><th>STATUS</th><th></th></tr>${rows}</table></div>
    <div class="menu-col" style="margin-top:12px;width:min(300px,80vw)"><button class="btn small" id="back">◀ BACK</button></div>`);
  ui.root.querySelectorAll<HTMLElement>('[data-scout]').forEach((b) => {
    b.addEventListener('click', () => onAssign(b.dataset.scout!));
  });
  bind('back', onBack);
}

export function managerPhone(ui: UI, state: ManagerState, onReply: (msgId: string, replyId: string) => void, onBack: () => void): void {
  const msgs = state.inbox.messages.slice().sort((a, b) => b.order - a.order);
  const cards = msgs.map((m) => {
    const replies = m.replies?.length
      ? `<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px">${m.replies.map((r) => `<button class="btn small" data-reply="${m.id}|${r.id}">${esc(r.text)}</button>`).join('')}</div>`
      : '';
    return `<div class="phone-msg ${m.read ? '' : 'unread'}">
      <div class="phone-from">${esc(m.from)}</div>
      <div class="phone-text">${esc(m.text)}</div>
      ${m.replied ? '<div class="subtle">↪ ' + esc(m.replied) + '</div>' : replies}
    </div>`;
  }).join('');
  uiScreen(ui, `
    <h1 class="h-screen">PHONE <span class="accent">INBOX</span></h1>
    <div class="phone-feed">${cards || '<div class="panel">No messages.</div>'}</div>
    <div class="menu-col" style="margin-top:12px;width:min(300px,80vw)"><button class="btn small" id="back">◀ BACK</button></div>`);
  ui.root.querySelectorAll<HTMLElement>('[data-reply]').forEach((b) => {
    b.addEventListener('click', () => {
      const [mid, rid] = b.dataset.reply!.split('|');
      onReply(mid, rid);
    });
  });
  bind('back', onBack);
}

export function managerHeadlines(ui: UI, state: ManagerState, onBack: () => void): void {
  const items = state.headlines.slice(-20).reverse();
  const rows = items.map((h) => `<div class="headline-card ${h.tone}">
      <div class="headline-source">${esc(h.source)}</div>
      <div class="headline-title">${esc(h.title)}</div>
      ${h.body ? `<div class="headline-body">${esc(h.body)}</div>` : ''}
    </div>`).join('');
  uiScreen(ui, `
    <h1 class="h-screen">BACK <span class="accent">PAGE</span></h1>
    <div class="headline-feed">${rows || '<div class="panel">No headlines yet.</div>'}</div>
    <div class="menu-col" style="margin-top:12px;width:min(300px,80vw)"><button class="btn small" id="back">◀ BACK</button></div>`);
  bind('back', onBack);
}

export function managerBoard(ui: UI, state: ManagerState, onBack: () => void): void {
  const ev = evaluateTarget(state);
  const s = state.sentiment;
  const bar = (label: string, v: number) => `<div class="row spread"><span>${esc(label)}</span><span style="color:${v >= 50 ? '#39d98a' : '#e0c14a'}">${Math.round(v)}%</span></div>`;
  uiScreen(ui, `
    <h1 class="h-screen">THE <span class="accent">BOARD</span></h1>
    <div class="panel">
      <div class="row spread"><span class="subtle">SEASON TARGET</span><b>${esc(state.board.target.description)}</b></div>
      <div class="row spread"><span class="subtle">EXPECTED FINISH</span><b>${state.board.target.minPosition === 1 ? 'Win it' : `Top ${state.board.target.minPosition}`}</b></div>
      <div class="row spread"><span class="subtle">CURRENT POSITION</span><b>${ev.finish || '—'}${ev.finish ? ` (${ev.met ? 'on track' : 'behind'})` : ''}</b></div>
      <div class="row spread"><span class="subtle">SACK WARNINGS</span><b>${state.board.warnings}</b></div>
      <div class="row spread"><span class="subtle">MANAGER REPUTATION</span><b>${Math.round(state.reputation)}</b></div>
      <hr style="border:0;border-top:1px solid rgba(255,255,255,0.1);margin:12px 0" />
      ${bar('BOARD CONFIDENCE', state.board.confidence)}
      ${bar('FANS', s.fans)}${bar('SQUAD MORALE', s.squad)}${bar('MEDIA', s.media)}${bar('PRESSURE', s.pressure)}
    </div>
    <div class="notice">Miss the target and confidence craters — two warnings or a collapse and the board will sack you. Impress and bigger clubs come calling.</div>
    <div class="menu-col" style="margin-top:12px;width:min(300px,80vw)"><button class="btn small" id="back">◀ BACK</button></div>`);
  bind('back', onBack);
}

export function seasonEndSummary(ui: UI, state: ManagerState, lines: string[], onContinue: () => void): void {
  uiScreen(ui, `
    <h1 class="h-screen">SEASON <span class="accent">${state.season} REVIEW</span></h1>
    <div class="panel" style="font-size:18px;line-height:1.9">${lines.map((l) => `<div>${l}</div>`).join('')}</div>
    <div class="menu-col" style="margin-top:14px"><button class="btn primary" id="se-cont">CONTINUE TO SEASON ${state.season + 1} ▶</button></div>`);
  bind('se-cont', onContinue);
}

export function jobOffersScreen(ui: UI, state: ManagerState, offers: JobOffer[], onAccept: (clubId: string) => void, onBack: () => void): void {
  const cards = offers.map((o) => `<button class="team-card" data-job="${o.clubId}" style="text-align:left">
      <div class="tname">${esc(o.clubName)}</div>
      <div class="tmeta">Tier ${o.tier} · ${esc(o.leagueId)}</div>
    </button>`).join('');
  uiScreen(ui, `
    <h1 class="h-screen">JOB <span class="accent">OFFERS</span></h1>
    <div class="notice">You're out of work. The following clubs are willing to take a chance on you.</div>
    <div class="menu-col">${cards || '<div class="notice">No offers — your reputation needs rebuilding. Take a lower-league post when one appears.</div>'}</div>
    <div class="menu-col" style="margin-top:12px;width:min(300px,80vw)"><button class="btn small" id="back">◀ BACK TO MENU</button></div>`);
  ui.root.querySelectorAll<HTMLElement>('[data-job]').forEach((b) => {
    b.addEventListener('click', () => onAccept(b.dataset.job!));
  });
  bind('back', onBack);
}

export function managerPress(
  ui: UI,
  conference: PressConference,
  onAnswer: (ans: PressAnswer) => void,
  onDone: () => void,
  onBack: () => void,
): void {
  const queue: PressQuestion[] = [...conference.questions];
  const base = new Set(conference.questions);
  let qPos = 0;
  const ask = () => {
    if (qPos >= queue.length) { onDone(); return; }
    const q = queue[qPos];
    const isFollowUp = !base.has(q);
    const answers = q.answers.map((an) => `<button class="btn small" data-ans="${esc(an.id)}" style="text-align:left">${esc(an.text)}<span class="press-tone" style="margin-left:6px;opacity:0.6">${an.tone}</span></button>`).join('');
    uiScreen(ui, `
      <h1 class="h-screen">${esc(conference.title.toUpperCase())}</h1>
      ${conference.subtitle ? `<div class="subtle" style="text-align:center;margin-bottom:8px">${esc(conference.subtitle)}</div>` : ''}
      ${isFollowUp ? '<div class="notice" style="text-align:center;margin-bottom:8px">FOLLOW-UP QUESTION</div>' : ''}
      <div class="panel" style="text-align:center">
        <div class="subtle">${esc(q.reporter)}</div>
        <div style="font-size:18px;font-weight:700;margin:10px 0">${esc(q.text)}</div>
      </div>
      <div class="menu-col" style="margin-top:12px">${answers}</div>
      <div class="menu-col" style="margin-top:8px"><button class="btn small" id="back">◀ BACK</button></div>`);
    ui.root.querySelectorAll<HTMLElement>('[data-ans]').forEach((b) => {
      b.addEventListener('click', () => {
        const ans = q.answers.find((x) => x.id === b.dataset.ans);
        if (!ans) return;
        onAnswer(ans);
        if (ans.followUp) queue.splice(qPos + 1, 0, ans.followUp); // prompt a follow-up
        qPos++;
        ask();
      });
    });
    bind('back', onBack);
  };
  ask();
}

export function managerCup(ui: UI, state: ManagerState, onBack: () => void): void {
  const cup = state.cup;
  if (!cup) {
    uiScreen(ui, `
      <h1 class="h-screen">NO <span class="accent">CUP</span></h1>
      <div class="panel" style="text-align:center">This football world has no cup competition.</div>
      <div class="menu-col" style="margin-top:10px"><button class="btn small" id="back">◀ BACK</button></div>`);
    bind('back', onBack);
    return;
  }
  const status = cup.winner
    ? (cup.winner === state.userClubId ? 'WINNERS 🏆' : `Won by ${anyTeamById(cup.winner)?.name ?? cup.winner}`)
    : cup.userEliminated ? 'Eliminated'
      : `Alive · Round ${cup.currentRound + 1} of ${cup.rounds.length}`;
  const cols = cup.rounds.map((ties, r) => {
    const rows = ties.map((t) => {
      const hn = t.homeClubId ? (anyTeamById(t.homeClubId)?.short ?? t.homeClubId) : 'bye';
      const an = t.awayClubId ? (anyTeamById(t.awayClubId)?.short ?? t.awayClubId) : 'bye';
      const sc = t.winner !== undefined ? ` ${t.homeGoals ?? 0}–${t.awayGoals ?? 0}` : '';
      const hw = t.winner !== undefined && t.winner === t.homeClubId ? 'w' : '';
      const aw = t.winner !== undefined && t.winner === t.awayClubId ? 'w' : '';
      const you = (t.homeClubId === state.userClubId || t.awayClubId === state.userClubId) ? 'you' : '';
      return `<div class="tie ${you}"><span class="${hw}">${esc(hn)}</span> v <span class="${aw}">${esc(an)}</span>${sc}</div>`;
    }).join('');
    const label = r === cup.rounds.length - 1 ? 'Final' : r === cup.rounds.length - 2 ? 'Semi-Finals' : `Round ${r + 1}`;
    return `<div class="roundcol"><h4>${label}</h4>${rows}</div>`;
  }).join('');
  uiScreen(ui, `
    <h1 class="h-screen">${esc(cup.name.toUpperCase())} <span class="accent">BRACKET</span></h1>
    <div class="row spread" style="margin-bottom:8px"><span class="tag">YOUR RUN: ${esc(status)}</span></div>
    <div class="panel"><div class="bracket" style="max-height:60vh;overflow:auto">${cols}</div></div>
    <div class="menu-col" style="margin-top:10px;width:min(300px,80vw)"><button class="btn small" id="back">◀ BACK</button></div>`);
  bind('back', onBack);
}
