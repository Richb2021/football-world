# FOOTBALL WORLD — ARCHITECTURE MAP

A builder's synthesis of the existing game at `/Users/richardbatt/Projects/football-world/international-cup/game`, with the concrete path to extend it into Football World (Manager Mode, Player Career Mode, Customisation Mode, + 4 English leagues).

---

## 1. SYSTEM OVERVIEW

**Stack:** Vanilla TypeScript (target ES2022, strict, `isolatedModules`, `noFallthroughCasesInSwitch`). Three.js for 3D matches. Vite + VitePWA for build/serve. Supabase (magic-link auth + PostgREST) for cloud saves/leaderboards. PeerJS/WebRTC for PvP. Fastify backend (`server/api.mjs`) for TURN creds + PayPal IAP. No framework, no router, no state library — everything is plain classes and DOM.

**Boot chain:** `index.html` (splash/intro, SW registration, asset manifest) → `src/main.ts` (`new App()` then `await app.boot()`) → `src/game/app.ts` `boot()` loads assets, wires audio/input, restores saves + auth, calls `this.ui.title(() => this.mainMenu())`. On boot failure main.ts renders a BOOT FAILED screen.

**Central state:** One god-object — `class App` (`src/game/app.ts` ~1831 lines). It holds all mutable game state as private fields and orchestrates navigation by calling methods on a single `UI` instance (`src/ui/screens.ts`) that owns only DOM. There is **no GameMode enum, no router, no "current screen" field** — the active screen is implied by whichever flow method last wrote to `this.ui`.

Key App fields (`app.ts:120-140`):
```ts
assets, audio, input, ui, hud, settings,
career: Career | null,         // the International Cup / league / season save
runner: MatchRunner | null,    // non-null only DURING a rendered match
journey: JourneyGame | null,   // Story mode
stars: StarsState | null,      // Ultimate-Team-style mode
seasons: SeasonsState | null,  // parallel ladder mode
backend, authUser, net, adManager
```
`MatchRunner` is **dynamically imported** (`await import('./matchRunner')`, cached in `this.matchRunnerCtor`) and is its own Vite chunk (`match-engine`). The HUD (`#hud`), UI (`#ui`), canvas (`#gl`), and touch layer (`#touch`) are hardcoded in `index.html`. Landscape-only; portrait is blocked.

---

## 2. MODE / SCREEN REGISTRY

There is **no array, enum, or registry**. Modes are hardcoded `<button id="m-...">` strings in `UI.mainMenu` paired with `on*` callback props wired inside `App.mainMenu()`. Adding a top-level mode is a mechanical **three-place edit** (per mode):

**A. `src/ui/screens.ts` — `UI.mainMenu(opts)` (lines 452-493):**
- Add a `<button class="btn" id="m-manager">MANAGER MODE <span class="arrow">▶</span></button>` to the `.menu-col` innerHTML (~line 475).
- Add `onManager: () => void;` to the `mainMenu(opts: {...})` parameter interface (452-465).
- Add `bind('m-manager', opts.onManager);` alongside the other binds (~484-492).

**B. `src/game/app.ts` — `App.mainMenu()` (lines 194-214):**
- Add `onManager: () => this.managerFlow(),` to the object passed to `this.ui.mainMenu({...})`.
- Add a private `managerFlow()` method (sibling of `exhibitionFlow()`/`starsFlow()` at ~542/1213) — the mode entry point.

**C. State + save:** Add a private field to App (`app.ts:120-140`), e.g. `private manager: ManagerState | null = null;`, loaded in the flow/`boot()` and persisted via a new save module mirroring `src/game/saves.ts` (careerSlots). Register the slot for cloud sync (see §6).

Existing mode flows: `exhibitionFlow` (m-exhibition), `careerSlotsFlow`→`hub` (m-cup; International Cup), `challengeFlow`, `starsFlow` (m-stars), `onlineFlow`, `journeyFlow` (m-journey), settings/sync.

Navigation is a **callback-continuation graph** of private methods: each method optionally mutates a field, calls `this.ui.<screenBuilder>(...)` (writes innerHTML into `#ui`), and passes continuation callbacks pointing to the next App method. There is no back-stack; every `onBack` re-invokes `this.mainMenu()` or `this.hub()`. A dangling callback strands the player.

