import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Simplex, mulberry32 } from './noise.js';

const sx = new Simplex(555);

/** Merge helper that tolerates mixed indexed / non-indexed inputs. */
export function merge(geos) {
  const list = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  return out;
}

function displace(geo, amp, freq, seed) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = sx.fbm(x * freq + seed, (y + z) * freq + seed * 2, 3);
    const l = Math.hypot(x, y, z) || 1;
    const s = 1 + n * amp;
    p.setXYZ(i, x * s, y * s, z * s);
  }
  geo.computeVertexNormals();
  return geo;
}


/** Closed box-section ribbon following road samples a..b (inclusive) at a lateral offset (left +). */
export function boxRibbon(road, a, b, offset, width, yTop, yBot) {
  const N = road.count;
  const pos = [], idx = [], uv = [];
  let n = 0;
  for (let i = a; i <= b; i++) {
    const s = road.samples[((i % N) + N) % N];
    const cx = s.x + s.nx * offset, cz = s.z + s.nz * offset;
    const hw = width / 2;
    pos.push(cx + s.nx * hw, s.y + yTop, cz + s.nz * hw, cx - s.nx * hw, s.y + yTop, cz - s.nz * hw,
             cx - s.nx * hw, s.y + yBot, cz - s.nz * hw, cx + s.nx * hw, s.y + yBot, cz + s.nz * hw);
    for (let k = 0; k < 4; k++) uv.push(k / 4, n * 0.5);
    if (i > a) {
      const p = (n - 1) * 4, q = n * 4;
      for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; idx.push(p + k, q + k, p + k2, p + k2, q + k, q + k2); }
    }
    n++;
  }
  idx.push(0, 1, 2, 0, 2, 3);
  const e = (n - 1) * 4; idx.push(e, e + 2, e + 1, e, e + 3, e + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/** Snow-laden spruce: trunk + tiers of cones. Returns {foliage, snow, trunk} geometries in a local frame (base at y=0). */
export function spruceGeometry() {
  const trunk = new THREE.CylinderGeometry(0.12, 0.28, 3.2, 7);
  trunk.translate(0, 1.6, 0);
  const foliage = [], snow = [];
  const tiers = 6;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const r = 2.7 * (1 - t) + 0.4;
    const h = 2.2;
    const y = 1.4 + i * 1.45;
    const cone = new THREE.ConeGeometry(r, h, 10, 1, false);
    cone.translate(0, y + h / 2, 0);
    displace(cone, 0.16, 1.6, i * 3);
    foliage.push(cone);
    const cap = new THREE.ConeGeometry(r * 0.8, h * 0.6, 10, 1, false);
    cap.translate(0, y + h / 2 + h * 0.38, 0);
    displace(cap, 0.12, 1.9, i * 5 + 1);
    snow.push(cap);
  }
  return { trunk, foliage: merge(foliage), snow: merge(snow) };
}

/** Bare, twisted dead tree from a trunk and recursive branches. */
export function deadTreeGeometry(seed = 1) {
  const rnd = mulberry32(seed);
  const parts = [];
  const branch = (x, y, z, dir, len, rad, depth) => {
    const g = new THREE.CylinderGeometry(rad * 0.55, rad, len, 6, 1);
    g.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    g.applyQuaternion(q);
    g.translate(x, y, z);
    parts.push(g);
    if (depth <= 0) return;
    const end = new THREE.Vector3(x, y, z).addScaledVector(dir.clone().normalize(), len * 0.95);
    const n = depth > 2 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const d = dir.clone().normalize();
      d.x += (rnd() - 0.5) * 1.3; d.z += (rnd() - 0.5) * 1.3; d.y += (rnd() - 0.2) * 0.7;
      branch(end.x, end.y, end.z, d, len * (0.55 + rnd() * 0.2), rad * 0.55, depth - 1);
    }
  };
  branch(0, 0, 0, new THREE.Vector3((rnd() - 0.5) * 0.25, 1, (rnd() - 0.5) * 0.25), 4 + rnd() * 3, 0.32, 4);
  return merge(parts);
}

export function boulderGeometry(seed = 1) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  displace(g, 0.35, 1.1, seed);
  g.scale(1.3, 0.85, 1);
  return g;
}

/** Ruined stone wall block with irregular top. */
export function stoneWallGeometry(len, h, seed = 3) {
  const g = new THREE.BoxGeometry(len, h, 0.6, Math.max(2, Math.round(len)), 2, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    if (y > h * 0.4) p.setY(i, y - Math.max(0, sx.fbm(x * 0.7 + seed, seed, 3)) * h * 0.55);
    p.setZ(i, p.getZ(i) + sx.noise2(x * 2 + seed, y * 2) * 0.05);
  }
  g.computeVertexNormals();
  return g;
}

