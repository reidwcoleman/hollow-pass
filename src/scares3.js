import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './noise.js';
import { figureMesh } from './props.js';
import { signTexture } from './textures.js';

/**
 * Third wave: the mirror, the passenger, the hanged one, scarecrows, the
 * pack, the wreck in the gorge, signs that change, the music box, whispers.
 */
export function initScares3(ev) {
  const w = ev.world, S = ev.s3 = {};
  // back-seat passenger: a head and shoulders that only the mirror can see
  const mat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 });
  const pg = new THREE.Group();
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), mat); head.position.y = 0.42; pg.add(head);
  const sh = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.25, 4, 10), mat); sh.position.y = 0.1; pg.add(sh);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xd8e8ff });
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 6), eyeMat); e.position.set(s * 0.045, 0.44, -0.12); pg.add(e); }
  pg.traverse((o) => o.layers.set(3));
  pg.position.set(0.42, 1.25, -1.35); // rear seat, behind the driver, facing the mirror
  pg.rotation.y = Math.PI;
  pg.visible = false;
  ev.carMesh.body.add(pg);
  S.passenger = pg;
  // hanged figure in the burn: swings from a dead branch
  const h = figureMesh(); h.visible = false; w.scene.add(h); S.hanged = h;
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 3.2, 5), new THREE.MeshStandardMaterial({ color: 0x5a4a30 })); rope.position.y = 3.6; h.add(rope);
  {
    const sec = w.sections.find((x) => x.kind === 'dead');
    if (sec) { const p = w.road.at(sec.s + 300); const lat = 6.5; h.position.set(p.x + p.nx * lat, w.terrain.heightAt(p.x + p.nx * lat, p.z + p.nz * lat) + 1.2, p.z + p.nz * lat); S.hangedS = sec.s + 300; }
  }
  // scarecrows in the village fields that turn to watch
  S.crows = [];
  const vsec = w.sections.find((x) => x.kind === 'village');
  if (vsec) {
    for (let i = 0; i < 5; i++) {
      const p = w.road.at(vsec.s + 60 + i * 55);
      const lat = (i % 2 ? 1 : -1) * (16 + (i * 7) % 12);
      const c = figureMesh(); c.scale.set(1.15, 1.1, 1.15);
      const cross = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.08), new THREE.MeshStandardMaterial({ color: 0x4a3a28 })); cross.position.y = 1.55; c.add(cross);
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.4, 0.08), cross.material); pole.position.y = 1.0; c.add(pole);
      c.position.set(p.x + p.nx * lat, w.terrain.heightAt(p.x + p.nx * lat, p.z + p.nz * lat) + 0.25, p.z + p.nz * lat);
      c.rotation.y = Math.random() * 6.28;
      w.scene.add(c); S.crows.push(c);
    }
  }
  // wrecked car in the gorge under the first bridge, one lamp still on
  if (w.terrain.features.bridges[0] && w.traffic) {
    const f = w.terrain.features.bridges[0], N = w.road.count;
    const sm = w.road.samples[Math.floor(f.mid) % N];
    const x = sm.x + sm.nx * 22, z = sm.z + sm.nz * 22;
    const y = w.terrain.heightAt(x, z);
    const v = w.traffic.spawn('sedan', sm.s, 1, 0, 0);
    v.parked = true; v.lightsOn = false; v.age = -1e9; v.cur = 0; v.speed = 0; v.ghost = true;
    v.mesh.position.set(x, y + 0.3, z); v.mesh.rotation.set(0.9, 1.2, 2.6);
    v.mesh.userData.glares.forEach((sp) => (sp.visible = false));
    v.mesh.userData.lampMat = v.mesh.userData.lampMat.clone();
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0d0, emissiveIntensity: 8 })); lamp.position.set(0.6, 0.7, 2.3); v.mesh.add(lamp);
    v.mesh.updateMatrixWorld(true);
    const lp = new THREE.Vector3(); lamp.getWorldPosition(lp);
    w.fixtures.push({ pos: lp, color: new THREE.Color(0xfff0d0), intensity: 120, range: 30, flicker: 'strobe', bulb: lamp });
    S.wreck = v; S.wreckPlace = { x, y: y + 0.3, z };
  }
  // the pack: pairs of eyes that run alongside the car through the forest
  S.pack = [];
  const eyeM = new THREE.MeshBasicMaterial({ color: 0xffe9a0, fog: false });
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), eyeM); e.position.x = s * 0.06; g.add(e); }
    g.visible = false; w.scene.add(g); S.pack.push(g);
  }
  S.packT = -1;
  S.musicT = 150 + Math.random() * 150;
  S.whisperT = 90;
  S.signsSwapped = false;
}

