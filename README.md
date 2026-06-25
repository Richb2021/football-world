# ⚽ Football World

The sequel to **International Cup** — an arcade 11v11 football game rebuilt around
three deep career modes, four license-friendly English leagues, and a full
customisation toolkit. Built on the original game's 3D match engine and simulation.

> All club and player names are **fictionalised**. Real place names are kept;
> distinctive/trademarked suffixes are replaced (e.g. *Manchester Reds*, *Manchester Sky*).
> Players are randomly generated — no real footballers appear.

---

## What's new

### 🏟 Manager Mode
Take over a club and run it across **ongoing seasons** with promotion & relegation:
- **Transfer market** that runs between **CPU clubs** too (the whole league buys,
  sells and churns every window) — scout targets, **negotiate** bids, sell, sign free agents.
- **Summer & winter transfer windows** that open and close through the season.
- **Scouting** — assign scouts to reveal opposition players before you bid.
- **Training** plans that develop your squad and shape form between matches.
- **Press conferences**, a **phone inbox** and **back-page headlines** (extended from
  the original International Cup meta layer).
- **An in-season cup** — a knockout bracket (with byes) drawn from the nation's entrants,
  played on cup matchdays spread across the season alongside the league. Your league game
  on a cup day is auto-simmed while you play the tie; follow the run on the bracket screen.
- **Season targets & board confidence** — miss them and the pressure builds; fail badly
  and **you're sacked**, forced to take over another club from the job market.

### 🌟 Player Career Mode
A New-Star-Soccer-style career where you **are a single footballer**:
- Start as a 16-year-old at a small club and rise through the leagues.
- **Play matches as just yourself** — the camera follows you and you control only your
  player while the AI runs your ten team-mates (Be-A-Pro control + camera). Your goals in
  a played match are credited from the actual goal log.
- Earn **ratings, goals and assists**, grow your attributes through **training XP**,
  build **reputation**, earn **international call-ups**, and **transfer to bigger clubs**.
- Age, retire, and leave a career behind.

### 🛠 Customisation Mode
Build your own football world and **share it**:
- **Create teams** (with generated fictional squads) and **edit kits, colours, strength**.
- **Create leagues / nations** as multi-tier pyramids with **promotion & relegation** and
  cup competitions, mixing your teams with the built-in clubs.
- **Export** a nation as a share code and **import** it on another device.
- Custom nations are selectable in **Manager** and **Player Career** — play your own world.

### 🗺 Four English leagues
A fictionalised **English pyramid**: **Top Division** (20), **Championship** (24),
**League One** (24) and **League Two** (24) — 92 clubs with the correct 2025–26
composition, all with generated squads. Re-legible, recognisable, unbranded.

The original **International Cup** (World Cup) mode and **Exhibition** remain playable.

---

## Run it

```bash
cd game
npm install
npm run dev          # http://localhost:5179/football-world/
```

Build / test:

```bash
npm run build        # tsc --noEmit && vite build
npm test             # vitest run (778 tests)
```

## Project structure (the new mode code)

```
game/src/
  data/
    teams/clubs/*.json        # 92 generated fictionalised clubs
    english-pyramid.json      # the 4-tier structure
    namePool.en.json          # fictional English player names
    nations.ts                # Nation abstraction (World + England + custom CRUD + export/import)
    clubs/generate.ts         # runtime squad/team generator (Customisation)
    teams.ts                  # nations + clubs + custom-team registry (anyTeamById)
  game/manager/               # Manager Mode engine (season loop, CPU-CPU market, scouting,
                              #   training, targets/sacking, meta, match, saves)
  game/playercareer/          # Player Career engine (avatar layer over the manager world,
                              #   Be-A-Pro match builder, training, transfers, call-ups)
  sim/matchSim.ts             # + focusPlayer control pin (Be-A-Pro)
  engine/matchRenderer.ts     # + Be-A-Pro camera follow
  ui/manager/managerHub.ts    # Manager UI (hub + standings/squad/training/transfers/scout/phone/press/board)
  ui/player/playerHub.ts      # Player Career UI
  ui/customise/customiseHub.ts# Customisation UI (team/nation editors, export/import)
docs/
  football-world-design.md    # design notes + naming rule
  architecture-map.md         # how the original engine is put together
```

## Tech

TypeScript (strict) · Vite + PWA · three.js match engine · a seeded statistical sim
for CPU-vs-CPU results · local-first per-slot saves with optional Supabase cloud sync.

— A sequel to International Cup, rebranded and extended into Football World.
