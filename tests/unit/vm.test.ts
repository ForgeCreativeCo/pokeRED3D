import { describe, expect, it } from 'vitest';
import { ScriptVM, type ScriptHost } from '../../src/scripts/vm';
import { Story } from '../../src/scripts/story';
import { Clock } from '../../src/core/clock';
import { Input } from '../../src/input/input';
import { World } from '../../src/world/world';
import { makeActor } from '../../src/characters/actor';
import type { Command, PokemonFile, ScriptsFile } from '../../src/data/types';
import type { TextBox } from '../../src/ui/textbox';
import type { Emote } from '../../src/ui/emote';
import { makeMap } from './fixtures';

/** A VM over made-up scripts, with the text box and music recorded instead of shown. */
function setup(scripts: Record<string, Command[]>, more: Partial<ScriptsFile> = {}, mapData = {}) {
  const map = makeMap('Town', ['.....', '.....', '.....'], { data: mapData });
  const world = new World([map]);
  const said: string[] = [];
  const played: (string | null | undefined)[] = [];
  const textbox = {
    say: async (t: string, o: { color?: string } = {}) => { said.push(`${o.color ?? 'neutral'}: ${t}`); },
    yesNo: async () => 1,
    close() {}, hideChoice() {},
  } as unknown as TextBox;
  const pics: string[] = [];
  const pokemon = {
    species: { SPECIES_BULBASAUR: { name: 'BULBASAUR', base: { hp: 45, atk: 49, def: 49, spe: 45, spa: 65, spd: 65 }, types: ['TYPE_GRASS'], abilities: ['ABILITY_OVERGROW'], growth: 'GROWTH_MEDIUM_SLOW', genderRatio: 31, catchRate: 45, expYield: 64, friendship: 70, learnset: [[1, 'MOVE_TACKLE']] } },
    moves: { MOVE_TACKLE: { name: 'TACKLE', type: 'TYPE_NORMAL', power: 35, accuracy: 95, pp: 35, effect: 'EFFECT_HIT', effectChance: 0, target: 'MOVE_TARGET_SELECTED', priority: 0, contact: true } },
    natures: Array.from({ length: 25 }, () => ({ name: 'HARDY', mods: [0, 0, 0, 0, 0] })), abilities: {}, pics: {},
  } as unknown as PokemonFile;
  const player = makeActor({ gfx: 'PLAYER', x: 2, y: 2 }, map);
  const npcs = map.data.objects.map((o) => makeActor(o, map));
  const host: ScriptHost = {
    clock: new Clock(), input: new Input(), story: new Story(more.startFlags ?? []), world, textbox,
    emote: { show: async () => {} } as unknown as Emote,
    music: { play: (n) => { played.push(n); } },
    player, npcs, areaActors: () => [player, ...npcs],
    warpTo: async () => {},
    pokemon,
    monPic: { show: (s) => { pics.push(s); }, hide: () => { pics.push('hidden'); } },
  };
  const data: ScriptsFile = { scripts, text: {}, consts: {}, textColors: {}, startFlags: [], ...more };
  return { vm: new ScriptVM(data, host), host, said, played, pics, map, player, npcs };
}

