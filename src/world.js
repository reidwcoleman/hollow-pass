import * as THREE from 'three';
import { Road, buildRoadMesh, ROAD_WIDTH } from './road.js';
import { Terrain, baseHeight, terrainMaterial, WORLD_HALF } from './terrain.js';
import * as T from './textures.js';
import { spruceGeometry, deadTreeGeometry, boulderGeometry, merge, signMesh, deerMesh, figureMesh } from './props.js';
import { buildBridge, buildTunnel, buildGasStation, buildCemetery, buildOverlook, buildTower, placeAlong } from './setpieces.js';
import { buildSky, MOON_DIR } from './sky.js';
import { Simplex, mulberry32, clamp, smoothstep, lerp } from './noise.js';

const sx = new Simplex(2024);

export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.fixtures = [];
    this.pooled = [];
    this.time = 0;
    this.sections = [];
  }

  async build(progress) {
    const scene = this.scene;
    progress('Surveying the mountain…', 0.02);
    await tick();
    this.road = new Road(baseHeight);
    this.terrain = new Terrain(this.road);
    this.terrain.pads = [];
    const road = this.road, terrain = this.terrain;

    // Patch heightAt to honour flat pads for the set pieces.
    const rawHeight = terrain.heightAt.bind(terrain);
    terrain.heightAt = (x, z) => {
      let h = rawHeight(x, z);
      for (const p of terrain.pads) {
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < p.r + 30) {
          const w = 1 - smoothstep(p.r, p.r + 30, d);
          h = lerp(h, p.y, w);
        }
      }
      return h;
    };

    // Physics ground: on the bridge deck / tunnel floor the road wins over the terrain.
    this.groundAt = (x, z) => {
      const n = road.nearest(x, z, 40);
      if (n && (n.sample.bridge || n.sample.tunnel)) {
        const inner = ROAD_WIDTH / 2 + 1.7;
        if (n.d < inner) return n.y;
        if (n.sample.tunnel) return n.y + 0.35; // kerb / walkway
      }
      return terrain.heightAt(x, z);
    };
    /** Lateral limit for the car at (x,z): returns {limit, n} when a hard barrier (bridge rail, tunnel wall) applies. */
    this.barrierAt = (x, z) => {
      const n = road.nearest(x, z, 40);
      if (!n) return null;
      if (n.sample.bridge) return { limit: ROAD_WIDTH / 2 + 1.0, n };
      if (n.sample.tunnel) return { limit: ROAD_WIDTH / 2 + 1.2, n };
      return null;
    };

    progress('Painting textures…', 0.06);
    await tick();
    const tex = {
      asphalt: T.asphaltTextures(), snow: T.snowTextures(), rock: T.rockTextures(), tyre: T.tyreTextures(),
      concrete: T.concreteTextures(), bark: T.barkTextures(), stars: T.starTexture(), fogNoise: T.fogNoiseTexture(),
      plate: T.signTexture(['HLW 4471'], { bg: '#e8e6dc', fg: '#1a1a1a', w: 256, h: 72, border: true }),
    };
    this.tex = tex;

    // Sky + environment
    const sky = buildSky(tex.stars);
    this.sky = sky;
    scene.add(sky.mesh);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene(); envScene.add(sky.mesh.clone());
    const envRT = pmrem.fromScene(envScene, 0.02);
    this.envMap = envRT.texture;
    scene.environment = this.envMap;
    scene.environmentIntensity = 0.35;
    pmrem.dispose();

    // Fog: cold, blue-black, fairly dense — the views open up when the section script thins it.
    scene.fog = new THREE.FogExp2(0x0a0f1c, 0.0032);
    scene.background = null;

    // Materials
    const mats = this.mats = {
      asphalt: new THREE.MeshStandardMaterial({ map: tex.asphalt.map, roughnessMap: tex.asphalt.roughnessMap, normalMap: tex.asphalt.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 1, metalness: 0.0, color: 0xb8bcc4, envMapIntensity: 0.8 }),
      shoulder: new THREE.MeshStandardMaterial({ map: tex.snow.map, normalMap: tex.snow.normalMap, roughness: 0.9, color: 0x7d8288 }),
      paintYellow: new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.5, emissive: 0x6b5410, emissiveIntensity: 0.12 }),
      paintWhite: new THREE.MeshStandardMaterial({ color: 0xd9dbd6, roughness: 0.45, emissive: 0x555555, emissiveIntensity: 0.12 }),
      concrete: new THREE.MeshStandardMaterial({ map: tex.concrete.map, normalMap: tex.concrete.normalMap, roughness: 0.92, color: 0xb9b6ad }),
      concreteDark: new THREE.MeshStandardMaterial({ map: tex.concrete.map, normalMap: tex.concrete.normalMap, roughness: 0.95, color: 0x6a6862 }),
      tunnelWall: new THREE.MeshStandardMaterial({ map: tex.concrete.map, normalMap: tex.concrete.normalMap, roughness: 0.75, color: 0x9a968c, side: THREE.DoubleSide }),
      iron: new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.6, metalness: 0.85 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.9 }),
      stone: new THREE.MeshStandardMaterial({ map: tex.rock.map, normalMap: tex.rock.normalMap, roughness: 0.95, color: 0x8d8a84 }),
      rock: new THREE.MeshStandardMaterial({ map: tex.rock.map, normalMap: tex.rock.normalMap, roughness: 0.95, color: 0x9a9ea3 }),
      bark: new THREE.MeshStandardMaterial({ map: tex.bark.map, normalMap: tex.bark.normalMap, roughness: 0.95, color: 0x6a5a4c }),
      deadWood: new THREE.MeshStandardMaterial({ map: tex.bark.map, normalMap: tex.bark.normalMap, roughness: 1, color: 0x2a2523 }),
      foliage: new THREE.MeshStandardMaterial({ color: 0x0e2016, roughness: 0.95 }),
      snowCap: new THREE.MeshStandardMaterial({ map: tex.snow.map, color: 0xb4c0d4, roughness: 0.85 }),
      asphaltOld: new THREE.MeshStandardMaterial({ map: tex.asphalt.map, normalMap: tex.asphalt.normalMap, roughness: 0.95, color: 0x8a8d90 }),
      panelRust: new THREE.MeshStandardMaterial({ map: tex.concrete.map, color: 0x6b4a3a, roughness: 0.8, metalness: 0.4 }),
      brick: new THREE.MeshStandardMaterial({ map: tex.concrete.map, normalMap: tex.concrete.normalMap, color: 0x7a5a4c, roughness: 0.9 }),
      paintOld: new THREE.MeshStandardMaterial({ color: 0x4b5a63, roughness: 0.6, metalness: 0.5 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.95 }),
      woodOld: new THREE.MeshStandardMaterial({ map: tex.bark.map, color: 0x5a4a3a, roughness: 0.95 }),
    };
    mats.asphalt.roughness = 1.0;

    // ---- Plan the loop: where does everything go? ----
    progress('Planning the route…', 0.1);
    await tick();
    this._plan();

    progress('Raising the terrain…', 0.14);
    await tick();
    this.terrainMat = terrainMaterial(tex.snow, tex.rock);
    this.terrainGroup = terrain.build(this.terrainMat, () => {});
    scene.add(this.terrainGroup);
    progress('Far ranges…', 0.5);
    await tick();
    scene.add(this._farMountains());

    progress('Laying asphalt…', 0.55);
    await tick();
    this.roadGroup = buildRoadMesh(road, mats);
    scene.add(this.roadGroup);
    this._guardrails();

    progress('Planting the forest…', 0.62);
    await tick();
    this._forest();

    progress('Building set pieces…', 0.78);
    await tick();
    this._setPieces();

    progress('Moonrise…', 0.9);
    await tick();
    this._lights();
    this._snow();
    this._valleyFog();

    progress('Ready', 1);
  }

  _plan() {
    const road = this.road, terrain = this.terrain, N = road.count;
    const feat = terrain.features;
    const busy = [];
    const mark = (i, span) => busy.push([((i - span) % N + N) % N, (i + span) % N]);
    if (feat.bridge) mark(feat.bridge.mid, 90);
    if (feat.tunnel) mark(feat.tunnel.mid, 80);
    const isBusy = (i) => busy.some(([a, b]) => (a < b ? i >= a && i <= b : i >= a || i <= b));
    // overlook: highest road sample not busy
    let best = -1, bestY = -Infinity;
    for (let i = 0; i < N; i++) if (!isBusy(i) && road.samples[i].y > bestY) { bestY = road.samples[i].y; best = i; }
    this.overlookI = best; mark(best, 60);
    // straight, flat candidates for the gas station and cemetery
    const score = (i) => {
      let c = 0, g = 0;
      for (let k = -12; k <= 12; k++) { const s = road.samples[(i + k + N) % N]; c += Math.abs(s.curv); g += Math.abs(road.samples[(i + k + 1 + N) % N].y - s.y); }
      return c * 400 + g;
    };
    const pick = () => {
      let bi = -1, bs = Infinity;
      for (let i = 0; i < N; i += 3) if (!isBusy(i)) { const sc = score(i); if (sc < bs) { bs = sc; bi = i; } }
      mark(bi, 130);
      return bi;
    };
    this.gasI = pick();
    this.cemeteryI = pick();
    // dead woods: a 700 m stretch far from everything else
    let di = -1;
    for (let tries = 0; tries < 200; tries++) { const i = Math.floor(((tries * 37) % 100) / 100 * N); if (!isBusy(i) && !isBusy((i + 90) % N) && !isBusy((i - 90 + N) % N)) { di = i; break; } }
    if (di < 0) di = Math.floor(N * 0.8);
    this.deadI = di; mark(di, 100);
    // start: a calm spot ~500 m before the first feature encountered driving forward
    this.startI = (this.gasI + 250) % N;
    // side for pull-offs: put them on the side where the terrain is flatter (lower base height delta)
    const flatterSide = (i) => {
      const s = road.samples[i];
      const l = Math.abs(baseHeight(s.x + s.nx * 25, s.z + s.nz * 25) - s.y);
      const r = Math.abs(baseHeight(s.x - s.nx * 25, s.z - s.nz * 25) - s.y);
      return l < r ? 1 : -1;
    };
    this.gasSide = flatterSide(this.gasI);
    this.cemeterySide = flatterSide(this.cemeteryI);
    // overlook on the valley (lower) side
    { const s = road.samples[best]; const l = baseHeight(s.x + s.nx * 30, s.z + s.nz * 30); const r = baseHeight(s.x - s.nx * 30, s.z - s.nz * 30); this.overlookSide = l < r ? 1 : -1; }
    // tower: highest terrain within 260 m of the overlook, on the uphill side
    { const s = road.samples[best]; let tb = null, ty = -Infinity;
      for (let k = 0; k < 400; k++) { const a = Math.random() * Math.PI * 2, r = 80 + Math.random() * 200; const x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r; const n = road.nearest(x, z, 60); if (n && n.d < 30) continue; const y = baseHeight(x, z); if (y > ty) { ty = y; tb = [x, z]; } }
      this.towerXZ = tb; }
    // register pads now so the terrain is generated flat under them
    const padAt = (i, side, off, r) => { const s = road.samples[i]; return { x: s.x + s.nx * side * off, z: s.z + s.nz * side * off, r, y: s.y - 0.1 }; };
    terrain.pads.push(padAt(this.gasI, this.gasSide, 19, 26));
    terrain.pads.push(padAt(this.cemeteryI, this.cemeterySide, 22, 26));
    terrain.pads.push(padAt(best, this.overlookSide, 9, 22));

    const sOf = (i) => road.samples[i].s;
    const L = road.length;
    this.sections = [
      { name: 'Ashwood Road', s: sOf(this.startI), span: 300, sub: 'County Route 9 · no services next 60 km' },
      feat.bridge && { name: "Widow's Bridge", s: sOf(feat.bridge.a % N), span: 200, sub: '1931 · load limit 12 t', kind: 'bridge' },
      feat.tunnel && { name: 'Mercy Tunnel', s: sOf(feat.tunnel.a % N), span: 200, sub: 'headlights on', kind: 'tunnel' },
      { name: 'Hollow Pass', s: sOf(best) - 120, span: 320, sub: `summit · ${Math.round(bestY)} m`, kind: 'overlook' },
      { name: 'Last Chance Gas', s: sOf(this.gasI) - 100, span: 260, sub: 'closed', kind: 'gas' },
      { name: 'Hallow Chapel', s: sOf(this.cemeteryI) - 100, span: 260, sub: 'cemetery', kind: 'cemetery' },
      { name: 'The Burn', s: sOf(this.deadI) - 350, span: 700, sub: 'wildfire 2009', kind: 'dead' },
    ].filter(Boolean).map((sec) => ({ ...sec, s: ((sec.s % L) + L) % L }));
  }

  _farMountains() {
    const size = 12000, n = 120, sp = size / n;
    const pos = [], idx = [];
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const x = -size / 2 + i * sp, z = -size / 2 + j * sp;
      const r = Math.hypot(x, z);
      let y = baseHeight(x, z);
      // beyond the rim: bigger, colder peaks
      y += smoothstep(2300, 4200, r) * (sx.ridged(x / 2600 + 9, z / 2600 + 4, 4) * 900 + 200);
      y -= smoothstep(5200, 6000, r) * 600;
      pos.push(x, y, z);
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = -size / 2 + (i + 0.5) * sp, z = -size / 2 + (j + 0.5) * sp;
      if (Math.abs(x) < WORLD_HALF - 60 && Math.abs(z) < WORLD_HALF - 60) continue;
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xc8d2e4, roughness: 1, flatShading: false }));
    m.receiveShadow = false;
    return m;
  }

  _guardrails() {
    const road = this.road, terrain = this.terrain, N = road.count, mats = this.mats;
    const rails = [], posts = [], refl = [];
    const hw = ROAD_WIDTH / 2 + 1.5;
    for (let i = 0; i < N; i++) {
      const s = road.samples[i], s1 = road.samples[(i + 1) % N];
      if (s.bridge || s.tunnel) continue;
      for (const side of [-1, 1]) {
        const dropX = s.x + s.nx * side * 12, dropZ = s.z + s.nz * side * 12;
        const drop = s.y - terrain.heightAt(dropX, dropZ);
        if (drop < 2.5) continue; // only where there's a fall
        const x0 = s.x + s.nx * side * hw, z0 = s.z + s.nz * side * hw;
        const x1 = s1.x + s1.nx * side * hw, z1 = s1.z + s1.nz * side * hw;
        const len = Math.hypot(x1 - x0, z1 - z0) + 0.05;
        const yaw = Math.atan2(x1 - x0, z1 - z0);
        const beam = new THREE.BoxGeometry(0.08, 0.32, len);
        beam.rotateY(yaw); beam.translate((x0 + x1) / 2, (s.y + s1.y) / 2 + 0.62, (z0 + z1) / 2);
        rails.push(beam);
        if (i % 2 === 0) { const p = new THREE.BoxGeometry(0.1, 0.75, 0.14); p.rotateY(yaw); p.translate(x0, s.y + 0.36, z0); posts.push(p); }
        if (i % 10 === 0) { const r = new THREE.BoxGeometry(0.02, 0.08, 0.14); r.rotateY(yaw); r.translate(x0 - s.nx * side * 0.06, s.y + 0.72, z0 - s.nz * side * 0.06); refl.push(r); }
      }
      // delineator posts every 40 m on both sides where there's no rail
      if (i % 10 === 5) {
        for (const side of [-1, 1]) {
          const x0 = s.x + s.nx * side * (hw + 0.4), z0 = s.z + s.nz * side * (hw + 0.4);
          const y = terrain.heightAt(x0, z0);
          const p = new THREE.BoxGeometry(0.1, 1.2, 0.1); p.translate(x0, y + 0.6, z0); posts.push(p);
          const r = new THREE.BoxGeometry(0.11, 0.12, 0.11); r.translate(x0, y + 1.05, z0); refl.push(r);
        }
      }
    }
    if (rails.length) { const m = new THREE.Mesh(merge(rails), mats.steel); m.castShadow = true; m.receiveShadow = true; this.scene.add(m); }
    if (posts.length) { const m = new THREE.Mesh(merge(posts), new THREE.MeshStandardMaterial({ color: 0xcfd3d6, roughness: 0.6, metalness: 0.3 })); m.castShadow = true; this.scene.add(m); }
    if (refl.length) {
      const m = new THREE.Mesh(merge(refl), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff5030, emissiveIntensity: 0.6, roughness: 0.05, metalness: 0.9 }));
      this.scene.add(m);
    }
  }

  _forest() {
    const road = this.road, terrain = this.terrain, mats = this.mats, N = road.count;
    const rnd = mulberry32(99);
    const spruce = spruceGeometry();
    const MAXT = 32000;
    const trunkIM = new THREE.InstancedMesh(spruce.trunk, mats.bark, MAXT);
    const folIM = new THREE.InstancedMesh(spruce.foliage, mats.foliage, MAXT);
    const snowIM = new THREE.InstancedMesh(spruce.snow, mats.snowCap, MAXT);
    const deadGeos = [deadTreeGeometry(1), deadTreeGeometry(2), deadTreeGeometry(3)];
    const deadIMs = deadGeos.map((g) => new THREE.InstancedMesh(g, mats.deadWood, 1200));
    const rockGeos = [boulderGeometry(1), boulderGeometry(5), boulderGeometry(9)];
    const rockIMs = rockGeos.map((g) => new THREE.InstancedMesh(g, mats.rock, 900));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    let ti = 0; const di = [0, 0, 0], ri = [0, 0, 0];
    const deadS = road.samples[this.deadI].s, L = road.length;
    const inDead = (s) => { let d = Math.abs(s - deadS); d = Math.min(d, L - d); return d < 380; };
    const treeline = 760;
    // dense band along the road + sparse fill elsewhere
    const tryTree = (x, z) => {
      if (Math.abs(x) > WORLD_HALF - 40 || Math.abs(z) > WORLD_HALF - 40) return;
      const n = road.nearest(x, z, 60);
      if (n && n.d < 8.5) return;
      for (const pad of terrain.pads) if (Math.hypot(x - pad.x, z - pad.z) < pad.r + 6) return;
      const y = terrain.heightAt(x, z);
      const slope = terrain.slopeAt(x, z);
      if (slope > 0.95) { // steep: maybe a boulder
        if (rnd() < 0.15 && n && n.d < 60) { const k = Math.floor(rnd() * 3); if (ri[k] < 900) { const s = 0.8 + rnd() * 2.4; q.setFromEuler(new THREE.Euler(rnd() * 0.6, rnd() * 6.28, rnd() * 0.6)); p.set(x, y - s * 0.35, z); sc.set(s, s, s); m.compose(p, q, sc); rockIMs[k].setMatrixAt(ri[k]++, m); } }
        return;
      }
      const density = smoothstep(treeline, treeline - 140, y) * (0.55 + sx.fbm(x / 160, z / 160, 3) * 0.6);
      if (rnd() > density) return;
      const near = n ? n.s : -1;
      if (n && n.d < 420 && inDead(near)) {
        const k = Math.floor(rnd() * 3);
        if (di[k] >= 1200) return;
        const s = 0.7 + rnd() * 0.8;
        q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.12, rnd() * 6.28, (rnd() - 0.5) * 0.12));
        p.set(x, y - 0.2, z); sc.set(s, s, s); m.compose(p, q, sc);
        deadIMs[k].setMatrixAt(di[k]++, m);
        return;
      }
      if (ti >= MAXT) return;
      const s = 0.75 + rnd() * 0.9;
      q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.08, rnd() * 6.28, (rnd() - 0.5) * 0.08));
      p.set(x, y - 0.3, z); sc.set(s * (0.9 + rnd() * 0.3), s, s * (0.9 + rnd() * 0.3)); m.compose(p, q, sc);
      trunkIM.setMatrixAt(ti, m); folIM.setMatrixAt(ti, m); snowIM.setMatrixAt(ti, m); ti++;
    };
    // band along the road
    for (let i = 0; i < N; i += 1) {
      const s = road.samples[i];
      for (let k = 0; k < 7; k++) {
        const side = rnd() > 0.5 ? 1 : -1;
        const d = 10 + Math.pow(rnd(), 1.6) * 260;
        const along = (rnd() - 0.5) * 4;
        tryTree(s.x + s.nx * side * d + s.tx * along, s.z + s.nz * side * d + s.tz * along);
      }
    }
    // fill
    for (let k = 0; k < 26000; k++) tryTree((rnd() - 0.5) * 2 * (WORLD_HALF - 50), (rnd() - 0.5) * 2 * (WORLD_HALF - 50));
    trunkIM.count = folIM.count = snowIM.count = ti;
    for (const im of [trunkIM, folIM, snowIM]) { im.castShadow = im !== snowIM; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true; this.scene.add(im); }
    deadIMs.forEach((im, k) => { im.count = di[k]; im.castShadow = true; im.instanceMatrix.needsUpdate = true; this.scene.add(im); });
    rockIMs.forEach((im, k) => { im.count = ri[k]; im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true; this.scene.add(im); });
    this.treeCount = ti;
    // eyes in the dark: pairs of tiny emissive points among the trees, only visible when the car is far
    this._eyes();
  }

  _eyes() {
    const road = this.road, terrain = this.terrain, N = road.count;
    const rnd = mulberry32(31);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xd8f0ff, transparent: true, opacity: 0.9, fog: false });
    const geo = new THREE.SphereGeometry(0.035, 6, 6);
    const im = new THREE.InstancedMesh(geo, eyeMat, 120);
    const m = new THREE.Matrix4();
    this.eyes = [];
    for (let k = 0; k < 60; k++) {
      const i = Math.floor(rnd() * N), s = road.samples[i], side = rnd() > 0.5 ? 1 : -1, d = 14 + rnd() * 30;
      const x = s.x + s.nx * side * d, z = s.z + s.nz * side * d;
      const y = terrain.heightAt(x, z) + 0.35 + rnd() * 0.5;
      const ang = Math.atan2(s.x - x, s.z - z);
      const e = { x, y, z, ang, phase: rnd() * 10, blink: 2 + rnd() * 6 };
      this.eyes.push(e);
      for (const o of [-1, 1]) { m.makeTranslation(x + Math.cos(ang) * o * 0.05, y, z - Math.sin(ang) * o * 0.05); im.setMatrixAt(k * 2 + (o > 0 ? 1 : 0), m); }
    }
    im.instanceMatrix.needsUpdate = true;
    this.eyeMesh = im;
    this.scene.add(im);
  }

  _setPieces() {
    const road = this.road, terrain = this.terrain, mats = this.mats, N = road.count;
    const add = (r) => { this.scene.add(r.group); this.fixtures.push(...r.fixtures); if (r.sign) this.scene.add(r.sign); return r; };
    this.bridge = add(buildBridge(road, terrain, mats));
    this.tunnel = add(buildTunnel(road, terrain, mats));
    this.gas = add(buildGasStation(road, terrain, mats, road.samples[this.gasI].s, this.gasSide));
    this.cemetery = add(buildCemetery(road, terrain, mats, road.samples[this.cemeteryI].s, this.cemeterySide));
    this.overlook = add(buildOverlook(road, terrain, mats, road.samples[this.overlookI].s, this.overlookSide, road.samples[this.overlookI].y));
    if (this.towerXZ) this.tower = add(buildTower(terrain, mats, this.towerXZ[0], this.towerXZ[1]));
    // warning signs ahead of each section
    const signs = [
      [this.sections.find((s) => s.kind === 'bridge'), ['ICE ON', 'BRIDGE'], '#e8b800', '#111'],
      [this.sections.find((s) => s.kind === 'tunnel'), ['TUNNEL', 'LIGHTS ON'], '#e8b800', '#111'],
      [this.sections.find((s) => s.kind === 'overlook'), ['SCENIC', 'OVERLOOK'], '#0b3d1f', '#f4f7ec'],
      [this.sections.find((s) => s.kind === 'dead'), ['FALLING', 'ROCK'], '#e8b800', '#111'],
      [this.sections[0], ['NO SERVICES', 'NEXT 60 km'], '#f4f7ec', '#111'],
      [this.sections.find((s) => s.kind === 'cemetery'), ['NO', 'STOPPING'], '#f4f7ec', '#c00'],
    ];
    for (const [sec, lines, bg, fg] of signs) {
      if (!sec) continue;
      const tex = T.signTexture(lines, { bg, fg, w: 256, h: 256 });
      const sign = signMesh(tex, 1.3, 1.3, 2.0, mats);
      placeAlong(sign, road, sec.s - 80, -6.2, terrainDrop(terrain, road, sec.s - 80, -6.2), Math.PI);
      this.scene.add(sign);
    }
    // the figure in the burn and the deer
    this.figure2 = figureMesh(); this.figure2.visible = false; this.scene.add(this.figure2);
    this.deer = deerMesh(); this.deer.visible = false; this.scene.add(this.deer);
  }

  _lights() {
    const scene = this.scene;
    // Moon: cold directional light with a shadow frustum that follows the car
    const moon = new THREE.DirectionalLight(0xaabce8, 1.35);
    moon.position.copy(MOON_DIR).multiplyScalar(400);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const sc = moon.shadow.camera;
    sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 50; sc.far = 900;
    moon.shadow.bias = -0.0015; moon.shadow.normalBias = 0.6;
    scene.add(moon); scene.add(moon.target);
    this.moon = moon;
    const hemi = new THREE.HemisphereLight(0x2c3b5c, 0x0b0d12, 0.75);
    scene.add(hemi);
    this.hemi = hemi;
    // pooled point lights for fixtures
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.castShadow = false;
      scene.add(l);
      this.pooled.push({ light: l, fixture: null });
    }
  }

  _snow() {
    const COUNT = 9000;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 3), seed = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) { pos[i * 3] = Math.random() * 120 - 60; pos[i * 3 + 1] = Math.random() * 40 - 10; pos[i * 3 + 2] = Math.random() * 120 - 60; seed[i] = Math.random(); }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uSprite: { value: T.snowflakeSprite() },
        uLampPos: { value: new THREE.Vector3() }, uLampDir: { value: new THREE.Vector3(0, 0, 1) }, uWind: { value: new THREE.Vector3(1.5, 0, 0.5) },
        uIntensity: { value: 1.0 }, uPixelRatio: { value: 1 },
      },
      vertexShader: `
        attribute float seed; uniform float uTime; uniform vec3 uCenter; uniform vec3 uLampPos; uniform vec3 uLampDir; uniform vec3 uWind; uniform float uPixelRatio;
        varying float vLit; varying float vFade;
        void main(){
          vec3 p = position;
          float fall = 1.4 + seed * 1.6;
          p.y = mod(p.y - uTime * fall, 40.0) - 10.0;
          p.x += sin(uTime * (0.6 + seed) + seed * 40.0) * 0.6 + uTime * uWind.x * (0.5 + seed);
          p.z += cos(uTime * (0.5 + seed * 0.7) + seed * 20.0) * 0.6 + uTime * uWind.z * (0.5 + seed);
          // wrap around the camera in a 120 m box
          p.x = mod(p.x - uCenter.x + 60.0, 120.0) - 60.0 + uCenter.x;
          p.z = mod(p.z - uCenter.z + 60.0, 120.0) - 60.0 + uCenter.z;
          p.y += uCenter.y;
          // headlight cone illumination
          vec3 d = p - uLampPos; float dist = length(d); vec3 dn = d / max(dist, 0.001);
          float cone = smoothstep(0.80, 0.97, dot(dn, uLampDir));
          vLit = cone * 40.0 / (dist * dist + 6.0) ;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float dist2 = -mv.z;
          vFade = smoothstep(60.0, 20.0, dist2) * smoothstep(1.0, 5.0, dist2);
          gl_PointSize = (1.6 + seed * 2.2) * uPixelRatio * 70.0 / max(dist2, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uSprite; uniform float uIntensity; varying float vLit; varying float vFade;
        void main(){
          vec4 s = texture2D(uSprite, gl_PointCoord);
          float a = s.a * vFade * uIntensity;
          vec3 col = vec3(0.35, 0.42, 0.55) * 0.25 + vec3(1.0, 0.93, 0.8) * vLit;
          gl_FragColor = vec4(col * a, a);
        }`,
    });
    this.snow = new THREE.Points(geo, mat);
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);
  }

  _valleyFog() {
    // Two drifting cloud decks that sit in the valleys; from the pass they read as a sea of cloud.
    const road = this.road;
    let minY = Infinity, maxY = -Infinity;
    for (const s of road.samples) { minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y); }
    const mk = (y, scale, opacity, tint) => {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 }, uNoise: { value: this.tex.fogNoise }, uOpacity: { value: opacity }, uTint: { value: new THREE.Color(tint) }, uScale: { value: scale }, uCam: { value: new THREE.Vector3() } },
        vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
        fragmentShader: `
          uniform float uTime; uniform sampler2D uNoise; uniform float uOpacity; uniform vec3 uTint; uniform float uScale; uniform vec3 uCam;
          varying vec2 vUv; varying vec3 vW;
          void main(){
            vec2 uv = vUv * uScale;
            float n1 = texture2D(uNoise, uv + vec2(uTime*0.004, uTime*0.002)).r;
            float n2 = texture2D(uNoise, uv*2.3 - vec2(uTime*0.006, -uTime*0.003)).r;
            float n = smoothstep(0.35, 0.8, n1*0.65 + n2*0.35);
            float dist = length(vW.xz - uCam.xz);
            float near = smoothstep(30.0, 140.0, dist);
            float far = 1.0 - smoothstep(1500.0, 2600.0, dist);
            gl_FragColor = vec4(uTint, n * uOpacity * near * far);
          }`,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_HALF * 2.2, WORLD_HALF * 2.2, 1, 1), mat);
      m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = 3; m.frustumCulled = false;
      this.scene.add(m);
      return m;
    };
    this.fogDecks = [mk(minY + 25, 3.0, 0.85, 0x3a465e), mk(minY + 70, 2.0, 0.55, 0x2e3a52)];
    this.roadMinY = minY; this.roadMaxY = maxY;
  }

  /** Per-frame: fixtures flicker, pooled lights follow the car, snow + sky animate, moon shadow follows. */
  update(dt, carPos, camPos, headLampPos, headLampDir) {
    this.time += dt;
    const t = this.time;
    this.sky.uniforms.uTime.value = t;
    this.snow.material.uniforms.uTime.value = t;
    this.snow.material.uniforms.uCenter.value.copy(camPos);
    this.snow.material.uniforms.uLampPos.value.copy(headLampPos);
    this.snow.material.uniforms.uLampDir.value.copy(headLampDir);
    for (const d of this.fogDecks) { d.material.uniforms.uTime.value = t; d.material.uniforms.uCam.value.copy(camPos); }
    // moon shadow frustum follows the car
    this.moon.target.position.copy(carPos);
    this.moon.position.copy(carPos).addScaledVector(MOON_DIR, 400);
    // fixtures: compute flicker + assign nearest to pool
    const near = [];
    for (const f of this.fixtures) {
      const d = f.pos.distanceTo(carPos);
      f.dist = d;
      let k = 1;
      switch (f.flicker) {
        case 'sodium': k = 0.85 + 0.15 * Math.sin(t * 60 + f.pos.x) * Math.sin(t * 7.3 + f.pos.z) + (sx.noise2(t * 4, f.pos.x) > 0.55 ? -0.6 : 0); break;
        case 'strobe': k = sx.noise2(t * 9, f.pos.z) > 0.2 ? 1 : 0.05; break;
        case 'fluorescent': k = 0.7 + 0.3 * (sx.noise2(t * 30, f.pos.x) > -0.3 ? 1 : 0) + (sx.noise2(t * 3, f.pos.z) > 0.6 ? -0.65 : 0); break;
        case 'buzz': k = 0.8 + 0.2 * Math.sin(t * 120) * (sx.noise2(t * 5, 1) > 0 ? 1 : 0); break;
        case 'candle': k = 0.8 + 0.25 * sx.noise2(t * 6, f.pos.x); break;
        case 'beacon': k = (t % 2.0) < 0.35 ? 1 : 0.02; break;
        case 'dead': k = 0.02 + (sx.noise2(t * 12, 3) > 0.9 ? 1 : 0); break;
        default: k = 1;
      }
      if (f.forceOff) k = 0;
      f.k = Math.max(0, k);
      if (f.bulb) { const mat = f.bulb.isMaterial ? f.bulb : f.bulb.material; if (mat) mat.emissiveIntensity = (f.base ?? (f.base = mat.emissiveIntensity || 5)) * f.k; }
      if (d < f.range * 3.2) near.push(f);
    }
    near.sort((a, b) => a.dist - b.dist);
    for (let i = 0; i < this.pooled.length; i++) {
      const slot = this.pooled[i], f = near[i];
      if (!f) { slot.light.intensity = 0; slot.fixture = null; continue; }
      slot.light.position.copy(f.pos);
      slot.light.color.copy(f.color);
      slot.light.distance = f.range;
      slot.light.intensity = f.intensity * f.k;
      slot.fixture = f;
    }
    // eyes: only glow when the car is far enough and looking roughly from the road; vanish when lit
    if (this.eyeMesh) {
      let vis = 0;
      const m = new THREE.Matrix4();
      for (let k = 0; k < this.eyes.length; k++) {
        const e = this.eyes[k];
        const d = Math.hypot(e.x - carPos.x, e.z - carPos.z);
        const blink = Math.sin(t * 1.3 + e.phase) > 0.95 ? 0 : 1;
        const show = d > 22 && d < 90 && blink;
        const s = show ? 1 : 0.0001;
        for (const o of [-1, 1]) { m.makeScale(s, s, s); m.setPosition(e.x + Math.cos(e.ang) * o * 0.05, e.y, e.z - Math.sin(e.ang) * o * 0.05); this.eyeMesh.setMatrixAt(k * 2 + (o > 0 ? 1 : 0), m); }
        if (show) vis++;
      }
      this.eyeMesh.instanceMatrix.needsUpdate = true;
    }
  }
}

function terrainDrop(terrain, road, s, lateral) {
  const p = road.at(s);
  return terrain.heightAt(p.x + p.nx * lateral, p.z + p.nz * lateral) - p.y;
}

function tick() { return new Promise((r) => setTimeout(r, 0)); }
