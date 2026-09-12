import * as THREE from 'three';
import { ROAD_WIDTH } from './road.js';
import { merge, stoneWallGeometry, lampPostMesh, signMesh, radioTowerMesh, figureMesh, boxRibbon } from './props.js';
import { signTexture } from './textures.js';
import { mulberry32, clamp } from './noise.js';

const up = new THREE.Vector3(0, 1, 0);
/** Group-local (lx,lz) -> world circle, for groups rotated about Y. */
function circ(g, lx, lz, r, kind = 'building') {
  const c = Math.cos(g.rotation.y), sn = Math.sin(g.rotation.y);
  return { x: g.position.x + c * lx + sn * lz, z: g.position.z - sn * lx + c * lz, r, kind };
}
function wallCircles(g, x0, z0, x1, z1, r, kind = 'building') {
  const out = [], len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(len / (r * 1.4)));
  for (let i = 0; i <= n; i++) { const t = i / n; out.push(circ(g, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, r, kind)); }
  return out;
}

/** Places a group at road station s, offset laterally (left +), aligned to the road tangent. */
export function placeAlong(obj, road, s, lateral, yOff = 0, yaw = 0) {
  const p = road.at(s);
  obj.position.set(p.x + p.nx * lateral, p.y + yOff, p.z + p.nz * lateral);
  obj.rotation.y = Math.atan2(p.tx, p.tz) + yaw;
  return obj;
}

/** Widow's Bridge: concrete deck on tall piers, steel railings, sodium lamps that stutter. */
export function buildBridge(road, terrain, mats, f = terrain.features.bridge) {
  if (!f) return { group: new THREE.Group(), fixtures: [] };
  const g = new THREE.Group();
  const fixtures = [];
  const N = road.count;
  const a = f.a - 2, b = f.b + 2;
  const hw = ROAD_WIDTH / 2 + 1.6;
  // deck, edge beams and railings as continuous ribbons along the samples (no stepping)
  const deck = [], rails = [];
  const ribbon = (offset, width, yTop, yBot) => boxRibbon(road, a, b, offset, width, yTop, yBot);
  deck.push(ribbon(0, hw * 2, -0.05, -1.45));
  for (const side of [-1, 1]) {
    deck.push(ribbon(side * (hw - 0.25), 0.5, 0.35, -2.4));
    rails.push(ribbon(side * (hw - 0.3), 0.08, 1.19, 1.11));
    rails.push(ribbon(side * (hw - 0.3), 0.05, 0.68, 0.62));
  }
  for (let i = a; i < b; i++) {
    const s0 = road.samples[((i % N) + N) % N];
    const yaw = Math.atan2(s0.tx, s0.tz);
    for (const side of [-1, 1]) {
      if (i % 2 === 0) {
        const post = new THREE.BoxGeometry(0.1, 1.2, 0.1);
        post.translate(s0.x + s0.nx * side * (hw - 0.3), s0.y + 0.6, s0.z + s0.nz * side * (hw - 0.3));
        rails.push(post);
      }
    }
    // piers every 12 samples (48 m)
    if ((i - a) % 12 === 6) {
      for (const side of [-1, 1]) {
        const px = s0.x + s0.nx * side * (hw - 1.2), pz = s0.z + s0.nz * side * (hw - 1.2);
        const groundY = terrain.heightAt(px, pz) - 6;
        const h = Math.max(4, s0.y - 1.4 - groundY);
        const pier = new THREE.CylinderGeometry(1.1, 1.6, h, 12);
        pier.translate(px, groundY + h / 2, pz);
        deck.push(pier);
      }
      const cb = new THREE.BoxGeometry(hw * 2 - 1, 1.2, 2.2);
      cb.rotateY(yaw); cb.translate(s0.x, s0.y - 2.0, s0.z);
      deck.push(cb);
    }
    // lamps every 10 samples, alternating sides
    if ((i - a) % 10 === 3) {
      const side = ((i - a) / 10) % 2 === 0 ? 1 : -1;
      const lp = lampPostMesh(mats, 5.2);
      lp.position.set(s0.x + s0.nx * side * (hw - 0.55), s0.y, s0.z + s0.nz * side * (hw - 0.55));
      lp.rotation.y = Math.atan2(s0.tx, s0.tz) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
      g.add(lp);
      lp.updateMatrixWorld(true);
      const wp = lp.localToWorld(lp.userData.lightPos.clone());
      fixtures.push({ pos: wp, color: new THREE.Color(0xffa040), intensity: 220, range: 26, flicker: 'sodium', bulb: lp.userData.bulb });
    }
  }
  const deckMesh = new THREE.Mesh(merge(deck), mats.concrete);
  deckMesh.castShadow = true; deckMesh.receiveShadow = true;
  g.add(deckMesh);
  const railMesh = new THREE.Mesh(merge(rails), mats.iron);
  railMesh.castShadow = true;
  g.add(railMesh);
  // name plaques at both ends
  const tex = signTexture(f.index ? ['SORROW CREEK', 'bridge · 1957'] : ["WIDOW'S BRIDGE", 'est. 1931'], { bg: '#2b2e2c', fg: '#d8d4c4', w: 512, h: 200 });
  for (const [ss, yaw] of [[road.samples[((a - 4) % N + N) % N].s, 0], [road.samples[(b + 4) % N].s, Math.PI]]) {
    const sign = signMesh(tex, 2.2, 0.85, 2.0, mats);
    placeAlong(sign, road, ss, yaw === 0 ? 6.5 : -6.5, 0, yaw);
    g.add(sign);
  }
  return { group: g, fixtures };
}

