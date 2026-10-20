// A small player for the decomp's event scripts (baked into scripts.json),
// and the map scripts that run when a map loads and every frame.
//
// The common commands run; ones the game can't do yet (battles, the bag,
// fanfares, menus) are skipped so their scenes play their lines and go on.
// givemon creates a real Pokémon in the party; showmonpic shows its picture;
// item commands fill and check the Bag. setrespawn marks the heal point
// whiting out returns to.

import type { Clock } from '../core/clock';
import type { Input } from '../input/input';
import type { World } from '../world/world';
import type { LoadedMap } from '../data/load';
import type { Command, Dir, ItemData, PokemonFile, ScriptsFile } from '../data/types';
import type { TextBox, BoxStyle, TextColor } from '../ui/textbox';
import type { Emote } from '../ui/emote';
import { DIR_NUM, DIR_OF, faceToward, forceStep, opposite, type Actor } from '../characters/actor';
import type { Story, Value } from './story';
import { createMon } from '../pokemon/mon';
import { monRandom } from '../core/random';

/** What scripts reach into: the rest of the game. */
export interface ScriptHost {
  clock: Clock;
  input: Input;
  story: Story;
  world: World;
  textbox: TextBox;
  emote: Emote;
  music: { play(name: string | null | undefined): void };
  pokemon: PokemonFile;
  items: Record<string, ItemData>;
  /** the window showmonpic opens beside the text box */
  monPic: { show(species: string): void; hide(): void };
  player: Actor;
  npcs: Actor[];
  areaActors(): Actor[];
  warpTo(dest: LoadedMap, x: number, y: number, arrive?: string | null): Promise<void>;
  /** a trainer battle; resolves how it ended. Texts are script text labels. */
  battle(foe: { trainer: string }, opts: { loseText?: string; winText?: string; firstBattle?: boolean; healAfter?: boolean }): Promise<'won' | 'lost' | 'ran' | 'caught'>;
  /** HealPlayerParty */
  healParty(): void;
  /** losing a battle that isn't Blue's in the lab: money lost, healed, home */
  whiteOut(): Promise<void>;
  /** the trainers, for their encounter music */
  battleData?: { trainers: Record<string, { music: { encounter: string } }> };
}

/** NPC_TEXT_COLOR_MALE / FEMALE / MON / NEUTRAL */
const TEXT_COLORS: TextColor[] = ['male', 'female', 'neutral', 'neutral'];
const MOVEMENT_FACING: Record<string, Dir> = { MOVEMENT_TYPE_FACE_UP: 'up', MOVEMENT_TYPE_FACE_DOWN: 'down', MOVEMENT_TYPE_FACE_LEFT: 'left', MOVEMENT_TYPE_FACE_RIGHT: 'right' };
const compare: Record<string, (a: Value, b: Value) => boolean> = {
  eq: (a, b) => a === b, ne: (a, b) => a !== b,
  lt: (a, b) => (a as number) < (b as number), gt: (a, b) => (a as number) > (b as number),
  le: (a, b) => (a as number) <= (b as number), ge: (a, b) => (a as number) >= (b as number),
};

interface RunContext {
  /** the person talked to, if any */
  target: Actor | null;
  color: TextColor;
  /** NPC_TEXT_COLOR_… as a number (VAR_TEXT_COLOR) */
  colorId: number;
  /** the colour textcolor last replaced (VAR_PREV_TEXT_COLOR) */
  prevColorId: number;
  style: BoxStyle;
  /** movements started by applymovement, awaited by waitmovement */
  moves: Promise<void>[];
}

export class ScriptVM {
  /** scripts running (a scene can start another) */
  depth = 0;
  running = false;
  /** the last command run, for debugging */
  lastCommand = '';
  /** the map whose scripts are in effect */
  currentMap: LoadedMap | null = null;
  /** music a script saved to play when the scene ends */
  savedBgm: string | null = null;

  constructor(private data: ScriptsFile, private host: ScriptHost) {}

  /** Follow constants to what they stand for (up to 4 deep). */
  /** Whether a script is in the bake. */
  has(label: string) {
    return !!this.data.scripts[label];
  }

