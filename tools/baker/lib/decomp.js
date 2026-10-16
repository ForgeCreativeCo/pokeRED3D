// Readers for the pret/pokefirered decompilation's map and tileset data.
// Everything here mirrors the C definitions in include/global.fieldmap.h,
// include/fieldmap.h and src/fieldmap.c.

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

export const DECOMP_DIR = path.resolve(import.meta.dirname, '../../../vendor/pokefirered');

export const NUM_TILES_IN_PRIMARY = 640;
export const NUM_METATILES_IN_PRIMARY = 640;
export const NUM_PALS_IN_PRIMARY = 7;
export const NUM_PALS_TOTAL = 13;

export const LAYER_TYPE = ['normal', 'covered', 'split'];

const decompPath = (...p) => path.join(DECOMP_DIR, ...p);

export function assertDecomp() {
  if (!fs.existsSync(decompPath('Makefile'))) {
    throw new Error(`Decomp not found at ${DECOMP_DIR}. Run: npm run setup:decomp`);
  }
}

// ---- constants parsed straight from the headers, so we never copy tables ----

let behaviorCache;
/** Map of behavior value -> name ("MB_TALL_GRASS"), from metatile_behaviors.h */
export function behaviorNames() {
  if (behaviorCache) return behaviorCache;
  const src = fs.readFileSync(decompPath('include/constants/metatile_behaviors.h'), 'utf8');
  behaviorCache = new Map();
  for (const [, name, value] of src.matchAll(/#define\s+(MB_\w+)\s+(0x[0-9A-Fa-f]+|\d+)/g)) {
    if (name !== 'NUM_METATILE_BEHAVIORS') behaviorCache.set(Number(value), name);
  }
  return behaviorCache;
}

// ---- layouts ----

let layoutsCache;
export function layouts() {
  if (!layoutsCache) {
    const json = JSON.parse(fs.readFileSync(decompPath('data/layouts/layouts.json'), 'utf8'));
    layoutsCache = json.layouts.filter((l) => l.id); // skip empty placeholder slots
  }
  return layoutsCache;
}

export function layoutById(id) {
  const layout = layouts().find((l) => l.id === id);
  if (!layout) throw new Error(`Unknown layout ${id}`);
  return layout;
}

/** Decode a map.bin into cells of { metatile, collision, elevation }. */
export function readBlockdata(file, width, height) {
  const buf = fs.readFileSync(decompPath(file));
  const cells = [];
  for (let i = 0; i < width * height; i++) {
    const v = buf.readUInt16LE(i * 2);
    cells.push({ metatile: v & 0x03ff, collision: (v & 0x0c00) >> 10, elevation: (v & 0xf000) >> 12 });
  }
  return cells;
}

export function readLayout(id) {
  const l = layoutById(id);
  return {
    ...l,
    cells: readBlockdata(l.blockdata_filepath, l.width, l.height),
    border: readBlockdata(l.border_filepath, l.border_width, l.border_height),
  };
}

let mapIndex;
/** "MAP_ROUTE21_NORTH" -> "Route21_North" (folder under data/maps) */
export function mapNameById(id) {
  if (!mapIndex) {
    mapIndex = new Map();
    for (const dir of fs.readdirSync(decompPath('data/maps'))) {
      const file = decompPath('data/maps', dir, 'map.json');
      if (fs.existsSync(file)) mapIndex.set(JSON.parse(fs.readFileSync(file, 'utf8')).id, dir);
    }
  }
  return mapIndex.get(id);
}

export function readMap(name) {
  return JSON.parse(fs.readFileSync(decompPath('data/maps', name, 'map.json'), 'utf8'));
}

// ---- tilesets ----

let tilesetDirsCache;
/** "gTileset_PalletTown" -> data/tilesets/secondary/pallet_town, read from src/data/tilesets/metatiles.h */
export function tilesetDir(symbol) {
  if (!tilesetDirsCache) {
    tilesetDirsCache = new Map();
    const src = fs.readFileSync(decompPath('src/data/tilesets/metatiles.h'), 'utf8');
    for (const [, name, kind, key] of src.matchAll(/gMetatiles_(\w+)\[\]\s*=\s*INCBIN_U16\("data\/tilesets\/(primary|secondary)\/(\w+)\/metatiles\.bin"\)/g)) {
      tilesetDirsCache.set(`gTileset_${name}`, { dir: decompPath('data/tilesets', kind, key), kind, key });
    }
    // Some tilesets borrow another's graphics (SilphCo uses Condominiums), so
    // tiles and palettes come from the header's .tiles / .palettes symbols.
    const gfx = fs.readFileSync(decompPath('src/data/tilesets/graphics.h'), 'utf8');
    const gfxDir = new Map();
    for (const [, sym, file] of gfx.matchAll(/(gTileset(?:Tiles|Palettes)_\w+)\[\](?:\[16\])?\s*=\s*\{?\s*INCBIN_U(?:16|32)\("([^"]+)"\)/g)) {
      gfxDir.set(sym, path.dirname(file));
    }
    const headers = fs.readFileSync(decompPath('src/data/tilesets/headers.h'), 'utf8');
    for (const [, name, body] of headers.matchAll(/struct Tileset (gTileset_\w+) =\s*\{([\s\S]*?)\};/g)) {
      const entry = tilesetDirsCache.get(name);
      if (!entry) continue;
      const tiles = body.match(/\.tiles\s*=\s*(\w+)/)?.[1], pals = body.match(/\.palettes\s*=\s*(\w+)/)?.[1];
      if (gfxDir.has(tiles)) entry.tilesDir = decompPath(gfxDir.get(tiles));
      // Palette files live in <tileset>/palettes; keep the tileset folder.
      if (gfxDir.has(pals)) entry.palDir = decompPath(path.dirname(gfxDir.get(pals)));
    }
  }
  const found = tilesetDirsCache.get(symbol);
  if (!found) throw new Error(`No metatiles entry for ${symbol} in src/data/tilesets/metatiles.h`);
  return found;
}

function readJascPal(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(3);
  return lines.map((l) => l.trim().split(/\s+/).map(Number));
}

const tilesetCache = new Map();
export function readTileset(symbol) {
  if (tilesetCache.has(symbol)) return tilesetCache.get(symbol);
  const { dir, kind, key, tilesDir = dir, palDir = dir } = tilesetDir(symbol);

  const metaBuf = fs.readFileSync(path.join(dir, 'metatiles.bin'));
  const attrBuf = fs.readFileSync(path.join(dir, 'metatile_attributes.bin'));
  const count = attrBuf.length / 4;

  const metatiles = [];
  for (let i = 0; i < count; i++) {
    const tiles = [];
    for (let t = 0; t < 8; t++) {
      const v = metaBuf.readUInt16LE(i * 16 + t * 2);
      tiles.push({ tile: v & 0x3ff, hflip: !!(v & 0x400), vflip: !!(v & 0x800), palette: v >> 12 });
    }
    const a = attrBuf.readUInt32LE(i * 4);
    metatiles.push({
      index: i,
      tiles, // [0..3] = first layer TL,TR,BL,BR; [4..7] = second layer
      attributes: a,
      behavior: a & 0x1ff,
      terrain: (a & 0x3e00) >> 9,
      encounterType: (a & 0x07000000) >> 24,
      layerType: LAYER_TYPE[(a & 0x60000000) >> 29] ?? 'unknown',
    });
  }

  const png = PNG.sync.read(fs.readFileSync(path.join(tilesDir, 'tiles.png')), { skipRescale: true });
  const palettes = fs.readdirSync(path.join(palDir, 'palettes'))
    .filter((f) => f.endsWith('.pal'))
    .sort()
    .map((f) => readJascPal(path.join(palDir, 'palettes', f)));

  const ts = { symbol, key, kind, dir, metatiles, palettes, tilesPng: png, tileIndices: pngToIndices(png) };
  tilesetCache.set(symbol, ts);
  return ts;
}

// pngjs decodes palette PNGs into RGBA; recover the 4bpp colour index by
// matching against the PNG's own palette (decomp tiles.png files are indexed).
function pngToIndices(png) {
  const pal = png.palette;
  const out = new Uint8Array(png.width * png.height);
  if (!pal) throw new Error('tiles.png is not an indexed PNG');
  const lookup = new Map(pal.map((c, i) => [(c[0] << 16) | (c[1] << 8) | c[2], i]));
  for (let i = 0; i < out.length; i++) {
    const r = png.data[i * 4], g = png.data[i * 4 + 1], b = png.data[i * 4 + 2];
    out[i] = lookup.get((r << 16) | (g << 8) | b) ?? 0;
  }
  return out;
}

/** The primary+secondary pair a layout renders with. */
export function tilesetPair(layout) {
  return { primary: readTileset(layout.primary_tileset), secondary: readTileset(layout.secondary_tileset) };
}

export function metatileFor(pair, id) {
  return id < NUM_METATILES_IN_PRIMARY ? pair.primary.metatiles[id] : pair.secondary.metatiles[id - NUM_METATILES_IN_PRIMARY];
}

/** 8x8 palette indices for a global tile number (0..1023). */
export function tilePixels(pair, tile) {
  const ts = tile < NUM_TILES_IN_PRIMARY ? pair.primary : pair.secondary;
  const local = tile < NUM_TILES_IN_PRIMARY ? tile : tile - NUM_TILES_IN_PRIMARY;
  const perRow = ts.tilesPng.width / 8;
  const tx = (local % perRow) * 8, ty = Math.floor(local / perRow) * 8;
  const out = new Uint8Array(64);
  if (ty >= ts.tilesPng.height) return out; // out of range: transparent
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) out[y * 8 + x] = ts.tileIndices[(ty + y) * ts.tilesPng.width + tx + x];
  return out;
}

/** RGB for a global palette slot: 0-6 from the primary tileset, 7-12 from the secondary. */
export function paletteColor(pair, palette, index) {
  const src = palette < NUM_PALS_IN_PRIMARY ? pair.primary.palettes : pair.secondary.palettes;
  return src[palette]?.[index] ?? [255, 0, 255];
}

// ---- tile animations ----

let animCache;
/**
 * Animated tile ranges from src/tileset_anims.c, e.g.
 * { name: 'General_Flower', tileset: 'gTileset_General', start: 508, count: 4 }.
 * `start` is a global tile number (secondary tilesets start at 640).
 */
export function tileAnimations() {
  if (animCache) return animCache;
  const src = fs.readFileSync(decompPath('src/tileset_anims.c'), 'utf8');
  animCache = [];
  for (const [, name, start, count] of src.matchAll(/AppendTilesetAnimToBuffer\(sTilesetAnims_(\w+?)\[[^;]*TILE_OFFSET_4BPP\((\d+)\)\),\s*(\d+)\s*\*\s*TILE_SIZE_4BPP\)/g)) {
    animCache.push({ name, tileset: `gTileset_${name.split('_')[0]}`, start: Number(start), count: Number(count) });
  }
  return animCache;
}

// ---- new game ----

let newGameCache;
/**
 * What a fresh save looks like: the flags EventScript_ResetAllMapFlags sets
 * (objects hidden at the start), and where new_game.c drops the player.
 */
export function newGame() {
  if (newGameCache) return newGameCache;
  const scripts = fs.readFileSync(decompPath('data/event_scripts.s'), 'utf8');
  const body = scripts.match(/^EventScript_ResetAllMapFlags::\s*\n([\s\S]*?)^\s*end\b/m)?.[1] ?? '';
  const flags = [...body.matchAll(/setflag\s+(FLAG_\w+)/g)].map((m) => m[1]);
  const src = fs.readFileSync(decompPath('src/new_game.c'), 'utf8');
  const warp = src.match(/SetWarpDestination\(MAP_GROUP\((MAP_\w+)\),\s*MAP_NUM\(\1\),\s*-?\d+,\s*(\d+),\s*(\d+)\)/);
  newGameCache = { hiddenFlags: new Set(flags), start: warp ? { map: mapNameById(warp[1]), x: Number(warp[2]), y: Number(warp[3]) } : null };
  return newGameCache;
}
