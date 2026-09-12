import * as THREE from 'three';
import { ROAD_WIDTH } from './road.js';
import { merge, stoneWallGeometry, lampPostMesh, signMesh, radioTowerMesh, figureMesh, boxRibbon } from './props.js';
import { signTexture } from './textures.js';
import { mulberry32, clamp } from './noise.js';

const up = new THREE.Vector3(0, 1, 0);

/** Places a group at road station s, offset laterally (left +), aligned to the road tangent. */
export function placeAlong(obj, road, s, lateral, yOff = 0, yaw = 0) {
  const p = road.at(s);
  obj.position.set(p.x + p.nx * lateral, p.y + yOff, p.z + p.nz * lateral);
  obj.rotation.y = Math.atan2(p.tx, p.tz) + yaw;
  return obj;
}

/** Widow's Bridge: concrete deck on tall piers, steel railings, sodium lamps that stutter. */
export function buildBridge(road, terrain, mats) {
  const f = terrain.features.bridge;
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
  const tex = signTexture(["WIDOW'S BRIDGE", 'est. 1931'], { bg: '#2b2e2c', fg: '#d8d4c4', w: 512, h: 200 });
  for (const [ss, yaw] of [[road.samples[((a - 4) % N + N) % N].s, 0], [road.samples[(b + 4) % N].s, Math.PI]]) {
    const sign = signMesh(tex, 2.2, 0.85, 2.0, mats);
    placeAlong(sign, road, ss, yaw === 0 ? 6.5 : -6.5, 0, yaw);
    g.add(sign);
  }
  return { group: g, fixtures };
}

/** Mercy Tunnel: a lined half-cylinder bore with portals and a row of flickering fixtures. */
export function buildTunnel(road, terrain, mats) {
  const f = terrain.features.tunnel;
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
    const plaque = signMesh(signTexture(['MERCY TUNNEL', '1948   ·   0.48 km'], { bg: '#26292b', fg: '#cfc9b7', w: 512, h: 180 }), 4.2, 1.5, 0, mats);
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
  // the one who waits at the far portal (events.js moves it)
  const fig = figureMesh();
  const sOut = road.samples[(b + 6) % N];
  fig.position.set(sOut.x + sOut.nx * 5.5, terrain.heightAt(sOut.x + sOut.nx * 5.5, sOut.z + sOut.nz * 5.5), sOut.z + sOut.nz * 5.5);
  fig.rotation.y = Math.atan2(sOut.tx, sOut.tz) + Math.PI;
  fig.visible = false;
  g.add(fig);
  return { group: g, fixtures, figure: fig };
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
  return { group: g, fixtures, pad: { x: cx, z: cz, r: 26, y: cy } };
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
  return { group: g, fixtures, pad: { x: cx, z: cz, r: 26, y: cy + 0.4 }, sign };
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
  return { group: g, fixtures, pad: { x: cx, z: cz, r: 24, y: cy + 0.15 } };
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