  resolve(a: string | undefined): string | undefined {
    let v = a;
    for (let i = 0; i < 4 && v !== undefined && this.data.consts[v] != null; i++) v = this.data.consts[v];
    return v;
  }

  /** An argument's value: a variable's contents, a number, or the resolved name. */
  value(a: string | undefined): Value {
    const v = this.resolve(a);
    if (/^VAR_/.test(v as string)) return v === 'VAR_FACING' ? DIR_NUM[this.host.player.facing] : this.host.story.vars[v!] ?? 0;
    const n = Number(v);
    return Number.isNaN(n) ? v : n;
  }

  private actorFor(ref: string, ctx: RunContext): Actor | null {
    if (ref === 'VAR_LAST_TALKED') return ctx.target;
    const id = /^VAR_/.test(this.resolve(ref) as string) ? this.value(ref) : this.resolve(ref); // a var can hold a local id
    if (id === 'LOCALID_PLAYER' || id === 'OBJ_EVENT_ID_PLAYER') return this.host.player;
    return this.host.areaActors().find((a) => a.id === id) ?? null;
  }

  private async runMovement(actor: Actor, label: string) {
    const { clock, emote, player } = this.host;
    for (const [cmd] of this.data.scripts[label] ?? []) {
      if (cmd === 'step_end') break;
      const dir = cmd.match(/_(up|down|left|right)$/)?.[1] as Dir | undefined;
      if (/^walk_in_place/.test(cmd) || /^face_(up|down|left|right)$/.test(cmd)) { if (dir) actor.facing = dir; await clock.delayFrames(cmd.includes('faster') ? 4 : 8); }
      else if (/^(walk|run|jump|player_run)_/.test(cmd) && dir) { forceStep(actor, dir); await clock.until(() => !actor.from); }
      else if (cmd === 'set_invisible') actor.invisible = true;
      else if (cmd === 'set_visible') actor.invisible = false;
      else if (cmd === 'face_player') faceToward(actor, player);
      else if (cmd === 'face_away_player') { faceToward(actor, player); actor.facing = opposite[actor.facing]; }
      else if (cmd === 'face_original_direction') actor.facing = actor.startFacing ?? actor.facing;
      else if (/^delay_(\d+)$/.test(cmd)) await clock.delayFrames(Number(cmd.split('_')[1]));
      else if (cmd === 'emote_exclamation_mark') await emote.show(actor, '!');
      else if (cmd === 'emote_question_mark') await emote.show(actor, '?');
    }
  }

