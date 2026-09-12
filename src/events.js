import * as THREE from 'three';
import { clamp, lerp, smoothstep, Simplex } from './noise.js';

const sx = new Simplex(8);

/**
 * Drives the mood: which section the player is in, the scripted scares, the
 * fog/aurora targets and the audio context (dread, heartbeat, static).
 */
export class Events {
  constructor(world, car, carMesh, audio, hud) {
    this.world = world; this.car = car; this.carMesh = carMesh; this.audio = audio; this.hud = hud;
    this.section = null;
    this.fired = new Set();
    this.ctx = { dread: 0.15, heartbeat: 0, whine: 0, radio: 0, inTunnel: false };
    this.targets = { fog: 0.0032, aurora: 0.0, exposure: 1.15 };
    this.flickerT = 0;
    this.deer = { active: false, t: 0 };
    this.lap = 0; this.lastS = 0;
    this.time = 0;
    this.notes = [];
  }

  _dist(a, b) { const L = this.world.road.length; let d = ((a - b) % L + L) % L; return d > L / 2 ? d - L : d; } // signed: + means a is ahead of b

  update(dt) {
    this.time += dt;
    const w = this.world, car = this.car, s = car.roadS, L = w.road.length;
    const N = w.road.count;
    const f = w.terrain.features;
    // lap detection
    if (this.lastS > L * 0.9 && s < L * 0.1) { this.lap++; this.fired.clear(); }
    this.lastS = s;

    // sections
    let cur = null;
    for (const sec of w.sections) { const d = this._dist(s, sec.s); if (d >= 0 && d < sec.span) cur = sec; }
    if (cur !== this.section) {
      this.section = cur;
      if (cur) this.hud.toast(cur.name, cur.sub);
    }
    const kind = cur ? cur.kind : null;

    // mood targets
    let dread = 0.15, fog = 0.0032, aurora = 0.0, heartbeat = 0, whine = 0, radio = 0;
    const sample = w.road.samples[clamp(Math.floor(s / 4), 0, N - 1)];
    const alt = smoothstep(w.roadMinY + 40, w.roadMaxY - 60, car.pos.y);
    fog = lerp(0.0034, 0.0008, alt);           // thinner up high → the views open up
    aurora = smoothstep(0.55, 0.95, alt) * 1.0;
    this.ctx.inTunnel = !!sample.tunnel;
    if (kind === 'bridge') { dread = 0.4; whine = 0.6; }
    if (kind === 'tunnel') { dread = 0.55; fog = 0.0015; }
    if (kind === 'overlook') { dread = 0.05; aurora = 1; }
    if (kind === 'gas') { dread = 0.45; radio = 0.25; }
    if (kind === 'cemetery') { dread = 0.6; }
    if (kind === 'dead') { dread = 0.75; fog = 0.0048; heartbeat = 0.5; radio = 0.15; }

    // ---- scripted scares ----
    const once = (key, cond, fn) => { if (!this.fired.has(key) && cond) { this.fired.add(key); fn(); } };

    // Tunnel: the figure at the exit
    if (f.tunnel && w.tunnel.figure) {
      const exitS = w.road.samples[(f.tunnel.b + 6) % N].s;
      const d = this._dist(exitS, s); // + = exit ahead
      const fig = w.tunnel.figure;
      if (d > 0 && d < 110 && this.ctx.inTunnel) { fig.visible = true; }
      once('tunnelFig', d > 0 && d < 16 && fig.visible, () => { fig.visible = false; this.audio.sting(0.7); this.flicker(0.5); this.hud.pulse(); });
      if (d < 0) fig.visible = false;
    }
    // Bridge: lamps die behind you, one by one
    if (f.bridge) {
      for (const fx of w.bridge.fixtures) {
        const n = w.road.nearest(fx.pos.x, fx.pos.z, 30);
        if (n) { const d = this._dist(s, n.s); fx.forceOff = d > 6 && d < 400 && this.lap >= 0; }
      }
      once('bridgeGust', kind === 'bridge' && this._dist(s, cur.s) > 60, () => { this.gust = 1.6; this.audio.sting(0.25); });
    }
    // Gas station: the wreck's dome light and the last tube die when you get close; radio burst
    if (w.gas) {
      const gp = w.gas.group.position;
      const d = Math.hypot(gp.x - car.pos.x, gp.z - car.pos.z);
      once('gasDie', d < 46, () => {
        for (const fx of w.gas.fixtures) if (fx.flicker === 'fluorescent' || fx.range === 6) fx.forceOff = true;
        this.radioBurst = 2.5; this.audio.sting(0.35);
      });
      once('gasRadio', d < 120, () => { this.radioBurst = 1.2; });
    }
    // Cemetery: bell, a figure among the stones that isn't there when you look again
    if (w.cemetery) {
      const cp = w.cemetery.group.position;
      const d = Math.hypot(cp.x - car.pos.x, cp.z - car.pos.z);
      once('bell', d < 140, () => this.audio.bell());
      once('bell2', d < 70, () => setTimeout(() => this.audio.bell(), 1800));
      const fig = w.figure2;
      if (!this.fired.has('cemFig') && d < 120 && d > 28) {
        if (!fig.visible) {
          fig.position.copy(cp).add(new THREE.Vector3(Math.cos(w.cemetery.group.rotation.y) * 4, 0, -Math.sin(w.cemetery.group.rotation.y) * 4));
          fig.position.y = w.terrain.heightAt(fig.position.x, fig.position.z);
          fig.lookAt(car.pos.x, fig.position.y, car.pos.z);
          fig.visible = true;
        } else fig.lookAt(car.pos.x, fig.position.y, car.pos.z);
      }
      once('cemFig', d <= 28 && fig.visible, () => { fig.visible = false; this.flicker(0.4); this.audio.sting(0.5); });
    }
    // The Burn: deer crossing + a second figure that stands in the road, then is simply gone
    if (kind === 'dead') {
      const into = this._dist(s, cur.s);
      once('deer', into > 260 && Math.abs(car.speed) > 6, () => this.startDeer());
      const figS = cur.s + 520;
      const dfig = this._dist(figS, s);
      const fig = w.figure2;
      if (!this.fired.has('burnFig') && dfig > 0 && dfig < 140) {
        if (!fig.visible) { const p = w.road.at(figS); fig.position.set(p.x + p.nx * -1.5, p.y, p.z + p.nz * -1.5); fig.rotation.set(0, Math.atan2(p.tx, p.tz) + Math.PI, 0); fig.visible = true; }
        heartbeat = 0.9; dread = 0.95;
      }
      once('burnFig', dfig > 0 && dfig < 22 && fig.visible, () => { fig.visible = false; this.flicker(0.9); this.audio.sting(1.0); this.hud.pulse(); });
      if (dfig < 0 && dfig > -30 && fig.visible) fig.visible = false;
    } else if (w.figure2 && w.figure2.visible && !(w.cemetery && this.section && this.section.kind === 'cemetery')) w.figure2.visible = false;

    // random headlight stutter when dread is high
    this.flickerT -= dt;
    if (this.flickerT < 0) { this.flickerT = 4 + Math.random() * 14; if (Math.random() < dread * 0.6) this.flicker(0.25 + Math.random() * 0.3); }

    // deer animation
    if (this.deer.active) this.updateDeer(dt);
    // gust
    if (this.gust > 0) { this.gust -= dt; whine = Math.max(whine, 1); }
    if (this.radioBurst > 0) { this.radioBurst -= dt; radio = Math.max(radio, 1); }

    // headlight flicker application
    if (this.flickerLeft > 0) {
      this.flickerLeft -= dt;
      const on = sx.noise2(this.time * 40, 2) > -0.2;
      this.carMesh.setHeadlights(on);
      if (this.flickerLeft <= 0) this.carMesh.setHeadlights(this.headlightsWanted);
    }

    // smooth mood
    const k = 1 - Math.exp(-dt * 0.8);
    this.ctx.dread = lerp(this.ctx.dread, dread, k);
    this.ctx.heartbeat = lerp(this.ctx.heartbeat, heartbeat, k * 2);
    this.ctx.whine = lerp(this.ctx.whine, whine, k * 2);
    this.ctx.radio = lerp(this.ctx.radio, radio, 1 - Math.exp(-dt * 4));
    this.targets.fog = fog; this.targets.aurora = aurora;
    const scene = this.carMesh.group.parent;
    scene.fog.density = lerp(scene.fog.density, fog, 1 - Math.exp(-dt * 0.5));
    w.sky.uniforms.uAurora.value = lerp(w.sky.uniforms.uAurora.value, aurora, 1 - Math.exp(-dt * 0.4));
    return this.ctx;
  }

