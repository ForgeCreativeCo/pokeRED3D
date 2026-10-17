// What battles need from the decomp:
//   src/battle_main.c                        type chart (gTypeEffectiveness), type names, prize money,
//                                            battle music (GetBattleBGM) and trainer victory music
//   src/battle_setup.c                       trainer encounter music, battle terrain by tile
//   src/data/wild_encounters.json            wild Pokémon per map (FireRed's tables)
//   src/data/trainers.h, trainer_parties.h   trainers and their parties
//   src/data/text/trainer_class_names.h      class names (YOUNGSTER, RIVAL, …)
//   src/data/graphics/trainers.h             trainer front pictures and the player's back pictures
//   src/data/trainer_graphics/*.h            which picture and palette each TRAINER_PIC_ uses
//   src/battle_bg.c                          battle backgrounds (sBattleTerrainTable)
//   graphics/battle_terrain/<terrain>/       their tiles, tilemaps and palettes

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { DECOMP_DIR } from './decomp.js';
import { blocks, readJascPal, recolor } from './pokemon.js';

const read = (file) => fs.readFileSync(path.join(DECOMP_DIR, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(DECOMP_DIR, file));

/** #define NAME value constants matching a prefix, as name -> number. */
function defines(file, prefix) {
  return Object.fromEntries([...read(file).matchAll(new RegExp(`#define\\s+(${prefix}\\w+)\\s+(0x[0-9A-Fa-f]+|\\d+)`, 'g'))].map(([, k, v]) => [k, Number(v)]));
}

/** The body of the first { … } block after `start` in src, braces balanced. */
function braceBlock(src, start) {
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error('Unbalanced braces');
}

/**
 * The C switch `head` (the first one after `after`) read as a table: each case label -> the first MUS_ constant its
 * branch names (by return, PlayBGM or assignment). `default` covers the rest.
 */
function switchSongs(src, after, head) {
  const at = src.indexOf(head, src.indexOf(after));
  if (at < 0) throw new Error(`No ${head} in the decomp`);
  const out = {};
  let pending = [];
  for (const line of braceBlock(src, at).split(/\r?\n/)) {
    const c = line.match(/case\s+(\w+)\s*:/) ?? line.match(/(default)\s*:/);
    if (c) pending.push(c[1]);
    const song = line.match(/\b(MUS_\w+)/)?.[1];
    if (song && pending.length) { for (const p of pending) out[p] = song; pending = []; }
  }
  return out;
}

// ---- types ----

/**
 * The type chart as FireRed lists it: [attacking type, defending type,
 * multiplier x10] (0 no effect, 5 not very effective, 20 super effective).
 * Entries after the Foresight separator only apply until Foresight is used.
 */
export function bakeTypes() {
  const mul = defines('include/battle_main.h', 'TYPE_MUL_');
  const body = braceBlock(read('src/battle_main.c'), read('src/battle_main.c').indexOf('gTypeEffectiveness['));
  const chart = [], foresight = [];
  let list = chart;
  for (const [, a, d, m] of body.matchAll(/(TYPE_\w+)\s*,\s*(TYPE_\w+)\s*,\s*(TYPE_MUL_\w+)/g)) {
    if (a === 'TYPE_ENDTABLE') break;
    if (a === 'TYPE_FORESIGHT') { list = foresight; continue; }
    list.push([a, d, mul[m]]);
  }
  const src = read('src/battle_main.c');
  const names = Object.fromEntries([...braceBlock(src, src.indexOf('gTypeNames[')).matchAll(/\[(TYPE_\w+)\]\s*=\s*_\("([^"]*)"\)/g)].map(([, k, v]) => [k, v]));
  return { chart, foresight, names };
}

// ---- wild Pokémon ----

/**
 * Wild Pokémon for the given maps (MAP_ROUTE1, …), from FireRed's tables
 * (each map also has a LeafGreen one). Each kind keeps the map's encounter
 * rate and its slots; `slotRates` are the chance weights of the slots.
 */
export function bakeWild(mapIds) {
  const { wild_encounter_groups: [group] } = JSON.parse(read('src/data/wild_encounters.json'));
  const kinds = { land_mons: 'land', water_mons: 'water', rock_smash_mons: 'rockSmash', fishing_mons: 'fishing' };
  const slotRates = {}, rodGroups = {};
  for (const f of group.fields) {
    slotRates[kinds[f.type]] = f.encounter_rates;
    if (f.groups) Object.assign(rodGroups, f.groups);
  }
  const maps = {};
  const want = new Set(mapIds);
  for (const e of group.encounters) {
    if (!want.has(e.map) || !e.base_label.endsWith('_FireRed')) continue;
    const tables = {};
    for (const [key, kind] of Object.entries(kinds)) {
      if (!e[key]) continue;
      tables[kind] = {
        rate: e[key].encounter_rate,
        mons: e[key].mons.map((m) => ({ species: m.species, min: m.min_level, max: m.max_level })),
      };
    }
    maps[e.map] = tables;
  }
  return { slotRates, rodGroups, maps };
}

// ---- trainers ----

let partyIndex;
/** sParty_X symbol -> [{ iv, level, species, item?, moves? }] */
function parties() {
  if (partyIndex) return partyIndex;
  partyIndex = new Map();
  for (const [, sym, body] of read('src/data/trainer_parties.h').matchAll(/static const struct TrainerMon\w+ (\w+)\[\]\s*=\s*\{([\s\S]*?)\n\};/g)) {
    const mons = [];
    for (const [chunk] of body.matchAll(/\.iv\s*=[\s\S]*?(?=\.iv\s*=|$)/g)) {
      const field = (name) => chunk.match(new RegExp(`\\.${name}\\s*=\\s*([^,\\n]+)`))?.[1].trim();
      const moves = chunk.match(/\.moves\s*=\s*\{([^}]*)\}/)?.[1];
      mons.push({
        iv: Number(field('iv')),
        level: Number(field('lvl')),
        species: field('species'),
        ...(field('heldItem') && field('heldItem') !== 'ITEM_NONE' ? { item: field('heldItem') } : {}),
        // Without a moveset, the Pokémon knows the last four moves it learned by its level.
        ...(moves ? { moves: moves.split(',').map((s) => s.trim()).filter((m) => m && m !== 'MOVE_NONE') } : {}),
      });
    }
    partyIndex.set(sym, mons);
  }
  return partyIndex;
}

let picIndex;
/** Trainer picture files: TRAINER_PIC_X -> { png, pal, y } from the graphics tables. */
function trainerPics() {
  if (picIndex) return picIndex;
  const gfx = read('src/data/graphics/trainers.h');
  const file = (sym) => gfx.match(new RegExp(`${sym}\\[\\]\\s*=\\s*INCBIN_U(?:8|32)\\("([^"]+)"\\)`))?.[1];
  const tables = read('src/data/trainer_graphics/front_pic_tables.h');
  const sprite = Object.fromEntries([...tables.matchAll(/TRAINER_SPRITE\((\w+),\s*(\w+)/g)].map(([, k, sym]) => [`TRAINER_PIC_${k}`, file(sym)]));
  const pal = Object.fromEntries([...tables.matchAll(/TRAINER_PAL\((\w+),\s*(\w+)\)/g)].map(([, k, sym]) => [`TRAINER_PIC_${k}`, file(sym)]));
  // gTrainerFrontPicCoords is in TRAINER_PIC_ order: how far down the 64x64 frame the picture sits.
  const coords = [...braceBlock(tables, tables.indexOf('gTrainerFrontPicCoords')).matchAll(/\.y_offset\s*=\s*(\d+)/g)].map(([, y]) => Number(y));
  const ids = defines('include/constants/trainers.h', 'TRAINER_PIC_');
  picIndex = { sprite, pal, coords, ids, file };
  return picIndex;
}

const png = (f) => f.replace(/\.4bpp(\.lz)?$/, '.png');
const pal = (f) => f.replace(/\.gbapal(\.lz)?$/, '.pal');

function frontPic(picId) {
  const P = trainerPics();
  if (!P.sprite[picId] || !P.pal[picId]) throw new Error(`No picture for ${picId}`);
  return { pic: recolor(png(P.sprite[picId]), readJascPal(pal(P.pal[picId]))), y: P.coords[P.ids[picId]] ?? 0 };
}

/**
 * The player's back pictures (Red, Leaf): a strip of 64x64 frames, the
 * throwing animation, top to bottom.
 */
export function bakePlayerPics() {
  const { file } = trainerPics();
  const out = {};
  for (const who of ['Red', 'Leaf']) {
    const f = png(file(`gTrainerBackPic_${who}`));
    out[who.toUpperCase()] = { pic: recolor(f, readJascPal(pal(file(`gTrainerPalette_${who}BackPic`)))), frames: PNG.sync.read(fs.readFileSync(path.join(DECOMP_DIR, f))).height / 64 };
  }
  return out;
}

/**
 * The given trainers (TRAINER_X, as the scripts' trainerbattle commands name
 * them): class, name, picture, party, items, prize money per level, and the
 * music for meeting, fighting and beating them.
 */
export function bakeTrainers(ids) {
  const all = blocks(read('src/data/trainers.h'), 'TRAINER_');
  const classNames = Object.fromEntries([...read('src/data/text/trainer_class_names.h').matchAll(/\[(TRAINER_CLASS_\w+)\]\s*=\s*_\("([^"]*)"\)/g)].map(([, k, v]) => [k, v]));
  const main = read('src/battle_main.c');
  // Prize money: 4 x the last Pokémon's level x this (Cmd_getmoneyreward); the 0xFF row is the fallback.
  const money = Object.fromEntries([...braceBlock(main, main.indexOf('gTrainerMoneyTable[]')).matchAll(/\{\s*(\w+)\s*,\s*(\d+)\s*\}/g)].map(([, k, v]) => [k === '0xFF' ? 'default' : k, Number(v)]));
  const classSwitch = 'switch (gTrainers[gTrainerBattleOpponent_A].trainerClass)';
  const encounterSongs = switchSongs(read('src/battle_setup.c'), 'PlayTrainerEncounterMusic', 'switch (GetTrainerEncounterMusicId(gTrainerBattleOpponent_A))');
  const battleSongs = switchSongs(read('src/pokemon.c'), 'static u16 GetBattleBGM', classSwitch);
  const victorySongs = switchSongs(main, 'BattleScript_LocalTrainerBattleWon', classSwitch);
  const byClass = (table, cls) => table[cls] ?? table.default;

  const out = {};
  for (const id of new Set(ids)) {
    const t = all.get(id);
    if (!t) throw new Error(`No trainer ${id} in the decomp`);
    const partySym = t.party.match(/\((\w+)\)/)[1];
    const party = parties().get(partySym);
    if (!party) throw new Error(`No party ${partySym} for ${id}`);
    const music = t.encounterMusic_gender.split('|').map((s) => s.trim());
    const encounter = music.find((m) => m.startsWith('TRAINER_ENCOUNTER_MUSIC_'));
    const cls = t.trainerClass;
    out[id] = {
      name: t.trainerName.match(/_\("([^"]*)"\)/)[1],
      class: cls,
      className: classNames[cls] ?? '',
      female: music.includes('F_TRAINER_FEMALE'),
      double: t.doubleBattle === 'TRUE',
      items: (t.items.match(/\{([^}]*)\}/)?.[1] ?? '').split(',').map((s) => s.trim()).filter((s) => s && s !== 'ITEM_NONE'),
      ai: t.aiFlags.split('|').map((s) => s.trim()).filter((s) => s !== '0'),
      party,
      money: money[cls] ?? money.default,
      pic: t.trainerPic,
      music: {
        encounter: encounterSongs[encounter] ?? encounterSongs.default,
        battle: byClass(battleSongs, cls),
        victory: byClass(victorySongs, cls),
      },
    };
  }
  const pics = {};
  for (const t of Object.values(out)) pics[t.pic] ??= frontPic(t.pic);
  return { trainers: out, pics };
}

// ---- backgrounds ----

/**
 * Battle backgrounds, by BATTLE_TERRAIN_ name: the scene behind the two
 * Pokémon (240x112, the part of the screen above the text box), drawn from
 * the terrain's tiles, tilemap and palette as FireRed loads them into BG3
 * (palettes 2 to 4).
 */
export function bakeTerrains(names) {
  const src = read('src/battle_bg.c');
  const files = Object.fromEntries([...src.matchAll(/static const u32 (sBattleTerrain\w+)\[\]\s*=\s*INCBIN_U32\("([^"]+)"\)/g)].map(([, sym, f]) => [sym, f]));
  const table = braceBlock(src, src.indexOf('sBattleTerrainTable[]'));
  const out = {};
  for (const name of names) {
    const entry = table.match(new RegExp(`\\[${name}\\]\\s*=\\s*\\{([^}]*)\\}`))?.[1];
    if (!entry) throw new Error(`No battle terrain ${name}`);
    const sym = (field) => files[entry.match(new RegExp(`\\.${field}\\s*=\\s*(\\w+)`))[1]];
    out[name] = renderTerrain(png(sym('tileset')), sym('tilemap').replace(/\.lz$/, ''), pal(sym('palette')));
  }
  return out;
}

function renderTerrain(tilesFile, mapFile, palFile) {
  const tiles = PNG.sync.read(fs.readFileSync(path.join(DECOMP_DIR, tilesFile)), { skipRescale: true });
  const lookup = new Map(tiles.palette.map((c, i) => [(c[0] << 16) | (c[1] << 8) | c[2], i]));
  const index = (x, y) => { const i = (y * tiles.width + x) * 4; return lookup.get((tiles.data[i] << 16) | (tiles.data[i + 1] << 8) | tiles.data[i + 2]) ?? 0; };
  const palette = readJascPal(palFile);
  const map = fs.readFileSync(path.join(DECOMP_DIR, mapFile));
  const W = 240, H = 112, perRow = tiles.width / 8;
  const out = new PNG({ width: W, height: H });
  for (let ty = 0; ty < H / 8; ty++)
    for (let tx = 0; tx < W / 8; tx++) {
      // A 64x32 map is two 32x32 screen blocks side by side; the screen shows the left one.
      const v = map.readUInt16LE((ty * 32 + tx) * 2);
      const tile = v & 0x3ff, hflip = v & 0x400, vflip = v & 0x800, palNum = v >> 12;
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const c = index((tile % perRow) * 8 + (hflip ? 7 - x : x), Math.floor(tile / perRow) * 8 + (vflip ? 7 - y : y));
          // Colour 0 is transparent on the GBA; the screen's backdrop shows through.
          const rgb = c && palette[(palNum - 2) * 16 + c];
          if (!rgb) continue;
          out.data.set([...rgb, 255], ((ty * 8 + y) * W + tx * 8 + x) * 4);
        }
    }
  return 'data:image/png;base64,' + PNG.sync.write(out).toString('base64');
}
