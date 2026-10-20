import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { blocks, groupByBuilding, stepFade } from '../../src/render/buildingFade';
import type { Quad } from '../../src/data/types';

const q = (k: string, b?: number): Quad => ({ k, p: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], uv: [0, 0, 16, 16], a: 0, ...(b !== undefined && { b }) });

// A house 4 wide, 3 deep and 3 tall, rows 10 to 13; the camera 8 rows south and 3.6 up, as camera.yaml has it.
const house = new THREE.Box3(new THREE.Vector3(10, 0, 10), new THREE.Vector3(14, 3, 13));
const eye = (z: number) => new THREE.Vector3(12, 3.6, z + 8);
const red = (z: number) => [new THREE.Vector3(12, 0.3, z), new THREE.Vector3(12, 1.1, z)];

describe('fading the building in the way', () => {
  it('groups quads by building, leaving out everything else', () => {
    const groups = groupByBuilding([q('ground'), q('wall', 0), q('roof', 0), q('side', 1), q('tree')]);
    expect([...groups.keys()]).toEqual([0, 1]);
    expect(groups.get(0)!.map((x) => x.k)).toEqual(['wall', 'roof']);
  });

  it('fades a house when Red stands just behind it', () => {
    expect(blocks(house, eye(9), red(9))).toBe(true);
  });

  it('fades it when Red is under its roof edge, inside its box', () => {
    expect(blocks(house, eye(10.5), red(10.5))).toBe(true);
  });

  it("doesn't fade it when Red stands in front of it, or off to the side", () => {
    expect(blocks(house, eye(15), red(15))).toBe(false);
    const aside = [new THREE.Vector3(20, 0.3, 9), new THREE.Vector3(20, 1.1, 9)];
    expect(blocks(house, new THREE.Vector3(20, 3.6, 17), aside)).toBe(false);
  });

  it('eases in and out instead of popping', () => {
    expect(stepFade(0, 1, 0.1)).toBeCloseTo(0.5);
    expect(stepFade(0.5, 1, 1)).toBe(1);
    expect(stepFade(1, 0, 0.1)).toBeCloseTo(0.5);
    expect(stepFade(0.2, 0, 1)).toBe(0);
  });
});
