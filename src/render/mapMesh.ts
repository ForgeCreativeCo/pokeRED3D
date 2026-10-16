// A map's baked quads as three.js meshes: one opaque, one alpha-tested.

import * as THREE from 'three';
import type { Quad } from '../data/types';
import type { LoadedMap } from '../data/load';

/**
 * Two triangles per quad, in world space (the map's offset applied) with
 * UVs normalised to the atlas size.
 */
export function quadArrays(quads: Quad[], ox: number, oy: number, atlasW: number, atlasH: number) {
  const pos = new Float32Array(quads.length * 18);
  const uv = new Float32Array(quads.length * 12);
  let pi = 0, ui = 0;
  for (const q of quads) {
    const p = q.p, [u0, v0, u1, v1] = q.uv;
    const corners: [number, number, number][] = [[0, u0, v1], [1, u1, v1], [2, u1, v0], [3, u0, v0]];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const [c, u, v] = corners[i];
      pos[pi++] = p[c * 3] + ox; pos[pi++] = p[c * 3 + 1]; pos[pi++] = p[c * 3 + 2] + oy;
      uv[ui++] = u / atlasW; uv[ui++] = v / atlasH;
    }
  }
  return { pos, uv };
}

function geometry(quads: Quad[], m: LoadedMap): THREE.BufferGeometry {
  const { pos, uv } = quadArrays(quads, m.ox, m.oy, m.atlas.width, m.atlas.height);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

export function atlasTexture(m: LoadedMap): THREE.Texture {
  const tex = new THREE.Texture(m.atlas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export interface MapMeshes {
  texture: THREE.Texture;
  opaque: THREE.Mesh;
  cutout: THREE.Mesh;
  /** lit (Lambert) and flat (unlit) materials: [opaque, cutout] */
  materials: { lit: [THREE.Material, THREE.Material]; flat: [THREE.Material, THREE.Material] };
  /** for the people billboards, whose frames are in this map's atlas */
  sprite: THREE.Material;
}

export function buildMapMeshes(m: LoadedMap): MapMeshes {
  const texture = atlasTexture(m);
  const side = THREE.DoubleSide;
  const materials: MapMeshes['materials'] = {
    lit: [new THREE.MeshLambertMaterial({ map: texture, side }), new THREE.MeshLambertMaterial({ map: texture, side, alphaTest: 0.5 })],
    flat: [new THREE.MeshBasicMaterial({ map: texture, side }), new THREE.MeshBasicMaterial({ map: texture, side, alphaTest: 0.5 })],
  };
  const sprite = new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5, side });
  return {
    texture,
    sprite,
    opaque: new THREE.Mesh(geometry(m.data.quads.filter((q) => !q.a), m), materials.lit[0]),
    cutout: new THREE.Mesh(geometry(m.data.quads.filter((q) => q.a), m), materials.lit[1]),
    materials,
  };
}
