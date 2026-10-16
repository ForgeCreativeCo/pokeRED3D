import { beforeEach, describe, expect, it } from 'vitest';
import { actorFrame, actorPos, faceToward, forceStep, makeActor } from '../../src/characters/actor';
import { updateNpc } from '../../src/characters/npc';
import { seedRandom } from '../../src/core/random';
import { Clock } from '../../src/core/clock';
import { makeMap } from './fixtures';

const map = makeMap('Field', ['.....', '.....', '.....', '.....', '.....']);
const flat = () => 0;

beforeEach(() => seedRandom(1));

describe('actors', () => {
  it('start from their map object, with defaults', () => {
    const a = makeActor({ gfx: 'GFX', x: 2, y: 3 }, map);
    expect(a).toMatchObject({ x: 2, y: 3, home: { x: 2, y: 3 }, facing: 'down', range: [0, 0], removed: false, from: null });
    expect(a.wait).toBeGreaterThanOrEqual(1);
    expect(a.wait).toBeLessThan(4);
  });

  it('move between cells over a step, with a walking frame for the first half', () => {
    const a = makeActor({ gfx: 'GFX', x: 2, y: 2 }, map);
    forceStep(a, 'right');
    expect(a).toMatchObject({ x: 3, y: 2, from: { x: 2, y: 2 }, facing: 'right', parity: 1 });
    a.t = 0.25;
    expect(actorPos(a, flat)).toEqual({ x: 2.25, y: 2, h: 0, lift: 0 });
    expect(actorFrame(a)).toBe(8); // walk west frame 2, mirrored for east
    a.t = 0.75;
    expect(actorFrame(a)).toBe(2); // standing west frame
  });

  it('rise and fall over a ledge hop', () => {
    const a = makeActor({ gfx: 'GFX', x: 2, y: 2 }, map);
    a.from = { x: 2, y: 0 }; a.t = 0.5; a.jump = true;
    expect(actorPos(a, flat).lift).toBeCloseTo(0.6);
    a.t = 1;
    expect(actorPos(a, flat).lift).toBe(0);
  });

  it('turn to face someone along the longer axis', () => {
    const a = makeActor({ gfx: 'GFX', x: 2, y: 2 }, map);
    faceToward(a, makeActor({ gfx: 'GFX', x: 4, y: 3 }, map));
    expect(a.facing).toBe('right');
    faceToward(a, makeActor({ gfx: 'GFX', x: 2, y: 0 }, map));
    expect(a.facing).toBe('up');
  });
});

describe('wandering', () => {
  it('stays inside its range', () => {
    const a = makeActor({ gfx: 'GFX', x: 2, y: 2, movement: 'MOVEMENT_TYPE_WANDER_AROUND', range: [1, 1] }, map);
    const step = (b: typeof a, dir: 'up' | 'down' | 'left' | 'right') => { forceStep(b, dir); return true; };
    for (let i = 0; i < 500; i++) {
      updateNpc(a, 5, () => 'MB_NORMAL', step);
      a.from = null;
      expect(Math.abs(a.x - 2)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.y - 2)).toBeLessThanOrEqual(1);
    }
  });

  it('never hops a ledge', () => {
    const a = makeActor({ gfx: 'GFX', x: 2, y: 2, movement: 'MOVEMENT_TYPE_WANDER_UP_AND_DOWN', range: [0, 3] }, map);
    let stepped = 0;
    for (let i = 0; i < 100; i++) updateNpc(a, 5, () => 'MB_JUMP_SOUTH', () => { stepped++; return true; });
    expect(stepped).toBe(0);
  });

  it('is reproducible from a seed', () => {
    const run = () => {
      seedRandom(42);
      const a = makeActor({ gfx: 'GFX', x: 2, y: 2, movement: 'MOVEMENT_TYPE_WANDER_AROUND', range: [2, 2] }, map);
      const path: string[] = [];
      for (let i = 0; i < 50; i++) { updateNpc(a, 1, () => 'MB_NORMAL', (b, d) => { forceStep(b, d); return true; }); a.from = null; path.push(`${a.x},${a.y}`); }
      return path.join(' ');
    };
    expect(run()).toBe(run());
  });
});

describe('Clock', () => {
  it('resolves a frame delay after that many 60ths of a second', async () => {
    const clock = new Clock();
    let done = false;
    clock.delayFrames(6).then(() => { done = true; });
    for (let i = 0; i < 5; i++) clock.tick(1 / 60);
    await Promise.resolve();
    expect(done).toBe(false);
    clock.tick(1 / 60 + 1e-9);
    await Promise.resolve();
    expect(done).toBe(true);
  });
});
