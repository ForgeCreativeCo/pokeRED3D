// Software rasterising of metatiles and layouts, used for debug images and
// for pixel statistics in the classifier.

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { metatileFor, tilePixels, paletteColor } from './decomp.js';

export class Image {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
  set(x, y, [r, g, b], a = 255) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    if (a === 255) {
      this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = 255;
    } else {
      const t = a / 255;
      this.data[i] = this.data[i] * (1 - t) + r * t;
      this.data[i + 1] = this.data[i + 1] * (1 - t) + g * t;
      this.data[i + 2] = this.data[i + 2] * (1 - t) + b * t;
      this.data[i + 3] = Math.max(this.data[i + 3], a);
    }
  }
  fill(x0, y0, w, h, rgb, a = 255) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, rgb, a);
  }
  rect(x0, y0, w, h, rgb) {
    for (let x = x0; x < x0 + w; x++) { this.set(x, y0, rgb); this.set(x, y0 + h - 1, rgb); }
    for (let y = y0; y < y0 + h; y++) { this.set(x0, y, rgb); this.set(x0 + w - 1, y, rgb); }
  }
  blit(src, dx, dy) {
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        const i = (y * src.width + x) * 4;
        if (src.data[i + 3]) this.set(dx + x, dy + y, [src.data[i], src.data[i + 1], src.data[i + 2]], src.data[i + 3]);
      }
  }
  clone() {
    const out = new Image(this.width, this.height);
    out.data.set(this.data);
    return out;
  }
  scaled(k) {
    const out = new Image(this.width * k, this.height * k);
    for (let y = 0; y < out.height; y++)
      for (let x = 0; x < out.width; x++) {
        const si = (Math.floor(y / k) * this.width + Math.floor(x / k)) * 4, di = (y * out.width + x) * 4;
        for (let c = 0; c < 4; c++) out.data[di + c] = this.data[si + c];
      }
    return out;
  }
  save(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const png = new PNG({ width: this.width, height: this.height });
    png.data = Buffer.from(this.data.buffer);
    fs.writeFileSync(file, PNG.sync.write(png));
  }
}

/** Draw the 4 tiles of one metatile layer (0 = first, 1 = second) into img. */
export function drawMetatileLayer(img, pair, metatile, layer, dx, dy) {
  for (let q = 0; q < 4; q++) {
    const { tile, hflip, vflip, palette } = metatile.tiles[layer * 4 + q];
    const px = tilePixels(pair, tile);
    const ox = dx + (q % 2) * 8, oy = dy + Math.floor(q / 2) * 8;
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const idx = px[(vflip ? 7 - y : y) * 8 + (hflip ? 7 - x : x)];
        if (idx === 0) continue; // colour 0 is transparent
        img.set(ox + x, oy + y, paletteColor(pair, palette, idx));
      }
  }
}

/**
 * Opaque pixel count (0..256) for each layer of a metatile. On FireRed the
 * second layer of a "normal" metatile is drawn above sprites, so pixels there
 * are things that overhang the player (tree tops, roof edges).
 */
export function layerCoverage(pair, metatile) {
  return [0, 1].map((layer) => {
    let n = 0;
    for (let q = 0; q < 4; q++) {
      const px = tilePixels(pair, metatile.tiles[layer * 4 + q].tile);
      for (const v of px) if (v) n++;
    }
    return n;
  });
}

export function renderMetatile(pair, id) {
  const img = new Image(16, 16);
  const mt = metatileFor(pair, id);
  if (!mt) return img;
  img.fill(0, 0, 16, 16, paletteColor(pair, 0, 0)); // backdrop colour
  drawMetatileLayer(img, pair, mt, 0, 0, 0);
  drawMetatileLayer(img, pair, mt, 1, 0, 0);
  return img;
}

export function renderLayout(layout, pair) {
  const img = new Image(layout.width * 16, layout.height * 16);
  layout.cells.forEach((c, i) => img.blit(renderMetatile(pair, c.metatile), (i % layout.width) * 16, Math.floor(i / layout.width) * 16));
  return img;
}
