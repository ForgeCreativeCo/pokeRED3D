// Classify the metatiles used by one or more maps and write:
//   build/rules/tilesets/<key>.json   resolved classes (input to the baker)
//   build/debug/classify.html         hover-able debug view of maps + tilesets
//
// Usage: npm run classify -- PalletTown [Route1 ...]

import fs from 'node:fs';
import path from 'node:path';
import { assertDecomp, readMap, readLayout, tilesetPair, NUM_METATILES_IN_PRIMARY } from './lib/decomp.js';
import { renderLayout, renderMetatile, Image } from './lib/raster.js';
import { loadRules } from './lib/rules.js';
import { classifyTilesets } from './lib/classify.js';
import { PNG } from 'pngjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'build');

assertDecomp();
const mapNames = process.argv.slice(2);
if (!mapNames.length) {
  console.error('Usage: npm run classify -- <MapName> [MapName ...]   e.g. PalletTown');
  process.exit(1);
}

const rules = loadRules();
const maps = mapNames.map((name) => {
  const map = readMap(name);
  const layout = readLayout(map.layout);
  return { name, map, layout, pair: tilesetPair(layout) };
});

const symbols = [...new Set(maps.flatMap((m) => [m.layout.primary_tileset, m.layout.secondary_tileset]))];
const classified = classifyTilesets(symbols, rules);

// ---- resolved rule data ----
for (const [key, entries] of classified) {
  const file = path.join(OUT, 'rules/tilesets', `${key}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ tileset: key, metatiles: entries }, null, 1));
  const counts = {};
  for (const e of entries) counts[e.class] = (counts[e.class] ?? 0) + 1;
  const bySource = {};
  for (const e of entries) bySource[e.source] = (bySource[e.source] ?? 0) + 1;
  console.log(`${key.padEnd(16)} ${JSON.stringify(counts)}  sources ${JSON.stringify(bySource)}`);
}

// ---- debug view ----
const dataUri = (img) => {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer);
  return 'data:image/png;base64,' + PNG.sync.write(png).toString('base64');
};

const lookup = {};
for (const [key, entries] of classified) for (const e of entries) lookup[`${key}:${e.id}`] = e;
const keyFor = (pair, id) => `${(id < NUM_METATILES_IN_PRIMARY ? pair.primary : pair.secondary).key}:${id}`;

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// Static overlay: class tint per cell, overhang class as a corner triangle.
function overlay(img, keys, width) {
  keys.forEach((key, i) => {
    const e = lookup[key];
    const x0 = (i % width) * 16, y0 = Math.floor(i / width) * 16;
    img.fill(x0, y0, 16, 16, hexRgb(rules.classes[e.class].colour), 120);
    if (e.top) for (let y = 0; y < 7; y++) for (let x = 0; x < 7 - y; x++) img.set(x0 + x, y0 + y, hexRgb(rules.classes[e.top].colour));
  });
  return img.scaled(2);
}

const views = [];
for (const m of maps) {
  overlay(renderLayout(m.layout, m.pair), m.layout.cells.map((c) => keyFor(m.pair, c.metatile)), m.layout.width)
    .save(path.join(OUT, 'debug/maps', `${m.name}_classes.png`));

  views.push({
    title: `Map: ${m.name}`,
    image: dataUri(renderLayout(m.layout, m.pair)),
    width: m.layout.width,
    cells: m.layout.cells.map((c) => ({ ...c, key: keyFor(m.pair, c.metatile) })),
  });
}
// Tileset sheets: only metatiles that some map actually uses, 16 per row.
for (const [key, entries] of classified) {
  const pair = maps.find((m) => m.pair.primary.key === key || m.pair.secondary.key === key).pair;
  const shown = entries.filter((e) => e.class !== 'unused');
  const cols = 16, rows = Math.ceil(shown.length / cols);
  const img = new Image(cols * 16, rows * 16);
  shown.forEach((e, i) => img.blit(renderMetatile(pair, e.id), (i % cols) * 16, Math.floor(i / cols) * 16));
  overlay(img.clone(), shown.map((e) => `${key}:${e.id}`), cols)
    .save(path.join(OUT, 'debug/tilesets', `${key}_classes.png`));
  views.push({
    title: `Tileset: ${key} (${shown.length} placed metatiles)`,
    image: dataUri(img),
    width: cols,
    cells: shown.map((e) => ({ metatile: e.id, key: `${key}:${e.id}` })),
  });
}

const html = fs.readFileSync(path.join(import.meta.dirname, 'debug/classify.html'), 'utf8')
  .replace('/*DATA*/', `const CLASSES = ${JSON.stringify(rules.classes)};\nconst LOOKUP = ${JSON.stringify(lookup)};\nconst VIEWS = ${JSON.stringify(views)};`);
const htmlFile = path.join(OUT, 'debug/classify.html');
fs.mkdirSync(path.dirname(htmlFile), { recursive: true });
fs.writeFileSync(htmlFile, html);
console.log(`\nDebug view: ${path.relative(ROOT, htmlFile)}`);
