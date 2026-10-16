// The game's own random numbers (people's wander timers and directions),
// separate from Math.random so rendering can't shift them: three.js draws on
// Math.random for object ids, and how many objects it makes depends on the
// bundle. ?seed=<n> in the page URL makes a run reproducible.

let next: () => number = Math.random;

export const random = () => next();

/** mulberry32: small, fast, and good enough for wandering. */
export function seedRandom(seed: number) {
  let s = seed >>> 0;
  next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
