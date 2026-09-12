import * as THREE from 'three';
import { Road, buildRoadMesh, ROAD_WIDTH } from './road.js';
import { Terrain, baseHeight, terrainMaterial, WORLD_HALF } from './terrain.js';
import * as T from './textures.js';
import { spruceCardGeometry, spruceGeometry, deadTreeGeometry, boulderGeometry, merge, signMesh, deerMesh, figureMesh } from './props.js';
import { ObstacleField } from './collision.js';
import { Traffic } from './traffic.js';
import { buildBridge, buildTunnel, buildGasStation, buildCemetery, buildOverlook, buildTower, placeAlong, buildVillage, buildMine, buildAvalanche, buildFallenTree, buildIceSheen, buildConvoy } from './setpieces.js';
import { buildVehicle } from './traffic.js';
import { buildSky, MOON_DIR } from './sky.js';
import { Simplex, mulberry32, clamp, smoothstep, lerp } from './noise.js';

const sx = new Simplex(2024);

export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.fixtures = [];
    this.pooled = [];
    this.obstacles = new ObstacleField(24);
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
      const side = n.lateral > 0 ? 'railL' : 'railR';
      if (n.sample[side]) return { limit: ROAD_WIDTH / 2 + 1.35, n, oneSided: n.lateral > 0 ? 1 : -1 };
      return null;
    };

    progress('Painting textures…', 0.06);
    await tick();
    const tex = {
      asphalt: T.asphaltTextures(), snow: T.snowTextures(), rock: T.rockTextures(), tyre: T.tyreTextures(),
      concrete: T.concreteTextures(), bark: T.barkTextures(), stars: T.starTexture(), fogNoise: T.fogNoiseTexture(),
      plate: T.signTexture(['HLW 4471'], { bg: '#e8e6dc', fg: '#1a1a1a', w: 256, h: 72, border: true }),
      branch: T.branchTexture(), ice: T.iceTextures(), frost: T.frostTexture(),
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
      branch: new THREE.MeshStandardMaterial({ map: tex.branch, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95, color: 0xdde4ec, shadowSide: THREE.DoubleSide }),
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

    this._biomes();

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

    progress('Frozen lake…', 0.86);
    await tick();
    this._lake();
    this.traffic = new Traffic(this, this.scene, this.envMap);

    progress('Moonrise…', 0.9);
    await tick();
    this._lights();
    this._snow();
    this._valleyFog();
    this._groundFog();

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


  /** Label free stretches of the loop so the scenery keeps changing: forest, canyon, alpine, lake, open. */
  _biomes() {
    const road = this.road, terrain = this.terrain, N = road.count;
    const feat = terrain.features;
    const busy = new Uint8Array(N);
    const mark = (i0, span) => { const i = Math.floor(i0); for (let k = -span; k <= span; k++) busy[((i + k) % N + N) % N] = 1; };
    for (const b of feat.bridges) mark(b.mid, Math.ceil((b.b - b.a) / 2) + 60);
    for (const t of feat.tunnels) mark(t.mid, Math.ceil((t.b - t.a) / 2) + 50);
    mark(this.overlookI, 70); mark(this.gasI, 90); mark(this.cemeteryI, 90); mark(this.deadI, 110);
    for (let i = 0; i < N; i++) road.samples[i].biome = 'open';
    // free runs
    const runs = [];
    let start = -1;
    for (let i = 0; i < N * 2; i++) {
      const free = !busy[i % N];
      if (free && start < 0) start = i;
      if (!free && start >= 0) { if (start < N) runs.push([start, i]); start = -1; }
    }
    runs.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
    const meanY = ([a, b]) => { let acc = 0; for (let i = a; i < b; i++) acc += road.samples[i % N].y; return acc / (b - a); };
    const label = (a, b, name) => { for (let i = a; i < b; i++) road.samples[i % N].biome = name; };
    const used = new Set();
    // longest run: forest then canyon (each at least 400 m)
    if (runs[0]) { const [a, b] = runs[0]; const m = Math.floor((a + b) / 2); label(a + 10, m - 10, 'forest'); label(m + 10, b - 10, 'canyon'); used.add(runs[0]); }
    const rest = runs.filter((r) => !used.has(r) && r[1] - r[0] > 60);
    if (rest.length) { rest.sort((p, q) => meanY(q) - meanY(p)); const [a, b] = rest[0]; label(a + 8, b - 8, 'alpine'); used.add(rest[0]); }
    const rest2 = runs.filter((r) => !used.has(r) && r[1] - r[0] > 60);
    if (rest2.length) { rest2.sort((p, q) => meanY(p) - meanY(q)); const [a, b] = rest2[0]; label(a + 8, b - 8, 'lake'); used.add(rest2[0]); this.lakeRun = [a, b]; }
    // village on a flat-ish run of at least 300 m, ridge on the highest remaining run, more forest elsewhere
    const rest3 = runs.filter((r) => !used.has(r) && r[1] - r[0] > 75);
    if (rest3.length) {
      const [a, b] = rest3[0]; used.add(rest3[0]);
      label(a + 8, b - 8, 'village');
      this.villageRun = [a + 8, b - 8];
    }
    const rest4 = runs.filter((r) => !used.has(r) && r[1] - r[0] > 60);
    if (rest4.length) { rest4.sort((p, q) => meanY(q) - meanY(p)); const [a, b] = rest4[0]; used.add(rest4[0]); label(a + 8, b - 8, 'ridge'); }
    for (const r of runs) if (!used.has(r) && r[1] - r[0] > 40) { label(r[0] + 6, r[1] - 6, 'forest'); }
    // extras inside biomes: avalanche debris near the end of the alpine run, black ice on the last 220 m of the lake run,
    // a fallen tree in the first forest run, a mine in the canyon, a convoy on the flats
    const findRun = (name) => { let a = -1; for (let i = 0; i < N * 2; i++) { const isB = road.samples[i % N].biome === name; if (isB && a < 0) a = i; if (!isB && a >= 0) return [a, i]; } return null; };
    const alp = findRun('alpine'); if (alp && alp[1] - alp[0] > 120) { this.avalancheI = alp[1] - 70; this.convoyI = alp[0] + 30; }
    const lk = findRun('lake'); if (lk && lk[1] - lk[0] > 50) { this.iceRun = [lk[1] - 45, lk[1] - 4]; for (let i = this.iceRun[0]; i < this.iceRun[1]; i++) road.samples[i % N].ice = true; }
    const fr = findRun('forest'); if (fr && fr[1] - fr[0] > 80) this.fallenI = fr[0] + Math.floor((fr[1] - fr[0]) * 0.6);
    const cn = findRun('canyon'); if (cn && cn[1] - cn[0] > 60) this.mineI = cn[0] + Math.floor((cn[1] - cn[0]) * 0.45);
    // village layout is planned now so its pads flatten the terrain before it is built
    if (this.villageRun) {
      const [a, b] = this.villageRun;
      const rnd = mulberry32(4141);
      this.villagePlan = { s: road.samples[a % N].s, len: (b - a) * 4 };
      let ss = this.villagePlan.s + 40, k = 0;
      while (ss < this.villagePlan.s + this.villagePlan.len - 40) {
        const side = k % 2 === 0 ? 1 : -1;
        const p = road.at(ss);
        const w = 7 + rnd() * 4, d = 6 + rnd() * 3; rnd(); // h
        const off = side * (ROAD_WIDTH / 2 + 7 + rnd() * 4);
        const cx = p.x + p.nx * off, cz = p.z + p.nz * off;
        terrain.pads.push({ x: cx, z: cz, r: Math.max(w, d) * 0.7 + 2, y: p.y - 0.4 });
        rnd(); // yaw jitter
        ss += 34 + rnd() * 30; k++;
      }
      const pc = road.at(this.villagePlan.s + this.villagePlan.len - 60);
      terrain.pads.push({ x: pc.x + pc.nx * (ROAD_WIDTH / 2 + 14), z: pc.z + pc.nz * (ROAD_WIDTH / 2 + 14), r: 14, y: pc.y - 0.5 });
    }
    if (this.mineI !== undefined) { const p = road.samples[this.mineI % N]; const side = 1; this.mineSide = side; terrain.pads.push({ x: p.x + p.nx * side * (ROAD_WIDTH / 2 + 7), z: p.z + p.nz * side * (ROAD_WIDTH / 2 + 7), r: 6, y: p.y }); }
    // lake geometry: a basin on the flatter side of the lake run
    if (this.lakeRun) {
      const [a, b] = this.lakeRun; const mi = Math.floor((a + b) / 2) % N; const sm = road.samples[mi];
      const l = baseHeight(sm.x + sm.nx * 120, sm.z + sm.nz * 120), r = baseHeight(sm.x - sm.nx * 120, sm.z - sm.nz * 120);
      const side = l < r ? 1 : -1;
      const rad = Math.min(220, (b - a) * 4 * 0.45);
      const cx = sm.x + sm.nx * side * (rad + 6), cz = sm.z + sm.nz * side * (rad + 6);
      this.lake = { x: cx, z: cz, r: rad, y: sm.y - 1.2, side, i: mi };
      terrain.lakes = [this.lake];
      this.lakeSide = side;
    }
    // section labels for the HUD
    const sOf = (i) => road.samples[i % N].s;
    const add = (name, a, sub, kind) => this.sections.push({ name, s: sOf(a), span: 260, sub, kind });
    let last = null;
    for (let i = 0; i < N; i++) {
      const bm = road.samples[i].biome;
      if (bm !== last) {
        if (bm === 'forest') add('Blackwood', i, 'old growth · watch for moose', 'forest');
        if (bm === 'canyon') add("Devil's Throat", i, 'rockfall zone · no stopping', 'canyon');
        if (bm === 'alpine') add('Ptarmigan Flats', i, 'exposed · high wind', 'alpine');
        if (bm === 'lake') add('Lake Nowhere', i, 'thin ice', 'lake');
        if (bm === 'village') add('Ashwood', i, 'pop. 212 · no through road', 'village');
        if (bm === 'ridge') add('The Spine', i, 'no guardrail · 300 m drop', 'ridge');
        last = bm;
      }
    }
  }

  _lake() {
    if (!this.lake) return;
    const lk = this.lake;
    const geo = new THREE.CircleGeometry(lk.r + 30, 96);
    geo.rotateX(-Math.PI / 2);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i) * 6);
    const mat = new THREE.MeshPhysicalMaterial({
      map: this.tex.ice.map, roughnessMap: this.tex.ice.roughnessMap, normalMap: this.tex.ice.normalMap, normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: 1, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.15, envMap: this.envMap, envMapIntensity: 1.8, color: 0xbfd0e8,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(lk.x, lk.y, lk.z);
    m.receiveShadow = true;
    this.scene.add(m);
    // an ice-fishing hut with one lit window, far out on the ice
    const hut = new THREE.Group();
    hut.position.set(lk.x + lk.r * 0.35, lk.y, lk.z - lk.r * 0.2);
    const walls = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 2.8), this.mats.woodOld); walls.position.y = 1.1; walls.castShadow = true; hut.add(walls);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.2, 3.2), this.mats.panelRust); roof.position.y = 2.3; hut.add(roof);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.5), new THREE.MeshStandardMaterial({ color: 0x201000, emissive: 0xffb050, emissiveIntensity: 3 }));
    win.position.set(0, 1.3, 1.41); hut.add(win);
    this.scene.add(hut);
    this.fixtures.push({ pos: new THREE.Vector3(hut.position.x, lk.y + 1.3, hut.position.z + 1.5), color: new THREE.Color(0xffb050), intensity: 30, range: 14, flicker: 'candle', bulb: win });
    this.obstacles.add(hut.position.x, hut.position.z, 1.9, 'building');
    this.hut = hut;
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
    // steep faces are bare rock, gentle ones snow
    const nrm = g.attributes.normal, col = new Float32Array(pos.length);
    for (let i = 0; i < nrm.count; i++) {
      const ny = nrm.getY(i);
      const rock = smoothstep(0.82, 0.55, ny);
      const x = pos[i * 3], z = pos[i * 3 + 2];
      const v = 0.9 + sx.fbm(x / 700, z / 700, 2) * 0.15;
      col[i * 3] = lerp(0.78, 0.22, rock) * v; col[i * 3 + 1] = lerp(0.83, 0.21, rock) * v; col[i * 3 + 2] = lerp(0.92, 0.22, rock) * v;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1, flatShading: false }));
    m.receiveShadow = false;
    return m;
  }

  _guardrails() {
    const road = this.road, terrain = this.terrain, N = road.count, mats = this.mats;
    const rails = [], posts = [], refl = [];
    const hw = ROAD_WIDTH / 2 + 1.5;
    for (let i = 0; i < N; i++) {
      const s = road.samples[i], s1 = road.samples[(i + 1) % N];
      if (s.bridge || s.tunnel || s.biome === 'ridge') continue;
      for (const side of [-1, 1]) {
        const dropX = s.x + s.nx * side * 12, dropZ = s.z + s.nz * side * 12;
        const drop = s.y - terrain.heightAt(dropX, dropZ);
        if (drop < 2.5) continue; // only where there's a fall
        s[side > 0 ? 'railL' : 'railR'] = true;
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
          this.obstacles.add(x0, z0, 0.12, 'post');
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
    const spruce = spruceCardGeometry();
    const cone = spruceGeometry();
    const deadGeos = [deadTreeGeometry(1), deadTreeGeometry(2), deadTreeGeometry(3)];
    const rockGeos = [boulderGeometry(1), boulderGeometry(5), boulderGeometry(9)];
    // matrices are collected per spatial cell, then each cell becomes its own InstancedMesh so it can be frustum-culled
    const CELL = 300;
    const cells = new Map();
    const bucket = (kind, x, z, mtx) => {
      const key = kind + ':' + Math.floor(x / CELL) + ':' + Math.floor(z / CELL);
      if (!cells.has(key)) cells.set(key, { kind, list: [], cx: (Math.floor(x / CELL) + 0.5) * CELL, cz: (Math.floor(z / CELL) + 0.5) * CELL });
      cells.get(key).list.push(mtx.clone());
    };
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    let ti = 0, deadCount = 0, rockCount = 0;
    const deadS = road.samples[this.deadI].s, L = road.length;
    const inDead = (s) => { let d = Math.abs(s - deadS); d = Math.min(d, L - d); return d < 380; };
    const treeline = 760;
    const lake = this.lake;
    const rock = (x, z, size) => {
      const y = terrain.heightAt(x, z);
      q.setFromEuler(new THREE.Euler(rnd() * 0.6, rnd() * 6.28, rnd() * 0.6)); p.set(x, y - size * 0.35, z); sc.set(size, size, size); m.compose(p, q, sc);
      bucket('rock' + Math.floor(rnd() * 3), x, z, m); rockCount++;
      this.obstacles.add(x, z, size * 1.0, 'rock');
    };
    const tryTree = (x, z) => {
      if (Math.abs(x) > WORLD_HALF - 40 || Math.abs(z) > WORLD_HALF - 40) return;
      const n = road.nearest(x, z, 80);
      const biome = n ? n.sample.biome : 'open';
      const minD = biome === 'forest' ? 6.6 : 9.0;
      if (n && n.d < minD) return;
      if (n && n.d < 70 && (biome === 'canyon' || n.sample.tunnel)) {
        if (rnd() < 0.25 && n.d > 5.2 && n.d < 9) rock(x, z, 0.5 + rnd() * 1.2);
        return;
      }
      if (lake && Math.hypot(x - lake.x, z - lake.z) < lake.r + 8) return;
      for (const pad of terrain.pads) if (Math.hypot(x - pad.x, z - pad.z) < pad.r + 6) return;
      const y = terrain.heightAt(x, z);
      const slope = terrain.slopeAt(x, z);
      if (slope > 0.95) { if (rnd() < 0.15 && n && n.d < 60) rock(x, z, 0.8 + rnd() * 2.4); return; }
      const alpine = biome === 'alpine' && n && n.d < 240;
      const tl = alpine ? y - 1 : treeline;
      let density = smoothstep(tl, tl - 140, y) * (0.55 + sx.fbm(x / 160, z / 160, 3) * 0.6);
      if (biome === 'forest' && n && n.d < 120) density = 1.0;
      if (alpine && rnd() < 0.35 && n.d > 10 && n.d < 90) { rock(x, z, 0.4 + rnd() * 1.0); return; }
      if (rnd() > density) return;
      const near = n ? n.s : -1;
      if (n && n.d < 420 && inDead(near)) {
        const sz = 0.7 + rnd() * 0.8;
        q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.12, rnd() * 6.28, (rnd() - 0.5) * 0.12));
        p.set(x, y - 0.2, z); sc.set(sz, sz, sz); m.compose(p, q, sc);
        bucket('dead' + Math.floor(rnd() * 3), x, z, m); deadCount++;
        this.obstacles.add(x, z, 0.3 * sz + 0.1, 'tree');
        return;
      }
      const sz = (biome === 'forest' ? 1.0 : 0.75) + rnd() * 0.9;
      q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.06, rnd() * 6.28, (rnd() - 0.5) * 0.06));
      p.set(x, y - 0.3, z); sc.set(sz * (0.9 + rnd() * 0.3), sz, sz * (0.9 + rnd() * 0.3)); m.compose(p, q, sc);
      // detailed card trees within 260 m of the road, cheap cone trees beyond
      bucket(n && n.d < 260 ? 'tree' : 'far', x, z, m); ti++;
      this.obstacles.add(x, z, 0.28 * sz + 0.12, 'tree');
    };
    for (let i = 0; i < N; i += 1) {
      const s = road.samples[i];
      const dense = s.biome === 'forest';
      for (let k = 0; k < (dense ? 14 : 7); k++) {
        const side = rnd() > 0.5 ? 1 : -1;
        const d = (dense ? 6 : 10) + Math.pow(rnd(), dense ? 2.2 : 1.6) * (dense ? 140 : 260);
        const along = (rnd() - 0.5) * 4;
        tryTree(s.x + s.nx * side * d + s.tx * along, s.z + s.nz * side * d + s.tz * along);
      }
    }
    for (let k = 0; k < 26000; k++) tryTree((rnd() - 0.5) * 2 * (WORLD_HALF - 50), (rnd() - 0.5) * 2 * (WORLD_HALF - 50));
    // build one InstancedMesh per cell and kind
    const make = (geo, mat, list, shadow = true) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = shadow; im.receiveShadow = true;
      im.computeBoundingSphere();
      this.scene.add(im);
      return im;
    };
    for (const cell of cells.values()) {
      const k = cell.kind;
      if (k === 'tree') {
        make(spruce.trunk, mats.bark, cell.list);
        make(spruce.cards, mats.branch, cell.list, false);
        // shadow proxy: cheap cone silhouette on the shadow-only layer (2); the cameras never draw it
        const proxy = make(cone.foliage, mats.foliage, cell.list, true);
        proxy.layers.set(2);
      }
      else if (k === 'far') { make(cone.trunk, mats.bark, cell.list, false); make(cone.foliage, mats.foliage, cell.list, false); make(cone.snow, mats.snowCap, cell.list, false); }
      else if (k.startsWith('dead')) make(deadGeos[+k[4]], mats.deadWood, cell.list);
      else if (k.startsWith('rock')) make(rockGeos[+k[4]], mats.rock, cell.list);
    }
    this.treeCount = ti; this.deadCount = deadCount; this.rockCount = rockCount; this.forestCells = cells.size;
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
    this.bridges = terrain.features.bridges.map((f) => add(buildBridge(road, terrain, mats, f)));
    this.tunnels = terrain.features.tunnels.map((f) => add(buildTunnel(road, terrain, mats, f)));
    this.bridge = this.bridges[0] || { group: new THREE.Group(), fixtures: [] };
    this.tunnel = this.tunnels[0] || { group: new THREE.Group(), fixtures: [] };
    if (this.villagePlan) this.village = add(buildVillage(road, terrain, mats, this.villagePlan.s, this.villagePlan.len));
    if (this.mineI !== undefined) this.mine = add(buildMine(road, terrain, mats, road.samples[this.mineI % N].s, this.mineSide));
    if (this.avalancheI !== undefined) this.avalanche = add(buildAvalanche(road, terrain, mats, road.samples[this.avalancheI % N].s));
    if (this.fallenI !== undefined) this.fallen = add(buildFallenTree(road, terrain, mats, road.samples[this.fallenI % N].s, 1));
    if (this.iceRun) { this.ice = add(buildIceSheen(road, mats, this.iceRun[0], this.iceRun[1])); this.ice.group.children[0].material.envMap = this.envMap; }
    if (this.convoyI !== undefined) this.convoy = add(buildConvoy(road, terrain, mats, road.samples[this.convoyI % N].s, 1, buildVehicle));
    this.gas = add(buildGasStation(road, terrain, mats, road.samples[this.gasI].s, this.gasSide));
    this.cemetery = add(buildCemetery(road, terrain, mats, road.samples[this.cemeteryI].s, this.cemeterySide));
    this.overlook = add(buildOverlook(road, terrain, mats, road.samples[this.overlookI].s, this.overlookSide, road.samples[this.overlookI].y));
    if (this.towerXZ) this.tower = add(buildTower(terrain, mats, this.towerXZ[0], this.towerXZ[1]));
    for (const r of [...this.bridges, ...this.tunnels, this.gas, this.cemetery, this.overlook, this.tower, this.village, this.mine, this.avalanche, this.fallen, this.ice, this.convoy]) if (r && r.obstacles) for (const o of r.obstacles) this.obstacles.add(o.x, o.z, o.r, o.kind || 'building');
    if (this.towerXZ) for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; this.obstacles.add(this.towerXZ[0] + Math.cos(a) * 2.2, this.towerXZ[1] + Math.sin(a) * 2.2, 0.3, 'building'); }
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
      this.obstacles.add(sign.position.x, sign.position.z, 0.25, 'sign');
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
    moon.shadow.mapSize.set(1536, 1536);
    const sc = moon.shadow.camera;
    sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 50; sc.far = 900;
    moon.shadow.bias = -0.0015; moon.shadow.normalBias = 0.6;
    moon.shadow.camera.layers.enable(2);
    scene.add(moon); scene.add(moon.target);
    this.moon = moon;
    const hemi = new THREE.HemisphereLight(0x2c3b5c, 0x0b0d12, 0.75);
    scene.add(hemi);
    this.hemi = hemi;
    // pooled point lights for fixtures
    for (let i = 0; i < 3; i++) {
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

  /** Low ground fog: soft billboards that drift slowly along the road in the forest, by the lake and in the burn. */
  _groundFog() {
    const road = this.road, N = road.count, terrain = this.terrain;
    const mat = new THREE.SpriteMaterial({ map: T.glowSprite(128, 0, 'rgba(150,170,200,1)'), transparent: true, depthWrite: false, opacity: 0.3, color: 0x8fa2be, blending: THREE.NormalBlending, fog: true });
    this.wisps = [];
    const rnd = mulberry32(555);
    for (let i = 0; i < N; i += 6) {
      const s = road.samples[i];
      if (!(s.biome === 'forest' || s.biome === 'lake' || s.biome === 'open')) continue;
      if (s.bridge || s.tunnel) continue;
      if (rnd() > 0.55) continue;
      const sp = new THREE.Sprite(mat);
      const lat = (rnd() - 0.5) * 24;
      const x = s.x + s.nx * lat, z = s.z + s.nz * lat;
      sp.position.set(x, terrain.heightAt(x, z) + 0.6 + rnd() * 0.8, z);
      sp.scale.set(18 + rnd() * 18, 3.5 + rnd() * 3, 1);
      sp.userData = { x, z, phase: rnd() * 10, tx: s.tx, tz: s.tz };
      this.scene.add(sp); this.wisps.push(sp);
    }
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
    if (this.wisps) for (const sp of this.wisps) {
      const u = sp.userData; const dx = sp.position.x - carPos.x, dz = sp.position.z - carPos.z;
      if (dx * dx + dz * dz > 250 * 250) { sp.visible = false; continue; }
      sp.visible = true;
      sp.position.x = u.x + Math.sin(t * 0.07 + u.phase) * 6 * u.tx; sp.position.z = u.z + Math.sin(t * 0.07 + u.phase) * 6 * u.tz;
    }
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