/** Run frames until the VM is idle, finishing any step as soon as it starts. */
async function settle({ vm, host }: ReturnType<typeof setup>) {
  for (let i = 0; i < 1000 && vm.running; i++) {
    for (const a of host.areaActors()) a.from = null;
    host.clock.tick(1 / 60);
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe('ScriptVM', () => {
  it('runs variables, conditions, call and return', async () => {
    const t = setup({
      Main: [['setvar', 'VAR_X', '3'], ['call_if_eq', 'VAR_X', '3', 'Add'], ['msgbox', 'Text_Done'], ['end']],
      Add: [['addvar', 'VAR_X', '1'], ['return']],
    }, { text: { Text_Done: 'Done!' } });
    await t.vm.run('Main', null);
    expect(t.host.story.vars.VAR_X).toBe(4);
    expect(t.said).toEqual(['neutral: Done!']);
    expect(t.vm.running).toBe(false);
  });

  it('follows constants and branches on flags', async () => {
    const t = setup({
      Main: [['setflag', 'FLAG_ALIAS'], ['goto_if_set', 'FLAG_REAL', 'Yes'], ['msgbox', 'Text_No']],
      Yes: [['msgbox', 'Text_Yes']],
    }, { consts: { FLAG_ALIAS: 'FLAG_REAL' }, text: { Text_Yes: 'yes', Text_No: 'no' } });
    await t.vm.run('Main', null);
    expect(t.host.story.flags.has('FLAG_REAL')).toBe(true);
    expect(t.said).toEqual(['neutral: yes']);
  });

  it('switches on a value', async () => {
    const t = setup({
      Main: [['setvar', 'VAR_PICK', '2'], ['switch', 'VAR_PICK'], ['case', '1', 'One'], ['case', '2', 'Two'], ['end']],
      One: [['msgbox', 'T1']], Two: [['msgbox', 'T2']],
    }, { text: { T1: 'one', T2: 'two' } });
    await t.vm.run('Main', null);
    expect(t.said).toEqual(['neutral: two']);
  });

  it("speaks in the person's text colour and turns them toward the player", async () => {
    const t = setup(
      { Talk: [['msgbox', 'Hi', 'MSGBOX_NPC']] },
      { text: { Hi: 'Hello!' }, textColors: { LADY: 'NPC_TEXT_COLOR_FEMALE' }, consts: { NPC_TEXT_COLOR_FEMALE: '1' } },
      { objects: [{ id: 'LOCALID_LADY', gfx: 'LADY', x: 2, y: 0, elevation: 3, movement: '', facing: 'up', range: [0, 0], script: 'Talk', flag: null }] },
    );
    const lady = t.npcs[0];
    await t.vm.run('Talk', lady);
    expect(t.said).toEqual(['female: Hello!']);
    expect(lady.facing).toBe('down');
  });

  it('removes a person by setting their flag, and a map load keeps them hidden', async () => {
    const t = setup(
      { Main: [['removeobject', 'LOCALID_OAK']] },
      {},
      { objects: [{ id: 'LOCALID_OAK', gfx: 'OAK', x: 1, y: 1, elevation: 3, movement: '', facing: 'down', range: [0, 0], script: null, flag: 'FLAG_HIDE_OAK' }] },
    );
    await t.vm.run('Main', null);
    expect(t.npcs[0].removed).toBe(true);
    expect(t.host.story.flags.has('FLAG_HIDE_OAK')).toBe(true);
    t.npcs[0].removed = false;
    t.vm.enterMap(t.map, false);
    expect(t.npcs[0].removed).toBe(true);
  });

  it('walks people along a movement script', async () => {
    const t = setup(
      {
        Main: [['applymovement', 'LOCALID_PLAYER', 'Walk'], ['waitmovement', '0'], ['end']],
        Walk: [['walk_up'], ['walk_up'], ['walk_right'], ['step_end']],
      },
    );
    const run = t.vm.run('Main', null);
    await settle(t);
    await run;
    expect(t.player).toMatchObject({ x: 3, y: 0, facing: 'right' });
  });

  it('on a map load clears temporary state, runs its transition script and starts its music', async () => {
    const t = setup({
      Town_MapScripts: [['map_script', 'MAP_SCRIPT_ON_TRANSITION', 'Town_OnTransition']],
      Town_OnTransition: [['setvar', 'VAR_TOWN_LOADED', '1']],
    });
    t.host.story.vars.VAR_TEMP_1 = 5;
    t.host.story.flags.add('FLAG_TEMP_2');
    t.vm.enterMap(t.map, false);
    await settle(t);
    expect(t.host.story.vars).toEqual({ VAR_TOWN_LOADED: 1 });
    expect(t.host.story.flags.has('FLAG_TEMP_2')).toBe(false);
    expect(t.played).toEqual(['MUS_TEST']);
  });

  it("picks the map's frame script whose variable holds", () => {
    const t = setup({
      Town_MapScripts: [['map_script', 'MAP_SCRIPT_ON_FRAME_TABLE', 'Town_FrameTable']],
      Town_FrameTable: [['map_script_2', 'VAR_SCENE', '0', 'Scene0'], ['map_script_2', 'VAR_SCENE', '1', 'Scene1']],
    });
    t.vm.enterMap(t.map, false);
    expect(t.vm.frameScript()).toBe('Scene0');
    t.host.story.vars.VAR_SCENE = 1;
    expect(t.vm.frameScript()).toBe('Scene1');
    t.host.story.vars.VAR_SCENE = 2;
    expect(t.vm.frameScript()).toBeUndefined();
  });

  it('fires a step-on trigger only while its variable holds', () => {
    const t = setup({}, {}, { triggers: [{ x: 1, y: 1, var: 'VAR_SCENE', value: '0', script: 'Stop' }] });
    expect(t.vm.triggerAt(1, 1)?.script).toBe('Stop');
    t.host.story.vars.VAR_SCENE = 1;
    expect(t.vm.triggerAt(1, 1)).toBeUndefined();
  });

  it('gives a real Pokémon with givemon, from a variable holding the species', async () => {
    const t = setup({ Main: [
      ['setvar', 'VAR_TEMP_2', 'SPECIES_BULBASAUR'],
      ['showmonpic', 'VAR_TEMP_2', '10', '3'],
      ['givemon', 'VAR_TEMP_2', '5'],
      ['bufferspeciesname', 'STR_VAR_1', 'VAR_TEMP_2'],
    ] });
    await t.vm.run('Main', null);
    const [mon] = t.host.story.party;
    expect(t.host.story.party).toHaveLength(1);
    expect(mon.species).toBe('SPECIES_BULBASAUR');
    expect(mon.level).toBe(5);
    expect(mon.moves.map((m) => m.move)).toEqual(['MOVE_TACKLE']);
    expect(mon.otName).toBe('RED');
    expect(t.host.story.vars.VAR_RESULT).toBe(0);
    expect(t.host.story.names.STR_VAR_1).toBe('BULBASAUR');
    expect(t.pics).toEqual(['SPECIES_BULBASAUR', 'hidden']); // the picture closes when the scene ends
  });

  it('stops giving at six', async () => {
    const t = setup({ Main: Array.from({ length: 7 }, () => ['givemon', 'SPECIES_BULBASAUR', '5'] as Command) });
    await t.vm.run('Main', null);
    expect(t.host.story.party).toHaveLength(6);
    expect(t.host.story.vars.VAR_RESULT).toBe(2);
  });

  it('fills name buffers for the next text', async () => {
    const t = setup({ Main: [['bufferspeciesname', 'STR_VAR_1', 'SPECIES_MR_MIME']] });
    await t.vm.run('Main', null);
    expect(t.host.story.names.STR_VAR_1).toBe('MR MIME');
  });
});
