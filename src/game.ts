// The game: everything wired together, and the frame that advances it.

import * as THREE from 'three';
import type { GameData, LoadedMap } from './data/load';
import type { Billboards, Dir, Warp } from './data/types';
import { Clock } from './core/clock';
import { Input } from './input/input';
import { World } from './world/world';
import { arrowDir, isDoor, isStairs, jumpBehavior } from './world/behaviors';
import { actorPos, makeActor, opposite, steps, type Actor } from './characters/actor';
import { ActorViews } from './characters/actorView';
import { updateNpc } from './characters/npc';
import { Story } from './scripts/story';
import { ScriptVM, type ScriptHost } from './scripts/vm';
import { Music } from './audio/music';
import { Stage } from './render/stage';
import { CameraRig } from './render/camera';
import { GbaView } from './render/gbaView';
import { TextBox } from './ui/textbox';
import { Emote } from './ui/emote';
import { Panel, pretty } from './ui/panel';

/** In compare mode both panes are GBA-shaped (3:2) and show the same 10 rows. */
const GBA_ROWS = 10;

export class Game implements ScriptHost {
  readonly clock = new Clock();
  readonly input = new Input();
  readonly world: World;
  readonly stage: Stage;
  readonly views: ActorViews;
  readonly home: LoadedMap;
  readonly player: Actor;
  readonly npcs: Actor[];
  readonly actors: Actor[];
  readonly gba: GbaView;
  readonly music: Music;
  readonly story: Story;
  readonly textbox: TextBox;
  readonly emote: Emote;
  readonly vm: ScriptVM;
  readonly rig: CameraRig;
  readonly panel: Panel;
  /** a warp's fade is running */
  warping = false;
  comparing = false;
  private readonly bb: Billboards;
  private readonly canvas: HTMLCanvasElement;
  /** the step off a door or the stairs after arriving */
  private pendingStep: Dir | Dir[] | null = null;
  /** the player's cell and facing at the last readout */
  private lastCell = '';

  constructor(data: GameData, private doc: Document) {
    const $ = (id: string) => doc.getElementById(id)!;
    this.canvas = $('stage') as HTMLCanvasElement;
    this.world = new World(data.maps);
    this.stage = new Stage(this.canvas, data.maps);
    this.bb = data.maps[0].data.billboards;
    this.views = new ActorViews(this.stage.scene, this.bb, (m) => this.stage.spriteMaterial(m));

    // Start where a new game does (Red's bedroom) when that map is in the bake;
    // otherwise outside the first map's first door.
    const START = data.world.start;
    const home = (this.home = (START && this.world.mapByName(START.map)) || data.maps[0]);
    const D = home.data;
    const start = START && D.name === START.map ? { x: START.x + home.ox, y: START.y + home.oy }
      : D.warps[0] ? { x: D.warps[0].x + home.ox, y: D.warps[0].y + 1 + home.oy } : { x: home.ox + (D.width >> 1), y: home.oy + (D.height >> 1) };
    this.world.area = home.area;
    const spawn = (a: Actor) => { this.views.add(a); return a; };
    this.player = spawn(makeActor({ gfx: this.bb.player, x: start.x, y: start.y, facing: START?.facing ?? 'down' }, home));
    this.npcs = data.maps.flatMap((m) => m.data.objects.map((o) => spawn(makeActor({ ...o, x: o.x + m.ox, y: o.y + m.oy }, m))));
    this.actors = [this.player, ...this.npcs];

    this.gba = new GbaView($('gba') as HTMLCanvasElement);
    this.music = new Music(data.music);
    this.story = new Story(data.scripts.startFlags);
    this.textbox = new TextBox(this.clock, this.input, this.story, doc);
    this.emote = new Emote(this.clock, doc);
    this.vm = new ScriptVM(data.scripts, this);
    this.rig = new CameraRig(data.maps, D.camera.preset, this.canvas);
    this.panel = new Panel(doc, this.rig, {
      lit: (lit) => this.stage.setLit(lit),
      orbit: (on) => {
        this.rig.orbit.enabled = on;
        if (on) { this.rig.orbit.target.copy(this.views.position(this.player)); this.rig.orbit.update(); }
      },
    });
    const quads = data.maps.reduce((n, m) => n + m.data.quads.length, 0);
    const people = data.maps.reduce((n, m) => n + m.data.objects.filter((o) => !o.hidden).length, 0);
    this.panel.setFoot(`${data.maps.map((m) => pretty(m.data.name)).join(', ')} · ${quads} quads · ${people} people. Click the map, then walk with WASD or the arrow keys.`);

    this.input.attach(doc);
    // Browsers only allow sound after the viewer interacts, so start on the first key or tap.
    for (const ev of ['keydown', 'pointerdown']) addEventListener(ev, () => this.music.start(), { once: true });
    const musicBtn = $('musicBtn');
    musicBtn.onclick = () => {
      this.music.start();
      this.music.setMuted(!this.music.muted);
      musicBtn.textContent = this.music.muted ? 'Music off' : 'Music on';
      musicBtn.setAttribute('aria-pressed', String(!this.music.muted));
    };
    $('compareBtn').onclick = () => this.setCompare(!this.comparing);
    this.canvas.addEventListener('pointerdown', () => this.canvas.focus());
    addEventListener('resize', () => this.resize());

    this.applyAreaLook();
    this.resize();
    // Compare mode: the original GBA view beside the 2.5D one. #compare in the link opens it.
    this.setCompare(location.hash === '#compare');
  }

