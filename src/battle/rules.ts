// FireRed's battle formulas, ported from the decomp: damage
// (CalculateBaseDamage in src/pokemon.c, then Cmd_damagecalc, Cmd_typecalc and
// Cmd_adjustnormaldamage in src/battle_script_commands.c), accuracy, critical
// hits, turn order, experience, effort values, escaping and prize money.
//
// Every roll takes a 16-bit number, as the game's Random() gives, so tests can
// pass the exact values they want.

import type { BattleFile, MoveData, StatKey, Stats } from '../data/types';
import type { MajorStatus } from '../pokemon/mon';

/** Stat stages: Attack, Defense, Speed, Sp. Atk, Sp. Def, accuracy, evasion, each -6 to +6. */
export type StageKey = Exclude<StatKey, 'hp'> | 'acc' | 'eva';
export type Stages = Record<StageKey, number>;
export const STAGE_KEYS: StageKey[] = ['atk', 'def', 'spe', 'spa', 'spd', 'acc', 'eva'];
export const noStages = (): Stages => ({ atk: 0, def: 0, spe: 0, spa: 0, spd: 0, acc: 0, eva: 0 });

/** gStatStageRatios (src/pokemon.c): [numerator, denominator] for stages -6 to +6. */
const STAT_STAGE_RATIOS: [number, number][] = [
  [10, 40], [10, 35], [10, 30], [10, 25], [10, 20], [10, 15], [10, 10],
  [15, 10], [20, 10], [25, 10], [30, 10], [35, 10], [40, 10],
];
/** sAccuracyStageRatios (src/battle_script_commands.c), stages -6 to +6. */
const ACCURACY_STAGE_RATIOS: [number, number][] = [
  [33, 100], [36, 100], [43, 100], [50, 100], [60, 100], [75, 100], [1, 1],
  [133, 100], [166, 100], [2, 1], [233, 100], [133, 50], [3, 1],
];
/** sCriticalHitChance: one in this many, by how many crit boosts stack. */
export const CRIT_CHANCE = [16, 8, 4, 3, 2];

const clampStage = (s: number) => Math.max(-6, Math.min(6, s));

/** APPLY_STAT_MOD: a stat at a stage. */
export function applyStage(stat: number, stage: number): number {
  const [n, d] = STAT_STAGE_RATIOS[clampStage(stage) + 6];
  return Math.floor((stat * n) / d);
}

/** What the formulas need to know about a Pokémon in battle. */
export interface Fighter {
  species: string;
  level: number;
  hp: number;
  /** the five battle stats and max HP */
  stats: Stats;
  stages: Stages;
  types: string[];
  ability: string;
  status: MajorStatus | null;
}

export type Effectiveness = 'none' | 'not-very' | 'normal' | 'super';

/** Moves' types split physical / special by type (IS_TYPE_PHYSICAL); ??? (TYPE_MYSTERY) is neither. */
export const isPhysical = (battle: BattleFile, type: string) => battle.types.physical.includes(type);

/**
 * CalculateBaseDamage, for the parts that apply so far: abilities that change
 * attack and power, stat stages (a critical hit ignores the attacker's drops
 * and the defender's boosts), burn, and the final +2. Held items, badges,
 * weather, screens and doubles aren't in yet.
 */