/** Mercy Tunnel: a lined half-cylinder bore with portals and a row of flickering fixtures. */
export function buildTunnel(road, terrain, mats, f = terrain.features.tunnel) {
  if (!f) return { group: new THREE.Group(), fixtures: [] };
  const g = new THREE.Group();
  const fixtures = [];
  const N = road.count;
  const a = f.a, b = f.b;
  const R = 6.2;
  // bore as a ring strip: for each sample, ring of vertices in the plane perpendicular to the tangent
  const segs = 18;
  const pos = [], uv = [], idx = [];
  let ring = 0;
  for (let i = a - 1; i <= b + 1; i++) {
    const s = road.samples[((i % N) + N) % N];
    for (let k = 0; k <= segs; k++) {
      const ang = Math.PI * (k / segs); // 0 .. PI (left to right over the top)
      const lx = Math.cos(ang) * R, ly = Math.sin(ang) * R * 0.82;
      pos.push(s.x + s.nx * lx, s.y - 0.4 + ly + 0.6, s.z + s.nz * lx);
      uv.push(k / segs * 3, i * 0.5);
    }
    if (i > a - 1) {
      const r0 = (ring - 1) * (segs + 1), r1 = ring * (segs + 1);
      for (let k = 0; k < segs; k++) idx.push(r0 + k, r0 + k + 1, r1 + k, r0 + k + 1, r1 + k + 1, r1 + k);
    }
    ring++;
  }
  const bore = new THREE.BufferGeometry();
  bore.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  bore.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  bore.setIndex(idx);
  bore.computeVertexNormals();
  const boreMesh = new THREE.Mesh(bore, mats.tunnelWall);
  boreMesh.receiveShadow = true;
  g.add(boreMesh);
  // walkway kerbs + wall trim
  const kerbs = [];
  for (let i = a; i < b; i++) {
    const s0 = road.samples[i % N], s1 = road.samples[(i + 1) % N];
    const len = Math.hypot(s1.x - s0.x, s1.z - s0.z) + 0.02;
    const yaw = Math.atan2(s1.x - s0.x, s1.z - s0.z);

    // ceiling light every 5 samples (20 m)
    if ((i - a) % 5 === 2) {
      const fx = s0.x, fz = s0.z, fy = s0.y + R * 0.82 - 0.4;
      const box = new THREE.BoxGeometry(0.4, 0.14, 1.4);
      box.rotateY(yaw); box.translate(fx, fy, fz);
      const fixture = new THREE.Mesh(box, mats.iron); g.add(fixture);
      const tube = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 1.2), new THREE.MeshStandardMaterial({ color: 0xffd090, emissive: 0xffb050, emissiveIntensity: 5 }));
      tube.rotation.y = yaw; tube.position.set(fx, fy - 0.09, fz); g.add(tube);
      const idxL = Math.floor((i - a) / 5);
      const mode = idxL % 7 === 3 ? 'dead' : idxL % 5 === 1 ? 'strobe' : 'sodium';
      if (mode === 'dead') tube.material.emissiveIntensity = 0.05;
      fixtures.push({ pos: new THREE.Vector3(fx, fy - 0.3, fz), color: new THREE.Color(0xffb050), intensity: 160, range: 30, flicker: mode, bulb: tube });
    }
  }
  for (const side of [-1, 1]) kerbs.push(boxRibbon(road, a - 1, b + 1, side * (ROAD_WIDTH / 2 + 0.7), 1.4, 0.35, -0.3));
  const kerbMesh = new THREE.Mesh(merge(kerbs), mats.concrete);
  kerbMesh.receiveShadow = true; g.add(kerbMesh);
  // portals: heavy concrete facades
  for (const [i, dir] of [[a, -1], [b, 1]]) {
    const s = road.samples[((i % N) + N) % N];
    const yaw = Math.atan2(s.tx, s.tz);
    const facade = new THREE.Group();
    facade.position.set(s.x, s.y, s.z); facade.rotation.y = yaw;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(26, 14, 2.4), mats.concrete);
    wall.position.set(0, 5.5, dir * 0.6);
    // arch cut-out is faked: the wall sits behind an arch ring, and the road passes beneath the ring
    // Build the wall as two side pillars + a lintel so the opening is real.
    facade.remove(wall);
    const tileUV = (geo, sx, sy) => { const uv = geo.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * sx, uv.getY(k) * sy); return geo; };
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(tileUV(new THREE.BoxGeometry(7, 11, 2.4), 2, 3), mats.concrete);
      pillar.position.set(side * (R + 3.4), 5.0, 0); pillar.castShadow = true; pillar.receiveShadow = true; facade.add(pillar);
      // wing walls angling into the hillside
      const wing = new THREE.Mesh(tileUV(new THREE.BoxGeometry(6, 9, 1.2), 2, 3), mats.concreteDark);
      wing.position.set(side * (R + 8.5), 4.0, -dir * 2.2); wing.rotation.y = side * dir * 0.5; wing.castShadow = true; facade.add(wing);
    }
    const lintel = new THREE.Mesh(tileUV(new THREE.BoxGeometry(2 * R + 0.2, 5, 2.4), 4, 1.5), mats.concrete);
    lintel.position.set(0, R * 0.82 + 0.2 + 2.5, 0); lintel.castShadow = true; facade.add(lintel);
    const cornice = new THREE.Mesh(tileUV(new THREE.BoxGeometry(2 * R + 14.5, 0.6, 3.0), 6, 0.3), mats.concreteDark);
    cornice.position.set(0, 10.6, 0); cornice.castShadow = true; facade.add(cornice);
    const arch = new THREE.Mesh(new THREE.TorusGeometry(R + 0.25, 0.45, 8, 24, Math.PI), mats.concreteDark);
    arch.position.set(0, 0.2, dir * 1.3); facade.add(arch);
    const plaque = signMesh(signTexture(f.index ? ['SILENT BORE', '1963'] : ['MERCY TUNNEL', '1948   ·   0.48 km'], { bg: '#26292b', fg: '#cfc9b7', w: 512, h: 180 }), 4.2, 1.5, 0, mats);
    plaque.position.set(0, R * 0.82 + 1.0, dir * 1.35); plaque.rotation.y = dir > 0 ? 0 : Math.PI; facade.add(plaque);
    g.add(facade);
    // portal lamps
    for (const side of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xffa040, emissiveIntensity: 4 }));
      const lx = side * (R + 1.5), lz = dir * 1.6;
      const wp = new THREE.Vector3(s.x + Math.cos(yaw) * lx + Math.sin(yaw) * lz, s.y + 6.2, s.z - Math.sin(yaw) * lx + Math.cos(yaw) * lz);
      lamp.position.copy(wp); g.add(lamp);
      fixtures.push({ pos: wp.clone().add(new THREE.Vector3(0, -0.3, 0)), color: new THREE.Color(0xffa040), intensity: 120, range: 24, flicker: side > 0 ? 'sodium' : 'steady', bulb: lamp });
    }
  }
  const obstacles = [];
  for (const [i, dir] of [[a, -1], [b, 1]]) {
    const sp = road.samples[((i % N) + N) % N];
    const yaw = Math.atan2(sp.tx, sp.tz);
    const fake = { position: new THREE.Vector3(sp.x, sp.y, sp.z), rotation: { y: yaw } };
    for (const side of [-1, 1]) obstacles.push(...wallCircles(fake, side * (R + 0.6), -1.2, side * (R + 7), -1.2, 1.2));
  }
  // the one who waits at the far portal (events.js moves it)
  const fig = figureMesh();
  const sOut = road.samples[(b + 6) % N];
  fig.position.set(sOut.x + sOut.nx * 5.5, terrain.heightAt(sOut.x + sOut.nx * 5.5, sOut.z + sOut.nz * 5.5), sOut.z + sOut.nz * 5.5);
  fig.rotation.y = Math.atan2(sOut.tx, sOut.tz) + Math.PI;
  fig.visible = false;
  g.add(fig);
  return { group: g, fixtures, figure: fig, obstacles };
}

