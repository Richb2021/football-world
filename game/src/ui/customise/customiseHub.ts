/**
 * Football World — CUSTOMISATION MODE UI. Create and edit custom teams and nations
 * (leagues with promotion/relegation + cups), and export/import them to share.
 * Custom nations appear in Manager and Player Career mode's nation select.
 */
import type { UI } from '../screens';
import { bind } from '../screens';
import { esc } from '../stars/components';
import { showPrompt, showConfirm } from '../modal';
import type { TeamData, KitPattern } from '../../sim/types';
import { customTeams, saveCustomTeam, deleteCustomTeam, anyTeamById, CLUBS } from '../../data/teams';
import { TEAMS } from '../../data/teams';
import { allNations, saveCustomNation, deleteCustomNation, exportNationJSON, importNationJSON, isBuiltInNation, type NationDef, type NationTier } from '../../data/nations';
import { generateTeam, customTeamId } from '../../data/clubs/generate';

function uiScreen(ui: UI, inner: string, bg?: string): void {
  (ui as unknown as { screen: (inner: string, bg?: string) => HTMLElement }).screen(inner, bg ?? ui.bgUrl);
}

/** Every team a custom nation can draw on: nations + built-in clubs + customs. */
function allPickableTeams(): TeamData[] {
  const seen = new Set<string>();
  const out: TeamData[] = [];
  for (const t of [...TEAMS, ...CLUBS, ...customTeams()]) {
    if (t?.id && !seen.has(t.id)) { seen.add(t.id); out.push(t); }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const PATTERNS: KitPattern[] = ['solid', 'stripes', 'hoops', 'halves', 'sash', 'sleeves'];

// ----------------------------------------------------------------- hub

export function customiseHub(ui: UI, nav: {
  onCreateTeam: () => void;
  onCustomTeams: () => void;
  onCreateNation: () => void;
  onCustomNations: () => void;
  onExport: () => void;
  onImport: () => void;
  onBack: () => void;
}): void {
  uiScreen(ui, `
    <h1 class="h-screen">CUSTOMISE <span class="accent">YOUR WORLD</span></h1>
    <div class="notice">Build teams, leagues and entire football worlds. Custom nations appear in Manager & Player Career — and can be exported to share.</div>
    <div class="menu-col">
      <button class="btn primary" id="c-team">CREATE TEAM <span class="arrow">▶</span></button>
      <button class="btn" id="c-teams">MY CUSTOM TEAMS (${customTeams().length})</button>
      <button class="btn" id="c-nation">CREATE NATION / LEAGUE</button>
      <button class="btn" id="c-nations">MY CUSTOM NATIONS (${allNations().filter((n) => n.custom).length})</button>
      <button class="btn small" id="c-export">EXPORT / SHARE</button>
      <button class="btn small" id="c-import">IMPORT</button>
      <button class="btn small" id="c-back">◀ BACK</button>
    </div>`);
  bind('c-team', nav.onCreateTeam);
  bind('c-teams', nav.onCustomTeams);
  bind('c-nation', nav.onCreateNation);
  bind('c-nations', nav.onCustomNations);
  bind('c-export', nav.onExport);
  bind('c-import', nav.onImport);
  bind('c-back', nav.onBack);
}

// ----------------------------------------------------------------- teams

export async function createTeamScreen(ui: UI, onDone: () => void, onBack: () => void): Promise<void> {
  const name = await showPrompt({ title: 'TEAM NAME', value: 'New Town', confirmLabel: 'CREATE' });
  if (!name || !name.trim()) { onBack(); return; }
  const strength = parseInt(await showPrompt({ title: 'TEAM STRENGTH (30-95)', value: '68', confirmLabel: 'SET' }) ?? '68', 10) || 68;
  const team = generateTeam({
    id: customTeamId(name),
    name: name.trim(),
    short: name.trim().slice(0, 3).toUpperCase(),
    stadium: `${name.trim().split(' ')[0]} Park`,
    strength: Math.max(30, Math.min(95, strength)),
    primary: '#1a5fb4',
    secondary: '#ffffff',
    pattern: 'stripes',
  });
  saveCustomTeam(team);
  uiScreen(ui, `
    <h1 class="h-screen">TEAM <span class="accent">CREATED</span></h1>
    <div class="panel" style="text-align:center">
      <div style="font-size:22px;font-weight:800">${esc(team.name)}</div>
      <div class="subtle">Strength ${team.strength} · ${team.players.length} players generated</div>
      <div class="notice" style="margin-top:8px">Find it in MY CUSTOM TEAMS to tweak colours, regenerate the squad, or use it in a custom nation.</div>
    </div>
    <div class="menu-col" style="margin-top:12px">
      <button class="btn primary" id="t-more">CREATE ANOTHER ▶</button>
      <button class="btn small" id="t-list">MY CUSTOM TEAMS</button>
      <button class="btn small" id="t-back">◀ BACK</button>
    </div>`);
  bind('t-more', onDone);
  bind('t-list', onBack);
  bind('t-back', onBack);
}

export function customTeamsScreen(ui: UI, onBack: () => void): void {
  const render = () => {
    const teams = customTeams();
    const rows = teams.map((t) => `<tr>
        <td style="text-align:left">${esc(t.name)}</td>
        <td class="num">${t.strength}</td>
        <td class="num">${t.players.length}</td>
        <td class="row" style="gap:4px;justify-content:flex-end">
          <button class="btn small" data-regen="${t.id}">REGEN</button>
          <button class="btn small" data-colour="${t.id}">KIT</button>
          <button class="btn small danger" data-del="${t.id}">DEL</button>
        </td>
      </tr>`).join('');
    uiScreen(ui, `
      <h1 class="h-screen">MY CUSTOM <span class="accent">TEAMS</span></h1>
      <div class="panel"><table class="tbl"><tr><th style="text-align:left">TEAM</th><th>STR</th><th>SQUAD</th><th></th></tr>${rows || '<tr><td colspan="4" class="subtle">No custom teams yet.</td></tr>'}</table></div>
      <div class="menu-col" style="margin-top:10px"><button class="btn small" id="back">◀ BACK</button></div>`);
    ui.root.querySelectorAll<HTMLElement>('[data-regen]').forEach((b) => b.addEventListener('click', () => {
      const t = customTeams().find((x) => x.id === b.dataset.regen)!;
      t.players = generateTeam({ id: t.id, name: t.name, short: t.short, stadium: t.stadium, strength: t.strength, primary: t.colors.home.shirt, secondary: t.colors.home.style?.secondary ?? '#fff', pattern: t.colors.home.style?.pattern ?? 'solid' }).players;
      t.defaultLineup = { formation: '4-2-3-1', starters: t.players.slice(0, 11).map((_, i) => i) };
      saveCustomTeam(t); render();
    }));
    ui.root.querySelectorAll<HTMLElement>('[data-colour]').forEach((b) => b.addEventListener('click', async () => {
      const t = customTeams().find((x) => x.id === b.dataset.colour)!;
      const hex = await showPrompt({ title: `${t.name} HOME SHIRT (hex)`, value: t.colors.home.shirt, confirmLabel: 'SET' });
      if (hex) { t.colors.home.shirt = hex.trim(); saveCustomTeam(t); render(); }
    }));
    ui.root.querySelectorAll<HTMLElement>('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await showConfirm({ title: 'DELETE TEAM?', message: 'This cannot be undone.', confirmLabel: 'DELETE', danger: true });
      if (ok) { deleteCustomTeam(b.dataset.del!); render(); }
    }));
    bind('back', onBack);
  };
  render();
}

