import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './noise.js';
import { figureMesh, merge } from './props.js';

/**
 * Second wave of scripted horrors. Runs from Events.update every frame with
 * the event system's own state (ev), the mood output object (mood) and dt.
 */
const DIGITS = ['four', 'seven', 'seven', 'one', 'zero', 'three', 'three', 'nine', 'four', 'seven', 'seven', 'one'];

function snowmanMesh() {
  const snow = new THREE.MeshStandardMaterial({ color: 0xe8eef8, roughness: 0.9 });
  const g = new THREE.Group();
  for (const [y, r] of [[0.6, 0.6], [1.45, 0.45], [2.1, 0.32]]) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 12), snow); m.position.y = y; m.castShadow = true; g.add(m); }
  const coal = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x330000, emissiveIntensity: 1.2 });
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), coal); e.position.set(s * 0.11, 2.16, 0.28); g.add(e); }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.25, 6), new THREE.MeshStandardMaterial({ color: 0xd06010 })); nose.rotation.x = Math.PI / 2; nose.position.set(0, 2.08, 0.4); g.add(nose);
  for (const s of [-1, 1]) { const a = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.9, 5), new THREE.MeshStandardMaterial({ color: 0x2a1e12 })); a.position.set(s * 0.6, 1.6, 0); a.rotation.z = s * -1.0; g.add(a); }
  return g;
}

export function initScares2(ev) {
  const w = ev.world;
  ev.s2 = {
    snowman: snowmanMesh(), snowStage: 0, sitter: figureMesh(), wallFigs: null, runner: null, cart: null, boulder: null,
    blinkT: 0, bloodT: 0, breathT: 0, ringing: 0, callT: 0, numbersT: 0, stationT: 200 + Math.random() * 200,
  };
  ev.s2.snowman.visible = false; w.scene.add(ev.s2.snowman);
  ev.s2.sitter.visible = false; ev.s2.sitter.scale.set(1, 0.72, 1); w.scene.add(ev.s2.sitter);
  // wall figures for the second tunnel: a row on each walkway
  if (w.tunnels && w.tunnels[1]) {
    const f = w.terrain.features.tunnels[1], N = w.road.count;
    const g = new THREE.Group();
    for (let i = f.a + 8; i < f.b - 8; i += 6) {
      for (const side of [-1, 1]) {
        const s = w.road.samples[i % N];
        const fig = figureMesh();
        fig.position.set(s.x + s.nx * side * 5.2, s.y + 0.35, s.z + s.nz * side * 5.2);
        fig.rotation.y = Math.atan2(-s.nx * side, -s.nz * side);
        g.add(fig);
      }
    }
    g.visible = false; w.scene.add(g); ev.s2.wallFigs = g;
  }
  // parked car mid second bridge with the hazards on and a door open
  if (w.bridges && w.bridges[1] && w.traffic) {
    const f = w.terrain.features.bridges[1], N = w.road.count;
    const s = w.road.samples[Math.floor(f.mid) % N].s;
    const v = w.traffic.spawn('sedan', s, 1, 0, -1.6);
    v.parked = true; v.lightsOn = false; v.age = -1e9; v.cur = 0; v.speed = 0;
    v.mesh.userData.glares.forEach((sp) => (sp.visible = false));
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 1.0), v.mesh.children[0].material); door.position.set(0.95, 0.75, 0.5); door.rotation.y = 1.0; v.mesh.add(door);
    const haz = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.05), new THREE.MeshStandardMaterial({ color: 0x331a00, emissive: 0xffa020, emissiveIntensity: 5 })); haz.position.set(0.62, 0.7, -2.31); v.mesh.add(haz);
    const haz2 = haz.clone(); haz2.position.x = -0.62; v.mesh.add(haz2);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), new THREE.MeshStandardMaterial({ color: 0xffe0b0, emissive: 0xffd090, emissiveIntensity: 3 })); dome.position.set(0, 1.25, 0); v.mesh.add(dome);
    v.mesh.updateMatrixWorld(true);
    const hp = new THREE.Vector3(); haz.getWorldPosition(hp);
    w.fixtures.push({ pos: hp, color: new THREE.Color(0xffa020), intensity: 40, range: 14, flicker: 'beacon', bulb: haz });
    w.fixtures.push({ pos: hp.clone(), color: new THREE.Color(0xffa020), intensity: 0, range: 1, flicker: 'beacon', bulb: haz2 });
    ev.s2.parked = v;
  }
}