  /** Run an event script; target is the person talked to, if any. */
  async run(label: string, target: Actor | null) {
    const { scripts, text } = this.data;
    const { clock, input, story, world, textbox, music, player, npcs } = this.host;
    if (!scripts[label]) return;
    this.depth++; this.running = true;
    input.clearHeld();
    const ctx: RunContext = {
      target,
      color: 'neutral',
      prevColorId: 0,
      colorId: Number(this.value(target ? this.data.textColors[target.gfx] ?? 'NPC_TEXT_COLOR_NEUTRAL' : 'NPC_TEXT_COLOR_NEUTRAL')),
      style: 'normal',
      moves: [],
    };
    ctx.color = TEXT_COLORS[ctx.colorId] ?? 'neutral';
    const setColor = (id: number) => { ctx.colorId = id; ctx.color = TEXT_COLORS[id] ?? ctx.color; };
    const stack: { body: Command[]; pc: number }[] = [];
    let body = scripts[label], pc = 0;
    let switchValue: Value = 0;
    const jump = (to: string | undefined) => { if (to && scripts[to]) { body = scripts[to]; pc = 0; return true; } return false; };
    // The text colour vars belong to the scene, not the save.
    const value = (a: string | undefined) => {
      const v = this.resolve(a);
      return v === 'VAR_TEXT_COLOR' ? ctx.colorId : v === 'VAR_PREV_TEXT_COLOR' ? ctx.prevColorId : this.value(a);
    };
    const resolve = (a: string | undefined) => this.resolve(a);
    try {
      for (let steps = 0; steps < 2000; steps++) {
        if (pc >= body.length) { if (!stack.length) break; ({ body, pc } = stack.pop()!); continue; }
        const [cmd, ...args] = body[pc++];
        this.lastCommand = `${label}: ${cmd} ${args.join(', ')}`;
        const cond = cmd.match(/^(goto|call)_if_(eq|ne|lt|gt|le|ge)$/);
        if (cond) {
          if (compare[cond[2]](value(args[0]), value(args[1]))) { if (cond[1] === 'call') stack.push({ body, pc }); jump(args[2]); }
          continue;
        }
        const flagCond = cmd.match(/^(goto|call)_if_(set|unset)$/);
        if (flagCond) {
          if (story.flags.has(resolve(args[0])!) === (flagCond[2] === 'set')) { if (flagCond[1] === 'call') stack.push({ body, pc }); jump(args[1]); }
          continue;
        }
        switch (cmd) {
          case 'end': stack.length = 0; pc = body.length; break;
          case 'return': if (stack.length) ({ body, pc } = stack.pop()!); else pc = body.length; break;
          case 'goto': jump(args[0]); break;
          case 'call': stack.push({ body, pc }); jump(args[0]); break;
          case 'switch': switchValue = value(args[0]); break;
          case 'case': if (switchValue === value(args[0])) jump(args[1]); break;
          case 'setvar': story.vars[resolve(args[0])!] = value(args[1]); break;
          case 'copyvar':
            if (resolve(args[0]) === 'VAR_TEXT_COLOR') setColor(Number(value(args[1])));
            else if (resolve(args[0]) === 'VAR_PREV_TEXT_COLOR') ctx.prevColorId = Number(value(args[1]));
            else story.vars[resolve(args[0])!] = value(args[1]);
            break;
          case 'addvar': story.vars[resolve(args[0])!] = (value(args[0]) as number) + (value(args[1]) as number); break;
          case 'subvar': story.vars[resolve(args[0])!] = (value(args[0]) as number) - (value(args[1]) as number); break;
          case 'setflag': story.flags.add(resolve(args[0])!); break;
          case 'clearflag': {
            const fl = resolve(args[0])!;
            story.flags.delete(fl);
            // A person hidden by this flag reappears at their spot, as when the game respawns objects.
            for (const a of npcs) if (a.area === world.area && a.flag === fl && a.removed) a.removed = false;
            break;
          }
          case 'specialvar': story.vars[resolve(args[0])!] = 0; break;
          case 'setrespawn': story.respawn = resolve(args[0])!; break;
          case 'multichoice': {
            // Only MULTICHOICE_YES_NO so far: VAR_RESULT is the choice's index (YES 0, NO 1).
            // Other menus come back cancelled (SCR_MENU_CANCEL).
            if (resolve(args[2]) === 'MULTICHOICE_YES_NO') story.vars.VAR_RESULT = (await textbox.yesNo()) ? 0 : 1;
            else story.vars.VAR_RESULT = 127;
            break;
          }
          case 'waitfieldeffect': await clock.delayFrames(90); break; // the Center's healing machine and its jingle
          case 'pokemart': break; // shopping isn't in yet: the clerk says hello and goodbye
          case 'checkplayergender': story.vars.VAR_RESULT = 0; break;
          case 'waitfanfare': await clock.delayFrames(150); break; // the jingle holds "Obtained …" on screen
          // The Bag. Amounts default to 1; the item may come from a variable.
          case 'checkitemspace': story.vars.VAR_RESULT = story.bag.hasSpace(String(value(args[0])), Number(value(args[1] ?? '1'))) ? 1 : 0; break;
          case 'checkitem': story.vars.VAR_RESULT = story.bag.count(String(value(args[0]))) >= Number(value(args[1] ?? '1')) ? 1 : 0; break;
          case 'additem': story.vars.VAR_RESULT = story.bag.add(String(value(args[0])), Number(value(args[1] ?? '1'))) ? 1 : 0; break;
          case 'removeitem': story.vars.VAR_RESULT = story.bag.remove(String(value(args[0])), Number(value(args[1] ?? '1'))) ? 1 : 0; break;
          case 'addmoney': story.money = Math.min(999999, story.money + Number(value(args[0]))); break;
          case 'removemoney': story.money = Math.max(0, story.money - Number(value(args[0]))); break;
          case 'checkmoney': story.vars.VAR_RESULT = story.money >= Number(value(args[0])) ? 1 : 0; break;
          case 'bufferitemname': case 'bufferspeciesname': case 'buffermovename': {
            // {STR_VAR_n} in the next text. The name may come from a variable holding it
            // (PLAYER_STARTER_SPECIES -> SPECIES_BULBASAUR); species and moves use their real names.
            const key = String(value(args[1] ?? ''));
            const { species, moves } = this.host.pokemon;
            story.names[resolve(args[0])!] = species[key]?.name ?? moves[key]?.name ?? this.host.items[key]?.name ?? key.replace(/^(ITEM|SPECIES|MOVE)_/, '').replace(/_/g, ' ');
            break;
          }
          case 'givemon': {
            // givemon SPECIES, LEVEL: a new Pokémon joins the party (MON_GIVEN_TO_PARTY), if there's room.
            const species = String(value(args[0])), level = Number(value(args[1] ?? '5'));
            if (this.host.pokemon.species[species] && story.party.length < 6) {
              story.party.push(createMon(this.host.pokemon, species, level, monRandom, { id: story.trainerId, name: story.names.PLAYER }));
              story.register(species, true);
              story.vars.VAR_RESULT = 0;
            } else story.vars.VAR_RESULT = 2; // MON_CANT_GIVE: no PC boxes yet
            break;
          }
          case 'showmonpic': this.host.monPic.show(String(value(args[0]))); break;
          case 'hidemonpic': this.host.monPic.hide(); break;
          case 'faceplayer': if (target) faceToward(target, player); break;
          // textcolor keeps the colour it replaces, for EventScript_RestorePrevTextColor to copy back.
          case 'textcolor': ctx.prevColorId = ctx.colorId; setColor(value(args[0]) as number); break;
          case 'signmsg': ctx.style = 'sign'; break;
          case 'normalmsg': ctx.style = 'normal'; break;
          case 'msgbox': {
            const type = args[1] ?? 'MSGBOX_DEFAULT', t = text[args[0]];
            if (type === 'MSGBOX_NPC' && target) faceToward(target, player);
            if (t != null) await textbox.say(t, { style: type === 'MSGBOX_SIGN' ? 'sign' : ctx.style, color: type === 'MSGBOX_SIGN' ? 'neutral' : ctx.color });
            if (type === 'MSGBOX_YESNO') story.vars.VAR_RESULT = await textbox.yesNo();
            if (type === 'MSGBOX_NPC' || type === 'MSGBOX_SIGN' || type === 'MSGBOX_AUTOCLOSE') textbox.close();
            break;
          }
          case 'message': if (text[args[0]] != null) await textbox.say(text[args[0]], { style: ctx.style, color: ctx.color, wait: false }); break;
          case 'waitbuttonpress': await clock.until(input.takeA); break;
          case 'closemessage': textbox.close(); break;
          case 'giveitem_msg': {
            // giveitem_msg TEXT, ITEM[, AMOUNT]: add it, then show the scene's own line, in neutral text (Std_ReceivedItem).
            const ok = story.bag.add(String(value(args[1])), Number(value(args[2] ?? '1')));
            if (text[args[0]] != null) await textbox.say(text[args[0]], { color: 'neutral' });
            story.vars.VAR_RESULT = ok ? 1 : 0;
            break;
          }
          case 'giveitem': case 'finditem': {
            const item = String(value(args[0])), n = Number(value(args[1] ?? '1'));
            const name = this.host.items[item]?.name ?? item.replace(/^ITEM_/, '').replace(/_/g, ' ');
            const ok = story.bag.add(item, n);
            await textbox.say(ok ? `${story.names.PLAYER} obtained ${n > 1 ? n : 'a'} ${name}!` : 'Too bad! The BAG is full…');
            story.vars.VAR_RESULT = ok ? 1 : 0;
            break;
          }
          case 'trainerbattle_earlyrival': {
            // Blue in Oak's lab (TRAINER_BATTLE_EARLY_RIVAL): no intro, straight into battle. The
            // flags say whether it's the tutorial and whether losing heals instead of whiting out;
            // either way the script carries on, with VAR_RESULT 1 if the player lost (CB2_EndTrainerBattle).
            const flags = Number(value(args[1])) || 0;
            const healAfter = !!(flags & Number(value('RIVAL_BATTLE_HEAL_AFTER')));
            const outcome = await this.host.battle({ trainer: args[0] }, {
              loseText: args[2], winText: args[3], healAfter,
              firstBattle: (flags & Number(value('RIVAL_BATTLE_TUTORIAL'))) === Number(value('RIVAL_BATTLE_TUTORIAL')),
            });
            story.vars.VAR_RESULT = outcome === 'lost' ? 1 : 0;
            if (outcome === 'lost') this.host.healParty();
            story.flags.add(args[0]); // SetBattledTrainerFlag
            music.play(this.currentMap?.data.music); // CB2_ReturnToFieldContinueScriptPlayMapMusic
            break;
          }
          case 'trainerbattle_single': {
            // A trainer already beaten lets the script go on to their after-battle lines. Otherwise:
            // their encounter music and challenge, the battle, and the script ends (or goes on to
            // its event script, args[3], as TRAINER_BATTLE_CONTINUE_SCRIPT does).
            if (story.flags.has(args[0])) break;
            const intro = text[args[1]];
            if (target) faceToward(target, player);
            const encounter = this.host.battleData?.trainers[args[0]]?.music.encounter;
            if (encounter) music.play(encounter);
            if (intro != null) await textbox.say(intro, { color: ctx.color });
            textbox.close();
            const outcome = await this.host.battle({ trainer: args[0] }, { loseText: args[2] });
            story.flags.add(args[0]);
            music.play(this.currentMap?.data.music);
            if (outcome === 'lost') { pc = body.length; stack.length = 0; void this.host.whiteOut(); break; }
            if (args[3] && args[3] !== 'FALSE' && jump(args[3])) break;
            pc = body.length; stack.length = 0;
            break;
          }
          case 'special':
            if (args[0] === 'HealPlayerParty') this.host.healParty();
            break;
          case 'trainerbattle_double': {
            // Double battles come later: show the challenge, then stop.
            const intro = text[args[1]];
            if (target) faceToward(target, player);
            if (intro != null) await textbox.say(intro, { color: ctx.color });
            pc = body.length; stack.length = 0;
            break;
          }
          case 'applymovement': {
            const actor = this.actorFor(args[0], ctx);
            if (actor) ctx.moves.push(this.runMovement(actor, args[1]));
            break;
          }
          case 'waitmovement': await Promise.all(ctx.moves); ctx.moves = []; break;
          case 'delay': await clock.delayFrames(value(args[0]) as number); break;
          case 'removeobject': {
            const a = this.actorFor(args[0], ctx);
            if (a && a !== player) { a.removed = true; if (a.flag && a.flag !== '0') story.flags.add(a.flag); }
            break;
          }
          case 'addobject': { const a = this.actorFor(args[0], ctx); if (a && a !== player) a.removed = false; break; }
          case 'turnobject': { const a = this.actorFor(args[0], ctx); if (a) a.facing = DIR_OF[value(args[1]) as number] ?? a.facing; break; }
          case 'setobjectxyperm': {
            const a = this.actorFor(args[0], ctx);
            if (a && a !== player) { a.x = a.home.x = a.m.ox + (value(args[1]) as number); a.y = a.home.y = a.m.oy + (value(args[2]) as number); a.from = null; }
            break;
          }
          case 'setobjectmovementtype': {
            const a = this.actorFor(args[0], ctx);
            if (a && a !== player) { a.movement = args[1]; if (MOVEMENT_FACING[args[1]]) a.facing = a.startFacing = MOVEMENT_FACING[args[1]]; }
            break;
          }
          case 'waitdooranim': await clock.delayFrames(16); break;
          case 'warp': case 'warpsilent': {
            const dest = world.mapById(args[0]);
            if (!dest) { pc = body.length; stack.length = 0; break; } // somewhere not in this bake
            if (args.length >= 3 && args[2] !== undefined && !Number.isNaN(Number(value(args[2])))) await this.host.warpTo(dest, value(args[1]) as number, value(args[2]) as number);
            else { const t = dest.data.warps[value(args[1]) as number]; if (t) await this.host.warpTo(dest, t.x, t.y, t.behavior); }
            break;
          }
          case 'playbgm': music.play(args[0]); break;
          case 'savebgm': this.savedBgm = args[0] === 'MUS_DUMMY' ? null : args[0]; break;
          case 'fadedefaultbgm': music.play(this.savedBgm ?? this.currentMap?.data.music); break;
          default: break; // lock, release, special, fanfares, battles, …: not needed to read the scene yet
        }
      }
    } finally {
      await Promise.all(ctx.moves);
      textbox.close();
      textbox.hideChoice();
      if (this.depth === 1) this.host.monPic.hide();
      this.depth--; this.running = this.depth > 0;
      input.takeA();
    }
  }

