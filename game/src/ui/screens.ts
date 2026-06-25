import { TEAMS } from '../data/teams';
import { LEAGUES, type LeagueDef } from '../data/leagues';
import {
  FORMATION_IDS,
  FORMATIONS,
  autoLineup,
  formationDefaultTactics,
  normalizeLineupForFormation,
  normalizeTactics,
  overallRating,
  teamDefaultLineup,
} from '../sim/formations';
import type { FormationId, Lineup, MatchConfig, PlayerAttrs, TeamData, TeamTactics } from '../sim/types';
import type { Settings } from '../game/saves';
import type { ChallengeChapter, ChallengeChapterId } from '../game/challengeChronicle';

export const MAIN_MENU_JOURNEY_LABEL = 'STORY MODE';
const START_MENU_INPUT_GUARD_MS = 450;

export function shouldSuppressMenuActivation(nowMs: number, lockedUntilMs: number): boolean {
  return nowMs < lockedUntilMs;
}

export interface SubstitutionRow {
  playerIdx?: number;
  squadIdx: number;
  pos: string;
  name: string;
  overall: number;
  /** visible short-term stamina bar, 0..1 */
  energy?: number;
  /** long-term condition ceiling, 0..1 */
  staminaCeiling?: number;
  /** yellow cards this player is carrying (shown as a caution badge) */
  yellowCards?: number;
  /** true if this player came on as a substitute (not an original starter) */
  subbedOn?: boolean;
}

export interface QueuedSubRow {
  offPlayerIdx: number;
  onSquadIdx: number;
  offName: string;
  onName: string;
}

type SelectionTab = 'team' | 'formation' | 'tactics';

export interface PauseMenuView {
  /** online matches show a synchronized-pause variant (countdown + ready) */
  online: boolean;
  onResume: () => void;
  onQuit: () => void;
  onSubstitutions?: () => void;
}

export interface PauseStatusView {
  seconds: number;
  youReady: boolean;
  oppReady: boolean;
}

export interface SubstitutionMenuOpts {
  teamName: string;
  used: number;
  max: number;
  /** true when the match is at a stoppage and a sub can be confirmed now */
  atBreak: boolean;
  /** seconds left on the online synchronized pause (undefined when offline) */
  onlinePauseSeconds?: number;
  starters: SubstitutionRow[];
  bench: SubstitutionRow[];
  formation: FormationId;
  tactics: TeamTactics;
  formations?: FormationId[];
  initialTab?: SelectionTab;
  message?: string;
  /** substitutions set but not yet made (applied at the next stoppage) */
  queued?: QueuedSubRow[];
  onSub: (offPlayerIdx: number, onSquadIdx: number) => void;
  /** swap two on-pitch players' positions (no substitution used) */
  onSwap?: (playerIdxA: number, playerIdxB: number) => void;
  /** cancel a queued substitution before it is made */
  onCancelQueued?: (offPlayerIdx: number) => void;
  onFormationChange?: (formation: FormationId) => void;
  onTacticsChange?: (tactics: TeamTactics) => void;
  onBack: () => void;
}

export function substitutionUsageLabel(used: number, max: number): string {
  return `${used} / ${max} USED`;
}

export interface PrematchLineupPlayer {
  squadIdx: number;
  pos: string;
  name: string;
  overall: number;
}

export interface PrematchLineupGroup {
  teamName: string;
  shortName: string;
  stadium: string;
  formation: FormationId;
  kitColor: string;
  players: PrematchLineupPlayer[];
}

export interface TacticalPitchPlayer extends SubstitutionRow {
  slotIdx: number;
  left: number;
  top: number;
  surname: string;
  energy: number;
  staminaCeiling: number;
}

export function buildTacticalPitchPlayers(
  rows: SubstitutionRow[],
  formation: FormationId,
  side: 'home' | 'away' = 'home',
  horizontal = false,
): TacticalPitchPlayer[] {
  const slots = FORMATIONS[formation] ?? FORMATIONS['4-4-2'];
  const xi = rows.slice(0, 11);
  const xs = xi.map((_, i) => (slots[i] ?? { x: 0, y: 0 }).x);
  const minX = Math.min(...xs);
  const xSpan = (Math.max(...xs) - minX) || 1;
  return xi.map((row, slotIdx) => {
    const slot = slots[slotIdx] ?? { x: 0, y: 0 };
    const norm = (slot.x - minX) / xSpan;
    // `along` runs goal-to-goal (keeper → strikers); `lateral` is side-to-side.
    // On a horizontal pitch `along` maps to X (keeper left), otherwise to Y.
    const along = clampPercent(side === 'home' ? 7 + norm * 86 : 93 - norm * 86, 7, 93);
    const lateral = clampPercent(50 + slot.y * 42, 7, 93);
    const energy = clampPercent(row.energy ?? 1, 0, 1);
    return {
      ...row,
      slotIdx,
      left: horizontal ? along : lateral,
      top: horizontal ? lateral : along,
      surname: row.name.split(' ').slice(-1)[0] || row.name,
      energy,
      staminaCeiling: clampPercent(row.staminaCeiling ?? energy, 0, 1),
    };
  });
}

function tacticalPitchHtml(
  rows: SubstitutionRow[],
  formation: FormationId,
  opts: { kitColor?: string; canPick?: boolean; selectedSquadIdx?: number; compact?: boolean; horizontal?: boolean } = {},
): string {
  const markers = buildTacticalPitchPlayers(rows, formation, 'home', opts.horizontal);
  const kitColor = opts.kitColor ?? '#36c24f';
  const pitchClass = `tactic-pitch${opts.compact ? ' tactic-pitch--compact' : ''}${opts.horizontal ? ' tactic-pitch--wide' : ''}`;
  return `<div class="${pitchClass}" data-formation="${formation}">
    <div class="tactic-field">
      ${markers.map((p) => {
        const label = opts.compact ? String(p.slotIdx + 1) : String(Math.round(p.overall));
        return `
        <button class="tactic-player pick-row${opts.selectedSquadIdx === p.squadIdx ? ' selected' : ''}" type="button"
          data-player="${p.playerIdx ?? ''}" data-squad="${p.squadIdx}" data-xi="true"
          data-pos="${escapeHtml(p.pos)}" data-name="${escapeHtml(p.name)}" data-overall="${p.overall}"
          style="left:${p.left.toFixed(1)}%;top:${p.top.toFixed(1)}%;--energy:${Math.round(p.energy * 100)}%;--condition:${Math.round(p.staminaCeiling * 100)}%;--kit:${escapeHtml(kitColor)}"
          ${opts.canPick === false ? 'disabled' : ''}>
          <span class="tactic-shirt"><span>${label}</span></span>
          <span class="tactic-name">${escapeHtml(p.surname)}</span>
          <span class="tactic-energy"><span></span></span>
        </button>`;
      }).join('')}
    </div>
  </div>`;
}

function squadButtonHtml(
  row: SubstitutionRow,
  opts: { disabled?: boolean; action?: string; xi?: boolean; queued?: 'off' | 'on' } = {},
): string {
  const energy = clampPercent(row.energy ?? 1, 0, 1);
  const condition = clampPercent(row.staminaCeiling ?? energy, 0, 1);
  const subBadge = row.subbedOn ? ' <span class="squad-sub-badge squad-sub-on" title="Subbed on" aria-label="Subbed on">↑ SUB</span>' : '';
  // The substitution screen shows an arrow ONLY on the players involved in a queued
  // (not-yet-made) sub — a bold red ↓ OFF on the man coming off, green ↑ IN on the man
  // coming on — and nothing on everyone else, so the list isn't a wall of OFF/ON.
  // Other screens (the lineup picker) still pass a plain `action` label (XI, etc.).
  const queuedClass = opts.queued === 'off' ? ' squad-card--queued-off' : opts.queued === 'on' ? ' squad-card--queued-on' : '';
  let actionHtml = '';
  if (opts.queued === 'off') actionHtml = '<span class="squad-action squad-action--off">↓ OFF</span>';
  else if (opts.queued === 'on') actionHtml = '<span class="squad-action squad-action--on">↑ IN</span>';
  else if (opts.action) {
    const label = opts.action === 'OFF' ? '↓ OFF' : opts.action === 'ON' ? '↑ ON' : opts.action;
    actionHtml = `<span class="squad-action${opts.action === 'OFF' ? ' squad-action--off' : ''}${opts.action === 'ON' ? ' squad-action--on' : ''}">${escapeHtml(label)}</span>`;
  }
  return `<button class="squad-card pick-row${row.subbedOn ? ' squad-card--subbed-on' : ''}${queuedClass}" type="button"
    data-player="${row.playerIdx ?? ''}" data-squad="${row.squadIdx}" data-xi="${opts.xi ? 'true' : 'false'}"
    data-pos="${escapeHtml(row.pos)}" data-name="${escapeHtml(row.name)}" data-overall="${row.overall}"
    style="--energy:${Math.round(energy * 100)}%;--condition:${Math.round(condition * 100)}%"
    ${opts.disabled ? 'disabled' : ''}>
    <span class="squad-pos">${escapeHtml(row.pos)}</span>
    <span class="squad-main">
      <span class="squad-name">${escapeHtml(row.name)}${(row.yellowCards ?? 0) > 0 ? ' <span class="squad-card-caution" title="On a yellow card" aria-label="On a yellow card">🟨</span>' : ''}${subBadge}</span>
      <span class="squad-energy"><span></span></span>
    </span>
    <span class="squad-ovr">${Math.round(row.overall)}</span>
    ${actionHtml}
  </button>`;
}