/** Last Chance Gas: canopy, pumps, kiosk, a sign with dead letters, one buzzing tube. */
export function buildGasStation(road, terrain, mats, s, side) {
  const g = new THREE.Group();
  const fixtures = [];
  const p = road.at(s);
  const yaw = Math.atan2(p.tx, p.tz);
  const off = side * 19;
  const cx = p.x + p.nx * off, cz = p.z + p.nz * off, cy = p.y - 0.1;
  g.position.set(cx, cy, cz); g.rotation.y = yaw;
  // apron
  const apron = new THREE.Mesh(new THREE.BoxGeometry(34, 0.3, 26), mats.asphaltOld); apron.position.y = 0.05; apron.receiveShadow = true; g.add(apron);
  // canopy
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(18, 0.9, 11), mats.panelRust); canopy.position.set(0, 5.4, 0); canopy.castShadow = true; canopy.receiveShadow = true; g.add(canopy);
  const fascia = new THREE.Mesh(new THREE.BoxGeometry(18.2, 0.5, 11.2), new THREE.MeshStandardMaterial({ color: 0x7a1f1f, roughness: 0.7 })); fascia.position.set(0, 5.05, 0); g.add(fascia);
  for (const [x, z] of [[-6, -3.5], [6, -3.5], [-6, 3.5], [6, 3.5]]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 5, 12), mats.iron); col.position.set(x, 2.5, z); col.castShadow = true; g.add(col);
  }
  // canopy tubes: three, one alive
  for (let i = -1; i <= 1; i++) {
    const alive = i === 0;
    const tube = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 3.6), new THREE.MeshStandardMaterial({ color: 0xe0f0ff, emissive: 0xc8e8ff, emissiveIntensity: alive ? 5 : 0.03 }));
    tube.position.set(i * 5.5, 4.9, 0); g.add(tube);
    if (alive) fixtures.push({ pos: new THREE.Vector3(cx, cy + 4.6, cz), color: new THREE.Color(0xbfe0ff), intensity: 700, range: 40, flicker: 'fluorescent', bulb: tube });
  }
  // pumps
  for (const x of [-3, 3]) {
    const pump = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 0.6), mats.panelRust); pump.position.set(x, 1.1, 0); pump.castShadow = true; g.add(pump);
    const island = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.25, 1.3), mats.concrete); island.position.set(x, 0.27, 0); g.add(island);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3), new THREE.MeshStandardMaterial({ color: 0x102010, emissive: 0x30ff60, emissiveIntensity: 0.4 })); screen.position.set(x, 1.5, 0.31); g.add(screen);
  }
  // kiosk
  const kiosk = new THREE.Group(); kiosk.position.set(0, 0, -10); g.add(kiosk);
  const walls = new THREE.Mesh(new THREE.BoxGeometry(14, 3.6, 6), mats.brick); walls.position.y = 1.8; walls.castShadow = true; walls.receiveShadow = true; kiosk.add(walls);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(14.8, 0.35, 6.8), mats.panelRust); roof.position.y = 3.75; roof.castShadow = true; kiosk.add(roof);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.9), new THREE.MeshPhysicalMaterial({ color: 0x0a0f14, roughness: 0.1, metalness: 0.2, clearcoat: 1, envMapIntensity: 1.5 }));
  win.position.set(-1, 1.9, 3.02); kiosk.add(win);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.3, 0.08), mats.iron); door.position.set(5.5, 1.15, 3.0); kiosk.add(door);
  // inside: a faint red glow (a drink cooler still running)
  const cooler = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.6), new THREE.MeshStandardMaterial({ color: 0x100000, emissive: 0xff3020, emissiveIntensity: 1.2 }));
  cooler.position.set(-4, 1.6, 2.9); kiosk.add(cooler);
  fixtures.push({ pos: new THREE.Vector3(cx, cy + 1.6, cz).add(new THREE.Vector3(Math.sin(yaw) * 0 - Math.cos(yaw) * -4, 0, Math.cos(yaw) * 0 + Math.sin(yaw) * -4)), color: new THREE.Color(0xff3020), intensity: 20, range: 9, flicker: 'steady', bulb: cooler });
  // pole sign with dead letters
  const signTex = signTexture(['LAST CHANCE', 'GAS'], { bg: '#f2e6c8', fg: '#8a1a1a', w: 512, h: 256 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 12, 10), mats.iron); pole.position.set(14, 6, 8); pole.castShadow = true; g.add(pole);
  const board = new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, 0.3), [mats.iron, mats.iron, mats.iron, mats.iron,
    new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.9, roughness: 0.5 }),
    new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.9, roughness: 0.5 })]);
  board.position.set(14, 11.5, 8); board.rotation.y = -side * 0.4; g.add(board);
  fixtures.push({ pos: new THREE.Vector3(cx, cy + 11.5, cz).add(new THREE.Vector3(Math.cos(yaw) * 14 + Math.sin(yaw) * 8, 0, -Math.sin(yaw) * 14 + Math.cos(yaw) * 8)), color: new THREE.Color(0xffe0a0), intensity: 260, range: 30, flicker: 'buzz', bulb: board.material[4] });
  // abandoned sedan, door open
  const wreck = new THREE.Group(); wreck.position.set(-11, 0.2, 4); wreck.rotation.y = 0.9; g.add(wreck);
  const wb = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 4.3), mats.paintOld); wb.position.y = 0.6; wb.castShadow = true; wreck.add(wb);
  const wc = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2.2), mats.paintOld); wc.position.set(0, 1.17, -0.2); wreck.add(wc);
  const wdoor = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 1.1), mats.paintOld); wdoor.position.set(1.2, 0.8, 0.9); wdoor.rotation.y = 1.1; wreck.add(wdoor);
  for (const [x, z] of [[-0.95, 1.4], [0.95, 1.4], [-0.95, -1.4], [0.95, -1.4]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.22, 14), mats.rubber); w.rotation.z = Math.PI / 2; w.position.set(x, 0.33, z); wreck.add(w); }
  const domeLight = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffe0b0, emissive: 0xffd090, emissiveIntensity: 3 })); domeLight.position.set(0, 1.4, 0); wreck.add(domeLight);
  fixtures.push({ pos: new THREE.Vector3(cx, cy + 1.4, cz).add(new THREE.Vector3(Math.cos(yaw) * -11 + Math.sin(yaw) * 4, 0, -Math.sin(yaw) * -11 + Math.cos(yaw) * 4)), color: new THREE.Color(0xffd090), intensity: 8, range: 6, flicker: 'steady', bulb: domeLight });
  // barrels, a shopping cart-ish clutter
  const rnd = mulberry32(77);
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10), mats.panelRust);
    b.position.set(8 + rnd() * 6, 0.45, -8 + rnd() * 5); b.rotation.z = rnd() > 0.7 ? Math.PI / 2 : 0; b.castShadow = true; g.add(b);
  }
  g.userData.wreck = wreck; g.userData.domeLight = domeLight;
  const obstacles = [];
  for (const [x, z] of [[-6, -3.5], [6, -3.5], [-6, 3.5], [6, 3.5]]) obstacles.push(circ(g, x, z, 0.4));
  for (const x of [-3, 3]) obstacles.push(circ(g, x, 0, 1.0));
  obstacles.push(...wallCircles(g, -7, -10, 7, -10, 3.2));
  obstacles.push(circ(g, 14, 8, 0.4));
  obstacles.push(circ(g, -11 + Math.sin(0.9) * 1.2, 4 + Math.cos(0.9) * 1.2, 1.2), circ(g, -11 - Math.sin(0.9) * 1.2, 4 - Math.cos(0.9) * 1.2, 1.2));
  return { group: g, fixtures, pad: { x: cx, z: cz, r: 26, y: cy }, obstacles };
}

