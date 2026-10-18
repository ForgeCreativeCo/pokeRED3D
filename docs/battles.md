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
- **Trainer battles are real.** `trainerbattle_earlyrival` (Blue in the lab)
  and `trainerbattle_single` start a battle (see "Trainer battles in
  scripts" below). `trainerbattle_double` and the rematch variants still
  show the challenge and stop. Tall grass has wild Pokémon (see "Wild
  encounters" below).

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

Done in `tools/baker/lib/battle.js`. These were added to the baker (`tools/baker/`) the way `pokemon.js` and `items.js`
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
| Battle text | `src/battle_message.c` | Every string in the file, by its C name, with FireRed's placeholders kept (`battle.json` `text`); the party list's lines come from `src/strings.c` through `uiText` |

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
  `random` for people wandering, `monRandom` for new Pokémon, `battleRandom`
  for battles, all seeded from the same `?seed=`, so a battle roll can
  never shift where people wander or what a new Pokémon rolls. Pass
  `battleRandom` as the `Battle`'s `rng`. That's what
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

## The battle engine

`src/battle/rules.ts` holds the formulas, each citing its decomp function;
`src/battle/battle.ts` runs a single battle with them. The screen drives it:

```ts
const battle = new Battle({ pokemon, battle, party: story.party, playerId, foe: { trainer: 'TRAINER_RIVAL_OAKS_LAB_SQUIRTLE' }, rng: battleRandom });
battle.start();                          // events: the foe and your Pokémon come out
battle.turn({ type: 'move', slot: 0 });  // or { type: 'switch', party } / { type: 'run' }
// battle.phase: 'action' (choose again), 'switch' (call switchIn, or flee in the wild), 'over'
// battle.pendingMoves: answer each 'learn-prompt' with learnMove(slot to forget | null)
```

Every call returns events (`move`, `damage` with crit and effectiveness,
`miss`, `stat`, `status`, `cant-move`, `faint`, `exp`, `level-up`,
`learn-prompt`, `end` with prize money, …) for the screen to show in order,
as text, HP bars and animations. The engine changes the party in place: HP,
PP, status (`Mon.status`, kept after battle), experience, EVs, level, moves.

What's in: damage with stat stages, crits, STAB, the type chart and the
random factor; accuracy and evasion; priority and speed order; the attack
cancellers (sleep, freeze, flinch, confusion, paralysis); poison, bad poison,
burn and Leech Seed at the end of the turn; stat moves and the stat-change
side effects of hits; status moves and the status side effects of hits, with
type and ability immunities; draining, recoil and Struggle; fainting,
experience split among the Pokémon that fought (x1.5 from trainers and for
traded ones), EVs, level-ups and new moves; running (never from a trainer);
prize money, and the money lost on a whiteout (`whiteOutLoss`). Trainer
Pokémon are made as `CreateNPCTrainerParty` makes them, with the fixed
personality the baker works out.

Not yet: double battles (Route 21 North's Lil & Ian), held items, weather,
status medicine in battle, the "Will you switch?" prompt when a
trainer sends out the next one, trainers' AI (they pick a move at random,
like wild Pokémon), and move effects beyond the early game's: an unknown effect on a
damaging move still hits, and an unknown status move fails. `isHandled`
says which effects are in.

## The battle screen

`src/ui/battleScreen.ts` plays a battle: `Game.battle(foe, loseText?)`
starts one where the player stands and resolves with `'won'`, `'lost'` or
`'ran'`. While it's up, `Game.frame` only ticks the clock; the battle runs
on it like a script.

- **Layout:** everything sits in the GBA's 240x160 pixels, scaled to the
  window (`--p` is one GBA pixel, from container units). The background comes
  from `battleTerrain` (`src/battle/terrain.ts`, `BattleSetup_GetTerrainId`);
  Pokémon are centred at `sBattlerCoords`, moved by each picture's baked
  offset and a foe's elevation. HP boxes, the message window and the menus
  are CSS in FireRed's colours.
- **Text:** each engine event becomes its `src/battle_message.c` string, with
  the placeholders filled ("Foe" / "Wild" prefixes, the rival's name for
  rival classes). Messages ending in `\p` wait for A; others stay up for 48
  frames, as battle text does.
- **Flow:** the opening (trainer, sent out, "Go!"), FIGHT / BAG / POKéMON /
  RUN, the move list with PP and type, switching, "Use next POKéMON?" in the
  wild, move learning with "1, 2, and… Poof!", the win (prize money is
  added) or the whiteout text. Battle and victory songs play, and the map's
  song comes back after.
- **Phones:** an on-screen B button now sits beside A, for backing out of
  menus.

Not yet: status medicine, the stat window on a
level-up, the low-HP warning sound, move animations, a whiteout taking you
home on a black screen. The test hook's `battle()` starts any battle where
the player stands.

## Trainer battles in scripts

`src/scripts/vm.ts` runs them through `ScriptHost.battle` (the game's
`battle()`), waiting for the battle like any other scene step.

- **`trainerbattle_earlyrival`** (TRAINER_BATTLE_EARLY_RIVAL): no intro text,
  straight into battle. Its flags decide the rest, as in
  `CB2_EndTrainerBattle`: with `RIVAL_BATTLE_HEAL_AFTER` a loss heals the
  party instead of whiting out, and either way the script goes on with
  `VAR_RESULT` 1 if the player lost. The rival's lose and win texts come
  from the command. Afterwards the map's music plays again and the trainer is
  marked as battled.
- **The first battle** (`RIVAL_BATTLE_TUTORIAL`, BATTLE_TYPE_FIRST_BATTLE):
  the engine's `firstBattle` option. The player's damaging moves can't miss
  until the foe first takes damage, their stat moves can't miss until a foe's
  stat first falls, and there are no critical hits before that first damage.
  Oak speaks at FireRed's points (`battle_controller_oak_old_man.c`): once
  both Pokémon are out, after the first damage and the first lowered stat
  (engine `oak` events), on trying to run, after the prize money, and after
  the rival's victory line.
- **`trainerbattle_single`**: a trainer already beaten lets the script go
  on to their after-battle lines. Otherwise: their encounter music
  (`PlayTrainerEncounterMusic`), their challenge, the battle, then the script
  ends (or goes to its event script).
- **`special HealPlayerParty`**: full HP and PP, status cleared.

Trainers beaten are kept as story flags named by their id
(`TRAINER_RIVAL_OAKS_LAB_CHARMANDER`), so a save remembers them.

## Wild encounters

`src/battle/wild.ts` ports `src/wild_encounter.c`; `Game.frame` asks it after
every step the player finishes, once stairs and step-on scripts have had
their turn, as `ProcessPlayerFieldInput` does.

- **Where:** the baker now keeps each cell's metatile encounter type
  (`grid.encounter`: 1 land, 2 water); land cells use the map's FireRed
  `land` table. Water needs Surf, so only land encounters happen yet.
- **Whether:** `HandleWildEncounterCooldown` (a few steps that always pass,
  by the rate, with a 5% chance a step to skip ahead), the 60% roll on
  stepping from a different kind of tile, then the rate x 16 out of 1600,
  raised by a buff that grows with every miss. A lead with Stench halves the
  chance; Illuminate doubles it.
- **What:** the slot by `slotRates`, a level in its range, and the Pokémon
  made as `CreateMonWithNature` makes it (nature first, the player as its
  original trainer).
- **Randomness:** its own stream, `encounterRandom`, so walking in grass
  can't shift battle rolls or new Pokémon.
- **Whiting out** (`Game.whiteOut`, `DoWhiteOut`): money lost by
  `whiteOutLoss`, the party healed, and back to Red's house at (8, 5) facing
  Mom, with "scurried back home" and `EventScript_AfterWhiteOutMomHeal`. Losing
  a `trainerbattle_single` whites out too.

## Catching and the Bag in battle

- **The Bag:** BAG lists the items whose decomp `battleUsage` lets them be
  used in battle (`battleUse` in `items.json`), with their descriptions. A
  ball is thrown at once; medicine asks which Pokémon it's for, and says "It
  won't have any effect." (keeping the item) for a fainted or full-HP one.
  Using an item takes the turn, before any move, as in FireRed.
- **Catching** (`Cmd_handleballthrow`, in `rules.ts`): the odds from the
  species' catch rate, the ball's bonus (Great, Ultra, Net, Nest, Repeat,
  Timer, …), the HP left and the status; over 254 is a sure catch, otherwise
  four checks against `1048560 / the fourth root of 16711680 / odds`. A trainer
  blocks the ball ("Don't be a thief!").
- **The screen:** the ball's own sprite (`ballPics`, from
  `graphics/interface/ball`) shakes as many times as the checks passed, then
  either "Gotcha!" with the caught fanfare, or one of FireRed's four breakout
  lines. A catch registers in the Pokédex (with "data was added" once the
  player has one), asks about a nickname (no naming screen yet), and joins
  the party, or the PC box with a full party (`Story.box`, saved).

## Suggested order

1. ~~**Bake** the type chart, Route 1's FireRed encounters, Blue's lab parties,
   battle backgrounds, battle music and the extra Pokémon pictures.~~ Done,
   with the battle text.
2. ~~**Battle logic** in `src/battle/`, as pure code.~~ Done: see "The battle
   engine" below.
3. ~~**The battle screen**, in FireRed's layout.~~ Done: see "The battle
   screen" below.
4. ~~**Blue in the lab** via `trainerbattle_earlyrival`.~~ Done: see "Trainer
   battles in scripts" below.
5. ~~**Wild encounters** in Route 1's tall grass, with RUN.~~ Done: see "Wild
   encounters" below.
6. ~~**Catching** with POKé BALLs from the Bag, filling the Pokédex.~~ Done: see
   "Catching and the Bag in battle" below.
