// Squad builder for the International Cup Stars Ultimate-Team mode. Lets the
// player pick a formation, fill the 11 starter slots from their owned cards,
// and read back squad rating + chemistry. Matches the broadcast UI look by
// reusing the shared .player-card / .chem-meter / .squad-rating styles.
import type { UI } from '../screens';
import type { PlayerCard, Rarity } from '../../data/cards';
import type { StarsState } from '../../game/stars/types';
import { setSquad, starsCardById } from '../../game/stars/store';
import { quickSell } from '../../game/stars/economy';
import { squadRating } from '../../game/stars/squad';
import { squadChemistry } from '../../game/stars/chemistry';
import { FORMATION_IDS, FORMATION_NEEDS } from '../../sim/formations';
import type { FormationId } from '../../sim/types';
import {
  render,
  esc,
  playerCardHtml,
  emptyCardHtml,
  segHtml,
  sortCards,
  RARITY_FILTER_OPTS,
  CARD_SORT_OPTS,
  type RarityFilter,
  type CardSortKey,
  STARS_BG,
} from './components';

/** The 11 slot positions for a formation (index 0 = GK). */
function slotPositions(formation: FormationId): string[] {
  return ['GK', ...FORMATION_NEEDS[formation]];
}

export function squadBuilder(
  ui: UI,
  opts: { state: StarsState; commit: () => void; onBack: () => void },
): void {
  const { state } = opts;

  // Picker filter/sort state — reset each time a slot is opened.
  let pSearch = '';
  let pRarity: RarityFilter = 'all';
  let pSort: CardSortKey = 'rating';

  /** Live name search over the rendered picker grid (no re-render → keeps focus). */
  const applyPickerSearch = (): void => {
    const q = pSearch.trim().toLowerCase();
    let visible = 0;
    ui.root.querySelectorAll<HTMLElement>('.card-grid .player-card').forEach((el) => {
      const name = el.getAttribute('data-name') ?? '';
      const show = !q || name.includes(q);
      el.classList.toggle('is-hidden', !show);
      if (show) visible++;
    });
    const empty = ui.root.querySelector<HTMLElement>('#sb-empty');
    if (empty) empty.classList.toggle('is-hidden', visible > 0);
  };

  /** Resolve current starter ids to PlayerCard|null. */
  const resolveStarters = (): (PlayerCard | null)[] =>
    state.squad.starters.map((id) => (id ? (starsCardById(state, id) ?? null) : null));

  /** Persist a starters array under a (possibly new) formation, then commit. */
  const save = (formation: FormationId, starters: (string | null)[]): void => {
    setSquad(state, { formation, starters });
    opts.commit();
  };

  // -------------------------------------------------------------------------
  // Formation change: remap existing starters to the new slot layout.
  // Keep a card where its pos already matches the new slot at that index;
  // otherwise re-home kept cards greedily into the first free matching slot.
  // Any card that can't be placed is dropped. No card appears twice.
  // -------------------------------------------------------------------------
  const remapFormation = (next: FormationId): void => {
    const cur = state.squad.starters;
    const curPos = slotPositions(state.squad.formation);
    const nextPos = slotPositions(next);
    const out: (string | null)[] = new Array(11).fill(null);
    const placed = new Set<string>();

    // Pass 1: keep cards whose slot position is unchanged at the same index.
    for (let i = 0; i < 11; i++) {
      const id = cur[i];
      if (!id) continue;
      if (curPos[i] === nextPos[i]) {
        out[i] = id;
        placed.add(id);
      }
    }

    // Pass 2: greedily re-home the remaining cards into free matching slots.
    for (let i = 0; i < 11; i++) {
      const id = cur[i];
      if (!id || placed.has(id)) continue;
      const card = starsCardById(state, id);
      if (!card) continue;
      for (let j = 0; j < 11; j++) {
        if (out[j] === null && nextPos[j] === card.pos) {
          out[j] = id;
          placed.add(id);
          break;
        }
      }
    }

    save(next, out);
  };

  // -------------------------------------------------------------------------
  // Auto fill: drop the strongest owned, unused, position-matching card into
  // every empty slot.
  // -------------------------------------------------------------------------
  const autoFill = (): void => {
    const positions = slotPositions(state.squad.formation);
    const starters = state.squad.starters.slice();
    const used = new Set(starters.filter((id): id is string => !!id));

    for (let i = 0; i < 11; i++) {
      if (starters[i]) continue;
      const want = positions[i];
      let best: PlayerCard | null = null;
      for (const id of Object.keys(state.owned)) {
        if (used.has(id)) continue;
        const card = starsCardById(state, id);
        if (!card || card.pos !== want) continue;
        if (!best || card.overall > best.overall) best = card;
      }
      if (best) {
        starters[i] = best.id;
        used.add(best.id);
      }
    }
    save(state.squad.formation, starters);
  };

  // -------------------------------------------------------------------------
  // Picker: assign a card to a slot (clearing it from any other slot first).
  // -------------------------------------------------------------------------
  const assign = (slot: number, cardId: string): void => {
    const starters = state.squad.starters.slice();
    const prev = starters.indexOf(cardId);
    if (prev !== -1) starters[prev] = null;
    starters[slot] = cardId;
    save(state.squad.formation, starters);
  };

  const clearSlot = (slot: number): void => {
    const starters = state.squad.starters.slice();
    starters[slot] = null;
    save(state.squad.formation, starters);
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const draw = (pickSlot: number | null): void => {
    const formation = state.squad.formation;
    const positions = slotPositions(formation);

    if (pickSlot === null) {
      // --- Main view ----------------------------------------------------
      const cards = resolveStarters();

      // Group slot indices by line. GK alone, then DF / MF / FW lines in the
      // order positions appear (FORMATION_NEEDS is already ordered DF->FW).
      const lines: { key: string; idxs: number[] }[] = [{ key: 'GK', idxs: [0] }];
      for (let i = 1; i < positions.length; i++) {
        const p = positions[i];
        const last = lines[lines.length - 1];
        if (last.key === p) last.idxs.push(i);
        else lines.push({ key: p, idxs: [i] });
      }

      const lineRows = lines
        .map((line) => {
          const slots = line.idxs
            .map((i) => {
              const card = cards[i];
              return card
                ? playerCardHtml(card, { attrs: `data-slot="${i}"`, noFrame: true })
                : emptyCardHtml(`data-slot="${i}"`);
            })
            .join('');
          return `<div class="squad-line">${slots}</div>`;
        })
        .join('');

      const incomplete = cards.some((c) => c === null);
      const rating = squadRating(state);
      const ratingText = incomplete || rating === 0 ? '—' : String(rating);
      const chem = squadChemistry(cards, formation);

      const formationSeg = FORMATION_IDS.map(
        (f) =>
          `<button data-formation="${esc(f)}" class="${f === formation ? 'on' : ''}">${esc(f)}</button>`,
      ).join('');

      render(
        ui,
        `
        <h1 class="h-screen" style="margin:4px 0 10px">SQUAD</h1>
        <div class="seg wrap" style="margin-bottom:14px">${formationSeg}</div>

        <div class="squad-pitch">${lineRows}</div>

        <div class="row spread" style="margin-top:14px;width:min(880px,94vw)">
          <div class="row" style="gap:10px">
            <span class="squad-rating">${esc(ratingText)}</span>
            <span class="chem-meter-label">RATING</span>
          </div>
          <div class="chem-meter" style="max-width:240px">
            <span class="chem-meter-label">CHEMISTRY</span>
            <div class="chem-track"><div class="chem-fill" style="width:${chem.total}%"></div></div>
          </div>
        </div>
        ${
          incomplete
            ? `<div class="tag" style="margin-top:10px">XI INCOMPLETE — TAP AN EMPTY SLOT TO FILL IT</div>`
            : ''
        }

        <div class="menu-col" style="margin-top:16px">
          <button class="btn small" id="sb-auto">AUTO FILL</button>
          <button class="btn primary" id="sb-done">DONE</button>
          <button class="btn small" id="sb-back">◀ BACK</button>
        </div>`,
        STARS_BG,
      );

      ui.root.querySelectorAll<HTMLElement>('[data-slot]').forEach((el) => {
        el.addEventListener('click', () => {
          const i = Number(el.getAttribute('data-slot'));
          pSearch = ''; pRarity = 'all'; pSort = 'rating';
          draw(i);
        });
      });
      ui.root.querySelectorAll<HTMLElement>('[data-formation]').forEach((el) => {
        el.addEventListener('click', () => {
          const f = el.getAttribute('data-formation') as FormationId;
          if (f && f !== state.squad.formation) {
            remapFormation(f);
            draw(null);
          }
        });
      });
      ui.root.querySelector('#sb-auto')?.addEventListener('click', () => {
        autoFill();
        draw(null);
      });
      ui.root.querySelector('#sb-done')?.addEventListener('click', () => {
        opts.commit();
        opts.onBack();
      });
      ui.root.querySelector('#sb-back')?.addEventListener('click', () => opts.onBack());
      return;
    }

    // --- Picker view ----------------------------------------------------
    const pos = positions[pickSlot];
    const current = state.squad.starters[pickSlot];
    const placedElsewhere = new Set(
      state.squad.starters.filter((id, i): id is string => !!id && i !== pickSlot),
    );
    const clearCancelBtns = `
      <div class="menu-col" style="margin-top:16px">
        ${current ? `<button class="btn small danger" id="sb-clear">CLEAR SLOT</button>` : ''}
        <button class="btn small" id="sb-cancel">CANCEL</button>
      </div>`;
    const wireClearCancel = (): void => {
      ui.root.querySelector('#sb-clear')?.addEventListener('click', () => { clearSlot(pickSlot); draw(null); });
      ui.root.querySelector('#sb-cancel')?.addEventListener('click', () => draw(null));
    };

    // Owned cards of this slot's position that aren't already used elsewhere.
    const basePool = Object.keys(state.owned)
      .map((id) => starsCardById(state, id))
      .filter((c): c is PlayerCard => !!c && c.pos === pos && !placedElsewhere.has(c.id));

    const header = `
      <div style="text-align:center;margin-bottom:10px">
        <h1 class="h-screen" style="margin:4px 0 4px">PICK ${esc(pos)}</h1>
        <div class="tag">SLOT ${pickSlot + 1} · ${esc(pos)}</div>
      </div>`;

    if (basePool.length === 0) {
      render(
        ui,
        `${header}
        <div class="panel" style="text-align:center;padding:28px 22px">
          <p style="margin:0;font-weight:700">No ${esc(pos)} cards yet — open packs!</p>
        </div>
        ${clearCancelBtns}`,
        STARS_BG,
      );
      wireClearCancel();
      return;
    }

    let eligible = pRarity === 'all' ? basePool : basePool.filter((c) => c.rarity === pRarity);
    eligible = sortCards(eligible, pSort, quickSell);

    const gridCards = eligible
      .map((c) =>
        playerCardHtml(c, {
          attrs: `data-id="${esc(c.id)}" data-name="${esc(c.name.toLowerCase())}"`,
          selected: c.id === current,
        }),
      )
      .join('');

    render(
      ui,
      `${header}
      <div class="filter-bar">
        <input id="sb-search" class="filter-search" type="text" placeholder="Search ${esc(pos)}s…"
          autocomplete="off" spellcheck="false" value="${esc(pSearch)}" />
        ${segHtml('rarity', RARITY_FILTER_OPTS, pRarity)}
        <span class="filter-label">Sort</span>${segHtml('sort', CARD_SORT_OPTS, pSort)}
      </div>
      <div class="card-grid">${gridCards}</div>
      <div class="trade-empty is-hidden" id="sb-empty">No players match your filters.</div>
      ${clearCancelBtns}`,
      STARS_BG,
    );

    ui.root.querySelectorAll<HTMLElement>('.card-grid .player-card[data-id]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-id');
        if (id) { assign(pickSlot, id); draw(null); }
      });
    });
    ui.root.querySelectorAll<HTMLElement>('[data-rarity]').forEach((el) =>
      el.addEventListener('click', () => { pRarity = el.getAttribute('data-rarity') as RarityFilter; draw(pickSlot); }));
    ui.root.querySelectorAll<HTMLElement>('[data-sort]').forEach((el) =>
      el.addEventListener('click', () => { pSort = el.getAttribute('data-sort') as CardSortKey; draw(pickSlot); }));
    const searchEl = ui.root.querySelector<HTMLInputElement>('#sb-search');
    if (searchEl) searchEl.addEventListener('input', () => { pSearch = searchEl.value; applyPickerSearch(); });

    wireClearCancel();
    applyPickerSearch();
  };

  draw(null);
}