**Screen mounting pattern:** every `UI` screen calls `this.screen(innerHtml, bgUrl?)` (`screens.ts:394`), setting `this.root.innerHTML` to `<div class="screen" style="bg"><div class="scrim"></div>{inner}</div>`. `UI.screen()` is **private by design** — the sanctioned escape hatch (used by Stars/Journey/Career/Seasons) is `render(ui, inner, bg?)` in `src/ui/stars/components.ts`, which casts `(ui as unknown as {screen:(...)=>HTMLElement}).screen(...)`. Interactive elements are `<button id="m-...">` (wired via `bind(id, fn)`) or `<button data-x="...">` (wired via `querySelectorAll`).

---

## 3. DATA MODEL

All canonical types live in `src/sim/types.ts`. The model is **nation-only today** — clubs are greenfield.

**Team (`TeamData`):**
```ts
{ id, name, short (3-letter, NOT "abbrev"), stadium, strength (30-95),
  colors: { home: KitColors, away: KitColors },
  defaultLineup?: Lineup, visuals?: {...}, players: PlayerAttrs[] }
```
**Player/squad entry (`PlayerAttrs`)** — the ONLY player type:
```ts
{ name, pos: 'GK'|'DF'|'MF'|'FW', age,
  pace, pass, shoot, tackle, keeping,  // 0-100, the 5 gameplay attrs
  shirtNumber?, appearance?: Partial<PlayerAppearance> }  // appearance is RENDER-ONLY
```
**League/Competition (`LeagueDef`):** `{ id, name, teams: TeamData[] }` (materialised, NOT ids). Registry in `src/data/leagues.ts` — `buildLeagues()` returns exactly 2 today (`international-cup`, `all-nations`). `setActiveLeague(id)` mutates the global `TEAMS` array in place; `leagueById`/`setCupTeams`/`allNations` work off it.

**Fixtures:** `src/game/fixtures.ts` `roundRobin(teamCount, seed)` → double round-robin as `[number,number][][]` (rounds of `[home,away]` team-INDEX pairs). `computeTable()` builds standings. Reused by career league mode; **fixtures are index-based, not id-based**.

