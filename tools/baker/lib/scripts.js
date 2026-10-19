// Event scripts and text from the decomp, for the game's script player.
//
// Scripts live in data/maps/*/scripts.inc, data/scripts/*.inc and
// data/event_scripts.s as labelled lists of commands; text lives in
// data/maps/*/text.inc and data/text/*.inc as .string pieces. Only what the
// baked maps' NPCs and signs can reach is kept.

import fs from 'node:fs';
import path from 'node:path';
import { DECOMP_DIR } from './decomp.js';

const p = (...a) => path.join(DECOMP_DIR, ...a);
const list = (dir, ext) => (fs.existsSync(p(dir)) ? fs.readdirSync(p(dir)).filter((f) => f.endsWith(ext)).map((f) => path.join(dir, f)) : []);

let index;
function load() {
  if (index) return index;
  const scripts = new Map(), text = new Map(), consts = {};
  const mapDirs = fs.readdirSync(p('data/maps')).filter((d) => fs.existsSync(p('data/maps', d, 'scripts.inc')));
  const scriptFiles = [...mapDirs.map((d) => `data/maps/${d}/scripts.inc`), ...list('data/scripts', '.inc'), 'data/event_scripts.s'];
  const textFiles = [...mapDirs.filter((d) => fs.existsSync(p('data/maps', d, 'text.inc'))).map((d) => `data/maps/${d}/text.inc`), ...list('data/text', '.inc'), 'data/event_scripts.s'];

  for (const file of scriptFiles) {
    let cur = null;
    // Parameterless .macro blocks (used to share runs of movement steps) are
    // expanded where they're used.
    const macros = new Map();
    let macro = null;
    for (const raw of fs.readFileSync(p(file), 'utf8').split(/\r?\n/)) {
      const line = raw.replace(/@.*$/, '').trim();
      if (!line) continue;
      const m = line.match(/^\.macro\s+(\w+)\s*$/);
      if (m) { macro = []; macros.set(m[1], macro); continue; }
      if (line === '.endm') { macro = null; continue; }
      const eq = line.match(/^\.(?:equ|set)\s+(\w+)\s*,\s*(\w+)/);
      if (eq) { consts[eq[1]] = eq[2]; continue; }
      const label = line.match(/^(\w+)::?$/);
      if (label && !macro) { cur = []; scripts.set(label[1], cur); continue; }
      if (line.startsWith('.')) continue;
      const [cmd, ...rest] = line.split(/\s+/);
      // Macro arguments are split by commas, or by spaces between plain words
      // ("case 1 EventScript_…" in the nurse's script); expressions keep their spaces.
      const args = rest.join(' ').split(',').map((s) => s.trim()).filter(Boolean)
        .flatMap((a) => (/^\w+(\s+\w+)+$/.test(a) ? a.split(/\s+/) : [a]));
      if (macro) { macro.push([cmd, ...args]); continue; }
      if (!cur) continue;
      if (macros.has(cmd) && !args.length) cur.push(...macros.get(cmd));
      else cur.push([cmd, ...args]);
    }
  }
  for (const file of textFiles) {
    let cur = null;
    for (const raw of fs.readFileSync(p(file), 'utf8').split(/\r?\n/)) {
      const label = raw.match(/^(\w+)::?\s*$/);
      if (label) { cur = label[1]; text.set(cur, ''); continue; }
      const s = raw.match(/^\s*\.string\s+"(.*)"\s*$/);
      if (s && cur) text.set(cur, text.get(cur) + s[1]);
    }
  }
  // event_scripts.s mixes scripts and text: its script labels aren't text.
  for (const [k, v] of text) {
    if (!v && scripts.has(k)) { text.delete(k); continue; }
    if (scripts.get(k)?.length === 0) scripts.delete(k);
    text.set(k, v.replace(/\$$/, ''));
  }

  // A few C constants the scripts compare against.
  for (const f of ['include/constants/global.h', 'include/constants/vars.h']) {
    for (const [, name, value] of fs.readFileSync(p(f), 'utf8').matchAll(/#define\s+((?:DIR|NPC_TEXT_COLOR)_\w+|MALE|FEMALE)\s+(\d+)/g)) consts[name] = value;
  }
  Object.assign(consts, { TRUE: '1', FALSE: '0', YES: '1', NO: '0' });

  // Default text colour per sprite: entries pair a graphics id with the next one.
  const textColors = {};
  const src = fs.readFileSync(p('src/dynamic_placeholder_text_util.c'), 'utf8');
  for (const [, a, ca, cb, b] of src.matchAll(/\[(OBJ_EVENT_GFX_\w+)\s*\/\s*2\]\s*=\s*COLORS\((\w+),\s*(\w+)\),?\s*\/\/\s*(OBJ_EVENT_GFX_\w+)/g)) {
    textColors[a] = ca;
    textColors[b] = cb;
  }
  index = { scripts, text, consts, textColors };
  return index;
}

/**
 * Everything reachable from the given entry labels: scripts (and the
 * movement lists they apply), the text they show, constants they compare.
 */
export function bakeScripts(roots) {
  const { scripts, text, consts, textColors } = load();
  const out = { scripts: {}, text: {}, consts: {}, textColors };
  const queue = roots.filter((r) => r && r !== '0' && scripts.has(r));
  const seen = new Set(queue);
  while (queue.length) {
    const label = queue.shift();
    const body = scripts.get(label);
    out.scripts[label] = body;
    for (const [, ...args] of body)
      for (const a of args) {
        if (scripts.has(a) && !seen.has(a)) { seen.add(a); queue.push(a); }
        else if (text.has(a)) out.text[a] = text.get(a);
        else if (consts[a] != null) out.consts[a] = consts[a];
      }
  }
  // Constants can alias variables (SIGN_LADY_READY -> VAR_TEMP_2); keep the DIR/colour ones too.
  for (const [k, v] of Object.entries(consts)) if (/^(DIR|NPC_TEXT_COLOR)_|^(TRUE|FALSE|YES|NO|MALE|FEMALE)$/.test(k)) out.consts[k] = v;
  return out;
}
