import { describe, expect, it } from 'vitest';
import { quadArrays } from '../../src/render/mapMesh';
import type { Quad } from '../../src/data/types';

// A flat ground tile at cell (2, 3): corners bottom-left, bottom-right,
// top-right, top-left as seen in the texture.
const ground: Quad = { k: 'ground', p: [2, 0, 4, 3, 0, 4, 3, 0, 3, 2, 0, 3], uv: [16, 32, 32, 48], a: 0 };

describe('quadArrays', () => {
  it('makes two triangles per quad, offset into world space', () => {
    const { pos } = quadArrays([ground], 10, -20, 64, 64);
    expect(pos).toHaveLength(18);
    // first triangle: bottom-left, bottom-right, top-right
    expect([...pos.slice(0, 9)]).toEqual([12, 0, -16, 13, 0, -16, 13, 0, -17]);
    // second: bottom-left, top-right, top-left
    expect([...pos.slice(9)]).toEqual([12, 0, -16, 13, 0, -17, 12, 0, -17]);
  });

  it('normalises atlas pixels to UVs, with the texture bottom at v1', () => {
    const { uv } = quadArrays([ground], 0, 0, 64, 64);
    expect([...uv.slice(0, 6)]).toEqual([0.25, 0.75, 0.5, 0.75, 0.5, 0.5]);
  });
});
