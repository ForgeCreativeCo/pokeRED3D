// Bake maps to the runtime format:
//   build/maps/<Map>/map.json   logic grid, entities, textured quads
//   build/maps/<Map>/atlas.png  texture atlas for the quads
//   build/debug/view3d.html     3D preview of every map baked, joined by their
//                               connections, with the first map at the origin
//
// Usage: npm run bake -- PalletTown [Route1 ...]

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { assertDecomp, readMap, readLayout, mapNameById, newGame } from './lib/decomp.js';
import { loadRules } from './lib/rules.js';
import { classifyTilesets } from './lib/classify.js';
import { bakeMap } from './lib/bake.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'build');

assertDecomp();
const names = process.argv.slice(2);
if (!names.length) {
  console.error('Usage: npm run bake -- <MapName> [MapName ...]   e.g. PalletTown');
  process.exit(1);
}

const rules = loadRules();
const symbols = [...new Set(names.flatMap((n) => {
  const l = readLayout(readMap(n).layout);
  return [l.primary_tileset, l.secondary_tileset];
}))];
const lookup = {};
for (const [key, entries] of classifyTilesets(symbols, rules)) for (const e of entries) lookup[`${key}:${e.id}`] = e;

const pngBuffer = (img) => {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer);
  return PNG.sync.write(png);
};

const baked = new Map();
for (const name of names) {
  const { atlas, data } = bakeMap(name, rules, lookup);
  const dir = path.join(OUT, 'maps', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'map.json'), JSON.stringify(data));
  const atlasPng = pngBuffer(atlas);
  fs.writeFileSync(path.join(dir, 'atlas.png'), atlasPng);
  const kinds = {};
  for (const q of data.quads) kinds[q.k] = (kinds[q.k] ?? 0) + 1;
  console.log(`${name}: ${data.width}x${data.height}, ${data.structures.buildings.length} buildings, ${data.structures.objects.length} objects, atlas ${atlas.width}x${atlas.height}`);
  console.log(`  quads ${JSON.stringify(kinds)}`);
  baked.set(name, { data, atlas: 'data:image/png;base64,' + atlasPng.toString('base64') });
}

// Group the maps into areas and lay each area out in its own space by walking
// connections: the outdoor maps join up into one area, and each interior is
// an area of its own, reached by warps. A connection's offset runs along the
// shared edge.
const placed = new Map(); // name -> { x, y, area }
let areas = 0;
for (const first of names) {
  if (placed.has(first)) continue;
  const area = areas++;
  placed.set(first, { x: 0, y: 0, area });
  const queue = [first];
  while (queue.length) {
    const name = queue.shift();
    const here = baked.get(name).data, at = placed.get(name);
    for (const c of here.connections) {
      const other = mapNameById(c.map);
      if (!baked.has(other) || placed.has(other)) continue;
      const o = baked.get(other).data;
      const pos = {
        up: { x: at.x + c.offset, y: at.y - o.height },
        down: { x: at.x + c.offset, y: at.y + here.height },
        left: { x: at.x - o.width, y: at.y + c.offset },
        right: { x: at.x + here.width, y: at.y + c.offset },
      }[c.direction];
      if (!pos) continue; // dive / emerge connections aren't side by side
      placed.set(other, { ...pos, area });
      queue.push(other);
    }
  }
}
const world = [...placed].map(([name, { x, y, area }]) => ({ area, ox: x, oy: y, data: baked.get(name).data, atlas: baked.get(name).atlas }));
// Start where a new game does, if that map is in the bake; otherwise outside
// the first map's first door.
const ng = newGame().start;
const start = ng && baked.has(ng.map) ? { ...ng, facing: 'down' } : null;
console.log(`\nWorld: ${areas} area(s); start ${start ? `${start.map} ${start.x},${start.y}` : `outside ${names[0]}'s first door`}`);

// The preview inlines everything so it opens straight from disk.
const html = fs.readFileSync(path.join(import.meta.dirname, 'debug/view3d.html'), 'utf8')
  .replace('/*DATA*/', `const WORLD = ${JSON.stringify(world)};\nconst START = ${JSON.stringify(start)};`);
fs.mkdirSync(path.join(OUT, 'debug'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'debug/view3d.html'), html);
console.log(`\nPreview: build/debug/view3d.html`);
