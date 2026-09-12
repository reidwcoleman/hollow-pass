import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { clamp, lerp } from './noise.js';

/**
 * A rugged 4x4 built entirely from primitives with physically based
 * materials: clear-coated paint, tinted glass, brushed steel, rubber, and
 * emissive lamps that drive real spotlights with shadow maps.
 */
export function buildCar(tex, envMap) {
  const car = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({
    color: 0x3a5a66, metalness: 0.55, roughness: 0.38,
    clearcoat: 1.0, clearcoatRoughness: 0.08, envMap, envMapIntensity: 1.2,
  });
  const paintDark = new THREE.MeshPhysicalMaterial({ color: 0x0c0f12, metalness: 0.4, roughness: 0.55, clearcoat: 0.4, envMap, envMapIntensity: 1 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x0a1218, metalness: 0.0, roughness: 0.05, transmission: 0.0, transparent: true, opacity: 0.85,
    envMap, envMapIntensity: 2.2, clearcoat: 1, clearcoatRoughness: 0.02, side: THREE.DoubleSide,
  });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 1.0, roughness: 0.35, envMap, envMapIntensity: 1.4 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.92, metalness: 0 });
  const plastic = new THREE.MeshStandardMaterial({ color: 0x141618, roughness: 0.7, metalness: 0.05 });
  const tyre = new THREE.MeshStandardMaterial({ map: tex.tyre.map, normalMap: tex.tyre.normalMap, color: 0x1a1a1a, roughness: 0.95, normalScale: new THREE.Vector2(1.5, 1.5) });
  const headLampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d6, emissiveIntensity: 10, roughness: 0.15, metalness: 0 });
  const tailLampMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1a0a, emissiveIntensity: 2.2, roughness: 0.2 });
  const amberMat = new THREE.MeshStandardMaterial({ color: 0x331a00, emissive: 0xffa020, emissiveIntensity: 0.0, roughness: 0.3 });

  const L = 4.7, W = 1.95, H = 0.62; // lower body
  const body = new THREE.Group();
  car.add(body);

  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // lower tub
  add(new RoundedBoxGeometry(W, H, L, 6, 0.12), paint, 0, 0.78, 0);
  // fender flares / rocker
  add(new RoundedBoxGeometry(W + 0.16, 0.34, L * 0.97, 4, 0.1), paintDark, 0, 0.62, 0);
  // hood (slightly raised, subtle power dome)
  add(new RoundedBoxGeometry(W * 0.86, 0.09, 1.35, 4, 0.04), paint, 0, 1.11, 1.35);
  add(new RoundedBoxGeometry(W * 0.3, 0.05, 1.1, 3, 0.02), paint, 0, 1.16, 1.4);
  // cabin: trapezoid via extruded shape (side profile), bevelled
  const prof = new THREE.Shape();
  prof.moveTo(-1.55, 0); prof.lineTo(1.0, 0); prof.lineTo(0.62, 0.78); prof.lineTo(-1.35, 0.8); prof.lineTo(-1.55, 0.6); prof.closePath();
  const cabGeo = new THREE.ExtrudeGeometry(prof, { depth: W * 0.9, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 4 });
  cabGeo.rotateY(-Math.PI / 2);
  add(cabGeo, paint, W * 0.45, 1.09, -0.15);
  // window glass: inset slightly larger dark panels
  const winProf = new THREE.Shape();
  winProf.moveTo(-1.45, 0.08); winProf.lineTo(0.9, 0.08); winProf.lineTo(0.58, 0.72); winProf.lineTo(-1.3, 0.74); winProf.lineTo(-1.45, 0.58); winProf.closePath();
  const winGeo = new THREE.ExtrudeGeometry(winProf, { depth: W * 0.9 + 0.04, bevelEnabled: false });
  winGeo.rotateY(-Math.PI / 2);
  add(winGeo, glass, (W * 0.9 + 0.04) / 2, 1.11, -0.15);
  // pillars (dark strips so the glass reads as separate panes)
  for (const zz of [-1.15, -0.05, 0.55]) add(new THREE.BoxGeometry(W * 0.92, 0.7, 0.05), paintDark, 0, 1.45, zz - 0.15);
  // roof rack + light bar
  for (const xx of [-0.55, 0.55]) add(new THREE.BoxGeometry(0.06, 0.05, 1.9), steel, xx, 1.94, -0.35);
  for (const zz of [-1.1, -0.4, 0.3]) add(new THREE.BoxGeometry(1.2, 0.05, 0.06), steel, 0, 1.94, zz - 0.35);
  const lightBar = add(new THREE.BoxGeometry(1.1, 0.09, 0.12), plastic, 0, 1.97, 0.62);
  const lightBarLens = add(new THREE.BoxGeometry(1.0, 0.05, 0.03), headLampMat.clone(), 0, 1.97, 0.69);
  lightBarLens.material.emissiveIntensity = 0;
  // door seams, handles, roof panel, hood vents, snorkel, jerry can, winch
  const seam = new THREE.MeshStandardMaterial({ color: 0x05080a, roughness: 0.9 });
  for (const xx of [-W / 2 - 0.005, W / 2 + 0.005]) {
    for (const zz of [0.62, -0.62]) add(new THREE.BoxGeometry(0.012, 0.66, 0.02), seam, xx, 0.8, zz);
    for (const zz of [0.2, -1.0]) add(new THREE.BoxGeometry(0.02, 0.03, 0.16), steel, xx * 1.01, 0.98, zz);   // handles
    add(new THREE.BoxGeometry(0.012, 0.02, 2.4), seam, xx, 1.02, -0.2); // belt line
  }
  add(new RoundedBoxGeometry(W * 0.86, 0.06, 2.35, 3, 0.03), paintDark, 0, 1.93, -0.35); // roof
  for (const zz of [1.55, 1.75]) add(new THREE.BoxGeometry(0.5, 0.012, 0.07), seam, -0.35, 1.165, zz); // hood vents
  add(new THREE.CylinderGeometry(0.05, 0.05, 1.05, 10), plastic, W / 2 + 0.03, 1.4, 1.05); // snorkel
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 10), plastic, W / 2 + 0.03, 1.95, 1.0, Math.PI / 2);
  add(new RoundedBoxGeometry(0.34, 0.46, 0.16, 2, 0.03), new THREE.MeshStandardMaterial({ color: 0x3b4a1f, roughness: 0.7, metalness: 0.4 }), 0.72, 1.45, -L / 2 - 0.12); // jerry can
  add(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 12), steel, 0, 0.72, L / 2 + 0.18, 0, 0, Math.PI / 2); // winch drum
  // wheel-arch flares (half tori) and side steps
  for (const [xx, zz] of [[-0.95, 1.5], [0.95, 1.5], [-0.95, -1.45], [0.95, -1.45]]) {
    const arch = new THREE.TorusGeometry(0.52, 0.09, 8, 20, Math.PI);
    arch.rotateY(Math.PI / 2);
    add(arch, paintDark, xx * 1.06, 0.46, zz);
  }
  for (const xx of [-1.02, 1.02]) add(new THREE.BoxGeometry(0.16, 0.05, 2.2), steel, xx, 0.42, 0);
  // bumpers + bull bar
  add(new RoundedBoxGeometry(W + 0.05, 0.28, 0.32, 3, 0.06), paintDark, 0, 0.55, L / 2 + 0.05);
  add(new RoundedBoxGeometry(W + 0.05, 0.28, 0.3, 3, 0.06), paintDark, 0, 0.55, -L / 2 - 0.05);
  add(new THREE.TorusGeometry(0.03, 0.03, 8, 24), steel, 0, 0.55, L / 2 + 0.2);
  for (const xx of [-0.5, 0.5]) add(new THREE.CylinderGeometry(0.03, 0.03, 0.75, 12), steel, xx, 0.75, L / 2 + 0.25);
  add(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 12), steel, 0, 1.1, L / 2 + 0.25, 0, 0, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 12), steel, 0, 0.45, L / 2 + 0.25, 0, 0, Math.PI / 2);
  // grille
  add(new THREE.BoxGeometry(W * 0.62, 0.3, 0.05), plastic, 0, 0.92, L / 2 + 0.02);
  for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(W * 0.6, 0.02, 0.02), steel, 0, 0.8 + i * 0.06, L / 2 + 0.05);
  // headlamps (lens meshes)
  const lamps = [];
  for (const xx of [-0.65, 0.65]) {
    add(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 24), steel, xx, 0.95, L / 2 + 0.02, Math.PI / 2);
    lamps.push(add(new THREE.CylinderGeometry(0.14, 0.14, 0.04, 24), headLampMat, xx, 0.95, L / 2 + 0.08, Math.PI / 2));
    // indicators
    add(new THREE.BoxGeometry(0.2, 0.06, 0.03), amberMat, xx * 1.25, 0.8, L / 2 + 0.03);
  }
  // tail lamps
  const tails = [];
  for (const xx of [-0.75, 0.75]) {
    tails.push(add(new THREE.BoxGeometry(0.28, 0.2, 0.04), tailLampMat, xx, 0.95, -L / 2 - 0.02));
    add(new THREE.BoxGeometry(0.3, 0.24, 0.02), plastic, xx, 0.95, -L / 2 - 0.0);
  }
  // spare wheel on tailgate
  add(new THREE.TorusGeometry(0.34, 0.12, 12, 32), tyre, 0, 1.2, -L / 2 - 0.16);
  add(new THREE.CylinderGeometry(0.24, 0.24, 0.1, 16), steel, 0, 1.2, -L / 2 - 0.16, Math.PI / 2);
  // mirrors
  for (const xx of [-1.05, 1.05]) {
    add(new THREE.BoxGeometry(0.08, 0.05, 0.06), plastic, xx * 0.93, 1.35, 0.5);
    add(new RoundedBoxGeometry(0.2, 0.13, 0.08, 3, 0.03), paint, xx, 1.36, 0.45);
  }
  // exhaust
  add(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 12), steel, -0.6, 0.4, -L / 2 - 0.1, Math.PI / 2);
  // license plate
  add(new THREE.BoxGeometry(0.45, 0.13, 0.01), new THREE.MeshStandardMaterial({ map: tex.plate, roughness: 0.4 }), 0, 0.72, -L / 2 - 0.2);
  // underbody
  add(new THREE.BoxGeometry(W * 0.9, 0.2, L * 0.85), rubber, 0, 0.42, 0);
  // interior hint: dashboard glow + silhouettes
  const dash = add(new THREE.BoxGeometry(W * 0.8, 0.12, 0.3), plastic, 0, 1.15, 0.55);
  const dashGlow = add(new THREE.PlaneGeometry(0.5, 0.08), new THREE.MeshBasicMaterial({ color: 0x66c8ff, transparent: true, opacity: 0.9 }), 0, 1.25, 0.45, -0.6);
  dashGlow.castShadow = false;
  add(new RoundedBoxGeometry(0.5, 0.6, 0.45, 2, 0.1), plastic, 0.42, 1.3, -0.1); // seats
  add(new RoundedBoxGeometry(0.5, 0.6, 0.45, 2, 0.1), plastic, -0.42, 1.3, -0.1);
  add(new THREE.TorusGeometry(0.17, 0.02, 8, 24), plastic, 0.42, 1.3, 0.35, -0.3);

  // wheels
  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 32, 1, false);
  wheelGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.31, 8, 1, false);
  rimGeo.rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.32, 0.06, 0.16);
  for (const [xx, zz] of [[-0.95, 1.5], [0.95, 1.5], [-0.95, -1.45], [0.95, -1.45]]) {
    const w = new THREE.Group();
    w.rotation.order = 'YXZ';
    w.position.set(xx, 0.42, zz);
    const t = new THREE.Mesh(wheelGeo, tyre); t.castShadow = true; w.add(t);
    const r = new THREE.Mesh(rimGeo, steel); w.add(r);
    for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(spokeGeo, steel); s.rotation.x = (i / 5) * Math.PI * 2; s.position.x = xx > 0 ? 0.06 : -0.06; w.add(s); }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.36, 12), plastic); hub.rotation.z = Math.PI / 2; w.add(hub);
    body.add(w);
    wheels.push(w);
  }

  // Real lights. Two spots for the beams + one wide fill so the near road isn't a pinpoint.
  const lights = [];
  for (const xx of [-0.65, 0.65]) {
    const s = new THREE.SpotLight(0xfff0d0, 1700, 160, 0.40, 0.5, 1.7);
    s.position.set(xx, 0.95, L / 2 + 0.05);
    s.target.position.set(xx * 1.4, -0.6, 45);
    s.castShadow = xx > 0; // one shadow-casting beam is enough and halves the cost
    s.shadow.mapSize.set(2048, 2048);
    s.shadow.bias = -0.0008;
    s.shadow.normalBias = 0.02;
    s.shadow.camera.near = 1; s.shadow.camera.far = 120;
    body.add(s); body.add(s.target);
    lights.push(s);
  }
  const fill = new THREE.SpotLight(0xffe6c2, 350, 45, 0.95, 0.7, 1.8);
  fill.position.set(0, 0.9, L / 2); fill.target.position.set(0, -3, 12); body.add(fill); body.add(fill.target);
  const tailGlow = new THREE.PointLight(0xff2a10, 1.4, 4.5, 2);
  tailGlow.position.set(0, 0.5, -L / 2 - 0.6); body.add(tailGlow);
  const dashLight = new THREE.PointLight(0x4fb8ff, 1.5, 2.5, 2);
  dashLight.position.set(0, 1.35, 0.3); body.add(dashLight);

  // Volumetric beam cones (additive, soft) — the "light in the snow" look.
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uStrength: { value: 1.0 }, uColor: { value: new THREE.Color(0xffe9c4) } },
    vertexShader: `varying vec3 vP; varying vec3 vWp; varying vec3 vAxis; void main(){ vP = position; vec4 wp = modelMatrix*vec4(position,1.0); vWp = wp.xyz; vAxis = normalize((modelMatrix*vec4(0.0,-1.0,0.0,0.0)).xyz); gl_Position = projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: `
      uniform float uStrength; uniform vec3 uColor; varying vec3 vP; varying vec3 vWp; varying vec3 vAxis;
      void main(){
        float along = clamp(-vP.y / 32.0, 0.0, 1.0);
        vec3 v = normalize(cameraPosition - vWp);
        float facing = abs(dot(v, vAxis));           // bright looking down the beam, faint from the side
        float a = (1.0 - along) * (1.0 - along) * 0.012 * uStrength * (0.15 + 0.85 * facing * facing);
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
  const beams = [];
  for (const xx of [-0.65, 0.65]) {
    const cone = new THREE.ConeGeometry(9, 32, 24, 1, true);
    cone.translate(0, -16, 0);
    const b = new THREE.Mesh(cone, beamMat);
    b.position.set(xx, 0.95, L / 2 + 0.1);
    b.rotation.x = Math.PI / 2 + 0.05;
    b.renderOrder = 5;
    body.add(b);
    beams.push(b);
  }

  return {
    group: car, body, wheels, lights, fill, beams, beamMat, lamps, tails, tailGlow, headLampMat, tailLampMat, lightBarLens, amberMat, paint,
    setHeadlights(on) {
      for (const l of lights) l.intensity = on ? 1700 : 0;
      fill.intensity = on ? 350 : 0;
      headLampMat.emissiveIntensity = on ? 10 : 0.05;
      beamMat.uniforms.uStrength.value = on ? 1 : 0;
    },
  };
}

