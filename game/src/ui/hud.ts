import type { GoalLogEntry, MatchState, SimEvent } from '../sim/types';
import type { SimPlayer } from '../sim/types';
import { HALF_LEN, HALF_WID } from '../sim/constants';

type SubGraphicEntry = { offName: string; onName: string };

export function formatHudPlayerLabel(player: SimPlayer, hasBall: boolean, teamNames: [string, string]): string {
  const card = player.yellowCards > 0 ? ' · YC' : '';
  return `${hasBall ? 'ON BALL' : 'SELECTED'} · ${teamNames[player.team]}: ${player.attrs.name}${card}`;
}

function escapeHudHtml(s: string): string {
  return s.replace(/[&<>"]/g, (m) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m] ?? m));
}

export function buildSubstitutionGraphicHtml(team: string, color: string, entries: SubGraphicEntry[]): string {
  const offRows = entries.map(({ offName }) => (
    `<div class="sg-scorer sg-sub-off"><span class="sg-sub-tag">OFF</span>${escapeHudHtml(offName)}</div>`
  )).join('');
  const onRows = entries.map(({ onName }) => (
    `<div class="sg-scorer sg-sub-on sg-sub-on--slide"><span class="sg-sub-tag">ON</span>${escapeHudHtml(onName)}</div>`
  )).join('');
  return `
      <div class="sg-label">SUBSTITUTION · ${escapeHudHtml(team)}</div>
      <div class="sg-main sg-main--sub">
        <span class="sg-chip" style="background:${color}"></span>
        <span class="sg-name sg-name-a">${escapeHudHtml(team)}</span>
        <span class="sg-score sg-score--sub">SUB</span>
        <span class="sg-name sg-name-b">CHANGE</span>
      </div>
      <div class="sg-scorers sg-subs">
        <div class="sg-col"><div class="sg-col-list">${offRows}</div></div>
        <div class="sg-col sg-col-b"><div class="sg-col-list">${onRows}</div></div>
      </div>`;
}

/** DOM scoreboard, clock, banners, power bar, penalty board, energy cards, radar. */
export class Hud {
  private root: HTMLElement;
  private nameA = 'HOME';
  private nameB = 'AWAY';
  private colorA = '#2f7bff';
  private colorB = '#ff5a3c';
  private bannerTimeout: number | null = null;
  private scoreGraphicTimeout: number | null = null;
  /** a goal graphic stays up (no auto-hide timer) until the kick-off is taken */
  private scoreGraphicSticky = false;
  /** substitution graphics temporarily own the score surface so goal graphics do not hide them */
  private scoreGraphicSubActive = false;
  private subGraphicTeam = '';
  private subGraphicEntries: SubGraphicEntry[] = [];
  /** true while a goal replay is on screen — the goal graphic stays hidden then */
  private replayActive = false;
  private radarCtx: CanvasRenderingContext2D | null = null;

  constructor() {
    this.root = document.getElementById('hud')!;
    this.root.innerHTML = `
      <div class="scorebar">
        <div class="chip" id="h-chipA"></div>
        <div class="name" id="h-nameA">HOME</div>
        <div class="score" id="h-score">0 - 0</div>
        <div class="name" id="h-nameB">AWAY</div>
        <div class="chip" id="h-chipB"></div>
        <div class="clock" id="h-clock">00:00</div>
        <div class="half" id="h-half">1ST</div>
      </div>
      <div class="power-wrap" id="h-power"><div class="power-bar" id="h-powerbar"></div></div>
      <div class="energy energy--a" id="h-energyA">
        <div class="energy__head"><span class="energy__chip" id="h-enchipA"></span><span class="energy__name" id="h-ennameA">—</span><span class="energy__tag" id="h-entagA"></span></div>
        <div class="energy__bar"><div class="energy__fill" id="h-enfillA"></div><div class="energy__cap" id="h-encapA"></div></div>
      </div>
      <div class="energy energy--b" id="h-energyB">
        <div class="energy__head"><span class="energy__tag" id="h-entagB"></span><span class="energy__name" id="h-ennameB">—</span><span class="energy__chip" id="h-enchipB"></span></div>
        <div class="energy__bar"><div class="energy__fill" id="h-enfillB"></div><div class="energy__cap" id="h-encapB"></div></div>
      </div>
      <canvas class="radar" id="h-radar" width="216" height="140" aria-hidden="true"></canvas>
      <div class="matchday-graphic" id="h-matchday" aria-hidden="true">
        <div class="matchday-kicker">INTERNATIONAL CUP 2026</div>
        <div class="matchday-title" id="h-matchday-title"></div>
        <div class="matchday-stadium" id="h-matchday-stadium"></div>
      </div>
      <div class="score-graphic" id="h-score-graphic" aria-hidden="true"></div>
      <div class="replay-tag" id="h-replay">REPLAY</div>
      <div class="banner" id="h-banner"></div>
      <div class="pen-board" id="h-pens">
        <div id="h-pentitle">PENALTY SHOOT-OUT</div>
        <div class="pen-aim" id="h-penaim"><div class="pen-aim__goal"><div class="pen-aim__marker" id="h-penmarker"></div></div></div>
        <div class="dots" id="h-pendots"></div>
      </div>
      <img class="hud-logo" id="h-logo" src="./assets/ui/grayson_sports.webp" alt="Grayson Sports" aria-hidden="true" />`;
    const radar = document.getElementById('h-radar') as HTMLCanvasElement;
    this.radarCtx = radar.getContext('2d');
  }

  setTeams(nameA: string, nameB: string, colorA: string, colorB: string) {
    this.nameA = nameA;
    this.nameB = nameB;
    this.colorA = colorA;
    this.colorB = colorB;
    (document.getElementById('h-nameA')!).textContent = nameA;
    (document.getElementById('h-nameB')!).textContent = nameB;
    (document.getElementById('h-chipA')!).style.background = colorA;
    (document.getElementById('h-chipB')!).style.background = colorB;
    (document.getElementById('h-enchipA')!).style.background = colorA;
    (document.getElementById('h-enchipB')!).style.background = colorB;
  }

  show(on: boolean) {
    this.root.classList.toggle('active', on);
    if (!on) { this.showMatchdayGraphic(false); this.hideScoreGraphic(); }
  }

  update(state: MatchState, halfLengthSec: number, shootPowerFrac: number) {
    (document.getElementById('h-score')!).textContent = `${state.score[0]} - ${state.score[1]}`;
    // map real seconds to broadcast minutes (45 per half); during stoppage the
    // clock ticks on PAST regulation (45:xx / 90:xx) instead of freezing
    const halfLen = state.half <= 2 ? halfLengthSec : halfLengthSec / 3;
    const baseMin = state.half === 1 ? 0 : state.half === 2 ? 45 : state.half === 3 ? 90 : 105;
    const spanMin = state.half <= 2 ? 45 : 15;
    const mins = baseMin + (state.clock / halfLen) * spanMin;
    const mm = Math.floor(mins).toString().padStart(2, '0');
    const ss = Math.floor((mins % 1) * 60).toString().padStart(2, '0');
    (document.getElementById('h-clock')!).textContent = `${mm}:${ss}`;
    const halfLabel = state.half === 1 ? '1ST' : state.half === 2 ? '2ND' : state.half === 3 ? 'ET1' : 'ET2';
    const addMin = state.clock >= halfLen && (state.addedTime ?? 0) > 0
      ? Math.max(1, Math.ceil(((state.addedTime ?? 0) / halfLen) * spanMin))
      : 0;
    (document.getElementById('h-half')!).textContent = addMin > 0 ? `${halfLabel} +${addMin}` : halfLabel;

    // a post-goal score graphic appears only AFTER the replay finishes and stays
    // up until the kick-off is actually taken (phase back to 'play'): hidden while
    // the replay is on screen, shown through the celebration/kick-off wait.
    if (this.scoreGraphicSticky && !this.scoreGraphicSubActive) {
      if (state.phase === 'play') {
        this.hideScoreGraphic();
      } else {
        const el = document.getElementById('h-score-graphic');
        if (el) {
          const visible = !this.replayActive;
          el.classList.toggle('show', visible);
          el.setAttribute('aria-hidden', visible ? 'false' : 'true');
        }
      }
    }

    const owner = state.players[state.ball.ownerIdx];
    this.updateEnergyCard(state, 0, owner ?? null);
    this.updateEnergyCard(state, 1, owner ?? null);
    this.drawRadar(state, owner ?? null);

    const power = document.getElementById('h-power')!;
    power.classList.toggle('show', shootPowerFrac > 0);
    (document.getElementById('h-powerbar')!).style.width = `${Math.round(shootPowerFrac * 100)}%`;

    const pens = document.getElementById('h-pens')!;
    const penAim = document.getElementById('h-penaim')!;
    const penMarker = document.getElementById('h-penmarker')!;
    const showPenaltyAim = state.phase === 'penaltyKick' || (state.phase === 'penalties' && !!state.penalties);
    penAim.classList.toggle('show', showPenaltyAim);
    const aim = state.phase === 'penalties' && state.penalties ? state.penalties.aim : state.penaltyAim;
    // an in-match penalty can be taken at EITHER end; the set-piece camera
    // mirrors left/right with the attacking direction (the shot itself is
    // already camera-corrected via input remapping), so the marker must mirror
    // too — otherwise it points the opposite way at one end of the pitch.
    const penDir = state.phase === 'penaltyKick' ? (state.attackDir[state.restartTeam] || 1) : 1;
    penMarker.style.left = `${50 + Math.max(-1, Math.min(1, aim)) * penDir * 43}%`;
    if (state.phase === 'penalties' && state.penalties) {
      pens.classList.add('show');
      (document.getElementById('h-pentitle')!).textContent = 'PENALTY SHOOT-OUT';
      const dots = (arr: number[]) => arr.map((v) => (v ? '●' : '○')).join(' ') || '—';
      (document.getElementById('h-pendots')!).innerHTML =
        `${this.nameA} ${dots(state.penalties.scores[0])} &nbsp;|&nbsp; ${dots(state.penalties.scores[1])} ${this.nameB}`;
    } else if (state.phase === 'penaltyKick') {
      pens.classList.add('show');
      (document.getElementById('h-pentitle')!).textContent = 'PENALTY';
      (document.getElementById('h-pendots')!).textContent = '';
    } else {
      pens.classList.remove('show');
    }
  }

  /** The player a team's card should track: on-ball man, else their active/
   * selected player, else whoever is nearest the ball. */
  private teamDisplayPlayer(state: MatchState, team: 0 | 1, owner: SimPlayer | null): SimPlayer | null {
    if (owner && owner.team === team && !owner.sentOff) return owner;
    const ctrlIdx = state.controlledIdx[team];
    if (ctrlIdx >= 0) {
      const c = state.players[ctrlIdx];
      if (c && c.team === team && !c.sentOff) return c;
    }
    let best: SimPlayer | null = null;
    let bestD = Infinity;
    const bx = state.ball.pos.x;
    const by = state.ball.pos.y;
    for (const p of state.players) {
      if (p.team !== team || p.sentOff) continue;
      const d = (p.pos.x - bx) ** 2 + (p.pos.y - by) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  private updateEnergyCard(state: MatchState, team: 0 | 1, owner: SimPlayer | null) {
    const suffix = team === 0 ? 'A' : 'B';
    const card = document.getElementById(`h-energy${suffix}`)!;
    const p = this.teamDisplayPlayer(state, team, owner);
    if (!p) { card.classList.remove('show'); return; }
    card.classList.add('show');
    (document.getElementById(`h-enname${suffix}`)!).textContent = p.attrs.name;
    const onBall = !!(owner && owner.idx === p.idx);
    const tag = document.getElementById(`h-entag${suffix}`)!;
    tag.textContent = onBall ? '●' : '';
    tag.classList.toggle('on', onBall);
    card.classList.toggle('booked', p.yellowCards > 0);
    // energy bar: full→empty, greens through amber to red as the legs go
    const s = Math.max(0, Math.min(1, p.stamina));
    const fill = document.getElementById(`h-enfill${suffix}`)!;
    fill.style.width = `${Math.round(s * 100)}%`;
    fill.style.background = s > 0.6
      ? 'linear-gradient(90deg,#3fbf6a,#5fe08a)'
      : s > 0.3
        ? 'linear-gradient(90deg,#d9a227,#ffd24a)'
        : 'linear-gradient(90deg,#c2392f,#ff6a5a)';
    // the "burned" zone above the long-term condition ceiling — stamina can no
    // longer recover into this part of the bar, so late-game fatigue is visible
    const ceil = Math.max(0, Math.min(1, p.staminaCeiling));
    const cap = document.getElementById(`h-encap${suffix}`)!;
    cap.style.width = `${Math.round((1 - ceil) * 100)}%`;
  }

  /** Overhead minimap: every player as a team-coloured dot so off-ball runs and
   * shape are visible. Drawn in raw sim space, which matches the broadcast
   * camera (x → right, +y → bottom of screen). */
  private drawRadar(state: MatchState, owner: SimPlayer | null) {
    const ctx = this.radarCtx;
    if (!ctx) return;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const pad = 6;
    const iw = w - pad * 2;
    const ih = h - pad * 2;
    ctx.clearRect(0, 0, w, h);
    // pitch
    ctx.fillStyle = 'rgba(10,38,22,0.82)';
    ctx.strokeStyle = 'rgba(255,255,255,0.32)';
    ctx.lineWidth = 1;
    roundRect(ctx, pad, pad, iw, ih, 4);
    ctx.fill();
    ctx.stroke();
    // halfway line + centre circle
    ctx.beginPath();
    ctx.moveTo(pad + iw / 2, pad);
    ctx.lineTo(pad + iw / 2, pad + ih);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(pad + iw / 2, pad + ih / 2, ih * 0.12, 0, Math.PI * 2);
    ctx.stroke();
    const px = (x: number) => pad + ((x + HALF_LEN) / (HALF_LEN * 2)) * iw;
    const py = (y: number) => pad + ((y + HALF_WID) / (HALF_WID * 2)) * ih;
    const displayA = this.teamDisplayPlayer(state, 0, owner);
    const displayB = this.teamDisplayPlayer(state, 1, owner);
    for (const p of state.players) {
      if (p.sentOff) continue;
      const cx = px(p.pos.x);
      const cy = py(p.pos.y);
      const active = p.idx === displayA?.idx || p.idx === displayB?.idx;
      ctx.beginPath();
      ctx.arc(cx, cy, active ? 3.6 : 2.6, 0, Math.PI * 2);
      ctx.fillStyle = p.team === 0 ? this.colorA : this.colorB;
      ctx.fill();
      if (active) {
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }
    // ball
    ctx.beginPath();
    ctx.arc(px(state.ball.pos.x), py(state.ball.pos.y), 1.8, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  handleEvents(events: SimEvent[]) {
    for (const e of events) {
      if (e.type === 'goal') this.banner('GOAL!', 2200);
      else if (e.type === 'halfTime') this.banner('HALF TIME', 2400);
      else if (e.type === 'fullTime') this.banner('FULL TIME', 2600);
      // the sim fires 'save' the instant it resolves the stop — when the keeper is still
      // up to ~2m out and mid-dive (the body/ball then slide into his hands over a few
      // render frames). Hold the banner briefly so "SAVED!" lands as he secures it, not
      // before he's reached it.
      else if (e.type === 'save') this.banner('SAVED!', 1100, 150);
      else if (e.type === 'post') this.banner('OFF THE POST!', 1300);
      else if (e.type === 'penMissed') this.banner('MISSED!', 1500);
      else if (e.type === 'offside') this.banner('OFFSIDE', 1300);
      else if (e.type === 'foul') this.banner('FOUL', 1300);
      else if (e.type === 'penalty') this.banner('PENALTY', 1600);
      else if (e.type === 'yellowCard') this.banner('YELLOW CARD', 1400);
      else if (e.type === 'redCard') this.banner('RED CARD', 1600);
      else if (e.type === 'injury') this.banner('INJURY', 1600);
    }
  }

  banner(text: string, ms: number, delayMs = 0) {
    const show = () => {
      const el = document.getElementById('h-banner')!;
      el.textContent = text;
      el.classList.add('show');
      if (this.bannerTimeout) window.clearTimeout(this.bannerTimeout);
      this.bannerTimeout = window.setTimeout(() => el.classList.remove('show'), ms);
    };
    if (delayMs > 0) window.setTimeout(show, delayMs);
    else show();
  }

  /** Substitution notification — shows the team and who came off/on. */
  subBanner(teamShort: string, offName: string, onName: string) {
    const el = document.getElementById('h-score-graphic');
    if (!el) return;
    const team = teamShort || 'TEAM';
    const color = team === this.nameB ? this.colorB : this.colorA;
    if (this.scoreGraphicTimeout) { clearTimeout(this.scoreGraphicTimeout); this.scoreGraphicTimeout = null; }
    if (!this.scoreGraphicSubActive || this.subGraphicTeam !== team) {
      this.subGraphicTeam = team;
      this.subGraphicEntries = [];
    }
    this.subGraphicEntries.push({ offName, onName });
    this.scoreGraphicSticky = false;
    this.scoreGraphicSubActive = true;
    this.root.classList.add('hud-sub-priority');
    el.classList.remove('score-graphic--sub', 'show');
    el.setAttribute('aria-hidden', 'true');
    this.renderSubBanner(el, team, color);
    this.restartSubGraphicAnimation(el);
    this.scoreGraphicTimeout = window.setTimeout(() => this.hideScoreGraphic(), 3600);
  }

  private renderSubBanner(el: HTMLElement, team: string, color: string) {
    el.innerHTML = buildSubstitutionGraphicHtml(team, color, this.subGraphicEntries);
    this.applyScorerScroll();
  }

  private restartSubGraphicAnimation(el: HTMLElement) {
    el.classList.remove('score-graphic--sub', 'show');
    void el.offsetWidth;
    el.classList.add('score-graphic--sub', 'show');
    el.setAttribute('aria-hidden', 'false');
  }

  setHint(text: string) {
    // the on-pitch control hint was removed in favour of a pre-match controls
    // screen; keep this guarded so any stray caller is a harmless no-op
    const el = document.getElementById('h-hint');
    if (el) el.textContent = text;
  }

  setReplay(on: boolean) {
    this.replayActive = on;
    document.getElementById('h-replay')!.classList.toggle('show', on);
  }

  showMatchdayGraphic(on: boolean, title = '', stadium = '') {
    const graphic = document.getElementById('h-matchday')!;
    if (title) document.getElementById('h-matchday-title')!.textContent = title;
    if (stadium) document.getElementById('h-matchday-stadium')!.textContent = stadium;
    graphic.classList.toggle('show', on);
    graphic.setAttribute('aria-hidden', on ? 'false' : 'true');
  }

  /** A TV-style broadcast graphic: running score + each goal's scorer and minute.
   *  Shown after a goal (as play returns for kick-off) and at half/full time. */
  showScoreGraphic(goals: GoalLogEntry[], score: [number, number], label: string, holdMs: number) {
    const el = document.getElementById('h-score-graphic');
    if (!el) return;
    if (this.scoreGraphicSubActive) return;
    const line = (g: GoalLogEntry) => `<div class="sg-scorer">${escapeHudHtml(g.player)}<span class="sg-min">${g.minute}'</span></div>`;
    const colA = goals.filter((g) => g.team === 0).map(line).join('') || '<div class="sg-scorer sg-empty">—</div>';
    const colB = goals.filter((g) => g.team === 1).map(line).join('') || '<div class="sg-scorer sg-empty">—</div>';
    this.root.classList.remove('hud-sub-priority');
    el.classList.remove('score-graphic--sub');
    el.innerHTML = `
      <div class="sg-label">${escapeHudHtml(label)}</div>
      <div class="sg-main">
        <span class="sg-chip" style="background:${this.colorA}"></span>
        <span class="sg-name sg-name-a">${escapeHudHtml(this.nameA)}</span>
        <span class="sg-score">${score[0]}<span class="sg-dash">–</span>${score[1]}</span>
        <span class="sg-name sg-name-b">${escapeHudHtml(this.nameB)}</span>
        <span class="sg-chip" style="background:${this.colorB}"></span>
      </div>
      <div class="sg-scorers"><div class="sg-col"><div class="sg-col-list">${colA}</div></div><div class="sg-col sg-col-b"><div class="sg-col-list">${colB}</div></div></div>`;
    this.applyScorerScroll();
    if (this.scoreGraphicTimeout) { clearTimeout(this.scoreGraphicTimeout); this.scoreGraphicTimeout = null; }
    if (holdMs > 0) {
      // half/full-time graphic: shown now, tied to the exit-presentation duration
      this.scoreGraphicSticky = false;
      el.classList.add('show');
      el.setAttribute('aria-hidden', 'false');
      this.scoreGraphicTimeout = window.setTimeout(() => this.hideScoreGraphic(), holdMs);
    } else {
      // after a goal: content is staged now but kept HIDDEN (the replay is about
      // to play). update() reveals it once the replay ends and hides it again when
      // the kick-off is taken.
      this.scoreGraphicSticky = true;
      el.classList.remove('show');
      el.setAttribute('aria-hidden', 'true');
    }
  }

  /** When a team has 3+ scorers the column would grow tall and push the graphic
   *  off-screen. Cap each column to two rows and, when it overflows, auto-scroll
   *  the list down through the scorers and back up on a loop so all are readable. */
  private applyScorerScroll() {
    const el = document.getElementById('h-score-graphic');
    if (!el) return;
    el.querySelectorAll<HTMLElement>('.sg-col').forEach((col) => {
      const list = col.querySelector<HTMLElement>('.sg-col-list');
      if (!list) return;
      list.classList.remove('sg-scroll');
      list.style.removeProperty('--sg-dist');
      list.style.removeProperty('--sg-dur');
      col.style.removeProperty('height');
      const rows = list.querySelectorAll('.sg-scorer');
      if (rows.length <= 2) return;
      const rowH = (rows[0] as HTMLElement).offsetHeight;
      if (!rowH) return;
      const viewH = rowH * 2 + 3; // two rows + the inter-row gap
      const dist = Math.max(0, list.scrollHeight - viewH);
      if (dist <= 0) return;
      col.style.height = `${viewH}px`;
      list.style.setProperty('--sg-dist', `${dist}px`);
      list.style.setProperty('--sg-dur', `${Math.min(12, 3 + (rows.length - 2) * 1.5)}s`);
      list.classList.add('sg-scroll');
    });
  }

  hideScoreGraphic() {
    if (this.scoreGraphicTimeout) { clearTimeout(this.scoreGraphicTimeout); this.scoreGraphicTimeout = null; }
    this.scoreGraphicSticky = false;
    this.scoreGraphicSubActive = false;
    this.subGraphicTeam = '';
    this.subGraphicEntries = [];
    this.root.classList.remove('hud-sub-priority');
    const el = document.getElementById('h-score-graphic');
    if (el) { el.classList.remove('show', 'score-graphic--sub'); el.setAttribute('aria-hidden', 'true'); }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
