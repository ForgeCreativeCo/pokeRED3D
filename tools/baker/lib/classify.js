// Automatic metatile classification.
//
// Each metatile gets a render class from, in priority order:
//   1. a per-tileset override in rules/tilesets/<key>.yaml
//   2. its metatile behavior (rules/behaviors.yaml)
//   3. shape heuristics measured over every placement of the metatile on
//      every layout that uses its tileset (rules/classifier.yaml)
//
// Walkable metatiles whose second layer draws over sprites also get a `top`
// class: the thing overhanging the player (a roof edge, a tree top). That is
// resolved from whatever usually sits in the cell directly below, since an
// overhang is the upper part of a taller object standing there.

import {
  layouts, readLayout, readTileset, tilesetPair, behaviorNames, tileAnimations,
  NUM_METATILES_IN_PRIMARY,
} from './decomp.js';
import { layerCoverage, renderMetatile, drawMetatileLayer } from './raster.js';

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const mode = (xs) => {
  const counts = new Map();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

/** Global metatile id -> "tilesetKey:globalId", unique across all tilesets. */
const keyOf = (pair, id) => `${(id < NUM_METATILES_IN_PRIMARY ? pair.primary : pair.secondary).key}:${id}`;

/**
 * Gather placement statistics for every metatile of the given tilesets, from
 * every layout that uses any of them.
 */
const blankStat = () => ({ placements: 0, walkable: 0, wallDepth: [], column: [], freestanding: 0, below: [] });

function gatherStats(tilesetSymbols, cfg) {
  const wanted = new Set(tilesetSymbols);
  const stats = new Map(); // key -> blankStat()
  const stat = (key) => {
    if (!stats.has(key)) stats.set(key, blankStat());
    return stats.get(key);
  };

  for (const meta of layouts()) {
    if (!wanted.has(meta.primary_tileset) && !wanted.has(meta.secondary_tileset)) continue;
    const layout = readLayout(meta.id);
    const pair = tilesetPair(layout);
    const { width: w, height: h, cells } = layout;
    const at = (x, y) => cells[y * w + x];
    const isVoid = (c) => darkness(pair, c.metatile) >= cfg.void_min_dark;
    // Void (the black around interiors) ends a blocked column like the map edge does.
    const solid = (x, y) => y >= 0 && y < h && at(x, y).collision && !isVoid(at(x, y));

    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = at(x, y);
        const s = stat(keyOf(pair, c.metatile));
        s.placements++;
        if (!c.collision) {
          s.walkable++;
          if (y + 1 < h) s.below.push(keyOf(pair, at(x, y + 1).metatile));
          continue;
        }
        if (isVoid(c)) continue;
        // Rows from here down to walkable ground (1 = directly above it).
        let down = 0;
        while (solid(x, y + down)) down++;
        // Void in front counts as floor: it's just the room's front edge.
        const groundBelow = y + down < h && (!at(x, y + down).collision || isVoid(at(x, y + down)));
        s.wallDepth.push(groundBelow ? down : Infinity);
        // Height of the whole blocked column through this cell.
        let up = 0;
        while (solid(x, y - up - 1)) up++;
        const top = y - up;
        const open = (yy) => yy >= 0 && yy < h && !at(x, yy).collision;
        s.column.push(open(top - 1) && groundBelow ? up + down : Infinity);
        // Floor in front and floor behind: furniture, not a building wall.
        // (Buildings are taller than freestanding_max_rows.)
        if (groundBelow && open(top - 1)) s.freestanding++;
      }
  }
  return stats;
}

const darknessCache = new Map();
/** Fraction of a metatile's pixels that are (near) black. */
function darkness(pair, id) {
  // Primary metatiles take palettes from the secondary tileset too, so the key
  // includes the whole pair.
  const key = `${pair.primary.key}/${pair.secondary.key}:${id}`;
  if (darknessCache.has(key)) return darknessCache.get(key);
  const img = renderMetatile(pair, id);
  let dark = 0;
  for (let p = 0; p < 256; p++) if (img.data[p * 4] + img.data[p * 4 + 1] + img.data[p * 4 + 2] < 60) dark++;
  darknessCache.set(key, dark / 256);
  return dark / 256;
}

/** Fraction of a metatile's foreground pixels that are green. */
function greenness(pair, id, coverage) {
  const img = renderMetatile(pair, id);
  // If the second layer carries a real object, judge that layer alone so the
  // grass behind a mailbox doesn't make it look like a tree.
  const fgOnly = coverage[1] >= 64;
  let green = 0, total = 0;
  const mt = id < NUM_METATILES_IN_PRIMARY ? pair.primary.metatiles[id] : pair.secondary.metatiles[id - NUM_METATILES_IN_PRIMARY];
  const mask = fgOnly ? layerMask(pair, mt, 1) : null;
  for (let p = 0; p < 256; p++) {
    if (mask && !mask[p]) continue;
    const r = img.data[p * 4], g = img.data[p * 4 + 1], b = img.data[p * 4 + 2];
    total++;
    if (g > r + 15 && g > b) green++;
  }
  return total ? green / total : 0;
}

/** Opaque-pixel mask (16x16) for one layer of a metatile. */
function layerMask(pair, mt, layer) {
  const mask = new Uint8Array(256);
  const sink = { set: (x, y) => { mask[y * 16 + x] = 1; } };
  drawMetatileLayer(sink, pair, mt, layer, 0, 0);
  return mask;
}

/**
 * Classify every metatile in the given tilesets.
 * Returns Map<tilesetKey, entry[]> where entry.id is the global metatile id.
 */
