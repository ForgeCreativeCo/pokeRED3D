// The loaded maps as one grid. Connected outdoor maps share an area and sit
// at their offsets in shared world coordinates; each interior is its own
// area. Only the current area is walkable.

import type { LoadedMap } from '../data/load';
import type { Trigger, Warp } from '../data/types';

export interface Cell {
  m: LoadedMap;
  /** index into the map's grid arrays */
  i: number;
  /** cell in the map's own coordinates */
  x: number;
  y: number;
}

export class World {
  area = 0;

  constructor(readonly maps: LoadedMap[]) {}

  inArea(m: LoadedMap) {
    return m.area === this.area;
  }

  areaMaps() {
    return this.maps.filter((m) => this.inArea(m));
  }

  /** by folder name, e.g. PalletTown */
  mapByName(name: string | undefined) {
    return this.maps.find((m) => m.data.name === name);
  }

  /** by constant, e.g. MAP_PALLET_TOWN */
  mapById(id: string | undefined) {
    return this.maps.find((m) => m.data.id === id);
  }

  /** The current area's cell at world (gx, gy), if a map covers it. */
  locate(gx: number, gy: number): Cell | null {
    for (const m of this.areaMaps()) {
      const x = gx - m.ox, y = gy - m.oy;
      if (x >= 0 && y >= 0 && x < m.data.width && y < m.data.height) return { m, i: y * m.data.width + x, x, y };
    }
    return null;
  }

  walkable(gx: number, gy: number) {
    const c = this.locate(gx, gy);
    return !!c && !!c.m.data.grid.walkable[c.i];
  }

  heightAt(gx: number, gy: number) {
    const c = this.locate(gx, gy);
    return c ? c.m.data.grid.height[c.i] : 0;
  }

  behaviorAt(gx: number, gy: number): string | null {
    const c = this.locate(gx, gy);
    return c ? c.m.data.grid.behavior[c.i] : null;
  }

  /** A warp at this cell leading to a map in the bake. */
  warpAt(gx: number, gy: number): Warp | undefined {
    const c = this.locate(gx, gy);
    return c?.m.data.warps.find((w) => w.x === c.x && w.y === c.y && w.to && this.mapByName(w.to));
  }

  /** The first step-on trigger at this cell that holds. */
  triggerAt(gx: number, gy: number, holds: (t: Trigger) => boolean): Trigger | undefined {
    const c = this.locate(gx, gy);
    return c?.m.data.triggers.find((t) => t.x === c.x && t.y === c.y && holds(t));
  }
}
