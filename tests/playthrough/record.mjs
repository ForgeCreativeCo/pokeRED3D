// Records a play-through as a golden transcript, or checks one against it.
//
//   node tests/playthrough/record.mjs opening           write golden/opening.json
//   node tests/playthrough/record.mjs opening --check   play again and compare
//
// The game's text is FireRed's, so the committed golden keeps only a hash of
// each text box. A readable copy goes to build/playthrough/<name>.txt.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { play, DEFAULT_URL } from './driver.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const [name, ...flags] = process.argv.slice(2);
const check = flags.includes('--check');
const url = flags.find((f) => f.startsWith('http')) ?? DEFAULT_URL;
if (!name) {
  console.error('Usage: node tests/playthrough/record.mjs <name> [--check] [url]');
  process.exit(1);
}

const steps = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, `${name}.json`), 'utf8'));
const transcript = await play(steps, { url });

const hash = (s) => (s ? crypto.createHash('sha256').update(s).digest('hex').slice(0, 12) : '');
const scrub = (t) => ({ ...t, text: hash(t.text), ...(t.said && { said: t.said.map(hash) }) });
const golden = transcript.map(scrub);

const readable = transcript.map((t) => [
  JSON.stringify(t.step), `  ${t.where} | ${t.text}`, ...(t.said ?? []).map((s) => `    > ${s}`),
].join('\n')).join('\n');
fs.mkdirSync(path.join(ROOT, 'build/playthrough'), { recursive: true });
fs.writeFileSync(path.join(ROOT, `build/playthrough/${name}.txt`), readable + '\n');

const file = path.join(import.meta.dirname, 'golden', `${name}.json`);
if (!check) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(golden, null, 1) + '\n');
  console.log(`Recorded ${golden.length} steps to ${path.relative(ROOT, file)}`);
} else {
  const want = JSON.parse(fs.readFileSync(file, 'utf8'));
  const diffs = [];
  for (let i = 0; i < Math.max(want.length, golden.length); i++) {
    const a = JSON.stringify(want[i]), b = JSON.stringify(golden[i]);
    if (a !== b) diffs.push(`step ${i} ${JSON.stringify((want[i] ?? golden[i]).step)}\n  want ${a}\n  got  ${b}`);
  }
  if (diffs.length) {
    console.error(`${name}: ${diffs.length} step(s) differ (readable run in build/playthrough/${name}.txt)\n${diffs.slice(0, 3).join('\n')}`);
    process.exit(1);
  }
  console.log(`${name}: matches the golden transcript (${golden.length} steps)`);
}
