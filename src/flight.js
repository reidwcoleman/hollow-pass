import * as THREE from 'three';
import { PostFX } from './postfx.js';
import { World } from './world.js';
import { Suit } from './suit.js';
import { SuitAudio } from './suitAudio.js';
import { SuitHud } from './suitHud.js';
import { clamp, lerp } from './noise.js';
import { buildFlightMap } from './flightMap.js';

const canvas = document.getElementById('c');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, 1, 0.1, 12000);
camera.layers.disable(2);
const fx = new PostFX(canvas, scene, camera);
const world = new World(scene, fx.renderer);
const audio = new SuitAudio();
const hud = new SuitHud(document.getElementById('hud2d'));

const status = document.getElementById('status');
const bar = document.querySelector('#bar i');
const startBtn = document.getElementById('start');
const title = document.getElementById('title');

const input = { fwd: 0, strafe: 0, up: 0, down: 0, boost: false, mouseDX: 0, mouseDY: 0, chargeHeld: false };
const keys = new Set();
let started = false, suit, map, ringIndex = 0, ringTime = 0, ringBest = null, minutes = 2 * 60 + 47;

async function init() {
  await world.build((msg, p) => { status.textContent = msg; bar.style.width = `${Math.round(p * 100)}%`; });
  // flight tuning of the world: long sight lines, brighter moon, no car-specific behaviour
  scene.fog.density = 0.00035;
  world.moon.intensity = 1.7;
  world.hemi.intensity = 0.9;
  map = buildFlightMap(world, scene);
  suit = new Suit(world, scene, camera, audio);
  scene.add(camera);
  suit.pos.copy(map.padPos); suit.pos.y += 0.05; suit.yaw = map.padYaw; suit.grounded = true;
  suit.update(0.016, input, world);
  await fx.renderer.compileAsync(scene, camera);
  fx.render(0.016);
  status.textContent = 'suit ready';
  startBtn.classList.add('ready');
  window.__ready = true;
}

function start() {
  if (started) return;
  started = true;
  audio.start(); audio.bootTone();
  title.classList.add('off');
  document.getElementById('hud2d').classList.add('on');
  hud.boot();
  try { const r = canvas.requestPointerLock && canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* headless */ }
  setTimeout(() => hud.message('HOLD SPACE TO LIFT OFF · SHIFT TO BOOST', 6), 3400);
}
startBtn.addEventListener('click', start);
canvas.addEventListener('click', () => { if (started && document.pointerLockElement !== canvas) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {} } });
window.addEventListener('keydown', (e) => { if (e.repeat) return; keys.add(e.code); if (e.code === 'Enter' && window.__ready) start(); if (e.code === 'KeyR' && started) resetToPad(); if (e.code === 'KeyM' && audio.master) { audio.master.gain.value = audio.master.gain.value > 0 ? 0 : 0.8; } });
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { input.mouseDX += e.movementX; input.mouseDY += e.movementY; } });
window.addEventListener('mousedown', (e) => { if (!started) return; if (document.pointerLockElement !== canvas) return; if (e.button === 0) suit.fire(1); else if (e.button === 2) suit.fire(-1); });
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('resize', () => fx.resize());

function resetToPad() { suit.pos.copy(map.padPos); suit.pos.y += 0.05; suit.vel.set(0, 0, 0); suit.grounded = true; suit.damage = 0; suit.power = 1; hud.message('RETURNED TO PAD', 2); }

function readInput() {
  input.fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 0.6 : 0);
  input.strafe = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  input.up = keys.has('Space') ? 1 : 0;
  input.down = keys.has('KeyC') || keys.has('ControlLeft') ? 1 : 0;
  input.boost = keys.has('ShiftLeft') || keys.has('ShiftRight');
}

const lampPos = new THREE.Vector3(), lampDir = new THREE.Vector3();
let last = performance.now(), acc = 0, frames = 0;
function loop(now) {
  let dt = clamp((now - last) / 1000, 0, 0.05); last = now;
  if (!started) dt = 0;
  readInput();
  if (started) {
    const sub = 2;
    for (let i = 0; i < sub; i++) { const dx = input.mouseDX / sub, dy = input.mouseDY / sub; const saved = [input.mouseDX, input.mouseDY]; input.mouseDX = dx; input.mouseDY = dy; suit.update(dt / sub, input, world); input.mouseDX = saved[0] - dx; input.mouseDY = saved[1] - dy; }
  }
  input.mouseDX = 0; input.mouseDY = 0;
  // world animation: traffic keeps driving the roads below; fixtures, snow, sky
  lampPos.copy(camera.position); lampDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
  world.update(dt || 0.016, suit ? suit.pos : camera.position, camera.position, lampPos, lampDir);
  if (world.traffic && started) world.traffic.update(dt, map.ghostCar(suit.pos), { onPass: () => {}, onVanish: () => {} });
  if (started) map.update(dt, suit, hud, audio);
  if (world.snow) world.snow.material.uniforms.uIntensity.value = clamp(1.2 - Math.max(0, suit ? suit.pos.y - 900 : 0) / 600, 0.2, 1.2);
  minutes += dt / 60 * 4;
  audio.update(dt || 0.016, suit || { thrustLevel: 0, speed: 0, boost: 0, grounded: true, charge: 0 });
  fx.renderer.toneMappingExposure = 1.35;
  fx.render(dt || 0.016);
  if (started) {
    const h = Math.floor(minutes / 60) % 24, m = Math.floor(minutes % 60);
    const temp = -8 - (suit.pos.y - 300) / 150;
    hud.draw(dt || 0.016, suit, camera, map.waypoints(suit), { time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, temp: `${temp.toFixed(1)}°C · ${Math.round(suit.speed * 3.6)} km/h`, ringInfo: map.ringInfo(), radar: map.radar() });
  }
  frames++; acc += dt;
  if (acc > 1.5) { const avg = acc / frames; if (avg > 0.021 && fx.scale > 0.5) fx.setScale(fx.scale - 0.1); else if (avg < 0.013 && fx.scale < 1) fx.setScale(fx.scale + 0.05); acc = 0; frames = 0; }
}
function frame(now) { requestAnimationFrame(frame); loop(now); }
init().then(() => requestAnimationFrame(frame));

window.__game = { scene, camera, world, get suit() { return suit; }, fx, input, start, keys, map: () => map };
window.__pump = (n = 60, dt = 1 / 60) => { let t = performance.now(); last = t; for (let i = 0; i < n; i++) { t += dt * 1000; loop(t); } };
window.__fly = (n, opts = {}) => { keys.clear(); if (opts.fwd) keys.add('KeyW'); if (opts.up) keys.add('Space'); if (opts.boost) keys.add('ShiftLeft'); if (opts.down) keys.add('KeyC'); if (opts.strafe) keys.add(opts.strafe > 0 ? 'KeyD' : 'KeyA'); for (let i = 0; i < n; i++) { input.mouseDX = (opts.dx || 0); input.mouseDY = (opts.dy || 0); window.__pump(1); } keys.clear(); };
window.__look = (yaw, pitch) => { suit.yaw = yaw; suit.pitch = pitch; };
window.__tp = (x, y, z) => { suit.pos.set(x, y, z); suit.vel.set(0, 0, 0); suit.grounded = false; };
