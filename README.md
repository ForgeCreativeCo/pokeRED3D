# pokeRED3D

Pokémon FireRed, rebuilt as a tilted top-down 2.5D game that runs in the
browser.

Nothing is hand-made. The maps, sprites, scripts, text and music all come
from the [pret/pokefirered](https://github.com/pret/pokefirered)
decompilation. A set of **rules** (plain YAML, committed here) says how
FireRed's flat, top-down tiles become a 3D scene, and a **baker** applies
them offline. The game only ever loads the baked output.

```
pret/pokefirered (decomp)  +  rules/*.yaml  ──►  tools/baker  ──►  build/  ──►  game (browser)
   maps, tiles, sprites,         how tiles          classify,        baked maps,
   scripts, text, music          stand up           bake, pack       songs, scripts
```

> **No Nintendo material is in this repository.** The decomp is cloned into
> `vendor/`, and everything derived from it goes to `build/`. Both are
> gitignored. The rules and tools here are original work.

## What's playable now

FireRed's opening, from a new save:

1. You wake up in Red's bedroom (where the game's `new_game.c` puts you).
2. Go downstairs and talk to Mom, then head out into Pallet Town.
3. Walk north and Professor Oak stops you at the edge of town ("Hey! Wait!
   Don't go out!"), then leads you to his lab.
4. Blue complains, Oak offers three Poké Balls, and you choose your starter:
   a real level 5 Pokémon joins your party. Blue takes his, then challenges
   you on the way out.
5. Your first battle, with Oak talking you through it as in FireRed. Win or
   lose (no whiteout here: Oak pays), Blue says his piece and leaves.
6. Wild Pokémon in Route 1's tall grass: Pidgey and Rattata, at FireRed's
   rates. Lose and you wake up at home, a little poorer, with Mom fussing.
7. Catch them: open the BAG in battle and throw a POKé BALL (or use a Potion).
   A catch joins your party, or goes to the PC when the party is full, and
   the Pokédex marks it caught.
8. Oak's errand: in Viridian City's Poké Mart the clerk hands you Oak's
   Parcel. Take it back to the lab, and Oak gives you the Pokédex and five
   Poké Balls while Blue barges in to brag.
9. Viridian's Pokémon Center: the nurse heals your party, and from then on
   whiting out wakes you there, where she patches you up.

Along the way:

- **Seven areas:** Pallet Town, Route 1, Route 21 North and Viridian City as
  one connected outdoor world, plus Red's house (both floors), Blue's house,
  Oak's lab, and Viridian's Pokémon Center and Poké Mart.
- **Movement like FireRed:** grid walking, turning on the spot, ledge hops,
  tall grass you wade into, doors, exit mats and stairs.
- **People:** real overworld sprites with walk cycles and shadows, wandering
  inside their ranges, shown or hidden by the game's own flags.
- **Talking and signs:** press A to talk or read, in a FireRed-style text box
  coloured by speaker, with the original scripts and text.
- **Music:** each map's song, played by a small synth rebuilt from FireRed's
  own instruments and samples.
- **Compare mode:** the original 240×160 GBA screen side by side with the
  2.5D view, both driven by the same game state.
- **Pokémon:** every species and move from the decomp, created with
  FireRed's own formulas (personality, nature, IVs, stats, experience,
  starting moves). Oak shows each starter's picture as you look at it, and
  the party screen and summary pages (POKéMON INFO, POKéMON SKILLS, KNOWN
  MOVES) follow FireRed's layout.
