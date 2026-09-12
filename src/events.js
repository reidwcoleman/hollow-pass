import * as THREE from 'three';
import { clamp, lerp, smoothstep, Simplex } from './noise.js';
import { figureMesh } from './props.js';
import { glowSprite } from './textures.js';

const sx = new Simplex(8);
const LINES = [
  'turn around', 'you are not alone in the car', 'don\'t look in the mirror', 'it is behind you now', 'keep driving. do not stop.',
  'eighty-eight point one. the hollow.', 'they walk on the ice at night', 'the tunnel remembers you', 'there is no gas station',
  'we can see your headlights', 'drive faster', 'she is still on the bridge',
];

/**
 * Drives the mood: which section the player is in, the scripted scares, the
 * fog/aurora targets and the audio context (dread, heartbeat, static).
 */
export class Events {
  constructor(world, car, carMesh, audio, hud, fx) {
    this.world = world; this.car = car; this.carMesh = carMesh; this.audio = audio; this.hud = hud; this.fx = fx;
    this.section = null;
    this.fired = new Set();
    this.ctx = { dread: 0.15, heartbeat: 0, whine: 0, radio: 0, inTunnel: false, stalled: false, whiteout: 0 };
    this.targets = { fog: 0.0032, aurora: 0.0 };
    this.flickerT = 0;
    this.deer = { active: false, t: 0 };
    this.lap = 0; this.lastS = 0;
    this.time = 0;
    this.stall = 0; this.stallT = 0;
    this.headlightsWanted = true;
    this.randomT = 40;      // seconds until the next ambient scare
    this.voiceT = 70;
    this.tall = null;
    this.lantern = null;
  }

  _dist(a, b) { const L = this.world.road.length; let d = ((a - b) % L + L) % L; return d > L / 2 ? d - L : d; }

