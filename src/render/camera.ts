// The follow camera. Each camera preset (default outdoors, interior indoors)
// keeps its own tuning, adjustable from the panel.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { LoadedMap } from '../data/load';

export interface CameraSettings {
  pitch: number;
  fov: number;
  view: number;
}

export class CameraRig {
  /** the baked values, for Reset */
  readonly baked: Record<string, CameraSettings> = {};
  private tuned: Record<string, CameraSettings>;
  preset: string;
  settings: CameraSettings;
  readonly cam: THREE.PerspectiveCamera;
  readonly orbit: OrbitControls;

  constructor(maps: LoadedMap[], startPreset: string, canvas: HTMLCanvasElement) {
    for (const m of maps) this.baked[m.data.camera.preset] ??= { pitch: m.data.camera.pitch, fov: m.data.camera.fov, view: m.data.camera.view };
    this.tuned = Object.fromEntries(Object.entries(this.baked).map(([k, v]) => [k, { ...v }]));
    this.preset = startPreset;
    this.settings = this.tuned[startPreset];
    this.cam = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.1, 500);
    this.orbit = new OrbitControls(this.cam, canvas);
    this.orbit.enabled = false;
  }

  /** Switch preset; true if it changed. */
  usePreset(p: string) {
    if (p === this.preset) return false;
    this.preset = p;
    this.settings = this.tuned[p];
    return true;
  }

  reset() {
    Object.assign(this.settings, this.baked[this.preset]);
  }

  /** Look at target from the preset's pitch, far enough back to show `rows` tile rows (default: the preset's view). */
  follow(target: THREE.Vector3, rows = this.settings.view) {
    const { cam, settings } = this;
    cam.fov = settings.fov;
    const d = rows / 2 / Math.tan((settings.fov * Math.PI) / 360);
    const p = (settings.pitch * Math.PI) / 180;
    const t = target.clone().add(new THREE.Vector3(0, 0.5, 0));
    cam.position.set(t.x, t.y + d * Math.sin(p), t.z + d * Math.cos(p));
    cam.lookAt(t);
    cam.updateProjectionMatrix();
  }
}
