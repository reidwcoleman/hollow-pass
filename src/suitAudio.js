/** Suit sound: thrusters, afterburner, wind, repulsors, impacts, HUD tones. All synthesized. */
export class SuitAudio {
  constructor() { this.started = false; }
  start() {
    if (this.started) return;
    const C = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.started = true;
    const master = this.master = C.createGain(); master.gain.value = 0.8; master.connect(C.destination);
    const noise = () => { const len = C.sampleRate * 2, b = C.createBuffer(1, len, C.sampleRate), d = b.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; const s = C.createBufferSource(); s.buffer = b; s.loop = true; s.start(); return s; };
    this._noise = noise;
    // thruster: band-passed noise + a low tone that rises with thrust
    const tn = noise(); const tf = C.createBiquadFilter(); tf.type = 'bandpass'; tf.frequency.value = 300; tf.Q.value = 0.5;
    const tg = this.thrustGain = C.createGain(); tg.gain.value = 0; tn.connect(tf); tf.connect(tg); tg.connect(master); this.thrustF = tf;
    const to = C.createOscillator(); to.type = 'sawtooth'; to.frequency.value = 60; const tof = C.createBiquadFilter(); tof.type = 'lowpass'; tof.frequency.value = 400;
    const tog = this.toneGain = C.createGain(); tog.gain.value = 0; to.connect(tof); tof.connect(tog); tog.connect(master); to.start(); this.tone = to;
    // afterburner roar
    const bn = noise(); const bf = C.createBiquadFilter(); bf.type = 'lowpass'; bf.frequency.value = 900; const bg = this.boostGain = C.createGain(); bg.gain.value = 0; bn.connect(bf); bf.connect(bg); bg.connect(master);
    // wind
    const wn = noise(); const wf = C.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 800; wf.Q.value = 0.4; const wg = this.windGain = C.createGain(); wg.gain.value = 0; wn.connect(wf); wf.connect(wg); wg.connect(master); this.windF = wf;
    // repulsor charge whine
    const ro = C.createOscillator(); ro.type = 'sine'; ro.frequency.value = 1200; const rg = this.chargeGain = C.createGain(); rg.gain.value = 0; ro.connect(rg); rg.connect(master); ro.start(); this.chargeOsc = ro;
    // reverb for impacts
    const conv = this.conv = C.createConvolver(); const len = C.sampleRate * 1.8, ib = C.createBuffer(2, len, C.sampleRate); for (let ch = 0; ch < 2; ch++) { const d = ib.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5); } conv.buffer = ib; const cg = C.createGain(); cg.gain.value = 0.35; conv.connect(cg); cg.connect(master);
  }
  update(dt, s) {
    if (!this.started) return;
    const C = this.ctx, t = C.currentTime;
    const thr = s.thrustLevel, spd = s.speed, boost = s.boost;
    this.thrustGain.gain.setTargetAtTime(0.05 + thr * 0.35 + (s.grounded ? -0.04 : 0), t, 0.08);
    this.thrustF.frequency.setTargetAtTime(220 + thr * 900 + boost * 600, t, 0.1);
    this.toneGain.gain.setTargetAtTime(0.02 + thr * 0.08, t, 0.08);
    this.tone.frequency.setTargetAtTime(50 + thr * 70 + boost * 60, t, 0.1);
    this.boostGain.gain.setTargetAtTime(boost * 0.5, t, 0.15);
    this.windGain.gain.setTargetAtTime(Math.min(0.5, spd * spd * 0.000012), t, 0.15);
    this.windF.frequency.setTargetAtTime(400 + spd * 6, t, 0.2);
    this.chargeGain.gain.setTargetAtTime(s.charge * 0.05, t, 0.05);
    this.chargeOsc.frequency.setTargetAtTime(900 + s.charge * 1400, t, 0.05);
  }
  fire() {
    if (!this.started) return;
    const C = this.ctx, t = C.currentTime;
    const o = C.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(2400, t); o.frequency.exponentialRampToValueAtTime(180, t + 0.35);
    const g = C.createGain(); g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    const f = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3000;
    o.connect(f); f.connect(g); g.connect(this.master); g.connect(this.conv); o.start(t); o.stop(t + 0.45);
    const n = this._noise(); const nf = C.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 1500; const ng = C.createGain(); ng.gain.setValueAtTime(0.25, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.15); n.connect(nf); nf.connect(ng); ng.connect(this.master); setTimeout(() => n.stop(), 300);
  }
  explode(v = 1) {
    if (!this.started) return;
    const C = this.ctx, t = C.currentTime;
    const n = this._noise(); const f = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(2500, t); f.frequency.exponentialRampToValueAtTime(120, t + 0.8);
    const g = C.createGain(); g.gain.setValueAtTime(0.9 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    n.connect(f); f.connect(g); g.connect(this.master); g.connect(this.conv); setTimeout(() => n.stop(), 1200);
    const o = C.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.6); const og = C.createGain(); og.gain.setValueAtTime(0.6 * v, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.7); o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 0.8);
  }
  thud(v = 0.5) { this.explode(v * 0.4); }
  beep(f = 1400, d = 0.07, v = 0.08) {
    if (!this.started) return;
    const C = this.ctx, t = C.currentTime; const o = C.createOscillator(); o.type = 'sine'; o.frequency.value = f; const g = C.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + d + 0.02);
  }
  chime() { this.beep(1046, 0.12, 0.1); setTimeout(() => this.beep(1568, 0.25, 0.1), 90); }
  bootTone() { [660, 880, 1320].forEach((f, i) => setTimeout(() => this.beep(f, 0.12, 0.08), i * 140)); }
}
