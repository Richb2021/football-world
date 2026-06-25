import { TEAMS } from '../data/teams';
import {
  type Career, currentEvent, leagueTable, userFixture, effectiveStrength,
  setTrainingPlan, playerStateKey,
  type TrainingFocus, type TrainingIntensity,
  groupStandingForUser, careerGroups, playerAvailabilityLabel
} from '../game/career';
import { marketListings, playerValue, MIN_SQUAD, askingPrice } from '../game/transfers';
import { FORMATION_IDS, autoLineup, overallRating } from '../sim/formations';
import type { FormationId } from '../sim/types';
import { UI, bind } from './screens';

const MODE_LABEL: Record<string, string> = {
  league: 'LEAGUE SEASON',
  cup: 'CUP',
  season: 'FULL SEASON',
};

export function careerHub(ui: UI, career: Career, opts: {
  onPlay: () => void;
  onSimEvent: () => void;
  onTable: () => void;
  onBracket: () => void;
  onSquad: () => void;
  onTransfers: () => void;
  onTraining: () => void;
  onSaveExit: () => void;
  meta?: {
    unread: number;
    requiredReplies: number;
    hasPress: boolean;
    concerns: number;
    teamEvents: number;
    headlines: number;
    onPhone: () => void;
    onPress: () => void;
    onConcerns: () => void;
    onTeam: () => void;
    onHeadlines: () => void;
  };
}) {
  const team = TEAMS[career.userTeam];
  const ev = currentEvent(career);
  const fx = userFixture(career);

  let nextLabel = 'SEASON COMPLETE';
  let actionLabel = 'FINISH';
  let action = opts.onSimEvent;
  if (ev?.kind === 'window') {
    nextLabel = `${ev.label.toUpperCase()}`;
    actionLabel = 'CLOSE WINDOW & CONTINUE';
  } else if (ev && fx) {
    const opp = TEAMS[fx.opponent];
    const where = fx.home ? 'HOME' : 'AWAY';
    const comp = ev.kind === 'cup' ? career.cupRounds[ev.round]?.name?.toUpperCase() ?? 'CUP' : `ROUND ${ev.round + 1} / ${career.fixtures.length}`;
    nextLabel = `${comp} · vs ${opp.name.toUpperCase()} (${where})`;
    actionLabel = 'PLAY MATCH';
    action = opts.onPlay;
  } else if (ev) {
    nextLabel = ev.kind === 'cup'
      ? `${career.cupRounds[ev.round]?.name?.toUpperCase() ?? 'CUP'} — YOU'RE OUT, RESULTS ONLY`
      : `ROUND ${(ev as any).round + 1}`;
    actionLabel = 'CONTINUE';
  }

  const pos = career.mode !== 'cup'
    ? (() => {
        const t = leagueTable(career);
        const i = t.findIndex((r) => r.team === career.userTeam);
        return `P${i + 1}`;
      })()
    : (career.leagueId === 'international-cup' && career.step < 3)
      ? groupStandingForUser(career)
      : career.cupAlive ? 'IN THE CUP' : 'ELIMINATED';

  const training = career.training ? `${career.training.focus.toUpperCase()} · ${career.training.intensity.toUpperCase()}` : 'BALANCED · NORMAL';
  const openDeals = career.negotiations?.length ?? 0;
  const meta = opts.meta;
  const newsHtml = career.news.slice(-3).map((n) => `<div class="news">NEWS · ${n}</div>`).join('');
  const headlinePreview = meta && career.cupNarrative?.headlines.length
    ? career.cupNarrative.headlines.slice(0, 2).map((h) => `<div class="news">BACK PAGE · ${h.title}</div>`).join('')
    : newsHtml;
  const s = career.sentiment;
  const moodHtml = (meta && s) ? `<div class="row" style="justify-content:center;gap:8px;margin:6px 0 2px;flex-wrap:wrap">
      <span class="tag">FANS ${Math.round(s.fans)}%</span>
      <span class="tag">SQUAD ${Math.round(s.squad)}%</span>
      <span class="tag">PRESS ${Math.round(s.media)}%</span>
      <span class="tag">BOARD ${Math.round(career.board.confidence)}%</span>
      <span class="tag">PRESSURE ${Math.round(s.pressure)}%</span>
    </div>` : '';

  const screenHtml = `
    <h1 class="h-screen">${team.name.toUpperCase()} <span class="accent">· ${MODE_LABEL[career.mode]}</span></h1>
    <div class="row spread" style="margin-bottom:12px">
      <span class="tag">${pos}</span>
      ${career.mode === 'season' ? `<span class="tag">BUDGET <span class="money">£${(career.budget / 1000).toFixed(2)}M</span></span>` : ''}
      ${career.mode === 'season' ? `<span class="tag">BOARD ${Math.round(career.board.confidence)}%</span>` : ''}
      <span class="tag">EVENT ${Math.min(career.step + 1, career.calendar.length)} / ${career.calendar.length}</span>
    </div>
    <div class="panel career-summary-panel" style="text-align:center">
      <div class="subtle">UP NEXT</div>
      <div style="font-size:26px;font-weight:800;margin:10px 0">${nextLabel}</div>
      ${career.mode === 'season' ? `<div class="row" style="justify-content:center;gap:8px;margin-bottom:8px">
        <span class="tag">EXPECTATION ${career.board.expectation.toUpperCase()}</span>
        <span class="tag">TRAINING ${training}</span>
        ${openDeals ? `<span class="tag">OPEN DEALS ${openDeals}</span>` : ''}
      </div>` : ''}
      ${moodHtml}
      ${headlinePreview}
    </div>
    <div class="menu-col" style="margin-top:14px">
      <button class="btn primary" id="c-action">${actionLabel} <span class="arrow">▶</span></button>
      ${meta ? `<div class="cup-meta-tabs">
        <button class="btn small ${meta.requiredReplies ? 'danger' : ''}" id="c-phone">PHONE${meta.requiredReplies ? ` <span class="badge">${meta.requiredReplies}</span>` : meta.unread ? ` <span class="badge">${meta.unread}</span>` : ''}</button>
        <button class="btn small ${meta.hasPress ? 'danger' : ''}" id="c-press">PRESS${meta.hasPress ? ' <span class="badge">!</span>' : ''}</button>
        <button class="btn small ${meta.teamEvents || meta.concerns ? 'danger' : ''}" id="c-team">TEAM${meta.teamEvents + meta.concerns ? ` <span class="badge">${meta.teamEvents + meta.concerns}</span>` : ''}</button>
        <button class="btn small" id="c-headlines">HEADLINES${meta.headlines ? ` <span class="badge">${meta.headlines}</span>` : ''}</button>
      </div>` : ''}
      ${meta && meta.concerns ? `<button class="btn small danger" id="c-concerns">⚠️ PLAYER CONCERNS (${meta.concerns})</button>` : ''}
      ${(career.mode !== 'cup' || (career.leagueId === 'international-cup' && career.step < 3)) ? '<button class="btn small" id="c-table">STANDINGS</button>' : ''}
      ${(career.mode !== 'league' && (!career.leagueId || career.leagueId !== 'international-cup' || career.step >= 3)) ? '<button class="btn small" id="c-bracket">CUP BRACKET</button>' : ''}
      <button class="btn small" id="c-squad">SQUAD & FORMATION</button>
      ${career.mode === 'season' ? '<button class="btn small" id="c-training">TRAINING PLAN</button>' : ''}
      ${career.mode === 'season' && currentEvent(career)?.kind === 'window' ? '<button class="btn small" id="c-transfers">TRANSFER MARKET</button>' : ''}
      <button class="btn small" id="c-exit">SAVE & EXIT</button>
    </div>`;
  uiScreen(ui, screenHtml);
  bind('c-action', action);
  if (opts.meta) {
    bind('c-phone', opts.meta.onPhone);
    bind('c-press', opts.meta.onPress);
    bind('c-concerns', opts.meta.onConcerns);
    bind('c-team', opts.meta.onTeam);
    bind('c-headlines', opts.meta.onHeadlines);
  }
  bind('c-table', opts.onTable);
  bind('c-bracket', opts.onBracket);
  bind('c-squad', opts.onSquad);
  bind('c-training', opts.onTraining);
  bind('c-transfers', opts.onTransfers);
  bind('c-exit', opts.onSaveExit);
}

