// Songs from the decomp's sound data, baked for a small GBA-style synth:
//   sound/songs/midi/<song>.mid      notes and controllers, with [ ] loop markers
//   sound/songs/midi/midi.cfg        per song: voicegroup (-G), volume (-V), reverb (-R)
//   sound/voice_groups.inc           the instruments of each voicegroup
//   sound/keysplit_tables.inc        which sub-instrument plays each key
//   sound/direct_sound_samples/*.wav 8-bit samples with loop points
//   sound/programmable_wave_samples  4-bit wave channel shapes
//
// Every note is resolved here to the concrete voice FireRed's sound engine
// (m4a) would pick for it, so the player only has to play voices.

import fs from 'node:fs';
import path from 'node:path';
import { DECOMP_DIR } from './decomp.js';

const read = (file) => fs.readFileSync(path.join(DECOMP_DIR, file));
const text = (file) => read(file).toString('utf8');

// ---- instruments ----

let banks;
function loadBanks() {
  if (banks) return banks;
  const groups = new Map(); // voicegroupNNN -> [voice x 128]
  let current = null;
  for (const line of text('sound/voice_groups.inc').split(/\r?\n/)) {
    const label = line.match(/^(\w+)::/);
    if (label) { current = []; groups.set(label[1], current); continue; }
    const m = line.match(/^\s*(voice_\w+)\s*(.*)$/);
    if (m && current) current.push({ macro: m[1], args: m[2].split(',').map((s) => s.trim()) });
  }

  const keysplits = new Map(); // KeySplitTableN -> Map(key -> index)
  let table = null;
  for (const line of text('sound/keysplit_tables.inc').split(/\r?\n/)) {
    const set = line.match(/^\.set (KeySplitTable\d+)/);
    if (set) { table = new Map(); keysplits.set(set[1], table); continue; }
    const b = line.match(/^\s*\.byte\s+(\d+)\s*@\s*(\d+)/);
    if (b && table) table.set(Number(b[2]), Number(b[1]));
  }

  const symbolFile = (incFile, prefix) => {
    const map = new Map();
    // A label can carry an @ comment (the tuba samples do).
    for (const [, sym, file] of text(incFile).matchAll(new RegExp(`(${prefix}\\w+)::[^\\n]*\\n\\s*\\.incbin "([^"]+)"`, 'g'))) map.set(sym, file);
    return map;
  };
  banks = {
    groups, keysplits,
    sampleFiles: symbolFile('sound/direct_sound_data.inc', 'DirectSoundWaveData_'),
    waveFiles: symbolFile('sound/programmable_wave_data.inc', 'ProgrammableWaveData_'),
  };
  return banks;
}

const num = (s) => Number(s);
const panOf = (p) => (num(p) ? (num(p) - 64) / 64 : 0);

/** A voice line -> plain description, or null for keysplit entries. */
function describe(v) {
  const a = v.args, mac = v.macro.replace(/_alt$/, '');
  if (mac.startsWith('voice_directsound')) {
    return { type: 'sample', baseKey: num(a[0]), pan: panOf(a[1]), sample: a[2], fixed: mac === 'voice_directsound_no_resample', env: { a: num(a[3]), d: num(a[4]), s: num(a[5]), r: num(a[6]) } };
  }
  if (mac === 'voice_square_1') return { type: 'square', baseKey: num(a[0]), pan: panOf(a[1]), duty: num(a[3]) & 3, env: { a: num(a[4]), d: num(a[5]), s: num(a[6]), r: num(a[7]), cgb: true } };
  if (mac === 'voice_square_2') return { type: 'square', baseKey: num(a[0]), pan: panOf(a[1]), duty: num(a[2]) & 3, env: { a: num(a[3]), d: num(a[4]), s: num(a[5]), r: num(a[6]), cgb: true } };
  if (mac === 'voice_programmable_wave') return { type: 'wave', baseKey: num(a[0]), pan: panOf(a[1]), wave: a[2], env: { a: num(a[3]), d: num(a[4]), s: num(a[5]), r: num(a[6]), cgb: true } };
  if (mac === 'voice_noise') return { type: 'noise', baseKey: num(a[0]), pan: panOf(a[1]), period: num(a[2]), env: { a: num(a[3]), d: num(a[4]), s: num(a[5]), r: num(a[6]), cgb: true } };
  return null;
}

