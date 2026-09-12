import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { clamp, lerp, mulberry32 } from './noise.js';
import { glowSprite } from './textures.js';

/**
 * Other vehicles on the pass. Oncoming traffic uses the far lane and comes
 * at you with real headlights; the occasional slow vehicle ahead in your lane
 * has to be overtaken. A snowplough with a rotating amber beacon works the
 * road too. Vehicles are solid: the car collides with them.
 */
const LANE = 2.15; // lateral offset of a lane centre from the crown

function lampSprite() { return glowSprite(128, 0.0, 'rgba(255,240,210,1)'); }

export function buildVehicle(kind, envMap) {
  const g = new THREE.Group();
  const rnd = mulberry32(Math.floor(Math.random() * 1e9));
  const colors = [0x2a2c30, 0x8a8f96, 0x5c1f1f, 0x1e2f4a, 0xd8d3c4, 0x3a3f36];
  const paint = new THREE.MeshPhysicalMaterial({ color: colors[Math.floor(rnd() * colors.length)], metalness: 0.5, roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.1, envMap, envMapIntensity: 1.0 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.8 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a1016, roughness: 0.08, metalness: 0.1, clearcoat: 1, envMap, envMapIntensity: 1.5 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.95 });
  const lampOn = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0d0, emissiveIntensity: 12 });
  const tailOn = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff2010, emissiveIntensity: 3 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  let L = 4.6, W = 1.8, headY = 0.7, headX = 0.62, front = L / 2;
  if (kind === 'sedan') {
    add(new RoundedBoxGeometry(W, 0.55, L, 4, 0.12), paint, 0, 0.62, 0);
    add(new RoundedBoxGeometry(W * 0.88, 0.5, 2.3, 4, 0.14), glass, 0, 1.12, -0.25);
    add(new RoundedBoxGeometry(W * 0.86, 0.08, 2.1, 3, 0.03), paint, 0, 1.36, -0.25);
  } else if (kind === 'pickup') {
    L = 5.4; W = 1.95; headY = 0.85; headX = 0.7; front = L / 2;
    add(new RoundedBoxGeometry(W, 0.7, L, 4, 0.1), paint, 0, 0.75, 0);
    add(new RoundedBoxGeometry(W * 0.9, 0.62, 1.7, 4, 0.12), glass, 0, 1.35, 0.5);
    add(new RoundedBoxGeometry(W * 0.88, 0.08, 1.6, 3, 0.03), paint, 0, 1.66, 0.5);
    add(new THREE.BoxGeometry(W * 0.94, 0.5, 2.2), dark, 0, 1.2, -1.4); // bed
  } else if (kind === 'plough') {
    L = 7.5; W = 2.5; headY = 1.3; headX = 0.9; front = L / 2 + 1.0;
    add(new THREE.BoxGeometry(W, 1.4, L), new THREE.MeshStandardMaterial({ color: 0xd06a10, roughness: 0.6, metalness: 0.4 }), 0, 1.3, -0.3);
    add(new RoundedBoxGeometry(W * 0.96, 1.3, 2.2, 3, 0.1), new THREE.MeshStandardMaterial({ color: 0xd06a10, roughness: 0.6, metalness: 0.4 }), 0, 2.6, 2.2);
    add(new THREE.BoxGeometry(W * 0.9, 0.7, 0.1), glass, 0, 2.75, 3.28);
    // blade
    const blade = add(new THREE.BoxGeometry(3.4, 1.1, 0.3), new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.9, roughness: 0.4 }), 0, 0.6, L / 2 + 0.9);
    blade.rotation.y = 0.35;
    // amber beacon
    const beacon = add(new THREE.CylinderGeometry(0.14, 0.14, 0.25, 12), new THREE.MeshStandardMaterial({ color: 0x402000, emissive: 0xffa010, emissiveIntensity: 6 }), 0, 3.4, 2.2);
    g.userData.beacon = beacon;
  }
  // wheels
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.24, 18); wheelGeo.rotateZ(Math.PI / 2);
  const wy = kind === 'plough' ? 0.5 : 0.36, ws = kind === 'plough' ? 1.4 : 1;
  for (const [x, z] of [[-W / 2 + 0.1, L * 0.32], [W / 2 - 0.1, L * 0.32], [-W / 2 + 0.1, -L * 0.32], [W / 2 - 0.1, -L * 0.32]]) { const w = add(wheelGeo, rubber, x, wy, z); w.scale.set(ws, ws, ws); }
  // lamps
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.34, 0.16, 0.06), lampOn, s * headX, headY, front + 0.01);
    add(new THREE.BoxGeometry(0.3, 0.14, 0.05), tailOn, s * headX, headY, -L / 2 - 0.01);
  }
  // glare billboards (two, additive)
  const spr = new THREE.SpriteMaterial({ map: lampSprite(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0xfff1d8 });
  const glares = [];
  for (const s of [-1, 1]) { const sp = new THREE.Sprite(spr); sp.position.set(s * headX, headY, front + 0.15); sp.scale.set(1.2, 1.2, 1); g.add(sp); glares.push(sp); }
  g.userData.glares = glares; g.userData.L = L; g.userData.W = W; g.userData.lampMat = lampOn;
  g.userData.lampPos = new THREE.Vector3(0, headY, front); g.userData.beaconPos = new THREE.Vector3(0, 3.5, 2.2);
  return g;
}