  // ---- map scripts ----

  /** { MAP_SCRIPT_ON_TRANSITION: label, ... } for a map */
  private mapScriptTable(m: LoadedMap): Record<string, string> {
    return Object.fromEntries((this.data.scripts[m.data.mapScripts] ?? []).filter(([c]) => c === 'map_script').map(([, type, label]) => [type, label]));
  }

  /** First map_script_2 entry whose var holds its value. */
  private pickTable(label: string): string | undefined {
    return (this.data.scripts[label] ?? []).find(([c, v, val]) => c === 'map_script_2' && this.value(v) === this.value(val))?.[3];
  }

  /** Show or hide people by their visibility flags, as the game does when a map loads. */
  refreshObjects() {
    const { npcs, world, story } = this.host;
    for (const a of npcs) {
      if (a.area !== world.area) continue;
      a.removed = !!a.flag && a.flag !== '0' && story.flags.has(a.flag);
      // A sprite chosen at runtime (OBJ_EVENT_GFX_VAR_n) comes from VAR_OBJ_GFX_ID_n.
      const v = a.gfx.match(/^OBJ_EVENT_GFX_VAR_(\w)$/);
      if (v) a.s = a.m.data.sprites[String(this.value(`VAR_OBJ_GFX_ID_${v[1]}`))] ?? a.s;
    }
  }