/** Hallow Chapel cemetery: iron fence, leaning headstones, a roofless stone chapel, one lantern. */
export function buildCemetery(road, terrain, mats, s, side) {
  const g = new THREE.Group();
  const fixtures = [];
  const p = road.at(s);
  const yaw = Math.atan2(p.tx, p.tz);
  const off = side * 22;
  const cx = p.x + p.nx * off, cz = p.z + p.nz * off, cy = p.y - 0.4;
  g.position.set(cx, cy, cz); g.rotation.y = yaw;
  const rnd = mulberry32(1313);
  // headstones (instanced)
  const stoneGeo = new THREE.BoxGeometry(0.6, 1.0, 0.14);
  const crossGeo = merge([new THREE.BoxGeometry(0.14, 1.4, 0.12), new THREE.BoxGeometry(0.7, 0.14, 0.12).translate(0, 0.35, 0)]);
  const stones = new THREE.InstancedMesh(stoneGeo, mats.stone, 60);
  const crosses = new THREE.InstancedMesh(crossGeo, mats.stone, 30);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
  let si = 0, ci = 0;
  for (let r = 0; r < 6; r++) for (let c = 0; c < 15; c++) {
    const x = -14 + c * 2 + (rnd() - 0.5) * 0.6, z = -8 + r * 2.6 + (rnd() - 0.5) * 0.6;
    const lean = (rnd() - 0.5) * 0.5;
    q.setFromEuler(new THREE.Euler(lean, (rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.25));
    if (rnd() > 0.65 && ci < 30) { pos.set(x, 0.7, z); m.compose(pos, q, sc); crosses.setMatrixAt(ci++, m); }
    else if (si < 60) { pos.set(x, 0.5, z); m.compose(pos, q, sc); stones.setMatrixAt(si++, m); }
  }
  stones.count = si; crosses.count = ci;
  stones.castShadow = true; crosses.castShadow = true;
  g.add(stones, crosses);
  // fence: posts + two rails with spikes
  const fence = [];
  const W = 34, D = 24;
  const ring = [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]];
  for (let e = 0; e < 4; e++) {
    const [x0, z0] = ring[e], [x1, z1] = ring[(e + 1) % 4];
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.floor(len / 2);
    const ang = Math.atan2(x1 - x0, z1 - z0);
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      if (e === 2 && Math.abs(t - 0.5) < 0.06) continue; // gate gap
      const post = new THREE.CylinderGeometry(0.05, 0.05, 1.9, 6); post.translate(x, 0.95, z); fence.push(post);
      const spike = new THREE.ConeGeometry(0.06, 0.25, 5); spike.translate(x, 2.0, z); fence.push(spike);
      if (i < n) {
        for (const y of [0.5, 1.6]) { const rail = new THREE.BoxGeometry(0.04, 0.04, len / n); rail.rotateY(ang); rail.translate((x + x0 + (x1 - x0) * ((i + 1) / n)) / 2, y, (z + z0 + (z1 - z0) * ((i + 1) / n)) / 2); fence.push(rail); }
        for (let k = 1; k < 4; k++) { const bar = new THREE.CylinderGeometry(0.02, 0.02, 1.7, 4); bar.translate(x + (x1 - x0) / n * k / 4, 0.95, z + (z1 - z0) / n * k / 4); fence.push(bar); }
      }
    }
  }
  const fenceMesh = new THREE.Mesh(merge(fence), mats.iron); fenceMesh.castShadow = true; g.add(fenceMesh);
  // chapel ruin
  const chapel = new THREE.Group(); chapel.position.set(6, 0, 4); chapel.rotation.y = -0.2; g.add(chapel);
  const wallL = new THREE.Mesh(stoneWallGeometry(9, 5, 1), mats.stone); wallL.position.set(0, 2.5, -3); chapel.add(wallL);
  const wallR = new THREE.Mesh(stoneWallGeometry(9, 4.2, 2), mats.stone); wallR.position.set(0, 2.1, 3); chapel.add(wallR);
  const wallB = new THREE.Mesh(stoneWallGeometry(6, 6.5, 3), mats.stone); wallB.rotation.y = Math.PI / 2; wallB.position.set(-4.5, 3.25, 0); chapel.add(wallB);
  const wallF = new THREE.Mesh(stoneWallGeometry(2, 3, 4), mats.stone); wallF.rotation.y = Math.PI / 2; wallF.position.set(4.5, 1.5, 2); chapel.add(wallF);
  chapel.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // tall arched window hole faked with a dark frame + a lantern inside
  const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffc070, emissive: 0xffa040, emissiveIntensity: 5 }));
  lantern.position.set(-2, 1.2, 0); chapel.add(lantern);
  const lw = new THREE.Vector3(); chapel.updateMatrixWorld(true);
  g.updateMatrixWorld(true);
  lantern.getWorldPosition(lw);
  fixtures.push({ pos: lw, color: new THREE.Color(0xffa040), intensity: 40, range: 16, flicker: 'candle', bulb: lantern });
  // sign at the road
  const sign = signMesh(signTexture(['HALLOW CHAPEL', 'cemetery'], { bg: '#2a2a28', fg: '#d6d0bd', w: 512, h: 200 }), 2.2, 0.9, 1.6, mats);
  placeAlong(sign, road, s - 30, side * 6.5, 0, side > 0 ? 0 : Math.PI);
  const obstacles = [];
  for (let e = 0; e < 4; e++) { const [x0, z0] = ring[e], [x1, z1] = ring[(e + 1) % 4]; obstacles.push(...wallCircles(g, x0, z0, x1, z1, 0.35, 'fence')); }
  obstacles.push(circ(g, 6, 4, 5.0));
  obstacles.push(circ(g, sign.position.x, sign.position.z, 0, 'none'));
  obstacles.pop();
  obstacles.push({ x: sign.position.x, z: sign.position.z, r: 0.25, kind: 'sign' });
  return { group: g, fixtures, pad: { x: cx, z: cz, r: 26, y: cy + 0.4 }, sign, obstacles };
}