export function updateScares3(ev, dt, mood, biome, kind, cur) {
  const w = ev.world, car = ev.car, s = car.roadS, S = ev.s3, audio = ev.audio, N = w.road.count;
  const once = (key, cond, fn) => { if (!ev.fired.has(key) && cond) { ev.fired.add(key); fn(); } };
  const sting = (p, g = p) => { audio.sting(p); ev.fx && ev.fx.setGlitch(g); };
  const spd = Math.abs(car.speed);
  const dist = (a, b) => ev._dist(a, b);

  // ---- the passenger: appears in the mirror for a few seconds; a whisper; gone ----
  if (!S.passT && ev.time > 150 && spd > 5 && Math.random() < dt / 170) {
    S.passT = ev.time; S.passenger.visible = true;
    setTimeout(() => audio.say('do not look in the mirror'), 800);
    if (window.__mirror) window.__mirror.dim = 0.85;
  }
  if (S.passT) {
    const t = ev.time - S.passT;
    S.passenger.rotation.y = Math.PI + Math.sin(t * 0.7) * 0.15;
    S.passenger.position.y = 1.25 + Math.sin(t * 1.1) * 0.02;
    mood.dread = Math.max(mood.dread, 0.9); mood.heartbeat = Math.max(mood.heartbeat, 0.7);
    if (t > 6.5) { S.passenger.visible = false; S.passT = 0; sting(0.7, 0.9); audio.slap(); if (window.__mirror) window.__mirror.dim = 1.0; }
  }
  // ---- something standing in the road behind you (mirror only), gone when you stop ----
  if (!S.behindT && ev.time > 320 && spd > 8 && Math.random() < dt / 200) {
    S.behindT = ev.time; const f = ev.world.figure2; const p = w.road.at(s - 14);
    f.position.set(p.x + p.nx * car.lateralOnRoad, p.y, p.z + p.nz * car.lateralOnRoad); f.rotation.y = car.heading; f.visible = true; f.userData.follow = true;
  }
  if (S.behindT) {
    const f = ev.world.figure2; const p = w.road.at(s - 14);
    f.position.set(p.x + p.nx * car.lateralOnRoad, p.y, p.z + p.nz * car.lateralOnRoad); f.rotation.y = car.heading; f.visible = true;
    const t = ev.time - S.behindT;
    if (t > 9 || spd < 1.5) { f.visible = false; S.behindT = 0; if (spd < 1.5) sting(0.8); }
  }
  // ---- the hanged one in the burn ----
  if (S.hangedS !== undefined) {
    const d = dist(S.hangedS, s);
    S.hanged.visible = d > -20 && d < 160;
    if (S.hanged.visible) { S.hanged.rotation.z = Math.sin(ev.time * 1.3) * 0.12; S.hanged.rotation.y = ev.time * 0.25; mood.dread = Math.max(mood.dread, 0.7); }
    once('hanged', d > 0 && d < 40, () => { ev.radioBurst = 2; setTimeout(() => audio.say('he waited for you'), 600); });
  }
  // ---- scarecrows turn to watch the car ----
  for (const c of S.crows) {
    const d = Math.hypot(c.position.x - car.pos.x, c.position.z - car.pos.z);
    if (d < 120) { const want = Math.atan2(car.pos.x - c.position.x, car.pos.z - c.position.z); c.rotation.y = lerp(c.rotation.y, want, 1 - Math.exp(-dt * 0.6)); }
  }
  // ---- the pack: eyes that keep pace beside you in the forest, then stop dead ----
  if (biome === 'forest' && spd > 8 && S.packT < 0 && Math.random() < dt / 90) { S.packT = 0; S.packSide = Math.random() > 0.5 ? 1 : -1; }
  if (S.packT >= 0) {
    S.packT += dt;
    for (let i = 0; i < S.pack.length; i++) {
      const g = S.pack[i];
      const lat = S.packSide * (9 + i * 2.2);
      const p = w.road.at(s + 6 + i * 4 - S.packT * 0.4);
      const x = p.x + p.nx * lat, z = p.z + p.nz * lat;
      g.position.set(x, w.terrain.heightAt(x, z) + 0.55 + Math.abs(Math.sin(S.packT * 8 + i)) * 0.15, z);
      g.lookAt(car.pos.x, g.position.y, car.pos.z);
      g.visible = S.packT < 11;
    }
    mood.heartbeat = Math.max(mood.heartbeat, 0.6); mood.dread = Math.max(mood.dread, 0.8);
    if (S.packT > 11) { S.packT = -1; S.pack.forEach((g) => (g.visible = false)); sting(0.4, 0.2); }
  }
  // ---- the second lap: the signs change ----
  if (ev.lap >= 1 && !S.signsSwapped) {
    S.signsSwapped = true;
    const swaps = [['NO SERVICES', 'NEXT 60 km'], ['NO', 'ESCAPE'], ['SCENIC', 'OVERLOOK'], ['DON\'T', 'LOOK'], ['ICE ON', 'BRIDGE'], ['SHE IS', 'STILL HERE'], ['TUNNEL', 'LIGHTS ON'], ['TURN', 'BACK']];
    w.scene.traverse((o) => {
      if (o.isMesh && Array.isArray(o.material) && o.material[4] && o.material[4].map) {
        const tex = signTexture([swaps[Math.floor(Math.random() * 4) * 2 + 1][0], swaps[Math.floor(Math.random() * 4) * 2 + 1][1]], { bg: '#f4f7ec', fg: '#b00', w: 256, h: 256 });
        o.material[4].map = tex; o.material[4].emissiveMap = tex; o.material[4].needsUpdate = true;
      }
    });
    ev.hud.toast('', 'you have been here before');
  }
  if (ev.lap >= 1) { ev.hud.minutes = 3 * 60 + 33; } // the clock stops at 03:33 forever
  // ---- the music box on the radio ----
  S.musicT -= dt;
  if (S.musicT <= 0) { S.musicT = 240 + Math.random() * 200; ev.radioBurst = 14; audio.musicBox(12); mood.dread = Math.max(mood.dread, 0.6); }
  // ---- whispers ----
  S.whisperT -= dt;
  if (S.whisperT <= 0 && mood.dread > 0.4) { S.whisperT = 60 + Math.random() * 90; audio.whisper(['behind you', 'stay', 'we know', 'faster', 'she saw you', 'get out', 'it is cold in here'][Math.floor(Math.random() * 7)]); }
}
