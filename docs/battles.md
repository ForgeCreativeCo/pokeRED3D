# Battles: handoff notes

Battles are the next roadmap step (README, step 5). These notes are for
picking the work up cold: what exists, where battles plug in, what the decomp
already gives you, and the conventions that keep the project's tests honest.
Read the [README](../README.md) and [rules/README.md](../rules/README.md)
first for the overall shape.

## Where things stand

- **Pokémon are real.** `src/pokemon/mon.ts` creates them with FireRed's
  formulas (personality, nature, IVs, stats, experience by growth rate,
  starting moves). `Story.party` holds up to six. The starter from Oak's lab
  is a real level 5 Pokémon.
- **Battle data is baked** (step 1 below is done). `build/data/battle.json`
  has the type chart, every baked map's FireRed wild tables, every trainer
  the baked scripts battle (Blue's three lab parties, Route 21 North's
  trainers) with class, party, prize money and music, trainer front pictures,
  the player's back pictures and the battle backgrounds. Battle songs are in
  `music.json`; the wild and trainer Pokémon have pictures in `pokemon.json`.
  Baked maps now carry `mapType` and `battleScene` for picking a background.
  `rules/README.md` ("Battle data") documents all of it.
- **The Pokémon data is baked.** `build/data/pokemon.json` has all 411 species (base
  stats, types, abilities, growth, gender ratio, catch rate, exp yield,
  learnset, National Pokédex number) and all 354 moves (type, power,
  accuracy, PP, effect, effect chance, target, priority, contact).
  `build/data/items.json` has every item (POKé BALLs included) with its
  pocket.
- **Battles are skipped.** In `src/scripts/vm.ts`, `trainerbattle_single`
  and `trainerbattle_double` show the trainer's intro text and end the script.
  `trainerbattle_earlyrival` (Blue in the lab) isn't handled at all: it falls
  through `default`, so the scene goes straight on to Blue's after-battle
  lines. Tall grass has no encounters.

## Where battles plug in

| Hook | Where | What changes |
|---|---|---|
| Trainer battles | `ScriptVM.run` in `src/scripts/vm.ts`: `trainerbattle_single`, `_double`, `_earlyrival` | Start a battle, await it, set `VAR_RESULT` (won / lost) and continue the script the way FireRed's `trainerbattle` macro does (`asm/macros/event.inc`) |
| Wild encounters | `Game.frame` in `src/game.ts`, where a finished player step checks stairs and triggers | After a step onto `MB_TALL_GRASS` (see `src/world/behaviors.ts`), roll for an encounter |
| The battle screen | a new `src/battle/` (logic) and `src/ui/battle*.ts` (screen) | Like the start menu: while a battle is up, `Game.frame` hands it the frame and the world waits behind it |
| Party, Bag | `Story.party`, `Story.bag` | Battles read and change them: HP, PP, status, experience, items used, Pokémon caught |
| Music | `Game.music.play(...)` | Battle themes in, the map's music back out |

Keep battle logic free of three.js and the page, as the world, script,
Pokémon, Bag and save code is, so it runs under unit tests.

## What was baked

Done in `tools/baker/lib/battle.js`, except battle text. These were added to the baker (`tools/baker/`) the way `pokemon.js` and `items.js`
read the decomp: parse the source, never retype tables.

| Data | Decomp source | Notes |
|---|---|---|
| Type chart | `gTypeEffectiveness[]` in `src/battle_main.c` | Triples (attacker type, defender type, multiplier), ending in a marker; the Foresight entries come after a separator |
| Wild encounters | `src/data/wild_encounters.json` | Each map has a **FireRed** and a **LeafGreen** table (`base_label` ends `_FireRed` / `_LeafGreen`): bake the FireRed one. `land_mons` has an `encounter_rate` and 12 slots |
| Trainers and parties | `src/data/trainers.h`, `src/data/trainer_parties.h` | Blue's lab battle is `TRAINER_RIVAL_OAKS_LAB_SQUIRTLE` / `_BULBASAUR` / `_CHARMANDER`, one per starter he can take |
| Trainer pictures | `graphics/trainers/front_pics`, `back_pics`, `palettes` | Recolour from the palettes, as `pokemon.js` does for Pokémon |
| Battle backgrounds | `graphics/battle_terrain/` | Pick by the map's `battle_scene` and the tile you're on |
| Battle music | `MUS_VS_WILD`, `MUS_VS_TRAINER`; the rival uses `MUS_ENCOUNTER_RIVAL` before | `tools/baker/lib/music.js` bakes any song by name: add them to the bake's song list |
| Pokémon pictures | `pokemon.js`, `bakePokemon(withPictures)` | Pictures are baked only for species asked for. Add every species in the baked maps' encounter tables and trainer parties |
| Battle text (**not yet**) | `data/text/*.inc`, `src/strings.c`, `data/battle_scripts_*.s` | "Wild PIDGEY appeared!", "Go! BULBASAUR!" and the rest: bake them by label with `uiText` in `tools/baker/lib/items.js` so the text box shows them like any other text |

