/**
 * All sound is synthesized: a layered engine (sub, fundamental, harmonics and
 * intake noise driven by rpm/throttle), wind that rises with speed, tyre roar
 * per surface, a slow dread drone, and one-shot cues for the scares.
 */
const clamp01 = (x) => Math.min(1, Math.max(0, x));
export class GameAudio {
  constructor() { this.ctx = null; this.started = false; }
  start() {
    if (this.started) return;
    const C = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.started = true;
    const master = this.master = C.createGain(); master.gain.value = 0.7; master.connect(C.destination);
    // reverb (for the tunnel)
    const conv = this.conv = C.createConvolver();
    conv.buffer = this._impulse(2.4, 2.2);
    const revGain = this.revGain = C.createGain(); revGain.gain.value = 0.0;
    conv.connect(revGain); revGain.connect(master);
    const dry = this.dry = C.createGain(); dry.gain.value = 1; dry.connect(master); dry.connect(conv);

    // engine
    const eng = this.eng = C.createGain(); eng.gain.value = 0.0; eng.connect(dry);
    const lp = C.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.7; lp.connect(eng);
    this.engLP = lp;
    this.oscs = [];
    for (const [type, mult, gain] of [['sawtooth', 1, 0.35], ['square', 0.5, 0.25], ['sawtooth', 2, 0.12], ['triangle', 3, 0.08], ['sawtooth', 1.5, 0.08]]) {
      const o = C.createOscillator(); o.type = type;
      const g = C.createGain(); g.gain.value = gain;
      o.connect(g); g.connect(lp); o.start();
      this.oscs.push({ o, mult, g });
    }
    // intake / exhaust noise
    const noise = this._noise();
    const nf = C.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 400; nf.Q.value = 1.2;
    const ng = this.intake = C.createGain(); ng.gain.value = 0.0;
    noise.connect(nf); nf.connect(ng); ng.connect(dry);
    this.intakeF = nf;
    // wind
    const wind = this._noise();
    const wf = C.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 400;
    const wg = this.wind = C.createGain(); wg.gain.value = 0.0;
    wind.connect(wf); wf.connect(wg); wg.connect(master);
    this.windF = wf;
    // tyres / snow crunch
    const road = this._noise();
    const rf = C.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 180; rf.Q.value = 0.8;
    const rg = this.tyres = C.createGain(); rg.gain.value = 0;
    road.connect(rf); rf.connect(rg); rg.connect(dry);
    this.tyreF = rf;
    // dread drone: detuned sines, very low
    const dg = this.drone = C.createGain(); dg.gain.value = 0.0; dg.connect(master);
    for (const f of [41.2, 41.9, 61.7, 82.6]) { const o = C.createOscillator(); o.type = 'sine'; o.frequency.value = f; const g = C.createGain(); g.gain.value = 0.25; o.connect(g); g.connect(dg); o.start(); }
    const whine = C.createOscillator(); whine.type = 'sine'; whine.frequency.value = 2200; const wg2 = this.whine = C.createGain(); wg2.gain.value = 0; whine.connect(wg2); wg2.connect(master); whine.start();
    // radio static bed
    const st = this._noise(); const sf = C.createBiquadFilter(); sf.type = 'highpass'; sf.frequency.value = 1500; const sg = this.staticGain = C.createGain(); sg.gain.value = 0; st.connect(sf); sf.connect(sg); sg.connect(master);
    // heartbeat
    this.heart = 0;
  }
  _noise() {
    const C = this.ctx, len = C.sampleRate * 2, b = C.createBuffer(1, len, C.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const s = C.createBufferSource(); s.buffer = b; s.loop = true; s.start(); return s;
  }
  _impulse(sec, decay) {
    const C = this.ctx, len = C.sampleRate * sec, b = C.createBuffer(2, len, C.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return b;
  }
  update(dt, car, ctx) {
    if (!this.started) return;
    const C = this.ctx, t = C.currentTime;
    const rpm = car.rpm, thr = car.throttle, spd = Math.abs(car.speed);
    const base = 28 + rpm * 95;
    for (const { o, mult } of this.oscs) o.frequency.setTargetAtTime(base * mult, t, 0.03);
    this.engLP.frequency.setTargetAtTime(500 + rpm * 1800 + thr * 900, t, 0.05);
    this.eng.gain.setTargetAtTime(ctx.stalled ? 0.0 : 0.10 + rpm * 0.12 + thr * 0.08, t, 0.05);
    this.intake.gain.setTargetAtTime(thr * 0.10 + rpm * 0.02, t, 0.05);
    this.intakeF.frequency.setTargetAtTime(300 + rpm * 900, t, 0.05);
    this.wind.gain.setTargetAtTime(Math.min(0.4, spd * spd * 0.00012) + 0.03, t, 0.1);
    this.windF.frequency.setTargetAtTime(250 + spd * 25, t, 0.1);
    const rough = car.onRoad ? 0.35 : 1.0;
    this.tyres.gain.setTargetAtTime(Math.min(0.5, spd * 0.012) * rough, t, 0.08);
    this.tyreF.frequency.setTargetAtTime(car.onRoad ? 160 + spd * 6 : 90 + spd * 4, t, 0.1);
    this.revGain.gain.setTargetAtTime(ctx.inTunnel ? 0.5 : 0.04, t, 0.4);
    this.drone.gain.setTargetAtTime(ctx.dread * 0.22, t, 1.5);
    this.whine.gain.setTargetAtTime(ctx.whine * 0.02, t, 0.3);
    this.staticGain.gain.setTargetAtTime(ctx.radio * 0.08, t, 0.2);
    if (ctx.heartbeat > 0) {
      this.heart += dt;
      const period = 0.9 - ctx.heartbeat * 0.35;
      if (this.heart > period) { this.heart = 0; this.thump(0.5 * ctx.heartbeat); setTimeout(() => this.thump(0.3 * ctx.heartbeat), 140); }
    }
  }
  thump(v) {
    const C = this.ctx, t = C.currentTime, o = C.createOscillator(), g = C.createGain();
    o.frequency.setValueAtTime(55, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.18);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.25);
  }
  /** Collision thud: low impact + short metallic crunch scaled by strength (0..1). */
  thud(strength = 0.5) {
    if (!this.started) return;
    const C = this.ctx, t = C.currentTime, v = clamp01(strength);
    const o = C.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90 + v * 40, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.25);
    const g = C.createGain(); g.gain.setValueAtTime(0.5 * v + 0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.4);
    const n = this._noise(); const f = C.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800 + v * 1500; f.Q.value = 0.7;
    const ng = C.createGain(); ng.gain.setValueAtTime(0.35 * v, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12 + v * 0.2);
    n.connect(f); f.connect(ng); ng.connect(this.master); setTimeout(() => n.stop(), 600);
  }
  /** Bass hit + metallic ring for a scare. */
  sting(power = 1) {
    if (!this.started) return;
    const C = this.ctx, t = C.currentTime;
    const o = C.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(28, t + 1.2);
    const g = C.createGain(); g.gain.setValueAtTime(0.7 * power, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    const f = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    o.connect(f); f.connect(g); g.connect(this.master); o.start(t); o.stop(t + 1.7);
    for (const fr of [1870, 2450, 3120]) {
      const o2 = C.createOscillator(); o2.type = 'sine'; o2.frequency.value = fr;
      const g2 = C.createGain(); g2.gain.setValueAtTime(0.06 * power, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 2.5);
      o2.connect(g2); g2.connect(this.conv); o2.start(t); o2.stop(t + 2.6);
    }
  }
  /** A single low tolling bell (cemetery). */
  bell() {
    if (!this.started) return;
    const C = this.ctx, t = C.currentTime;
    for (const [fr, v, d] of [[164, 0.25, 4], [329, 0.12, 3], [492, 0.06, 2.2], [659, 0.04, 1.6]]) {
      const o = C.createOscillator(); o.type = 'sine'; o.frequency.value = fr;
      const g = C.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g); g.connect(this.conv); g.connect(this.master); o.start(t); o.stop(t + d + 0.1);
    }
  }
  /** Passing vehicle: filtered noise swell with a falling pitch. */
  whoosh(v = 0.6) {
    if (!this.started) return;
    const C = this.ctx, t = C.currentTime;
    const n = this._noise(); const f = C.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.9;
    f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(220, t + 0.9);
    const g = C.createGain(); g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(0.5 * v, t + 0.25); g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    n.connect(f); f.connect(g); g.connect(this.master); setTimeout(() => n.stop(), 1300);
  }
  /** Starter motor cranking, then the engine catches. */
  starter(sec = 1.6) {
    if (!this.started) return;
    const C = this.ctx, t = C.currentTime;
    for (let i = 0; i < sec * 9; i++) {
      const o = C.createOscillator(); o.type = 'square'; o.frequency.value = 70 + (i % 3) * 8;
      const g = C.createGain(); const st = t + i / 9; g.gain.setValueAtTime(0.09, st); g.gain.exponentialRampToValueAtTime(0.001, st + 0.08);
      o.connect(g); g.connect(this.master); o.start(st); o.stop(st + 0.1);
    }
  }
  /** Something hits the glass. */
  slap() {
    if (!this.started) return;
    const C = this.ctx, t = C.currentTime;
    const n = this._noise(); const f = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
    const g = C.createGain(); g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    n.connect(f); f.connect(g); g.connect(this.master); setTimeout(() => n.stop(), 200);
    this.thump(0.5);
  }
  /** Radio voice through the static: browser speech synthesis, pitched down and slowed. */
  say(text) {
    try {
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.72; u.pitch = 0.15; u.volume = 0.55;
      const voices = speechSynthesis.getVoices();
      const pick = voices.find((v) => /en/i.test(v.lang) && /male|daniel|alex|fred|david|google uk english male/i.test(v.name)) || voices.find((v) => /en/i.test(v.lang));
      if (pick) u.voice = pick;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch (e) { /* no voice, no problem */ }
  }
  horn() {
    if (!this.started) return;
    const C = this.ctx, t = C.currentTime;
    for (const fr of [392, 494]) { const o = C.createOscillator(); o.type = 'square'; o.frequency.value = fr; const g = C.createGain(); g.gain.setValueAtTime(0.08, t); g.gain.setTargetAtTime(0, t + 0.5, 0.05); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.8); }
  }
}
