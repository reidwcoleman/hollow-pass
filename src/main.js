import * as THREE from 'three';
import { PostFX } from './postfx.js';
import { World } from './world.js';
import { buildCar, CarPhysics } from './car.js';
import { GameAudio } from './audio.js';
import { Events, HUD } from './events.js';
import { clamp, lerp } from './noise.js';
import { Puffs } from './particles.js';

const canvas = document.getElementById('c');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 9000);
camera.layers.disable(2); // layer 2 = shadow-only proxies
const fx = new PostFX(canvas, scene, camera);
const world = new World(scene, fx.renderer);
const audio = new GameAudio();
const hud = new HUD();

const status = document.getElementById('status');
const bar = document.querySelector('#bar i');
const startBtn = document.getElementById('start');
const title = document.getElementById('title');
const glass = document.getElementById('glass');
const glassCtx = glass.getContext('2d');
let frostImg = null, breath = 0, handprint = 0;
function drawGlass(dt) {
  const on = camMode === 1;
  glass.classList.toggle('on', on);
  if (!on) return;
  const W = glass.width = window.innerWidth, H = glass.height = window.innerHeight;
  if (!frostImg) frostImg = world.tex.frost.image;
  const ctx = glassCtx;
  ctx.clearRect(0, 0, W, H);
  ctx.globalAlpha = 0.22;
  ctx.drawImage(frostImg, 0, 0, W, H);
  // breath fog grows when stopped, clears with speed
  const spd = Math.abs(physics.speed);
  breath = clamp(breath + (spd < 1 ? dt * 0.06 : -dt * 0.15), 0, 0.5);
  if (breath > 0.01) { const g = ctx.createRadialGradient(W * 0.6, H * 0.75, 0, W * 0.6, H * 0.75, H * 0.7); g.addColorStop(0, `rgba(210,222,240,${breath})`); g.addColorStop(1, 'rgba(210,222,240,0)'); ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
  if (handprint > 0) {
    // a hand pressed against the outside of the glass, fading
    handprint = Math.max(0, handprint - dt * 0.12);
    ctx.globalAlpha = Math.min(1, handprint * 1.6) * 0.5;
    ctx.filter = 'blur(3px)';
    ctx.fillStyle = 'rgba(150,160,180,0.5)';
    const hx = W * 0.64, hy = H * 0.4, sc = H / 1400;
    ctx.beginPath(); ctx.ellipse(hx, hy + 70 * sc, 55 * sc, 75 * sc, 0.1, 0, Math.PI * 2); ctx.fill();
    for (const [dx, dy, l, a] of [[-48, -20, 95, -0.55], [-18, -55, 125, -0.2], [12, -62, 135, 0.0], [40, -50, 120, 0.22], [64, 5, 70, 1.1]]) {
      ctx.save(); ctx.translate(hx + dx * sc, hy + dy * sc); ctx.rotate(a); ctx.beginPath(); ctx.ellipse(0, -l * sc * 0.45, 16 * sc, l * sc * 0.55, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
  }
  ctx.globalAlpha = 1; ctx.filter = 'none';
}
window.__handprint = () => { handprint = 1; };

const input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const keys = new Set();
let camMode = 0; // 0 chase, 1 hood, 2 cinematic
let autopilot = false;
let headlights = true;
let muted = false;
let started = false;

let car, carMesh, physics, events, spray, vapour;
const _w = new THREE.Vector3(), _w2 = new THREE.Vector3();

async function init() {
  await world.build((msg, p) => { status.textContent = msg; bar.style.width = `${Math.round(p * 100)}%`; });
  carMesh = buildCar(world.tex, world.envMap);
  scene.add(carMesh.group);
  physics = new CarPhysics(world.terrain, world.road, world);
  physics.placeOnRoad(world.road.samples[world.startI].s, -2.2);
  physics.applyTo(carMesh);
  events = new Events(world, physics, carMesh, audio, hud, fx);
  spray = new Puffs(scene, 700, { color: 0xe6eef8, size: 1.6 });
  vapour = new Puffs(scene, 300, { color: 0xb8c0cc, size: 0.6 });
  events.setHeadlightsWanted(true);
  // pre-position camera
  updateCamera(0.1, true);
  // warm the shaders once so the first frame doesn't hitch
  await fx.renderer.compileAsync(scene, camera);
  fx.render(0.016);
  status.textContent = 'engine warm';
  startBtn.classList.add('ready');
  window.__ready = true;
}

function start() {
  if (started) return;
  started = true;
  audio.start();
  title.classList.add('off');
  document.getElementById('hud').classList.add('on');
  document.getElementById('hint').classList.add('on');
  setTimeout(() => document.getElementById('hint').classList.remove('on'), 9000);
  setTimeout(() => hud.toast(world.sections[0].name, world.sections[0].sub), 1200);
}
startBtn.addEventListener('click', start);
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'Enter' && window.__ready) start();
  if (!started) return;
  if (e.code === 'KeyV') camMode = (camMode + 1) % 3;
  if (e.code === 'KeyH') { headlights = !headlights; carMesh.setHeadlights(headlights); events.setHeadlightsWanted(headlights); }
  if (e.code === 'KeyM') { muted = !muted; if (audio.master) audio.master.gain.value = muted ? 0 : 0.7; }
  if (e.code === 'KeyR') { physics.placeOnRoad(physics.roadS, -2.2); physics.pitch = physics.roll = 0; }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('resize', () => fx.resize());
// touch: simple tap zones (left/right halves steer, top accelerates)
let touch = null;
canvas.addEventListener('touchstart', (e) => { touch = e.touches[0]; if (!started && window.__ready) start(); }, { passive: true });
canvas.addEventListener('touchmove', (e) => { touch = e.touches[0]; }, { passive: true });
canvas.addEventListener('touchend', () => { touch = null; }, { passive: true });

function readInput(dt) {
  const up = keys.has('KeyW') || keys.has('ArrowUp'), down = keys.has('KeyS') || keys.has('ArrowDown');
  const left = keys.has('KeyA') || keys.has('ArrowLeft'), right = keys.has('KeyD') || keys.has('ArrowRight');
  let steer = (left ? 1 : 0) - (right ? 1 : 0);
  let thr = up ? 1 : 0, brk = down ? 1 : 0;
  if (touch) {
    const nx = touch.clientX / window.innerWidth, ny = touch.clientY / window.innerHeight;
    steer = clamp((0.5 - nx) * 3, -1, 1);
    thr = ny < 0.7 ? 1 : 0; brk = ny >= 0.7 ? 1 : 0;
  }
  if (autopilot && physics) {
    // stay in the right lane, look ahead 25 m
    const ahead = world.road.at(physics.roadS + 25);
    const tx = ahead.x - ahead.nx * 2.1, tz = ahead.z - ahead.nz * 2.1;
    const want = Math.atan2(tx - physics.pos.x, tz - physics.pos.z);
    let err = want - physics.heading; err = Math.atan2(Math.sin(err), Math.cos(err));
    steer = clamp(err * 2.2, -1, 1);
    const spd = Math.abs(physics.speed);
    thr = spd < 17 ? 1 : 0; brk = spd > 21 ? 1 : 0;
  }
  input.steer = lerp(input.steer, steer, 1 - Math.exp(-dt * 12));
  input.throttle = lerp(input.throttle, thr, 1 - Math.exp(-dt * 8));
  input.brake = brk;
  input.handbrake = keys.has('Space');
}

const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
let idleT = 0, shake = 0, hitShake = 0, damage = 0, lastHit = 0;
function onImpact(strength) {
  hitShake = Math.max(hitShake, strength * 0.9);
  const now = performance.now();
  if (now - lastHit > 250) {
    lastHit = now;
    audio.thud(strength);
    if (strength > 0.35) { hud.pulse(); damage = Math.min(1, damage + strength * 0.25); }
    if (strength > 0.6) events.flicker(0.3 + strength * 0.4);
  }
}
function updateCamera(dt, snap = false) {
  const p = physics.pos, h = physics.heading;
  const fx_ = Math.sin(h), fz = Math.cos(h);
  const spd = Math.abs(physics.speed);
  const stopped = spd < 0.4 && input.throttle < 0.05;
  idleT = stopped ? idleT + dt : 0;
  let target, look, fov = 62;
  if (camMode === 3) {
    return; // free camera (debug)
  } else if (camMode === 1) {
    // hood cam, in the car's own frame so pitch/roll carry through
    carMesh.group.updateMatrixWorld(true);
    target = tmp.set(0.0, 1.42, 1.55).applyMatrix4(carMesh.group.matrixWorld);
    look = tmp2.set(physics.steer * 2.5, 1.05, 40).applyMatrix4(carMesh.group.matrixWorld);
    fov = 72;
    camera.position.copy(target);
    camera.up.set(0, 1, 0).applyQuaternion(carMesh.group.quaternion).lerp(new THREE.Vector3(0, 1, 0), 0.5).normalize();
    camera.lookAt(look);
    camera.up.set(0, 1, 0);
  } else if (camMode === 2 || idleT > 7) {
    // slow orbit
    const a = world.time * 0.12 + 1.2;
    const r = 9 + Math.sin(world.time * 0.07) * 2;
    target = tmp.set(p.x + Math.cos(a) * r, p.y + 2.6 + Math.sin(world.time * 0.1) * 0.8, p.z + Math.sin(a) * r);
    look = tmp2.set(p.x, p.y + 1.0, p.z);
    camPos.lerp(target, snap ? 1 : 1 - Math.exp(-dt * 1.5));
    camLook.lerp(look, snap ? 1 : 1 - Math.exp(-dt * 2));
    camera.position.copy(camPos); camera.lookAt(camLook);
    fov = 48;
  } else {
    // chase cam: hangs back with speed, drifts sideways on slip, looks a little into the turn
    const back = 7.2 + spd * 0.06;
    const lat = -physics.lateral * 0.15 + physics.steer * spd * 0.03;
    target = tmp.set(p.x - fx_ * back + (-fz) * lat, p.y + 2.45 + spd * 0.01, p.z - fz * back + fx_ * lat);
    // keep the camera above the ground, and inside the bore in the tunnel
    const g = world.groundAt(target.x, target.z);
    if (target.y < g + 1.2) target.y = g + 1.2;
    const bn = world.road.nearest(target.x, target.z, 40);
    if (bn && bn.sample.tunnel) {
      const s = bn.sample;
      const lat = (target.x - s.x) * s.nx + (target.z - s.z) * s.nz;
      const maxLat = 3.6;
      if (Math.abs(lat) > maxLat) { const push = (Math.abs(lat) - maxLat) * Math.sign(lat); target.x -= s.nx * push; target.z -= s.nz * push; }
      target.y = Math.min(target.y, bn.y + 3.6);
    }
    look = tmp2.set(p.x + fx_ * 6 + (-fz) * physics.steer * 3, p.y + 1.1, p.z + fz * 6 + fx_ * physics.steer * 3);
    const k = snap ? 1 : 1 - Math.exp(-dt * 5.5);
    camPos.lerp(target, k); camLook.lerp(look, snap ? 1 : 1 - Math.exp(-dt * 8));
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    fov = 62 + spd * 0.22;
  }
  // road texture shake at speed / off-road
  shake = lerp(shake, (physics.onRoad ? 0.002 : 0.02) * spd, 1 - Math.exp(-dt * 4));
  hitShake *= Math.exp(-dt * 4);
  camera.position.y += (Math.random() - 0.5) * (shake + hitShake * 0.5);
  camera.position.x += (Math.random() - 0.5) * hitShake * 0.4;
  camera.rotation.z += (Math.random() - 0.5) * hitShake * 0.03;
  camera.fov = lerp(camera.fov, fov, snap ? 1 : 1 - Math.exp(-dt * 3));
  camera.updateProjectionMatrix();
}

const lampPos = new THREE.Vector3(), lampDir = new THREE.Vector3();
let last = performance.now(), acc = 0, frames = 0, slow = 0;
function frame(now) {
  requestAnimationFrame(frame);
  loop(now);
}
const prof = window.__prof = { physics: 0, world: 0, events: 0, traffic: 0, render: 0, particles: 0, frames: 0 };
const P = () => performance.now();
function loop(now) {
  prof.frames++; let _t = P();
  let dt = clamp((now - last) / 1000, 0, 0.05);
  last = now;
  if (!started) { dt = 0; }
  readInput(dt || 0.016);
  if (events && events.ctx.stalled) { input.throttle = 0; physics.rpm = lerp(physics.rpm, 0, 0.1); }
  if (started) {
    const sub = 2;
    for (let i = 0; i < sub; i++) physics.step(dt / sub, input);
    prof.physics += P() - _t; _t = P();
    // solid world: trees, rocks, posts, buildings and other vehicles
    const dyn = world.traffic ? world.traffic.obstacles() : [];
    const impact = world.obstacles.resolve(physics, dyn);
    if (impact > 0.02) onImpact(impact);
    physics.applyTo(carMesh);
    if (world.traffic) world.traffic.update(dt, physics, { onPass: (v) => events.onPass(v), onVanish: (v) => events.onVanish(v) });
    prof.traffic += P() - _t; _t = P();
  }
  world.time += 0;
  updateCamera(dt || 0.016);
  carMesh.group.updateMatrixWorld(true);
  lampPos.set(0, 0.95, 2.4).applyMatrix4(carMesh.group.matrixWorld);
  lampDir.set(0, -0.06, 1).transformDirection(carMesh.group.matrixWorld);
  world.update(dt || 0.016, physics.pos, camera.position, lampPos, lampDir);
  prof.world += P() - _t; _t = P();
  // snow spray from the rear wheels, exhaust vapour in the cold
  if (started) {
    const spd = Math.abs(physics.speed);
    const sprayRate = (physics.onRoad ? 0.35 : 1.6) * clamp(spd / 20, 0, 1.4) + physics.slip * 3 + (input.handbrake && spd > 3 ? 2 : 0);
    const n = Math.floor(sprayRate * 5 * dt * 60 * 0.25 + Math.random());
    for (let i = 0; i < n; i++) {
      const w = carMesh.wheels[2 + (i & 1)];
      _w.copy(w.userData.base).applyMatrix4(carMesh.group.matrixWorld);
      _w2.set((Math.random() - 0.5) * 1.5, 0.8 + Math.random() * 1.6, -2.5 - Math.random() * 3 - spd * 0.15).applyQuaternion(carMesh.group.quaternion);
      spray.emit(_w.x + (Math.random() - 0.5) * 0.3, _w.y - 0.3, _w.z, _w2.x, _w2.y, _w2.z, 0.6 + Math.random() * 0.6, 0.6 + Math.random() * 0.8);
    }
    if (Math.random() < 0.55 + physics.rpm * 0.4) {
      _w.set(-0.6, 0.4, -2.55).applyMatrix4(carMesh.group.matrixWorld);
      _w2.set((Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.5, -1.5 - spd * 0.9).applyQuaternion(carMesh.group.quaternion);
      vapour.emit(_w.x, _w.y, _w.z, _w2.x, _w2.y, _w2.z, 1.2 + Math.random(), 0.5);
    }
    spray.update(dt, 2.5, -4.0);
    vapour.update(dt, 1.5, 0.6);
  }
  prof.particles += P() - _t; _t = P();
  // tail lights brighten under braking
  carMesh.tailLampMat.emissiveIntensity = input.brake > 0.5 ? 9 : 2.2;
  carMesh.tailGlow.intensity = input.brake > 0.5 ? 9 : 2.5;
  carMesh.amberMat.emissiveIntensity = 0;
  const ctx = events.update(dt || 0.016);
  prof.events += P() - _t; _t = P();
  audio.update(dt || 0.016, physics, ctx);
  hud.update(dt || 0.016, physics, ctx);
  // exposure: darker in the tunnel entrance, a touch brighter at the summit
  fx.renderer.toneMappingExposure = lerp(fx.renderer.toneMappingExposure, ctx.inTunnel ? 1.0 : 1.15, 0.02);
  drawGlass(dt || 0.016);
  _t = P();
  fx.render(dt || 0.016);
  prof.render += P() - _t;
  // adaptive resolution
  frames++; acc += dt;
  if (acc > 1.5) { const avg = acc / frames; if (avg > 0.021 && fx.scale > 0.5) { fx.setScale(fx.scale - 0.1); } else if (avg < 0.013 && fx.scale < 1) fx.setScale(fx.scale + 0.05); acc = 0; frames = 0; }
}

init().then(() => requestAnimationFrame(frame));

// ---- debug hooks (headless screenshots / driving without rAF) ----
window.__game = { scene, camera, world, get physics() { return physics; }, get car() { return carMesh; }, fx, events: () => events, input, start, setCam: (m) => { camMode = m; } };
window.__grab = (q = 0.9) => { fx.render(0.016); return canvas.toDataURL('image/jpeg', q); };
window.__pump = (n = 60, dt = 1 / 60) => { let t = performance.now(); last = t; for (let i = 0; i < n; i++) { t += dt * 1000; loop(t); } };
window.__cam = (x, y, z, lx, ly, lz) => { camMode = 3; camera.position.set(x, y, z); camera.lookAt(lx, ly, lz); camera.fov = 60; camera.updateProjectionMatrix(); };
window.__auto = (n) => { autopilot = true; window.__pump(n); autopilot = false; };
window.__teleport = (s, off = -2.2) => { physics.placeOnRoad(s, off); physics.applyTo(carMesh); updateCamera(0.1, true); };
window.__drive = (n, thr = 1, steer = 0) => { keys.clear(); if (thr > 0) keys.add('KeyW'); if (steer > 0) keys.add('KeyA'); if (steer < 0) keys.add('KeyD'); window.__pump(n); keys.clear(); };