  /** A map loads (warped in, or walked in across an edge): run its scripts and start its music. */
  enterMap(m: LoadedMap, warped: boolean) {
    const { story, music } = this.host;
    this.currentMap = m;
    story.clearTemps();
    this.savedBgm = null;
    const table = this.mapScriptTable(m);
    if (table.MAP_SCRIPT_ON_TRANSITION) this.run(table.MAP_SCRIPT_ON_TRANSITION, null);
    this.refreshObjects();
    const onWarp = warped && table.MAP_SCRIPT_ON_WARP_INTO_MAP_TABLE && this.pickTable(table.MAP_SCRIPT_ON_WARP_INTO_MAP_TABLE);
    if (onWarp) this.run(onWarp, null);
    if (!story.flags.has('FLAG_DONT_TRANSITION_MUSIC')) music.play(this.savedBgm ?? m.data.music);
  }

  /** The current map's per-frame script whose condition holds, if any (the opening scenes start this way). */
  frameScript(): string | null | undefined {
    const label = this.currentMap && this.mapScriptTable(this.currentMap).MAP_SCRIPT_ON_FRAME_TABLE;
    return label ? this.pickTable(label) : null;
  }

  /** A step-on trigger under (x, y) whose var holds its value. */
  triggerAt(x: number, y: number) {
    return this.host.world.triggerAt(x, y, (t) => this.value(t.var) === this.value(t.value));
  }
}
