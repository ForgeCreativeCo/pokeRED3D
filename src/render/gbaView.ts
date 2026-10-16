// The original FireRed view: a 240x160 GBA screen drawn from the same game
// state, for compare mode.

import type { LoadedMap } from '../data/load';
import type { World } from '../world/world';
import { actorFrame, actorPos, type Actor } from '../characters/actor';

export class GbaView {
  private ctx: CanvasRenderingContext2D;

  constructor(readonly canvas: HTMLCanvasElement) {
    canvas.width = 240;
    canvas.height = 160;
    this.ctx = canvas.getContext('2d')!;
  }

  /** fallback: the map whose border fills unloaded space when the player isn't on one */
  draw(world: World, player: Actor, actors: Actor[], fallback: LoadedMap) {
    const g = this.ctx, heightAt = (x: number, y: number) => world.heightAt(x, y);
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#000';
    g.fillRect(0, 0, 240, 160);
    const pp = actorPos(player, heightAt);
    // FireRed keeps the player's cell at column 7, row 4 of the 15x10 screen.
    const ox = Math.round(pp.x * 16) - 112, oy = Math.round(pp.y * 16) - 64;
    // Where no map is loaded, the GBA repeats the current map's border blocks.
    const here = world.locate(player.x, player.y)?.m ?? fallback, B = here.data.original.border;
    const bw = (B[2] - B[0]) / 16, bh = (B[3] - B[1]) / 16;
    for (let ty = Math.floor(oy / 16); ty * 16 < oy + 160; ty++)
      for (let tx = Math.floor(ox / 16); tx * 16 < ox + 240; tx++) {
        if (world.locate(tx, ty)) continue;
        const bx = (((tx - here.ox) % bw) + bw) % bw, by = (((ty - here.oy) % bh) + bh) % bh;
        g.drawImage(here.atlas, B[0] + bx * 16, B[1] + by * 16, 16, 16, tx * 16 - ox, ty * 16 - oy, 16, 16);
      }
    const layer = (key: 'below' | 'above') => {
      for (const m of world.areaMaps()) {
        const [u0, v0] = m.data.original[key];
        const W = m.data.width, H = m.data.height;
        g.drawImage(m.atlas, u0, v0, W * 16, H * 16, m.ox * 16 - ox, m.oy * 16 - oy, W * 16, H * 16);
      }
    };
    layer('below');
    // Sprites, back to front; feet on the bottom of their cell.
    for (const a of [...actors].sort((p, q) => actorPos(p, heightAt).y - actorPos(q, heightAt).y)) {
      if (!a.s) continue;
      const p = actorPos(a, heightAt);
      const [u0, v0] = a.s.frames[actorFrame(a)];
      const dx = Math.round(p.x * 16) - ox + (16 - a.s.width) / 2;
      const dy = Math.round((p.y - p.lift) * 16) - oy + 16 - a.s.height;
      g.save();
      if (a.facing === 'right') { g.translate(dx + a.s.width, dy); g.scale(-1, 1); } else g.translate(dx, dy);
      g.drawImage(a.m.atlas, u0, v0, a.s.width, a.s.height, 0, 0, a.s.width, a.s.height);
      g.restore();
    }
    layer('above');
  }
}
