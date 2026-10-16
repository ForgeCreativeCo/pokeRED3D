// A small version of FireRed's sound engine (m4a).
// Notes arrive already resolved to voices by the baker; this plays them with
// the engine's envelopes, loops each song between its [ ] markers, and fades
// between songs when the map's music changes.

import type { MusicFile, Note, Song } from '../data/types';

/** m4a steps envelopes once per video frame */
const FRAME = 1 / 59.73;

interface Track {
  gain: GainNode;
  bend: ConstantSourceNode;
  lfo: OscillatorNode;
  depth: GainNode;
  pan: number;
  range: number;
}

type Event = [number, number, 'note', Note] | [number, number, string, number];

export class Music {
  ctx: AudioContext | null = null;
  out: GainNode | null = null;
  reverbIn: GainNode | null = null;
  player: SongPlayer | null = null;
  current: string | null | undefined = null;
  wanted: string | null = null;
  muted = false;
  buffers: Record<string, AudioBuffer> = {};
  squares: PeriodicWave[] = [];
  waves: Record<string, PeriodicWave> = {};
  noise: AudioBuffer | null = null;

  constructor(readonly data: MusicFile | null) {}

  /** Browsers only allow sound after the viewer interacts, so this runs on the first key or tap. */
  start() {
    if (this.ctx || !this.data) return;
    const ctx = (this.ctx = new AudioContext());
    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    this.out = ctx.createGain();
    this.out.gain.value = this.muted ? 0 : 0.6;
    this.out.connect(comp);
    // A short feedback echo stands in for m4a's reverb on sample voices.
    this.reverbIn = ctx.createGain();
    const delay = ctx.createDelay(1); delay.delayTime.value = 0.09;
    const fb = ctx.createGain(); fb.gain.value = 0.35;
    this.reverbIn.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(this.out);
    // Sample voices: signed 8-bit PCM at each sample's own rate.
    for (const [name, s] of Object.entries(this.data.samples)) {
      const raw = Uint8Array.from(atob(s.data), (c) => c.charCodeAt(0));
      const buf = ctx.createBuffer(1, raw.length, Math.max(3000, s.rate));
      const ch = buf.getChannelData(0);
      for (let i = 0; i < raw.length; i++) ch[i] = ((raw[i] << 24) >> 24) / 128;
      this.buffers[name] = buf;
    }
    // Square waves at the GB's four duty cycles, and the wave channel's shapes.
    const pulse = (duty: number) => {
      const n = 64, re = new Float32Array(n), im = new Float32Array(n);
      for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
      return ctx.createPeriodicWave(re, im);
    };
    this.squares = [0.125, 0.25, 0.5, 0.75].map(pulse);
    for (const [name, w] of Object.entries(this.data.waves)) {
      const n = w.length, re = new Float32Array(n / 2), im = new Float32Array(n / 2);
      for (let k = 1; k < n / 2; k++) for (let i = 0; i < n; i++) {
        re[k] += (w[i] * Math.cos((2 * Math.PI * k * i) / n)) / n;
        im[k] += (w[i] * Math.sin((2 * Math.PI * k * i) / n)) / n;
      }
      this.waves[name] = ctx.createPeriodicWave(re, im);
    }
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    noise.getChannelData(0).forEach((_, i, a) => { a[i] = Math.random() * 2 - 1; });
    this.noise = noise;
    setInterval(() => this.player?.schedule(), 40);
    if (this.wanted) this.play(this.wanted);
  }

  /** Switch to a song (fading out the old one); remembered until sound can start. */
  play(name: string | null | undefined) {
    this.wanted = name ?? null;
    if (!this.ctx || name === this.current) return;
    const old = this.player;
    if (old) old.stop(0.35);
    this.current = name;
    const song = name ? this.data?.songs[name] : undefined;
    this.player = song ? new SongPlayer(this, song, old ? 0.4 : 0.05) : null;
  }

  setMuted(on: boolean) {
    this.muted = on;
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(on ? 0 : 0.6, this.ctx.currentTime, 0.05);
  }
}

class SongPlayer {
  private gain: GainNode;
  private t0: number;
  private events: Event[] = [];
  private loopFrom: number;
  private end: number;
  private i = 0;
  private tracks: Track[];
  private stopped = false;

  constructor(private m: Music, private song: Song, delay: number) {
    const ctx = m.ctx!;
    this.gain = ctx.createGain();
    this.gain.connect(m.out!);
    this.t0 = ctx.currentTime + delay; // context time of song time 0
    // All events of all tracks in time order.
    song.tracks.forEach((t, ti) => {
      for (const n of t.notes) this.events.push([n[0], ti, 'note', n]);
      for (const c of t.controls) this.events.push([c[0], ti, c[1], c[2]]);
    });
    this.events.sort((a, b) => a[0] - b[0] || Number(a[2] === 'note') - Number(b[2] === 'note'));
    this.loopFrom = song.loop ? this.events.findIndex((e) => e[0] >= song.loop!.start) : -1;
    this.end = song.loop ? song.loop.end : song.length;
    this.tracks = song.tracks.map(() => {
      const gain = ctx.createGain();
      gain.gain.value = (100 / 127) * (song.volume / 127);
      gain.connect(this.gain);
      const bend = ctx.createConstantSource(); bend.offset.value = 0; bend.start();
      const lfo = ctx.createOscillator(); lfo.frequency.value = (22 * 59.73) / 256; lfo.start();
      const depth = ctx.createGain(); depth.gain.value = 0; lfo.connect(depth);
      return { gain, bend, lfo, depth, pan: 0, range: 2 };
    });
  }