export function headlinesScreen(ui: UI, career: Career, onBack: () => void) {
  const legacy = career.news.slice(-10).reverse().map((title, i): { id: string; title: string; source: string; tone: 'neutral'; step: number; body?: string } => ({
    id: `legacy-${i}`,
    title,
    source: 'Tournament Desk',
    tone: 'neutral',
    step: career.step,
  }));
  const items = career.cupNarrative?.headlines.length ? career.cupNarrative.headlines : legacy;
  const rows = items.map((h) => `
    <div class="headline-card ${h.tone}">
      <div class="headline-source">${h.source}</div>
      <div class="headline-title">${h.title}</div>
      ${h.body ? `<div class="headline-body">${h.body}</div>` : ''}
    </div>`).join('');
  uiScreen(ui, `
    <h1 class="h-screen">BACK PAGE <span class="accent">HEADLINES</span></h1>
    <div class="headline-feed">${rows || '<div class="panel">No headlines yet.</div>'}</div>
    <div class="menu-col" style="margin-top:14px;width:min(300px,80vw)">
      <button class="btn small" id="back">◀ BACK</button>
    </div>`);
  bind('back', onBack);
}

export function teamScreen(ui: UI, career: Career, onHandleIssues: () => void, onBack: () => void) {
  const pending = career.cupNarrative?.pendingTeamEvents.length ?? 0;
  const unhappy = career.unhappy ?? [];
  const captainHeat = career.cupNarrative?.arcs.find((arc) => arc.type === 'captain-trust' && !arc.resolved)?.heat ?? 0;
  const rows = [
    pending ? `<div class="team-issue-card urgent"><b>Team meeting waiting</b><span>${pending} camp issue${pending === 1 ? '' : 's'} need your attention before kickoff.</span></div>` : '',
    unhappy.length ? `<div class="team-issue-card urgent"><b>Player conversations</b><span>${unhappy.slice(0, 3).join(', ')} ${unhappy.length > 3 ? `and ${unhappy.length - 3} more ` : ''}want clarity.</span></div>` : '',
    captainHeat ? `<div class="team-issue-card"><b>Captain trust</b><span>The captain relationship is active. Your private choices can steady or split the room.</span></div>` : '',
  ].filter(Boolean).join('');
  uiScreen(ui, `
    <h1 class="h-screen">TEAM <span class="accent">ROOM</span></h1>
    <div class="team-room-feed">
      ${rows || '<div class="panel" style="text-align:center">No team issues right now. The camp is quiet.</div>'}
    </div>
    <div class="menu-col" style="margin-top:14px;width:min(360px,86vw)">
      ${(pending || unhappy.length) ? '<button class="btn primary" id="team-handle">HANDLE TEAM ISSUES <span class="arrow">▶</span></button>' : ''}
      <button class="btn small" id="back">◀ BACK</button>
    </div>`);
  bind('team-handle', onHandleIssues);
  bind('back', onBack);
}

