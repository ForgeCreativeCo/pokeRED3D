// Plays the game from a script of test-hook calls and records what happens.
//
// The page runs seeded (?seed=) and with requestAnimationFrame switched off,
// so only the test hook advances the game and every run of the same steps
// produces the same transcript.
//
// Usage: node tests/playthrough/driver.mjs <steps.json> [dev|dist|single|url]
//   prints the transcript, for writing steps by hand.
//   steps.json: [["step", "up", 3], ["press", "a"], ["advance"], ...]
//     step and advance are the driver's own (see below); anything else is
//     a call to pokered.<method>(...args).

import fs from 'node:fs';
import { chromium } from '@playwright/test';
import { serve } from './serve.mjs';

/** Open the game at url, run each step, and return one transcript entry per step. */
export async function play(steps, { url, seed = 1 }) {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // Only the test hook advances the game.
    await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
    await page.goto(`${url}${url.includes('?') ? '&' : '?'}seed=${seed}`);
    // Poll on a timer: the default polls on animation frames, which are off.
    await page.waitForFunction(() => window.pokered, null, { timeout: 60000, polling: 100 });
    // The party and an open menu are recorded only once there are any, so
    // steps before them read the same as ever.
    const snapshot = () => page.evaluate(() => {
      const party = pokered.party(), menu = pokered.menu(), pic = pokered.monPic(), bag = pokered.bag(), battle = pokered.battleSummary();
      return {
        where: pokered.where(),
        text: pokered.text() || pokered.battleText(),
        people: pokered.people(),
        flags: [...pokered.story.flags].sort(),
        vars: Object.fromEntries(Object.entries(pokered.story.vars).sort()),
        ...(party.length && { party }),
        ...(menu !== 'closed' && { menu }),
        ...(pic && { monPic: pic }),
        ...(bag.length && { bag }),
        ...(battle !== 'closed' && { battle }),
      };
    });
    const call = (method, ...args) => page.evaluate(([m, a]) => pokered[m](...a), [method, args]);
    const state = () => page.evaluate(() => ({
      where: pokered.where(), text: pokered.text() || pokered.battleText(), busy: pokered.scriptDepth > 0,
      // A YES / NO, or a battle menu: advance stops for the steps to choose.
      choosing: !document.getElementById('yesno').hidden || /^battle (menu|moves|party|forget)/.test(pokered.battleState()),
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
      } else if (method === 'wander') {
        // ['wander', max]: walk down and up, a step at a time, until a battle
        // starts (a wild Pokémon in tall grass) or after max steps.
        const [max = 80] = args;
        for (let i = 0; i < max; i++) {
          // A new direction first turns on the spot, so tap until the step is taken.
          const before = (await state()).where.split(' facing')[0];
          for (let tries = 0; tries < 3; tries++) {
            await call('walk', i % 2 ? 'up' : 'down', 0.05);
            if ((await state()).where.split(' facing')[0] !== before || (await call('battleState')) !== 'closed') break;
          }
          if ((await call('battleState')) !== 'closed') break;
        }
      } else if (method === 'catch') {
        // ['catch', max]: in a wild battle, open the BAG and throw a POKé BALL
        // every turn, decline a nickname, and read every message, until the
        // battle is over.
        const [max = 600] = args;
        const said = [];
        let last = null;
        for (let i = 0; i < max; i++) {
          const b = await call('battleState');
          if (b === 'closed') break;
          if (/^battle menu/.test(b) && !(await call('bag')).some((x) => x.includes('POKé BALL'))) break; // none left to throw
          if (/^battle menu FIGHT/.test(b)) { await call('press', 'right', 0.1); continue; }
          if (/^battle menu BAG/.test(b)) { await call('press', 'a', 0.2); continue; }
          if (/^battle bag POKé BALL/.test(b)) { await call('press', 'a', 0.2); last = null; continue; }
          if (/^battle bag/.test(b)) { await call('press', 'down', 0.1); continue; }
          if ((await state()).choosing) { await call('press', 'b', 0.3); continue; }
          const t = await call('battleText');
          if (t && t === last) {
            if (t !== said.at(-1)) said.push(t);
            await call('press', 'a', 0.1);
            last = null;
          } else {
            last = t;
            await call('tick', 0.2);
          }
        }
        entry.said = said;
      } else if (method === 'fight') {
        // ['fight', max]: in a battle, choose FIGHT and the first move every
        // turn, send out the next Pokémon when one faints, and read every
        // message once it has finished typing, until the battle is over.
        const [max = 600] = args;
        const said = [];
        let last = null;
        for (let i = 0; i < max; i++) {
          const b = await call('battleState');
          if (b === 'closed') break;
          if (/^battle (menu|moves)/.test(b)) { await call('press', 'a', 0.2); last = null; continue; }
          if (/^battle party/.test(b)) { await call('press', 'down', 0.1); await call('press', 'a', 0.3); continue; }
          if (/^battle forget/.test(b)) { await call('press', 'b', 0.3); continue; }
          const t = await call('battleText');
          if (t && t === last) {
            if (t !== said.at(-1)) said.push(t);
            await call('press', 'a', 0.1);
            last = null;
          } else {
            last = t;
            await call('tick', 0.2);
          }
        }
        entry.said = said;
      } else if (method === 'reload') {
        // ['reload']: reload the page, as closing and reopening the game would (storage stays).
        await page.reload();
        await page.waitForFunction(() => window.pokered, null, { timeout: 60000, polling: 100 });
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
  const [stepsFile, target] = process.argv.slice(2);
  const steps = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
  const server = await serve(target);
  const transcript = await play(steps, { url: server.url }).finally(() => server.close());
  for (const t of transcript) {
    console.log(`${JSON.stringify(t.step)}\n  ${t.where} | ${t.text}`);
    for (const s of t.said ?? []) console.log(`    > ${s}`);
  }
}