export function baseDamage(battle: BattleFile, attacker: Fighter, defender: Fighter, move: MoveData, crit: boolean, power = move.power): number {
  const type = move.type;
  let attack = attacker.stats.atk, defense = defender.stats.def;
  let spAttack = attacker.stats.spa;
  const spDefense = defender.stats.spd;
  if (attacker.ability === 'ABILITY_HUGE_POWER' || attacker.ability === 'ABILITY_PURE_POWER') attack *= 2;
  if (defender.ability === 'ABILITY_THICK_FAT' && (type === 'TYPE_FIRE' || type === 'TYPE_ICE')) spAttack = Math.floor(spAttack / 2);
  if (attacker.ability === 'ABILITY_HUSTLE') attack = Math.floor((150 * attack) / 100);
  if (attacker.ability === 'ABILITY_GUTS' && attacker.status) attack = Math.floor((150 * attack) / 100);
  if (defender.ability === 'ABILITY_MARVEL_SCALE' && defender.status) defense = Math.floor((150 * defense) / 100);
  // Overgrow, Blaze, Torrent and Swarm: x1.5 power at a third of max HP or less.
  const pinch: Record<string, string> = { TYPE_GRASS: 'ABILITY_OVERGROW', TYPE_FIRE: 'ABILITY_BLAZE', TYPE_WATER: 'ABILITY_TORRENT', TYPE_BUG: 'ABILITY_SWARM' };
  if (pinch[type] === attacker.ability && attacker.hp <= Math.floor(attacker.stats.hp / 3)) power = Math.floor((150 * power) / 100);
  if (move.effect === 'EFFECT_EXPLOSION') defense = Math.floor(defense / 2);

  if (type === 'TYPE_MYSTERY') return 2;
  const levelFactor = Math.floor((2 * attacker.level) / 5) + 2;
  let damage: number;
  if (isPhysical(battle, type)) {
    const a = crit && attacker.stages.atk <= 0 ? attack : applyStage(attack, attacker.stages.atk);
    const d = crit && defender.stages.def >= 0 ? defense : applyStage(defense, defender.stages.def);
    damage = Math.floor(Math.floor((a * power * levelFactor) / d) / 50);
    if (attacker.status?.kind === 'burn' && attacker.ability !== 'ABILITY_GUTS') damage = Math.floor(damage / 2);
    if (damage === 0) damage = 1;
  } else {
    const a = crit && attacker.stages.spa <= 0 ? spAttack : applyStage(spAttack, attacker.stages.spa);
    const d = crit && defender.stages.spd >= 0 ? spDefense : applyStage(spDefense, defender.stages.spd);
    damage = Math.floor(Math.floor((a * power * levelFactor) / d) / 50);
  }
  return damage + 2;
}

/**
 * The type chart's multipliers (x10) for a move type against the defender's
 * types, in the order Cmd_typecalc applies them. A one-type Pokémon is
 * checked once. The Foresight entries apply unless Foresight is up.
 */
export function typeMultipliers(battle: BattleFile, moveType: string, defTypes: string[], foresight = false): number[] {
  const out: number[] = [];
  const entries = foresight ? battle.types.chart : [...battle.types.chart, ...battle.types.foresight];
  for (const [atk, def, mul] of entries) {
    if (atk !== moveType) continue;
    if (def === defTypes[0]) out.push(mul);
    if (defTypes[1] && def === defTypes[1] && defTypes[1] !== defTypes[0]) out.push(mul);
  }
  return out;
}

/** How the multipliers read out ("It's super effective!"): opposite ones cancel. */
export function effectiveness(multipliers: number[]): Effectiveness {
  if (multipliers.includes(0)) return 'none';
  const product = multipliers.reduce((p, m) => (p * m) / 10, 10);
  return product > 10 ? 'super' : product < 10 ? 'not-very' : 'normal';
}

/**
 * Cmd_damagecalc through Cmd_adjustnormaldamage: x2 for a critical hit, x1.5
 * for a move of the attacker's own type (STAB), each type multiplier in turn
 * (rounding down, at least 1), then the random factor of 85-100%
 * (`roll` % 16 off 100). Struggle skips the type step, STAB included.
 */
export function finalDamage(base: number, opts: { crit: boolean; stab: boolean; multipliers: number[]; roll: number; struggle?: boolean }): number {
  let damage = base * (opts.crit ? 2 : 1);
  if (!opts.struggle) {
    if (opts.stab) damage = Math.floor((damage * 15) / 10);
    for (const m of opts.multipliers) {
      damage = Math.floor((damage * m) / 10);
      if (damage === 0 && m !== 0) damage = 1;
    }
  }
  if (damage !== 0) {
    damage = Math.floor((damage * (100 - (opts.roll % 16))) / 100);
    if (damage === 0) damage = 1;
  }
  return damage;
}

/**
 * Cmd_accuracycheck: the chance in 100 that a move hits, or null when it
 * can't miss (accuracy 0 in the data, or an always-hit effect).
 */
export function hitChance(move: MoveData, attacker: Fighter, defender: Fighter, battle: BattleFile, foresight = false): number | null {
  if (move.accuracy === 0 || move.effect === 'EFFECT_ALWAYS_HIT' || move.effect === 'EFFECT_VITAL_THROW') return null;
  const stage = clampStage(foresight ? attacker.stages.acc : attacker.stages.acc - defender.stages.eva);
  const [n, d] = ACCURACY_STAGE_RATIOS[stage + 6];
  let calc = Math.floor((n * move.accuracy) / d);
  if (attacker.ability === 'ABILITY_COMPOUND_EYES') calc = Math.floor((calc * 130) / 100);
  if (attacker.ability === 'ABILITY_HUSTLE' && isPhysical(battle, move.type)) calc = Math.floor((calc * 80) / 100);
  return calc;
}

