// pokeRED3D: FireRed as a tilted top-down 2.5D game.
//
// Scaffold for the restructure: loads the baked data and draws the area a new
// game starts in. The game itself (world, characters, scripts, UI, audio,
// input) moves over from tools/baker/debug/view3d.html module by module.

import * as THREE from 'three';
import { loadGame } from './data/load';
import { buildMapMeshes } from './render/mapMesh';

const SKY = '#9fd3e8';

async function main() {
  const game = await loadGame();
  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#8a9a7a', 1.6));
  const sun = new THREE.DirectionalLight('#fff4e0', 1.6);
  sun.position.set(-6, 14, 8);
  scene.add(sun);

  const start = game.world.start;
  const home = game.maps.find((m) => m.data.name === start?.map) ?? game.maps[0];
  const areaMaps = game.maps.filter((m) => m.area === home.area);
  for (const m of areaMaps) {
    const meshes = buildMapMeshes(m);
    scene.add(meshes.opaque, meshes.cutout);
  }
  scene.background = new THREE.Color(areaMaps.some((m) => m.data.indoor) ? '#000000' : SKY);
  document.getElementById('title')!.textContent = home.data.name.replace(/_/g, ' ').replace(/([a-z])([A-Z0-9])/g, '$1 $2');

  // The follow camera, aimed at the start cell.
  const { pitch, fov, view } = home.data.camera;
  const cam = new THREE.PerspectiveCamera(fov, 1, 0.1, 500);
  const sx = (start?.x ?? home.data.width >> 1) + home.ox, sy = (start?.y ?? home.data.height >> 1) + home.oy;
  const h = home.data.grid.height[(sy - home.oy) * home.data.width + (sx - home.ox)] ?? 0;
  const target = new THREE.Vector3(sx + 0.5, h + 0.5, sy + 0.5);
  const d = view / 2 / Math.tan((fov * Math.PI) / 360);
  const p = (pitch * Math.PI) / 180;
  cam.position.set(target.x, target.y + d * Math.sin(p), target.z + d * Math.cos(p));
  cam.lookAt(target);

  const resize = () => {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    cam.aspect = canvas.clientWidth / canvas.clientHeight;
    cam.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();
  renderer.setAnimationLoop(() => renderer.render(scene, cam));
}

main().catch((e: unknown) => {
  const box = document.createElement('div');
  box.id = 'error';
  box.textContent = `The game couldn't start: ${e instanceof Error ? e.message : String(e)}`;
  document.body.append(box);
  throw e;
});
