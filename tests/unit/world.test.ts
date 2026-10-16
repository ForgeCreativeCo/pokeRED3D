import { describe, expect, it } from 'vitest';
import { World } from '../../src/world/world';
import { makeMap } from './fixtures';

// Two outdoor maps joined north-south, and an interior in its own area.
const town = makeMap('Town', ['....', '.#..', '..^.'], {
  data: {
    warps: [
      { x: 1, y: 0, behavior: 'MB_WARP_DOOR', to: 'House', toWarp: 0 },
      { x: 3, y: 0, behavior: 'MB_WARP_DOOR', to: 'NotBaked', toWarp: 0 },
    ],
    triggers: [{ x: 0, y: 2, var: 'VAR_SCENE', value: '0', script: 'Town_Trigger' }],
  },
});
const route = makeMap('Route', ['.#..', '....'], { oy: -2 });
const house = makeMap('House', ['...', '...'], { area: 1 });
const world = () => new World([town, route, house]);

describe('World', () => {
  it('finds cells across the maps of the current area', () => {
    const w = world();
    expect(w.locate(1, 1)).toMatchObject({ m: town, x: 1, y: 1, i: 5 });
    expect(w.locate(1, -2)).toMatchObject({ m: route, x: 1, y: 0 });
    expect(w.locate(5, 0)).toBeNull();
  });

  it('only sees the current area', () => {
    const w = world();
    expect(w.locate(0, 0)?.m).toBe(town);
    w.area = 1;
    expect(w.locate(0, 0)?.m).toBe(house);
    expect(w.locate(0, -2)).toBeNull();
  });

  it('reads walkability, height and behavior; off the map is blocked', () => {
    const w = world();
    expect(w.walkable(0, 0)).toBe(true);
    expect(w.walkable(1, 1)).toBe(false);
    expect(w.walkable(1, -2)).toBe(false);
    expect(w.walkable(-1, 0)).toBe(false);
    expect(w.heightAt(2, 2)).toBe(1);
    expect(w.heightAt(9, 9)).toBe(0);
    expect(w.behaviorAt(0, 0)).toBe('MB_NORMAL');
    expect(w.behaviorAt(9, 9)).toBeNull();
  });

  it('only offers warps to maps in the bake', () => {
    const w = world();
    expect(w.warpAt(1, 0)?.to).toBe('House');
    expect(w.warpAt(3, 0)).toBeUndefined();
  });

  it('finds triggers whose condition holds', () => {
    const w = world();
    expect(w.triggerAt(0, 2, () => true)?.script).toBe('Town_Trigger');
    expect(w.triggerAt(0, 2, () => false)).toBeUndefined();
  });

  it('looks maps up by folder name and by constant', () => {
    const w = world();
    expect(w.mapByName('House')).toBe(house);
    expect(w.mapById('MAP_ROUTE')).toBe(route);
  });
});