**Live data:** `TEAMS` (`src/data/teams.ts`) is a **mutable singleton** loaded by `import.meta.glob('./teams/*.json', { eager: true })` — 64 nation JSONs (48 WC + ~16 unqualified). `setActiveLeagueTeams()` splices in place. `CARDS` (`src/data/cards.ts`) derives PlayerCards from `TEAMS` **at module load** (won't reflect later swaps).

**Names:** `src/data/names.ts` `fakeName(seed)`/`fakeManagerName(teamId)` — FNV-1a hash indexes into `src/data/namePool.json` (`{first[80], last[80]}`). Deterministic. No squad-player generator exists.

**WHERE TO ADD THE 4 ENGLISH LEAGUES:**

1. **Team data** — auto-discovery is the primary hook. The glob is NOT recursive, so either change to `'./teams/**/*.json'` and add `src/data/teams/clubs/*.json` (each conforming EXACTLY to `TeamData`; see `brazil.json` as template), or add a parallel loader. Each club JSON needs: `id` (globally unique slug, namespace e.g. `eng-pl-arsenal`), `name`, `short`, `stadium`, `strength` (use `DIV_BANDS` from `ladder.ts` as guidance: PL ~80-93, Champo ~72-84, L1 ~66-76, L2 ~60-70), `colors.home/away`, `players:[PlayerAttrs]` (~23-26, ≥1 GK + enough to fill a formation), `defaultLineup` (optional but recommended). **Names must be fictionalised** (existing codebase mangles real names with suffixes like `Silvae`, `Juniore` — keep this licensing dodge).

2. **League registry** — add 4 `LeagueDef` entries in `src/data/leagues.ts` `buildLeagues()` (e.g. `eng-premier`, `eng-championship`, `eng-league-one`, `eng-league-two`), filtering `TEAMS` by id-prefix or an explicit id list. `leagueById`/`setActiveLeague` then work for free.

3. **Fixtures** — no change; call `roundRobin(leagueTeams.length, seed)` (24 clubs → 46 matchdays).

4. **Squad generation** — build a new `src/data/clubs/generateSquad.ts` that, given clubId + strength band + seed, emits `PlayerAttrs[]` via `fakeName(seed)`, assigns positions (≥1 GK, balanced DF/MF/FW), randomises age 17-36, distributes attrs around the band. Output must satisfy `PlayerAttrs`.

5. **Division/promotion** — `src/game/seasons/ladder.ts` already models 5 divisions with promotion/relegation but opponents are strength-banded from the NATION pool. Replace `opponentFor()`'s selection with selection from the relevant `LeagueDef.teams`. `SeasonsState.division` (1=top) maps: 1=Premier, 2=Champ, 3=L1, 4=L2.

**Gotchas:** `short` not `abbrev`. `leagueId === 'international-cup'` is hardcoded as a literal in ~12 places (career.ts, cupMeta.ts, commentary.ts, matchSim.ts) — new league ids are safe (fall through to default). Keep team indices stable for a career's lifetime (re-sorting `TEAMS` mid-career corrupts saved fixtures).

---

## 4. MATCH PIPELINE

Two distinct APIs — **do not confuse them**:

**(a) HEADLESS / quick-sim** — `src/sim/statSim.ts`. Pure functions, no rendering, no three.js. Strength-based Poisson xG with +4.5 home advantage:
```ts
simulateFixture(homeStrength, awayStrength, rng): [home, away]
simulateKnockout(homeStrength, awayStrength, rng): {score, etPens, winner}
```
Already used by `career.ts` (lines 496/532) for AI-vs-AI fixtures. **This is what Manager Mode calls to sim a matchweek.** Strengths ~30-95.

For richer headless results (scorers/cards), run the real sim idle: `const sim = new MatchSim(cfg); while (sim.state.phase!=='finished') sim.step([NULL_INPUT,NULL_INPUT]);` (both teams `controller:'ai'`).

**(b) RENDERED 3D** — built by `App.buildMatch`/`buildOnlineMatch`/`buildChallengeMatch` (all → `MatchConfig`), launched by `App.playMatchWithPrematch(cfg, localTeam, onEnd, net?)` → `playMatch()` → `await loadMatchRunner()` → `new MatchRunner({...RunnerOpts})` → `runner.start()`. `MatchRunner` (`game/matchRunner.ts`, ~1165 lines) owns `MatchSim` + `MatchRenderer` + rAF loop + audio/HUD/replay/presentations/subs. Calls back via `opts.onEnd(MatchOutcome {score, winner, momentum, reason})`.

**The universal input struct** — every match path builds `MatchConfig` (`sim/types.ts:138-171`). Key extension levers on `MatchTeamConfig`: `controller: 'human'|'ai'|'remote'` and `playerForm?: Record<squadIdx, 0-100>` (50 neutral). User-vs-AI sets human on one side, ai on the other.

**Control is derived SOLELY from `cfg.teams[t].controller`:** `=== 'ai'` ⇒ never human-steered (`controlledIdx` stays -1, AI auto-switches everything); `!== 'ai'` ⇒ that team's PadInput slot steers the auto-selected ball-proximate player. CPU-vs-CPU = both `ai` + `[NULL_INPUT, NULL_INPUT]`. **Never set `SimPlayer.control=true` directly** — it's recomputed every tick.

**Determinism:** seeded by `cfg.seed` (Rng = mulberry32). A second `Rng(seed^0x9e3779b9)` drives referee errors. Same seed ⇒ byte-identical match. `cfg.difficulty` is **dead** (MatchSim hardcodes `DIFFICULTY[1]`) — challenge comes purely from attributes.

**Player attribute model:** pace/pass/shoot/tackle/keeping (0-100). `effectiveAttr()` (private in MatchSim) is the sole funnel — it applies momentum + form. `overallRating()` (formations.ts) weights per position. `age` drives stamina erosion (>28 loses ~0.02/yr). Appearance is render-only.

**FOCUS ON ONE PLAYER (Player Career Mode) — NOT YET SUPPORTED.** Requires three additions:
1. **Sim:** add to `MatchConfig` (e.g. `focusPlayer?: {team:0|1; squadIdx}`) and in `matchSim.ts` `updateControlledIndices` (~line 1305) + `integratePlayers` (~1420/1478) short-circuit so the focus player stays `control=true` and PadInput steers it regardless of ball proximity; also gate `updateAIWithBall` (~3017) to treat it as human-controlled.
2. **Camera:** add a `RenderCameraMode` flag (e.g. `focusPlayerIdx`) in `engine/matchRenderer.ts` render() camera section (~483-597) that lerp-follows that player's pos. Wire from `matchRunner.cameraModeForState` (~762).
3. **Journey bridge:** `journey/matches.ts` currently injects the journey player via `team.players = [...slice(0,10), journeyPlayer]` + `forceStarter`, with whole-team control. Set the new `focusPlayer` flag from the known `journeyPlayerIdx`.

---

## 5. WHAT ALREADY EXISTS TO BUILD ON

**For MANAGER MODE — lots exists:**
- **`src/game/career.ts`** — full Career engine: `Career` state, calendar/`advance()` loop, `effectiveStrength`, `leagueTable`, `userFixture`, board confidence, momentum, player availability. `CareerMode = 'league'|'cup'|'season'`. Extend to `'manager'`.
- **`src/game/transfers.ts`** — valuation (`playerValue`), budgets (`clubBudget`), `marketListings`, `askingPrice`, multi-round `negotiateBuyPlayer`/`negotiateSellPlayer` (caps at round 2). `aiTransferChurn` is **flavour-only** (no AI budgets) — a real CPU-vs-CPU market must be new.
- **`src/meta/`** — engine-agnostic DOM overlays: phone inbox (`phone.ts`), press conferences (`pressConference.ts`, `buildPressConference(ctx, room)`), random events (`randomEvents.ts`, `rollEvents`). All consume a pure `MetaContext` → `MoraleDelta`. `cupMeta.ts` `buildContext`/`applyMoraleDelta` is the glue — **but it's wired ONLY for `leagueId==='international-cup'`** (app.ts ~671-686). Lift that gate to enable for manager.
- **`src/ui/careerScreens.ts`** — careerHub, squad, training, transfer, table, bracket, headlines screens.
- **`src/game/seasons/ladder.ts`** — working 5-division promotion/relegation (strength-banded). Replace nation pool with league teams.
- **`src/game/challenges.ts`** — reusable per-match objective engine (`evaluateChallengeObjective`) for board targets.
- **Missing:** sacking (board.confidence clamps 8-98, no consequences), season targets beyond implicit expectation text, scouting.

**For PLAYER CAREER MODE — Journey is the closest base:**
- **`src/journey/`** — `JourneyState` (stats/relationships/reputation/pressures/inbox), `JourneyGame` controller, `state.ts` `applyConsequences` reducer, `storyLogic.ts` (reusable `StoryGate`/`StoryRoute` branching engine), `matches.ts` (builds MatchConfig injecting the player), `sceneRenderer.ts` (canvas 2D dialogue), `campaigns.ts` registry (role already supports `'player'|'manager'`).
- **Must generalise from a scripted finite graph to a procedural season loop** — `allEpisodes` is 21 hand-written Episodes ending at `isComplete`. Build `src/journey/career/generateCareerBeat.ts` to emit Episode/Scene graphs from templates; reuse Scene/Choice/StoryGate verbatim.
- **Missing:** age/contract/club history/market value fields on state; XP-based progression (today growth is flat `{type:'stat';change}` clamped 40-99); "control just yourself" (see §4); `JourneyMatchId` is a closed 15-member union — a career needs generic opponents.

**For CUSTOMISATION MODE — minimal direct base, but cheap:**
- Cosmetic fields already exist: `PlayerAttrs.appearance` (skinTone/hairColor/hairStyle/facialHair/bootColor) + `TeamData.colors`/`visuals.kitStyles` (pattern/secondary/trim/badgeShape/badgeText). All render-only.
- **`src/ui/stars/clubScreen.ts`** (`My Club` customisation) + `src/game/stars/clubRandom.ts` (`randomKit`, `setClub`, `CLUB_RENAME_COST`/`CLUB_KIT_COST`) is the closest analogue — likely reuse `this.stars: StarsState` rather than a new App field.
- **`src/journey/sceneRenderer.ts`** + `characterAssets.ts` for an avatar preview.
- New screens needed for full kit/badge/stadium editor.

---

## 6. SAVE FORMAT

**Local-first, per-mode, separately-versioned.** No central schema registry. `src/net/saveSlots.ts` provides the generic `makeSaveSlots<T>(mode, {cap, summarise, revive, valid})` factory → `SaveSlots<T>` singleton.

localStorage keys (PREFIX `sl93`): index `sl93.slots.{mode}`, active `sl93.active.{mode}`, payload `sl93.slot.{mode}.{id}`. `valid` is the version guard (e.g. Career `c.version===2`, Seasons/Stars `s.version===1`). `revive` runs on every load (post-cloud-sync too) and must be idempotent (e.g. `ensureCareerSystems`, `migrateJourneyState`).

Existing singletons: `careerSlots` (saves.ts), `storySlots` (journey/state.ts), `seasonsSlots` (seasons/ladder.ts), `starsSlots` (stars/store.ts, fixed slot `'main'`). Stars uses a fixed slot id — `api.mjs applyGrantToCloudSave` hardcodes `mode='stars'`.

**Cloud (Supabase `saves` table):** `(user_id, game_id='soccer', mode, slot, data:{meta,payload}, updated_at)`. `src/net/cloudSlots.ts` `makeCloudSlotStore(userId, client)` is mode-agnostic. **The ONLY wiring point is `App.applyIdentity(user)`** (`app.ts` ~1142): builds `allSlots = [careerSlots, storySlots, seasonsSlots, starsSlots]`, calls `s.setCloud(...)` + `s.sync(resolver)` on each. `ConflictResolver = showConflictModal`. After sync, reload in-memory caches (`this.career = careerSlots.load() ?? ...`).

**To add a new mode's save (mirror saves.ts exactly):**
1. Define `interface ManagerState { version: 1; ... }` in the mode module.
2. `export const managerSlots = makeSaveSlots<ManagerState>('manager', {cap:6, summarise, revive: ensureManagerSystems, valid: m=>m.version===1});` — the `mode` string is the localStorage key + Supabase partition, must be unique/stable forever.
3. Register in `App.applyIdentity` allSlots array + add post-sync reload line.
4. Breaking schema change ⇒ bump version literal + update `valid` + extend `revive` (prefer revive-based additive repair over a versioned ladder; `migrateLegacySaves.ts` is one-shot gated by `sl93.slots.migrated`).

**GAME_ID is hardcoded `'soccer'`** (supabase.ts) and `api.mjs GAMES = Set(['bball','soccer'])`. **Reuse `'soccer'`** so saves/cloud carry over — a new id means existing user saves won't migrate. Football World cross-game import needs its own one-shot gate flag (e.g. `fw.slots.migrated`).

---

## 7. UI / STYLING CONVENTIONS

**The design system** is `src/style.css` (~4338 lines). `:root` CSS vars: `--bg #0b1f12`, `--panel`, `--grass #36c24f`, `--accent #ffd400`, `--accent-2 #5ad1ff`, `--danger`, plus WC26 vibrant palette (`--c-red/orange/lime/green/blue/purple/mint/pink`). `.btn:nth-child(n)` in `.menu-col` auto-cycles the `--c-*` palette. `--font: 'Avenir Next Condensed'`.

**Single full-viewport SPA** (`#app` fixed inset 0, overflow hidden; screens scroll internally). Coordinate z-index: `#ui`=10, `#hud`=5, `.meta-overlay`=60, journey ~100. Don't create new fixed root containers except documented overlays.

**Reusable classes for new screens:**
- Screen: rendered automatically by `render()` as `.screen` > `.scrim` + your inner. Don't add your own `.screen`.
- Title: `<h1 class="h-screen">WORD <span class="accent">HIGHLIGHT</span></h1>`.
- Button stack: `<div class="menu-col">` of `<button class="btn">` / `btn primary` (red→orange) / `btn small` / `btn danger` + `<span class="arrow">▶</span>`.
- Panel: `<div class="panel">` with `.row`/`.row.spread`, `.subtle`, `.tag`, `.money`, `.notice`.
- Input: `<input class="txt">` (uppercase, accent-2 focus). Long left-aligned input: mode class (see `.club-name-input`).
- Segmented: `<div class="seg wrap">` of `<button class="on">` — helper `segHtml(group, opts, active)`.
- Table: `<table class="tbl">`, `td.num`, `tr.you`.
- Squad list: `.squad-head`/`.squad-list`/`.squad-card`/`.squad-pos`/`.squad-name`/`.squad-ovr`/`.squad-energy`.
- Hub dashboard (rich): `.owner-hq-shell`/`.owner-hq-top`/`.owner-hq-grid`/`.owner-feature`/`.owner-mini-card`/`.owner-action-grid` (from starsHub).
- Collectible cards: `playerCardHtml(card, opts)` + `.card-grid`; `.player-card.empty` via `emptyCardHtml`.
- Reward/result: `showReward(ui, {title, coins, tokens?, lines?, onDone})`.

**Helpers a builder reuses:** `bind(id, fn)` (screens.ts, exported), `render(ui, inner, bg?)` + `esc(s)` + `coinsChipHtml`/`tokensChipHtml` + `segHtml` (stars/components.ts), `showReward` (stars/playScreen.ts), `showConfirm`/`showPrompt`/`showAlert` (ui/modal.ts), `stars(strength)` (screens.ts).

**New mode folder convention:** `src/ui/<mode>/<mode>Hub.ts` exporting `<mode>Hub(ui, opts)` that calls `render(ui, markup, BG_URL)` then `bind(...)`. Mode-specific CSS lives in `src/<mode>/<mode>.css` imported once from the mode's index (like `meta.css`, `journey/styles.css`) — don't dump mode CSS into global `style.css`.

**Messaging/dialogue (Player Career):** reuse the `meta.css` overlay system (`.meta-overlay`/`.phone-frame`/`.phone-msg`/`.press-frame`/`.event-card`) via `meta/phone.ts`, `meta/pressConference.ts`, `meta/eventUI.ts`. Episode select: `journey/styles.css` `.journey-episode-grid`/`.journey-character-create`.

**Gotchas:** `UI.screen()` stays private — use the `render()` cast. `heroUrl`/`bgUrl` are getters returning a random `menuBackdrops` entry; pass an explicit `bg` arg to pin. `bind()` only works on `id` elements. Always escape interpolated text (`esc`). Landscape-only.

---

## 8. BUILD PLAN

**(a) Repo setup & rebrand**
1. **Rebrand shell:** Edit `index.html` (title, splash/intro, BASE_URL splash bg), `vite.config.ts` `base` (currently `/international-cup/`), and asset references. Decide GAME_ID: **keep `'soccer'`** (supabase.ts, server/api.mjs `GAMES`) to preserve cloud saves. Bump app version metadata.
2. **Add 3 main-menu modes:** In `src/ui/screens.ts` `UI.mainMenu` add 3 buttons (`m-manager`, `m-player`, `m-customise`) + `on*` opts + `bind()`. In `src/game/app.ts` `App.mainMenu()` add `onManager/onPlayer/onCustomise` → new private `*Flow()` methods. Add App fields `manager`/`playerCareer` (Customisation likely reuses `this.stars`).
3. **Vite chunks:** add `manualChunks` entries for `manager-mode`, `player-career` (keep <1500KB).

**(b) Data overhaul — 4 English leagues**
4. **Recursive glob:** `src/data/teams.ts` change `import.meta.glob('./teams/*.json')` → `'./teams/**/*.json'` to pick up a clubs subfolder.
5. **Club data + generator:** New `src/data/clubs/` with 96 club JSONs (4 leagues × 24) OR a `generateSquad.ts` that emits `PlayerAttrs[]` from `fakeName` + strength bands. Each `TeamData` with fictionalised names, `defaultLineup`, `strength` per `DIV_BANDS`. Namespace ids (`eng-pl-…`).
6. **League registry:** `src/data/leagues.ts` `buildLeagues()` add 4 `LeagueDef`s (Premier/Championship/L1/L2). Optionally extend `namePool.json` with an English-flavoured pool (separate file to not break existing seeds).
7. **Name pool extension:** Add `src/data/namePool.en.json` + a namespaced `fakeName` variant (do NOT edit the existing 80-entry pool — it breaks manager/NPC save stability).

**(c) Manager Mode**
8. **Manager state + save:** New `src/game/manager/` with `ManagerState { version:1; ... }` mirroring `Career` + scouting/targets/aiBudgets fields. `managerSlots = makeSaveSlots('manager', {...})` + `ensureManagerSystems` revive. Register in `App.applyIdentity` allSlots + post-sync reload.
9. **Engine:** Either extend `career.ts` (widen `CareerMode` to `'manager'`; the `leagueId` hook + new league ids need no special-casing) or fork into `src/game/manager/engine.ts` reusing `roundRobin`/`computeTable`/`effectiveStrength`/`simulateFixture`. Add CPU-vs-CPU budget-aware market (`aiTransferMarket`) next to `aiTransferChurn`. Add `SeasonTarget` + sacking check in `advance()`.
10. **Meta layer for manager:** Lift the `leagueId==='international-cup'` gate in `app.ts` (~671-686) so `cupMeta.buildContext`/`rollEvents`/`buildPressConference` fire for manager. Add manager `PressTone`s to `metaTypes.ts` + `toneLabel` (Record must stay complete or TS fails). Add `teamNarrativeProfile` entries for clubs.
11. **Manager UI:** New `src/ui/manager/managerHub.ts` + sub-screens (squad/training/transfers/scout/table/inbox/press) reusing `careerScreens` patterns + `render`/`bind`. Add `src/manager/manager.css`. `managerFlow()` → slot picker → new/continue → hub. User matches via `playMatchWithPrematch(buildManagerMatch(cfg), side, onEnd)`.

**(d) Player Career Mode**
12. **Extend JourneyState:** `src/journey/types.ts` add `age`, `birthYear`, `seasonYear`, `clubHistory`, `contractYearsLeft`, `wage`, `marketValue`, `internationalCaps/Goals`, `trainingXp`. New `StoryCampaignId 'player-career'`. Register in `campaigns.ts` (`role:'player'`).
13. **Procedural episode generator:** New `src/journey/career/generateCareerBeat.ts` emitting Episode/Scene graphs from season-phase templates (pre/post-match, transfer window, call-up, injury, contract). Fix `isEpisodeUnlocked` to evaluate all `UnlockRequirement` kinds (currently only `{type:'episode'}`). Add `advanceSeason()` (age curve, contract roll, retirement).
14. **Control-just-yourself:** Add `focusPlayer?: {team; squadIdx}` to `MatchConfig` + short-circuit in `matchSim.ts updateControlledIndices`/`integratePlayers`/`updateAIWithBall`. Add `focusPlayerIdx` to `RenderCameraMode` + camera branch in `matchRenderer.ts`. Set it from `buildJourneyMatchConfig` via known `journeyPlayerIdx`. Move off the closed `JourneyMatchId` enum to generic opponent descriptors.
15. **Player UI:** Reuse `sceneRenderer.ts` + `meta.css` overlays. New `src/ui/player/playerHub.ts` for the non-story career dashboard (fixtures, stats, contract, inbox). Character-create bridged from Customisation (appearance → `journeyPlayerAttrs`).

**(e) Customisation Mode**
16. **Customisation hub + editor screens:** New `src/ui/customise/customiseHub.ts` mirroring `clubScreen.ts`. Edit `PlayerAttrs.appearance` + `TeamData.colors`/`visuals.kitStyles` (all render-only). Reuse `stars/store.ts setClub`, `clubRandom.ts randomKit`. New screens for kit pattern/colour, badge shape/text, stadium name, player appearance avatar preview. Persist under `this.stars` (or a new lightweight slot if shared globally). Wire `customiseFlow()`.

**(f) Integration**
17. **App wiring pass:** Add all new `*Flow()` entry methods, App fields, slot reloads in `boot()`/`applyIdentity`. Verify every `onBack` resolves (no dangling callbacks). Ensure `setActiveLeague` is called before any team selection in each new flow.
18. **Cross-mode bridges:** Customisation → Player Career (appearance propagation via `journeyPlayerAttrs`); Manager ↔ Player Career (shared fictional club pool); main-menu ordering/discovery.

**(g) Testing**
19. **Unit tests** for the new generators (`generateSquad`, `generateCareerBeat`), the budget-aware AI market, `managerSlots` revive/idempotency, and the `focusPlayer` control pinning (construct `MatchSim` headless, assert `controlledIdx` stays pinned). Verify `revive` is idempotent and `valid` guards reject stale versions. Add a `noFallthroughCasesInSwitch`-safe dispatcher if introducing any mode switch.

**Critical discipline throughout:** every new `Career`/`JourneyState`/`ManagerState` field must be optional AND defaulted in its `revive` (`ensureCareerSystems`/`migrateJourneyState`/`ensureManagerSystems`) or old saves break. Keep team indices stable for a save's lifetime. Names stay fictionalised. Landscape-only UI. Reuse `render()`/`bind()`/`playerCardHtml`/`showReward` — don't re-implement.