/** Arcade-leaning car physics with slip, weight transfer for the camera, surface grip and terrain following. */
export class CarPhysics {
  constructor(terrain, road, world) {
    this.terrain = terrain; this.road = road; this.world = world;
    this.ground = (x, z) => (world ? world.groundAt(x, z) : terrain.heightAt(x, z));
    this.pos = new THREE.Vector3();
    this.heading = 0;          // yaw
    this.vel = new THREE.Vector3(); // world velocity (xz)
    this.speed = 0;            // forward speed (m/s), signed
    this.lateral = 0;
    this.steer = 0;
    this.rpm = 0.2; this.gear = 1;
    this.throttle = 0; this.brake = 0; this.handbrake = false;
    this.pitch = 0; this.roll = 0;
    this.onRoad = true; this.roadDist = 0; this.roadS = 0;
    this.wheelSpin = 0;
    this.slip = 0;
    this.airborne = false;
    this.up = new THREE.Vector3(0, 1, 0);
    this.quat = new THREE.Quaternion();
    this.headingVec = new THREE.Vector3();
  }

  placeOnRoad(s, offset = -2) {
    const p = this.road.at(s);
    this.pos.set(p.x + p.nx * offset, p.y, p.z + p.nz * offset);
    this.heading = Math.atan2(p.tx, p.tz);
    this.vel.set(0, 0, 0); this.speed = 0;
  }