// ----------------------------------------------------------------- nations

export function customNationsScreen(ui: UI, onBack: () => void): void {
  const render = () => {
    const customs = allNations().filter((n) => n.custom);
    const cards = customs.map((n) => `<div class="notice" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <span><b>${esc(n.name)}</b> · ${n.type === 'pyramid' ? `${n.tiers?.length ?? 0} tiers` : 'single tier'}</span>
        <button class="btn small danger" data-del="${n.id}">DELETE</button>
      </div>`).join('');
    uiScreen(ui, `
      <h1 class="h-screen">MY CUSTOM <span class="accent">NATIONS</span></h1>
      <div class="menu-col">${cards || '<div class="notice">No custom nations yet — create one to play your own football world.</div>'}</div>
      <div class="notice">Custom nations are selectable in Manager and Player Career mode.</div>
      <div class="menu-col" style="margin-top:10px"><button class="btn small" id="back">◀ BACK</button></div>`);
    ui.root.querySelectorAll<HTMLElement>('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await showConfirm({ title: 'DELETE NATION?', confirmLabel: 'DELETE', danger: true });
      if (ok) { deleteCustomNation(b.dataset.del!); render(); }
    }));
    bind('back', onBack);
  };
  render();
}

/**
 * Nation builder. Holds a draft in `draft` (managed by the caller) and re-renders
 * on every change. Tiers are built by toggling teams on/off per tier.
 */
export interface NationDraft {
  name: string;
  type: 'pyramid' | 'single';
  tiers: { name: string; teamIds: string[] }[];
  promotion: number;
  relegation: number;
}

