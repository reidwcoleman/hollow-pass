import * as THREE from 'three';
import { Simplex, clamp, lerp, smoothstep } from './noise.js';

/**
 * The route: a closed mountain loop. Control points are placed on a wobbly
 * ring, the terrain function decides the base height, and the path height is
 * heavily smoothed so grades stay drivable. Sections of the loop are tagged so
 * the world builder can drop the scary set pieces in the right places.
 */
export const ROAD_WIDTH = 8.0;      // asphalt width (m)
export const SHOULDER = 1.8;        // gravel shoulder each side
export const LOOP_RADIUS = 1350;

const sx = new Simplex(4242);

export class Road {
  constructor(terrainBaseHeight) {
    this.baseHeight = terrainBaseHeight;
    const pts = [];
    const N = 40;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const wob = sx.fbm(Math.cos(a) * 1.3 + 5, Math.sin(a) * 1.3 + 5, 3) * 420 + sx.noise2(a * 2.5, 1) * 140;
      const r = LOOP_RADIUS + wob;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
    this.length = this.curve.getLength();

    // Dense samples along the route with smoothed heights.
    const step = 4;
    this.count = Math.ceil(this.length / step);
    this.samples = [];
    const raw = [];
    for (let i = 0; i < this.count; i++) {
      const t = i / this.count;
      const p = this.curve.getPointAt(t);
      raw.push(terrainBaseHeight(p.x, p.z));
      this.samples.push({ t, x: p.x, z: p.z, y: 0, s: t * this.length });
    }
    // Smooth heights (circular) so grades never exceed ~9%.
    let h = raw.slice();
    for (let pass = 0; pass < 3; pass++) {
      const win = 18;
      const out = new Array(this.count);
      for (let i = 0; i < this.count; i++) {
        let acc = 0;
        for (let k = -win; k <= win; k++) acc += h[(i + k + this.count) % this.count];
        out[i] = acc / (2 * win + 1);
      }
      h = out;
    }
    // Grade limiter
    const maxGrade = 0.095 * step;
    for (let pass = 0; pass < 4000; pass++) {
      let worst = 0;
      for (let i = 0; i < this.count; i++) {
        const j = (i + 1) % this.count;
        const d = h[j] - h[i];
        if (d > maxGrade) { const e = (d - maxGrade) / 2; h[j] -= e; h[i] += e; worst = Math.max(worst, e); }
        else if (d < -maxGrade) { const e = (-d - maxGrade) / 2; h[j] += e; h[i] -= e; worst = Math.max(worst, e); }
      }
      if (worst < 0.002) break;
    }
    // final gentle smoothing so grade changes are rounded (no kinks)
    for (let pass = 0; pass < 2; pass++) {
      const out = new Array(this.count);
      for (let i = 0; i < this.count; i++) out[i] = (h[(i - 1 + this.count) % this.count] + 2 * h[i] + h[(i + 1) % this.count]) / 4;
      h = out;
    }
    for (let i = 0; i < this.count; i++) this.samples[i].y = h[i];

    // Tangents + bank
    for (let i = 0; i < this.count; i++) {
      const a = this.samples[(i - 1 + this.count) % this.count], b = this.samples[(i + 1) % this.count];
      const dx = b.x - a.x, dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      this.samples[i].tx = dx / l; this.samples[i].tz = dz / l;
      this.samples[i].nx = -dz / l; this.samples[i].nz = dx / l; // left normal
    }
    // curvature (signed) for banking + AI
    for (let i = 0; i < this.count; i++) {
      const a = this.samples[(i - 3 + this.count) % this.count], b = this.samples[(i + 3) % this.count];
      const cross = a.tx * b.tz - a.tz * b.tx;
      this.samples[i].curv = cross / (6 * step);
    }

    // spatial hash for nearest-sample lookups
    this.cell = 50;
    this.hash = new Map();
    for (let i = 0; i < this.count; i++) {
      const s = this.samples[i];
      const key = this._key(Math.floor(s.x / this.cell), Math.floor(s.z / this.cell));
      if (!this.hash.has(key)) this.hash.set(key, []);
      this.hash.get(key).push(i);
    }
  }

  _key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }

  /** Nearest road sample to (x,z), searching neighbouring hash cells. Returns {i, d, side, y} */
  nearest(x, z, radius = 120) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    const r = Math.ceil(radius / this.cell);
    let best = -1, bestD = Infinity;
    for (let ix = cx - r; ix <= cx + r; ix++) {
      for (let iz = cz - r; iz <= cz + r; iz++) {
        const arr = this.hash.get(this._key(ix, iz));
        if (!arr) continue;
        for (const i of arr) {
          const s = this.samples[i];
          const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
          if (d < bestD) { bestD = d; best = i; }
        }
      }
    }
    if (best < 0) return null;
    const s = this.samples[best];
    // project onto segment for a precise lateral offset
    const dx = x - s.x, dz = z - s.z;
    const along = dx * s.tx + dz * s.tz;
    const lateral = dx * s.nx + dz * s.nz;
    const y = this.heightAtS(s.s + along);
    return { i: best, d: Math.abs(lateral), lateral, y, s: s.s + along, along, sample: s };
  }

  /** Smooth (Catmull-Rom) road height at station s — no kinks at sample joints. */
  heightAtS(s) {
    const L = this.length, N = this.count;
    const u = ((s % L) + L) % L;
    const f = u / 4;
    const i = Math.floor(f) % N;
    const k = f - Math.floor(f);
    const y0 = this.samples[(i - 1 + N) % N].y, y1 = this.samples[i].y, y2 = this.samples[(i + 1) % N].y, y3 = this.samples[(i + 2) % N].y;
    const k2 = k * k, k3 = k2 * k;
    return 0.5 * ((2 * y1) + (-y0 + y2) * k + (2 * y0 - 5 * y1 + 4 * y2 - y3) * k2 + (-y0 + 3 * y1 - 3 * y2 + y3) * k3);
  }

  at(s) {
    const L = this.length;
    let u = ((s % L) + L) % L;
    const f = u / 4;
    const i = Math.floor(f) % this.count, j = (i + 1) % this.count;
    const k = f - Math.floor(f);
    const a = this.samples[i], b = this.samples[j];
    return {
      x: lerp(a.x, b.x, k), y: this.heightAtS(s), z: lerp(a.z, b.z, k),
      tx: lerp(a.tx, b.tx, k), tz: lerp(a.tz, b.tz, k), nx: lerp(a.nx, b.nx, k), nz: lerp(a.nz, b.nz, k),
      curv: lerp(a.curv, b.curv, k),
    };
  }

  /** Height the terrain should take at (x,z): flattened to the road within the shoulder, blended out beyond. */
  shapeTerrain(x, z, baseY) {
    const n = this.nearest(x, z, 60);
    if (!n) return baseY;
    const half = ROAD_WIDTH / 2 + SHOULDER + 0.6;
    const d = n.d;
    if (d <= half) return n.y - 0.02 * (d / half);
    const fall = smoothstep(half, half + 34, d);
    // the cut: uphill side rises quickly, downhill side drops
    const target = baseY;
    const camber = lerp(n.y - 0.3, target, fall);
    return camber;
  }
}

