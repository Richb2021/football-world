import type { UI } from '../screens';
import { bind } from '../screens';
import type { StarsState } from '../../game/stars/types';
import { contrastKit } from '../../game/stars/squad';
import { randomClubName, CLUB_RENAME_COST, CLUB_KIT_COST } from '../../game/stars/clubRandom';
import { render, esc, coinsChipHtml, STARS_BG, STARS_CREST } from './components';

export function clubScreen(
  ui: UI,
  opts: {
    state: StarsState;
    /** commit a (possibly custom) name — caller charges coins if it changed */
    onRename: (name: string) => void;
    /** roll a new random home kit — caller charges coins */
    onRandomKit: () => void;
    onBack: () => void;
  },
): void {
  const { state } = opts;
  const home = state.club.kit;
  const away = contrastKit(home);
  const collectionSize = Object.keys(state.owned).length;

  const swatches = (kit: { shirt: string; shorts: string; socks: string }) =>
    [kit.shirt, kit.shorts, kit.socks]
      .map((c) => `<span class="club-swatch" style="background:${esc(c)}"></span>`)
      .join('');

  render(
    ui,
    `
    <div class="club-head">
      <img class="hub-crest" src="${esc(STARS_CREST)}" alt="Stars crest" />
      <h1 class="h-screen" style="margin:6px 0 2px">MY CLUB</h1>
    </div>
    <div class="panel club-panel">
      <div class="subtle">ALL STAR TEAM NAME</div>
      <div class="club-name-row">
        <input class="txt club-name-input" id="club-name" type="text" maxlength="24"
          value="${esc(state.club.name)}" placeholder="Team name" autocomplete="off" />
        <button class="btn small club-shuffle" id="club-shuffle" title="Random name">↻ RANDOM</button>
      </div>
      <div class="subtle club-hint">The name on the dugout, match ticker and front page.</div>

      <div class="club-kits">
        <div class="club-kit">
          <div class="subtle">HOME KIT</div>
          <div class="club-swatch-row">${swatches(home)}</div>
        </div>
        <div class="club-kit">
          <div class="subtle">AWAY KIT <span class="club-auto">AUTO</span></div>
          <div class="club-swatch-row">${swatches(away)}</div>
        </div>
      </div>
      <div class="subtle club-hint">Your away kit is generated automatically from the home colours so the two strips always contrast.</div>

      <button class="btn small club-random-kit" id="club-random-kit">↻ RANDOMISE KIT · ${CLUB_KIT_COST.toLocaleString()} COINS</button>

      <div class="row spread club-wallet">
        ${coinsChipHtml(state.coins)}
        <span class="tag">${collectionSize} PLAYERS</span>
      </div>
    </div>
    <div class="menu-col">
      <button class="btn primary" id="club-save">SAVE NAME · ${CLUB_RENAME_COST.toLocaleString()} COINS</button>
      <button class="btn small" id="club-back">◀ BACK</button>
    </div>`,
    STARS_BG,
  );

  const nameEl = ui.root.querySelector<HTMLInputElement>('#club-name');
  ui.root.querySelector<HTMLElement>('#club-shuffle')?.addEventListener('click', () => {
    if (nameEl) nameEl.value = randomClubName();
  });
  ui.root.querySelector<HTMLElement>('#club-save')?.addEventListener('click', () => {
    opts.onRename(nameEl?.value.trim() || state.club.name);
  });
  bind('club-random-kit', opts.onRandomKit);
  bind('club-back', opts.onBack);
}
