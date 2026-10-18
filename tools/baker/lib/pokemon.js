// Pokémon data from the decomp, for the game's party, summaries and (later)
// battles:
//   src/data/pokemon/species_info.h          base stats, types, abilities, growth, gender ratio
//   src/data/text/species_names.h            names
//   src/data/pokemon/level_up_learnsets.h    (+ _pointers.h) moves learned by level
//   src/data/battle_moves.h                  every move's power, type, accuracy, PP, …
//   src/data/text/move_names.h, abilities.h, nature_names.h
//   src/pokemon.c                            the nature stat table
//   graphics/pokemon/<name>/                 front and back pictures, party icons
//
// All species and moves are baked as data. Pictures are baked only for the
// species asked for (the ones the baked scripts can hand out or show).

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { DECOMP_DIR } from './decomp.js';

const read = (file) => fs.readFileSync(path.join(DECOMP_DIR, file), 'utf8');

/** [KEY] = { .field = value, ... } blocks of a C designated-initializer table. */
export function blocks(src, prefix) {
  const out = new Map();
  // Split at each "[KEY] =" so a one-line entry ({0}) can't swallow the next one.
  const parts = src.split(new RegExp(`\\[(${prefix}\\w+)\\]\\s*=`));
  for (let i = 1; i < parts.length; i += 2) {
    const key = parts[i], body = parts[i + 1];
    const fields = {};
    for (const [, name, value] of body.matchAll(/\.(\w+)\s*=\s*([^\n]+?),?\s*(?:\/\/.*)?$/gm)) fields[name] = value.trim().replace(/,$/, '');
    out.set(key, fields);
  }
  return out;
}