export function classifyTilesets(tilesetSymbols, rules) {
  const cfg = rules.classifier;
  const names = behaviorNames();
  const stats = gatherStats(tilesetSymbols, cfg);
  const result = new Map();
  const byKey = new Map();

  for (const symbol of tilesetSymbols) {
    const ts = readTileset(symbol);
    const overrides = rules.tilesetOverrides(ts.key);
    // A pair is needed for rendering; a secondary tileset borrows palettes
    // from whichever primary its layouts use, so pick the first such layout.
    const pair = pairFor(ts);
    const base = ts.kind === 'primary' ? 0 : NUM_METATILES_IN_PRIMARY;

    const entries = ts.metatiles.map((mt) => {
      const id = base + mt.index;
      const s = stats.get(`${ts.key}:${id}`) ?? blankStat();
      const coverage = layerCoverage(pair, mt);
      const behaviorName = names.get(mt.behavior) ?? `0x${mt.behavior.toString(16)}`;
      const walkRatio = s.placements ? s.walkable / s.placements : null;
      const overSprites = mt.layerType === 'normal' || mt.layerType === 'split';
      const entry = {
        id,
        hex: `0x${id.toString(16)}`,
        behavior: behaviorName,
        /** TILE_ENCOUNTER_NONE / LAND / WATER: where wild Pokemon can appear */
        encounterType: mt.encounterType,
        layerType: mt.layerType,
        stats: {
          placements: s.placements,
          walkable: walkRatio,
          wallDepth: median(s.wallDepth),
          column: median(s.column),
          coverage,
        },
        reasons: [],
      };

      const auto = () => {
        const b = rules.behavior(behaviorName);
        if (b) {
          entry.reasons.push(`behavior ${behaviorName}`);
          return { ...b, source: 'behavior' };
        }
        if (!s.placements) {
          entry.reasons.push('never placed');
          return { class: 'unused', source: 'unused' };
        }
        if (walkRatio >= cfg.walkable_ratio) {
          entry.reasons.push(`walkable ${(walkRatio * 100).toFixed(0)}%`);
          return { class: 'ground', source: 'auto' };
        }
        entry.reasons.push(`blocked ${((1 - walkRatio) * 100).toFixed(0)}%`);
        const dark = darkness(pair, id);
        if (dark >= cfg.void_min_dark) {
          entry.reasons.push(`${(dark * 100).toFixed(0)}% black`);
          return { class: 'void', source: 'auto' };
        }
        const depth = median(s.wallDepth), column = median(s.column);
        if (column <= cfg.prop_max_column) {
          entry.reasons.push(`blocked column ${column} tall`);
          return { class: 'prop', source: 'auto' };
        }
        const blocked = s.placements - s.walkable;
        if (column <= cfg.freestanding_max_rows && s.freestanding >= blocked / 2) {
          entry.reasons.push(`freestanding, ${column} rows with floor in front and behind`);
          return { class: 'prop', source: 'auto' };
        }
        const green = greenness(pair, id, coverage);
        entry.stats.green = Number(green.toFixed(2));
        if (green >= cfg.tree_min_green) {
          entry.reasons.push(`green ${(green * 100).toFixed(0)}%`);
          return { class: 'tree', source: 'auto' };
        }
        if (depth <= cfg.wall_max_rows) {
          entry.reasons.push(`${depth} row(s) above ground`);
          return { class: 'wall', source: 'auto' };
        }
        entry.reasons.push(depth === Infinity ? 'blocked to map edge' : `${depth} rows above ground`);
        return { class: 'roof', source: 'auto' };
      };

      const decided = auto();
      Object.assign(entry, decided);

      // Animated tiles: record them, and let animations.yaml refine the class.
      const tiles = new Set(mt.tiles.map((t) => t.tile));
      const anims = tileAnimations().filter((a) =>
        (a.tileset === pair.primary.symbol || a.tileset === pair.secondary.symbol) &&
        [...tiles].some((t) => t >= a.start && t < a.start + a.count));
      if (anims.length) {
        entry.animated = anims.map((a) => a.name);
        for (const a of anims) {
          const rule = rules.animations[a.name];
          if (rule && (!rule.when || rule.when === entry.class)) {
            entry.class = rule.class;
            entry.source = 'animation';
            entry.reasons.push(`animation ${a.name}`);
          }
        }
      }

      // Something drawn over the player? Resolved to a class in pass 2.
      if (decided.class !== 'unused' && overSprites && coverage[1] >= cfg.overhang_min_pixels && walkRatio >= cfg.walkable_ratio) {
        entry.top = 'overhang';
        entry._below = s.below;
        entry.reasons.push(`${coverage[1]}px drawn over sprites`);
      }

      const o = overrides.get(id);
      if (o) {
        Object.assign(entry, o, { source: 'override' });
        entry.reasons.unshift(o.note ? `override: ${o.note}` : 'override');
      }
      byKey.set(`${ts.key}:${id}`, entry);
      return entry;
    });
    result.set(ts.key, entries);
  }

  // Pass 2: an overhang takes the class of what usually stands below it.
  for (const entries of result.values())
    for (const e of entries) {
      if (e.top === 'overhang') {
        const belowClasses = e._below.map((k) => byKey.get(k)?.class).filter((c) => c && c !== 'ground' && c !== 'unused');
        const resolved = mode(belowClasses);
        e.top = resolved === 'wall' ? 'roof' : resolved ?? 'prop';
        e.reasons.push(`top from cell below: ${e.top}`);
      }
      delete e._below;
    }

  return result;
}

const pairCache = new Map();
function pairFor(ts) {
  if (pairCache.has(ts.key)) return pairCache.get(ts.key);
  const layout = layouts().find((l) => l.primary_tileset === ts.symbol || l.secondary_tileset === ts.symbol);
  const pair = layout ? tilesetPair(layout) : { primary: ts, secondary: ts };
  pairCache.set(ts.key, pair);
  return pair;
}
