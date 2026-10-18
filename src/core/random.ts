// The game's own random numbers, separate from Math.random so rendering can't
// shift them: three.js draws on Math.random for object ids, and how many
// objects it makes depends on the bundle. ?seed=<n> in the page URL makes a
// run reproducible.
//
// There are four streams, so one system's rolls can't move another's: people's
// wander timers and directions use `random`, new Pokémon (IVs, nature,
// personality) use `monRandom`, battles (hits, damage, turn order) use
// `battleRandom`, and wild encounters (whether one happens, which Pokémon) use
// `encounterRandom`.

/** mulberry32: small, fast, and good enough for both. */
function stream(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let wander: () => number = Math.random;
let mons: () => number = Math.random;
let battles: () => number = Math.random;
let encounters: () => number = Math.random;

export const random = () => wander();
export const monRandom = () => mons();
export const battleRandom = () => battles();
export const encounterRandom = () => encounters();

export function seedRandom(seed: number) {
  wander = stream(seed);
  mons = stream(seed ^ 0x9e3779b9);
  battles = stream(seed ^ 0x85ebca6b);
  encounters = stream(seed ^ 0xc2b2ae35);
}