/** Overlook: stone parapet on the valley side, an interpretive sign, and the summit mast up the hill. */
export function buildOverlook(road, terrain, mats, s, side, elevation) {
  const g = new THREE.Group();
  const fixtures = [];
  const p = road.at(s);
  const yaw = Math.atan2(p.tx, p.tz);
  const off = side * 9;
  const cx = p.x + p.nx * off, cz = p.z + p.nz * off, cy = p.y - 0.15;
  g.position.set(cx, cy, cz); g.rotation.y = yaw;
  const pad = new THREE.Mesh(new THREE.BoxGeometry(40, 0.3, 9), mats.asphaltOld); pad.position.y = 0.05; pad.receiveShadow = true; g.add(pad);
  const wall = new THREE.Mesh(stoneWallGeometry(40, 1.1, 9), mats.stone); wall.position.set(0, 0.55, side * 4.2); wall.castShadow = true; wall.receiveShadow = true; g.add(wall);
  const sign = signMesh(signTexture(['HOLLOW PASS', `ELEV ${Math.round(elevation)} m`], { bg: '#5a3a1a', fg: '#f0e6d0', w: 512, h: 256 }), 2.0, 1.0, 1.4, mats);
  sign.position.set(-8, 0.2, side * 3.2); sign.rotation.y = side > 0 ? Math.PI : 0; g.add(sign);
  const bench = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 0.5), mats.woodOld); bench.position.set(4, 0.6, side * 2.8); g.add(bench);
  for (const x of [3.2, 4.8]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.55, 0.45), mats.iron); leg.position.set(x, 0.3, side * 2.8); g.add(leg); }
  // coin telescope
  const tp = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 1.3, 8), mats.iron); tp.position.set(9, 0.65, side * 3.2); g.add(tp);
  const tt = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.09, 0.7, 10), mats.iron); tt.rotation.x = side * Math.PI / 2 - 0.2; tt.position.set(9, 1.35, side * 3.4); g.add(tt);
  const obstacles = [...wallCircles(g, -20, side * 4.2, 20, side * 4.2, 0.5), circ(g, 4, side * 2.8, 0.7), circ(g, 9, side * 3.2, 0.3), circ(g, -8, side * 3.2, 0.3, 'sign')];
  return { group: g, fixtures, pad: { x: cx, z: cz, r: 24, y: cy + 0.15 }, obstacles };
}