- **Start menu:** POKéDEX and POKéMON (once you have them), BAG, your
  trainer card, SAVE, OPTION and EXIT. The Bag has FireRed's pockets and
  item descriptions, and items scenes give you land in it (the Route 1
  clerk's free Potion). OPTION's text speed changes how fast text types.
- **Saving:** FireRed's save dialogue, kept in your browser. Reopen the game
  and CONTINUE puts you back where you saved, with your party, Bag, money,
  Pokédex, time and every story flag.

Not yet: using items outside battle, nicknames, buying things.

## Getting started

You need Node.js and git.

```bash
npm install
npm run setup:decomp     # once: clones pret/pokefirered into vendor/
npm run bake -- PalletTown Route1 Route21_North ViridianCity PalletTown_PlayersHouse_1F PalletTown_PlayersHouse_2F PalletTown_RivalsHouse PalletTown_ProfessorOaksLab ViridianCity_PokemonCenter_1F ViridianCity_Mart
npm run dev              # then open http://localhost:5173
```

**Controls:** WASD or the arrow keys to walk; Z or Space for A (talk, read,
continue); X or Backspace for B; Enter for START (the menu). There's an
on-screen d-pad, A button and START button for phones. Music starts on your
first key press or tap.

Other commands:

| Command | What it does |
|---|---|
| `npm run classify -- <Map> …` | Classify a map's tiles and write debug overlays to `build/debug/` |
| `npm run bake -- <Map> …` | Bake maps (plus their songs, scripts, Pokémon, items and battle data) into `build/` for the game to load |
| `npm run dev` | Run the game on http://localhost:5173, live-reloading as `src/` changes |
| `npm run build` | Typecheck and build the game into `dist/`, with the baked data alongside |
| `npm run build:single` | Build one self-contained page, `dist-single/index.html`, with the baked data inside; it opens straight from disk |
| `npm run build:artifact` | The single-file page shaped for publishing as a claude.ai Artifact: `dist-single/pokered3d.html` |
| `npm test` | Unit tests |
| `npm run playthrough -- <name> --check [dev|dist|single]` | Play a scene (`opening`, `party`, `save`, `battle`, `wild`, `catch`, `parcel`) in a build and compare it with its golden transcript |

Map names are folder names under `vendor/pokefirered/data/maps`. The first map
in a bake is the origin; connected maps join it, and interiors become their
own areas.

## How it works

The rules, the baked format and every decision behind them are documented in
**[rules/README.md](rules/README.md)**. In short:

| Stage | What happens | Where |
|---|---|---|
| **Classify** | Every metatile gets a render class (ground, wall, roof, tree, prop, water, void, …) from placement statistics over every map, its behavior, animations, and hand overrides | `classifier.yaml`, `behaviors.yaml`, `animations.yaml`, `tilesets/*.yaml` |
| **Height** | Elevation becomes world height (interiors are flat) | `height.yaml` |
| **Stand-up** | Buildings stand as walls with sloped roofs, objects stand as cutout quads, indoor furniture becomes low blocks, all over the exact cells the collision grid blocks | `standup.yaml` |
| **Billboards** | Player and NPC sprites face the camera at true size (1 tile per 16 px) | `billboards.yaml` |
| **Camera** | Outdoor and interior camera presets: close and low behind the player | `camera.yaml` |
| **Music** | Each song's MIDI, voicegroup and samples, resolved to the voices FireRed would play | `tools/baker/lib/music.js` |
| **Scripts** | Event scripts and text reachable from people, signs, triggers and map scripts | `tools/baker/lib/scripts.js` |
| **Battle data** | Type chart, wild Pokémon, trainers and their parties, trainer pictures, battle backgrounds | `tools/baker/lib/battle.js` |

The look these rules produce, and what every new map has to keep, is written
up in [docs/view-style.md](docs/view-style.md).

The game itself is TypeScript and three.js in `src/`, built with Vite. It
loads the baked files (`build/data/*.json` and each map's `map.json` and
`atlas.png`) and plays them:

| Module | What it does |
|---|---|
| `data/` | Types for every baked file, and the loader |
| `world/` | The loaded maps as one grid: areas, cells, walkability, warps, triggers |
| `characters/` | People: stepping, ledge hops, wandering, and their sprite billboards |
| `scripts/` | Story state (flags, variables, party, Bag, money, Pokédex, time, options), and the player for the decomp's event and map scripts |
| `items/` | The Bag: pockets, stacks, FireRed's limits |
| `save/` | Saving and loading the story and where you stand, in browser storage |
| `pokemon/` | Pokémon as FireRed keeps them: creating one, stats, experience, nature, gender, ability, starting moves, status |
| `battle/` | Battles as FireRed runs them, as pure logic: damage, types, accuracy, critical hits, turn order, move effects, status, experience and level-ups, running; each turn comes back as events for the battle screen |
| `ui/` | The text box and YES/NO, emotes, the Pokémon picture window, the start menu and its screens (party, summaries, Bag, trainer card, OPTION, Pokédex), the Continue screen, the battle screen, the tuning panel |
| `audio/` | The synth that plays FireRed's songs |
| `input/` | Keyboard, d-pad and A button |
| `render/` | The scene, the follow camera, and the GBA view for compare mode |
| `game.ts` | Wires it together and runs the frame |

World, character, script, Pokémon, battle, Bag and save logic don't touch three.js or
the page, so they run under unit tests.

**The footprint principle** keeps it playable: anything raised in 3D covers
exactly the cells FireRed blocks for it, plus its walk-behind row. Visuals and
gameplay can't disagree, so there are no invisible walls, and roofs and tree
tops still hide you where they did on the GBA.

## Repository layout

```
rules/                 the rule sets (YAML) and their documentation
  tilesets/            per-tileset hand overrides
tools/
  baker/
    classify.js        npm run classify
    bake.js            npm run bake
    lib/               decomp readers, classifier, baker, sprites, music, scripts, Pokémon, items
    debug/             the classification viewer
src/                   the game (TypeScript, three.js), see "How it works"
index.html             the game's page
tests/
  unit/                unit tests on small hand-made maps
  playthrough/         scripted play-throughs and their golden transcripts
vendor/pokefirered/    the decomp (cloned, gitignored)
build/                 everything derived from it (gitignored)
dist/, dist-single/    game builds (gitignored)
```

## Testing

`npm test` runs the unit tests: the world grid, people and wandering, the
game clock, the script player, the Pokémon formulas (stats, natures,
experience, starting moves, checked against values worked out by hand), the
battle rules (damage, types, accuracy, crits, turn order, experience, escaping,
also worked by hand) and whole battles against Blue's Squirtle and Pidgey, the
Bag, and saving (a round trip, plus bad saves and storage that refuses), on
small hand-made data, so they need no decomp.

The game exposes a test hook, `window.pokered`, that drives it from a script:

```js
await pokered.go('PalletTown', 12, 3);  // warp somewhere
await pokered.walk('up', 0.6);          // hold a direction for some game time
await pokered.press('a');               // press A
pokered.text();                         // what the text box says
pokered.where();                        // map, cell and facing
pokered.people();                       // everyone in the area
pokered.party();                        // the party: species, level, HP, moves
pokered.bag();                          // the Bag's contents
await pokered.press('start');           // open the start menu; menu() says which screen is up
pokered.give('SPECIES_BULBASAUR', 5);   // add a Pokémon to the party
await pokered.battle({ wild: 'SPECIES_PIDGEY', level: 3 });  // or { trainer: 'TRAINER_…' }, where you stand
pokered.battleState();                  // the battle's menu or text, and both HPs
```

**Play-throughs** use it to play a scene end to end in a real browser
(Playwright with your installed Chrome) and compare every step with a golden
transcript: where the player is, what the text box says, who is where, and
the story's flags and variables, and the party, any open menu and any
Pokémon picture once there are some. `tests/playthrough/opening.json` plays
the opening from the bedroom through Blue's battle and out of the lab;
`party.json` plays it again,
then opens the party, reads every summary page and switches; `save.json` gets
the Route 1 clerk's Potion, checks the Bag and the trainer card, saves,
reloads the page and continues; `battle.json` beats Blue's Squirtle with
Tackle, then meets a wild Pidgey in Route 1's grass and runs. A `["reload"]`
step reloads the page with its storage, as closing and reopening the game
would; `["advance"]` stops at battle menus as it does at a YES / NO, and
`["fight"]` uses the first move every turn until the battle is over, and
`["wander"]` walks down and up until a wild Pokémon appears. `wild.json`
walks Route 1's grass into a Pidgey and beats it, then into a Rattata and runs;
`catch.json` tries a Potion that won't have any effect, then throws POKé BALLs
with `["catch"]` until a Pidgey is caught. `parcel.json` plays the opening
through Blue's battle, then Oak's errand: the Viridian Mart clerk's parcel
scene, the nurse healing (and `["whiteOut"]` waking up at her Center), and
Oak's Pokédex scene back at the lab.

```bash
npm run playthrough -- opening --check          # against the dev server
npm run playthrough -- opening --check single   # against the single-file build
npm run playthrough -- opening                  # re-record the golden
```

Runs are reproducible: the page is opened with `?seed=1` (people wander by
the game's own seeded random numbers) and animation frames switched off, so
only the hook advances the game. The golden keeps a hash of each text box,
not FireRed's text; a readable copy of the last run goes to
`build/playthrough/`. The play-throughs need the decomp and a bake, so they
run locally.

## Roadmap

The game stays on the web: TypeScript and three.js, built entirely in code,
running in any browser and publishable as a single page.

| # | Step | What it covers |
|---|---|---|
| ✓ | **Rules and baker** | Tile classification, height, stand-up, billboards, interiors, map connections |
| ✓ | **Overworld** | Walking, ledges, tall grass, warps, compare mode, music |
| ✓ | **Talking and scenes** | Text box, script player, map scripts, step-on triggers, the opening sequence |
| ✓ | **Restructure into a game project** | TypeScript + Vite + three.js, split into modules (world, characters, scripts, UI, audio, input); baked data loaded as files; unit tests and scripted play-throughs; single-file builds for the test page; the opening replays the same before and after |
| ✓ | **Pokémon and the party** | Species, stats, moves and learnsets from the decomp; `givemon` makes the starter real; Pokémon pictures in scenes; party screen and summaries |
| ✓ | **Start menu and saving** | The menu (Pokédex, Pokémon, Bag, trainer card, Save, Option); the Bag and item commands; save and Continue |
| ✓ | **Battles** | ✓ battle data baked (types, wild tables, trainers, pictures, backgrounds, songs) · ✓ core mechanics ported from the decomp (damage, types, accuracy, status, experience) · ✓ battle screen and UI · ✓ Blue in the lab (`trainerbattle_earlyrival`, Oak's tutorial) · ✓ wild encounters in tall grass, and whiting out · ✓ catching, and the Bag in battle |
| 6 | **Grow the world** | ✓ Viridian's Pokémon Center and Poké Mart (back walls and counters ruled for the new tilesets), Oak's Parcel and the Pokédex, the nurse and heal points · Viridian Forest, Pewter City and onwards, tuning the rules as new tilesets arrive |

### Polish track

This runs alongside the steps above:

- **Full-colour pass:** lighting and shadows, ambient occlusion where walls
  meet the ground, a water shader, animated flowers and water, time-of-day
  tint.
- **Rule refinements:** cliffs and mountains as their own class, staircases,
  tree rows at map edges, building side walls and roof textures.
- **Beyond the edges:** something to look at past the loaded maps instead of
  open sky.
- **Hero pieces (decision pending):** whether to stay purely generated from
  the GBA art, or allow hand-made replacements for key buildings and objects.

### Known gaps

- Whiting out takes you to the last heal point (Red's house, or the Viridian
  Pokémon Center once you've been in). FireRed shows the "scurried" line on
  a black screen; here the room is already showing. Repel and the other
  encounter-rate items aren't in yet. Double battles (Route 21 North's Lil &
  Ian) still just say their challenge.
- Shopping isn't in yet: a Poké Mart clerk says hello and goodbye, with no
  BUY / SELL menu. The nurse's healing jingle and the Center's machine
  animation are a pause, as fanfares are elsewhere. The Pokémon Center's
  2F isn't baked yet.
- Map scripts that change tiles at runtime (`setmetatile`) aren't applied:
  the Viridian Mart's questionnaire stand is already on the counter before
  you have the Pokédex.
- There's no naming screen yet: saying YES to a nickname keeps the species
  name.
- Outside battle, items can't be used yet (Oak tells you it isn't the time),
  and there's no GIVE until Pokémon can hold items. In battle, balls and HP
  medicine work; status medicine (Antidote and the rest) doesn't yet. The PC
  keeps what's caught with a full party, but there's no PC to visit yet.
- A save lives in the browser that made it (each Artifact link is its own
  site), so it doesn't follow you to another browser or device.
- NPCs whose sprite is chosen at runtime (`OBJ_EVENT_GFX_VAR_*`) take it
  from the map's own scripts (Viridian's old man); one set from anywhere
  else would show nothing.
- With the camera low and fixed facing north, a building hides Red for a
  few rows behind it (his silhouette shows through). Viridian's tight grid
  makes this common; fading the building in the way is the planned fix.
- The synth approximates the Game Boy channels' envelope timing and the
  engine's reverb, so songs sound close to FireRed but not identical.
- Rocky cliffs stand as level-topped blocks built like buildings, not as
  their own class yet, and some shoreline tiles come out as ground or roof.
