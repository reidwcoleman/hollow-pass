import * as THREE from 'three';
import { clamp, lerp } from './noise.js';
import { Puffs } from './particles.js';
import { glowSprite } from './textures.js';

/**
 * The suit: first-person flight with hover, thrust along the look direction,
 * strafing, vertical thrust, afterburner, quadratic drag, terrain contact
 * with walking, plus the gauntlet view-model, repulsor blasts and thruster glow.
 */
export class Suit {
  constructor(world, scene, camera, audio) {
    this.world = world; this.scene = scene; this.camera = camera; this.audio = audio;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.power = 1; this.boost = 0; this.thrustLevel = 0; this.speed = 0;
    this.grounded = false; this.charge = 0; this.damage = 0; this.gForce = 0;
    this.eye = 1.65;
    this.tmp = new THREE.Vector3(); this.fwd = new THREE.Vector3(); this.right = new THREE.Vector3();
    this.shake = 0;
    this.altAGL = 0;
    this._buildViewModel();
    this._buildProjectiles();
    this.time = 0;
  }

  _buildViewModel() {
    const cam = this.camera;
    const env = this.world.envMap;
    const red = new THREE.MeshPhysicalMaterial({ color: 0x7a0f1a, metalness: 0.7, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.12, envMap: env, envMapIntensity: 1.4 });
    const gold = new THREE.MeshPhysicalMaterial({ color: 0xa8803a, metalness: 0.9, roughness: 0.42, clearcoat: 0.5, envMap: env, envMapIntensity: 1.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.8, roughness: 0.5 });
    const glow = new THREE.MeshBasicMaterial({ color: 0x9fe8ff });
    this.repulsorMat = new THREE.MeshStandardMaterial({ color: 0x2aa0ff, emissive: 0x7fdcff, emissiveIntensity: 3.0 });
    this.arms = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.rotation.order = 'YXZ';
      // forearm runs away from the camera along +z of the group (the group is turned by PI)
      const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.062, 0.4, 16), red); forearm.rotation.x = Math.PI / 2; forearm.position.z = 0.2; arm.add(forearm);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.22), gold); plate.position.set(0, 0.052, 0.2); arm.add(plate);
      const seam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.015, 16), dark); seam.rotation.x = Math.PI / 2; seam.position.z = 0.1; arm.add(seam);
      const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.046, 0.05, 16), dark); wrist.rotation.x = Math.PI / 2; wrist.position.z = 0.42; arm.add(wrist);
      const hand = new THREE.Group(); hand.position.z = 0.46; hand.rotation.order = 'YXZ'; arm.add(hand);
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.03, 0.095), red); palm.position.z = 0.04; hand.add(palm);
      for (let f = 0; f < 4; f++) { const fg = new THREE.Mesh(new THREE.BoxGeometry(0.017, 0.018, 0.07), gold); fg.position.set(-0.031 + f * 0.0207, -0.008, 0.115); fg.rotation.x = 0.35; hand.add(fg); }
      const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.055), gold); thumb.position.set(side * 0.05, -0.01, 0.06); thumb.rotation.y = side * -0.7; hand.add(thumb);
      const rep = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.008, 20), this.repulsorMat); rep.position.set(0, -0.018, 0.04); hand.add(rep);
      const repGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSprite(64, 0, 'rgba(150,230,255,1)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 })); repGlow.scale.set(0.14, 0.14, 1); repGlow.position.set(0, -0.03, 0.04); hand.add(repGlow);
      arm.traverse((o) => { if (o.isMesh || o.isSprite) { o.renderOrder = 50; if (o.material) o.material.depthTest = false; } });
      arm.userData = { side, hand, repGlow, base: new THREE.Vector3(side * 0.27, -0.33, -0.34) };
      arm.position.copy(arm.userData.base);
      arm.rotation.set(-0.2, Math.PI + side * 0.12, 0);
      cam.add(arm); this.arms.push(arm);
    }
    // repulsor light on the hands and thruster light below
    this.handLight = new THREE.PointLight(0x7fdcff, 0.12, 3, 2); this.handLight.position.set(0, -0.5, -0.9); cam.add(this.handLight);
    this.thrustLight = new THREE.PointLight(0xa0d8ff, 0, 60, 1.8); this.scene.add(this.thrustLight);
    // thruster glow sprites under the camera (seen when looking down) and boost haze
    this.thrusterPuffs = new Puffs(this.scene, 600, { color: 0xa8e0ff, size: 1.4 });
  }

  _buildProjectiles() {
    this.shots = [];
    this.shotGeo = new THREE.SphereGeometry(0.16, 10, 8);
    this.shotMat = new THREE.MeshBasicMaterial({ color: 0xbff4ff });
    this.shotGlowMat = new THREE.SpriteMaterial({ map: glowSprite(64, 0, 'rgba(160,230,255,1)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.shotLights = [];
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0x8fe0ff, 0, 30, 2); this.scene.add(l); this.shotLights.push(l); }
    this.burst = new Puffs(this.scene, 900, { color: 0xbfe6ff, size: 3.0 });
    this.snowBurst = new Puffs(this.scene, 900, { color: 0xe8f0ff, size: 2.2 });
  }

  fire(side) {
    if (this.power < 0.04) return;
    this.power -= 0.035;
    const cam = this.camera;
    const arm = this.arms[side > 0 ? 1 : 0];
    arm.userData.kick = 1;
    const origin = arm.userData.hand.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    // aim at the reticle: converge on a point 60 m ahead
    const target = this.pos.clone().add(new THREE.Vector3(0, this.eye, 0)).addScaledVector(dir, 60);
    const d = target.sub(origin).normalize();
    const m = new THREE.Mesh(this.shotGeo, this.shotMat);
    const g = new THREE.Sprite(this.shotGlowMat); g.scale.set(2.2, 2.2, 1); m.add(g);
    m.position.copy(origin);
    this.scene.add(m);
    this.shots.push({ m, v: d.multiplyScalar(260).add(this.vel), life: 2.5 });
    this.audio.fire();
    this.shake = Math.max(this.shake, 0.25);
  }

  _explode(p, big = 1) {
    for (let i = 0; i < 40 * big; i++) {
      const a = Math.random() * 6.28, b = Math.random() * 3.14, sp = 6 + Math.random() * 14;
      this.burst.emit(p.x, p.y, p.z, Math.cos(a) * Math.sin(b) * sp, Math.abs(Math.cos(b)) * sp * 0.8 + 3, Math.sin(a) * Math.sin(b) * sp, 0.5 + Math.random() * 0.6, 1.2 + Math.random() * 1.5);
    }
    for (let i = 0; i < 60 * big; i++) {
      const a = Math.random() * 6.28, sp = 4 + Math.random() * 12;
      this.snowBurst.emit(p.x, p.y, p.z, Math.cos(a) * sp, 6 + Math.random() * 12, Math.sin(a) * sp, 1.0 + Math.random() * 1.0, 1.5 + Math.random() * 2);
    }
    const l = this.shotLights.find((x) => x.intensity <= 0) || this.shotLights[0];
    l.position.copy(p); l.intensity = 600 * big; l.userData.decay = 1;
    this.audio.explode(Math.min(1, 0.6 + big * 0.3) * clamp(1 - p.distanceTo(this.pos) / 500, 0.15, 1));
  }

  update(dt, input, world) {
    this.time += dt;
    const cam = this.camera;
    // ---- look ----
    this.yaw -= input.mouseDX * 0.0022;
    this.pitch = clamp(this.pitch - input.mouseDY * 0.0022, -1.5, 1.5);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.fwd.set(-sy * cp, sp, -cy * cp);            // three.js: -z forward at yaw 0
    this.right.set(cy, 0, -sy);
    const flatFwd = this.tmp.set(-sy, 0, -cy);

    // ---- thrust ----
    const ground = world.groundAt(this.pos.x, this.pos.z);
    this.altAGL = this.pos.y - ground;
    const wantBoost = input.boost && this.power > 0.02 && !this.grounded;
    this.boost = lerp(this.boost, wantBoost ? 1 : 0, 1 - Math.exp(-dt * 6));
    const main = 42 + this.boost * 150;             // m/s²
    const a = new THREE.Vector3();
    let thrusting = 0;
    if (!this.grounded || input.up) {
      if (input.fwd) { a.addScaledVector(this.fwd, main * input.fwd); thrusting = Math.max(thrusting, Math.abs(input.fwd)); }
      if (input.strafe) { a.addScaledVector(this.right, 30 * input.strafe); thrusting = Math.max(thrusting, Math.abs(input.strafe) * 0.6); }
      if (input.up) { a.y += 34; thrusting = Math.max(thrusting, 0.8); }
      if (input.down) { a.y -= 14; thrusting = Math.max(thrusting, 0.4); }
      // hover: repulsors hold altitude when there is power
      if (this.power > 0.01) a.y += 9.81 * (this.grounded ? 0 : 1);
      // landing flare: close to the ground and sinking, the repulsors brake the descent automatically
      if (!this.grounded && this.altAGL < 14 && this.vel.y < -3 && !input.down) a.y += clamp(-this.vel.y - 2.5, 0, 40) * 2.2;
      if (!this.grounded && this.altAGL < 14 && this.vel.y < -7 && input.down) a.y += clamp(-this.vel.y - 6, 0, 40) * 1.5;
    }
    a.y -= 9.81;
    // drag: quadratic, less in the boost direction (streamlined)
    const v = this.vel, spd = v.length();
    const k2 = this.boost > 0.5 ? 0.0021 : 0.0032;
    if (spd > 0) a.addScaledVector(v, -(k2 * spd + 0.15));
    // hover damping when idle in the air: settle, don't drift forever
    if (!input.fwd && !input.strafe && !input.up && !input.down && !this.grounded) a.addScaledVector(v, -1.2);
    v.addScaledVector(a, dt);
    this.pos.addScaledVector(v, dt);
    this.thrustLevel = lerp(this.thrustLevel, clamp(thrusting * (0.5 + this.boost * 0.5) + (this.grounded ? 0 : 0.25), 0, 1), 1 - Math.exp(-dt * 5));
    // power: boost drains, everything else trickle-charges
    this.power = clamp(this.power + dt * (this.boost > 0.5 ? -0.07 : 0.05), 0, 1);
    if (this.power <= 0.001 && this.boost > 0.5) this.boost = 0;

    // ---- terrain contact ----
    const g2 = world.groundAt(this.pos.x, this.pos.z);
    if (this.pos.y < g2 + 0.05) {
      const impact = -v.y;
      this.pos.y = g2 + 0.05;
      if (impact > 14) { this.damage = Math.min(1, this.damage + (impact - 14) / 40); this.shake = Math.max(this.shake, Math.min(1, impact / 40)); this.audio.thud(Math.min(1, impact / 30)); this._explode(this.pos.clone(), 0.6); }
      v.y = 0;
      const wasGrounded = this.grounded;
      this.grounded = true;
      if (!wasGrounded && impact > 3) this.audio.thud(0.3);
      // walking: ground friction, and walking thrust along the flat forward
      const walk = new THREE.Vector3();
      if (input.fwd) walk.addScaledVector(flatFwd, input.fwd * 7);
      if (input.strafe) walk.addScaledVector(this.right, input.strafe * 6);
      v.x = lerp(v.x, walk.x, 1 - Math.exp(-dt * 8)); v.z = lerp(v.z, walk.z, 1 - Math.exp(-dt * 8));
      if (input.up) { v.y = 9; this.grounded = false; }
    } else if (this.pos.y > g2 + 0.6) this.grounded = false;
    // world bounds and ceiling
    const R = Math.hypot(this.pos.x, this.pos.z);
    this.outOfBounds = R > 5200;
    if (R > 5600) { const k = 5600 / R; this.pos.x *= k; this.pos.z *= k; v.x *= 0.9; v.z *= 0.9; }
    if (this.pos.y > 2600) { this.pos.y = 2600; v.y = Math.min(v.y, 0); }
    this.speed = v.length();

    // ---- camera ----
    const lateralV = v.dot(this.right);
    const yawRate = -input.mouseDX * 0.0022 / Math.max(dt, 1e-3);
    const targetRoll = clamp(-lateralV * 0.004 - yawRate * 0.04 * Math.min(1, spd / 40), -0.5, 0.5);
    this.roll = lerp(this.roll, targetRoll, 1 - Math.exp(-dt * 4));
    const accelG = a.length() / 9.81;
    this.gForce = lerp(this.gForce, accelG, 1 - Math.exp(-dt * 3));
    cam.position.set(this.pos.x, this.pos.y + this.eye, this.pos.z);
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ'));
    this.shake *= Math.exp(-dt * 5);
    const sh = this.shake * 0.02 + this.boost * 0.004 * Math.min(1, spd / 100);
    if (sh > 0) { cam.rotation.x += (Math.random() - 0.5) * sh; cam.rotation.y += (Math.random() - 0.5) * sh; }
    cam.fov = lerp(cam.fov, 74 + Math.min(18, spd * 0.09) + this.boost * 6, 1 - Math.exp(-dt * 3));
    cam.updateProjectionMatrix();

    // ---- view-model animation ----
    for (const arm of this.arms) {
      const u = arm.userData, side = u.side;
      u.kick = Math.max(0, (u.kick || 0) - dt * 4);
      const b = u.base;
      const fly = clamp(this.thrustLevel, 0, 1), bo = this.boost, k = u.kick;
      const sway = Math.sin(this.time * 1.7 + side) * 0.004;
      // rest: hands low and relaxed. flight: arms drop and spread, palms turn down. boost: further back. fire: hand comes up to the reticle.
      arm.position.set(b.x + side * (fly * 0.05 + bo * 0.08) - side * k * 0.16, b.y - fly * 0.06 - bo * 0.05 + k * 0.16 + sway, b.z + bo * 0.06 - k * 0.12);
      arm.rotation.set(-0.2 - fly * 0.35 - bo * 0.2 + k * 0.75, Math.PI + side * (0.12 + fly * 0.15 + bo * 0.12) - side * k * 0.25, -lateralV * 0.003 * side);
      u.hand.rotation.set(0.15 + fly * 0.9 + bo * 0.3 - k * 1.0, 0, 0);
      u.repGlow.material.opacity = 0.35 + fly * 0.55 + k;
      u.repGlow.scale.setScalar(0.1 + fly * 0.08 + bo * 0.05 + k * 0.3);
    }
    this.repulsorMat.emissiveIntensity = 2 + this.thrustLevel * 3 + this.boost * 4;
    this.handLight.intensity = 0.1 + this.thrustLevel * 0.3;
    // thruster light and exhaust under the suit
    this.thrustLight.position.set(this.pos.x, this.pos.y - 0.4, this.pos.z);
    this.thrustLight.intensity = (this.grounded ? 0 : 120 + this.boost * 500) * (0.6 + this.thrustLevel * 0.4);
    if (!this.grounded) {
      const n = Math.floor((2 + this.thrustLevel * 6 + this.boost * 10) * dt * 60 * 0.3 + Math.random());
      for (let i = 0; i < n; i++) this.thrusterPuffs.emit(this.pos.x + (Math.random() - 0.5) * 0.5, this.pos.y - 0.3, this.pos.z + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 3 - v.x * 0.1, -8 - this.boost * 20 - Math.random() * 4, (Math.random() - 0.5) * 3 - v.z * 0.1, 0.35 + Math.random() * 0.4, 0.6 + this.boost * 0.8);
    }
    this.thrusterPuffs.update(dt, 3.0, -1.0);
    this.burst.update(dt, 2.5, -6.0);
    this.snowBurst.update(dt, 2.0, -9.0);

    // ---- projectiles ----
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.life -= dt;
      const step = s.v.clone().multiplyScalar(dt);
      s.m.position.add(step);
      const p = s.m.position;
      const gy = world.groundAt(p.x, p.z);
      let hit = p.y <= gy;
      // vehicles
      if (!hit && world.traffic) for (const veh of world.traffic.vehicles) { if (Math.hypot(veh.x - p.x, veh.z - p.z) < 2.6 && Math.abs(veh.mesh.position.y - p.y) < 3) { hit = true; veh.lightsOn = false; veh.mesh.rotation.z += (Math.random() - 0.5) * 1.5; veh.mesh.position.y += 0.6; veh.speed = 0; veh.cur = 0; veh.hitByRepulsor = true; } }
      if (!hit && world.obstacles) { world.obstacles.near(p.x, p.z, 3, (o) => { if (!hit && Math.hypot(o.x - p.x, o.z - p.z) < o.r + 0.4 && p.y < gy + 12) hit = true; }); }
      if (hit || s.life <= 0) {
        if (hit) { if (p.y < gy) p.y = gy + 0.2; this._explode(p.clone(), 1); }
        this.scene.remove(s.m); this.shots.splice(i, 1);
      }
    }
    for (const l of this.shotLights) if (l.intensity > 0) l.intensity *= Math.exp(-dt * 6);
    this.charge = input.chargeHeld ? clamp(this.charge + dt * 2, 0, 1) : 0;
  }
}
