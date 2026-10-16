// pokeRED3D: FireRed as a tilted top-down 2.5D game.

import { loadGame } from './data/load';
import { Game } from './game';
import { installHook } from './testing/hook';
import { seedRandom } from './core/random';

async function main() {
  const seed = new URLSearchParams(location.search).get('seed');
  if (seed) seedRandom(Number(seed));
  const game = new Game(await loadGame(), document);
  installHook(game);
  game.start();
}

main().catch((e: unknown) => {
  const box = document.createElement('div');
  box.id = 'error';
  box.textContent = `The game couldn't start: ${e instanceof Error ? e.message : String(e)}. Reload the page to try again.`;
  document.body.append(box);
  throw e;
});
