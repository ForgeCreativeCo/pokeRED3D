# Rule sets

The rules turn FireRed's flat, top-down map data into the tilted 2.5D view.
They are plain data, written by us and committed. The baker applies them
offline. The game only ever loads baked output, never these files.

```
vendor/pokefirered (decomp)  +  rules/*.yaml  ──►  tools/baker  ──►  build/  (gitignored)
```

Everything under `build/` is derived from Nintendo's assets. It stays out of
git and is regenerated locally.

## Running

```bash
npm install
npm run setup:decomp              # once: clones pret/pokefirered into vendor/
npm run classify -- PalletTown    # classify + debug overlays
npm run bake -- PalletTown Route1 PalletTown_PlayersHouse_2F   # bake maps for the game
npm run dev                       # play them at http://localhost:5173
```

Outputs:

- `build/rules/tilesets/<key>.json`: the resolved class of every metatile, with its reasons and stats
- `build/debug/classify.html`: map and tileset views; hover a cell to see why it got its class
- `build/debug/maps/*_classes.png`, `build/debug/tilesets/*_classes.png`: the same overlays as images
- `build/maps/<Map>/map.json` + `atlas.png`: the baked map (format below)
- `build/data/world.json`: which maps are in the bake and where each sits. Connected outdoor maps form one area; each interior is its own area, reached through doors, exit mats and stairs. `start` is where a new game begins (Red's bedroom) when that map is in the bake.
- `build/data/scripts.json`, `build/data/music.json`: the scripts and text, and the songs with their samples (see below)
- `build/data/pokemon.json`: every species and move, the natures and ability names, and pictures of the Pokémon the scripts mention (see below)
- `build/data/items.json`: every item (name, price, pocket, description) and the money a new game starts with
- `build/data/battle.json`: the type chart, the baked maps' wild Pokémon, every trainer the scripts can battle, trainer and player pictures, and the battle backgrounds (see below)

The game (`src/`, `npm run dev`) loads these. Walk with WASD, hop ledges,
tune the camera from the panel, and compare against the original GBA view.

## How a metatile gets its class

Rules are tried in priority order. Each step can be overridden by the ones after it.

| # | Source | File |
|---|---|---|
| 1 | Shape heuristics, measured over **every placement** on every layout using the tileset | `classifier.yaml` |
| 2 | Metatile behavior (tall grass, water, ledges, doors, signs…) | `behaviors.yaml` |
| 3 | Animated tiles (flowers become `ground_decor`) | `animations.yaml` |
| 4 | Hand overrides | `tilesets/<key>.yaml` |

### The heuristics

- **Walkable or blocked.** Collision lives on map cells, not metatiles, so we count how often each metatile is placed with collision across all maps.
- **Wall or roof.** For a blocked cell, count rows down to walkable ground. With `wall_max_rows` (2) or fewer it's a wall face; above that it's roof. This splits houses and the lab at the right row.
- **Prop.** A blocked column only one cell tall is a fence, mailbox or similar.
- **Tree.** Blocked and mostly green.
- **Overhang (`top`).** On FireRed, a metatile's second layer draws *above* sprites, except for `covered` metatiles. A walkable metatile with enough pixels there has something drawn over the player, such as a roof edge or tree top. It gets `top: <class>`, taken from the cell **below**, because an overhang is the upper part of the object standing there.

### Classes (`classes.yaml`)

Each class has a `geometry`: `flat`, `raised`, `standing`, `billboard` or `none`. That is the contract with the baker: classification decides *what* a tile is, and geometry decides *how* it gets built.

## Map data notes

- **Elevation is not height.** On outdoor maps, walkable ground is usually elevation `3`, blocked cells `0` ("any level") and water `1`. Turning elevation into real height needs its own rule (see below).
- Metatile ids are global: `0x000–0x27F` are the primary tileset, `0x280+` the secondary.

## Height (`height.yaml`)

Each elevation value maps to a world height. Elevations `0` and `15` have no
height of their own and inherit from the nearest cell that does. Where
neighbours differ (the pond), a vertical step face fills the gap.

## Stand-up (`standup.yaml`)

**Footprint principle:** a 3D object covers exactly the cells the collision
grid blocks for it, plus its walk-behind row. Visuals and gameplay can't
disagree: there are no invisible walls, and roofs and tree tops hide the
player in the walk-behind row just like on the GBA.

- **Buildings** are connected wall/door/roof cells. Per column, the bottom run
  of wall rows stands up as the front face. The rest becomes a roof sloping
  back over the footprint, including the walk-behind row. Side walls close the
  ends.
- **Objects** (trees, props, signs, ledges, furniture) are per-column stacks,
  cut into chunks of `max_rows` from the bottom. Each chunk stands (optionally
  leaning) on the front edge of its bottom cell.
- **Cutouts:** pixels identical to the nearest plain ground tile are made
  transparent. The grass behind a fence disappears, while a forest stays solid.
- **Ground under** anything that stood up is replaced with the nearest plain
  ground, a shaded copy (`ground: shade`, used for forest floor), or left as
  the original art (`ground: keep`, used for ledges).
- **Walkable objects** (`walkable: true`) stand up over cells the player can
  enter. Tall grass uses this: short leaning tufts the player wades into.

## Baked map format (`build/maps/<Map>/map.json`)

```jsonc
{
  "format": { "name": "pokered3d-map", "version": 1 },
  "name": "PalletTown", "width": 24, "height": 20,
  "camera": { "preset": "default", "pitch": 55, "fov": 24, "view": 11 },
  "grid": {            // row-major, width * height
    "walkable": [0, 1, ...], "height": [...], "elevation": [...],
    "behavior": ["MB_NORMAL", ...], "class": ["ground", ...]
  },
  "connections": [...], "warps": [...], "objects": [...], "signs": [...],  // from the decomp map.json
  "structures": { "buildings": [...], "objects": [...] },                   // what the stand-up rule found
  "atlas": { "file": "atlas.png" },
  "quads": [ { "k": "wall", "p": [12 numbers], "uv": [u0, v0, u1, v1], "a": 0 } ]
}
```

- World space: `x` = column, `z` = row (south is +z), `y` = up. 1 unit = 1 tile.
- `p` holds 4 corners: bottom-left, bottom-right, top-right, top-left *as seen in the texture*.
- `uv` is a pixel rect in the atlas with v growing downward. `a: 1` means alpha-tested (cutout).
- `k` is `ground`, `water`, `step`, `wall`, `roof`, `side`, or an object class.

Quads in JSON keep the format engine-neutral: the game reads them with
three.js today, and a glTF export could be generated from the same data if
another renderer ever needs it.

Alongside the maps, `build/data/` holds what the whole bake shares:

```jsonc
// world.json
{
  "format": { "name": "pokered3d-world", "version": 1 },
  "maps": [ { "map": "PalletTown", "area": 0, "ox": 0, "oy": 0 }, ... ],  // offsets in tiles
  "start": { "map": "PalletTown_PlayersHouse_2F", "x": 6, "y": 6, "facing": "down" }  // or null
}
// scripts.json: { "scripts": { label: [[command, ...args]] }, "text", "consts", "textColors", "startFlags" }
// music.json:   { "songs": { name: song }, "samples": { name: 8-bit PCM, base64 }, "waves" }
// pokemon.json: { "species": { SPECIES_…: { name, base, types, abilities, growth, genderRatio, learnset, … } },
//                 "moves": { MOVE_…: { name, type, power, accuracy, pp, … } }, "natures", "abilities",
//                 "pics": { SPECIES_…: { front, back, icon } } }   // PNG data URIs
// items.json:   { "items": { ITEM_…: { name, price, pocket, description, param, fieldUse, important } }, "startMoney" }
// battle.json:  { "types": { "chart": [[attacker, defender, x10]], "foresight", "names" },
//                 "wild": { "slotRates", "rodGroups", "maps": { MAP_…: { land, water, rockSmash, fishing } } },
//                 "trainers": { TRAINER_…: { name, class, className, double, party, money, pic, music, … } },
//                 "trainerPics", "playerPics", "terrains": { BATTLE_TERRAIN_…: PNG data URI }, "music" }
```

`src/data/types.ts` types every one of these files.

## Planned rule sets

| Rule set | Status | Notes |
|---|---|---|
| Metatile classification | **done** | All of the above |
| Animation tagging | **done** | Ranges read from `src/tileset_anims.c` |
| Height | **done** | Cliffs on routes will need real elevation changes to test |
| Stand-up | **done** | Buildings, objects, cutouts, ground under |
| Scenes and triggers | **done** | Map scripts, step-on triggers, scripted walking, script warps; FireRed's opening plays |
| Talking and signs | **done** | Decomp scripts and text; common commands; battles and menus skipped |
| Items | **done** | Items from `src/data/items.json`; the menus' own lines from the decomp's text (`tools/baker/lib/items.js`) |
| Pokémon | **done** | Species, moves, natures and pictures from the decomp (`tools/baker/lib/pokemon.js`) |
| Music | **done** | Map songs from the decomp's MIDI, voicegroups and samples |
| Battle data | **done** | Type chart, wild tables, trainers, pictures, backgrounds and battle songs (`tools/baker/lib/battle.js`); the battles themselves are next |
| Interiors and warps | **done** | Doors, exit mats, stairs; void, low blocks, flat floors |
| Map connections | **done** | Maps placed by their connection offsets; walk across edges |
| Prop grouping | partly | Buildings are grouped; objects are per-column chunks so far |
| Billboards | **done** | Real overworld sprites from the decomp, yaw-only, screen-size matched, shadows, hidden flags (`billboards.yaml`) |
| Materials and colour | later | Per-class shading, palette grading, water shader |
| Per-map camera | **started** | Presets in `camera.yaml`; `rules/maps/<Map>.yaml` can pick one |

## Interiors

- **Void** (the black around rooms) is detected as blocked and at least 90% black. It draws nothing, and it ends wall columns like the map edge. Void in front of furniture counts as floor, since it's just the room's front edge.
- **Freestanding props** (floor in front and behind, at most 3 rows) aren't walls. Indoors they become **low blocks** (`standup.yaml` `blocks`): art on a raised top with a short front face. Shelves, PCs and TVs (`furniture`, from behaviors) still stand.
- **Interiors are flat** (`height.yaml` `flat_indoors`): indoor elevation only sorts sprites.
- **Visibility** at the start comes from the decomp's new-game flag script, so Oak is hidden but Blue and the starters wait in the lab.
- **Warps** follow FireRed: walk into a door, press the arrow's direction on an exit mat, or step onto stairs. Other cells listed as warps are inert.

## Pokémon

`tools/baker/lib/pokemon.js` reads the species table (base stats, types,
abilities, growth rate, gender ratio), names, level-up learnsets, every move,
the natures and their stat table straight from the decomp. All 411 species
and 354 moves are baked as data. Pictures (front, back and the two-frame party
icon, in each species' own palette) are baked only for the species the baked
scripts mention (the three starters), that live wild on the baked maps, or
that a baked trainer sends out.

The game creates Pokémon with FireRed's own formulas (`src/pokemon/mon.ts`):
a 32-bit personality decides nature, gender and ability; IVs come from two
16-bit rolls; stats, experience by growth rate and starting moves follow
`src/pokemon.c`. New Pokémon draw on their own random stream, so rolling one
never shifts how people wander. Each species also gets its National Pokédex
number, from `sSpeciesToNationalPokedexNum`.

## Items and the menus' text

`tools/baker/lib/items.js` bakes every item from the decomp's
`src/data/items.json`, and the starting money from `new_game.c`. What the
menus say (the save dialogue, Oak telling you it isn't the time to use an
item, the toss question) is FireRed's own text, read by label from
`data/text/*.inc` and `src/strings.c` and merged into `scripts.json`, so the
text box shows it exactly as it shows script text.

## Battle data

`tools/baker/lib/battle.js` bakes what battles will need, all parsed from
the decomp:

- **Types:** `gTypeEffectiveness` as FireRed lists it, multipliers x10 (0,
  5, 20; pairs not listed are 10). The entries after the Foresight separator
  (Normal and Fighting on Ghost) are kept apart, as they stop applying once
  Foresight is used. Type names come from `gTypeNames`, and which types are
  physical from their order (`IS_TYPE_PHYSICAL`: below `TYPE_MYSTERY`).
- **Wild Pokémon:** each baked map's FireRed table from
  `src/data/wild_encounters.json` (the LeafGreen ones are skipped): land,
  water, Rock Smash and fishing, each with the map's rate and its slots, plus
  the slot weights and which fishing slots each rod uses.
- **Trainers:** every trainer a baked script's `trainerbattle_*` names, from
  `src/data/trainers.h` and `trainer_parties.h`: class and its name,
  party (level, IVs, held item and moves where the decomp gives them, and
  the fixed personality `CreateNPCTrainerParty` gives each one, summed from
  the trainer's and species' names in the GBA encoding of `charmap.txt`), items,
  AI flags, the prize-money factor (`gTrainerMoneyTable`), and the music for
  being spotted, the battle and the win, read from the switches in
  `PlayTrainerEncounterMusic`, `GetBattleBGM` and the victory code. The
  rival's name is the decomp's placeholder; the game shows the rival's name.
- **Pictures:** each baked trainer's front picture with its palette and
  vertical offset, and the player's back pictures (Red and Leaf, five 64x64
  frames each). Pokémon pictures cover the wild and trainer Pokémon too,
  and each carries where battle puts it: `gMonFrontPicCoords` /
  `gMonBackPicCoords` offsets and `gEnemyMonElevation`.
- **Backgrounds:** every terrain `BattleSetup_GetTerrainId` can pick
  (except underwater), drawn from `sBattleTerrainTable`'s tiles, tilemap
  and palette into the 240x112 scene above the text box. Colour 0 is left
  transparent, as on the GBA.
- **Songs:** wild and trainer battle themes, victory themes and the catch
  fanfare are added to `music.json`. `scripts.json` gains the
  `RIVAL_BATTLE_*` flags `trainerbattle_earlyrival` takes.
- **Text:** every string in `src/battle_message.c` by its C name, and the
  stat names in `gStatNamesTable`'s order, placeholders kept for the battle
  screen to fill.

## Music

Each map's `music` (`MUS_PALLET`, …) is baked from the decomp's sound data by
`tools/baker/lib/music.js`: the song's MIDI (with its `[` / `]` loop markers),
its voicegroup from `midi.cfg`, and the samples and wave shapes those voices
use. Every note is resolved to the exact voice FireRed's sound engine would
pick (key-split tables and drum kits included), so the game's small
WebAudio synth (`src/audio/music.ts`) only plays voices: 8-bit samples with their loop points,
square waves at the GB duty cycles, the wave channel and noise, with the
engine's envelopes, volume, pan, pitch bend and vibrato. Music starts on the
first key press or tap (browsers require one) and fades between songs when
the map's music changes.

## Talking and signs

Press A (Z, Enter or Space, or the on-screen A button) to talk to the person
you're facing, across a counter too, or to read a sign. The scripts and text
are the decomp's own, baked by `tools/baker/lib/scripts.js` from everything
the maps' people and signs can reach. The game's script player (`src/scripts/vm.ts`) runs the
common commands: messages (NPC, sign, yes/no), text colour by sprite, flags
and variables starting from a new save, `goto`/`call`/`switch` and their
conditions, simple movements and `!` emotes, items given or found. Commands
for things that don't exist yet (battles, the bag, fanfares, menus) are
skipped, so those scenes play their lines and stop. `{PLAYER}` and `{RIVAL}`
are RED and BLUE.

### Scenes

Map scripts run as in FireRed: each map's transition script and warp-in
table when it loads (temporary vars and flags are cleared first), its
per-frame table whenever no script is running, and step-on triggers when
the player finishes a step on one. People appear and disappear by their
visibility flags (`removeobject` sets the flag; clearing it brings them back
at their spot), scripts walk people along movement lists without collision
checks, `warp` moves the player between maps, and `playbgm` / `savebgm` /
`fadedefaultbgm` change the music. This plays FireRed's opening: Oak stops
you at the edge of town, leads you to the lab, Blue complains, you choose a
starter, Blue takes his, and he challenges you on the way out (the battle
itself is skipped for now).

The game's `window.pokered` test hook can drive all of this: `go(map, x,
y)`, `walk(dir, seconds)`, `press('a')`, `tick(seconds)`, `run(label)`,
`text()`, `people()` and `lastCommand`. The opening is played this way as
a golden play-through (see the main README's Testing section).

Not yet: trainer battles, the start menu, Pokémon pictures (`showmonpic`).

### Known gaps

- Rocky cliffs and mountain tops come out as `roof`. The geometry is right (a raised surface), but they want their own class once the height rule exists.
- Shoreline metatiles that share animated water-edge tiles can come out as `ground` or `roof`.
- The synth approximates the GB channels' envelope timing and the engine's reverb; songs will sound close to FireRed, not identical.
- NPCs with a variable sprite (`OBJ_EVENT_GFX_VAR_*`) are chosen at runtime by the game and show as a placeholder marker.