export function buildTower(terrain, mats, x, z) {
  const y = terrain.heightAt(x, z);
  const t = radioTowerMesh(mats, 42);
  t.position.set(x, y - 0.5, z);
  const hut = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 3), mats.panelRust); hut.position.set(x + 4, y + 1.3, z + 1); hut.castShadow = true;
  const g = new THREE.Group(); g.add(t, hut);
  const bw = new THREE.Vector3(); t.updateMatrixWorld(true); t.userData.beacon.getWorldPosition(bw);
  return { group: g, beacon: t.userData.beacon, fixtures: [{ pos: bw, color: new THREE.Color(0xff2020), intensity: 400, range: 90, flicker: 'beacon', bulb: t.userData.beacon }] };
}


/** Ashwood: a dead village along the road. Dark houses, one lit window, a church, a bus shelter, a phone box. */
export function buildVillage(road, terrain, mats, sStart, len) {
  const g = new THREE.Group();
  const fixtures = [], obstacles = [], pads = [];
  const rnd = mulberry32(4141);
  const house = (s, side, w, d, h, lit) => {
    const p = road.at(s);
    const off = side * (ROAD_WIDTH / 2 + 7 + rnd() * 4);
    const cx = p.x + p.nx * off, cz = p.z + p.nz * off;
    const cy = terrain.heightAt(cx, cz);
    const hg = new THREE.Group();
    hg.position.set(cx, cy - 0.2, cz); hg.rotation.y = Math.atan2(p.tx, p.tz) + (rnd() - 0.5) * 0.3;
    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats.woodOld); walls.position.y = h / 2; walls.castShadow = true; walls.receiveShadow = true; hg.add(walls);
    const roofG = new THREE.Shape(); roofG.moveTo(-w / 2 - 0.4, 0); roofG.lineTo(w / 2 + 0.4, 0); roofG.lineTo(0, w * 0.45); roofG.closePath();
    const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(roofG, { depth: d + 0.8, bevelEnabled: false }), mats.panelRust);
    roof.rotation.y = 0; roof.position.set(0, h, -d / 2 - 0.4); roof.castShadow = true; hg.add(roof);
    const snowRoof = new THREE.Mesh(new THREE.ExtrudeGeometry(roofG, { depth: d + 0.8, bevelEnabled: false }), mats.snowCap);
    snowRoof.scale.set(1, 1.04, 1); snowRoof.position.set(0, h + 0.02, -d / 2 - 0.4); hg.add(snowRoof);
    for (const wx of [-w / 4, w / 4]) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.1), lit && wx > 0 ? new THREE.MeshStandardMaterial({ color: 0x201000, emissive: 0xffb050, emissiveIntensity: 2.5 }) : new THREE.MeshPhysicalMaterial({ color: 0x05080c, roughness: 0.1, clearcoat: 1 }));
      win.position.set(wx, h * 0.55, side > 0 ? -d / 2 - 0.01 : d / 2 + 0.01); win.rotation.y = side > 0 ? Math.PI : 0; hg.add(win);
      if (lit && wx > 0) { const wp = new THREE.Vector3(); hg.updateMatrixWorld(true); win.getWorldPosition(wp); fixtures.push({ pos: wp, color: new THREE.Color(0xffb050), intensity: 35, range: 16, flicker: 'candle', bulb: win }); }
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.0, 0.08), mats.iron); door.position.set(0, 1.0, side > 0 ? -d / 2 - 0.02 : d / 2 + 0.02); hg.add(door);
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.4, 0.6), mats.brick); chimney.position.set(w * 0.3, h + w * 0.3, 0); hg.add(chimney);
    g.add(hg);
    obstacles.push(...wallCircles(hg, -w / 2, 0, w / 2, 0, d / 2 + 0.2));
    pads.push({ x: cx, z: cz, r: Math.max(w, d) * 0.7 + 2, y: cy - 0.2 });
    return hg;
  };
  let s = sStart + 40, k = 0;
  while (s < sStart + len - 40) {
    const side = k % 2 === 0 ? 1 : -1;
    house(s, side, 7 + rnd() * 4, 6 + rnd() * 3, 3 + rnd() * 1.2, k === 3);
    s += 34 + rnd() * 30; k++;
  }
  // church at the end, on the left
  {
    const p = road.at(sStart + len - 60);
    const off = ROAD_WIDTH / 2 + 14;
    const cx = p.x + p.nx * off, cz = p.z + p.nz * off, cy = terrain.heightAt(cx, cz);
    const cg = new THREE.Group(); cg.position.set(cx, cy - 0.3, cz); cg.rotation.y = Math.atan2(p.tx, p.tz) + Math.PI / 2;
    const nave = new THREE.Mesh(stoneWallGeometry(14, 6, 7), mats.stone); nave.scale.z = 12; nave.position.y = 3; nave.castShadow = true; cg.add(nave);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(4, 14, 4), mats.stone); tower.position.set(-8, 7, 0); tower.castShadow = true; cg.add(tower);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(2.8, 7, 4), mats.panelRust); spire.position.set(-8, 17.5, 0); spire.rotation.y = Math.PI / 4; cg.add(spire);
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), mats.iron); bell.position.set(-8, 12.5, 0); cg.add(bell);
    for (const side of [-1, 1]) { const win = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 3), new THREE.MeshStandardMaterial({ color: 0x100510, emissive: 0x6030a0, emissiveIntensity: 0.6 })); win.position.set(0, 3.5, side * 3.55); win.rotation.y = side > 0 ? 0 : Math.PI; cg.add(win); }
    g.add(cg);
    obstacles.push(...wallCircles(cg, -10, 0, 7, 0, 4.0));
    pads.push({ x: cx, z: cz, r: 14, y: cy - 0.3 });
    g.userData.church = cg;
  }
  // bus shelter + phone box with a flickering light near the middle
  {
    const p = road.at(sStart + len * 0.5);
    const off = -(ROAD_WIDTH / 2 + 2.6);
    const bx = p.x + p.nx * off, bz = p.z + p.nz * off, by = terrain.heightAt(bx, bz);
    const sh = new THREE.Group(); sh.position.set(bx, by, bz); sh.rotation.y = Math.atan2(p.tx, p.tz);
    const back = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.3, 0.08), mats.iron); back.position.set(0, 1.15, -0.9); sh.add(back);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.08, 2.0), mats.iron); roof.position.set(0, 2.35, 0); sh.add(roof);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.5), mats.woodOld); bench.position.set(0, 0.55, -0.5); sh.add(bench);
    const tube = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.08), new THREE.MeshStandardMaterial({ color: 0xe0f0ff, emissive: 0xc8e8ff, emissiveIntensity: 4 })); tube.position.set(0, 2.28, 0); sh.add(tube);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.4, 1.0), new THREE.MeshStandardMaterial({ color: 0x8a1a1a, roughness: 0.5, metalness: 0.3 })); box.position.set(3.0, 1.2, -0.4); sh.add(box);
    const boxGlass = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 0.8), new THREE.MeshPhysicalMaterial({ color: 0x0a0f14, roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.6 })); boxGlass.position.set(3.0, 1.35, -0.4); sh.add(boxGlass);
    g.add(sh);
    sh.updateMatrixWorld(true);
    const tp = new THREE.Vector3(); tube.getWorldPosition(tp);
    fixtures.push({ pos: tp.add(new THREE.Vector3(0, -0.3, 0)), color: new THREE.Color(0xbfe0ff), intensity: 90, range: 14, flicker: 'fluorescent', bulb: tube });
    obstacles.push(circ(sh, 0, -0.9, 1.6), circ(sh, 3.0, -0.4, 0.7));
    g.userData.phone = box;
    const phoneWorld = new THREE.Vector3(); box.getWorldPosition(phoneWorld); g.userData.phonePos = phoneWorld;
  }
  const sign = signMesh(signTexture(['ASHWOOD', 'pop. 212'], { bg: '#0b3d1f', fg: '#f4f7ec', w: 512, h: 256 }), 2.2, 1.1, 2.0, mats);
  placeAlong(sign, road, sStart - 20, -6.4, 0, Math.PI);
  g.add(sign);
  const sign2 = signMesh(signTexture(['ASHWOOD', 'pop. 0'], { bg: '#0b3d1f', fg: '#f4f7ec', w: 512, h: 256 }), 2.2, 1.1, 2.0, mats);
  placeAlong(sign2, road, sStart + len + 20, 6.4, 0, 0);
  g.add(sign2);
  return { group: g, fixtures, obstacles, pads };
}

