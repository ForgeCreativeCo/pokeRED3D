// People on the map (the player included): where they stand, which way they
// face, and how far through a step they are. Drawing them is actorView.ts.

import type { Dir, MapObject, SpriteSheet } from '../data/types';
import type { LoadedMap } from '../data/load';
import { random } from '../core/random';

export interface Actor {
  gfx: string;
  /** the sprite sheet; missing for sprites chosen at runtime (OBJ_EVENT_GFX_VAR_*) */
  s: SpriteSheet | undefined;
  m: LoadedMap;
  area: number;
  id: string | null;
  script: string | null;
  /** the flag that hides this person while set */
  flag: string | null;
  removed: boolean;
  /** hidden by a movement script (set_invisible) */
  invisible: boolean;
  startFacing: Dir;
  /** world cell; while stepping, the cell being stepped to */
  x: number;
  y: number;
  home: { x: number; y: number };
  /** how far a wanderer may roam from home, in cells */
  range: [number, number];
  movement: string;
  facing: Dir;
  /** the cell being stepped from, while stepping */
  from: { x: number; y: number } | null;
  /** progress through the step, 0-1 */
  t: number;
  /** this step is a ledge hop */
  jump: boolean;
  /** which foot leads, alternating each step */
  parity: number;
  /** seconds left before a tap that turned on the spot becomes a step */
  turnHold: number;
  /** seconds until a wanderer next moves */
  wait: number;
}

export type ActorSpec = Partial<MapObject> & Pick<MapObject, 'gfx' | 'x' | 'y'>;

export const steps: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
export const opposite: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };
/** script direction numbers (DIR_SOUTH = 1, ...) */
export const DIR_OF: Record<number, Dir> = { 1: 'down', 2: 'up', 3: 'left', 4: 'right' };
export const DIR_NUM: Record<Dir, number> = { down: 1, up: 2, left: 3, right: 4 };

// FireRed frame order: 0 face S, 1 N, 2 W, 3-4 walk S, 5-6 walk N, 7-8 walk W; east mirrors west.
const standFrame: Record<Dir, number> = { down: 0, up: 1, left: 2, right: 2 };
const walkFrames: Record<Dir, [number, number]> = { down: [3, 4], up: [5, 6], left: [7, 8], right: [7, 8] };
/** tiles at the top of a ledge hop */
const JUMP_HEIGHT = 0.6;

export function makeActor(spec: ActorSpec, m: LoadedMap): Actor {
  const { gfx, x, y, facing = 'down', movement = '', range = [0, 0], id = null, script = null, flag = null, hidden = false } = spec;
  return {
    gfx, s: m.data.sprites[gfx], m, area: m.area, id, script, flag, removed: hidden, invisible: false,
    startFacing: facing, x, y, home: { x, y }, range, movement, facing,
    from: null, t: 1, jump: false, parity: 0, turnHold: 0, wait: 1 + random() * 3,
  };
}

/** Where an actor is between cells (world tiles, cell top-left), its ground height and hop height. */
export function actorPos(a: Actor, heightAt: (x: number, y: number) => number) {
  const k = a.from ? Math.min(a.t, 1) : 1;
  const fx = a.from ? a.from.x : a.x, fy = a.from ? a.from.y : a.y;
  const h0 = heightAt(fx, fy), h1 = heightAt(a.x, a.y);
  const lift = a.from && a.jump ? 4 * k * (1 - k) * JUMP_HEIGHT : 0;
  return { x: fx + (a.x - fx) * k, y: fy + (a.y - fy) * k, h: h0 + (h1 - h0) * k, lift };
}

/** The sprite frame to show: a walking frame for the first half of a step (all of a hop). */
export const actorFrame = (a: Actor) => (a.from && (a.jump || a.t < 0.5) ? walkFrames[a.facing][a.parity] : standFrame[a.facing]);

/** A scripted step: no collision or warp checks, the script knows the way. */
export function forceStep(a: Actor, dir: Dir) {
  const [dx, dy] = steps[dir];
  a.facing = dir;
  a.from = { x: a.x, y: a.y };
  a.x += dx; a.y += dy; a.t = 0; a.jump = false;
  a.parity ^= 1;
}

export function faceToward(a: Actor, b: Actor) {
  const dx = b.x - a.x, dy = b.y - a.y;
  a.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
}
