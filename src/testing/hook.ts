// Test hook: window.pokered drives the game from a script (the play-through
// tests use it, with animation frames switched off so only the hook advances
// the game).

import type { Game } from '../game';
import type { Dir } from '../data/types';

// Yield to the page between test frames (a message-channel task: background tabs don't slow it down),
// so scripts waiting on a frame get to continue, as they do between real animation frames.
const yieldTask = () => new Promise<void>((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });

export function installHook(game: Game) {
  const runFrames = async (seconds: number) => { for (let t = 0; t < seconds; t += 1 / 30) { game.frame(1 / 30); await yieldTask(); } };
  const { input, world, player } = game;
  const hook = {
    /** Hold a direction for some seconds of game time, then report where the player is. */
    async walk(dir: Dir, seconds: number) {
      input.held.add(dir);
      await runFrames(seconds);
      input.held.delete(dir);
      await runFrames(0.6); // finish the step
      await new Promise((r) => setTimeout(r, 450)); // let a warp's fade finish
      await runFrames(0.6);
      return hook.where();
    },
    music: game.music,
    story: game.story,
    /** Everyone in the current area: id, cell, facing, whether shown. */
    people() {
      return game.areaActors().map((p) => `${p.id ?? p.gfx}@${p.x - p.m.ox},${p.y - p.m.oy}${p.from ? '(moving)' : ''} ${p.facing}${p.removed ? ' removed' : ''}${p.invisible ? ' invisible' : ''}`);
    },
    get scriptDepth() { return game.vm.depth; },
    get lastCommand() { return game.vm.lastCommand; },
    /** Warp straight to a cell on a map (by folder name), running its map scripts. */
    async go(name: string, x: number, y: number) {
      const m = world.mapByName(name);
      if (!m) throw new Error(`${name} isn't in this bake`);
      await game.warpTo(m, x, y);
      await hook.tick(0.3);
      return hook.where();
    },
    /** Start an event script by name, as if talking to no one in particular. */
    run(label: string) { game.vm.run(label, null); return hook.tick(0.1); },
    /** Press A (or B) once, then let some game time pass. */
    async press(button: 'a' | 'b' = 'a', seconds = 0.5) {
      input.buttons[`${button}Pressed`] = true;
      await hook.tick(seconds);
      return hook.text();
    },
    async tick(seconds: number) { await runFrames(seconds); },
    /** What the text box shows right now ('' when closed). */
    text() { return game.textbox.shown; },
    where() {
      const c = world.locate(player.x, player.y);
      return `${c ? c.m.data.name : '?'} ${c ? `${c.x},${c.y}` : ''} facing ${player.facing}`;
    },
  };
  (window as unknown as { pokered: typeof hook }).pokered = hook;
  return hook;
}
