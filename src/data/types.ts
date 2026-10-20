// The baked data the game loads, as the baker writes it (tools/baker/bake.js).
// rules/README.md documents the map format in prose.

export type Dir = 'up' | 'down' | 'left' | 'right';

/** build/data/world.json: which maps are loaded and where each one sits. */
export interface WorldFile {
  format: { name: 'pokered3d-world'; version: 1 };
  /** Connected outdoor maps share an area; each interior is its own. Offsets are in tiles. */
  maps: { map: string; area: number; ox: number; oy: number }[];
  /** Where a new game starts, when that map is in the bake. */
  start: { map: string; x: number; y: number; facing: Dir } | null;
  /** Heal points whose room is in the bake: where whiting out wakes you (map folder name and cell), and who heals you. */
  healLocations?: HealLocation[];
}

export interface HealLocation {
  /** HEAL_LOCATION_…, as setrespawn names it */
  id: string;
  map: string;
  x: number;
  y: number;
  /** the healer's local id (LOCALID_MOM, LOCALID_VIRIDIAN_NURSE, …) */
  healer: string;
  /** Red's house: Mom heals you, not a nurse */
  home: boolean;
}

/** A textured quad: 4 corners (12 numbers) and a pixel rect in the atlas. */
export interface Quad {
  /** ground, water, step, wall, roof, side, or an object class */
  k: string;
  /** bottom-left, bottom-right, top-right, top-left as seen in the texture */
  p: number[];
  /** [u0, v0, u1, v1] in atlas pixels, v growing downward */
  uv: [number, number, number, number];
  /** 1: alpha-tested cutout */
  a: 0 | 1;
  /** the building this wall, roof or side belongs to (its index in the map), for fading it when it hides the player */
  b?: number;
}

export interface CameraPreset {
  preset: string;
  pitch: number;
  fov: number;
  view: number;
}

export interface Warp {
  x: number;
  y: number;
  behavior: string;
  /** destination map's folder name; absent when it isn't a map */
  to?: string;
  toWarp: number;
}

export interface MapObject {
  id: string | null;
  gfx: string;
  x: number;
  y: number;
  elevation: number;
  movement: string;
  facing: Dir;
  range: [number, number];
  script: string | null;
  flag: string | null;
  hidden?: boolean;
}

export interface Sign {
  type: string;
  x: number;
  y: number;
  script: string | null;
}

export interface Trigger {
  x: number;
  y: number;
  var: string;
  value: string;
  script: string;
}

export interface Connection {
  map: string;
  offset: number;
  direction: string;
}

export interface SpriteSheet {
  width: number;
  height: number;
  shadow: number;
  /** atlas pixel rects in FireRed frame order: 0 face S, 1 N, 2 W, 3-4 walk S, 5-6 walk N, 7-8 walk W */
  frames: [number, number, number, number][];
}

export interface Billboards {
  player: string;
  lean: number;
  matchScreenSize: boolean;
  feetOffset: number;
  stepSeconds: number;
}

/** build/maps/<Map>/map.json */
export interface MapFile {
  format: { name: 'pokered3d-map'; version: number };
  name: string;
  id: string;
  width: number;
  height: number;
  indoor: boolean;
  /** MAP_TYPE_ROUTE, MAP_TYPE_INDOOR, … */
  mapType: string;
  /** MAP_BATTLE_SCENE_NORMAL, …: with the tile underfoot, picks the battle background */
  battleScene: string;
  music: string;
  camera: CameraPreset;
  /** row-major, width * height */
  grid: {
    walkable: number[];
    height: number[];
    elevation: number[];
    behavior: string[];
    /** the metatile's encounter type: 0 none, 1 land (tall grass, caves), 2 water */
    encounter: number[];
    class: string[];
  };
  connections: Connection[];
  warps: Warp[];
  objects: MapObject[];
  signs: Sign[];
  triggers: Trigger[];
  mapScripts: string;
  sprites: Record<string, SpriteSheet>;
  billboards: Billboards;
  structures: { buildings: unknown[]; objects: unknown[] };
  atlas: { file: string };
  /** atlas rects of the flat GBA layers, for compare mode */
  original: {
    below: [number, number, number, number];
    above: [number, number, number, number];
    border: [number, number, number, number];
  };
  quads: Quad[];
}