export function tableScreen(ui: UI, career: Career, onBack: () => void) {
  if (career.leagueId === 'international-cup') {
    const groupIndices = careerGroups(career).map(group =>
      group.map(id => TEAMS.findIndex(t => t.id === id)).filter(idx => idx !== -1)
    );

    const standings = groupIndices.map((group, groupIdx) => {
      const stats = group.map(teamIdx => ({
        team: teamIdx,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        gf: 0,
        ga: 0,
        gd: 0,
        pts: 0
      }));

      for (let r = 0; r < 3; r++) {
        const roundFixtures = career.fixtures[r];
        if (!roundFixtures) continue;
        roundFixtures.forEach(([h, a], i) => {
          if (group.includes(h) && group.includes(a)) {
            const key = `${r}:${i}`;
            const res = career.results[key];
            if (res) {
              const [gh, ga] = res;
              const hStat = stats.find(s => s.team === h);
              const aStat = stats.find(s => s.team === a);
              if (hStat && aStat) {
                hStat.played++;
                aStat.played++;
                hStat.gf += gh; hStat.gd += (gh - ga);
                aStat.gf += ga; aStat.gd += (ga - gh);
                hStat.ga += ga;
                aStat.ga += gh;
                if (gh > ga) { hStat.won++; hStat.pts += 3; aStat.lost++; }
                else if (ga > gh) { aStat.won++; aStat.pts += 3; hStat.lost++; }
                else { hStat.drawn++; hStat.pts += 1; aStat.drawn++; aStat.pts += 1; }
              }
            }
          }
        });
      }

      stats.sort((a, b) => {
        if (b.pts !== a.pts) return b.pts - a.pts;
        if (b.gd !== a.gd) return b.gd - a.gd;
        return b.gf - a.gf;
      });

      return stats;
    });

    const groupsHtml = standings.map((stats, groupIdx) => {
      const groupChar = String.fromCharCode(65 + groupIdx);
      const rows = stats.map((r, i) => `
        <tr class="${r.team === career.userTeam ? 'you' : ''}">
          <td class="num">${i + 1}</td>
          <td style="text-align:left;font-weight:600">${TEAMS[r.team].name}</td>
          <td class="num">${r.played}</td>
          <td class="num">${r.gd >= 0 ? '+' + r.gd : r.gd}</td>
          <td class="num"><b>${r.pts}</b></td>
        </tr>`).join('');
      return `
        <div class="panel" style="width:280px; margin:8px; display:inline-block; vertical-align:top">
          <h3 style="margin:0 0 8px 0; border-bottom:2px solid var(--accent); padding-bottom:4px; font-weight:900; color:var(--accent)">GROUP ${groupChar}</h3>
          <table class="tbl" style="font-size:13px;width:100%">
            <tr><th>#</th><th style="text-align:left">NATION</th><th>P</th><th>GD</th><th>PTS</th></tr>
            ${rows}
          </table>
        </div>`;
    }).join('');

    uiScreen(ui, `
      <h1 class="h-screen">GROUP <span class="accent">STANDINGS</span></h1>
      <div style="display:flex; flex-wrap:wrap; justify-content:center; max-height:60vh; overflow-y:auto; padding:10px 0; width:100%">
        ${groupsHtml}
      </div>
      <div class="menu-col" style="margin-top:14px; width:min(300px,80vw)">
        <button class="btn small" id="back">◀ BACK</button>
      </div>`);
    bind('back', onBack);
    return;
  }

  const table = leagueTable(career);
  const rows = table.map((r, i) => `
    <tr class="${r.team === career.userTeam ? 'you' : ''} ${i === 0 ? 'zone-title' : i >= 19 ? 'zone-rel' : ''}">
      <td class="num">${i + 1}</td>
      <td>${TEAMS[r.team].name}</td>
      <td class="num">${r.played}</td><td class="num">${r.won}</td>
      <td class="num">${r.drawn}</td><td class="num">${r.lost}</td>
      <td class="num">${r.gf}</td><td class="num">${r.ga}</td>
      <td class="num">${r.gf - r.ga}</td><td class="num"><b>${r.points}</b></td>
    </tr>`).join('');
  uiScreen(ui, `
    <h1 class="h-screen">PREMIER <span class="accent">TABLE</span></h1>
    <div class="panel">
      <table class="tbl">
        <tr><th>#</th><th>CLUB</th><th>P</th><th>W</th><th>D</th><th>L</th><th>F</th><th>A</th><th>GD</th><th>PTS</th></tr>
        ${rows}
      </table>
    </div>
    <div class="menu-col" style="margin-top:14px;width:min(300px,80vw)">
      <button class="btn small" id="back">◀ BACK</button>
    </div>`);
  bind('back', onBack);
}