export function nationBuilderScreen(
  ui: UI,
  draft: NationDraft,
  pool: TeamData[],
  onChange: () => void,
  onSave: () => void,
  onBack: () => void,
): void {
  const tierRows = draft.tiers.map((tier, ti) => {
    const picked = tier.teamIds.map((id) => `<span class="tag">${esc(anyTeamById(id)?.short ?? id)}</span>`).join(' ') || '<span class="subtle">no teams yet</span>';
    return `<div class="panel">
      <div class="row spread">
        <b>Tier ${ti + 1}</b>
        ${draft.tiers.length > 1 ? `<button class="btn small danger" data-rmtier="${ti}">REMOVE TIER</button>` : ''}
      </div>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin:6px 0">${picked}</div>
      <button class="btn small" data-pick="${ti}">PICK TEAMS…</button>
    </div>`;
  }).join('');

  uiScreen(ui, `
    <h1 class="h-screen">BUILD A <span class="accent">NATION</span></h1>
    <div class="row spread" style="margin-bottom:8px">
      <span class="tag">${esc(draft.name.toUpperCase())}</span>
      <span class="tag">${draft.type === 'pyramid' ? 'PYRAMID' : 'SINGLE TIER'}</span>
    </div>
    ${draft.type === 'pyramid' ? `<div class="row" style="gap:6px;margin-bottom:8px">
        <span class="subtle">PROMOTE</span><button class="btn small" data-prom="-1">−</button><span class="tag">${draft.promotion}</span><button class="btn small" data-prom="1">+</button>
        <span class="subtle">RELEGATE</span><button class="btn small" data-rel="-1">−</button><span class="tag">${draft.relegation}</span><button class="btn small" data-rel="1">+</button>
      </div>` : ''}
    ${tierRows}
    <div class="menu-col" style="margin-top:10px">
      ${draft.type === 'pyramid' ? '<button class="btn small" id="add-tier">+ ADD TIER</button>' : ''}
      <button class="btn primary" id="save">SAVE NATION ▶</button>
      <button class="btn small" id="back">◀ BACK</button>
    </div>`);

  ui.root.querySelectorAll<HTMLElement>('[data-pick]').forEach((b) => b.addEventListener('click', () => {
    const ti = parseInt(b.dataset.pick!, 10);
    teamPickerScreen(ui, draft.tiers[ti].teamIds, pool, (sel) => { draft.tiers[ti].teamIds = sel; onChange(); }, () => onChange());
  }));
  ui.root.querySelectorAll<HTMLElement>('[data-rmtier]').forEach((b) => b.addEventListener('click', () => {
    draft.tiers.splice(parseInt(b.dataset.rmtier!, 10), 1); onChange();
  }));
  ui.root.querySelectorAll<HTMLElement>('[data-prom]').forEach((b) => b.addEventListener('click', () => {
    draft.promotion = Math.max(0, Math.min(6, draft.promotion + parseInt(b.dataset.prom!, 10))); onChange();
  }));
  ui.root.querySelectorAll<HTMLElement>('[data-rel]').forEach((b) => b.addEventListener('click', () => {
    draft.relegation = Math.max(0, Math.min(6, draft.relegation + parseInt(b.dataset.rel!, 10))); onChange();
  }));
  const addTier = document.getElementById('add-tier');
  addTier?.addEventListener('click', () => { draft.tiers.push({ name: `Tier ${draft.tiers.length + 1}`, teamIds: [] }); onChange(); });
  bind('save', onSave);
  bind('back', onBack);
}

/** Multi-select team picker for one tier. `selected` is the live list; toggling mutates via onSel. */
export function teamPickerScreen(
  ui: UI,
  selected: string[],
  pool: TeamData[],
  onSel: (sel: string[]) => void,
  onDone: () => void,
): void {
  const render = () => {
    const rows = pool.map((t) => {
      const on = selected.includes(t.id);
      return `<tr data-toggle="${t.id}" class="pick-row ${on ? 'you' : ''}" style="cursor:pointer">
        <td>${on ? '✓' : ''}</td><td style="text-align:left">${esc(t.name)}</td><td class="num">${t.strength}</td>
      </tr>`;
    }).join('');
    uiScreen(ui, `
      <h1 class="h-screen">PICK <span class="accent">TEAMS</span></h1>
      <div class="subtle">${selected.length} selected</div>
      <div class="panel" style="max-height:55vh;overflow-y:auto"><table class="tbl"><tr><th></th><th style="text-align:left">TEAM</th><th>STR</th></tr>${rows}</table></div>
      <div class="menu-col" style="margin-top:10px"><button class="btn primary" id="done">DONE (${selected.length}) ▶</button></div>`);
    ui.root.querySelectorAll<HTMLElement>('[data-toggle]').forEach((tr) => tr.addEventListener('click', () => {
      const id = tr.dataset.toggle!;
      const i = selected.indexOf(id);
      if (i >= 0) selected.splice(i, 1); else selected.push(id);
      onSel(selected); render();
    }));
    bind('done', onDone);
  };
  render();
}