function bindSelectionTabs(root: HTMLElement, initialTab: SelectionTab, onChange?: (tab: SelectionTab) => void) {
  const setActive = (tab: SelectionTab) => {
    onChange?.(tab);
    root.querySelectorAll<HTMLElement>('[data-selection-tab]').forEach((button) => {
      const on = button.dataset.selectionTab === tab;
      button.classList.toggle('on', on);
      button.setAttribute('aria-selected', String(on));
    });
    root.querySelectorAll<HTMLElement>('[data-selection-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.selectionPanel !== tab;
    });
  };
  root.querySelectorAll<HTMLElement>('[data-selection-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const next = button.dataset.selectionTab as SelectionTab | undefined;
      if (next) setActive(next);
    });
  });
  setActive(initialTab);
}

function tacticsControlsHtml(tactics: TeamTactics): string {
  const mentality = [
    ['defensive', 'DEFENSIVE'],
    ['balanced', 'BALANCED'],
    ['attacking', 'ATTACKING'],
  ] as const;
  const pressing = [
    ['low', 'LOW PRESS'],
    ['mid', 'MID PRESS'],
    ['high', 'HIGH PRESS'],
  ] as const;
  const buildUp = [
    ['patient', 'PATIENT'],
    ['balanced', 'BALANCED'],
    ['direct', 'DIRECT'],
  ] as const;
  const segment = <T extends string>(field: keyof TeamTactics, value: T, options: readonly (readonly [T, string])[]) => `
    <div class="seg tactics-seg" data-tactics-seg="${field}">
      ${options.map(([v, label]) => `<button type="button" data-tactics-field="${field}" data-tactics-value="${v}" class="${value === v ? 'on' : ''}">${label}</button>`).join('')}
    </div>`;
  const slider = (field: 'width' | 'defensiveDepth', label: string, value: number) => `
    <label class="tactics-slider">
      <span>${label}</span>
      <input type="range" min="0" max="100" value="${value}" data-tactics-field="${field}" />
      <strong data-tactics-value-label="${field}">${value}</strong>
    </label>`;
  return `
    <div class="tactics-control-grid">
      <div class="tactics-control">
        <div class="squad-head"><span>MENTALITY</span></div>
        ${segment('mentality', tactics.mentality, mentality)}
      </div>
      <div class="tactics-control">
        <div class="squad-head"><span>PRESSING</span></div>
        ${segment('pressing', tactics.pressing, pressing)}
      </div>
      <div class="tactics-control">
        <div class="squad-head"><span>BUILD UP</span></div>
        ${segment('buildUp', tactics.buildUp, buildUp)}
      </div>
      <div class="tactics-control tactics-control--range">
        ${slider('width', 'WIDTH', tactics.width)}
        ${slider('defensiveDepth', 'DEFENSIVE DEPTH', tactics.defensiveDepth)}
      </div>
    </div>`;
}

function bindTacticsControls(root: HTMLElement, tactics: TeamTactics, onChange: (tactics: TeamTactics) => void) {
  root.querySelectorAll<HTMLElement>('[data-tactics-value]').forEach((button) => {
    button.addEventListener('click', () => {
      const field = button.dataset.tacticsField as keyof TeamTactics | undefined;
      const value = button.dataset.tacticsValue;
      if (!field || !value) return;
      const seg = button.closest<HTMLElement>('[data-tactics-seg]');
      seg?.querySelectorAll('button').forEach((sibling) => sibling.classList.toggle('on', sibling === button));
      seg?.scrollTo({ left: 0, behavior: 'smooth' });
      const next = { ...tactics, [field]: value } as TeamTactics;
      Object.assign(tactics, next);
      onChange(next);
    });
  });
  root.querySelectorAll<HTMLInputElement>('input[data-tactics-field]').forEach((input) => {
    input.addEventListener('input', () => {
      const field = input.dataset.tacticsField as 'width' | 'defensiveDepth' | undefined;
      if (!field) return;
      const value = parseInt(input.value, 10);
      const label = root.querySelector<HTMLElement>(`[data-tactics-value-label="${field}"]`);
      if (label) label.textContent = String(value);
      const next = { ...tactics, [field]: value };
      Object.assign(tactics, next);
      onChange(next);
    });
  });
}

/** Core menu screens. App wires callbacks; UI owns only DOM. */
export class UI {
  root: HTMLElement;
  /**
   * Random-rotation backdrop pool (the vibrant WC26 menu backdrops). When
   * non-empty, every read of `heroUrl`/`bgUrl` returns a random member, so the
   * general front-of-house menus pick a fresh backdrop each time they render.
   * Mode-specific screens (online/stars hubs, prematch, seasons) pass their own
   * dedicated background and so are unaffected.
   */
  menuBackdrops: string[] = [];
  private _heroUrl: string | undefined;
  private _bgUrl: string | undefined;
  get heroUrl(): string | undefined { return this.pickBackdrop() ?? this._heroUrl; }
  set heroUrl(v: string | undefined) { this._heroUrl = v; }
  get bgUrl(): string | undefined { return this.pickBackdrop() ?? this._bgUrl; }
  set bgUrl(v: string | undefined) { this._bgUrl = v; }
  private pickBackdrop(): string | undefined {
    const pool = this.menuBackdrops;
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : undefined;
  }
  onAnyClick: (() => void) | null = null; // for ui click sfx
  private nowPlayingEl: HTMLElement | null = null;
  private nowPlayingTimer: number | null = null;
  private menuActivationLockedUntil = 0;