  update(dt) {
    this.time += dt;
    const w = this.world, car = this.car, s = car.roadS, L = w.road.length, N = w.road.count;
    const f = w.terrain.features;
    if (this.lastS > L * 0.9 && s < L * 0.1) { this.lap++; this.fired.clear(); }
    this.lastS = s;

    let cur = null;
    for (const sec of w.sections) { const d = this._dist(s, sec.s); if (d >= 0 && d < sec.span) cur = sec; }
    if (cur !== this.section) { this.section = cur; if (cur) this.hud.toast(cur.name, cur.sub); }
    const kind = cur ? cur.kind : null;
    const sample = w.road.samples[clamp(Math.floor(s / 4), 0, N - 1)];
    const biome = sample.biome;

    let dread = 0.15, fog, aurora, heartbeat = 0, whine = 0, radio = 0;
    const alt = smoothstep(w.roadMinY + 40, w.roadMaxY - 60, car.pos.y);
    fog = lerp(0.0034, 0.0008, alt);
    aurora = smoothstep(0.55, 0.95, alt);
    this.ctx.inTunnel = !!sample.tunnel;
    if (kind === 'bridge') { dread = 0.4; whine = 0.6; }
    if (kind === 'tunnel') { dread = 0.55; fog = 0.0015; }
    if (kind === 'overlook') { dread = 0.05; aurora = 1; }
    if (kind === 'gas') { dread = 0.45; radio = 0.25; }
    if (kind === 'cemetery') { dread = 0.6; }
    if (kind === 'dead') { dread = 0.75; fog = 0.0048; heartbeat = 0.5; radio = 0.15; }
    if (biome === 'forest') { dread = Math.max(dread, 0.5); fog = Math.max(fog, 0.0042); }
    if (biome === 'canyon') { dread = Math.max(dread, 0.45); whine = Math.max(whine, 0.3); }
    if (biome === 'alpine') { whine = Math.max(whine, 0.8); }
    if (biome === 'lake') { dread = Math.max(dread, 0.35); }

    const once = (key, cond, fn) => { if (!this.fired.has(key) && cond) { this.fired.add(key); fn(); } };
    const sting = (p, glitch = p) => { this.audio.sting(p); this.fx && this.fx.setGlitch(glitch); };

    // ---- Mercy Tunnel: the one at the exit ----
    if (f.tunnel && w.tunnel.figure) {
      const exitS = w.road.samples[(f.tunnel.b + 6) % N].s;
      const d = this._dist(exitS, s);
      const fig = w.tunnel.figure;
      if (d > 0 && d < 110 && this.ctx.inTunnel) fig.visible = true;
      once('tunnelFig', d > 0 && d < 16 && fig.visible, () => { fig.visible = false; sting(0.7); this.flicker(0.5); this.hud.pulse(); });
      if (d < 0) fig.visible = false;
      // lights die behind you inside the tunnel, one by one, and something knocks on the roof
      once('tunnelKnock', this.ctx.inTunnel && this._dist(s, w.road.samples[f.tunnel.a % N].s) > 200, () => { this.audio.slap(); setTimeout(() => this.audio.slap(), 420); setTimeout(() => this.audio.slap(), 700); this.fx && this.fx.setGlitch(0.4); });
    }
    // ---- Widow's Bridge: lamps die behind you; someone on the railing ----
    if (f.bridge) {
      for (const fx of w.bridge.fixtures) {
        const n = w.road.nearest(fx.pos.x, fx.pos.z, 30);
        if (n) { const d = this._dist(s, n.s); fx.forceOff = d > 6 && d < 400; }
      }
      once('bridgeGust', kind === 'bridge' && this._dist(s, cur.s) > 60, () => { this.gust = 1.6; sting(0.25, 0.1); });
      const midS = w.road.samples[Math.floor(f.bridge.mid) % N].s;
      const dm = this._dist(midS, s);
      if (!this.fired.has('jumper') && dm > 0 && dm < 160) {
        if (!this.jumper) { this.jumper = figureMesh(); this.jumper.scale.setScalar(0.95); w.scene.add(this.jumper); }
        const p = w.road.at(midS);
        this.jumper.position.set(p.x + p.nx * 5.2, p.y + 1.15, p.z + p.nz * 5.2);
        this.jumper.rotation.y = Math.atan2(p.tx, p.tz) + Math.PI / 2;
        this.jumper.visible = true;
      }
      once('jumper', dm > 0 && dm < 34 && this.jumper && this.jumper.visible, () => {
        sting(0.9); this.hud.pulse();
        const j = this.jumper, t0 = this.time;
        this.fall = { j, t0 };
      });
      if (this.fall) { const t = this.time - this.fall.t0; this.fall.j.position.y -= 9.8 * t * dt; this.fall.j.rotation.x += dt * 2; if (t > 2.5) { this.fall.j.visible = false; this.fall = null; } }
    }
    // ---- Last Chance Gas ----
    if (w.gas) {
      const gp = w.gas.group.position;
      const d = Math.hypot(gp.x - car.pos.x, gp.z - car.pos.z);
      once('gasDie', d < 46, () => { for (const fx of w.gas.fixtures) if (fx.flicker === 'fluorescent' || fx.range === 6) fx.forceOff = true; this.radioBurst = 2.5; sting(0.35, 0.5); });
      once('gasRadio', d < 120, () => { this.radioBurst = 1.2; setTimeout(() => this.audio.say('there is no gas station'), 900); });
    }
    // ---- Hallow Chapel ----
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
          fig.visible = true;
        }
        fig.lookAt(car.pos.x, fig.position.y, car.pos.z);
      }
      once('cemFig', d <= 28 && fig.visible, () => { fig.visible = false; this.flicker(0.4); sting(0.5); });
    }
    // ---- The Burn: deer, the standing one, the engine dies ----
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
      // this one does not step aside: you hit it
      once('burnFig', dfig > -1 && dfig < 3.2 && fig.visible && Math.abs(car.roadDist) < 4, () => { fig.visible = false; this.flicker(0.9); sting(1.0); this.hud.pulse(); this.audio.thud(1); car.speed *= 0.55; this.audio.say('you felt that'); });
      if (dfig < -30 && fig.visible) fig.visible = false;
      once('stall', into > 120 && into < 600 && Math.abs(car.speed) > 4, () => this.startStall(4.5));
    } else if (w.figure2 && w.figure2.visible && !(this.section && this.section.kind === 'cemetery')) w.figure2.visible = false;

    // ---- Devil's Throat: something very tall crosses far ahead ----
    if (biome === 'canyon') {
      once('tall', Math.abs(car.speed) > 5 && !this.tall, () => {
        const p = w.road.at(s + 85);
        const t = figureMesh(); t.scale.set(1.5, 1.7, 1.5); w.scene.add(t);
        this.tall = { m: t, p, t: 0, side: Math.random() > 0.5 ? 1 : -1 };
        this.audio.say('do not stop');
      });
      if (this.tall) {
        const T = this.tall; T.t += dt;
        const lat = T.side * (7 - T.t * 2.2);
        T.m.position.set(T.p.x + T.p.nx * lat, T.p.y + Math.abs(Math.sin(T.t * 4)) * 0.08, T.p.z + T.p.nz * lat);
        T.m.rotation.y = Math.atan2(-T.p.nx * T.side, -T.p.nz * T.side);
        T.m.visible = true;
        heartbeat = Math.max(heartbeat, 0.7);
        if (T.t > 6.4 || Math.hypot(T.m.position.x - car.pos.x, T.m.position.z - car.pos.z) < 12) { T.m.visible = false; w.scene.remove(T.m); this.tall = null; if (T.t <= 6.4) sting(0.8); }
      }
    }
    // ---- Ptarmigan Flats: whiteout ----
    if (biome === 'alpine') {
      once('whiteout', this._dist(s, cur ? cur.s : s) > 150, () => { this.whiteT = 16; this.audio.say('drive faster'); });
    }
    if (this.whiteT > 0) { this.whiteT -= dt; this.ctx.whiteout = lerp(this.ctx.whiteout, this.whiteT > 3 ? 1 : 0, 1 - Math.exp(-dt * 0.9)); fog = Math.max(fog, 0.0035 + this.ctx.whiteout * 0.03); whine = Math.max(whine, this.ctx.whiteout); dread = Math.max(dread, 0.6 * this.ctx.whiteout);
      once('whiteFig', this.whiteT < 2.5, () => { const fig = w.figure2; const p = w.road.at(s + 9); fig.position.set(p.x + p.nx * 3.6, p.y, p.z + p.nz * 3.6); fig.rotation.y = Math.atan2(car.pos.x - fig.position.x, car.pos.z - fig.position.z); fig.visible = true; this.figHide = this.time + 3; sting(0.6); });
    } else this.ctx.whiteout = lerp(this.ctx.whiteout, 0, 1 - Math.exp(-dt * 0.9));
    if (this.figHide && this.time > this.figHide) { w.figure2.visible = false; this.figHide = 0; }
    // ---- Lake Nowhere: a lantern out on the ice that goes out when you stop to look ----
    if (w.lake) {
      if (!this.lantern) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSprite(64, 0, 'rgba(255,190,110,1)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
        sp.scale.set(2.2, 2.2, 1); w.scene.add(sp); this.lantern = { sp, a: 0, on: true };
      }
      const lt = this.lantern, lk = w.lake;
      lt.a += dt * 0.012;
      lt.sp.position.set(lk.x + Math.cos(lt.a) * lk.r * 0.5, lk.y + 1.2, lk.z + Math.sin(lt.a) * lk.r * 0.5);
      const dl = Math.hypot(lt.sp.position.x - car.pos.x, lt.sp.position.z - car.pos.z);
      lt.sp.visible = lt.on && dl < 700 && biome === 'lake';
      if (biome === 'lake' && Math.abs(car.speed) < 0.6) { lt.still = (lt.still || 0) + dt; if (lt.still > 2.5 && lt.on) { lt.on = false; sting(0.4, 0.2); this.audio.say('they walk on the ice at night'); } } else lt.still = 0;
    }

    // ---- ambient scares, spaced out over the drive ----
    this.randomT -= dt;
    if (this.randomT <= 0 && Math.abs(car.speed) > 6 && !this.ctx.inTunnel && kind !== 'bridge') {
      this.randomT = 50 + Math.random() * 70;
      const roll = Math.random();
      if (roll < 0.3 && w.traffic) {
        // the follower: appears behind you, closes in, then is not there
        const v = w.traffic.spawn(Math.random() < 0.5 ? 'sedan' : 'pickup', s - 60, 1, Math.abs(car.speed) + 3, -2.15);
        v.follow = true; v.cur = Math.abs(car.speed) + 3; v.born = this.time;
        this.follower = v;
        setTimeout(() => this.audio.say('it is behind you now'), 6000);
      } else if (roll < 0.6 && w.traffic) {
        // oncoming car whose lights die at forty metres; nothing passes you
        const v = w.traffic.spawn(Math.random() < 0.6 ? 'sedan' : 'pickup', s + 380, -1, 20, 2.15);
        v.vanishAt = 42;
      } else if (roll < 0.8) {
        this.audio.slap(); this.fx && this.fx.setGlitch(0.5); window.__handprint && window.__handprint(); this.hud.pulse();
      } else {
        this.flicker(1.2); this.radioBurst = 3; setTimeout(() => this.audio.say(LINES[Math.floor(Math.random() * LINES.length)]), 600);
      }
    }
    if (this.follower) {
      const v = this.follower;
      const stopped = Math.abs(car.speed) < 1.5;
      if ((this.time - v.born > 45) || (stopped && this.time - v.born > 8)) { v.lightsOn = false; v.dismiss = true; this.follower = null; sting(0.5, 0.3); }
      else dread = Math.max(dread, 0.7);
    }
    this.voiceT -= dt;
    if (this.voiceT <= 0) { this.voiceT = 120 + Math.random() * 120; this.radioBurst = 2.2; setTimeout(() => this.audio.say(LINES[Math.floor(Math.random() * LINES.length)]), 700); }

    // engine stall
    if (this.stall > 0) {
      this.stall -= dt; this.ctx.stalled = true; heartbeat = Math.max(heartbeat, 0.8); dread = Math.max(dread, 0.9);
      if (this.stall <= 0) { this.ctx.stalled = false; this.audio.starter(1.4); setTimeout(() => this.carMesh.setHeadlights(this.headlightsWanted), 1500); }
    }

    // random headlight stutter
    this.flickerT -= dt;
    if (this.flickerT < 0) { this.flickerT = 4 + Math.random() * 14; if (Math.random() < dread * 0.6) this.flicker(0.25 + Math.random() * 0.3); }
    if (this.deer.active) this.updateDeer(dt);
    if (this.gust > 0) { this.gust -= dt; whine = Math.max(whine, 1); }
    if (this.radioBurst > 0) { this.radioBurst -= dt; radio = Math.max(radio, 1); }
    if (this.flickerLeft > 0) {
      this.flickerLeft -= dt;
      const on = sx.noise2(this.time * 40, 2) > -0.2;
      this.carMesh.setHeadlights(on && !this.ctx.stalled);
      if (this.flickerLeft <= 0) this.carMesh.setHeadlights(this.headlightsWanted && !this.ctx.stalled);
    }

    const k = 1 - Math.exp(-dt * 0.8);
    this.ctx.dread = lerp(this.ctx.dread, dread, k);
    this.ctx.heartbeat = lerp(this.ctx.heartbeat, heartbeat, k * 2);
    this.ctx.whine = lerp(this.ctx.whine, whine, k * 2);
    this.ctx.radio = lerp(this.ctx.radio, radio, 1 - Math.exp(-dt * 4));
    this.targets.fog = fog; this.targets.aurora = aurora;
    const scene = this.carMesh.group.parent;
    scene.fog.density = lerp(scene.fog.density, fog, 1 - Math.exp(-dt * 0.5));
    w.sky.uniforms.uAurora.value = lerp(w.sky.uniforms.uAurora.value, aurora, 1 - Math.exp(-dt * 0.4));
    if (w.snow) w.snow.material.uniforms.uIntensity.value = lerp(w.snow.material.uniforms.uIntensity.value, 1 + this.ctx.whiteout * 3.5 + (biome === 'alpine' ? 0.6 : 0), 1 - Math.exp(-dt));
    return this.ctx;
  }

  flicker(sec) { this.flickerLeft = sec; }
  setHeadlightsWanted(v) { this.headlightsWanted = v; }
  onPass(v) { this.audio.whoosh(0.5 + Math.min(0.5, Math.abs(this.car.speed) / 40)); if (Math.abs(this.car.roadDist) < 1.2 && Math.random() < 0.6) this.audio.horn(); }
  onVanish(v) { this.audio.sting(0.6); this.fx && this.fx.setGlitch(0.6); this.hud.pulse(); }
  startStall(sec) {
    this.stall = sec; this.ctx.stalled = true;
    this.carMesh.setHeadlights(false);
    this.audio.thump(0.6);
    this.hud.toast('', '');
    setTimeout(() => this.audio.say('keep driving. do not stop.'), 1800);
  }
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
    const x = 16 - st.t * 11;
    const lat = st.side * x;
    d.position.set(p.x + p.nx * lat, this.world.terrain.heightAt(p.x + p.nx * lat, p.z + p.nz * lat) + Math.abs(Math.sin(st.t * 9)) * 0.35, p.z + p.nz * lat);
    const legs = d.userData.legs;
    for (let i = 0; i < 4; i++) legs[i].rotation.x = Math.sin(st.t * 18 + (i % 2) * Math.PI) * 0.7;
    const carD = d.position.distanceTo(this.car.pos);
    if (!this.hit && carD < 2.6 && Math.abs(this.car.speed) > 3) {
      this.hit = true; this.car.speed *= 0.35; this.audio.sting(1.0); this.audio.thud(1); this.hud.pulse(); this.flicker(0.6); this.fx && this.fx.setGlitch(0.8);
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