  schedule() {
    const ctx = this.m.ctx!;
    if (this.stopped) return;
    // Look further ahead when the tab is in the background and timers slow down.
    const horizon = ctx.currentTime + (document.hidden ? 1.5 : 0.25);
    while (this.t0 + (this.events[this.i]?.[0] ?? this.end) < horizon) {
      const e = this.events[this.i];
      if (!e || e[0] >= this.end) {
        if (this.loopFrom < 0) { this.stopped = true; return; }
        this.t0 += this.end - this.song.loop!.start;
        this.i = this.loopFrom;
        continue;
      }
      this.i++;
      const when = Math.max(ctx.currentTime, this.t0 + e[0]), tr = this.tracks[e[1]];
      // Notes that are already late (timers stalled in a background tab) are
      // skipped rather than all played at once; controls still apply.
      if (e[2] === 'note') { if (this.t0 + e[0] > ctx.currentTime - 0.1) this.note(tr, e[3] as Note, when); continue; }
      const v = e[3] as number;
      if (e[2] === 'cc7') tr.gain.gain.setValueAtTime((v / 127) * (this.song.volume / 127), when);
      else if (e[2] === 'cc10') tr.pan = (v - 64) / 64;
      else if (e[2] === 'cc20') tr.range = v;
      else if (e[2] === 'cc1') tr.depth.gain.setValueAtTime(v * 1.5, when);
      else if (e[2] === 'cc21') tr.lfo.frequency.setValueAtTime((v * 59.73) / 256, when);
      else if (e[2] === 'bend') tr.bend.offset.setValueAtTime((v / 8192) * tr.range * 100, when);
    }
  }

  private note(tr: Track, [t0, t1, key, vel, vi]: Note, when: number) {
    const m = this.m, ctx = m.ctx!, v = this.song.voices[vi];
    const off = when + Math.max(0.02, t1 - t0);
    let src: AudioBufferSourceNode | OscillatorNode;
    if (v.type === 'sample') {
      const s = m.data!.samples[v.sample];
      const b = (src = ctx.createBufferSource());
      b.buffer = m.buffers[v.sample];
      if (s.loopStart >= 0) { b.loop = true; b.loopStart = s.loopStart / s.rate; b.loopEnd = s.loopEnd / s.rate; }
      b.playbackRate.value = v.fixed ? 1 : 2 ** ((key - 60) / 12);
    } else if (v.type === 'noise') {
      const b = (src = ctx.createBufferSource());
      b.buffer = m.noise; b.loop = true;
      b.playbackRate.value = Math.min(4, 2 ** ((key - 60) / 12) * 0.5);
    } else {
      const o = (src = ctx.createOscillator());
      o.setPeriodicWave(v.type === 'square' ? m.squares[v.duty] : m.waves[v.wave]);
      o.frequency.value = 440 * 2 ** ((key - 69) / 12);
    }
    tr.bend.connect(src.detune);
    tr.depth.connect(src.detune);
    // Envelope, per m4a: sample voices count 0-255 per frame, GB channels 0-15.
    const e = v.env, env = ctx.createGain(), g = env.gain;
    let peak = vel / 127, attack, sustain, decayTau, releaseTau;
    if (e.cgb) {
      peak *= 0.55;
      attack = e.a * FRAME * 8; sustain = (e.s / 15) * peak;
      decayTau = e.d ? e.d * FRAME * 4 : 0.001; releaseTau = e.r ? e.r * FRAME * 4 : 0.004;
    } else {
      attack = e.a >= 255 ? 0 : (255 / Math.max(1, e.a)) * FRAME; sustain = (e.s / 255) * peak;
      decayTau = e.d ? -FRAME / Math.log(e.d / 256) : 0.001; releaseTau = e.r ? -FRAME / Math.log(e.r / 256) : 0.004;
    }
    g.setValueAtTime(0, when);
    g.linearRampToValueAtTime(peak, when + attack + 0.002);
    g.setTargetAtTime(sustain, when + attack + 0.002, decayTau);
    g.setTargetAtTime(0, off, releaseTau);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, tr.pan + v.pan));
    src.connect(env); env.connect(pan); pan.connect(tr.gain);
    if (v.type === 'sample' && this.song.reverb) {
      const send = ctx.createGain(); send.gain.value = (this.song.reverb / 127) * 0.5;
      pan.connect(send); send.connect(m.reverbIn!);
    }
    src.start(when);
    src.stop(off + releaseTau * 6 + 0.05);
    src.onended = () => { tr.bend.disconnect(src.detune); tr.depth.disconnect(src.detune); pan.disconnect(); };
  }

  stop(fade: number) {
    const now = this.m.ctx!.currentTime;
    this.stopped = true;
    this.gain.gain.setTargetAtTime(0, now, fade / 4);
    setTimeout(() => { this.gain.disconnect(); for (const t of this.tracks) { t.bend.stop(); t.lfo.stop(); } }, fade * 1000 + 200);
  }
}