/** Abandoned mine cut into the canyon wall: timber portal, ore cart, a lamp that should not be lit. */
export function buildMine(road, terrain, mats, s, side) {
  const g = new THREE.Group();
  const p = road.at(s);
  const off = side * (ROAD_WIDTH / 2 + 5.5);
  const cx = p.x + p.nx * off, cz = p.z + p.nz * off, cy = p.y;
  g.position.set(cx, cy, cz); g.rotation.y = Math.atan2(p.tx, p.tz) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
  const dark = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3.4, 6), new THREE.MeshBasicMaterial({ color: 0x000000 })); dark.position.set(0, 1.7, 3); g.add(dark);
  for (const x of [-1.9, 1.9]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.6, 0.4), mats.woodOld); post.position.set(x, 1.8, 0); post.castShadow = true; g.add(post); }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.5, 0.5), mats.woodOld); lintel.position.set(0, 3.7, 0); lintel.castShadow = true; g.add(lintel);
  const plank = signMesh(signTexture(['HOLLOW No. 3', 'KEEP OUT'], { bg: '#5a4a34', fg: '#e8dcc0', w: 512, h: 200, border: false }), 2.4, 0.9, 0, mats); plank.position.set(0, 4.2, 0.3); g.add(plank);
  const rails = new THREE.Mesh(merge([new THREE.BoxGeometry(0.06, 0.06, 9).translate(-0.45, 0.03, -1.5), new THREE.BoxGeometry(0.06, 0.06, 9).translate(0.45, 0.03, -1.5)]), mats.iron); g.add(rails);
  const cart = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 1.6), mats.panelRust); cart.position.set(0, 0.7, -3.5); cart.castShadow = true; g.add(cart);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffc070, emissive: 0xffa040, emissiveIntensity: 5 })); lamp.position.set(1.6, 2.6, 0.2); g.add(lamp);
  g.updateMatrixWorld(true);
  const lp = new THREE.Vector3(); lamp.getWorldPosition(lp);
  return { group: g, fixtures: [{ pos: lp, color: new THREE.Color(0xffa040), intensity: 40, range: 14, flicker: 'candle', bulb: lamp }], obstacles: [circ(g, -1.9, 0, 0.4), circ(g, 1.9, 0, 0.4), circ(g, 0, -3.5, 1.0)], pad: { x: cx + Math.cos(g.rotation.y) * 0, z: cz, r: 7, y: cy } };
}