/** What plays for this program + key: { voice, key } (m4a's keysplit / rhythm rules). */
function resolve(groupName, program, key) {
  const { groups, keysplits } = loadBanks();
  const v = groups.get(groupName)?.[program];
  if (!v) return null;
  if (v.macro === 'voice_keysplit') {
    const table = keysplits.get(v.args[1]);
    const sub = groups.get(v.args[0])?.[table?.get(key) ?? 0];
    return sub && describe(sub) ? { voice: describe(sub), key } : null;
  }
  if (v.macro === 'voice_keysplit_all') {
    // Drum kits: one voice per key, played at that voice's own base key.
    const sub = groups.get(v.args[0])?.[key];
    const d = sub && describe(sub);
    return d ? { voice: d, key: d.baseKey } : null;
  }
  const d = describe(v);
  return d ? { voice: d, key: d.fixed ? d.baseKey : key } : null;
}

// ---- samples ----

/** 8-bit WAV with smpl loop + agbl loop end -> { rate, loopStart, loopEnd, data (base64, signed 8-bit) } */
function readSample(file) {
  const b = read(file);
  let o = 12, rate = 0, loopStart = -1, loopEnd = 0, data = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4), body = o + 8;
    if (id === 'fmt ') rate = b.readUInt32LE(body + 4);
    if (id === 'smpl' && b.readUInt32LE(body + 28) > 0) { loopStart = b.readUInt32LE(body + 44); loopEnd = b.readUInt32LE(body + 48); }
    if (id === 'agbl') loopEnd = b.readUInt32LE(body);
    if (id === 'agbp') rate = b.readUInt32LE(body) / 1024;
    if (id === 'data') data = b.subarray(body, body + size);
    o = body + size + (size & 1);
  }
  const signed = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) signed[i] = (data[i] - 128) & 0xff; // WAV 8-bit is unsigned
  return { rate, loopStart, loopEnd: loopEnd || data.length, data: signed.toString('base64') };
}

/** 16 bytes of 4-bit samples -> 32 values in -1..1 */
function readWave(file) {
  const b = read(file), out = [];
  for (const byte of b.subarray(0, 16)) out.push((byte >> 4) / 7.5 - 1, (byte & 15) / 7.5 - 1);
  return out;
}

// ---- MIDI ----

function parseMidi(buf) {
  let o = 0;
  const u = (n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + buf[o++]; return v; };
  const vlq = () => { let v = 0, c; do { c = buf[o++]; v = v * 128 + (c & 127); } while (c & 128); return v; };
  o = 8;
  u(2); const ntracks = u(2), division = u(2);
  const tracks = [];
  for (let t = 0; t < ntracks; t++) {
    o += 4;
    const end = u(4) + o;
    const events = [];
    let tick = 0, status = 0;
    while (o < end) {
      tick += vlq();
      let st = buf[o];
      if (st < 0x80) st = status; else o++;
      if (st === 0xff) {
        const type = buf[o++], len = vlq();
        const data = buf.subarray(o, o + len); o += len;
        if (type === 0x51) events.push({ tick, kind: 'tempo', usPerBeat: (data[0] << 16) | (data[1] << 8) | data[2] });
        if (type === 0x06) events.push({ tick, kind: 'marker', text: data.toString() });
      } else if (st === 0xf0 || st === 0xf7) {
        o += vlq();
      } else {
        status = st;
        const hi = st & 0xf0;
        if (hi === 0xc0 || hi === 0xd0) { const a = buf[o++]; if (hi === 0xc0) events.push({ tick, kind: 'program', value: a }); }
        else {
          const a = buf[o++], b2 = buf[o++];
          if (hi === 0x90 && b2) events.push({ tick, kind: 'on', key: a, vel: b2 });
          else if (hi === 0x80 || hi === 0x90) events.push({ tick, kind: 'off', key: a });
          else if (hi === 0xb0) events.push({ tick, kind: 'cc', cc: a, value: b2 });
          else if (hi === 0xe0) events.push({ tick, kind: 'bend', value: ((b2 << 7) | a) - 8192 });
        }
      }
    }
    tracks.push(events);
  }
  return { division, tracks };
}

