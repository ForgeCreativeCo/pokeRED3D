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
4. Blue complains, Oak offers three Poké Balls, and you choose your starter.
   Blue takes his, then challenges you on the way out.

Along the way:

- **Five areas:** Pallet Town, Route 1, Route 21 North and Viridian City as
  one connected outdoor world, plus Red's house (both floors), Blue's house
  and Oak's lab.
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

Not yet: battles, the start menu and Bag, Pokémon data, saving.

## Getting started

You need Node.js and git.

```bash
npm install
npm run setup:decomp     # once: clones pret/pokefirered into vendor/
npm run bake -- PalletTown Route1 Route21_North ViridianCity PalletTown_PlayersHouse_1F PalletTown_PlayersHouse_2F PalletTown_RivalsHouse PalletTown_ProfessorOaksLab
npm run serve            # then open http://localhost:5179
```

**Controls:** WASD or the arrow keys to walk; Z, Enter or Space for A (talk,
read, continue); X or Backspace for B. There's an on-screen d-pad and A button
for phones. Music starts on your first key press or tap.

Other commands:

| Command | What it does |
|---|---|
| `npm run classify -- <Map> …` | Classify a map's tiles and write debug overlays to `build/debug/` |
| `npm run bake -- <Map> …` | Bake maps (plus their songs and scripts) and write the preview to `build/debug/view3d.html` |
| `npm run serve` | Serve `build/` on localhost (bakes with several maps are too big to open from disk) |

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
| **Billboards** | Player and NPC sprites face the camera and are sized to match FireRed on screen | `billboards.yaml` |
| **Camera** | Outdoor and interior camera presets | `camera.yaml` |
| **Music** | Each song's MIDI, voicegroup and samples, resolved to the voices FireRed would play | `tools/baker/lib/music.js` |
| **Scripts** | Event scripts and text reachable from people, signs, triggers and map scripts | `tools/baker/lib/scripts.js` |

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
    lib/               decomp readers, classifier, baker, sprites, music, scripts
    debug/             the preview page and the classification viewer
  serve.js             npm run serve
vendor/pokefirered/    the decomp (cloned, gitignored)
build/                 everything derived from it (gitignored)
```

## Testing

The preview exposes a test hook, `window.pokered`, that drives the game from a
script. Every feature so far was checked by playing it through this hook:

```js
await pokered.go('PalletTown', 12, 3);  // warp somewhere
await pokered.walk('up', 0.6);          // hold a direction for some game time
await pokered.press('a');               // press A
pokered.text();                         // what the text box says
pokered.where();                        // map, cell and facing
pokered.people();                       // everyone in the area
```

Automated play-throughs built on it are part of the next step.

## Roadmap

The game stays on the web: TypeScript and three.js, built entirely in code,
running in any browser and publishable as a single page.

| # | Step | What it covers |
|---|---|---|
| ✓ | **Rules and baker** | Tile classification, height, stand-up, billboards, interiors, map connections |
| ✓ | **Overworld** | Walking, ledges, tall grass, warps, compare mode, music |
| ✓ | **Talking and scenes** | Text box, script player, map scripts, step-on triggers, the opening sequence |
| 2 | **Restructure into a game project** | TypeScript + Vite + three.js, split into modules (world, characters, scripts, UI, audio, input); baked data loaded as files; unit tests and scripted play-throughs; single-file builds for the test page; the opening replays the same before and after |
| 3 | **Start menu and saving** | Pokédex, Pokémon, Bag, player card and Save; a working Bag; save and load |
| 4 | **Pokémon and the party** | Species, stats, moves and learnsets from the decomp; `givemon` makes the starter real; party screen and summaries |
| 5 | **Battles** | a. battle scene and UI · b. core mechanics ported from the decomp (damage, types, accuracy, status, experience) · c. wild encounters in tall grass · d. trainer battles, starting with Blue in the lab · e. catching |
| 6 | **Grow the world** | Viridian Forest, Pewter City and onwards, tuning the rules as new tilesets arrive |

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

- Battles are skipped: trainers say their challenge and the scene continues.
- NPCs whose sprite is chosen at runtime (`OBJ_EVENT_GFX_VAR_*`) show as a
  placeholder marker.
- The synth approximates the Game Boy channels' envelope timing and the
  engine's reverb, so songs sound close to FireRed but not identical.
- Rocky cliffs are classed as roofs, and some shoreline tiles come out as
  ground or roof.