/** The accuracy roll: a miss when Random() % 100 + 1 is over the chance. */
export const hits = (chance: number | null, roll: number) => chance === null || roll % 100 + 1 <= chance;

/** Cmd_critcalc: how many crit boosts stack (Focus Energy counts two). */
export function critStage(move: MoveData, focusEnergy: boolean): number {
  const high = ['EFFECT_HIGH_CRITICAL', 'EFFECT_SKY_ATTACK', 'EFFECT_BLAZE_KICK', 'EFFECT_POISON_TAIL'].includes(move.effect) ? 1 : 0;
  return Math.min(CRIT_CHANCE.length - 1, (focusEnergy ? 2 : 0) + high);
}

/** The crit roll: Random() % chance == 0, unless the defender's ability blocks it. */
export function isCrit(stage: number, defender: Fighter, roll: number): boolean {
  if (defender.ability === 'ABILITY_BATTLE_ARMOR' || defender.ability === 'ABILITY_SHELL_ARMOR') return false;
  return roll % CRIT_CHANCE[stage] === 0;
}

/** GetWhoStrikesFirst's speed: stat stage, then a quarter if paralysed. */
export function battleSpeed(f: Fighter): number {
  let speed = applyStage(f.stats.spe, f.stages.spe);
  if (f.status?.kind === 'paralysis') speed = Math.floor(speed / 4);
  return speed;
}

/**
 * GetWhoStrikesFirst: true when `b` moves before `a`. Higher priority first,
 * then the faster one; a speed tie is a coin flip (`roll` & 1).
 */
export function bGoesFirst(a: { speed: number; priority: number }, b: { speed: number; priority: number }, roll: number): boolean {
  if (a.priority !== b.priority) return b.priority > a.priority;
  if (a.speed === b.speed) return (roll & 1) === 1;
  return b.speed > a.speed;
}

/**
 * Cmd_getexp: experience for one Pokémon that fought a defeated one. The
 * defeated one's base yield x level / 7 is split among the Pokémon that fought
 * it, then x1.5 in a trainer battle and x1.5 again if it was traded.
 */
export function expGained(expYield: number, defeatedLevel: number, participants: number, opts: { trainer: boolean; traded: boolean }): number {
  const calculated = Math.floor((expYield * defeatedLevel) / 7) & 0xffff;
  let exp = Math.max(1, Math.floor(calculated / Math.max(1, participants)));
  if (opts.trainer) exp = Math.floor((exp * 150) / 100);
  if (opts.traded) exp = Math.floor((exp * 150) / 100);
  return exp;
}

const EV_ORDER: StatKey[] = ['hp', 'atk', 'def', 'spe', 'spa', 'spd'];
/** MonGainEVs: the defeated species' effort values, up to 255 a stat and 510 in all. */
export function gainEvs(evs: Stats, yieldOf: Stats): Stats {
  const out = { ...evs };
  let total = EV_ORDER.reduce((t, k) => t + out[k], 0);
  for (const k of EV_ORDER) {
    if (total >= 510) break;
    let inc = yieldOf[k];
    if (total + inc > 510) inc = 510 - total;
    if (out[k] + inc > 255) inc = 255 - out[k];
    out[k] += inc;
    total += inc;
  }
  return out;
}

/**
 * TryRunFromBattle: as fast or faster always gets away; otherwise
 * (speed x 128 / foe's speed + 30 per earlier try), kept to a byte, must beat
 * a random byte.
 */
export function escapes(speed: number, foeSpeed: number, tries: number, roll: number): boolean {
  if (speed >= foeSpeed) return true;
  const odds = (Math.floor((speed * 128) / foeSpeed) + tries * 30) & 0xff;
  return odds > (roll & 0xff);
}

/** Cmd_getmoneyreward: 4 x the last Pokémon's level x the class's factor, doubled in a double battle. */
export const prizeMoney = (lastLevel: number, factor: number, double: boolean) => 4 * lastLevel * factor * (double ? 2 : 1);

/** sWhiteOutMoneyLossMultipliers (src/overworld.c), by badges. */
const WHITE_OUT_MULTIPLIERS = [2, 4, 6, 9, 12, 16, 20, 25, 30];
/** ComputeWhiteOutMoneyLoss: the highest level in the party x 4 x the badge factor, up to all your money. */
export const whiteOutLoss = (highestLevel: number, badges: number, money: number) => Math.min(money, highestLevel * 4 * WHITE_OUT_MULTIPLIERS[Math.min(8, badges)]);