export function bracketScreen(ui: UI, career: Career, onBack: () => void) {
  const cols = career.cupRounds.map((round) => {
    if (!round) return '';
    const ties = round.ties.map((t) => {
      const isYou = t.a === career.userTeam || t.b === career.userTeam;
      const a = TEAMS[t.a].short, b = TEAMS[t.b].short;
      const score = t.score ? ` ${t.score[0]}–${t.score[1]}${t.etPens ? ' *' : ''}` : '';
      const wa = t.winner === 0 ? 'w' : '', wb = t.winner === 1 ? 'w' : '';
      return `<div class="tie ${isYou ? 'you' : ''}"><span class="${wa}">${a}</span> v <span class="${wb}">${b}</span>${score}</div>`;
    }).join('');
    const byes = round.byes.length ? `<div class="tie subtle">byes: ${round.byes.map((i) => TEAMS[i].short).join(' ')}</div>` : '';
    return `<div class="roundcol"><h4>${round.name}</h4>${ties}${byes}</div>`;
  }).join('');
  uiScreen(ui, `
    <h1 class="h-screen">CUP <span class="accent">BRACKET</span></h1>
    <div class="panel"><div class="bracket">${cols || '<div class="subtle">Draw not made yet</div>'}</div>
    <div class="subtle" style="margin-top:8px">* decided after extra time / penalties</div></div>
    <div class="menu-col" style="margin-top:14px;width:min(300px,80vw)">
      <button class="btn small" id="back">◀ BACK</button>
    </div>`);
  bind('back', onBack);
}