  flicker(sec) { this.flickerLeft = sec; }
  setHeadlightsWanted(v) { this.headlightsWanted = v; }

  startDeer() {
    const w = this.world, car = this.car;
    const s = car.roadS + 55;
    const p = w.road.at(s);
    const side = Math.random() > 0.5 ? 1 : -1;
    this.deer = { active: true, t: 0, p, side, s };
    const d = w.deer;
    d.visible = true;
    d.position.set(p.x + p.nx * side * 16, p.y, p.z + p.nz * side * 16);
    d.rotation.y = Math.atan2(-p.nx * side, -p.nz * side);
    this.hit = false;
  }
  updateDeer(dt) {
    const st = this.deer, d = this.world.deer, p = st.p;
    st.t += dt;
    const x = 16 - st.t * 11; // from +16 to -16 across 2.9 s
    const lat = st.side * x;
    d.position.set(p.x + p.nx * lat, this.world.terrain.heightAt(p.x + p.nx * lat, p.z + p.nz * lat) + Math.abs(Math.sin(st.t * 9)) * 0.35, p.z + p.nz * lat);
    const legs = d.userData.legs;
    for (let i = 0; i < 4; i++) legs[i].rotation.x = Math.sin(st.t * 18 + (i % 2) * Math.PI) * 0.7;
    const carD = d.position.distanceTo(this.car.pos);
    if (!this.hit && carD < 2.6 && Math.abs(this.car.speed) > 3) {
      this.hit = true; this.car.speed *= 0.35; this.audio.sting(1.0); this.hud.pulse(); this.flicker(0.6);
      this.hud.toast('…', 'you hit something');
    }
    if (x < -18) { st.active = false; d.visible = false; }
  }
}

