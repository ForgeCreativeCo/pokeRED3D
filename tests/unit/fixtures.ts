// Small hand-made maps for unit tests (no decomp data needed).

import type { LoadedMap } from '../../src/data/load';
import type { MapFile } from '../../src/data/types';

/**
 * A map from rows of characters: '.' walkable ground, '#' blocked,
 * 'v' a ledge you hop southward, '^' raised (height 1) and walkable,
 * 'g' tall grass (a land encounter tile).
 */
export function makeMap(name: string, rows: string[], opts: { area?: number; ox?: number; oy?: number; data?: Partial<MapFile> } = {}): LoadedMap {
  const width = rows[0].length, height = rows.length;
  const cells = rows.join('').split('');
  const data: MapFile = {
    format: { name: 'pokered3d-map', version: 1 },
    name, id: `MAP_${name.toUpperCase()}`, width, height, indoor: false, mapType: 'MAP_TYPE_ROUTE', battleScene: 'MAP_BATTLE_SCENE_NORMAL', music: 'MUS_TEST',
    camera: { preset: 'default', pitch: 55, fov: 24, view: 11 },
    grid: {
      walkable: cells.map((c) => (c === '#' ? 0 : 1)),
      height: cells.map((c) => (c === '^' ? 1 : 0)),
      elevation: cells.map(() => 3),
      behavior: cells.map((c) => (c === 'v' ? 'MB_JUMP_SOUTH' : c === 'g' ? 'MB_TALL_GRASS' : 'MB_NORMAL')),
      encounter: cells.map((c) => (c === 'g' ? 1 : 0)),
      class: cells.map((c) => (c === '#' ? 'wall' : 'ground')),
    },
    connections: [], warps: [], objects: [], signs: [], triggers: [], mapScripts: `${name}_MapScripts`,
    sprites: {}, billboards: { player: 'PLAYER', lean: 20, matchScreenSize: true, feetOffset: 0.2, stepSeconds: 0.25 },
    structures: { buildings: [], objects: [] }, atlas: { file: 'atlas.png' },
    original: { below: [0, 0, 0, 0], above: [0, 0, 0, 0], border: [0, 0, 32, 32] }, quads: [],
    ...opts.data,
  };
  return { data, area: opts.area ?? 0, ox: opts.ox ?? 0, oy: opts.oy ?? 0, atlas: { width: 256, height: 256 } as HTMLImageElement };
}
