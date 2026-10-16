// What metatile behaviors (MB_*) mean for movement and warps.

import type { Dir } from '../data/types';

/** A ledge you can hop over, by the direction you hop. */
export const jumpBehavior: Record<Dir, string> = {
  up: 'MB_JUMP_NORTH', down: 'MB_JUMP_SOUTH', left: 'MB_JUMP_WEST', right: 'MB_JUMP_EAST',
};

/** Exit mats: pressing the arrow's direction while standing on one warps. */
export const arrowDir: Record<string, Dir> = {
  MB_NORTH_ARROW_WARP: 'up', MB_SOUTH_ARROW_WARP: 'down', MB_WEST_ARROW_WARP: 'left', MB_EAST_ARROW_WARP: 'right',
};

/** Walking into a door warps. */
export const isDoor = (b: string | null | undefined) => b === 'MB_WARP_DOOR' || b === 'MB_CAVE_DOOR';

/** Stepping onto stairs (or a ladder, escalator, warp pad) warps. */
export const isStairs = (b: string | null | undefined) => /STAIR_WARP|LADDER|REGULAR_WARP|ESCALATOR/.test(b ?? '');