export function updateScares2(ev, dt, mood, biome, kind, cur) {
  const w = ev.world, car = ev.car, s = car.roadS, N = w.road.count, S = ev.s2, audio = ev.audio;
  const once = (key, cond, fn) => { if (!ev.fired.has(key) && cond) { ev.fired.add(key); fn(); } };
  const sting = (p, g = p) => { audio.sting(p); ev.fx && ev.fx.setGlitch(g); };
  const dist = (a, b) => ev._dist(a, b);
  const spd = Math.abs(car.speed);

  // ---- parked vehicles are static (traffic would otherwise drive them) ----
  if (S.parked) { S.parked.cur = 0; S.parked.speed = 0; }

  // ---- wrong-way driver: in your lane, high beams flashing, swerves late ----
  once('wrongway', spd > 8 && ev.time > 90 && biome !== 'canyon' && kind !== 'bridge' && !mood.inTunnel && w.traffic, () => {
    const v = w.traffic.spawn(Math.random() < 0.5 ? 'sedan' : 'pickup', s + 320, -1, 24, -2.15);
    v.wrongWay = true; S.wrong = v; audio.say('you are on the wrong side');
  });
  if (S.wrong && S.wrong.alive) {
    const v = S.wrong, d = Math.hypot(v.x - car.pos.x, v.z - car.pos.z);
    v.lightsOn = Math.floor(ev.time * 6) % 2 === 0 || d < 60; // flashing high beams
    if (d < 34 && !v.swerved) { v.swerved = true; if (car.lateralOnRoad < -0.6) { v.lateral = 2.15; audio.horn(); } }
    if (v.swerved) v.lateral = lerp(v.lateral, v.lateral > 0 ? 2.15 : -2.15, 1 - Math.exp(-dt * 2.5));
    if (d > 400) S.wrong = null;
  } else S.wrong = null;

  // ---- second tunnel: blackout and the ones on the walkways ----
  if (w.tunnels && w.tunnels[1] && S.wallFigs) {
    const f = w.terrain.features.tunnels[1];
    const a = w.road.samples[f.a % N].s, b = w.road.samples[f.b % N].s;
    const inside = dist(s, a) > 0 && dist(b, s) > 0;
    const deep = inside && dist(s, a) > 60 && dist(b, s) > 40;
    for (const fx of w.tunnels[1].fixtures) fx.forceOff = deep;
    S.wallFigs.visible = deep;
    once('bore', deep, () => { sting(0.6, 0.3); audio.say('the tunnel remembers you'); });
    if (deep) { mood.heartbeat = Math.max(mood.heartbeat, 0.8); mood.dread = Math.max(mood.dread, 0.95); }
    once('boreOut', ev.fired.has('bore') && !inside, () => { sting(0.9); ev.flicker(0.8); ev.hud.pulse(); });
  }

  // ---- snowman: closer every time you look ----
  {
    const stages = [[220, 9], [120, 6], [40, 3.4], [16, -1.2]];
    const anchor = w.sections.find((x) => x.kind === 'village');
    if (anchor) {
      const base = anchor.s - 400;
      if (S.snowStage < stages.length) {
        const [ahead, lat] = stages[S.snowStage];
        const p = w.road.at(base + ahead);
        const sm = S.snowman;
        const d = dist(base + ahead, s);
        if (d > 0 && d < 260 && !sm.visible) { sm.position.set(p.x + p.nx * lat, w.groundAt(p.x + p.nx * lat, p.z + p.nz * lat), p.z + p.nz * lat); sm.rotation.y = Math.atan2(p.tx, p.tz) + Math.PI; sm.visible = true; }
        if (d < 12 && sm.visible) { sm.visible = false; S.snowStage++; if (S.snowStage === stages.length) { sting(0.7); audio.thud(0.8); car.speed *= 0.6; ev.hud.toast('', 'it was in the road'); } else if (S.snowStage === 3) audio.say('he is coming with you'); }
      }
    }
  }

  // ---- blink: the world goes black for a breath, and something is standing right there ----
  if (S.blinkT > 0) {
    S.blinkT -= dt;
    if (S.blinkT < 1.3 && S.blinkT > 1.0) { const f = w.figure2; if (!f.visible) { const fx = Math.sin(car.heading), fz = Math.cos(car.heading); f.position.set(car.pos.x + fx * 7, w.groundAt(car.pos.x + fx * 7, car.pos.z + fz * 7), car.pos.z + fz * 7); f.rotation.y = car.heading + Math.PI; f.visible = true; ev.figHide = ev.time + 1.4; } }
    document.getElementById('blink').style.opacity = S.blinkT > 1.3 ? 1 : 0;
  }
  once('blink1', ev.time > 240 && spd > 6 && mood.dread > 0.5, () => { S.blinkT = 1.7; setTimeout(() => sting(1.0), 1400); });
  if (ev.time > 700 && spd > 6 && Math.random() < dt / 260 && S.blinkT <= 0) { S.blinkT = 1.7; setTimeout(() => sting(0.9), 1400); }

  // ---- fallen tree: someone is sitting on it ----
  if (w.fallen) {
    const fp = w.fallen.group.position, d = Math.hypot(fp.x - car.pos.x, fp.z - car.pos.z);
    const st = S.sitter;
    if (!ev.fired.has('sitter') && d < 150 && d > 22) { if (!st.visible) { st.position.copy(fp).add(new THREE.Vector3(0, 0.75, 0)); st.visible = true; } st.lookAt(car.pos.x, st.position.y, car.pos.z); }
    once('sitter', d <= 22 && st.visible, () => { st.visible = false; sting(0.6); ev.flicker(0.4); });
    once('treeRadio', d < 90, () => { ev.radioBurst = 2; setTimeout(() => audio.say('the road is closed'), 800); });
  }

  // ---- blood moon on the Spine ----
  if (kind === 'ridge') once('blood', dist(s, cur.s) > 60, () => { S.bloodT = 45; sting(0.3, 0.6); audio.say('look up'); });
  if (S.bloodT > 0) {
    S.bloodT -= dt;
    const k = smoothstep(0, 4, S.bloodT) * smoothstep(45, 41, S.bloodT);
    w.sky.uniforms.uMoonCol.value.setRGB(lerp(0.87, 0.9, k), lerp(0.9, 0.12, k), lerp(1.0, 0.06, k));
    w.moon.color.setRGB(lerp(0.67, 0.9, k), lerp(0.74, 0.18, k), lerp(0.91, 0.1, k));
    w.moon.intensity = lerp(1.35, 1.0, k);
    mood.dread = Math.max(mood.dread, 0.8 * k);
    if (S.bloodT <= 0) { w.sky.uniforms.uMoonCol.value.setRGB(0.87, 0.9, 1.0); w.moon.color.setRGB(0.67, 0.74, 0.91); w.moon.intensity = 1.35; }
  }

  // ---- the phone box rings as you pass; the call comes through the radio ----
  if (w.village && w.village.group.userData.phonePos) {
    const pp = w.village.group.userData.phonePos, d = Math.hypot(pp.x - car.pos.x, pp.z - car.pos.z);
    if (d < 60 && !ev.fired.has('phone')) { if (!S.ringing) { S.ringing = 1; audio.ring(true); } }
    once('phone', d < 12, () => { audio.ring(false); S.ringing = 0; ev.radioBurst = 3; ev.hud.toast('INCOMING CALL', 'unknown · no signal'); setTimeout(() => audio.say('we can see your headlights'), 1500); });
    if (S.ringing && d > 80) { audio.ring(false); S.ringing = 0; }
  }

  // ---- 03:33: everything flickers, the church bell tolls ----
  const hh = Math.floor(ev.hud.minutes / 60) % 24, mm = Math.floor(ev.hud.minutes % 60);
  once('threeThirtyThree', hh === 3 && mm === 33, () => { ev.flicker(2.2); for (const f of w.fixtures) f.forceOff = true; setTimeout(() => { for (const f of w.fixtures) if (f.flicker !== 'dead') f.forceOff = false; }, 2600); audio.bell(); setTimeout(() => audio.bell(), 1500); setTimeout(() => audio.bell(), 3000); sting(0.5, 0.5); ev.hud.toast('03:33', ''); });

  // ---- the follower rams ----
  if (ev.follower && !ev.follower.rammed && ev.time - ev.follower.born > 22 && spd > 8) {
    const v = ev.follower; v.follow = false; v.speed = spd + 9; v.cur = spd + 9; v.rammed = true; v.lateral = car.lateralOnRoad;
    setTimeout(() => { if (v.alive) { v.lightsOn = false; v.dismiss = true; v.follow = true; } ev.follower = null; sting(0.8); }, 3500);
  }

  // ---- the runner: it comes at the car ----
  once('runner', ev.time > 400 && spd > 8 && (biome === 'forest' || biome === 'open') && !mood.inTunnel, () => {
    const fig = figureMesh(); fig.scale.set(1, 1.05, 1); w.scene.add(fig); S.runner = { m: fig, s0: s + 90, t: 0 };
  });
  if (ev.time > 900 && spd > 8 && !S.runner && Math.random() < dt / 420 && !mood.inTunnel) { const fig = figureMesh(); w.scene.add(fig); S.runner = { m: fig, s0: s + 90, t: 0 }; }
  if (S.runner) {
    const R = S.runner; R.t += dt;
    const rs = R.s0 - R.t * 9.5;
    const p = w.road.at(rs);
    const lat = car.lateralOnRoad;
    R.m.position.set(p.x + p.nx * lat, p.y + Math.abs(Math.sin(R.t * 11)) * 0.12, p.z + p.nz * lat);
    R.m.rotation.y = Math.atan2(car.pos.x - R.m.position.x, car.pos.z - R.m.position.z);
    R.m.rotation.x = Math.sin(R.t * 22) * 0.15;
    mood.heartbeat = Math.max(mood.heartbeat, 0.9);
    const d = R.m.position.distanceTo(car.pos);
    if (d < 2.4 || dist(s, rs) > 4) { w.scene.remove(R.m); S.runner = null; sting(1.0); audio.slap(); ev.hud.pulse(); ev.flicker(0.7); window.__handprint && window.__handprint(); }
    if (R.t > 25) { w.scene.remove(R.m); S.runner = null; }
  }

  // ---- stopped in the dark too long: breathing, then the glass ----
  if (spd < 0.5 && !mood.inTunnel) { S.breathT += dt; } else S.breathT = 0;
  mood.breath = smoothstep(9, 16, S.breathT);
  once('breathSlap', S.breathT > 22, () => { audio.slap(); window.__handprint && window.__handprint(); sting(0.7); });
  if (S.breathT > 30 && Math.random() < dt / 8) { audio.slap(); S.breathT = 22; }
  if (S.breathT < 1) ev.fired.delete('breathSlap');

  // ---- the numbers station ----
  S.stationT -= dt;
  if (S.stationT <= 0) { S.stationT = 260 + Math.random() * 200; ev.radioBurst = 6; let i = 0; const tick = () => { if (i < DIGITS.length) { audio.say(DIGITS[i++]); setTimeout(tick, 900); } }; setTimeout(tick, 900); }

  // ---- the mine: lamp dies, the ore cart rolls out onto the road ----
  if (w.mine) {
    const mp = w.mine.group.position, d = Math.hypot(mp.x - car.pos.x, mp.z - car.pos.z);
    once('mineCart', d < 70 && !S.cart, () => {
      for (const f of w.mine.fixtures) f.forceOff = true;
      const cart = w.mine.group.children.find((c) => c.geometry && c.geometry.type === 'BoxGeometry' && c.position.z < -3);
      S.cart = { m: cart, t: 0 }; audio.rumble(1.2);
    });
    if (S.cart) { S.cart.t += dt; S.cart.m.position.z = -3.5 - S.cart.t * 4.2; if (S.cart.t > 3.2) { S.cart = null; } }
  }
  // ---- avalanche zone: the mountain moves ----
  if (w.avalanche) {
    const sec = w.road.samples[w.avalancheI % N].s;
    once('rumble', dist(sec, s) > 0 && dist(sec, s) < 120, () => { audio.rumble(3.5); ev.hitShakeExt = 1.2; sting(0.2, 0.4); ev.hud.toast('', 'the mountain is moving'); });
  }
  // ---- convoy: the hazards wake up one by one ----
  if (w.convoy) {
    const cs = w.road.samples[w.convoyI % N].s, d = dist(cs, s);
    once('convoy', d > 0 && d < 60, () => {
      const cars = w.convoy.group.children;
      cars.forEach((v, i) => setTimeout(() => { v.userData.lampMat.emissiveIntensity = 12; setTimeout(() => (v.userData.lampMat.emissiveIntensity = 0.05), 900); }, i * 350));
      setTimeout(() => audio.say('they never left'), 2000);
    });
  }
  // ---- ice: it cracks ----
  if (car.mu < 0.3 && spd > 3) { once('crack', true, () => { audio.crack(); ev.fx && ev.fx.setGlitch(0.4); ev.hud.toast('', 'thin ice'); }); mood.whine = Math.max(mood.whine, 0.5); }
}