/** One script command: the command name, then its arguments as written in the decomp. */
export type Command = [string, ...string[]];

/** build/data/scripts.json */
export interface ScriptsFile {
  scripts: Record<string, Command[]>;
  text: Record<string, string>;
  consts: Record<string, string>;
  textColors: Record<string, string>;
  /** flags set in a new save (people hidden until the story shows them) */
  startFlags: string[];
}

export interface Envelope {
  a: number;
  d: number;
  s: number;
  r: number;
  /** a Game Boy channel (envelope counts 0-15) rather than a sample voice (0-255) */
  cgb?: boolean;
}

export type Voice =
  | { type: 'sample'; baseKey: number; pan: number; sample: string; fixed: boolean; env: Envelope }
  | { type: 'square'; baseKey: number; pan: number; duty: number; env: Envelope }
  | { type: 'wave'; baseKey: number; pan: number; wave: string; env: Envelope }
  | { type: 'noise'; baseKey: number; pan: number; env: Envelope };

/** [start, end, key, velocity, voice index], times in seconds */
export type Note = [number, number, number, number, number];
/** [time, control, value]: cc1, cc7, cc10, cc20, cc21 or bend */
export type Control = [number, string, number];

export interface Song {
  name: string;
  volume: number;
  reverb: number;
  length: number;
  loop: { start: number; end: number } | null;
  voices: Voice[];
  tracks: { notes: Note[]; controls: Control[] }[];
}

/** build/data/music.json */
export interface MusicFile {
  songs: Record<string, Song>;
  /** signed 8-bit PCM, base64 */
  samples: Record<string, { rate: number; loopStart: number; loopEnd: number; data: string }>;
  waves: Record<string, number[]>;
}

// ---- Pokémon (build/data/pokemon.json) ----

export type StatKey = 'hp' | 'atk' | 'def' | 'spe' | 'spa' | 'spd';
export type Stats = Record<StatKey, number>;

export interface Species {
  name: string;
  base: Stats;
  /** TYPE_GRASS, … (one or two) */
  types: string[];
  /** ABILITY_… (one or two; the personality picks which) */
  abilities: string[];
  /** GROWTH_MEDIUM_SLOW, … */
  growth: string;
  /** 0 always male, 254 always female, 255 genderless, else the female threshold */
  genderRatio: number;
  catchRate: number;
  expYield: number;
  /** effort values a defeated one gives */
  evYield: Stats;
  friendship: number;
  /** [level, MOVE_…], in the order they're learned */
  learnset: [number, string][];
  /** National Pokédex number (0 for none) */
  dex: number;
}

export interface MoveData {
  name: string;
  type: string;
  power: number;
  accuracy: number;
  pp: number;
  effect: string;
  effectChance: number;
  target: string;
  priority: number;
  contact: boolean;
}

export interface PokemonFile {
  format: { name: 'pokered3d-pokemon'; version: 1 };
  species: Record<string, Species>;
  moves: Record<string, MoveData>;
  /** in FireRed's order; mods are +1 / -1 / 0 for Attack, Defense, Speed, Sp. Atk, Sp. Def */
  natures: { name: string; mods: number[] }[];
  abilities: Record<string, string>;
  /** PNG data URIs, for the species the scripts mention: front and back 64x64, icon 32x64 (two frames) */
  pics: Record<string, { front: string; back: string; icon: string; /** how far battle moves each picture down its frame, and lifts a foe that floats */ frontY: number; backY: number; elevation: number }>;
}

// ---- Items (build/data/items.json) ----

/** The Bag's pockets, as the decomp names them (POCKET_ITEMS -> ITEMS). */
export type Pocket = 'ITEMS' | 'KEY_ITEMS' | 'POKE_BALLS' | 'TM_CASE' | 'BERRY_POUCH';