/** [KEY] = _("NAME") tables */
function names(src) {
  return Object.fromEntries([...src.matchAll(/\[(\w+)\]\s*=\s*_\("([^"]*)"\)/g)].map(([, k, v]) => [k, v]));
}

const list = (v) => (v ?? '').replace(/[{}]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
const num = (v) => Number(v ?? 0);

/** genderRatio as FireRed stores it: 0 always male, 254 always female, 255 genderless, else the female threshold. */
function genderRatio(v) {
  if (v === 'MON_MALE') return 0;
  if (v === 'MON_FEMALE') return 254;
  if (v === 'MON_GENDERLESS') return 255;
  const pct = v?.match(/PERCENT_FEMALE\(([\d.]+)\)/)?.[1];
  return pct != null ? Math.min(254, Math.floor((Number(pct) * 255) / 100)) : 127;
}

let cache;
function load() {
  if (cache) return cache;
  const speciesNames = names(read('src/data/text/species_names.h'));
  const moveNames = names(read('src/data/text/move_names.h'));
  const abilityNames = names(read('src/data/text/abilities.h'));

  // Learnsets: sXLevelUpLearnset[] = { LEVEL_UP_MOVE(lvl, MOVE), ... } and the species -> symbol pointers.
  const learnsets = new Map();
  for (const [, sym, body] of read('src/data/pokemon/level_up_learnsets.h').matchAll(/static const u16 (\w+)\[\]\s*=\s*\{([\s\S]*?)\};/g)) {
    learnsets.set(sym, [...body.matchAll(/LEVEL_UP_MOVE\(\s*(\d+)\s*,\s*(MOVE_\w+)\s*\)/g)].map(([, lvl, move]) => [Number(lvl), move]));
  }
  const learnsetOf = Object.fromEntries([...read('src/data/pokemon/level_up_learnset_pointers.h').matchAll(/\[(SPECIES_\w+)\]\s*=\s*(\w+)/g)].map(([, s, sym]) => [s, learnsets.get(sym) ?? []]));

  const species = {};
  for (const [key, f] of blocks(read('src/data/pokemon/species_info.h'), 'SPECIES_')) {
    if (key === 'SPECIES_NONE' || !speciesNames[key]) continue;
    const types = [...new Set(list(f.types))];
    species[key] = {
      name: speciesNames[key],
      base: { hp: num(f.baseHP), atk: num(f.baseAttack), def: num(f.baseDefense), spe: num(f.baseSpeed), spa: num(f.baseSpAttack), spd: num(f.baseSpDefense) },
      types,
      abilities: list(f.abilities).filter((a) => a !== 'ABILITY_NONE'),
      growth: f.growthRate,
      genderRatio: genderRatio(f.genderRatio),
      catchRate: num(f.catchRate),
      expYield: num(f.expYield),
      evYield: { hp: num(f.evYield_HP), atk: num(f.evYield_Attack), def: num(f.evYield_Defense), spe: num(f.evYield_Speed), spa: num(f.evYield_SpAttack), spd: num(f.evYield_SpDefense) },
      friendship: num(f.friendship),
      learnset: learnsetOf[key] ?? [],
    };
  }

  const moves = {};
  for (const [key, f] of blocks(read('src/data/battle_moves.h'), 'MOVE_')) {
    if (key === 'MOVE_NONE' || !moveNames[key]) continue;
    moves[key] = {
      name: moveNames[key], type: f.type, power: num(f.power), accuracy: num(f.accuracy), pp: num(f.pp),
      effect: f.effect, effectChance: num(f.secondaryEffectChance), target: f.target, priority: num(f.priority),
      contact: /FLAG_MAKES_CONTACT/.test(f.flags ?? ''),
    };
  }

  // Natures: names in order, and the +1 / -1 table over Attack, Defense, Speed, Sp. Atk, Sp. Def.
  const natureNames = [...read('src/data/text/nature_names.h').matchAll(/s(\w+)NatureName\[\]\s*=\s*_\("(\w+)"\)/g)].map(([, , n]) => n);
  const table = read('src/pokemon.c').match(/sNatureStatTable\[NUM_NATURES\]\[NUM_NATURE_STATS\]\s*=\s*\{([\s\S]*?)\};/)[1];
  const rows = [...table.matchAll(/\{([^}]*)\}/g)].map(([, r]) => r.split(',').map((x) => Number(x.trim())));
  const natures = natureNames.map((name, i) => ({ name, mods: rows[i] }));

  cache = { species, moves, natures, abilities: abilityNames };
  return cache;
}

// ---- pictures ----

export function readJascPal(file) {
  return fs.readFileSync(path.join(DECOMP_DIR, file), 'utf8').trim().split(/\r?\n/).slice(3).map((l) => l.trim().split(/\s+/).map(Number));
}

/** An indexed PNG redrawn with the given palette; colour 0 transparent. Returns a PNG data URI. */
export function recolor(pngFile, palette) {
  const png = PNG.sync.read(fs.readFileSync(path.join(DECOMP_DIR, pngFile)), { skipRescale: true });
  const lookup = new Map(png.palette.map((c, i) => [(c[0] << 16) | (c[1] << 8) | c[2], i]));
  const out = new PNG({ width: png.width, height: png.height });
  for (let i = 0; i < png.width * png.height; i++) {
    const idx = lookup.get((png.data[i * 4] << 16) | (png.data[i * 4 + 1] << 8) | png.data[i * 4 + 2]) ?? 0;
    const [r, g, b] = palette[idx] ?? [0, 0, 0];
    out.data.set([r, g, b, idx ? 255 : 0], i * 4);
  }
  return 'data:image/png;base64,' + PNG.sync.write(out).toString('base64');
}

let picIndex;
function pictures(species) {
  if (!picIndex) {
    const gfx = read('src/data/graphics/pokemon.h');
    const file = (sym) => gfx.match(new RegExp(`${sym}\\[\\]\\s*=\\s*INCBIN_U(?:8|32)\\("([^"]+)"\\)`))?.[1];
    const table = (f, kind) => Object.fromEntries([...read(`src/data/pokemon_graphics/${f}`).matchAll(new RegExp(`${kind}\\((\\w+),\\s*(\\w+)\\)`, 'g'))].map(([, s, sym]) => [`SPECIES_${s}`, sym]));
    const icons = read('src/pokemon_icon.c');
    picIndex = {
      file, front: table('front_pic_table.h', 'SPECIES_SPRITE'), back: table('back_pic_table.h', 'SPECIES_SPRITE'), pal: table('palette_table.h', 'SPECIES_PAL'),
      icon: Object.fromEntries([...icons.matchAll(/\[(SPECIES_\w+)\]\s*=\s*(gMonIcon_\w+)/g)].map(([, s, sym]) => [s, sym])),
      iconPal: Object.fromEntries([...icons.matchAll(/\[(SPECIES_\w+)\]\s*=\s*(\d+)/g)].map(([, s, n]) => [s, Number(n)])),
    };
  }
  const P = picIndex;
  const png = (sym) => P.file(sym)?.replace(/\.4bpp(\.lz)?$/, '.png');
  const pal = readJascPal(P.file(P.pal[species]).replace(/\.gbapal(\.lz)?$/, '.pal'));
  const iconPal = readJascPal(`graphics/pokemon/icon_palettes/icon_palette_${P.iconPal[species] ?? 0}.pal`);
  // Where battle puts them: gMonFrontPicCoords / gMonBackPicCoords push the picture down
  // its 64x64 frame, and gEnemyMonElevation lifts floating and flying foes.
  const y = (table) => Number(read(`src/data/pokemon_graphics/${table}`).match(new RegExp(`\\[${species}\\]\\s*=\\s*\\{[^}]*\\.y_offset\\s*=\\s*(\\d+)`))?.[1] ?? 0);
  const elevation = Number(read('src/data/pokemon_graphics/enemy_mon_elevation.h').match(new RegExp(`\\[${species}\\]\\s*=\\s*(\\d+)`))?.[1] ?? 0);
  return {
    front: recolor(png(P.front[species]), pal), back: recolor(png(P.back[species]), pal), icon: recolor(png(P.icon[species]), iconPal),
    frontY: y('front_pic_coordinates.h'), backY: y('back_pic_coordinates.h'), elevation,
  };
}

/**
 * Everything the game needs about Pokémon. `withPictures` lists the species
 * whose front, back and icon pictures to include.
 */
export function bakePokemon(withPictures = []) {
  const { species, moves, natures, abilities } = load();
  const pics = {};
  for (const s of new Set(withPictures)) {
    if (!species[s]) { console.warn(`  no species ${s}`); continue; }
    pics[s] = pictures(s);
  }
  return { format: { name: 'pokered3d-pokemon', version: 1 }, species, moves, natures, abilities, pics };
}
