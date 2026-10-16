// Overworld sprites (player and NPCs) from the decomp's object event data:
//   OBJ_EVENT_GFX_* -> gObjectEventGraphicsInfo_* (size, palette tag, pic table)
//   pic table       -> frames cut from graphics/object_events/pics/**.png
//   palette tag     -> graphics/object_events/palettes/*.pal

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { DECOMP_DIR } from './decomp.js';
import { Image } from './raster.js';

const src = (file) => fs.readFileSync(path.join(DECOMP_DIR, file), 'utf8');

let tables;
function load() {
  if (tables) return tables;
  const pointers = new Map();
  for (const [, gfx, info] of src('src/data/object_events/object_event_graphics_info_pointers.h').matchAll(/\[(OBJ_EVENT_GFX_\w+)\]\s*=\s*&(gObjectEventGraphicsInfo_\w+)/g))
    pointers.set(gfx, info);

  const infos = new Map();
  for (const [, name, body] of src('src/data/object_events/object_event_graphics_info.h').matchAll(/struct ObjectEventGraphicsInfo (\w+) = \{([\s\S]*?)\n\};/g)) {
    const field = (f) => body.match(new RegExp(`\\.${f}\\s*=\\s*([^,]+),`))?.[1].trim();
    infos.set(name, {
      width: Number(field('width')), height: Number(field('height')),
      paletteTag: field('paletteTag'), shadowSize: field('shadowSize'),
      inanimate: field('inanimate') === 'TRUE', images: field('images'),
    });
  }

  const picTables = new Map();
  for (const [, name, body] of src('src/data/object_events/object_event_pic_tables.h').matchAll(/SpriteFrameImage (\w+)\[\]\s*=\s*\{([\s\S]*?)\};/g)) {
    picTables.set(name, [...body.matchAll(/overworld_frame\((\w+),\s*(\d+),\s*(\d+),\s*(\d+)\)/g)]
      .map(([, pic, w, h, frame]) => ({ pic, w: Number(w) * 8, h: Number(h) * 8, frame: Number(frame) })));
  }

  const files = new Map(); // gObjectEventPic_X / gObjectEventPal_X -> path
  for (const [, name, file] of src('src/data/object_events/object_event_graphics.h').matchAll(/(gObjectEvent(?:Pic|Pal)_\w+)\[\]\s*=\s*INCBIN_U(?:16|32)\("([^"]+)"\)/g))
    files.set(name, file);

  const palByTag = new Map();
  for (const [, pal, tag] of src('src/event_object_movement.c').matchAll(/\{(gObjectEventPal_\w+),\s*(OBJ_EVENT_PAL_TAG_\w+)\}/g))
    if (!palByTag.has(tag)) palByTag.set(tag, pal);

  tables = { pointers, infos, picTables, files, palByTag };
  return tables;
}

function readJascPal(file) {
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(3).map((l) => l.trim().split(/\s+/).map(Number));
}

/** Palette indices of an indexed PNG, recovered from its RGBA decode. */
function readIndexed(file) {
  const png = PNG.sync.read(fs.readFileSync(file), { skipRescale: true });
  const lookup = new Map(png.palette.map((c, i) => [(c[0] << 16) | (c[1] << 8) | c[2], i]));
  const idx = new Uint8Array(png.width * png.height);
  for (let i = 0; i < idx.length; i++) idx[i] = lookup.get((png.data[i * 4] << 16) | (png.data[i * 4 + 1] << 8) | png.data[i * 4 + 2]) ?? 0;
  return { width: png.width, height: png.height, idx };
}

/**
 * The first `count` frames of a sprite as images, in FireRed's frame order:
 * 0 face south, 1 north, 2 west, 3-4 walk south, 5-6 walk north, 7-8 walk west
 * (east is west mirrored).
 */
export function readSprite(gfx, count = 9) {
  const t = load();
  const infoName = t.pointers.get(gfx);
  const info = infoName && t.infos.get(infoName);
  if (!info) throw new Error(`No graphics info for ${gfx}`);
  const frames = t.picTables.get(info.images);
  if (!frames) throw new Error(`${gfx}: no pic table ${info.images}`);
  const palName = t.palByTag.get(info.paletteTag);
  const palette = readJascPal(path.join(DECOMP_DIR, t.files.get(palName).replace(/\.gbapal$/, '.pal')));

  const sheets = new Map();
  const images = frames.slice(0, Math.min(count, frames.length)).map(({ pic, w, h, frame }) => {
    if (!sheets.has(pic)) sheets.set(pic, readIndexed(path.join(DECOMP_DIR, t.files.get(pic).replace(/\.4bpp$/, '.png'))));
    const sheet = sheets.get(pic);
    const perRow = Math.max(1, Math.floor(sheet.width / w));
    const ox = (frame % perRow) * w, oy = Math.floor(frame / perRow) * h;
    const img = new Image(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = sheet.idx[(oy + y) * sheet.width + ox + x];
        if (v) img.set(x, y, palette[v]); // colour 0 is transparent
      }
    return img;
  });
  return { gfx, width: info.width, height: info.height, shadowSize: info.shadowSize, inanimate: info.inanimate, frames: images };
}
