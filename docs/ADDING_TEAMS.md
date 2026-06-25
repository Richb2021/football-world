# Adding Teams, Leagues, and Player Looks

## Adding a team

Drop a JSON file into `game/src/data/teams/` — it is auto-discovered at build
time (no imports to edit) and appears in every menu, sorted by name.

```jsonc
{
  "id": "my-club",            // unique slug (used for saves & commentary clips)
  "name": "My Club FC",
  "short": "MYC",             // 3-4 letters for the scoreboard
  "stadium": "The Ground",
  "strength": 74,             // 30-95; drives AI quality and transfer budgets
  "colors": {
    "home": {
      "shirt": "#D71920", "shorts": "#111111", "socks": "#D71920",
      "style": { "pattern": "stripes", "secondary": "#FFFFFF" }
    },
    "away": {
      "shirt": "#F4F4F4", "shorts": "#1A1A1A", "socks": "#F4F4F4",
      "style": { "pattern": "solid" }
    }
  },
  "players": [ /* exactly 18, see below */ ]
}
```

Kit `pattern`: `solid`, `stripes`, `hoops`, `halves`, `sash`, `sleeves`
(`secondary` is the second colour). Patterns paint in body space on the 3D
model, plus the back number and a chest crest chip automatically.

## Players

18 players: 2 GK first, then 6 DF, 6 MF, 4 FW.

```jsonc
{
  "name": "Sam Example",
  "pos": "FW",                // GK | DF | MF | FW
  "age": 24,
  "pace": 82, "pass": 70, "shoot": 84, "tackle": 45,
  "keeping": 10,              // 60-95 for GKs, 5-25 outfield
  "shirtNumber": 9,           // optional; defaults to squad order
  "appearance": {             // optional — every field optional
    "skinTone": "#8a5538",   // any hex; drives the rendered skin
    "hairColor": "#d7c08a",  // blonde here; lifts over the dark base
    "hairStyle": "short",    // short | crop | curly | bald | long
    "facialHair": "beard",   // none | stubble | moustache | beard
    "bootColor": "#c60019"
  }
}
```

Appearance is cosmetic only (never feeds gameplay). Players without an
explicit `appearance` get a stable, name-seeded variety of skin tones and
hair colours. `bald` repaints the model's hair to skin; facial hair paints
into the face texture around (never over) the mouth and nose.

## League size

The career engine reads the team count from the data folder:

- **League**: double round-robin for any **even** team count (an odd count
  would need bye-weeks, which aren't modelled).
- **Cup**: the bracket auto-structures — a preliminary round trims the field
  to a power of two, then knockout rounds named `Round of N` → Quarter-Final
  → Semi-Final → Final.
- **Season**: cup rounds and the January window spread proportionally
  through the league calendar.

So replacing the 22 squads with, say, 18 or 24 teams works without code
changes. Multiple *simultaneous* leagues (divisions, country switching) would
need a league registry and a picker in the new-career flow — the data layer
is ready for it, the UI isn't yet.

## Voices

Commentary speaks team, stadium, and player names from generated clips. After
adding teams, regenerate the name clips:

```bash
ELEVENLABS_API_KEY=... node game/scripts/generate-elevenlabs-commentary.mjs
```

Until then, the engine simply skips unvoiced names (text-free splices).