  /** Run the game on animation frames. */
  start() {
    let last = performance.now();
    this.stage.renderer.setAnimationLoop((now) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      this.frame(dt);
    });
  }

  // ---- the world and who's in it ----

  areaActors() {
    return this.actors.filter((a) => a === this.player || a.area === this.world.area);
  }

  private occupied(x: number, y: number, self: Actor) {
    return this.areaActors().some((a) => a !== self && !a.removed && ((a.x === x && a.y === y) || (a.from && a.from.x === x && a.from.y === y)));
  }

  private canEnter(x: number, y: number, self: Actor) {
    return this.world.walkable(x, y) && !this.occupied(x, y, self);
  }

  private heightAt = (x: number, y: number) => this.world.heightAt(x, y);

  // ---- warps ----
  // Like FireRed: walking into a door, pressing the arrow's direction on an exit
  // mat, or stepping onto stairs warps; other cells listed as warps are inert.

  private warp(w: Warp) {
    const dest = this.world.mapByName(w.to)!, target = dest.data.warps[w.toWarp];
    if (target) this.warpTo(dest, target.x, target.y, target.behavior);
  }

  /** Fade out, move the player to (x, y) on dest, run its map scripts, fade in. */
  warpTo(dest: LoadedMap, x: number, y: number, arriveBehavior: string | null = null): Promise<void> {
    const fade = this.doc.getElementById('fade')!;
    this.warping = true;
    this.input.clearHeld();
    fade.classList.add('on');
    return new Promise((done) => setTimeout(() => {
      this.world.area = dest.area;
      Object.assign(this.player, { x: x + dest.ox, y: y + dest.oy, from: null, t: 1, jump: false, invisible: false });
      this.vm.enterMap(dest, true);
      this.applyAreaLook();
      // Out through a door: step off it. Down stairs or up: step off the stairs.
      // Onto an exit mat: face back into the room.
      if (isDoor(arriveBehavior) || isStairs(arriveBehavior)) this.pendingStep = isDoor(arriveBehavior) ? 'down' : ['down', 'left', 'right', 'up'];
      else if (arriveBehavior && arrowDir[arriveBehavior]) this.player.facing = opposite[arrowDir[arriveBehavior]];
      this.lastCell = '';
      fade.classList.remove('on');
      setTimeout(() => { this.warping = false; done(); }, 200);
    }, 220));
  }

  // ---- moving ----

  /** Turn and step (or hop a ledge, or take a warp); false if blocked. */
  private startStep = (a: Actor, dir: Dir): boolean => {
    const [dx, dy] = steps[dir];
    const { world } = this;
    a.facing = dir;
    if (a === this.player) {
      // Into a door, or off an exit mat in its arrow's direction.
      const ahead = world.warpAt(a.x + dx, a.y + dy), here = world.warpAt(a.x, a.y);
      if (ahead && isDoor(ahead.behavior)) { this.warp(ahead); return true; }
      if (here && arrowDir[here.behavior] === dir) { this.warp(here); return true; }
    }
    let to: { x: number; y: number; jump: boolean } | null = null;
    // A ledge facing this way: hop over it to the cell beyond.
    if (world.behaviorAt(a.x + dx, a.y + dy) === jumpBehavior[dir] && this.canEnter(a.x + 2 * dx, a.y + 2 * dy, a)) to = { x: a.x + 2 * dx, y: a.y + 2 * dy, jump: true };
    else if (this.canEnter(a.x + dx, a.y + dy, a)) to = { x: a.x + dx, y: a.y + dy, jump: false };
    if (!to) return false;
    a.from = { x: a.x, y: a.y };
    a.x = to.x; a.y = to.y; a.t = 0; a.jump = to.jump;
    a.parity ^= 1; // alternate feet each step
    return true;
  };

  /** Like FireRed: tapping a new direction turns on the spot; holding it walks. */
  private playerInput(dt: number) {
    const { player } = this, dir = this.input.direction;
    if (!dir) { player.turnHold = 0; return; }
    if (dir !== player.facing && player.turnHold <= 0) { player.facing = dir; player.turnHold = 0.12; return; }
    player.turnHold -= dt;
    if (player.turnHold <= 0) this.startStep(player, dir);
  }

  /** What's in front of the player: a person (also across a counter), or a sign. */
  private interact() {
    const { player, world } = this;
    const [dx, dy] = steps[player.facing];
    const fx = player.x + dx, fy = player.y + dy;
    const personAt = (x: number, y: number) => this.npcs.find((a) => a.area === world.area && !a.removed && !a.from && a.x === x && a.y === y && a.script);
    let target = personAt(fx, fy);
    if (!target && world.behaviorAt(fx, fy) === 'MB_COUNTER') target = personAt(fx + dx, fy + dy);
    if (target) return this.vm.run(target.script!, target);
    const c = world.locate(fx, fy);
    const sign = c && c.m.data.signs.find((s) => s.x === c.x && s.y === c.y && s.type === 'sign' && s.script);
    if (sign) return this.vm.run(sign.script!, null);
  }

  /** On a new cell: update the readout, and run map scripts on walking into another map. */
  private trackCell() {
    const { player } = this;
    const c = this.world.locate(player.x, player.y);
    const key = `${player.x},${player.y},${player.facing}`;
    if (!c || key === this.lastCell) return;
    this.lastCell = key;
    this.panel.setTitle(c.m.data.name);
    if (c.m !== this.vm.currentMap) this.vm.enterMap(c.m, false); // walked across a map edge (or the first frame)
    this.panel.readout(c, player.facing);
  }

  // ---- the view ----

  /** Only the current area is drawn; interiors sit in black and use their camera. */
  private applyAreaLook() {
    this.stage.showArea(this.world);
    if (this.rig.usePreset(this.world.areaMaps()[0].data.camera.preset)) this.panel.syncSliders();
    this.panel.setLegend(this.rig.preset);
  }

  private setCompare(on: boolean) {
    const btn = this.doc.getElementById('compareBtn')!;
    this.comparing = on;
    this.doc.body.classList.toggle('compare', on);
    this.gba.canvas.hidden = !on;
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? 'Hide FireRed view' : 'Compare with FireRed';
    if (on) this.panel.fold();
    this.resize();
  }

  private resize() {
    const { canvas } = this;
    if (this.comparing) {
      // GBA screen left (or top when the window is portrait), 2.5D right (or bottom).
      const portrait = innerWidth <= innerHeight;
      const pane = portrait ? { x: 0, y: innerHeight / 2, w: innerWidth, h: innerHeight / 2 } : { x: innerWidth / 2, y: 0, w: innerWidth / 2, h: innerHeight };
      const fw = Math.min(pane.w, pane.h * 1.5), fh = fw / 1.5;
      Object.assign(canvas.style, { left: `${pane.x + (pane.w - fw) / 2}px`, top: `${pane.y + (pane.h - fh) / 2}px`, width: `${fw}px`, height: `${fh}px` });
    } else {
      for (const k of ['left', 'top', 'width', 'height'] as const) canvas.style[k] = '';
    }
    const w = canvas.clientWidth, h = canvas.clientHeight;
    this.stage.renderer.setSize(w, h, false);
    this.rig.cam.aspect = w / h;
    this.rig.cam.updateProjectionMatrix();
  }

  /** Page coordinates just above someone's head, for the emote bubble. */
  private overHead = (a: Actor) => {
    const v = this.views.position(a).clone().add(new THREE.Vector3(0, 2.1, 0)).project(this.rig.cam);
    const r = this.canvas.getBoundingClientRect();
    return { left: r.left + ((v.x + 1) / 2) * r.width, top: r.top + ((1 - v.y) / 2) * r.height };
  };

  // ---- the frame ----

  frame(dt: number) {
    const { player, vm, input, world } = this;
    this.clock.tick(dt);
    for (const a of this.areaActors()) {
      if (!a.from) continue;
      a.t += dt / (this.bb.stepSeconds * (a.jump ? 2 : 1));
      if (a.t >= 1) {
        a.from = null; a.t = 1; a.jump = false;
        if (a === player && !vm.running) {
          // Stepping onto stairs takes them; stepping onto a trigger starts its scene.
          const w = world.warpAt(a.x, a.y);
          if (w && isStairs(w.behavior)) this.warp(w);
          else { const t = vm.triggerAt(a.x, a.y); if (t) vm.run(t.script, null); }
        }
      }
    }
    const sceneScript = !vm.running && !this.warping && !player.from && vm.frameScript();
    if (sceneScript) vm.run(sceneScript, null);
    if (vm.running) { /* the script moves people; nobody wanders */ }
    else if (!player.from && !this.warping && input.buttons.aPressed) { input.buttons.aPressed = input.buttons.bPressed = false; this.interact(); }
    else if (input.buttons.bPressed) input.buttons.bPressed = false;
    else if (!player.from && !this.warping) {
      if (this.pendingStep) {
        const dirs = ([] as Dir[]).concat(this.pendingStep);
        this.pendingStep = null;
        const dir = dirs.find((d) => this.canEnter(player.x + steps[d][0], player.y + steps[d][1], player));
        if (dir) this.startStep(player, dir);
      } else this.playerInput(dt);
    }
    if (!vm.running) for (const a of this.npcs) if (a.area === world.area && !a.removed) updateNpc(a, dt, (x, y) => world.behaviorAt(x, y), this.startStep);
    const camPos = this.rig.cam.position;
    for (const a of this.areaActors()) this.views.place(a, actorPos(a, this.heightAt), camPos, this.rig.settings.pitch);
    this.views.syncVisibility(this.actors, player, world.area);
    this.trackCell();
    if (this.rig.orbit.enabled) this.rig.orbit.update();
    else this.rig.follow(this.views.position(player), this.comparing ? GBA_ROWS : undefined);
    this.stage.render(this.rig.cam);
    if (this.comparing) this.gba.draw(world, player, this.areaActors(), this.home);
    this.emote.place(this.overHead);
  }
}