export interface ItemData {
  name: string;
  price: number;
  pocket: Pocket;
  /** FireRed text, with \n line breaks */
  description: string;
  /** for medicine, how much it restores */
  param: number;
  fieldUse: string | null;
  /** key items: can't be tossed */
  important: boolean;
  /** in battle: BattleUseFunc_PokeBallEtc (balls), BattleUseFunc_Medicine, …, or null */
  battleUse: string | null;
}

export interface ItemsFile {
  format: { name: 'pokered3d-items'; version: 1 };
  items: Record<string, ItemData>;
  /** what a new game starts with */
  startMoney: number;
}

// ---- Battles (build/data/battle.json) ----

/** One wild slot: a species and its level range */
export interface WildMon {
  species: string;
  min: number;
  max: number;
}

export interface WildTable {
  /** the map's encounter rate for this kind */
  rate: number;
  mons: WildMon[];
}

export type WildKind = 'land' | 'water' | 'rockSmash' | 'fishing';

/** One Pokémon of a trainer's party. Without moves, it knows the last four it learned by its level. */
export interface TrainerMon {
  iv: number;
  level: number;
  species: string;
  item?: string;
  moves?: string[];
  /** fixed, from the trainer's and species' names (CreateNPCTrainerParty) */
  personality: number;
}

export interface Trainer {
  /** as the decomp writes it; the rival's is replaced by the rival's name in game */
  name: string;
  /** TRAINER_CLASS_…, and its name (YOUNGSTER, RIVAL, …) */
  class: string;
  className: string;
  female: boolean;
  double: boolean;
  /** items the trainer can use in battle */
  items: string[];
  /** AI_SCRIPT_… flags */
  ai: string[];
  party: TrainerMon[];
  /** prize money: 4 x the last Pokémon's level x this */
  money: number;
  /** TRAINER_PIC_…, a key of trainerPics */
  pic: string;
  /** songs for being spotted, the battle and winning it */
  music: { encounter: string; battle: string; victory: string };
}

export interface BattleFile {
  format: { name: 'pokered3d-battle'; version: 1 };
  types: {
    /** [attacking type, defending type, multiplier x10]: 0, 5 or 20; pairs not listed are 10 */
    chart: [string, string, number][];
    /** entries that apply only until Foresight is used (Normal and Fighting on Ghost) */
    foresight: [string, string, number][];
    /** TYPE_… -> NORMAL, FIGHT, … */
    names: Record<string, string>;
    /** the types whose moves are physical (Gen 3 splits by type, not by move) */
    physical: string[];
  };
  wild: {
    /** weights of each slot, by kind (land: 20, 20, 10, …) */
    slotRates: Record<WildKind, number[]>;
    /** fishing slots per rod */
    rodGroups: Record<string, number[]>;
    /** by map id (MAP_ROUTE1), FireRed's tables */
    maps: Record<string, Partial<Record<WildKind, WildTable>>>;
  };
  /** every trainer the baked scripts can battle, by TRAINER_… */
  trainers: Record<string, Trainer>;
  /** front pictures, 64x64 PNG data URIs, and how far down the frame they sit */
  trainerPics: Record<string, { pic: string; y: number }>;
  /** the player's back pictures (RED, LEAF): 64x64 frames stacked top to bottom */
  playerPics: Record<string, { pic: string; frames: number }>;
  /** each ball by item: a 16x48 PNG data URI, three frames (closed, tilted left, tilted right) */
  ballPics: Record<string, string>;
  /** BATTLE_TERRAIN_… -> the scene above the text box, 240x112 PNG data URI (colour 0 transparent) */
  terrains: Record<string, string>;
  /** songs for wild battles */
  music: { wild: string; wildVictory: string; caughtIntro: string; caught: string };
  /** every string in src/battle_message.c by its C name, with FireRed's placeholders ({B_ATK_NAME_WITH_PREFIX}, …) */
  text: Record<string, string>;
  /** HP, ATTACK, DEFENSE, SPEED, SP. ATK, SP. DEF, accuracy, evasiveness */
  statNames: string[];
}
