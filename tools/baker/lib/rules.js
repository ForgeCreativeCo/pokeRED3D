// Loads and validates the rule files in rules/.

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const RULES_DIR = path.resolve(import.meta.dirname, '../../../rules');

const readYaml = (file) => YAML.parse(fs.readFileSync(file, 'utf8')) ?? {};

export function loadRules() {
  const { classes } = readYaml(path.join(RULES_DIR, 'classes.yaml'));
  const { behaviors } = readYaml(path.join(RULES_DIR, 'behaviors.yaml'));
  const classifier = readYaml(path.join(RULES_DIR, 'classifier.yaml'));
  const { animations = {} } = readYaml(path.join(RULES_DIR, 'animations.yaml'));

  const checkClass = (cls, where) => {
    if (!classes[cls]) throw new Error(`${where}: unknown class "${cls}" (see rules/classes.yaml)`);
  };

  const behaviorRules = Object.entries(behaviors).map(([pattern, v]) => {
    const rule = typeof v === 'string' ? { class: v } : v;
    checkClass(rule.class, `behaviors.yaml ${pattern}`);
    return { re: new RegExp('^' + pattern.replace(/\*/g, '\\w*') + '$'), rule };
  });

  for (const [name, a] of Object.entries(animations)) {
    checkClass(a.class, `animations.yaml ${name}`);
    if (a.when) checkClass(a.when, `animations.yaml ${name}`);
  }

  return {
    classes,
    animations,
    classifier,
    checkClass,
    /** Rule for a behavior name, or undefined. */
    behavior(name) {
      return name && behaviorRules.find((b) => b.re.test(name))?.rule;
    },
    tilesetOverrides: (key) => loadTilesetOverrides(key, checkClass),
  };
}

// rules/tilesets/<key>.yaml
//
// metatiles:
//   0x289: roof                      # shorthand for { class: roof }
//   0x281-0x283: { top: roof }       # inclusive range of global metatile ids
//   0x2a5: { class: ground, top: prop, note: "mailbox lid" }
function loadTilesetOverrides(key, checkClass) {
  const file = path.join(RULES_DIR, 'tilesets', `${key}.yaml`);
  const out = new Map();
  if (!fs.existsSync(file)) return out;
  const { metatiles = {} } = readYaml(file);
  for (const [k, v] of Object.entries(metatiles)) {
    const m = String(k).match(/^(0x[0-9a-f]+|\d+)(?:\s*-\s*(0x[0-9a-f]+|\d+))?$/i);
    if (!m) throw new Error(`tilesets/${key}.yaml: bad metatile key "${k}"`);
    const from = Number(m[1]), to = m[2] ? Number(m[2]) : from;
    const rule = typeof v === 'string' ? { class: v } : { ...v };
    for (const field of ['class', 'top']) if (rule[field]) checkClass(rule[field], `tilesets/${key}.yaml ${k}`);
    for (let id = from; id <= to; id++) out.set(id, rule);
  }
  return out;
}
