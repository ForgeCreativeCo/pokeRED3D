// Items and the menu's own lines, from the decomp:
//   src/data/items.json     every item: name, price, pocket, description, use
//   data/text/*.inc         labelled .string text (the save dialogue)
//   src/strings.c           C strings: const u8 gText_…[] = _("…")
//
// UI text keeps FireRed's escapes (\n, \p, {PLAYER}) so the text box shows it
// exactly as it shows script text.

import fs from 'node:fs';
import path from 'node:path';
import { DECOMP_DIR } from './decomp.js';

const read = (file) => fs.readFileSync(path.join(DECOMP_DIR, file), 'utf8');

/** POCKET_ITEMS -> ITEMS, POCKET_KEY_ITEMS -> KEY_ITEMS, … */
const pocketOf = (p) => (p ?? 'POCKET_NONE').replace(/^POCKET_/, '');

export function bakeItems() {
  const { items } = JSON.parse(read('src/data/items.json'));
  const out = {};
  for (const it of items) {
    if (!it.itemId || it.itemId === 'ITEM_NONE' || !it.english || it.english === '????????') continue;
    out[it.itemId] = {
      name: it.english,
      price: it.price,
      pocket: pocketOf(it.pocket),
      description: it.description_english ?? '',
      /** for medicine: how much it restores, and so on */
      param: it.holdEffectParam ?? 0,
      fieldUse: it.fieldUseFunc ?? null,
      /** key items can't be tossed or sold */
      important: !!it.importance,
    };
  }
  return out;
}

let strings;
/** Text by label, from the .inc text files or C strings in src/strings.c. */
export function uiText(labels) {
  if (!strings) {
    strings = new Map();
    for (const [, name, body] of read('src/strings.c').matchAll(/const u8 (gText_\w+)\[\]\s*=\s*_\("((?:[^"\\]|\\.)*)"\)/g)) strings.set(name, body);
    for (const file of fs.readdirSync(path.join(DECOMP_DIR, 'data/text')).filter((f) => f.endsWith('.inc'))) {
      let cur = null;
      for (const raw of read(`data/text/${file}`).split(/\r?\n/)) {
        const label = raw.match(/^(\w+)::?\s*$/);
        if (label) { cur = label[1]; strings.set(cur, ''); continue; }
        const s = raw.match(/^\s*\.string\s+"(.*)"\s*$/);
        if (s && cur) strings.set(cur, strings.get(cur) + s[1]);
      }
    }
  }
  const out = {};
  for (const l of labels) {
    if (!strings.has(l)) throw new Error(`No text ${l} in the decomp`);
    out[l] = strings.get(l).replace(/\$$/, '');
  }
  return out;
}

/** National Pokédex number per species, from sSpeciesToNationalPokedexNum. */
export function nationalDex() {
  const order = [...read('include/constants/pokedex.h').matchAll(/^\s*(NATIONAL_DEX_\w+),/gm)].map((m) => m[1]);
  const num = new Map(order.map((n, i) => [n, i]));
  const table = read('src/pokemon.c').match(/sSpeciesToNationalPokedexNum\[[^\]]*\]\s*=\s*\{([\s\S]*?)\};/)[1];
  const out = {};
  for (const [, s] of table.matchAll(/SPECIES_TO_NATIONAL\((\w+)\)/g)) if (num.has(`NATIONAL_DEX_${s}`)) out[`SPECIES_${s}`] = num.get(`NATIONAL_DEX_${s}`);
  return out;
}