  constructor() {
    this.root = document.getElementById('ui')!;
    this.root.addEventListener('click', (e) => {
      if (!shouldSuppressMenuActivation(this.nowMs(), this.menuActivationLockedUntil)) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }, { capture: true });
    this.root.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) this.onAnyClick?.();
    });
  }

  private nowMs(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  private lockMenuActivationAfterTitleStart() {
    this.menuActivationLockedUntil = Math.max(
      this.menuActivationLockedUntil,
      this.nowMs() + START_MENU_INPUT_GUARD_MS,
    );
  }

  show(on = true) {
    this.root.classList.toggle('active', on);
  }

  showNowPlaying(title: string | null) {
    if (!this.nowPlayingEl) {
      const el = document.createElement('div');
      el.className = 'now-playing';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      const icon = document.createElement('span');
      icon.className = 'now-playing-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = '&#9835;';
      const name = document.createElement('span');
      name.className = 'now-playing-title';
      el.append(icon, name);
      document.body.appendChild(el);
      this.nowPlayingEl = el;
    }

    const name = this.nowPlayingEl.querySelector<HTMLElement>('.now-playing-title');
    if (name) name.textContent = title ?? '';
    if (this.nowPlayingTimer) { clearTimeout(this.nowPlayingTimer); this.nowPlayingTimer = null; }
    if (title) {
      // briefly announce the track, then fade out so it never sits over the
      // gameplay/dialogue (especially on mobile)
      this.nowPlayingEl.classList.add('show');
      this.nowPlayingTimer = window.setTimeout(() => {
        this.nowPlayingEl?.classList.remove('show');
        this.nowPlayingTimer = null;
      }, 4500);
    } else {
      this.nowPlayingEl.classList.remove('show');
    }
  }

  private screen(inner: string, bg?: string): HTMLElement {
    this.root.innerHTML = `
      <div class="screen" ${bg ? `style="background-image:url('${bg}')"` : ''}>
        <div class="scrim"></div>
        ${inner}
      </div>`;
    this.show(true);
    return this.root.querySelector('.screen')!;
  }

  loading(): (msg: string, frac: number) => void {
    this.screen(`
      <div class="title-logo" style="margin-top:24vh">
        <div class="super" style="letter-spacing:0.15em; font-size:clamp(12px, 2vw, 20px);">INTERNATIONAL CUP</div>
        <div class="league" style="font-size:clamp(32px, 7vw, 80px);">FOOT<em>BALL</em> 2026</div>
      </div>
      <div class="notice" id="load-msg">Loading…</div>
      <div class="loading-bar"><div id="load-bar"></div></div>`);
    return (msg, frac) => {
      const m = document.getElementById('load-msg');
      const b = document.getElementById('load-bar');
      if (m) m.textContent = msg;
      if (b) b.style.width = `${Math.round(frac * 100)}%`;
    };
  }

  title(onStart: () => void) {
    const s = this.screen(`
      <div class="title-logo">
        <div class="super" style="letter-spacing:0.15em; font-size:clamp(14px, 2.2vw, 24px);">INTERNATIONAL CUP</div>
        <div class="league" style="font-size:clamp(40px, 8vw, 110px);">FOOT<em>BALL</em> 2026</div>
        <div class="season-tag">CLASSIC ARCADE FOOTBALL</div>
      </div>
      <div class="press-start">TAP TO PLAY</div>
      <div class="studio-credit">
        <span>a</span>
        <img src="./assets/ui/grayson_games_color.webp" alt="Grayson Games" />
        <span>production</span>
      </div>`, this.heroUrl);
    let started = false;
    const go = () => {
      if (started) return;
      started = true;
      cleanup();
      this.lockMenuActivationAfterTitleStart();
      onStart();
    };
    const startFromPointer = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      go();
    };
    const key = (e: KeyboardEvent) => { if (!e.repeat) go(); };
    const cleanup = () => window.removeEventListener('keydown', key);
    window.addEventListener('keydown', key);
    s.addEventListener('pointerdown', startFromPointer, { once: true });
  }

  mainMenu(opts: {
    hasSave: boolean;
    saveLabel: string;
    onExhibition: () => void;
    onCup: () => void;
    onManager: () => void;
    onPlayer: () => void;
    onCustomise: () => void;
    onChallenge: () => void;
    onStars: () => void;
    onJourney: () => void;
    onOnline: () => void;
    onContinue: () => void;
    onSettings: () => void;
    onSync: () => void;
    syncLabel: string;
  }) {
    this.screen(`
      <h1 class="h-screen">MAIN <span class="accent">MENU</span></h1>
      <div class="menu-col">
        ${opts.hasSave ? `<button class="btn primary" id="m-continue">CONTINUE — ${opts.saveLabel}<span class="arrow">▶</span></button>` : ''}
        <button class="btn" id="m-manager">MANAGER MODE <span class="arrow">▶</span></button>
        <button class="btn" id="m-player">PLAYER CAREER <span class="arrow">▶</span></button>
        <button class="btn" id="m-customise">CUSTOMISE <span class="arrow">▶</span></button>
        <button class="btn" id="m-exhibition">EXHIBITION <span class="arrow">▶</span></button>
        <button class="btn" id="m-cup">INTERNATIONAL CUP <span class="arrow">▶</span></button>
        <button class="btn" id="m-challenge">CHALLENGE MODE <span class="arrow">▶</span></button>
        <button class="btn" id="m-stars">ALL STAR CLUB <span class="arrow">▶</span></button>
        <button class="btn" id="m-online">ONLINE <span class="arrow">▶</span></button>
        <button class="btn" id="m-journey">${MAIN_MENU_JOURNEY_LABEL} <span class="arrow">▶</span></button>
        <button class="btn small" id="m-settings">SETTINGS</button>
        <button class="btn small" id="m-sync">${opts.syncLabel}</button>
      </div>
      <div class="studio-credit">
        <span>a</span>
        <img src="./assets/ui/grayson_games_color.webp" alt="Grayson Games" />
        <span>production</span>
      </div>`, this.heroUrl);
    bind('m-exhibition', opts.onExhibition);
    bind('m-manager', opts.onManager);
    bind('m-player', opts.onPlayer);
    bind('m-customise', opts.onCustomise);
    bind('m-cup', opts.onCup);
    bind('m-challenge', opts.onChallenge);
    bind('m-stars', opts.onStars);
    bind('m-online', opts.onOnline);
    bind('m-journey', opts.onJourney);
    bind('m-settings', opts.onSettings);
    bind('m-sync', opts.onSync);
    if (opts.hasSave) bind('m-continue', opts.onContinue);
  }

  challengeSelect(challenges: {
    id: string;
    title: string;
    description: string;
    objective: string;
    completed: boolean;
  }[], onPick: (id: string) => void, onBack: () => void) {
    const cards = challenges.map((c) => `
      <button class="team-card challenge-card ${c.completed ? 'completed' : ''}" data-id="${c.id}">
        <div class="ch-head">
          <div class="ch-title">${c.title}</div>
          <div class="ch-tag ${c.completed ? 'done' : ''}">${c.completed ? 'COMPLETED ✓' : 'CHALLENGE'}</div>
        </div>
        <div class="ch-desc">${c.description}</div>
        <div class="ch-obj">OBJECTIVE: ${c.objective}</div>
      </button>`).join('');

    this.screen(`
      <h1 class="h-screen">PICK A <span class="accent">CHALLENGE</span></h1>
      <div class="challenge-list">
        ${cards}
      </div>
      <div class="menu-col" style="margin-top: 12px; width: min(360px, 88vw)">
        <button class="btn" id="back">◀ BACK</button>
      </div>`, this.bgUrl);

    this.root.querySelectorAll<HTMLElement>('.challenge-card').forEach((el) => {
      el.addEventListener('click', () => onPick(el.dataset.id!));
    });
    bind('back', onBack);
  }

  challengeChronicle(opts: ChallengeChronicleHtmlOpts, callbacks: {
    onPlayChapter: (id: ChallengeChapterId) => void;
    onLeaderboard: () => void;
    onTopUp: () => void;
    onBack: () => void;
  }) {
    const chapter = opts.chapters[Math.max(0, Math.min(opts.currentIndex, Math.max(0, opts.chapters.length - 1)))];
    const bg = chapter?.backdropKey
      ? `${import.meta.env.BASE_URL}assets/journey/backgrounds/${chapter.backdropKey}.webp`
      : this.bgUrl;
    const screen = this.screen(challengeChronicleHtml(opts), bg);
    screen.classList.add('challenge-screen');
    this.root.querySelectorAll<HTMLElement>('[data-challenge-play]').forEach((button) => {
      button.addEventListener('click', () => callbacks.onPlayChapter(button.dataset.challengePlay as ChallengeChapterId));
    });
    bind('challenge-leaderboard', callbacks.onLeaderboard);
    bind('challenge-topup', callbacks.onTopUp);
    bind('challenge-back', callbacks.onBack);
  }

  /** pick a league; auto-skips when only one exists */
  leagueSelect(onPick: (league: LeagueDef) => void, onBack: () => void) {
    if (LEAGUES.length === 1) {
      onPick(LEAGUES[0]);
      return;
    }
    const cards = LEAGUES.map((l, i) => `
      <button class="team-card" data-i="${i}" style="text-align:center">
        <div class="tname">${l.name}</div>
        <div class="tmeta">${l.teams.length} ${l.id === 'international-cup' ? 'NATIONS' : 'CLUBS'}</div>
      </button>`).join('');
    this.screen(`
      <h1 class="h-screen">PICK A <span class="accent">LEAGUE</span></h1>
      <div class="team-grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">${cards}</div>
      <div class="menu-col" style="margin-top:14px; width:min(300px,80vw)">
        <button class="btn small" id="back">◀ BACK</button>
      </div>`, this.bgUrl);
    this.root.querySelectorAll<HTMLElement>('.team-card').forEach((el) => {
      el.addEventListener('click', () => onPick(LEAGUES[parseInt(el.dataset.i!, 10)]));
    });
    bind('back', onBack);
  }

  /** pick a cup mode (English Cup or International Cup) */
  cupSelect(onPick: (choice: 'english-premier' | 'international-cup') => void, onBack: () => void) {
    this.screen(`
      <h1 class="h-screen">PICK A <span class="accent">CUP</span></h1>
      <div class="team-grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">
        <button class="team-card" id="cup-english" style="text-align:center">
          <div class="tname">English Cup</div>
          <div class="tmeta">22 CLUBS · KNOCKOUT</div>
        </button>
        <button class="team-card" id="cup-international" style="text-align:center">
          <div class="tname">International Cup</div>
          <div class="tmeta">48 NATIONS · GROUPS & KNOCKOUT</div>
        </button>
      </div>
      <div class="menu-col" style="margin-top:14px; width:min(300px,80vw)">
        <button class="btn small" id="back">◀ BACK</button>
      </div>`, this.bgUrl);
    bind('cup-english', () => onPick('english-premier'));
    bind('cup-international', () => onPick('international-cup'));
    bind('back', onBack);
  }

  /** Pre-match controls reference, styled like the menus. Auto-detects the input
   * method (touch / controller / keyboard) and lets the player switch with tabs. */
  controlsScreen(opts: { bgUrl?: string; onContinue: () => void }) {
    type Scheme = 'keyboard' | 'controller' | 'touch';
    const SCHEMES: Record<Scheme, { label: string; rows: [string, string][] }> = {
      keyboard: {
        label: 'KEYBOARD',
        rows: [
          ['Move', 'Arrow keys / W A S D'],
          ['Pass', 'Z · K · Space — hold for a lofted ball'],
          ['Shoot', 'X · L — hold to build power'],
          ['Sprint', 'Shift / J'],
          ['Switch player', 'C · Tab · Q'],
          ['Aftertouch (curl)', 'steer with Move just after a shot'],
          ['Pause', 'Esc'],
        ],
      },
      controller: {
        label: 'CONTROLLER',
        rows: [
          ['Move', 'Left stick / D-pad'],
          ['Pass', 'A / ✕ — hold for a lofted ball'],
          ['Shoot', 'B / ◯ — hold to build power'],
          ['Sprint', 'RB / R1'],
          ['Switch player', 'LB / L1'],
          ['Aftertouch (curl)', 'steer with the stick just after a shot'],
          ['Pause', 'Start'],
        ],
      },
      touch: {
        label: 'TOUCH',
        rows: [
          ['Move', 'Left joystick'],
          ['Pass', 'PASS button — hold for a lofted ball'],
          ['Shoot', 'SHOOT button — hold to build power'],
          ['Sprint', 'SPRINT button'],
          ['Switch player', 'SWITCH button (off the ball)'],
          ['Aftertouch (curl)', 'drag the joystick just after a shot'],
          ['Pause', 'Pause button (top corner)'],
        ],
      },
    };
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const hasGamepad = Array.from(pads ?? []).some((p) => !!p);
    const isTouch = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)')?.matches;
    let scheme: Scheme = isTouch ? 'touch' : hasGamepad ? 'controller' : 'keyboard';
    const order: Scheme[] = ['keyboard', 'controller', 'touch'];
    const render = () => {
      const s = SCHEMES[scheme];
      this.screen(`
        <h1 class="h-screen">HOW TO <span class="accent">PLAY</span></h1>
        <div class="seg wrap" style="justify-content:center;margin:0 auto 14px;max-width:min(560px,92vw)">
          ${order.map((k) => `<button type="button" data-scheme="${k}" class="${k === scheme ? 'on' : ''}">${SCHEMES[k].label}</button>`).join('')}
        </div>
        <div class="panel" style="width:min(560px,92vw);margin:0 auto">
          ${s.rows.map(([a, b]) => `<div class="control-row" style="display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:8px 4px;border-bottom:1px solid rgba(255,255,255,0.08)">
            <span style="font-weight:700">${escapeHtml(a)}</span>
            <span class="subtle" style="text-align:right">${escapeHtml(b)}</span>
          </div>`).join('')}
        </div>
        <div class="menu-col" style="margin-top:16px">
          <button class="btn primary" id="controls-continue">CONTINUE <span class="arrow">▶</span></button>
        </div>`, opts.bgUrl ?? this.bgUrl);
      this.root.querySelectorAll<HTMLElement>('[data-scheme]').forEach((b) => {
        b.addEventListener('click', () => { scheme = b.dataset.scheme as Scheme; render(); });
      });
      bind('controls-continue', opts.onContinue);
    };
    render();
  }

  /** VS screen after both sides are chosen: pick which team YOU play */
  matchPreview(home: TeamData, away: TeamData, onPickSide: (side: 0 | 1) => void, onBack: () => void) {
    const card = (t: TeamData, label: string) => `
      <div class="panel" style="width:min(330px,42vw);text-align:center">
        <div class="subtle">${label}</div>
        <div class="kit-row" style="justify-content:center;display:flex;gap:6px;margin:10px 0">
          <div class="swatch" style="width:30px;height:36px;background:${t.colors.home.shirt};border-radius:5px 5px 9px 9px;border:1px solid rgba(255,255,255,0.25)"></div>
          <div class="swatch" style="width:30px;height:36px;background:${t.colors.home.shorts};border-radius:5px 5px 9px 9px;border:1px solid rgba(255,255,255,0.25)"></div>
          <div class="swatch" style="width:30px;height:36px;background:${t.colors.home.socks};border-radius:5px 5px 9px 9px;border:1px solid rgba(255,255,255,0.25)"></div>
        </div>
        <div style="font-size:26px;font-weight:800">${t.name.toUpperCase()}</div>
        <div class="tmeta subtle">${t.stadium}</div>
        <div class="stars" style="margin-top:6px">${stars(t.strength)}</div>
      </div>`;
    this.screen(`
      <h1 class="h-screen">MATCH <span class="accent">UP</span></h1>
      <div class="row" style="gap:22px;align-items:center">
        ${card(home, 'HOME')}
        <div style="font-size:42px;font-weight:800;font-style:italic" class="accent-vs">VS</div>
        ${card(away, 'AWAY')}
      </div>
      <div class="menu-col" style="margin-top:18px">
        <button class="btn primary" id="vs-home">PLAY AS ${home.short} (HOME) <span class="arrow">▶</span></button>
        <button class="btn primary" id="vs-away">PLAY AS ${away.short} (AWAY) <span class="arrow">▶</span></button>
        <button class="btn small" id="back">◀ CHANGE TEAMS</button>
      </div>`, this.bgUrl);
    bind('vs-home', () => onPickSide(0));
    bind('vs-away', () => onPickSide(1));
    bind('back', onBack);
  }

  teamSelect(title: string, onPick: (teamIdx: number) => void, onBack: () => void, excludeIdx = -1) {
    const cards = TEAMS.map((t, i) => i === excludeIdx ? '' : `
      <button class="team-card team-card--select" data-i="${i}">
        <div class="team-card-top">
          <div class="kit-row">
            <div class="swatch shirt" style="background:${t.colors.home.shirt}"></div>
            <div class="swatch shorts" style="background:${t.colors.home.shorts}"></div>
            <div class="swatch away" style="background:${t.colors.away.shirt}"></div>
          </div>
          <div class="team-rating">${stars(t.strength)}</div>
        </div>
        <div class="tname">${t.name}</div>
        <div class="team-card-foot">
          <span>${t.short}</span>
          <span>${t.stadium}</span>
        </div>
      </button>`).join('');
    this.screen(`
      <h1 class="h-screen">${title}</h1>
      <div class="team-select-shell">
        <div class="team-grid team-grid--select">${cards}</div>
      </div>
      <div class="menu-col team-select-actions" style="margin-top:14px; width:min(300px,80vw)">
        <button class="btn small" id="back">◀ BACK</button>
      </div>`, this.bgUrl);
    this.root.querySelectorAll<HTMLElement>('.team-card').forEach((el) => {
      el.addEventListener('click', () => onPick(parseInt(el.dataset.i!, 10)));
    });
    bind('back', onBack);
  }

  managerName(opts: {
    teamName: string;
    defaultName: string;
    onConfirm: (name: string) => void;
    onBack: () => void;
  }) {
    const teamName = escapeHtml(opts.teamName);
    this.screen(`
      <h1 class="h-screen">YOUR <span class="accent">MANAGER NAME</span></h1>
      <div class="panel" style="width:min(520px,90vw);text-align:left">
        <div class="subtle" style="margin-bottom:6px">${teamName} MANAGER</div>
        <input
          class="txt"
          id="manager-name"
          type="text"
          maxlength="32"
          value="${escapeHtml(opts.defaultName)}"
          placeholder="Manager name"
          autocomplete="name"
        />
        <div class="subtle" style="margin-top:10px">The dressing room, federation and back pages all need a name.</div>
      </div>
      <div class="menu-col" style="margin-top:14px; width:min(360px,86vw)">
        <button class="btn primary" id="manager-confirm">CONTINUE <span class="arrow">▶</span></button>
        <button class="btn small" id="manager-back">◀ BACK</button>
      </div>`, this.bgUrl);

    const input = this.root.querySelector<HTMLInputElement>('#manager-name');
    const submit = () => opts.onConfirm(input?.value ?? opts.defaultName);
    bind('manager-confirm', submit);
    bind('manager-back', opts.onBack);
    input?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      submit();
    });
    window.setTimeout(() => input?.focus(), 0);
  }

  /**
   * Pre-cup tournament editor: shows the twelve groups and lets the user swap
   * any nation for another from the full pool before kicking off. Calls
   * onStart with the final groups (team ids, A–L).
   */
  tournamentEditor(opts: {
    allTeams: TeamData[];
    initialGroups: string[][];
    defaultGroups: string[][];
    onStart: (groups: string[][]) => void;
    onBack: () => void;
  }) {
    const groups = opts.initialGroups.map((g) => [...g]);
    const byId = (id: string) => opts.allTeams.find((t) => t.id === id);
    const letters = 'ABCDEFGHIJKL';

    const renderEditor = () => {
      const groupCards = groups.map((g, gi) => `
        <div class="grp-card">
          <div class="grp-title">GROUP ${letters[gi] ?? gi + 1}</div>
          ${g.map((id, ti) => {
            const t = byId(id);
            return `<button class="grp-team" data-g="${gi}" data-t="${ti}">
              <span class="grp-swatch" style="background:${t?.colors.home.shirt ?? '#888'}"></span>
              <span class="grp-name">${t?.name ?? id}</span>
              <span class="grp-swap">⇄</span>
            </button>`;
          }).join('')}
        </div>`).join('');
      this.screen(`
        <h1 class="h-screen">EDIT THE <span class="accent">TOURNAMENT</span></h1>
        <p class="editor-sub">Tap a nation to swap it for any other. The cup runs with these 48.</p>
        <div class="grp-grid">${groupCards}</div>
        <div class="menu-col" style="margin-top:16px; width:min(360px,86vw)">
          <button class="btn" id="start">START TOURNAMENT <span class="arrow">▶</span></button>
          <button class="btn small" id="reset">↺ RESET TO REAL DRAW</button>
          <button class="btn small" id="back">◀ BACK</button>
        </div>`, this.bgUrl);
      this.root.querySelectorAll<HTMLElement>('.grp-team').forEach((el) => {
        el.addEventListener('click', () => openSwap(parseInt(el.dataset.g!, 10), parseInt(el.dataset.t!, 10)));
      });
      bind('start', () => opts.onStart(groups.map((g) => [...g])));
      bind('reset', () => { groups.splice(0, groups.length, ...opts.defaultGroups.map((g) => [...g])); renderEditor(); });
      bind('back', opts.onBack);
    };

    const openSwap = (gi: number, ti: number) => {
      const current = groups[gi][ti];
      const inField = new Set(groups.flat());
      inField.delete(current); // the team being replaced is itself selectable
      const available = opts.allTeams
        .filter((t) => !inField.has(t.id))
        .sort((a, b) => a.name.localeCompare(b.name));
      const cards = available.map((t) => `
        <button class="team-card" data-id="${t.id}">
          <div class="kit-row">
            <div class="swatch" style="background:${t.colors.home.shirt}"></div>
            <div class="swatch" style="background:${t.colors.home.shorts}"></div>
            <div class="swatch" style="background:${t.colors.away.shirt}"></div>
          </div>
          <div class="tname">${t.name}${t.id === current ? ' <span class="accent">●</span>' : ''}</div>
          <div class="tmeta">${t.stadium}</div>
          <div class="stars">${stars(t.strength)}</div>
        </button>`).join('');
      this.screen(`
        <h1 class="h-screen">GROUP ${letters[gi] ?? gi + 1}: SWAP IN A <span class="accent">NATION</span></h1>
        <div class="team-grid">${cards}</div>
        <div class="menu-col" style="margin-top:14px; width:min(300px,80vw)">
          <button class="btn small" id="back">◀ BACK</button>
        </div>`, this.bgUrl);
      this.root.querySelectorAll<HTMLElement>('.team-card').forEach((el) => {
        el.addEventListener('click', () => { groups[gi][ti] = el.dataset.id!; renderEditor(); });
      });
      bind('back', renderEditor);
    };

    renderEditor();
  }

  lineupSelect(opts: {
    title: string;
    team: TeamData;
    players?: PlayerAttrs[];
    initial?: Lineup;
    unavailableSquadIndexes?: number[];
    onConfirm: (lineup: Lineup) => void;
    onBack: () => void;
  }) {
    const players = opts.players ?? opts.team.players;
    const initial = opts.initial ?? teamDefaultLineup({ ...opts.team, players });
    const unavailable = new Set(opts.unavailableSquadIndexes ?? []);
    let formation: FormationId = initial.formation;
    let starters = sanitizeLineup(players, initial).filter((i) => !unavailable.has(i));
    if (starters.length < 11) starters = autoLineupAvailable(players, formation, unavailable);
    let tactics = normalizeTactics(initial.tactics, formation);
    let activeTab: SelectionTab = 'team';
    const render = () => {
      const bench = players.map((_, i) => i).filter((i) => !starters.includes(i));
      const starterRows: SubstitutionRow[] = starters.map((i) => {
        const p = players[i];
        return { squadIdx: i, pos: p.pos, name: p.name, overall: overallRating(p), energy: 1, staminaCeiling: 1 };
      });
      const benchRows: SubstitutionRow[] = bench.map((i) => {
        const p = players[i];
        return { squadIdx: i, pos: p.pos, name: p.name, overall: overallRating(p), energy: 1, staminaCeiling: 1 };
      });
      this.screen(`
        <h1 class="h-screen">${opts.title}</h1>
        <div class="selection-shell lineup-selection-shell">
          <div class="selection-topline">
            <div>
              <div class="tag">${opts.team.name.toUpperCase()}</div>
              <div class="tactics-title">${formation}</div>
            </div>
            <div class="selection-tabs" role="tablist" aria-label="Lineup setup">
              <button type="button" role="tab" data-selection-tab="team">TEAM SELECTION</button>
              <button type="button" role="tab" data-selection-tab="formation">FORMATION</button>
              <button type="button" role="tab" data-selection-tab="tactics">TACTICS</button>
            </div>
          </div>
          <div class="selection-tab-panel lineup-team-panel" data-selection-panel="team" role="tabpanel">
            <div class="lineup-roster-layout">
              <div class="squad-panel squad-panel--roster">
                <div class="squad-head">
                  <span>STARTING XI</span>
                  <span>${starterRows.length}</span>
                </div>
                <div class="squad-list">
                  ${starterRows.map((r) => squadButtonHtml(r, { xi: true, action: 'XI' })).join('')}
                </div>
              </div>
              <div class="squad-panel squad-panel--roster">
                <div class="squad-head">
                  <span>BENCH / RESERVES</span>
                  <span>${benchRows.length}</span>
                </div>
                <div class="squad-list">
                  ${benchRows.map((r) => squadButtonHtml(r, unavailable.has(r.squadIdx) ? { disabled: true, action: 'OUT NEXT MATCH' } : {})).join('')}
                </div>
              </div>
            </div>
          </div>
          <div class="selection-tab-panel lineup-formation-panel" data-selection-panel="formation" role="tabpanel" hidden>
            <div class="formation-tab-layout">
              <div class="formation-tab-head">
                <div class="tag">SHAPE</div>
                <div class="seg wrap formation-seg" id="formations">
                  ${FORMATION_IDS.map((f) => `<button data-f="${f}" class="${formation === f ? 'on' : ''}">${f}</button>`).join('')}
                </div>
              </div>
              <div class="formation-preview-board">
                ${tacticalPitchHtml(starterRows, formation, { kitColor: opts.team.colors.home.shirt, canPick: false, compact: true, horizontal: true })}
              </div>
            </div>
          </div>
          <div class="selection-tab-panel lineup-tactics-panel" data-selection-panel="tactics" role="tabpanel" hidden>
            <div class="tactics-tab-layout">
              <div class="formation-preview-board">
                ${tacticalPitchHtml(starterRows, formation, { kitColor: opts.team.colors.home.shirt, canPick: false, compact: true, horizontal: true })}
              </div>
              <div class="tactics-panel">
                <div class="squad-head"><span>TACTICS</span><span>${formation}</span></div>
                ${tacticsControlsHtml(tactics)}
              </div>
            </div>
          </div>
          <div class="tactics-scroll-cue" aria-hidden="true"></div>
        </div>
        <div class="selection-actions">
          <button class="btn primary" id="lineup-continue">CONTINUE <span class="arrow">▶</span></button>
          <button class="btn small" id="lineup-auto">AUTO PICK</button>
          <button class="btn small" id="back">◀ BACK</button>
        </div>`, this.bgUrl);

      bindSelectionTabs(this.root, activeTab, (tab) => { activeTab = tab; });
      document.getElementById('formations')!.querySelectorAll('button').forEach((b) => {
        b.addEventListener('click', () => {
          formation = (b as HTMLElement).dataset.f as FormationId;
          starters = autoLineupAvailable(players, formation, unavailable);
          tactics = formationDefaultTactics(formation);
          activeTab = 'formation';
          render();
        });
      });
      bindTacticsControls(this.root, tactics, (next) => {
        tactics = normalizeTactics(next, formation);
        activeTab = 'tactics';
        render();
      });
      bind('lineup-auto', () => { starters = autoLineupAvailable(players, formation, unavailable); tactics = formationDefaultTactics(formation); render(); });
      bind('lineup-continue', () => opts.onConfirm({ formation, starters: [...starters], tactics: normalizeTactics(tactics, formation) }));
      bind('back', opts.onBack);

      let selected: { i: number; xi: boolean; el: HTMLElement } | null = null;
      this.root.querySelectorAll<HTMLElement>('.pick-row').forEach((tr) => {
        tr.addEventListener('click', () => {
          const i = parseInt(tr.dataset.squad!, 10);
          if (unavailable.has(i)) return;
          const xi = tr.dataset.xi === 'true';
          if (!selected) {
            selected = { i, xi, el: tr };
            tr.classList.add('selected');
            return;
          }
          if (selected.xi !== xi) {
            const starterIdx = selected.xi ? starters.indexOf(selected.i) : starters.indexOf(i);
            const benchIdx = selected.xi ? i : selected.i;
            if (starterIdx >= 0 && positionCompatible(players[starters[starterIdx]], players[benchIdx])) {
              starters[starterIdx] = benchIdx;
            }
          } else if (xi && selected.i !== i) {
            // two on-pitch players: switch their formation positions. Slot 0 is the
            // keeper and stays in goal, so only outfield slots (>0) are swapped.
            const a = starters.indexOf(selected.i);
            const b = starters.indexOf(i);
            if (a > 0 && b > 0) { const t = starters[a]; starters[a] = starters[b]; starters[b] = t; }
          }
          selected = null;
          render();
        });
      });
    };
    render();
  }

  prematchLineups(opts: {
    cfg: MatchConfig;
    bgUrl?: string;
    onSkip: () => void;
  }) {
    const groups = buildPrematchLineupGroups(opts.cfg);
    const clamp01 = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    // black or white text, whichever reads on the kit colour
    const inkOn = (hex: string) => {
      const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
      if (!m) return '#fff';
      const n = parseInt(m[1], 16);
      const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
      return lum > 0.62 ? '#0b1420' : '#fff';
    };

    // On a short/landscape screen a vertical pitch is height-bound (a thin strip
    // on a wide screen), so lay the pitch out HORIZONTALLY there — keeper at the
    // LEFT for home (builds right), at the RIGHT for away (builds left) — which
    // fills the width and makes the board far larger. Vertical elsewhere.
    const horizontal = typeof window !== 'undefined'
      && !!window.matchMedia?.('(max-height: 600px)')?.matches;

    // one team's XI laid out in its formation. Markers slide in from their own end.
    const pitch = (group: PrematchLineupGroup, idx: number) => {
      const isHome = idx === 0;
      const slots = FORMATIONS[group.formation] ?? FORMATIONS['4-4-2'];
      const ink = inkOn(group.kitColor);
      // stretch the team's depth so it fills the WHOLE pitch: keeper on his own
      // line, forwards up near the opposition goal (rather than bunched in their
      // own half). Normalise each side's slot.x range across [6%, 94%].
      const xs = group.players.map((_, i) => (slots[i] ?? { x: 0, y: 0 }).x);
      const minX = Math.min(...xs);
      const xSpan = (Math.max(...xs) - minX) || 1;
      const markers = group.players.map((player, i) => {
        const slot = slots[i] ?? { x: 0, y: 0 };
        const norm = (slot.x - minX) / xSpan;            // 0 = deepest .. 1 = most advanced
        const along = isHome ? 6 + norm * 88 : 94 - norm * 88; // attacking direction
        const wide = clamp01(50 + slot.y * 42, 7, 93);   // y: -1 left .. +1 right
        const top = horizontal ? wide : clamp01(along, 6, 94);
        const left = horizontal ? clamp01(along, 6, 94) : wide;
        const surname = (player.name.split(' ').slice(-1)[0] || player.name);
        return `<div class="fm-player" style="left:${left.toFixed(1)}%; top:${top.toFixed(1)}%; animation-delay:${(i * 0.07).toFixed(2)}s">
          <span class="fm-dot" style="background:${escapeHtml(group.kitColor)}; color:${ink}">${i + 1}</span>
          <span class="fm-name">${escapeHtml(surname)}</span>
        </div>`;
      }).join('');
      return `<div class="formation-pitch ${isHome ? 'home' : 'away'}${isHome ? ' active' : ''}${horizontal ? ' horizontal' : ''}" data-team="${idx}">
        <div class="formation-head">
          <span class="prematch-kit" style="background:${escapeHtml(group.kitColor)}"></span>
          <span class="fm-team">${escapeHtml(group.teamName)}</span>
          <span class="fm-meta">${escapeHtml(group.formation)} · ${isHome ? 'HOME' : 'AWAY'}</span>
        </div>
        <div class="formation-field">${markers}</div>
      </div>`;
    };

    const screen = this.screen(`
      <div class="prematch-shell">
        <img class="prematch-logo" src="./assets/ui/grayson_sports.webp" alt="Grayson Sports" />
        <h1 class="h-screen prematch-title">${escapeHtml(groups[0]?.shortName ?? '')} <span class="accent">VS</span> ${escapeHtml(groups[1]?.shortName ?? '')}</h1>
        <div class="prematch-venue">${escapeHtml(opts.cfg.stadiumName ?? groups[0]?.stadium ?? '')}</div>
        <div class="formation-stage${horizontal ? ' horizontal-stage' : ''}">
          ${groups.map((group, idx) => pitch(group, idx)).join('')}
        </div>
        <div class="prematch-dots">
          ${groups.map((_, idx) => `<span class="prematch-dot${idx === 0 ? ' active' : ''}"></span>`).join('')}
        </div>
      </div>`, opts.bgUrl ?? this.bgUrl);

    // reveal a team's shape. Visibility is CSS-driven (the markers are visible at
    // rest and the slide-in is a self-running animation on `.active`), so this just
    // flips which pitch is shown — no fragile JS/rAF class toggling that could
    // leave the board blank if a frame is dropped on a busy mobile main thread.
    const reveal = (active: number) => {
      const pitches = this.root.querySelectorAll<HTMLElement>('.formation-pitch');
      pitches.forEach((p, i) => p.classList.toggle('active', i === active));
      this.root.querySelectorAll<HTMLElement>('.prematch-dot').forEach((d, i) => d.classList.toggle('active', i === active));
    };
    reveal(0); // home first (keeper at top, builds down)

    // show home for a beat, then switch to away ONCE and hold it there until
    // kick-off — it must not roll back round to the home team again
    const toAway = window.setTimeout(() => reveal(1), 4500);
    // no skip button — tap anywhere to kick off early
    screen.addEventListener('click', () => { clearTimeout(toAway); opts.onSkip(); });
  }

  substitutionMenu(opts: SubstitutionMenuOpts) {
    let selectedOff: SubstitutionRow | null = null;
    let selectedOn: SubstitutionRow | null = null;
    // subs can now be SET any time (they're applied at the next stoppage), so the
    // only gate is whether substitutions remain. Position swaps are always allowed.
    const canSub = opts.used < opts.max;
    const canSwap = !!opts.onSwap;
    const queued = opts.queued ?? [];
    // queued (not yet made) subs are shown as arrows on the players themselves —
    // a red ↓ OFF on the man coming off, a green ↑ IN on the man coming on
    const queuedOff = new Set(queued.map((q) => q.offPlayerIdx));
    const queuedOn = new Set(queued.map((q) => q.onSquadIdx));
    const formations = opts.formations ?? FORMATION_IDS;
    let activeTab = opts.initialTab ?? 'team';
    let pendingTactics = normalizeTactics(opts.tactics, opts.formation);
    this.screen(`
      <h1 class="h-screen">SUBSTITUTIONS</h1>
      <div class="selection-shell pause-selection-shell">
        <div class="selection-topline">
          <div>
            <div class="tag">${opts.teamName.toUpperCase()} · ${substitutionUsageLabel(opts.used, opts.max)}</div>
            <div class="tactics-title">${opts.formation}</div>
          </div>
          <div class="selection-tabs" role="tablist" aria-label="Pause team setup">
            <button type="button" role="tab" data-selection-tab="team">TEAM SELECTION</button>
            <button type="button" role="tab" data-selection-tab="formation">FORMATION</button>
            <button type="button" role="tab" data-selection-tab="tactics">TACTICS</button>
          </div>
        </div>
      ${opts.onlinePauseSeconds !== undefined ? `
      <div class="panel" style="text-align:center;margin-bottom:10px;padding:8px 12px">
        <span class="pause-clock" id="pause-timer" style="font-size:24px">${Math.floor(opts.onlinePauseSeconds / 60)}:${(opts.onlinePauseSeconds % 60).toString().padStart(2, '0')}</span>
        <span class="subtle" id="pause-status" style="margin-left:10px">Play resumes when both managers are ready.</span>
      </div>` : ''}
        <div class="selection-tab-panel pause-team-panel" data-selection-panel="team" role="tabpanel">
          <div class="lineup-roster-layout">
            <div class="squad-panel squad-panel--roster">
              <div class="squad-head">
                <span>ON THE PITCH</span>
                <span>${opts.starters.length}</span>
              </div>
              <div class="squad-list">
                ${opts.starters.map((r) => {
                  const isQueuedOff = r.playerIdx !== undefined && queuedOff.has(r.playerIdx);
                  return squadButtonHtml(r, { xi: true, disabled: !canSub && !isQueuedOff, queued: isQueuedOff ? 'off' : undefined });
                }).join('')}
              </div>
            </div>
            <div class="squad-panel squad-panel--roster">
              <div class="squad-head">
                <span>BENCH</span>
                <span>${opts.bench.length}</span>
              </div>
              <div class="squad-list">
                ${opts.bench.map((r) => {
                  const isQueuedOn = queuedOn.has(r.squadIdx);
                  return squadButtonHtml(r, { disabled: !canSub && !isQueuedOn, queued: isQueuedOn ? 'on' : undefined });
                }).join('')}
              </div>
            </div>
          </div>
        </div>
        <div class="selection-tab-panel pause-formation-panel" data-selection-panel="formation" role="tabpanel" hidden>
          <div class="formation-tab-layout">
            <div class="formation-tab-head">
              <div>
                <div class="tag">MATCH SHAPE</div>
                <div class="tactics-title">${opts.formation}</div>
              </div>
              <div class="seg wrap formation-seg" id="match-formations">
                ${formations.map((f) => `<button data-f="${f}" class="${opts.formation === f ? 'on' : ''}">${f}</button>`).join('')}
              </div>
            </div>
            <div class="formation-preview-board">
              ${tacticalPitchHtml(opts.starters, opts.formation, { canPick: false, compact: true })}
            </div>
          </div>
        </div>
        <div class="selection-tab-panel pause-tactics-panel" data-selection-panel="tactics" role="tabpanel" hidden>
          <div class="tactics-tab-layout">
            <div class="formation-preview-board">
              ${tacticalPitchHtml(opts.starters, opts.formation, { canPick: false, compact: true })}
            </div>
            <div class="tactics-panel">
              <div class="squad-head"><span>MATCH TACTICS</span><span>${opts.formation}</span></div>
              ${tacticsControlsHtml(pendingTactics)}
              <button class="btn primary tactics-apply" id="apply-tactics">APPLY TACTICS</button>
            </div>
          </div>
        </div>
        <div class="tactics-scroll-cue" aria-hidden="true"></div>
      </div>
      <div class="selection-actions selection-actions--pause">
        <button class="btn small" id="back">◀ PAUSE MENU</button>
      </div>`, this.bgUrl);
    bindSelectionTabs(this.root, activeTab, (tab) => { activeTab = tab; });
    bind('back', opts.onBack);
    document.getElementById('match-formations')?.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        const next = (b as HTMLElement).dataset.f as FormationId;
        if (next && next !== opts.formation) opts.onFormationChange?.(next);
      });
    });
    bindTacticsControls(this.root, pendingTactics, (next) => {
      pendingTactics = normalizeTactics(next, opts.formation);
      activeTab = 'tactics';
    });
    bind('apply-tactics', () => opts.onTacticsChange?.(normalizeTactics(pendingTactics, opts.formation)));
    const clearSelection = () => {
      selectedOff = null;
      selectedOn = null;
      this.root.querySelectorAll<HTMLElement>('.pick-row, .squad-card, .tactic-player').forEach((r) => r.classList.remove('selected', 'armed', 'selected-off', 'selected-on'));
    };
    this.root.querySelectorAll<HTMLElement>('.pick-row').forEach((tr) => {
      tr.addEventListener('click', () => {
        const xi = tr.dataset.xi === 'true';
        const rowData = rowFromPickElement(tr);
        // tapping either end of a queued sub cancels it (the arrows replace the old
        // UNDO buttons)
        if (xi && rowData.playerIdx !== undefined && queuedOff.has(rowData.playerIdx)) {
          opts.onCancelQueued?.(rowData.playerIdx); return;
        }
        if (!xi) {
          const q = queued.find((entry) => entry.onSquadIdx === rowData.squadIdx);
          if (q) { opts.onCancelQueued?.(q.offPlayerIdx); return; }
        }
        // click the already-selected player again to cancel a wrong pick
        if (xi && selectedOff?.playerIdx === rowData.playerIdx) { clearSelection(); return; }
        if (!xi && selectedOn?.squadIdx === rowData.squadIdx) { clearSelection(); return; }
        if (xi) {
          // on-pitch player. With a bench player armed -> substitution; with another
          // on-pitch player armed -> position swap; otherwise arm this one.
          if (selectedOn && rowData.playerIdx !== undefined && canSub) {
            opts.onSub(rowData.playerIdx, selectedOn.squadIdx);
            return;
          }
          if (selectedOff && selectedOff.playerIdx !== undefined && rowData.playerIdx !== undefined && canSwap) {
            opts.onSwap?.(selectedOff.playerIdx, rowData.playerIdx);
            return;
          }
          if (!canSub && !canSwap) return;
          selectedOff = rowData;
          selectedOn = null;
          this.root.querySelectorAll<HTMLElement>('.pick-row').forEach((r) => r.classList.remove('selected', 'armed', 'selected-off', 'selected-on'));
          tr.classList.add('selected', 'selected-off');
          this.root.querySelectorAll<HTMLElement>('.squad-card').forEach((r) => r.classList.add('armed'));
          return;
        }
        // bench player
        if (!canSub) return;
        if (selectedOff?.playerIdx !== undefined) {
          opts.onSub(selectedOff.playerIdx, rowData.squadIdx);
          return;
        }
        selectedOn = rowData;
        selectedOff = null;
        this.root.querySelectorAll<HTMLElement>('.pick-row').forEach((r) => r.classList.remove('selected', 'armed', 'selected-off', 'selected-on'));
        tr.classList.add('selected', 'selected-on');
        this.root.querySelectorAll<HTMLElement>('.tactic-player').forEach((r) => r.classList.add('armed'));
      });
    });
  }

  settings(s: Settings, onChange: (s: Settings) => void, onBack: () => void) {
    const halves = [{ v: 90, l: '1.5 MIN' }, { v: 150, l: '2.5 MIN' }, { v: 240, l: '4 MIN' }, { v: 360, l: '6 MIN' }];
    this.screen(`
      <h1 class="h-screen">SETTINGS</h1>
      <div class="panel" style="display:flex;flex-direction:column;gap:20px">
        <div class="row spread"><span>HALF LENGTH</span>
          <div class="seg" id="s-half">${halves.map((h) => `<button data-v="${h.v}" class="${s.halfLengthSec === h.v ? 'on' : ''}">${h.l}</button>`).join('')}</div>
        </div>
        <div class="row spread"><span>MUSIC</span>
          <div class="seg" id="s-music">${[0, 0.4, 0.7, 1].map((v) => `<button data-v="${v}" class="${Math.abs(s.musicVol - v) < 0.01 ? 'on' : ''}">${v === 0 ? 'OFF' : Math.round(v * 100) + '%'}</button>`).join('')}</div>
        </div>
        <div class="row spread"><span>SOUND FX</span>
          <div class="seg" id="s-sfx">${[0, 0.5, 0.9].map((v) => `<button data-v="${v}" class="${Math.abs(s.sfxVol - v) < 0.01 ? 'on' : ''}">${v === 0 ? 'OFF' : Math.round(v * 100) + '%'}</button>`).join('')}</div>
        </div>
        <div class="subtle">CONTROLS — MOVE: arrows / WASD / left stick · TAP PASS: Z, K, A-button · LONG BALL: hold pass · SHOOT: X, L, B-button (hold for power, steer after kick for swerve) · SWITCH: C / Tab / LB · SPRINT: Shift / RB · SLIDE: shoot button without ball</div>
      </div>
      <div class="menu-col" style="margin-top:16px; width:min(300px,80vw)">
        <button class="btn small" id="back">◀ BACK</button>
      </div>`, this.bgUrl);
    const seg = (id: string, apply: (v: number) => void) => {
      const el = document.getElementById(id)!;
      el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        el.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        apply(parseFloat((b as HTMLElement).dataset.v!));
      }));
    };
    seg('s-half', (v) => { s.halfLengthSec = v; onChange(s); });
    seg('s-music', (v) => { s.musicVol = v; onChange(s); });
    seg('s-sfx', (v) => { s.sfxVol = v; onChange(s); });
    bind('back', onBack);
  }

  result(opts: {
    teamA: TeamData; teamB: TeamData; score: [number, number];
    note?: string; onContinue: () => void; continueLabel?: string;
  }) {
    this.screen(`
      <h1 class="h-screen">FULL <span class="accent">TIME</span></h1>
      <div class="result-teams">${opts.teamA.name.toUpperCase()} vs ${opts.teamB.name.toUpperCase()}</div>
      <div class="result-score">${opts.score[0]} – ${opts.score[1]}</div>
      ${opts.note ? `<div class="notice">${opts.note}</div>` : ''}
      <div class="menu-col">
        <button class="btn primary" id="cont">${opts.continueLabel ?? 'CONTINUE'} <span class="arrow">▶</span></button>
      </div>`, this.bgUrl);
    bind('cont', opts.onContinue);
  }

  finale(title: string, lines: string[], onDone: () => void) {
    this.screen(`
      <h1 class="h-screen">${title}</h1>
      <div class="panel" style="text-align:center; font-size:20px; line-height:1.7">
        ${lines.map((l) => `<div>${l}</div>`).join('')}
      </div>
      <div class="menu-col" style="margin-top:16px">
        <button class="btn primary" id="done">MAIN MENU <span class="arrow">▶</span></button>
      </div>`, this.heroUrl);
    bind('done', onDone);
  }

  onlineLobby(opts: {
    onHost: () => void;
    onJoin: (code: string) => void;
    onBack: () => void;
  }) {
    this.screen(`
      <h1 class="h-screen">ONLINE <span class="accent">VS</span></h1>
      <div class="panel" style="display:flex;flex-direction:column;gap:18px;align-items:center">
        <button class="btn primary" id="host" style="width:100%">HOST A MATCH <span class="arrow">▶</span></button>
        <div class="subtle">— or join a friend —</div>
        <div class="row">
          <input class="txt" id="code" maxlength="5" placeholder="CODE" autocomplete="off" />
          <button class="btn" id="join">JOIN</button>
        </div>
        <div class="notice" id="net-status"></div>
      </div>
      <div class="menu-col" style="margin-top:16px; width:min(300px,80vw)">
        <button class="btn small" id="back">◀ BACK</button>
      </div>`, this.bgUrl);
    bind('host', opts.onHost);
    bind('back', opts.onBack);
    bind('join', () => {
      const code = (document.getElementById('code') as HTMLInputElement).value.trim().toUpperCase();
      if (code.length >= 4) opts.onJoin(code);
      else this.netStatus('Enter the 5-letter room code');
    });
  }

  hostWaiting(code: string, onCancel: () => void) {
    this.screen(`
      <h1 class="h-screen">HOSTING</h1>
      <div class="panel" style="text-align:center">
        <div class="subtle">SHARE THIS ROOM CODE</div>
        <div class="result-score" style="letter-spacing:0.3em">${code}</div>
        <div class="notice" id="net-status">Waiting for opponent…</div>
      </div>
      <div class="menu-col" style="margin-top:16px; width:min(300px,80vw)">
        <button class="btn small danger" id="back">CANCEL</button>
      </div>`, this.bgUrl);
    bind('back', onCancel);
  }

  matchSearching(msg: string, onCancel: () => void) {
    this.screen(`
      <h1 class="h-screen">FINDING <span class="accent">MATCH</span></h1>
      <div class="panel" style="text-align:center;display:flex;flex-direction:column;gap:14px;align-items:center">
        <div class="spinner" aria-hidden="true"></div>
        <div class="notice" id="net-status">${msg}</div>
      </div>
      <div class="menu-col" style="margin-top:16px; width:min(300px,80vw)">
        <button class="btn small danger" id="back">CANCEL</button>
      </div>`, this.bgUrl);
    bind('back', onCancel);
  }

  /** Choose whether to bring your custom Stars club or a national team online. */
  onlineTeamChoice(opts: {
    title: string;
    canUseClub: boolean;
    clubName?: string;
    onClub: () => void;
    onNation: () => void;
    onBack: () => void;
  }) {
    this.screen(`
      <h1 class="h-screen">${opts.title}</h1>
      <div class="menu-col" style="width:min(420px,86vw)">
        <button class="btn primary" id="oc-club"${opts.canUseClub ? '' : ' disabled'}>YOUR CLUB${opts.clubName ? ` · ${opts.clubName.toUpperCase()}` : ''} <span class="arrow">▶</span></button>
        ${opts.canUseClub ? '' : '<div class="subtle" style="text-align:center;margin:2px 0">Build a full XI in INTERNATIONAL CUP STARS to bring your club online.</div>'}
        <button class="btn" id="oc-nation">NATIONAL TEAM <span class="arrow">▶</span></button>
        <button class="btn small" id="oc-back">◀ BACK</button>
      </div>`, this.bgUrl);
    bind('oc-club', opts.onClub);
    bind('oc-nation', opts.onNation);
    bind('oc-back', opts.onBack);
  }

  netStatus(msg: string) {
    const el = document.getElementById('net-status');
    if (el) el.textContent = msg;
  }

  pauseMenu(view: PauseMenuView) {
    const online = view.online;
    this.screen(`
      <h1 class="h-screen" style="margin-top:16vh">${online ? 'MATCH PAUSED' : 'PAUSED'}</h1>
      ${online ? `
      <div class="panel" id="pause-online" style="text-align:center;margin-bottom:14px;max-width:420px">
        <div class="pause-clock" id="pause-timer">0:40</div>
        <div class="subtle" id="pause-status">Both managers must resume — or play restarts automatically.</div>
      </div>` : ''}
      <div class="menu-col">
        <button class="btn primary" id="resume">${online ? 'RESUME' : 'RESUME'} <span class="arrow">▶</span></button>
        ${view.onSubstitutions ? '<button class="btn" id="subs">SUBSTITUTIONS <span class="arrow">▶</span></button>' : ''}
        <button class="btn danger" id="quit">${online ? 'QUIT (FORFEIT)' : 'QUIT MATCH'}</button>
      </div>`);
    bind('resume', view.onResume);
    if (view.onSubstitutions) bind('subs', view.onSubstitutions);
    bind('quit', view.onQuit);
  }

  /** Live-update the online pause countdown + ready state (null hides it). */
  updatePauseStatus(status: PauseStatusView | null) {
    const timer = document.getElementById('pause-timer');
    const statusEl = document.getElementById('pause-status');
    const resume = document.getElementById('resume') as HTMLButtonElement | null;
    if (!timer || !status) return;
    const m = Math.floor(status.seconds / 60);
    const s = status.seconds % 60;
    timer.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    if (resume) {
      resume.disabled = status.youReady;
      resume.innerHTML = status.youReady
        ? 'READY ✓'
        : 'RESUME <span class="arrow">▶</span>';
    }
    if (statusEl) {
      statusEl.textContent = status.youReady
        ? 'Waiting for your opponent to resume…'
        : 'Both managers must resume — or play restarts automatically.';
    }
  }
}

