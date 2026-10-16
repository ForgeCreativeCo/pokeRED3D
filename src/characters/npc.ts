// NPC movement types: FACE_* stand still, WANDER_* roam inside their range,
// LOOK_AROUND turns.

import type { Dir } from '../data/types';
import { random } from '../core/random';
import { steps, type Actor } from './actor';

const ALL: Dir[] = ['up', 'down', 'left', 'right'];

export function updateNpc(
  a: Actor, dt: number,
  behaviorAt: (x: number, y: number) => string | null,
  startStep: (a: Actor, dir: Dir) => boolean,
) {
  if (a.from) return;
  a.wait -= dt;
  if (a.wait > 0) return;
  a.wait = 1 + random() * 3;
  const mv = a.movement;
  let dirs: Dir[] | null = null;
  if (mv === 'MOVEMENT_TYPE_WANDER_AROUND') dirs = ALL;
  else if (mv === 'MOVEMENT_TYPE_WANDER_UP_AND_DOWN') dirs = ['up', 'down'];
  else if (mv === 'MOVEMENT_TYPE_WANDER_LEFT_AND_RIGHT') dirs = ['left', 'right'];
  if (mv === 'MOVEMENT_TYPE_LOOK_AROUND') { a.facing = ALL[Math.floor(random() * 4)]; return; }
  if (!dirs) return;
  const dir = dirs[Math.floor(random() * dirs.length)];
  const [dx, dy] = steps[dir];
  const nx = a.x + dx - a.home.x, ny = a.y + dy - a.home.y;
  // Wanderers stay in their range and never hop ledges.
  if (Math.abs(nx) > a.range[0] || Math.abs(ny) > a.range[1] || behaviorAt(a.x + dx, a.y + dy)?.startsWith('MB_JUMP')) { a.facing = dir; return; }
  startStep(a, dir);
}