export function squadScreen(ui: UI, career: Career, onChanged: () => void, onBack: () => void) {
  const teamId = TEAMS[career.userTeam].id;
  const squad = career.squads[teamId];

  const render = () => {
    // resolve starters -> indices; fill blanks by auto-pick
    let starterIdx = career.starters
      .map((name) => squad.findIndex((p) => p.name === name))
      .filter((i) => i >= 0);
    if (starterIdx.length < 11) {
      starterIdx = autoLineup(squad, career.formation);
      career.starters = starterIdx.map((i) => squad[i].name);
      onChanged();
    }
    const bench = squad.map((_, i) => i).filter((i) => !starterIdx.includes(i));
    const sqTeamId = TEAMS[career.userTeam].id;
    const formColour = (f: number) => f >= 70 ? '#39d98a' : f >= 45 ? '#e0c14a' : '#e0644a';
    const formArrow = (f: number) => f >= 70 ? '▲' : f >= 45 ? '▬' : '▼';
    const row = (i: number, inXI: boolean) => {
      const p = squad[i];
      const st = career.playerStates?.[playerStateKey(sqTeamId, p.name)];
      const form = Math.round(st?.form ?? 50);
      return `<tr data-i="${i}" data-xi="${inXI}" class="pick-row" style="cursor:pointer">
        <td>${p.pos}</td><td>${p.name}</td><td class="num">${p.age}</td>
        <td class="num">${Math.round(overallRating(p))}</td>
        <td class="num" style="color:${formColour(form)}">${formArrow(form)} ${form}</td>
        <td class="num subtle">£${(playerValue(p) / 1000).toFixed(2)}M</td>
      </tr>`;
    };
    uiScreen(ui, `
      <h1 class="h-screen">SQUAD <span class="accent">· ${career.formation}</span></h1>
      <div class="row" style="margin-bottom:10px">
        <div class="seg wrap" id="formations">
          ${FORMATION_IDS.map((f) => `<button data-f="${f}" class="${career.formation === f ? 'on' : ''}">${f}</button>`).join('')}
        </div>
        <span class="subtle" id="swap-hint">Tap a starter then a bench player to swap. Pick your in-form players.</span>
      </div>
      <div class="panel">
        <table class="tbl">
          <tr><th colspan="4">STARTING XI</th><th class="num">FORM</th><th></th></tr>
          ${starterIdx.map((i) => row(i, true)).join('')}
          <tr><th colspan="4" style="padding-top:14px">BENCH / RESERVES</th><th class="num">FORM</th><th></th></tr>
          ${bench.map((i) => row(i, false)).join('')}
        </table>
      </div>
      <div class="menu-col" style="margin-top:14px;width:min(300px,80vw)">
        <button class="btn small" id="back">◀ BACK</button>
      </div>`);

    document.getElementById('formations')!.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        career.formation = (b as HTMLElement).dataset.f as FormationId;
        const xi = autoLineup(squad, career.formation);
        career.starters = xi.map((i) => squad[i].name);
        onChanged();
        render();
      });
    });

    let selected: { i: number; xi: boolean } | null = null;
    ui.root.querySelectorAll<HTMLElement>('.pick-row').forEach((tr) => {
      tr.addEventListener('click', () => {
        const i = parseInt(tr.dataset.i!, 10);
        const xi = tr.dataset.xi === 'true';
        if (!selected) {
          selected = { i, xi };
          tr.style.outline = '2px solid var(--accent)';
          return;
        }
        if (selected.xi !== xi) {
          const starterPos = career.starters.indexOf(squad[selected.xi ? selected.i : i].name);
          const benchName = squad[selected.xi ? i : selected.i].name;
          if (starterPos >= 0) {
            // GK slot must stay a keeper-ish pick; allow but warn-free (arcade)
            career.starters[starterPos] = benchName;
            onChanged();
          }
        }
        selected = null;
        render();
      });
    });
    bind('back', onBack);
  };
  render();
}