export function bind(id: string, fn: () => void) {
  document.getElementById(id)?.addEventListener('click', fn);
}

export interface ChallengeChronicleHtmlOpts {
  chapters: ChallengeChapter[];
  currentIndex: number;
  completedIds: ChallengeChapterId[];
  completedCount: number;
  leaderboardPoints: number;
  arcadeTokens: number;
  runActive?: boolean;
}

export function challengeChronicleHtml(opts: ChallengeChronicleHtmlOpts): string {
  const chapters = opts.chapters.length ? opts.chapters : [];
  const currentIndex = Math.max(0, Math.min(opts.currentIndex, Math.max(0, chapters.length - 1)));
  const c = chapters[currentIndex];
  if (!c) return '';
  const previous = currentIndex > 0 ? chapters[currentIndex - 1] : null;
  const next = currentIndex < chapters.length - 1 ? chapters[currentIndex + 1] : null;
  const completed = new Set(opts.completedIds);
  const hasArcadeToken = opts.arcadeTokens > 0;
  const runActive = opts.runActive === true;
  const ladderCard = (
    chapter: ChallengeChapter,
    index: number,
    state: 'completed' | 'current' | 'locked',
  ) => {
    const isCurrent = state === 'current';
    const isCompleted = state === 'completed' || completed.has(chapter.id);
    const isPlayable = state !== 'locked' && (isCompleted || runActive || hasArcadeToken);
    const stateLabel = state === 'completed'
      ? 'REPLAY CLEARED YEAR'
      : state === 'current'
        ? 'CURRENT YEAR'
        : 'NEXT YEAR LOCKED';
    const playLabel = state === 'completed' ? 'REPLAY' : 'CLEAR THIS YEAR';
    const side = chapter.playerTeam === 0 ? chapter.home.short : chapter.away.short;
    return `
        <div class="challenge-ladder-card challenge-ladder-card--${state}" data-challenge-state="${state}">
          <div class="challenge-ladder-line" aria-hidden="true"></div>
          <div class="challenge-ladder-head">
            <span class="challenge-node">${state === 'completed' || completed.has(chapter.id) ? 'OK' : index + 1}</span>
            <span class="challenge-card-kicker">${stateLabel}</span>
            <span class="challenge-card-year">${chapter.year}</span>
          </div>
          <div class="challenge-card-title">${escapeHtml(chapter.title)}</div>
          <div class="challenge-card-match">${escapeHtml(chapter.sourceTeams.join(' vs '))}</div>
          ${isCurrent ? `
          <div class="challenge-current-grid">
            <div class="challenge-story">${escapeHtml(chapter.storySetup)}</div>
            <div class="challenge-objective">
              <span>OBJECTIVE</span>
              <strong>${escapeHtml(chapter.objectiveText)}</strong>
            </div>
          </div>
          <div class="challenge-match-strip">
            <span>${escapeHtml(side)} TO PLAY</span>
            <span>${chapter.startScore[0]}-${chapter.startScore[1]}</span>
            <span>${challengeStartLabel(chapter)}</span>
          </div>` : ''}
          <div class="challenge-card-foot">
            <span>${state === 'locked' ? 'Beat the current year to unlock' : isCompleted ? 'REPLAY READY' : runActive ? 'RUN ACTIVE' : hasArcadeToken ? 'TOKEN READY' : 'INSERT TOKEN'}</span>
            ${isPlayable
              ? `<button class="btn ${isCurrent ? 'primary' : 'small'} challenge-play-btn" ${isCurrent ? 'id="challenge-play"' : ''} data-challenge-play="${chapter.id}">${playLabel} <span class="arrow">▶</span></button>`
              : `<span class="challenge-lock">${state === 'locked' ? 'LOCKED' : 'NEED TOKEN'}</span>`}
          </div>
        </div>`;
  };
  return `
      <h1 class="h-screen">CHALLENGE <span class="accent">CHRONICLE</span></h1>
      <div class="challenge-arcade-shell challenge-screen-lock">
        <div class="challenge-score-strip">
          <div><span>YEAR RUN</span><strong>${currentIndex + 1} / ${chapters.length}</strong></div>
          <div><span>CLEARED</span><strong>${opts.completedCount}</strong></div>
          <div><span>TOKENS</span><strong>${Math.max(0, opts.arcadeTokens)}</strong></div>
          <div><span>SCORE</span><strong>${opts.leaderboardPoints.toLocaleString()}</strong></div>
        </div>
        <div class="challenge-timeline-scroll">
          <div class="challenge-year-ladder">
            ${previous ? ladderCard(previous, currentIndex - 1, 'completed') : '<div class="challenge-ladder-card challenge-ladder-card--intro" data-challenge-state="intro"><div class="challenge-card-kicker">INSERT COIN</div><div class="challenge-card-title">Start the world football timeline</div><div class="challenge-card-match">Clear each year to unlock the next.</div></div>'}
            ${ladderCard(c, currentIndex, 'current')}
            ${next ? ladderCard(next, currentIndex + 1, 'locked') : '<div class="challenge-ladder-card challenge-ladder-card--locked" data-challenge-state="complete"><div class="challenge-card-kicker">FINAL YEAR</div><div class="challenge-card-title">Run complete</div><div class="challenge-card-match">Replay any cleared chapter and chase a bigger score.</div></div>'}
          </div>
        </div>
      </div>
      <div class="menu-col" style="margin-top:16px; width:min(420px,88vw)">
        <button class="btn" id="challenge-leaderboard">LEADERBOARD <span class="arrow">▶</span></button>
        <button class="btn challenge-topup-btn" id="challenge-topup">TOP UP TOKENS <span class="arrow">▶</span></button>
        <button class="btn small" id="challenge-back">◀ BACK</button>
      </div>`;
}

