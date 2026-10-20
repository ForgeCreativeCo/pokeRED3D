// The three.js renderer and scene: lights and every loaded map's meshes.
// Only the current area is drawn; interiors sit in black.

import * as THREE from 'three';
import type { LoadedMap } from '../data/load';
import type { World } from '../world/world';
import { buildMapMeshes, type MapMeshes } from './mapMesh';
import type { FadingBuilding } from './buildingFade';

const SKY = '#9fd3e8';
const INDOOR = '#000000';

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly meshes = new Map<LoadedMap, MapMeshes>();

  constructor(canvas: HTMLCanvasElement, maps: LoadedMap[]) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(SKY);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#8a9a7a', 1.6));
    const sun = new THREE.DirectionalLight('#fff4e0', 1.6);
    sun.position.set(-6, 14, 8);
    this.scene.add(sun);
    for (const m of maps) {
      const mm = buildMapMeshes(m);
      this.meshes.set(m, mm);
      this.scene.add(mm.opaque, mm.cutout, ...mm.buildings.flatMap((b) => b.meshes));
    }
  }

  spriteMaterial(m: LoadedMap) {
    return this.meshes.get(m)!.sprite;
  }

  /** Lighting on (Lambert) or off (the flat GBA colours). */
  setLit(lit: boolean) {
    const key = lit ? 'lit' : 'flat';
    for (const mm of this.meshes.values()) {
      mm.opaque.material = mm.materials[key][0]; mm.cutout.material = mm.materials[key][1];
      for (const b of mm.buildings) for (const mesh of b.meshes) mesh.material = mesh.userData[key];
    }
  }

  showArea(world: World) {
    for (const [m, mm] of this.meshes) {
      mm.opaque.visible = mm.cutout.visible = world.inArea(m);
      for (const b of mm.buildings) for (const mesh of b.meshes) mesh.visible = world.inArea(m);
    }
    (this.scene.background as THREE.Color).set(world.areaMaps().some((m) => m.data.indoor) ? INDOOR : SKY);
  }

  /** Every building in the loaded maps, for fading the ones that hide the player. */
  get buildings(): FadingBuilding[] {
    return [...this.meshes.values()].flatMap((mm) => mm.buildings);
  }

  render(cam: THREE.Camera) {
    this.renderer.render(this.scene, cam);
  }
}