/** Minimal HUD binding. */
export class HUD {
  constructor() {
    this.speed = document.getElementById('speed');
    this.gear = document.getElementById('gear');
    this.loc = document.getElementById('loc');
    this.locName = document.getElementById('locName');
    this.locSub = document.getElementById('locSub');
    this.alt = document.getElementById('alt');
    this.temp = document.getElementById('temp');
    this.radio = document.getElementById('radio');
    this.flash = document.getElementById('flash');
    this.clock = document.getElementById('clock');
    this.timer = 0; this.t = 0; this.minutes = 2 * 60 + 47;
  }
  toast(name, sub) {
    this.locName.textContent = name; this.locSub.textContent = sub || '';
    this.loc.classList.remove('show'); void this.loc.offsetWidth; this.loc.classList.add('show');
  }
  pulse() { this.flash.classList.remove('on'); void this.flash.offsetWidth; this.flash.classList.add('on'); }
  update(dt, car, ctx) {
    this.t += dt;
    const kmh = Math.abs(car.speed) * 3.6;
    this.speed.textContent = Math.round(kmh).toString();
    this.gear.textContent = car.speed < -0.3 ? 'R' : Math.abs(car.speed) < 0.3 ? 'N' : String(car.gear);
    if ((this.t | 0) % 2 === 0) {
      this.alt.textContent = `${Math.round(car.pos.y)} m`;
      const temp = -9 - (car.pos.y - 300) / 90 + Math.sin(this.t * 0.1) * 0.4;
      this.temp.textContent = `${temp.toFixed(1)}°C`;
    }
    this.minutes += dt / 60 * 4; // night passes a little fast
    const h = Math.floor(this.minutes / 60) % 24, m = Math.floor(this.minutes % 60);
    this.clock.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    if (ctx.radio > 0.5) this.radio.textContent = '88.1 FM   ▮▮▮▮▮▮▮▮   signal lost';
    else if (ctx.radio > 0.2) this.radio.textContent = '88.1 FM   ▮▮▯▯▯▯▯▯   —';
    else this.radio.textContent = '88.1 FM   ▮▯▯▯▯▯▯▯   no signal';
  }
}