  step(dt, input) {
    const { throttle, brake, steer, handbrake } = input;
    const t = this.terrain;
    // surface
    const n = this.road.nearest(this.pos.x, this.pos.z, 80);
    this.roadDist = n ? n.d : 999;
    this.roadS = n ? n.s : this.roadS;
    this.onRoad = this.roadDist < 4.2;
    const shoulder = this.roadDist >= 4.2 && this.roadDist < 6.2;
    const grip = this.onRoad ? 1.0 : shoulder ? 0.7 : 0.45;
    const drag = this.onRoad ? 0.0 : shoulder ? 0.6 : 2.2;

    // steering: reduce lock at speed
    const maxLock = 0.55 / (1 + Math.abs(this.speed) * 0.045);
    const targetSteer = steer * maxLock;
    this.steer = lerp(this.steer, targetSteer, 1 - Math.exp(-dt * 9));

    // longitudinal
    const engineForce = throttle * (this.speed >= -0.5 ? 1 : 0.45) * (10.5 - clamp(Math.abs(this.speed) / 60, 0, 1) * 5.5) * (0.5 + grip * 0.5);
    const brakeForce = brake * (this.speed > 0.2 ? 18 : this.speed < -0.2 ? 18 : 0);
    let reverse = 0;
    if (brake > 0 && Math.abs(this.speed) < 0.3) reverse = -4.5 * brake; // hold brake at rest to reverse
    const rolling = 0.35 + drag * 1.2;
    const aero = 0.0038 * this.speed * Math.abs(this.speed);
    let a = engineForce + reverse - Math.sign(this.speed) * (brakeForce + rolling) - aero;
    if (handbrake) a -= Math.sign(this.speed) * 6;
    // hills: gravity component along heading
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const hAhead = this.ground(this.pos.x + fx * 2.5, this.pos.z + fz * 2.5);
    const hBack = this.ground(this.pos.x - fx * 2.5, this.pos.z - fz * 2.5);
    const grade = (hAhead - hBack) / 5;
    a -= grade * 9.81 * 0.9;
    this.speed += a * dt;
    if (Math.abs(this.speed) < 0.05 && throttle === 0 && reverse === 0) this.speed = 0;
    this.speed = clamp(this.speed, -12, 62);

    // yaw rate from steering with slip at low grip / handbrake
    const slipFactor = handbrake ? 0.35 : grip;
    const yawRate = this.steer * this.speed * 0.32 * (0.6 + slipFactor * 0.4) / (1 + Math.abs(this.speed) * 0.012);
    this.heading += yawRate * dt;

    // lateral velocity (drift): heading vs. velocity direction
    const vx = this.vel.x, vz = this.vel.z;
    const fwd = vx * fx + vz * fz;
    const lat = vx * -fz + vz * fx; // right-hand lateral (x' = -fz, z' = fx)
    const latDecay = Math.exp(-dt * (handbrake ? 2.2 : 3.0 + grip * 9));
    const newLat = lat * latDecay;
    this.lateral = newLat;
    this.slip = clamp(Math.abs(newLat) / 6, 0, 1);
    const nvx = fx * this.speed + (-fz) * newLat;
    const nvz = fz * this.speed + fx * newLat;
    this.vel.set(nvx, 0, nvz);
    this.pos.x += nvx * dt; this.pos.z += nvz * dt;

    // hard barriers: bridge railings, tunnel walls
    if (this.world) {
      const b = this.world.barrierAt(this.pos.x, this.pos.z);
      if (b) {
        const s = b.n.sample;
        const lat = (this.pos.x - s.x) * s.nx + (this.pos.z - s.z) * s.nz;
        if (Math.abs(lat) > b.limit) {
          const push = (Math.abs(lat) - b.limit) * Math.sign(lat);
          this.pos.x -= s.nx * push; this.pos.z -= s.nz * push;
          // scrape: bleed speed, kill lateral velocity, nudge heading back toward the road
          this.speed *= 0.985; this.lateral = 0;
          const roadYaw = Math.atan2(s.tx, s.tz);
          let dh = roadYaw - this.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
          this.heading += dh * Math.min(1, dt * 4);
          this.scrape = 1;
        }
      }
    }
    // keep inside the world
    const R = Math.hypot(this.pos.x, this.pos.z);
    if (R > 2200) { this.pos.x *= 2200 / R; this.pos.z *= 2200 / R; this.speed *= 0.5; }

    // terrain following (4 sample points), smoothed suspension
    const cx = -fz, cz = fx;
    const hf = this.ground(this.pos.x + fx * 1.5, this.pos.z + fz * 1.5);
    const hb = this.ground(this.pos.x - fx * 1.5, this.pos.z - fz * 1.5);
    const hl = this.ground(this.pos.x - cx * 0.95, this.pos.z - cz * 0.95);
    const hr = this.ground(this.pos.x + cx * 0.95, this.pos.z + cz * 0.95);
    const ground = (hf + hb + hl + hr) / 4;
    const targetPitch = Math.atan2(hf - hb, 3.0);
    const targetRoll = Math.atan2(hl - hr, 1.9);
    const k = 1 - Math.exp(-dt * 10);
    this.pitch = lerp(this.pitch, targetPitch, k);
    this.roll = lerp(this.roll, targetRoll, k);
    // vertical: follow ground with spring so bumps feel like suspension
    const dy = ground - this.pos.y;
    if (dy > 0) this.pos.y += dy * Math.min(1, dt * 14); else { this.vy = (this.vy || 0) - 9.81 * dt; this.pos.y = Math.max(ground, this.pos.y + this.vy * dt); if (this.pos.y <= ground) this.vy = 0; this.airborne = this.pos.y > ground + 0.3; }
    if (dy > -0.05) this.vy = 0;

    // engine sim
    const absV = Math.abs(this.speed);
    const gears = [0, 9, 17, 27, 40, 62];
    let g = 1; for (let i = 1; i < gears.length; i++) if (absV > gears[i] * 0.92) g = i + 1;
    g = clamp(g, 1, 5);
    this.gear = g;
    const lo = gears[g - 1], hi = gears[g];
    const rpmTarget = clamp(0.18 + (absV - lo) / (hi - lo) * 0.8, 0.15, 1.0) + throttle * 0.05;
    this.rpm = lerp(this.rpm, rpmTarget, 1 - Math.exp(-dt * 6));
    this.wheelSpin += this.speed * dt / 0.42;
    this.throttle = throttle; this.brake = brake; this.handbrake = handbrake;
    return this;
  }

  applyTo(car) {
    car.group.position.copy(this.pos);
    const e = new THREE.Euler(this.pitch * -1, this.heading, this.roll, 'YXZ');
    car.group.quaternion.setFromEuler(e);
    for (let i = 0; i < 4; i++) {
      const w = car.wheels[i];
      w.rotation.x = this.wheelSpin;
      if (i < 2) w.rotation.y = this.steer * 0.9;
    }
    // body lean into corners / squat under throttle
    car.body.rotation.z = -this.steer * this.speed * 0.0012 - this.lateral * 0.01;
    car.body.rotation.x = -(this.throttle * 0.008) + (this.brake * 0.012) * Math.sign(this.speed);
  }
}
