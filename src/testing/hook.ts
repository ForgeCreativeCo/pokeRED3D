// Test hook: window.pokered drives the game from a script (the play-through
// tests use it, with animation frames switched off so only the hook advances
// the game).

import type { Game } from '../game';
import type { Dir } from '../data/types';
import { createMon, displayName } from '../pokemon/mon';
import { monRandom } from '../core/random';

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
    /** Press A, B, START or a direction once (directions as a menu press), then let some game time pass. */
    async press(button: 'a' | 'b' | 'start' | Dir = 'a', seconds = 0.5) {
      if (button === 'a' || button === 'b' || button === 'start') input.buttons[`${button}Pressed`] = true;
      else input.pressDir(button);
      await hook.tick(seconds);
      return hook.text();
    },
    async tick(seconds: number) { await runFrames(seconds); },
    /** The party: species, level, HP and moves of each. */
    party() {
      return game.story.party.map((m) => `${displayName(game.pokemon, m)} Lv${m.level} ${m.hp}/${m.stats.hp} [${m.moves.map((x) => game.pokemon.moves[x.move]?.name ?? x.move).join(', ')}]`);
    },
    /** Open the party screen from the start menu, in one go. */
    async openParty() { game.openParty(); await hook.tick(0.1); return hook.menu(); },
    /** Which menu is up: 'closed', 'title CONTINUE', 'start BAG', 'party BULBASAUR', 'bag ITEMS: POTION x1', … */
    menu() { return game.title?.open ? game.title.state : game.startMenu.state; },
    /** The Bag's contents, pocket by pocket. */
    bag() {
      return Object.entries(game.story.bag.pockets).flatMap(([p, stacks]) => stacks.map((s) => `${p} ${game.items[s.item]?.name ?? s.item} x${s.count}`));
    },
    get money() { return game.story.money; },
    /** The Pokémon showmonpic is showing ('' when none). */
    monPic() { return game.monPic.shown; },
    /**
     * Start a battle where the player stands, without waiting for it: a wild
     * Pokémon (`{ wild: 'SPECIES_PIDGEY', level: 3 }`) or a trainer (`{ trainer: 'TRAINER_…' }`).
     */
    async battle(foe: { wild: string; level: number } | { trainer: string }) {
      const f = 'wild' in foe ? { wild: createMon(game.pokemon, foe.wild, foe.level, monRandom, { id: 0, name: '' }) } : foe;
      game.battle(f).then((outcome) => { hook.lastBattle = outcome; });
      await hook.tick(0.1);
      return hook.battleState();
    },
    /** Put items in the Bag. */
    giveItem(item: string, count = 1) {
      game.story.bag.add(item, count);
      return hook.bag();
    },
    /** The PC box: species and level. */
    box() {
      return game.story.box.map((m) => `${displayName(game.pokemon, m)} Lv${m.level}`);
    },
    /** Add a Pokémon to the party, as givemon would. */
    give(species: string, level: number) {
      game.story.party.push(createMon(game.pokemon, species, level, monRandom, { id: game.story.trainerId, name: game.story.names.PLAYER }));
      game.story.register(species, true);
      return hook.party();
    },
    /** How the last battle ended: 'won', 'lost' or 'ran' (null before any). */
    lastBattle: null as string | null,
    /** The battle on screen: its menu or text, and both Pokémon's HP ('closed' when there's none). */
    battleState() {
      const s = game.battleScreen;
      return s.open ? `${s.state} | ${s.hp}` : 'closed';
    },
    /** The battle without its text (which play-throughs keep only as a hash): the menu and cursor, and both HPs. */
    battleSummary() {
      const s = game.battleScreen;
      return s.open ? `${s.state.startsWith('battle text') ? 'battle text' : s.state} | ${s.hp}` : 'closed';
    },
    /** What the battle's message window shows ('' when no battle). */
    battleText() { return game.battleScreen.open ? game.battleScreen.text : ''; },
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