/** Builds the asphalt strip, markings, shoulders and the geometry helpers. */
export function buildRoadMesh(road, mats) {
  const N = road.count;
  const group = new THREE.Group();

  // Asphalt ribbon
  const pos = [], uv = [], idx = [], nrm = [];
  const hw = ROAD_WIDTH / 2;
  let sAcc = 0;
  for (let i = 0; i <= N; i++) {
    const s = road.samples[i % N];
    const bank = clamp(-s.curv * 40, -0.06, 0.06);
    const lx = s.x + s.nx * hw, lz = s.z + s.nz * hw;
    const rx = s.x - s.nx * hw, rz = s.z - s.nz * hw;
    pos.push(lx, s.y + 0.02 + bank * hw, lz, rx, s.y + 0.02 - bank * hw, rz);
    nrm.push(0, 1, 0, 0, 1, 0);
    uv.push(0, sAcc / 8, 1, sAcc / 8);
    sAcc += 4;
    if (i < N) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const asphalt = new THREE.Mesh(g, mats.asphalt);
  asphalt.receiveShadow = true;
  group.add(asphalt);

  // Shoulders (gravel/snow crust)
  const shPos = [], shIdx = [], shUv = [];
  for (let i = 0; i <= N; i++) {
    const s = road.samples[i % N];
    const a = hw - 0.05, b = hw + SHOULDER;
    shPos.push(s.x + s.nx * a, s.y + 0.015, s.z + s.nz * a, s.x + s.nx * b, s.y - 0.05, s.z + s.nz * b);
    shPos.push(s.x - s.nx * a, s.y + 0.015, s.z - s.nz * a, s.x - s.nx * b, s.y - 0.05, s.z - s.nz * b);
    shUv.push(0, i * 0.5, 1, i * 0.5, 0, i * 0.5, 1, i * 0.5);
    if (i < N) {
      const q = i * 4;
      shIdx.push(q, q + 4, q + 1, q + 1, q + 4, q + 5);
      shIdx.push(q + 2, q + 3, q + 6, q + 3, q + 7, q + 6);
    }
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(shPos, 3));
  sg.setAttribute('uv', new THREE.Float32BufferAttribute(shUv, 2));
  sg.setIndex(shIdx);
  sg.computeVertexNormals();
  const shoulder = new THREE.Mesh(sg, mats.shoulder);
  shoulder.receiveShadow = true;
  group.add(shoulder);

  // Lane markings: dashed centre (yellow), solid edge (white) — thin ribbons slightly above asphalt.
  function ribbon(offset, width, dashLen, gapLen, mat, yoff = 0.035) {
    const p = [], ix = [], u = [];
    let v = 0;
    for (let i = 0; i < N; i++) {
      const s = road.samples[i];
      const s2 = road.samples[(i + 1) % N];
      const seg = i * 4;
      if (dashLen > 0 && (seg % (dashLen + gapLen)) >= dashLen) continue;
      const ox = s.nx * offset, oz = s.nz * offset;
      const ox2 = s2.nx * offset, oz2 = s2.nz * offset;
      const hwid = width / 2;
      const base = p.length / 3;
      p.push(s.x + ox + s.nx * hwid, s.y + yoff, s.z + oz + s.nz * hwid,
             s.x + ox - s.nx * hwid, s.y + yoff, s.z + oz - s.nz * hwid,
             s2.x + ox2 + s2.nx * hwid, s2.y + yoff, s2.z + oz2 + s2.nz * hwid,
             s2.x + ox2 - s2.nx * hwid, s2.y + yoff, s2.z + oz2 - s2.nz * hwid);
      u.push(0, v, 1, v, 0, v + 1, 1, v + 1); v++;
      ix.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    gg.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
    gg.setIndex(ix);
    gg.computeVertexNormals();
    const m = new THREE.Mesh(gg, mat);
    m.receiveShadow = true;
    return m;
  }
  group.add(ribbon(0, 0.14, 12, 12, mats.paintYellow));
  group.add(ribbon(hw - 0.35, 0.12, 0, 0, mats.paintWhite));
  group.add(ribbon(-(hw - 0.35), 0.12, 0, 0, mats.paintWhite));

  return group;
}
