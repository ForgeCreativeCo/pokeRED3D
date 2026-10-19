// Outdoor doors seen through buildings: with the camera low, a house in front
// can hide the door you're walking to. Each door gets a copy of its tile,
// drawn only where something stands in front of it, and only near the player.

import * as THREE from 'three';
import type { LoadedMap } from '../data/load';
import type { World } from '../world/world';
import { isDoor } from '../world/behaviors';
import type { MapMeshes } from './mapMesh';

/** tiles from the player: fully shown within NEAR, gone past FAR */
const NEAR = 4, FAR = 7;
const OPACITY = 0.6;

interface Ghost { m: LoadedMap; mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; at: THREE.Vector3 }

export class DoorGhosts {
  private ghosts: Ghost[] = [];

  constructor(scene: THREE.Scene, meshes: Map<LoadedMap, MapMeshes>) {
    for (const [m, mm] of meshes) {
      if (m.data.indoor) continue;
      for (const w of m.data.warps) {
        if (!isDoor(m.data.grid.behavior[w.y * m.data.width + w.x])) continue;
        // The door's wall column: its bottom-left corner is at the door cell's front edge.
        const q = m.data.quads.find((q) => q.k === 'wall' && q.p[0] === w.x && q.p[2] === w.y + 1);
        if (!q) continue;
        // The column stacks its wall rows 16 px each; the door is the bottom one.
        const [u0, , u1, v1] = q.uv;
        const rows = (q.uv[3] - q.uv[1]) / 16;
        const base = q.p[1], top = base + (q.p[7] - base) / rows;
        const x = w.x + m.ox, z = w.y + 1 + m.oy + 0.02; // a hair in front of the wall, so it hides behind it
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute([x, base, z, x + 1, base, z, x + 1, top, z, x, top, z], 3));
        const AW = m.atlas.width, AH = m.atlas.height;
        geo.setAttribute('uv', new THREE.Float32BufferAttribute([u0 / AW, v1 / AH, u1 / AW, v1 / AH, u1 / AW, (v1 - 16) / AH, u0 / AW, (v1 - 16) / AH], 2));
        geo.setIndex([0, 1, 2, 0, 2, 3]);
        const mat = new THREE.MeshBasicMaterial({
          map: mm.texture, color: '#ffd98a', transparent: true, opacity: 0,
          depthWrite: false, depthFunc: THREE.GreaterDepth, side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = 10;
        scene.add(mesh);
        this.ghosts.push({ m, mesh, at: new THREE.Vector3(x + 0.5, base, z) });
      }
    }
  }

  /** Fade each door in as the player (feet position) nears it. */
  update(world: World, feet: THREE.Vector3) {
    for (const g of this.ghosts) {
      const d = Math.hypot(g.at.x - feet.x, g.at.z - feet.z);
      const k = Math.min(1, Math.max(0, (FAR - d) / (FAR - NEAR)));
      g.mesh.visible = k > 0 && world.inArea(g.m);
      g.mesh.material.opacity = OPACITY * k;
    }
  }
}
