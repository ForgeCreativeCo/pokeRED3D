// People drawn as camera-facing sprite billboards with a blob shadow, sized
// to cover the same screen area as in FireRed.

import * as THREE from 'three';
import type { Billboards } from '../data/types';
import type { LoadedMap } from '../data/load';
import { actorFrame, type Actor } from './actor';

interface View {
  root: THREE.Group;
  /** leans the sprite back; lifted during a ledge hop (the shadow stays down) */
  tilt: THREE.Group;
  sprite: THREE.Mesh<THREE.PlaneGeometry> | null;
  /** a faint copy drawn only where something stands in front of the sprite */
  ghost?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
}

export class ActorViews {
  private views = new Map<Actor, View>();
  private shadowMat: THREE.Material;

  constructor(private scene: THREE.Scene, private bb: Billboards, private spriteMat: (m: LoadedMap) => THREE.Material) {
    this.shadowMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  }

  add(a: Actor) {
    const root = new THREE.Group();
    const tilt = new THREE.Group();
    root.add(tilt);
    let sprite: View['sprite'] = null;
    if (a.s) {
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.translate(0, 0.5, 0); // pivot at the feet
      sprite = new THREE.Mesh(geo, this.spriteMat(a.m));
      tilt.add(sprite);
      const sh = new THREE.Mesh(new THREE.CircleGeometry(a.s.shadow, 20), this.shadowMat);
      sh.rotation.x = -Math.PI / 2;
      sh.scale.y = 0.55;
      sh.position.y = 0.02;
      root.add(sh);
    } else {
      // No sprite in the decomp for this one: a plain marker keeps it visible.
      const mk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 1, 12), new THREE.MeshLambertMaterial({ color: '#6d7a8c' }));
      mk.position.y = 0.5;
      tilt.add(mk);
    }
    this.scene.add(root);
    this.views.set(a, { root, tilt, sprite });
  }

  /** Show the actor through whatever hides it (a building between it and the low camera) as a faint silhouette. */
  silhouette(a: Actor) {
    const v = this.views.get(a)!;
    if (!v.sprite) return;
    const mat = new THREE.MeshBasicMaterial({
      color: '#1d2a4a', alphaTest: 0.5, transparent: true, opacity: 0.55,
      depthWrite: false, depthFunc: THREE.GreaterDepth,
    });
    // Shares the sprite's geometry (so its frames) and sits at its transform.
    v.ghost = new THREE.Mesh(v.sprite.geometry, mat);
    v.ghost.renderOrder = 10;
    v.sprite.add(v.ghost);
  }

  /** Where the actor's feet are drawn. */
  position(a: Actor): THREE.Vector3 {
    return this.views.get(a)!.root.position;
  }

  /** Who is drawn: the current area's people unless removed or set invisible. */
  syncVisibility(actors: Actor[], player: Actor, area: number) {
    for (const a of actors) this.views.get(a)!.root.visible = !a.invisible && (a === player || (a.area === area && !a.removed));
  }

  /** pos: from actorPos(). Faces the camera and picks the sprite frame. */
  place(a: Actor, pos: { x: number; y: number; h: number; lift: number }, camPos: THREE.Vector3, pitchDeg: number) {
    const v = this.views.get(a)!;
    const x = pos.x + 0.5, z = pos.y + 0.5;
    const yaw = Math.atan2(camPos.x - x, camPos.z - z);
    const off = this.bb.feetOffset ?? 0;
    v.root.position.set(x + Math.sin(yaw) * off, pos.h, z + Math.cos(yaw) * off);
    v.root.rotation.y = yaw;
    v.tilt.position.y = pos.lift; // the shadow stays on the ground
    if (!v.sprite || !a.s) return;
    v.tilt.rotation.x = (-this.bb.lean * Math.PI) / 180;
    const [sx, sy] = this.spriteScale(a, pitchDeg);
    v.sprite.scale.set(sx, sy, 1);
    this.setFrame(a, v.sprite, actorFrame(a), a.facing === 'right');
    if (v.ghost) v.ghost.material.map = (v.sprite.material as THREE.MeshBasicMaterial).map;
  }

  /** Size so a sprite covers the same screen area as in FireRed, relative to ground tiles. */
  private spriteScale(a: Actor, pitchDeg: number): [number, number] {
    const rows = a.s!.height / 16, cols = a.s!.width / 16;
    const p = (pitchDeg * Math.PI) / 180, lean = (this.bb.lean * Math.PI) / 180;
    const len = this.bb.matchScreenSize ? (rows * Math.sin(p)) / Math.cos(p - lean) : rows;
    return [cols, len];
  }

  private setFrame(a: Actor, sprite: THREE.Mesh<THREE.PlaneGeometry>, frame: number, mirror: boolean) {
    const [u0, v0, u1, v1] = a.s!.frames[frame] ?? a.s!.frames[0];
    const uv = sprite.geometry.attributes.uv as THREE.BufferAttribute;
    const [l, r] = mirror ? [u1, u0] : [u0, u1];
    const AW = a.m.atlas.width, AH = a.m.atlas.height;
    // PlaneGeometry vertex order: top-left, top-right, bottom-left, bottom-right.
    uv.setXY(0, l / AW, v0 / AH); uv.setXY(1, r / AW, v0 / AH);
    uv.setXY(2, l / AW, v1 / AH); uv.setXY(3, r / AW, v1 / AH);
    uv.needsUpdate = true;
  }
}
