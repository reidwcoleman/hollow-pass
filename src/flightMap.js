import * as THREE from 'three';
import { clamp } from './noise.js';
import { glowSprite } from './textures.js';

/**
 * What the map needs to be flown: a landing pad on the summit, a ring course
 * threaded above the loop, named waypoints for every landmark, cloud banks
 * you can fly through, and a ghost "car" so road traffic keeps living below.
 */
export function buildFlightMap(world, scene) {
  const road = world.road, terrain = world.terrain, N = road.count, mats = world.mats;
  const map = {};
  // ---- landing pad near the summit mast ----
  const s = road.samples[world.overlookI];
  const px = world.towerXZ ? world.towerXZ[0] + 22 : s.x + s.nx * 30, pz = world.towerXZ ? world.towerXZ[1] + 10 : s.z + s.nz * 30;
  const py = terrain.heightAt(px, pz) + 1.6;
  terrain.pads && terrain.pads.push({ x: px, z: pz, r: 18, y: py - 0.4 });
  const pad = new THREE.Group(); pad.position.set(px, py, pz);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(12, 12.5, 5, 48), new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.6, metalness: 0.5 })); disc.position.y = -2.5; disc.receiveShadow = true; pad.add(disc);
  const ring = new THREE.Mesh(new THREE.RingGeometry(10.0, 10.35, 64), new THREE.MeshStandardMaterial({ color: 0x334455, emissive: 0x7fdcff, emissiveIntensity: 0.7, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; pad.add(ring);
  const hmark = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.15, 48), ring.material); hmark.rotation.x = -Math.PI / 2; hmark.position.y = 0.02; pad.add(hmark);
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; const l = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), new THREE.MeshStandardMaterial({ color: 0x100800, emissive: 0xffa040, emissiveIntensity: 2.5 })); l.position.set(Math.cos(a) * 11.5, 0.2, Math.sin(a) * 11.5); pad.add(l); }
  // a hangar hut with a lit door
  const hut = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 6), mats.panelRust); hut.position.set(-16, 2, 4); hut.castShadow = true; pad.add(hut);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshStandardMaterial({ color: 0x102030, emissive: 0x7fdcff, emissiveIntensity: 1.2 })); door.position.set(-11.99, 1.7, 4); door.rotation.y = Math.PI / 2; pad.add(door);
  scene.add(pad);
  world.fixtures.push({ pos: new THREE.Vector3(px, py + 2, pz), color: new THREE.Color(0x7fdcff), intensity: 90, range: 30, flicker: 'steady', bulb: null });
  world.fixtures.push({ pos: new THREE.Vector3(px - 11, py + 2, pz + 4), color: new THREE.Color(0x7fdcff), intensity: 60, range: 18, flicker: 'steady', bulb: null });
  map.padPos = new THREE.Vector3(px, py, pz);
  const baseGround = world.groundAt;
  world.groundAt = (x, z) => { const d = Math.hypot(x - px, z - pz); const g = baseGround(x, z); return d < 12.2 ? Math.max(g, py) : g; };
  map.padYaw = Math.atan2(-(s.x - px), -(s.z - pz));

  // ---- ring course: threaded above the loop, varying height ----
  const rings = [];
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x223040, emissive: 0x7fdcff, emissiveIntensity: 1.6, roughness: 0.4, metalness: 0.6 });
  const activeMat = new THREE.MeshStandardMaterial({ color: 0x403020, emissive: 0xffc050, emissiveIntensity: 2.6, roughness: 0.4, metalness: 0.6 });
  const nRings = 16;
  for (let i = 0; i < nRings; i++) {
    const idx = Math.floor((world.overlookI + (i + 1) * (N / nRings)) % N);
    const sm = road.samples[idx];
    const lat = Math.sin(i * 1.7) * 60;
    const h = 40 + (i % 3) * 35 + (Math.sin(i * 2.3) + 1) * 30;
    const x = sm.x + sm.nx * lat, z = sm.z + sm.nz * lat;
    const y = Math.max(terrain.heightAt(x, z), sm.y) + h;
    const m = new THREE.Mesh(new THREE.TorusGeometry(9, 0.6, 12, 48), ringMat);
    m.position.set(x, y, z);
    // face the direction of travel
    const nx = road.samples[(idx + 8) % N];
    m.lookAt(nx.x + nx.nx * Math.sin((i + 1) * 1.7) * 60, y, nx.z + nx.nz * Math.sin((i + 1) * 1.7) * 60);
    scene.add(m);
    const beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSprite(64, 0, 'rgba(160,230,255,1)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 })); beacon.scale.set(6, 6, 1); m.add(beacon);
    rings.push({ m, x, y, z, i, beacon });
  }
  map.rings = rings; map.ringIndex = 0; map.ringT = 0; map.ringRun = false; map.ringBest = null; map.ringMat = ringMat; map.activeMat = activeMat;

  // ---- clouds: banks of soft sprites at two altitudes ----
  const cloudMat = new THREE.SpriteMaterial({ map: glowSprite(128, 0.0, 'rgba(180,195,225,1)'), transparent: true, depthWrite: false, opacity: 0.11, color: 0x8ea0bc, fog: true });
  map.clouds = [];
  for (let b = 0; b < 16; b++) {
    const a = Math.random() * Math.PI * 2, r = 400 + Math.random() * 2600;
    const cxp = Math.cos(a) * r, czp = Math.sin(a) * r;
    const base = 520 + Math.random() * 500 + (b % 2) * 350;
    const n = 7 + Math.floor(Math.random() * 6);
    for (let k = 0; k < n; k++) {
      const sp = new THREE.Sprite(cloudMat);
      sp.position.set(cxp + (Math.random() - 0.5) * 320, base + (Math.random() - 0.5) * 70, czp + (Math.random() - 0.5) * 320);
      const sc = 160 + Math.random() * 220;
      sp.scale.set(sc, sc * 0.32, 1);
      sp.userData = { phase: Math.random() * 10, x: sp.position.x, z: sp.position.z };
      scene.add(sp); map.clouds.push(sp);
    }
  }

  // ---- waypoints ----
  const wps = [];
  const addWp = (name, x, z, y) => wps.push({ name, x, z, y: (y !== undefined ? y : terrain.heightAt(x, z)) + 8 });
  addWp('STARK PAD', px, pz, py);
  if (world.towerXZ) addWp('RADIO MAST', world.towerXZ[0], world.towerXZ[1]);
  if (world.gas) addWp('LAST CHANCE GAS', world.gas.group.position.x, world.gas.group.position.z);
  if (world.cemetery) addWp('HALLOW CHAPEL', world.cemetery.group.position.x, world.cemetery.group.position.z);
  if (world.lake) addWp('LAKE NOWHERE', world.lake.x, world.lake.z, world.lake.y);
  if (world.mine) addWp('MINE No. 3', world.mine.group.position.x, world.mine.group.position.z);
  if (world.village && world.village.group.userData.church) { const c = world.village.group.userData.church.position; addWp('ASHWOOD', c.x, c.z); }
  for (const [k, f] of world.terrain.features.bridges.entries()) { const sm = road.samples[Math.floor(f.mid) % N]; addWp(k ? 'SORROW CREEK BRIDGE' : "WIDOW'S BRIDGE", sm.x, sm.z, sm.y); }
  for (const [k, f] of world.terrain.features.tunnels.entries()) { const sm = road.samples[f.a % N]; addWp(k ? 'SILENT BORE' : 'MERCY TUNNEL', sm.x, sm.z, sm.y); }
  if (world.overlook) addWp('HOLLOW PASS SUMMIT', world.overlook.group.position.x, world.overlook.group.position.z);
  map.wpsAll = wps;
  map.waypoints = (suit) => {
    const out = wps.map((w) => ({ ...w, active: false }));
    if (map.ringRun && map.rings[map.ringIndex]) { const r = map.rings[map.ringIndex]; out.push({ name: `RING ${map.ringIndex + 1}/${map.rings.length}`, x: r.x, y: r.y, z: r.z, active: true }); }
    else if (map.rings[0]) out.push({ name: 'RING COURSE START', x: map.rings[0].x, y: map.rings[0].y, z: map.rings[0].z, active: true });
    // show at most the 7 nearest plus the active
    out.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || Math.hypot(a.x - suit.pos.x, a.z - suit.pos.z) - Math.hypot(b.x - suit.pos.x, b.z - suit.pos.z));
    return out.slice(0, 8);
  };
  map.radar = () => { const out = wps.map((w) => ({ ...w })); for (const r of rings) out.push({ x: r.x, z: r.z, ring: true, active: map.ringRun ? r.i === map.ringIndex : r.i === 0 }); return out; };
  map.ringInfo = () => map.ringRun ? `COURSE ${map.ringT.toFixed(1)} s` : map.ringBest ? `BEST ${map.ringBest.toFixed(1)} s` : 'FLY THROUGH RING 1 TO START';

  // ---- ghost car for the traffic system: sits on the road under the suit ----
  const ghost = { pos: new THREE.Vector3(), roadS: 0, speed: 5, roadDist: 0, lateralOnRoad: -2.2 };
  map.ghostCar = (p) => { const n = road.nearest(p.x, p.z, 400) || road.nearest(road.samples[0].x, road.samples[0].z, 10); ghost.roadS = n.s; ghost.pos.set(n.sample.x, n.sample.y, n.sample.z); return ghost; };

  map.update = (dt, suit, hud, audio) => {
    // rings
    const t = performance.now() / 1000;
    for (const r of rings) { r.m.rotation.z += dt * 0.15; r.beacon.material.opacity = 0.5 + 0.3 * Math.sin(t * 2 + r.i); r.m.material = map.ringRun && r.i === map.ringIndex ? activeMat : ringMat; }
    const cur = map.ringRun ? rings[map.ringIndex] : rings[0];
    if (cur) {
      const d = Math.hypot(cur.x - suit.pos.x, cur.y - (suit.pos.y + 1.2), cur.z - suit.pos.z);
      if (d < 9.5) {
        if (!map.ringRun) { map.ringRun = true; map.ringIndex = 1; map.ringT = 0; hud.message('COURSE STARTED', 2); audio.chime(); }
        else { map.ringIndex++; audio.chime(); if (map.ringIndex >= rings.length) { map.ringRun = false; map.ringIndex = 0; if (!map.ringBest || map.ringT < map.ringBest) map.ringBest = map.ringT; hud.message(`COURSE COMPLETE · ${map.ringT.toFixed(1)} s`, 5); } }
        cur.cool = 0.5;
      }
    }
    if (map.ringRun) map.ringT += dt;
    // clouds drift, fade when you are inside them
    for (const c of map.clouds) { const u = c.userData; c.position.x = u.x + Math.sin(t * 0.02 + u.phase) * 40; c.position.z = u.z + t * 1.5 % 1; }
    // in-cloud: the fog thickens briefly
    let inCloud = 0;
    for (const c of map.clouds) { const dx = c.position.x - suit.pos.x, dy = c.position.y - suit.pos.y, dz = c.position.z - suit.pos.z; if (Math.abs(dy) < 40 && dx * dx + dz * dz < 120 * 120) { inCloud = 1; break; } }
    world.scene.fog.density = clamp(world.scene.fog.density + ((inCloud ? 0.012 : 0.00035) - world.scene.fog.density) * (1 - Math.exp(-dt * (inCloud ? 3 : 1.2))), 0.0003, 0.02);
  };
  return map;
}