function challengeStartLabel(chapter: ChallengeChapter): string {
  const span = chapter.startHalf <= 2 ? 45 : 15;
  const base = chapter.startHalf === 1 ? 0 : chapter.startHalf === 2 ? 45 : chapter.startHalf === 3 ? 90 : 105;
  const minute = Math.floor(base + (chapter.startTimeSec / 120) * span);
  const half = chapter.startHalf === 1 ? '1ST' : chapter.startHalf === 2 ? '2ND' : chapter.startHalf === 3 ? 'ET1' : 'ET2';
  return `${half} ${minute}'`;
}

export function buildPrematchLineupGroups(cfg: MatchConfig): PrematchLineupGroup[] {
  return cfg.teams.map((team) => ({
    teamName: team.data.name,
    shortName: team.data.short,
    stadium: team.data.stadium,
    formation: team.lineup.formation,
    kitColor: team.kit.shirt,
    players: team.lineup.starters.slice(0, 11).map((squadIdx) => {
      const player = team.data.players[squadIdx];
      return {
        squadIdx,
        pos: player?.pos ?? '',
        name: player?.name ?? 'Unknown',
        overall: player ? overallRating(player) : 0,
      };
    }),
  }));
}

export function stars(strength: number): string {
  const n = Math.round(((strength - 50) / 45) * 5);
  return '★'.repeat(Math.max(1, Math.min(5, n))) + '☆'.repeat(5 - Math.max(1, Math.min(5, n)));
}