export function trainingScreen(ui: UI, career: Career, onChanged: () => void, onBack: () => void) {
  const focuses: TrainingFocus[] = ['balanced', 'fitness', 'technical', 'attacking', 'defending'];
  const intensities: TrainingIntensity[] = ['light', 'normal', 'hard'];
  const teamId = TEAMS[career.userTeam].id;
  const squad = career.squads[teamId];
  const render = () => {
    const rows = squad.map((p) => {
      const st = career.playerStates[playerStateKey(teamId, p.name)] ?? { fitness: 84, form: 50, morale: 58, sharpness: 56 };
      const availability = playerAvailabilityLabel(career, teamId, p.name) ?? 'OK';
      return `<tr>
        <td>${p.pos}</td><td>${p.name}</td>
        <td class="num">${Math.round(overallRating(p))}</td>
        <td class="num">${Math.round(st.fitness)}</td>
        <td class="num">${Math.round(st.sharpness)}</td>
        <td class="num">${Math.round(st.form)}</td>
        <td class="num">${Math.round(st.morale)}</td>
        <td>${availability}</td>
      </tr>`;
    }).join('');
    uiScreen(ui, `
      <h1 class="h-screen">TRAINING <span class="accent">PLAN</span></h1>
      <div class="row" style="margin-bottom:10px;align-items:flex-start">
        <div>
          <div class="subtle" style="margin-bottom:4px">FOCUS</div>
          <div class="seg wrap" id="training-focus">
            ${focuses.map((f) => `<button data-focus="${f}" class="${career.training.focus === f ? 'on' : ''}">${f.toUpperCase()}</button>`).join('')}
          </div>
        </div>
        <div>
          <div class="subtle" style="margin-bottom:4px">INTENSITY</div>
          <div class="seg" id="training-intensity">
            ${intensities.map((i) => `<button data-intensity="${i}" class="${career.training.intensity === i ? 'on' : ''}">${i.toUpperCase()}</button>`).join('')}
          </div>
        </div>
      </div>
      <div class="panel">
        <table class="tbl">
          <tr><th>POS</th><th>PLAYER</th><th>OVR</th><th>FIT</th><th>SHARP</th><th>FORM</th><th>MORALE</th><th>STATUS</th></tr>
          ${rows}
        </table>
      </div>
      <div class="notice">Hard training can lift sharpness faster but costs fitness. Light training is safer before a match.</div>
      <div class="menu-col" style="margin-top:14px;width:min(300px,80vw)">
        <button class="btn small" id="back">◀ BACK</button>
      </div>`);
    document.getElementById('training-focus')!.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        setTrainingPlan(career, { focus: (b as HTMLElement).dataset.focus as TrainingFocus });
        onChanged();
        render();
      });
    });
    document.getElementById('training-intensity')!.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        setTrainingPlan(career, { intensity: (b as HTMLElement).dataset.intensity as TrainingIntensity });
        onChanged();
        render();
      });
    });
    bind('back', onBack);
  };
  render();
}

