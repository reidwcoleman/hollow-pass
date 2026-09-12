import * as THREE from 'three';
import { Simplex, clamp, lerp, smoothstep } from './noise.js';
import { ROAD_WIDTH, SHOULDER } from './road.js';

const sx = new Simplex(31337);
const sx2 = new Simplex(777);

export const WORLD_HALF = 2300;
const CHUNK = 200;

/** Raw mountain height before any road shaping. */
export function baseHeight(x, z) {
  const r = Math.hypot(x, z);
  const big = sx.ridged(x / 1500 + 3.1, z / 1500 + 1.7, 5, 2.05, 0.5);        // ridges
  const massif = Math.exp(-Math.pow(r / 900, 2)) * 420;                        // central peak the loop circles
  const roll = sx.fbm(x / 420 + 8, z / 420 + 8, 4, 2, 0.5) * 60;
    const fine = sx2.fbm(x / 60, z / 60, 3, 2.2, 0.5) * 6 + sx2.fbm(x / 14, z / 14, 2) * 1.2;
  const rim = smoothstep(1650, 2300, r) * 520 * (0.6 + sx.fbm(x / 500, z / 500, 2) * 0.4); // outer wall of peaks
  return 20 + big * 480 + massif + roll + fine + rim;
}

export class Terrain {
  constructor(road) {
    this.road = road;
    this.features = { bridge: null, tunnel: null };
    this._findFeatures();
  }