function clampPercent(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function rowFromPickElement(el: HTMLElement): SubstitutionRow {
  const playerIdxRaw = el.dataset.player;
  return {
    playerIdx: playerIdxRaw ? parseInt(playerIdxRaw, 10) : undefined,
    squadIdx: parseInt(el.dataset.squad ?? '-1', 10),
    pos: el.dataset.pos ?? '',
    name: el.dataset.name ?? '',
    overall: parseFloat(el.dataset.overall ?? '0'),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeLineup(players: PlayerAttrs[], lineup: Lineup): number[] {
  const normalized = normalizeLineupForFormation(players, lineup.formation, lineup.starters);
  return normalized.length === 11 ? normalized : autoLineup(players, lineup.formation);
}

function autoLineupAvailable(players: PlayerAttrs[], formation: FormationId, unavailable: Set<number>): number[] {
  const available = players.map((player, idx) => ({ player, idx })).filter(({ idx }) => !unavailable.has(idx));
  if (available.length >= 11) {
    const picked = autoLineup(available.map(({ player }) => player), formation).map((idx) => available[idx].idx);
    if (picked.length >= 11) return picked.slice(0, 11);
  }
  return autoLineup(players, formation);
}

function positionCompatible(off: PlayerAttrs, on: PlayerAttrs): boolean {
  return (off.pos === 'GK') === (on.pos === 'GK');
}
