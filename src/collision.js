import { clamp } from './noise.js';

/**
 * Static obstacle field: circles in the XZ plane stored in a coarse hash.
 * Trees, rocks, posts, buildings (as circle clusters) all register here.
 * The car is tested as two circles (front/rear axle) and pushed out.
 */
export class ObstacleField {
  constructor(cell = 24) {
    this.cell = cell;
    this.map = new Map();
    this.count = 0;
  }
  _key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  add(x, z, r, kind = 'tree', extra = null) {
    const k = this._key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    if (!this.map.has(k)) this.map.set(k, []);
    const o = { x, z, r, kind, extra };
    this.map.get(k).push(o);
    this.count++;
    return o;
  }
  /** Visit obstacles near (x,z) within radius. */
  near(x, z, radius, fn) {
    const r = Math.ceil(radius / this.cell);
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let ix = cx - r; ix <= cx + r; ix++) for (let iz = cz - r; iz <= cz + r; iz++) {
      const arr = this.map.get(this._key(ix, iz));
      if (!arr) continue;
      for (const o of arr) fn(o);
    }
  }
  /**
   * Resolve the car against obstacles. car: {pos, heading, vel, speed}. Returns an impact strength (0 = none).
   */
  resolve(car, dynamic = []) {
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    let impact = 0;
    const R = 1.05; // half width-ish
    const probes = [[1.55, R], [0.0, R + 0.05], [-1.5, R]];
    for (const [along, pr] of probes) {
      const px = car.pos.x + fx * along, pz = car.pos.z + fz * along;
      const test = (o) => {
        const dx = px - o.x, dz = pz - o.z;
        const d = Math.hypot(dx, dz);
        const min = o.r + pr;
        if (d >= min || d < 1e-4) return;
        const push = min - d;
        const nx = dx / d, nz = dz / d;
        car.pos.x += nx * push; car.pos.z += nz * push;
        // velocity into the obstacle is killed; speed bleeds off with the impact angle
        const vn = car.vel.x * nx + car.vel.z * nz;
        if (vn < 0) {
          const along2 = nx * fx + nz * fz; // how head-on the hit is
          const headOn = Math.abs(along2);
          impact = Math.max(impact, -vn * (0.3 + headOn * 0.7));
          car.vel.x -= nx * vn * 1.15; car.vel.z -= nz * vn * 1.15;
          const fwd = car.vel.x * fx + car.vel.z * fz;
          car.speed = fwd * (1 - headOn * 0.55);
          // scrape yaw: glance off
          car.heading += (nx * fz - nz * fx) * 0.04 * Math.sign(car.speed || 1) * (1 - headOn);
          if (o.kind === 'post' || o.kind === 'sign') { o.hit = true; }
        }
      };
      this.near(px, pz, 4, test);
      for (const o of dynamic) test(o);
    }
    return clamp(impact / 12, 0, 1);
  }
}