export function transferScreen(ui: UI, career: Career, onChanged: () => void, onBack: () => void, doBuy: (teamId: string, name: string, offer: number) => string | null, doSell: (squadIdx: number, asking: number) => string | null) {
  let tab: 'buy' | 'sell' = 'buy';
  const teamId = TEAMS[career.userTeam].id;

  const render = (msg = '') => {
    const squad = career.squads[teamId];
    let body = '';
    if (tab === 'buy') {
      const list = marketListings(career.squads, teamId).slice(0, 80);
      const dealRows = (career.negotiations ?? []).map((deal) => `
        <div class="notice" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <span>COUNTER · ${deal.playerName} · £${(deal.counterOffer / 1000).toFixed(2)}M</span>
          <button class="btn small" data-buy="${deal.teamId}|${deal.playerName}|${deal.counterOffer}" ${career.budget < deal.counterOffer ? 'disabled' : ''}>ACCEPT</button>
        </div>`).join('');
      body = `<table class="tbl">
        <tr><th>POS</th><th>PLAYER</th><th>CLUB</th><th>OVR</th><th>VALUE</th><th>ASK</th><th></th></tr>
        ${list.map((l) => {
          const ask = askingPrice(career.squads[l.teamId], l.player);
          const opening = Math.round(ask * 0.86 / 10) * 10;
          return `<tr>
            <td>${l.player.pos}</td><td>${l.player.name}</td>
            <td class="subtle">${TEAMS.find((t) => t.id === l.teamId)?.short}</td>
            <td class="num">${Math.round(overallRating(l.player))}</td>
            <td class="num money">£${(l.value / 1000).toFixed(2)}M</td>
            <td class="num money">£${(ask / 1000).toFixed(2)}M</td>
            <td class="row" style="gap:4px;justify-content:flex-end">
              <button class="btn small" data-buy="${l.teamId}|${l.player.name}|${opening}" ${career.budget < opening ? 'disabled' : ''}>BID</button>
              <button class="btn small" data-buy="${l.teamId}|${l.player.name}|${ask}" ${career.budget < ask ? 'disabled' : ''}>ASK</button>
            </td>
          </tr>`;
        }).join('')}
      </table>${dealRows}`;
    } else {
      body = `<table class="tbl">
        <tr><th>POS</th><th>PLAYER</th><th>OVR</th><th>VALUE</th><th></th></tr>
        ${squad.map((p, i) => `
          <tr>
            <td>${p.pos}</td><td>${p.name}</td>
            <td class="num">${Math.round(overallRating(p))}</td>
            <td class="num money">£${(playerValue(p) / 1000).toFixed(2)}M</td>
            <td class="row" style="gap:4px;justify-content:flex-end">
              <button class="btn small" data-sell="${i}|${Math.round(playerValue(p) * 0.9)}" ${squad.length <= MIN_SQUAD ? 'disabled' : ''}>QUICK</button>
              <button class="btn small danger" data-sell="${i}|${playerValue(p)}" ${squad.length <= MIN_SQUAD ? 'disabled' : ''}>ASK</button>
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
        </div>
        <span class="tag">BUDGET <span class="money">£${(career.budget / 1000).toFixed(2)}M</span></span>
        <span class="tag">SQUAD ${squad.length}</span>
      </div>
      ${msg ? `<div class="notice" style="margin-bottom:8px">${msg}</div>` : ''}
      <div class="panel">${body}</div>
      <div class="menu-col" style="margin-top:14px;width:min(300px,80vw)">
        <button class="btn small" id="back">◀ DONE</button>
      </div>`);
    bind('tab-buy', () => { tab = 'buy'; render(); });
    bind('tab-sell', () => { tab = 'sell'; render(); });
    bind('back', onBack);
    ui.root.querySelectorAll<HTMLElement>('[data-buy]').forEach((b) => {
      b.addEventListener('click', () => {
        const [tid, name, offer] = b.dataset.buy!.split('|');
        const err = doBuy(tid, name, parseInt(offer, 10));
        onChanged();
        render(err ?? `${name} signed!`);
      });
    });
    ui.root.querySelectorAll<HTMLElement>('[data-sell]').forEach((b) => {
      b.addEventListener('click', () => {
        const [idx, asking] = b.dataset.sell!.split('|');
        const err = doSell(parseInt(idx, 10), parseInt(asking, 10));
        onChanged();
        render(err ?? 'Sold.');
      });
    });
  };
  render();
}

export function seasonSummary(career: Career): string[] {
  const lines: string[] = [];
  if (career.mode !== 'cup') {
    const table = leagueTable(career);
    const champs = TEAMS[table[0].team].name;
    const youPos = table.findIndex((r) => r.team === career.userTeam) + 1;
    lines.push(`CHAMPIONS: <b>${champs.toUpperCase()}</b>`);
    lines.push(`You finished <b>${ordinal(youPos)}</b>`);
  }
  if (career.mode !== 'league') {
    const final = career.cupRounds[career.cupRounds.length - 1]?.ties[0];
    if (final?.winner !== undefined) {
      const w = TEAMS[final.winner === 0 ? final.a : final.b].name;
      lines.push(`CUP WINNERS: <b>${w.toUpperCase()}</b>`);
    }
  }
  return lines;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** access UI.screen (private-ish) without circular import games */
function uiScreen(ui: UI, inner: string) {
  (ui as unknown as { screen: (inner: string, bg?: string) => HTMLElement }).screen(inner, ui.bgUrl);
}
