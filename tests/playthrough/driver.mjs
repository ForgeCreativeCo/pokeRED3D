// Plays the game from a script of test-hook calls and records what happens.
//
// The page runs seeded (?seed=, and a seeded Math.random for the old preview)
// and with requestAnimationFrame switched off, so only the test hook advances
// the game and every run of the same steps produces the same transcript.
//
// Usage: node tests/playthrough/driver.mjs <steps.json> [url]
//   steps.json: [["step", "up", 3], ["press", "a"], ["advance"], ...]
//     step and advance are the driver's own (see below); anything else is
//     a call to pokered.<method>(...args).
//   url defaults to the game served by `npm run dev`.

import fs from 'node:fs';
import { chromium } from '@playwright/test';

export const DEFAULT_URL = 'http://localhost:5173/';

// Runs in the page before any of its scripts.
function deterministic(seed) {
  let s = seed >>> 0;
  Math.random = () => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  window.requestAnimationFrame = () => 0;
}

/** Open the game, run each step, and return one transcript entry per step. */
export async function play(steps, { url = DEFAULT_URL, seed = 1 } = {}) {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(deterministic, seed);
    await page.goto(`${url}${url.includes('?') ? '&' : '?'}seed=${seed}`);
    await page.waitForFunction(() => window.pokered, null, { timeout: 60000 });
    const snapshot = () => page.evaluate(() => ({
      where: pokered.where(),
      text: pokered.text(),
      people: pokered.people(),
      flags: [...pokered.story.flags].sort(),
      vars: Object.fromEntries(Object.entries(pokered.story.vars).sort()),
    }));
    const call = (method, ...args) => page.evaluate(([m, a]) => pokered[m](...a), [method, args]);
    const state = () => page.evaluate(() => ({
      where: pokered.where(), text: pokered.text(), busy: pokered.scriptDepth > 0,
      choosing: !document.getElementById('yesno').hidden,
    }));
    // Warps fade on real-time timers, so let real time pass as well as game time.
    const settle = async () => { await call('tick', 0.5); await page.waitForTimeout(500); await call('tick', 0.1); };
    const transcript = [{ step: ['start'], ...(await snapshot()) }];
    for (const step of steps) {
      const [method, ...args] = step;
      const entry = { step };
      if (method === 'step') {
        // ['step', dir, n]: take n steps that way, turning first if needed.
        // Stops early if blocked or a scene takes over.
        const [dir, n = 1] = args;
        for (let taken = 0, tries = 0; taken < n && tries < n + 2; tries++) {
          const before = (await state()).where;
          await call('walk', dir, 0.05);
          const after = await state();
          if (after.where.split(' facing')[0] !== before.split(' facing')[0]) taken++;
          if (after.text || after.busy) break;
        }
      } else if (method === 'advance') {
        // ['advance', max]: press A through a scene until no text is open and
        // no script runs (or a YES/NO choice is up), collecting each text box
        // once it has finished typing.
        const [max = 400] = args;
        const said = [];
        let last = null, stuck = 0;
        for (let i = 0; i < max; i++) {
          const s = await state();
          if (s.text) {
            if (s.text === said.at(-1) && ++stuck < 6) {
              // Still showing a box already read: a scene goes on around it.
              await call('tick', 0.5);
            } else if (s.text === last) {
              if (s.text !== said.at(-1)) said.push(s.text);
              if (s.choosing) break;
              await call('press', 'a', 0.1);
              last = null; stuck = 0;
            } else {
              last = s.text;
              await call('tick', 0.2);
            }
          } else if (s.busy) {
            await call('tick', 0.5);
          } else {
            // A scene can hand over to the next one after a warp or a frame.
            await settle();
            const again = await state();
            if (!again.text && !again.busy) break;
          }
        }
        entry.said = said;
      } else {
        await call(method, ...args);
      }
      await settle();
      transcript.push({ ...entry, ...(await snapshot()) });
    }
    if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
    return transcript;
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('driver.mjs')) {
  const [stepsFile, url] = process.argv.slice(2);
  const steps = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
  const transcript = await play(steps, { url });
  for (const t of transcript) {
    console.log(`${JSON.stringify(t.step)}\n  ${t.where} | ${t.text}`);
    for (const s of t.said ?? []) console.log(`    > ${s}`);
  }
}