export class Traffic {
  constructor(world, scene, envMap) {
    this.world = world; this.scene = scene; this.envMap = envMap;
    this.vehicles = [];
    this.timer = 12;
    this.time = 0;
    this.enabled = true;
    // Fixed light pool: adding/removing lights recompiles every shader, so these live in the scene permanently.
    this.spots = [];
    for (let i = 0; i < 1; i++) {
      const sp = new THREE.SpotLight(0xfff0d0, 0, 90, 0.45, 0.6, 1.6);
      scene.add(sp); scene.add(sp.target);
      this.spots.push(sp);
    }
    this.beaconFixture = { pos: new THREE.Vector3(0, -9999, 0), color: new THREE.Color(0xffa010), intensity: 90, range: 25, flicker: 'steady', bulb: null, k: 0 };
    world.fixtures.push(this.beaconFixture);
  }
  spawn(kind, s, dir, speed, lateral) {
    const mesh = buildVehicle(kind, this.envMap);
    this.scene.add(mesh);
    const v = { mesh, s, dir, speed, lateral, kind, alive: true, age: 0, r: kind === 'plough' ? 2.2 : 1.5, L: mesh.userData.L, ghost: false };
    this.vehicles.push(v);
    this._place(v);
    return v;
  }
  _place(v) {
    const road = this.world.road;
    const p = road.at(v.s);
    const y = this.world.groundAt(p.x + p.nx * v.lateral, p.z + p.nz * v.lateral);
    v.mesh.position.set(p.x + p.nx * v.lateral, y + 0.02, p.z + p.nz * v.lateral);
    const yaw = Math.atan2(p.tx, p.tz) + (v.dir < 0 ? Math.PI : 0);
    v.mesh.rotation.y = yaw;
    // pitch with the road
    const p2 = road.at(v.s + v.dir * 3);
    const y2 = this.world.groundAt(p2.x + p2.nx * v.lateral, p2.z + p2.nz * v.lateral);
    v.mesh.rotation.x = -Math.atan2(y2 - y, 3) * v.dir;
    v.x = v.mesh.position.x; v.z = v.mesh.position.z;
  }
  /** Dynamic obstacle circles (front + rear) for the collision solver. */
  obstacles() {
    const out = [];
    for (const v of this.vehicles) {
      if (!v.alive || v.ghost) continue;
      const fx = Math.sin(v.mesh.rotation.y), fz = Math.cos(v.mesh.rotation.y);
      const half = v.L * 0.5 - v.r * 0.6;
      out.push({ x: v.x + fx * half, z: v.z + fz * half, r: v.r, kind: 'vehicle', extra: v });
      out.push({ x: v.x - fx * half, z: v.z - fz * half, r: v.r, kind: 'vehicle', extra: v });
      if (v.L > 6) out.push({ x: v.x, z: v.z, r: v.r, kind: 'vehicle', extra: v });
    }
    return out;
  }
  update(dt, car, ctx) {
    this.time += dt;
    const road = this.world.road, L = road.length;
    const carS = car.roadS;
    // spawn cadence: an oncoming vehicle every 20-45 s, a slow one ahead now and then, the plough rarely
    this.timer -= dt;
    if (this.enabled && this.timer <= 0 && Math.abs(car.speed) > 3) {
      const roll = Math.random();
      if (roll < 0.62) this.spawn(Math.random() < 0.6 ? 'sedan' : 'pickup', carS + 420 + Math.random() * 200, -1, 14 + Math.random() * 8, LANE);
      else if (roll < 0.86) this.spawn(Math.random() < 0.5 ? 'sedan' : 'pickup', carS + 160 + Math.random() * 80, 1, 9 + Math.random() * 5, -LANE);
      else this.spawn('plough', carS + 220, 1, 6.5, -LANE - 0.3);
      this.timer = 18 + Math.random() * 26;
    }
    for (const v of this.vehicles) {
      if (!v.alive) continue;
      if (v.parked) { v.cur = 0; this._place(v); v.dist = Math.hypot(v.x - car.pos.x, v.z - car.pos.z); continue; }
      v.age += dt;
      // follow the road; slow down a little for curves
      const p = road.at(v.s);
      const curveSlow = clamp(1 - Math.abs(p.curv) * 40, 0.55, 1);
      // don't rear-end the player when following behind them in the same lane
      let target = v.speed * curveSlow;
      if (v.dir > 0) {
        let gap = carS - v.s; gap = ((gap % L) + L) % L; if (gap > L / 2) gap -= L;
        if (gap > 0 && gap < 14 && Math.abs(car.roadDist) < 3.5 && car.speed < v.speed) target = Math.min(target, Math.max(0, car.speed - 1));
      }
      if (v.follow) {
        let gap = carS - v.s; gap = ((gap % L) + L) % L; if (gap > L / 2) gap -= L;
        target = gap > 14 ? Math.abs(car.speed) + 4 : gap < 7 ? Math.max(0, Math.abs(car.speed) - 3) : Math.abs(car.speed);
        v.lateral = lerp(v.lateral, -car.roadDist * Math.sign(-1) * 0 + (car.lateralOnRoad ?? -LANE), 1 - Math.exp(-dt * 0.8));
      }
      v.cur = lerp(v.cur ?? target, target, 1 - Math.exp(-dt * (v.follow ? 3 : 1.5)));
      v.s += v.dir * v.cur * dt;
      this._place(v);
      // lights and glare toward the camera
      const glare = v.mesh.userData.glares;
      const toCar = new THREE.Vector3(car.pos.x - v.x, 0, car.pos.z - v.z);
      const dist = toCar.length();
      toCar.normalize();
      const fx = Math.sin(v.mesh.rotation.y), fz = Math.cos(v.mesh.rotation.y);
      const facing = clamp(toCar.x * fx + toCar.z * fz, 0, 1);
      const gl = v.ghost ? 0 : facing * facing * clamp(dist / 25, 0.2, 1) * (v.lightsOn === false ? 0 : 1);
      for (const sp of glare) sp.scale.setScalar(0.6 + gl * (2.2 + 22 / Math.max(dist, 6)));
      v.dist = dist;
      v.mesh.userData.lampMat.emissiveIntensity = v.lightsOn === false ? 0.1 : 12;
      if (v.mesh.userData.beacon) {
        const on = (this.time * 2 + v.s) % 1 < 0.5;
        v.mesh.userData.beacon.material.emissiveIntensity = on ? 8 : 0.3;
        v.beaconOn = on;
      }
      // ghosts: lights die at a set distance, then they are simply not there
      if (v.vanishAt && dist < v.vanishAt && !v.vanishing) { v.vanishing = this.time; v.lightsOn = false; ctx.onVanish && ctx.onVanish(v); }
      if (v.vanishing && this.time - v.vanishing > 0.35) { v.alive = false; this.scene.remove(v.mesh); continue; }
      // pass-by whoosh / horn hooks
      let rel = v.s - carS; rel = ((rel % L) + L) % L; if (rel > L / 2) rel -= L;
      if (!v.passed && v.dir < 0 && rel < 0) { v.passed = true; ctx.onPass && ctx.onPass(v); }
      // retire far behind or far ahead
      if (v.follow && v.dismiss) { v.alive = false; this.scene.remove(v.mesh); continue; }
      if ((v.dir < 0 && rel < -120) || (v.dir > 0 && !v.follow && (rel < -150 || rel > 900)) || v.age > 240) { v.alive = false; this.scene.remove(v.mesh); }
    }
    this.vehicles = this.vehicles.filter((v) => v.alive);
    // assign pooled headlights to the nearest lit vehicles, the beacon to the nearest plough
    const lit = this.vehicles.filter((v) => v.lightsOn !== false && v.dist < 140).sort((a, b) => a.dist - b.dist);
    for (let i = 0; i < this.spots.length; i++) {
      const sp = this.spots[i], v = lit[i];
      if (!v) { sp.intensity = 0; continue; }
      v.mesh.updateMatrixWorld(true);
      sp.position.copy(v.mesh.userData.lampPos).applyMatrix4(v.mesh.matrixWorld);
      sp.target.position.copy(v.mesh.userData.lampPos).add(new THREE.Vector3(0, -1.5, 30)).applyMatrix4(v.mesh.matrixWorld);
      sp.intensity = 900;
    }
    const plough = this.vehicles.find((v) => v.mesh.userData.beacon && v.dist < 120);
    if (plough) { this.beaconFixture.pos.copy(plough.mesh.userData.beaconPos).applyMatrix4(plough.mesh.matrixWorld); this.beaconFixture.forceOff = !plough.beaconOn; }
    else { this.beaconFixture.pos.set(0, -9999, 0); this.beaconFixture.forceOff = true; }
  }
  nearestOncoming(car) {
    let best = null, bd = Infinity;
    for (const v of this.vehicles) { const d = Math.hypot(v.x - car.pos.x, v.z - car.pos.z); if (v.dir < 0 && d < bd) { bd = d; best = v; } }
    return best ? { v: best, d: bd } : null;
  }
}