  /** Detect the longest valley span (bridge) and ridge cut (tunnel) from the road/terrain mismatch. */
  _findFeatures() {
    const road = this.road, N = road.count;
    const diff = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const s = road.samples[i];
      diff[i] = s.y - baseHeight(s.x, s.z); // + road above terrain, - road below terrain
      s.bridge = false; s.tunnel = false;
    }
    const runs = (pred, minLen) => {
      const out = [];
      let start = -1;
      for (let i = 0; i < N * 2; i++) {
        const ok = pred(diff[i % N]);
        if (ok && start < 0) start = i;
        if (!ok && start >= 0) { if (i - start >= minLen) out.push([start, i]); start = -1; }
      }
      return out.filter(([a]) => a < N).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]));
    };
    const bridges = runs((d) => d > 9, 25);
    const tunnels = runs((d) => d < -14, 30);
    if (bridges.length) {
      let [a, b] = bridges[0];
      // trim to the deepest core: make the deck span at least 30 samples (120m)
      this.features.bridge = { a, b, mid: (a + b) / 2 };
      for (let i = a; i < b; i++) road.samples[i % N].bridge = true;
    }
    if (tunnels.length) {
      // choose a tunnel that isn't the bridge
      const t = tunnels.find(([a, b]) => !this.features.bridge || Math.abs(a - this.features.bridge.a) > 200) || tunnels[0];
      let [a, b] = t;
      if (b - a > 110) { const m = (a + b) / 2; a = Math.floor(m - 55); b = Math.floor(m + 55); }
      this.features.tunnel = { a, b, mid: (a + b) / 2 };
      for (let i = a; i < b; i++) road.samples[i % N].tunnel = true;
      for (let k = 1; k <= 12; k++) { road.samples[((a - k) % N + N) % N].portal = true; road.samples[(b + k - 1) % N].portal = true; }
    }
  }

  /** Final terrain height at world (x,z). */
  heightAt(x, z) {
    const road = this.road;
    let h = baseHeight(x, z);
    const n = road.nearest(x, z, 70);
    if (!n) return h;
    const s = n.sample;
    const half = ROAD_WIDTH / 2 + SHOULDER + 0.5;
    const d = n.d;
    if (s.bridge) {
      // gorge under the deck: carve a deep V around the bridge line, ignore the road cut
      const b = this.features.bridge;
      const idx = n.i;
      const N = road.count;
      const inCore = (idx - b.a + N) % N < (b.b - b.a);
      const along = inCore ? 1 : 0;
      const w = smoothstep(190, 40, d) * along;
      return h - w * 140 - (d < 12 ? 6 : 0);
    }
    if (s.tunnel) {
      // no cut inside the mountain; make sure the rock is well above the tube
      return Math.max(h, n.y + 14 + smoothstep(0, 40, d) * 10);
    }
    if (s.portal) {
      // wide, steep-walled cutting leading into the portal
      const pw = 8.2;
      if (d <= pw) return n.y - 0.03 * (d / pw);
      const f = smoothstep(pw, pw + 6, d);
      return lerp(n.y - 0.2, Math.max(h, n.y + 2), f);
    }
    if (d <= half) return n.y - 0.03 * (d / half);
    const fall = smoothstep(half, half + 30 + Math.abs(h - n.y) * 0.6, d);
    const bank = 0.9 * Math.exp(-Math.pow((d - (half + 1.2)) / 0.9, 2)); // plough bank
    return lerp(n.y - 0.25, h, fall) + bank * (1 - fall);
  }

  /** Steepness at (x,z) via finite differences — used by the shader blend and prop placement. */
  slopeAt(x, z, e = 2.5) {
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return Math.hypot(hx, hz) / (2 * e);
  }

  normalAt(x, z, e = 2) {
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return new THREE.Vector3(-hx, 2 * e, -hz).normalize();
  }

  /** Build chunked meshes. Chunks that touch the road get 2.5 m spacing, the rest 6.25 m. Skirts hide LOD seams. */
  build(material, onProgress) {
    const group = new THREE.Group();
    const count = Math.ceil((WORLD_HALF * 2) / CHUNK);
    const road = this.road;
    let done = 0;
    for (let cz = 0; cz < count; cz++) {
      for (let cx = 0; cx < count; cx++) {
        const x0 = -WORLD_HALF + cx * CHUNK, z0 = -WORLD_HALF + cz * CHUNK;
        const mx = x0 + CHUNK / 2, mz = z0 + CHUNK / 2;
        const near = road.nearest(mx, mz, CHUNK * 0.8);
        const dist = Math.hypot(mx, mz);
        const spacing = near && near.d < CHUNK * 0.9 ? 2.5 : dist > 1900 ? 12.5 : 6.25;
        const mesh = this._chunk(x0, z0, spacing, material);
        group.add(mesh);
        done++;
      }
      onProgress && onProgress(done / (count * count));
    }
    return group;
  }

  _chunk(x0, z0, spacing, material) {
    const n = Math.round(CHUNK / spacing) + 1;
    const N = n + 2; // + skirt ring
    const pos = new Float32Array(N * N * 3);
    const rock = new Float32Array(N * N);
    const uv = new Float32Array(N * N * 2);
    const heights = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const gi = clamp(i - 1, 0, n - 1), gj = clamp(j - 1, 0, n - 1);
        const x = x0 + gi * spacing, z = z0 + gj * spacing;
        let y = this.heightAt(x, z);
        const skirt = i === 0 || j === 0 || i === N - 1 || j === N - 1;
        heights[j * N + i] = y;
        if (skirt) {
          // no skirt where it would hang down through the tunnel bore
          const nr = this.road.nearest(x, z, 20);
          y -= nr && (nr.sample.tunnel || nr.sample.portal) && nr.d < 14 ? 0 : 12;
        }
        const k = j * N + i;
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        uv[k * 2] = x / 24; uv[k * 2 + 1] = z / 24;
      }
    }
    // rockness from local slope (finite diff on the grid) + noise breakup
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const l = heights[j * N + Math.max(0, i - 1)], r = heights[j * N + Math.min(N - 1, i + 1)];
        const u = heights[Math.max(0, j - 1) * N + i], d = heights[Math.min(N - 1, j + 1) * N + i];
        const slope = Math.hypot(r - l, d - u) / (2 * spacing);
        const x = pos[k * 3], z = pos[k * 3 + 2];
        const breakup = sx2.fbm(x / 35, z / 35, 3) * 0.25;
        let rk = smoothstep(0.55 + breakup, 1.0 + breakup, slope);
        // high altitude: more exposed rock on windward faces
        rk = clamp(rk + smoothstep(560, 760, heights[k]) * 0.35 * Math.max(0, breakup + 0.2), 0, 1);
        rock[k] = rk;
      }
    }
    const idx = [];
    for (let j = 0; j < N - 1; j++) {
      for (let i = 0; i < N - 1; i++) {
        const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('rockness', new THREE.BufferAttribute(rock, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    // Fix skirt normals so the ring shares the edge normal (avoids a dark seam)
    const nrm = g.attributes.normal;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (i === 0 || j === 0 || i === N - 1 || j === N - 1) {
        const ii = clamp(i, 1, N - 2), jj = clamp(j, 1, N - 2);
        const src = jj * N + ii, dst = j * N + i;
        nrm.setXYZ(dst, nrm.getX(src), nrm.getY(src), nrm.getZ(src));
      }
    }
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    m.castShadow = false;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }
}

/** Snow/rock blended PBR material with a moonlight sparkle term. */
export function terrainMaterial(snow, rock) {
  const mat = new THREE.MeshStandardMaterial({
    map: snow.map,
    normalMap: snow.normalMap,
    roughnessMap: snow.roughnessMap,
    roughness: 1.0,
    metalness: 0.0,
    color: new THREE.Color(0.85, 0.9, 1.0),
    normalScale: new THREE.Vector2(0.9, 0.9),
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.rockMap = { value: rock.map };
    shader.uniforms.rockNormal = { value: rock.normalMap };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float rockness;\nvarying float vRock;\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRock = rockness;\nvWPos = (modelMatrix * vec4(position,1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D rockMap;\nuniform sampler2D rockNormal;\nvarying float vRock;\nvarying vec3 vWPos;')
      .replace('#include <map_fragment>', `
        vec4 snowCol = texture2D(map, vMapUv);
        vec4 rockCol = texture2D(rockMap, vMapUv * 0.6);
        vec4 rockCol2 = texture2D(rockMap, vMapUv * 0.13 + 0.3);
        rockCol.rgb *= mix(vec3(0.75), vec3(1.15), rockCol2.r);
        float rk = smoothstep(0.25, 0.75, vRock + (rockCol.r - 0.3) * 0.35);
        vec4 sampledDiffuseColor = mix(snowCol, rockCol, rk);
        diffuseColor *= sampledDiffuseColor;
      `)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness;
        vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
        float rkR = smoothstep(0.25, 0.75, vRock);
        roughnessFactor *= mix(texelRoughness.g, 0.95, rkR);
      `)
      .replace('#include <normal_fragment_maps>', `
        vec3 mapN1 = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
        vec3 mapN2 = texture2D( rockNormal, vNormalMapUv * 0.6 ).xyz * 2.0 - 1.0;
        float rkN = smoothstep(0.25, 0.75, vRock);
        vec3 mapN = normalize(mix(mapN1, mapN2 * 1.6, rkN));
        mapN.xy *= normalScale;
        normal = normalize( tbn * mapN );
      `);
  };
  mat.customProgramCacheKey = () => 'terrain-snow-rock';
  return mat;
}
