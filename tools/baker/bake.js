// Bake maps to the runtime format:
//   build/maps/<Map>/map.json   logic grid, entities, textured quads
//   build/maps/<Map>/atlas.png  texture atlas for the quads
//   build/data/*.json           world layout and start, scripts, music (the game loads these)
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
import { bakeSong } from './lib/music.js';
import { bakeScripts } from './lib/scripts.js';

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

// Scripts and text for every person, sign, step-on trigger and map script in the bake.
const roots = world.flatMap((w) => [
  ...w.data.objects.map((o) => o.script), ...w.data.signs.map((s) => s.script),
  ...w.data.triggers.map((t) => t.script), w.data.mapScripts,
]);
const scripts = { ...bakeScripts(roots), startFlags: [...newGame().hiddenFlags] };
console.log(`Scripts: ${Object.keys(scripts.scripts).length} scripts, ${Object.keys(scripts.text).length} texts`);

// Music: every song the maps play, plus any a script switches to, with the samples they share.
const scriptSongs = Object.values(scripts.scripts).flat().filter(([cmd]) => cmd === 'playbgm' || cmd === 'savebgm').map(([, mus]) => mus);
const music = { songs: {}, samples: {}, waves: {} };
for (const m of new Set([...world.map((w) => w.data.music), ...scriptSongs])) {
  const r = m && m !== 'MUS_DUMMY' && bakeSong(m);
  if (!r) { if (m && m !== 'MUS_DUMMY') console.warn(`  no song data for ${m}`); continue; }
  music.songs[m] = r.song;
  Object.assign(music.samples, r.samples);
  Object.assign(music.waves, r.waves);
}
console.log(`Music: ${Object.keys(music.songs).join(', ')} (${Object.keys(music.samples).length} samples)`);

// The game loads these as files: the world's layout and start, the scripts
// and the music. Each map's map.json and atlas.png are fetched by name.
const DATA = path.join(OUT, 'data');
fs.mkdirSync(DATA, { recursive: true });
const layout = world.map(({ area, ox, oy, data }) => ({ map: data.name, area, ox, oy }));
fs.writeFileSync(path.join(DATA, 'world.json'), JSON.stringify({ format: { name: 'pokered3d-world', version: 1 }, maps: layout, start }));
fs.writeFileSync(path.join(DATA, 'scripts.json'), JSON.stringify(scripts));
fs.writeFileSync(path.join(DATA, 'music.json'), JSON.stringify(music));
console.log(`\nGame data: build/data/ (world, scripts, music)`);

// The preview inlines everything so it opens straight from disk.
const html = fs.readFileSync(path.join(import.meta.dirname, 'debug/view3d.html'), 'utf8')
  .replace('/*DATA*/', `const WORLD = ${JSON.stringify(world)};\nconst START = ${JSON.stringify(start)};\nconst MUSIC = ${JSON.stringify(music)};
const SCRIPTS = ${JSON.stringify(scripts)};`);
fs.mkdirSync(path.join(OUT, 'debug'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'debug/view3d.html'), html);
console.log(`\nPreview: build/debug/view3d.html`);