let songCfg;
function songConfig(file) {
  if (!songCfg) {
    songCfg = new Map();
    for (const line of text('sound/songs/midi/midi.cfg').split(/\r?\n/)) {
      const m = line.match(/^(\S+\.mid):\s*(.*)$/);
      if (!m) continue;
      const flag = (f) => m[2].match(new RegExp(`-${f}(\\d+)`))?.[1];
      songCfg.set(m[1], { group: `voicegroup${String(flag('G') ?? 0).padStart(3, '0')}`, volume: Number(flag('V') ?? 127), reverb: Number(flag('R') ?? 0) });
    }
  }
  return songCfg.get(file);
}

/**
 * Bake one song ("MUS_PALLET"). Returns the song plus the samples and wave
 * shapes it needs, keyed by symbol so several songs can share them.
 */
export function bakeSong(musConst) {
  const file = `${musConst.toLowerCase()}.mid`;
  const cfg = songConfig(file);
  if (!cfg || !fs.existsSync(path.join(DECOMP_DIR, 'sound/songs/midi', file))) return null;
  const { division, tracks } = parseMidi(read(`sound/songs/midi/${file}`));

  // Tick -> seconds through every tempo change in the file.
  const tempos = tracks.flat().filter((e) => e.kind === 'tempo').sort((a, b) => a.tick - b.tick);
  const seconds = (tick) => {
    let t = 0, last = 0, us = 500000;
    for (const e of tempos) {
      if (e.tick >= tick) break;
      t += ((e.tick - last) / division) * (us / 1e6);
      last = e.tick; us = e.usPerBeat;
    }
    return t + ((tick - last) / division) * (us / 1e6);
  };
  const r3 = (x) => Math.round(x * 1000) / 1000;

  const voices = [], voiceIndex = new Map();
  const samples = {}, waves = {};
  const { sampleFiles, waveFiles } = loadBanks();
  const voiceId = (v) => {
    const key = JSON.stringify(v);
    if (!voiceIndex.has(key)) {
      voiceIndex.set(key, voices.length);
      voices.push(v);
      // The .incbin points at a build output; the source .wav sits beside it.
      if (v.type === 'sample' && !samples[v.sample]) {
        if (!sampleFiles.has(v.sample)) throw new Error(`${musConst}: no sample ${v.sample} in sound/direct_sound_data.inc`);
        samples[v.sample] = readSample(sampleFiles.get(v.sample).replace(/\.bin$/, '.wav'));
      }
      if (v.type === 'wave' && !waves[v.wave]) waves[v.wave] = readWave(waveFiles.get(v.wave));
    }
    return voiceIndex.get(key);
  };

  let loop = null;
  const outTracks = [];
  for (const events of tracks) {
    let program = 0;
    const open = new Map(); // key -> note
    const notes = [], controls = [];
    for (const e of events) {
      const t = r3(seconds(e.tick));
      if (e.kind === 'marker' && (e.text === '[' || e.text === ']')) {
        loop ??= {};
        loop[e.text === '[' ? 'start' : 'end'] = t;
      } else if (e.kind === 'program') program = e.value;
      else if (e.kind === 'on') {
        const r = resolve(cfg.group, program, e.key);
        if (!r) continue;
        const note = [t, t, r.key, e.vel, voiceId(r.voice)];
        notes.push(note);
        open.set(e.key, note);
      } else if (e.kind === 'off') {
        const n = open.get(e.key);
        if (n) { n[1] = t; open.delete(e.key); }
      } else if (e.kind === 'cc' && [1, 7, 10, 20, 21].includes(e.cc)) controls.push([t, `cc${e.cc}`, e.value]);
      else if (e.kind === 'bend') controls.push([t, 'bend', e.value]);
    }
    if (notes.length || controls.length) outTracks.push({ notes, controls });
  }
  const length = r3(Math.max(0, ...outTracks.flatMap((t) => t.notes.map((n) => n[1]))));
  return {
    song: { name: musConst, volume: cfg.volume, reverb: cfg.reverb, length, loop: loop?.start != null && loop?.end ? loop : null, voices, tracks: outTracks },
    samples, waves,
  };
}