/** The silhouette: a matte black humanoid. Slightly too tall. */
export function figureMesh() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1, metalness: 0 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.25, 4, 10), mat); body.position.y = 1.0; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), mat); head.position.y = 1.95; g.add(head);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.8, 3, 8), mat); arm.position.set(s * 0.3, 1.1, 0); arm.rotation.z = s * 0.08; g.add(arm);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.85, 3, 8), mat); leg.position.set(s * 0.12, 0.45, 0); g.add(leg);
  }
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return g;
}

/** Low-poly deer that can run across the road. */
export function deerMesh() {
  const fur = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.9, 4, 10), fur); body.rotation.z = Math.PI / 2; body.position.y = 1.0; g.add(body);
  const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.55, 3, 8), fur); neck.position.set(0.55, 1.35, 0); neck.rotation.z = -0.6; g.add(neck);
  const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.3, 3, 8), fur); head.position.set(0.9, 1.6, 0); head.rotation.z = Math.PI / 2 - 0.3; g.add(head);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xbfd8ff, emissiveIntensity: 3 });
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), eyeMat); e.position.set(1.0, 1.65, s * 0.08); g.add(e); }
  const legs = [];
  for (const [x, z] of [[0.35, 0.15], [0.35, -0.15], [-0.35, 0.15], [-0.35, -0.15]]) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.035, 0.85, 6), fur); l.position.set(x, 0.45, z); g.add(l); legs.push(l);
  }
  for (const s of [-1, 1]) {
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.5, 5), fur); a.position.set(0.85, 1.95, s * 0.1); a.rotation.z = -0.4; a.rotation.x = s * 0.5; g.add(a);
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.3, 5), fur); b.position.set(0.9, 2.15, s * 0.2); b.rotation.x = s * 1.0; g.add(b);
  }
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  g.userData.legs = legs;
  return g;
}

/** Roadside sign on two posts. */
export function signMesh(texture, w = 2.4, h = 1.2, postH = 2.2, mats) {
  const g = new THREE.Group();
  const face = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04), [mats.steel, mats.steel, mats.steel, mats.steel,
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.35, metalness: 0.2, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.12 }), mats.steel]);
  face.position.y = postH + h / 2; face.castShadow = true; g.add(face);
  for (const s of w > 1.3 ? [-1, 1] : [0]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, postH + h * 0.8, 0.08), mats.steel); p.position.set(s * (w / 2 - 0.2), (postH + h * 0.8) / 2, -0.04); p.castShadow = true; g.add(p);
  }
  return g;
}

/** Old cast-iron lamp post; the lamp head is emissive and a pooled light is parked on it when the car is near. */
export function lampPostMesh(mats, height = 5.5) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, height, 10), mats.iron); pole.position.y = height / 2; pole.castShadow = true; g.add(pole);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.3, 8), mats.iron); arm.rotation.z = Math.PI / 2; arm.position.set(0.6, height - 0.1, 0); g.add(arm);
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.25, 12, 1, true), mats.iron); hood.position.set(1.2, height - 0.15, 0); hood.rotation.x = Math.PI; g.add(hood);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffb060, emissive: 0xffa040, emissiveIntensity: 6 }));
  bulb.position.set(1.2, height - 0.3, 0); g.add(bulb);
  g.userData.bulb = bulb;
  g.userData.lightPos = new THREE.Vector3(1.2, height - 0.45, 0);
  return g;
}

/** Radio mast with a red beacon. */
export function radioTowerMesh(mats, h = 42) {
  const g = new THREE.Group();
  const legs = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.CylinderGeometry(0.05, 0.09, h, 6);
    leg.translate(0, h / 2, 0);
    const bx = Math.cos(a) * 2.2, bz = Math.sin(a) * 2.2;
    const p = leg.attributes.position;
    for (let k = 0; k < p.count; k++) { const t = 1 - p.getY(k) / h; p.setX(k, p.getX(k) + bx * t); p.setZ(k, p.getZ(k) + bz * t); }
    legs.push(leg);
  }
  const braces = [];
  for (let y = 3; y < h; y += 3.5) {
    const t = 1 - y / h;
    for (let i = 0; i < 3; i++) {
      const a1 = (i / 3) * Math.PI * 2, a2 = ((i + 1) / 3) * Math.PI * 2;
      const p1 = new THREE.Vector3(Math.cos(a1) * 2.2 * t, y, Math.sin(a1) * 2.2 * t);
      const p2 = new THREE.Vector3(Math.cos(a2) * 2.2 * t, y, Math.sin(a2) * 2.2 * t);
      const len = p1.distanceTo(p2);
      const b = new THREE.CylinderGeometry(0.025, 0.025, len, 5);
      b.translate(0, len / 2, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), p2.clone().sub(p1).normalize());
      b.applyQuaternion(q); b.translate(p1.x, p1.y, p1.z);
      braces.push(b);
    }
  }
  const mast = new THREE.Mesh(merge([...legs, ...braces]), mats.iron);
  mast.castShadow = true;
  g.add(mast);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshStandardMaterial({ color: 0x200000, emissive: 0xff2020, emissiveIntensity: 8 }));
  beacon.position.y = h + 0.4; g.add(beacon);
  g.userData.beacon = beacon;
  return g;
}