/** Avalanche debris: snow mounds and boulders spilled across the road for ~90 m. Weave through. */
export function buildAvalanche(road, terrain, mats, s) {
  const g = new THREE.Group();
  const obstacles = [];
  const rnd = mulberry32(9090);
  const mounds = [], rocks = [];
  for (let i = 0; i < 26; i++) {
    const ss = s + rnd() * 90;
    const p = road.at(ss);
    const lat = (rnd() - 0.5) * 9;
    const size = 0.8 + rnd() * 1.6;
    const x = p.x + p.nx * lat, z = p.z + p.nz * lat;
    if (rnd() < 0.4) {
      const r = new THREE.IcosahedronGeometry(size * 0.7, 1); r.translate(x, p.y + size * 0.25, z); rocks.push(r);
      obstacles.push({ x, z, r: size * 0.7, kind: 'rock' });
    } else {
      const m = new THREE.SphereGeometry(size, 12, 8); m.scale(1.4, 0.55, 1.1); m.translate(x, p.y, z); mounds.push(m);
      obstacles.push({ x, z, r: size * 1.1, kind: 'snow' });
    }
  }
  if (mounds.length) { const mm = new THREE.Mesh(merge(mounds), mats.snowCap); mm.castShadow = true; mm.receiveShadow = true; g.add(mm); }
  if (rocks.length) { const rm = new THREE.Mesh(merge(rocks), mats.rock); rm.castShadow = true; rm.receiveShadow = true; g.add(rm); }
  const sign = signMesh(signTexture(['AVALANCHE', 'ZONE'], { bg: '#e8b800', fg: '#111', w: 256, h: 256 }), 1.3, 1.3, 2.0, mats);
  placeAlong(sign, road, s - 70, -6.2, 0, Math.PI); g.add(sign);
  obstacles.push({ x: sign.position.x, z: sign.position.z, r: 0.25, kind: 'sign' });
  return { group: g, fixtures: [], obstacles };
}

/** A spruce fallen across the road. Slow down and go around on the shoulder. */
export function buildFallenTree(road, terrain, mats, s, side) {
  const p = road.at(s);
  const g = new THREE.Group();
  const len = 13;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.5, len, 9), mats.bark);
  trunk.rotation.z = Math.PI / 2; trunk.position.y = 0.45; trunk.castShadow = true; g.add(trunk);
  const rootBall = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 1), mats.deadWood); rootBall.position.set(-len / 2, 0.8, 0); g.add(rootBall);
  for (let i = 0; i < 9; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.08, 1.4 + Math.random() * 1.2, 5), mats.deadWood); b.position.set(-len / 2 + 2 + i * 1.2, 0.5 + Math.random() * 0.4, (Math.random() - 0.5) * 0.6); b.rotation.set(Math.random() * 2, 0, Math.random() * 1.4 - 0.7); g.add(b); }
  // the tree lies from the uphill shoulder across the near lane
  const yaw = Math.atan2(p.tx, p.tz) + Math.PI / 2 + 0.25;
  const off = side * 2.0;
  g.position.set(p.x + p.nx * off, p.y, p.z + p.nz * off); g.rotation.y = yaw;
  const obstacles = wallCircles(g, -len / 2 + 0.5, 0, len / 2 - 0.5, 0, 0.55, 'tree');
  return { group: g, fixtures: [], obstacles };
}

/** Black ice sheen over the road for a stretch: a glossy transparent ribbon; the physics reads sample.ice. */
export function buildIceSheen(road, mats, a, b) {
  const geo = boxRibbon(road, a, b, 0, ROAD_WIDTH - 0.3, 0.05, 0.03);
  const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: 0x9fb4cc, roughness: 0.03, metalness: 0.0, transparent: true, opacity: 0.35, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.0 }));
  m.renderOrder = 2;
  const g = new THREE.Group(); g.add(m);
  const sign = signMesh(signTexture(['ICE'], { bg: '#e8b800', fg: '#111', w: 256, h: 256 }), 1.3, 1.3, 2.0, mats);
  placeAlong(sign, road, road.samples[((a % road.count) + road.count) % road.count].s - 60, -6.2, 0, Math.PI); g.add(sign);
  return { group: g, fixtures: [], obstacles: [{ x: sign.position.x, z: sign.position.z, r: 0.25, kind: 'sign' }] };
}

/** Abandoned convoy on the flats: cars nose to tail on the shoulder, doors open, one with hazards still blinking. */
export function buildConvoy(road, terrain, mats, s, side, buildVehicle) {
  const g = new THREE.Group();
  const obstacles = [], fixtures = [];
  const rnd = mulberry32(6161);
  for (let i = 0; i < 5; i++) {
    const ss = s + i * 9;
    const p = road.at(ss);
    const lat = side * (ROAD_WIDTH / 2 + 1.4);
    const v = buildVehicle(rnd() < 0.5 ? 'sedan' : 'pickup', null);
    v.position.set(p.x + p.nx * lat, terrain.heightAt(p.x + p.nx * lat, p.z + p.nz * lat) + 0.02, p.z + p.nz * lat);
    v.rotation.y = Math.atan2(p.tx, p.tz) + (rnd() - 0.5) * 0.15;
    v.userData.lampMat.emissiveIntensity = 0.05;
    v.userData.glares.forEach((sp) => (sp.visible = false));
    // snow on the roof
    const cap = new THREE.Mesh(new THREE.BoxGeometry(v.userData.W * 0.9, 0.18, 2.0), mats.snowCap); cap.position.set(0, 1.5, -0.2); v.add(cap);
    if (i === 2) {
      const haz = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.05), new THREE.MeshStandardMaterial({ color: 0x331a00, emissive: 0xffa020, emissiveIntensity: 5 })); haz.position.set(-0.62, 0.7, -v.userData.L / 2 - 0.02); v.add(haz);
      v.updateMatrixWorld(true); const hp = new THREE.Vector3(); haz.getWorldPosition(hp);
      fixtures.push({ pos: hp, color: new THREE.Color(0xffa020), intensity: 30, range: 12, flicker: 'beacon', bulb: haz });
    }
    g.add(v);
    obstacles.push({ x: v.position.x + Math.sin(v.rotation.y) * 1.3, z: v.position.z + Math.cos(v.rotation.y) * 1.3, r: 1.3, kind: 'vehicle' }, { x: v.position.x - Math.sin(v.rotation.y) * 1.3, z: v.position.z - Math.cos(v.rotation.y) * 1.3, r: 1.3, kind: 'vehicle' });
  }
  return { group: g, fixtures, obstacles };
}
