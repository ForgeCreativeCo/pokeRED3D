// Fading the building in the way. With the camera low behind the player, a
// building a few rows south of Red hides him. Each building is its own mesh
// (the baker tags its quads), and any building between the camera and Red
// dissolves into a screen-door dither, so he shows through it. Dithering
// keeps the pixel look and needs no transparency sorting.

import * as THREE from 'three';
import type { Quad } from '../data/types';

/** How much of a building is dropped at full fade (the rest stays as a ghost of it). */
export const MAX_FADE = 0.7;
/** Fade per second, in and out. */
const SPEED = 5;

/** Quads grouped by building: building index -> its quads. Quads with no building are left out. */
export function groupByBuilding(quads: Quad[]): Map<number, Quad[]> {
  const out = new Map<number, Quad[]>();
  for (const q of quads) {
    if (q.b === undefined) continue;
    if (!out.has(q.b)) out.set(q.b, []);
    out.get(q.b)!.push(q);
  }
  return out;
}

/**
 * Whether a box stands between the eye and any of the targets: the ray from
 * the eye to a target crosses the box before reaching it.
 */
export function blocks(box: THREE.Box3, eye: THREE.Vector3, targets: THREE.Vector3[]): boolean {
  const ray = new THREE.Ray();
  const hit = new THREE.Vector3();
  for (const t of targets) {
    // A target inside the box (under the roof's walk-behind edge) counts too:
    // the ray enters the box before reaching it.
    ray.origin.copy(eye);
    ray.direction.subVectors(t, eye).normalize();
    if (ray.intersectBox(box, hit) && hit.distanceTo(eye) < t.distanceTo(eye)) return true;
  }
  return false;
}

/** Step a fade toward its target (0 solid, 1 faded) by dt seconds. */
export function stepFade(fade: number, target: number, dt: number): number {
  return target > fade ? Math.min(target, fade + SPEED * dt) : Math.max(target, fade - SPEED * dt);
}

/**
 * Teach a material to dither away by `fade.value` (0..1): fragments whose
 * 4x4 Bayer threshold is below fade * MAX_FADE are discarded.
 */
export function addDither(material: THREE.Material, fade: { value: number }) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFade = fade;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `uniform float uFade;
float bayer4(vec2 p) {
  int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0));
  int i = x + y * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + 0.5) / 16.0;
}
void main() {
  if (bayer4(gl_FragCoord.xy) < uFade * ${MAX_FADE.toFixed(2)}) discard;`);
  };
  material.customProgramCacheKey = () => 'dither';
}

export interface FadingBuilding {
  box: THREE.Box3;
  fade: { value: number };
  meshes: THREE.Mesh[];
}

/** Each frame: fade the buildings that stand between the camera and the player (none when not active). */
export function updateFades(buildings: FadingBuilding[], eye: THREE.Vector3, feet: THREE.Vector3, dt: number, active = true) {
  // Red's feet and head (a card about 1.2 tiles tall).
  const targets = [feet.clone().setY(feet.y + 0.3), feet.clone().setY(feet.y + 1.1)];
  for (const b of buildings) {
    if (!b.meshes[0]?.visible) { b.fade.value = 0; continue; }
    b.fade.value = stepFade(b.fade.value, active && blocks(b.box, eye, targets) ? 1 : 0, dt);
  }
}