// ----------------------------------------------------------------- export / import

export function exportScreen(ui: UI, onBack: () => void): void {
  const nations = allNations();
  const render = () => {
    const rows = nations.map((n) => `<tr data-export="${n.id}" class="pick-row" style="cursor:pointer">
        <td style="text-align:left">${esc(n.name)}</td><td>${n.custom ? 'CUSTOM' : 'BUILT-IN'}</td><td>${n.type}</td>
      </tr>`).join('');
    uiScreen(ui, `
      <h1 class="h-screen">EXPORT <span class="accent">/ SHARE</span></h1>
      <div class="notice">Pick a nation to generate a shareable code. Copy it to share; a friend pastes it into IMPORT.</div>
      <div class="panel"><table class="tbl"><tr><th style="text-align:left">NATION</th><th>KIND</th><th>TYPE</th></tr>${rows}</table></div>
      <div class="menu-col" style="margin-top:10px"><button class="btn small" id="back">◀ BACK</button></div>`);
    ui.root.querySelectorAll<HTMLElement>('[data-export]').forEach((tr) => tr.addEventListener('click', () => {
      const json = exportNationJSON(tr.dataset.export!);
      uiScreen(ui, `
        <h1 class="h-screen">SHARE <span class="accent">CODE</span></h1>
        <div class="panel"><textarea class="txt" style="height:42vh;font-size:11px" readonly>${esc(json)}</textarea></div>
        <div class="notice">Copy this text. Import it on another device via IMPORT.</div>
        <div class="menu-col" style="margin-top:10px"><button class="btn small" id="back">◀ BACK</button></div>`);
      bind('back', () => render());
    }));
    bind('back', onBack);
  };
  render();
}

export function importScreen(ui: UI, onImported: () => void, onBack: () => void): void {
  uiScreen(ui, `
    <h1 class="h-screen">IMPORT <span class="accent">NATION</span></h1>
    <div class="notice">Paste a Football World nation share code below.</div>
    <div class="panel"><textarea id="imp" class="txt" style="height:40vh;font-size:11px" placeholder='{ "id": "...", "name": "...", ... }'></textarea></div>
    <div class="menu-col" style="margin-top:10px">
      <button class="btn primary" id="imp-go">IMPORT ▶</button>
      <button class="btn small" id="back">◀ BACK</button>
    </div>`);
  bind('imp-go', () => {
    const raw = (document.getElementById('imp') as HTMLTextAreaElement | null)?.value ?? '';
    try {
      importNationJSON(raw);
      onImported();
    } catch {
      uiScreen(ui, `<h1 class="h-screen">IMPORT <span class="accent">FAILED</span></h1>
        <div class="panel">That wasn't a valid Football World nation code.</div>
        <div class="menu-col" style="margin-top:10px"><button class="btn small" id="back">◀ BACK</button></div>`);
      bind('back', () => importScreen(ui, onImported, onBack));
    }
  });
  bind('back', onBack);
}

/** Build a NationDef from a draft + save it as a custom nation. Returns true on success. */
export function saveNationFromDraft(draft: NationDraft): boolean {
  const nation: NationDef = draft.type === 'pyramid'
    ? {
        id: `custom-${draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
        name: draft.name, type: 'pyramid',
        tiers: draft.tiers
          .map((t, i): NationTier => ({ tier: i + 1, leagueId: `custom-${draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}-${i + 1}`, name: t.name || `Tier ${i + 1}`, teamIds: t.teamIds }))
          .filter((t) => t.teamIds.length >= 2),
        promotion: draft.promotion, relegation: draft.relegation, playoffs: false,
        cups: [{ id: 'custom-cup', name: `${draft.name} Cup`, format: 'knockout', entries: 'whole-nation' }],
        custom: true,
      }
    : {
        id: `custom-${draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
        name: draft.name, type: 'single',
        teamPool: draft.tiers[0]?.teamIds ?? [],
        cups: [{ id: 'custom-cup', name: `${draft.name} Cup`, format: 'groups-then-knockout', entries: 'whole-nation' }],
        custom: true,
      };
  if (nation.type === 'pyramid' && (!nation.tiers || nation.tiers.length === 0)) return false;
  if (nation.type === 'single' && (nation.teamPool?.length ?? 0) < 2) return false;
  saveCustomNation(nation);
  return true;
}

export { allPickableTeams, isBuiltInNation };
export type { NationDef };