## FireRed's rules to port

Port these from the decomp, cite the function in a comment, and check them
against hand-worked values in unit tests, as `tests/unit/mon.test.ts` does
for stats.

| Rule | Source |
|---|---|
| Damage | `CalculateBaseDamage` in `src/pokemon.c`, then the random factor and STAB / type steps in `battle_script_commands.c` (`Cmd_damagecalc`, `Cmd_typecalc`, `Cmd_adjustnormaldamage`) |
| Physical or special | Gen 3 splits by **type**, not by move: types before `TYPE_MYSTERY` are physical |
| Accuracy and evasion | `Cmd_accuracycheck` |
| Critical hits | `Cmd_critcalc` |
| Experience | `Cmd_getexp`; level-ups use `expForLevel` in `src/pokemon/mon.ts` and learn moves from the species' learnset |
| Wild encounter rate and slots | `DoWildEncounterRateTest` and `ChooseWildMonIndex_Land` in `src/wild_encounter.c` (slot weights 20/20/10/10/10/10/5/5/4/4/1/1) |
| Catching | the catch formula in `Cmd_handleballthrow` (`battle_script_commands.c`), using the species' `catchRate` |
| Move effects | `effect` on each move (`EFFECT_HIT`, `EFFECT_ATTACK_DOWN`, …), implemented in `data/battle_scripts_1.s`. Start with the effects the starters, Blue and Route 1's Pokémon use |

## Conventions that matter

- **Random numbers come in separate streams** (`src/core/random.ts`):
  `random` for people wandering, `monRandom` for new Pokémon. Give battles
  their **own stream**, seeded from the same `?seed=`, so a battle roll can
  never shift where people wander or what a new Pokémon rolls. That's what
  keeps the recorded play-throughs stable.
- **Play-throughs are the regression net.** `tests/playthrough/*.json` are
  scripted runs; `golden/*.json` are their transcripts. When a change is
  meant to alter a transcript, re-record it, then **diff old against new and
  check that only the intended steps changed** before keeping it. Never
  re-record to make a failure go away. A battle play-through (choose Bulbasaur,
  fight Blue in the lab, walk into Route 1's grass) is the natural next one.
- **The test hook** (`src/testing/hook.ts`, `window.pokered`) drives the game
  from scripts. Extend it with what battles need (the battle's state as a
  string, like `menu()` reports menus), and the driver can call any hook
  method as a step.
- **Keep Nintendo material out of git.** Goldens hash FireRed's text rather
  than storing it. Species, move and item *names* and the decomp's constants
  are fine; dialogue, pictures and sounds stay in `build/`.
- **Line endings.** The repo checks files out with `core.autocrlf=true`, so
  working files have Windows line endings. Tools that match multi-line text
  in source files need to strip `\r` first; git normalises on commit.
- **Data files load two ways.** A new file under `build/data/` needs adding
  to `src/data/load.ts`, `vite.config.ts` (the single-file embed) and
  `src/vite-env.d.ts`, as `pokemon.json` and `items.json` were.

## Checking a change

```bash
npm run bake -- PalletTown Route1 Route21_North ViridianCity PalletTown_PlayersHouse_1F PalletTown_PlayersHouse_2F PalletTown_RivalsHouse PalletTown_ProfessorOaksLab
npm run typecheck
npm test
npm run build:single
npm run playthrough -- opening --check single
npm run playthrough -- party --check single
npm run playthrough -- save --check single
```

The play-throughs start their own dev or preview server, so stop any
running `npm run dev` first. To publish the test page,
`npm run build:artifact` writes `dist-single/pokered3d.html` for the
Artifact.

## Suggested order

1. ~~**Bake** the type chart, Route 1's FireRed encounters, Blue's lab parties,
   battle backgrounds, battle music and the extra Pokémon pictures.~~ Done.
   Battle text is still to bake, with the battle screen.
2. **Battle logic** in `src/battle/`, as pure code: turn order, damage,
   accuracy, crits, the starters' and Route 1's move effects, fainting,
   experience and levelling. Unit-test the formulas against hand-worked
   numbers.
3. **The battle screen**, in FireRed's layout: the two Pokémon on their
   platforms, HP boxes, FIGHT / BAG / POKéMON / RUN, the move list with PP and
   type, battle text through the existing text box.
4. **Blue in the lab** via `trainerbattle_earlyrival`: win or lose, the
   script carries on as in FireRed. Record a play-through of it.
5. **Wild encounters** in Route 1's tall grass, with RUN.
6. **Catching** with POKé BALLs from the Bag, filling the Pokédex
   (`Story.register`).
