import * as THREE from 'three';
import { clamp, lerp } from './noise.js';

/** Visor HUD drawn on a 2D canvas over the render: horizon, tapes, power, compass, waypoints, warnings. */
export class SuitHud {
  constructor(canvas) {
    this.c = canvas; this.ctx = canvas.getContext('2d');
    this.bootT = 0; this.booted = false; this.msgs = []; this.flash = 0;
    this.font = '"SF Mono", ui-monospace, Menlo, Consolas, monospace';
    this.v = new THREE.Vector3();
  }
  boot() { this.bootT = 0.001; }
  message(text, secs = 3) { this.msgs.push({ text, t: secs }); }
  draw(dt, suit, camera, waypoints, extra) {
    const W = this.c.width = window.innerWidth, H = this.c.height = window.innerHeight;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;
    const cyan = 'rgba(120,225,255,';
    const boot = this.bootT > 0 && this.bootT < 3.2;
    if (this.bootT > 0) this.bootT += dt;
    const bootK = boot ? clamp((this.bootT - 0.4) / 2.2, 0, 1) : 1;
    ctx.font = `13px ${this.font}`;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1.2;
    const alpha = 0.85 * bootK;
    // helmet edge vignette: darker frame with a soft eye-shaped opening
    const g = ctx.createRadialGradient(cx, cy * 1.05, H * 0.55, cx, cy * 1.05, H * 0.95);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // brow line
    ctx.fillStyle = 'rgba(4,6,10,0.92)';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H * 0.06); ctx.quadraticCurveTo(cx, H * 0.16, 0, H * 0.06); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, H); ctx.lineTo(W, H * 0.9); ctx.quadraticCurveTo(cx, H * 0.78, 0, H * 0.9); ctx.closePath(); ctx.fill();
    if (bootK <= 0) { this._bootText(ctx, W, H); return; }
    ctx.strokeStyle = cyan + alpha + ')'; ctx.fillStyle = cyan + alpha + ')';

    // ---- reticle ----
    ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2); ctx.fill();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.beginPath(); ctx.moveTo(cx + dx * 20, cy + dy * 20); ctx.lineTo(cx + dx * 34, cy + dy * 34); ctx.stroke(); }
    // ---- artificial horizon (pitch ladder), rolls with the view ----
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-suit.roll);
    const pxPerRad = H * 0.55;
    for (let deg = -60; deg <= 60; deg += 10) {
      const y = (deg * Math.PI / 180 + suit.pitch) * pxPerRad;
      if (Math.abs(y) > H * 0.36) continue;
      const w = deg === 0 ? 150 : 55;
      ctx.globalAlpha = alpha * (deg === 0 ? 0.9 : 0.5);
      ctx.beginPath(); ctx.moveTo(-w - 20, y); ctx.lineTo(-30, y); ctx.moveTo(30, y); ctx.lineTo(w + 20, y); ctx.stroke();
      if (deg !== 0) { ctx.textAlign = 'right'; ctx.fillText(String(-deg), -w - 26, y); ctx.textAlign = 'left'; ctx.fillText(String(-deg), w + 26, y); }
    }
    ctx.restore(); ctx.globalAlpha = 1;
    // ---- speed tape (left) and altitude tape (right) ----
    const tape = (x, value, unit, label, dir, step, scale) => {
      const top = H * 0.24, bot = H * 0.76, mid = (top + bot) / 2;
      ctx.globalAlpha = alpha * 0.75;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bot); ctx.stroke();
      for (let v = Math.floor((value - 60 / scale) / step) * step; v <= value + 60 / scale; v += step) {
        const y = mid - (v - value) * scale;
        if (y < top || y > bot || v < 0) continue;
        const major = v % (step * 5) === 0;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dir * (major ? 14 : 7), y); ctx.stroke();
        if (major) { ctx.textAlign = dir > 0 ? 'left' : 'right'; ctx.fillText(String(v), x + dir * 20, y); }
      }
      ctx.globalAlpha = alpha;
      ctx.textAlign = dir > 0 ? 'left' : 'right';
      ctx.font = `bold 26px ${this.font}`;
      ctx.fillText(String(Math.round(value)), x - dir * 12, mid);
      ctx.font = `11px ${this.font}`;
      ctx.fillText(unit, x - dir * 12, mid + 20);
      ctx.fillText(label, x - dir * 12, top - 14);
      ctx.font = `13px ${this.font}`;
    };
    tape(W * 0.19, suit.speed * 3.6, 'km/h', 'AIRSPEED', -1, 20, 0.9);
    tape(W * 0.81, suit.pos.y, 'm MSL', 'ALTITUDE', 1, 20, 0.9);
    ctx.textAlign = 'left'; ctx.globalAlpha = alpha * 0.8;
    ctx.fillText(`AGL ${Math.max(0, suit.altAGL).toFixed(0)} m`, W * 0.81 + 12, H * 0.76 + 18);
    ctx.textAlign = 'right';
    ctx.fillText(`V/S ${(suit.vel.y).toFixed(1)} m/s`, W * 0.19 - 12, H * 0.76 + 18);
    ctx.fillText(`${suit.gForce.toFixed(1)} G`, W * 0.19 - 12, H * 0.76 + 34);
    // ---- compass strip ----
    const hdg = ((-suit.yaw * 180 / Math.PI) % 360 + 360) % 360;
    const cw = W * 0.34, cyy = H * 0.135;
    ctx.globalAlpha = alpha * 0.8;
    for (let d = -60; d <= 60; d += 5) {
      const h = ((hdg + d) % 360 + 360) % 360;
      const x = cx + d / 60 * cw / 2;
      const major = h % 30 === 0;
      ctx.beginPath(); ctx.moveTo(x, cyy); ctx.lineTo(x, cyy + (major ? 10 : 5)); ctx.stroke();
      if (major) { ctx.textAlign = 'center'; const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }; ctx.fillText(names[h] || String(h), x, cyy - 10); }
    }
    ctx.beginPath(); ctx.moveTo(cx, cyy + 18); ctx.lineTo(cx - 5, cyy + 26); ctx.lineTo(cx + 5, cyy + 26); ctx.closePath(); ctx.fill();
    ctx.textAlign = 'center'; ctx.font = `bold 15px ${this.font}`; ctx.fillText(`${Math.round(hdg).toString().padStart(3, '0')}°`, cx, cyy + 40); ctx.font = `13px ${this.font}`;
    // ---- power + thrust bars (bottom left) ----
    const bx = W * 0.06, by = H * 0.83;
    const bar = (y, label, val, warn) => {
      ctx.globalAlpha = alpha; ctx.textAlign = 'left'; ctx.fillText(label, bx, y - 12);
      ctx.strokeRect(bx, y, 180, 8);
      ctx.fillStyle = warn ? 'rgba(255,90,60,' + alpha + ')' : cyan + alpha + ')';
      ctx.fillRect(bx + 1, y + 1, 178 * clamp(val, 0, 1), 6);
      ctx.fillStyle = cyan + alpha + ')';
    };
    bar(by - 44, 'ARC REACTOR', suit.power, suit.power < 0.2);
    bar(by - 14, `THRUST ${suit.boost > 0.5 ? '· AFTERBURNER' : ''}`, suit.thrustLevel, false);
    bar(by + 16, 'SUIT INTEGRITY', 1 - suit.damage, suit.damage > 0.6);
    // ---- status (bottom right) ----
    ctx.textAlign = 'right';
    const mode = suit.grounded ? 'GROUND' : suit.boost > 0.5 ? 'BOOST' : suit.thrustLevel > 0.3 ? 'FLIGHT' : 'HOVER';
    ctx.font = `bold 15px ${this.font}`; ctx.fillText(mode, W * 0.94, H * 0.8); ctx.font = `13px ${this.font}`;
    ctx.fillText(`${extra.time}`, W * 0.94, H * 0.8 + 22);
    ctx.fillText(`${extra.temp}`, W * 0.94, H * 0.8 + 40);
    if (extra.ringInfo) ctx.fillText(extra.ringInfo, W * 0.94, H * 0.8 + 58);
    // ---- waypoints projected into the view ----
    for (const wp of waypoints) {
      this.v.set(wp.x, wp.y, wp.z);
      const d = this.v.distanceTo(camera.position);
      this.v.project(camera);
      if (this.v.z > 1) continue;
      const sx = (this.v.x * 0.5 + 0.5) * W, sy = (-this.v.y * 0.5 + 0.5) * H;
      if (sx < 40 || sx > W - 40 || sy < H * 0.17 || sy > H * 0.78) continue;
      const near = d < 60;
      ctx.globalAlpha = alpha * (wp.active ? 1 : 0.55);
      ctx.strokeStyle = wp.active ? 'rgba(255,200,80,' + alpha + ')' : cyan + alpha + ')';
      ctx.fillStyle = ctx.strokeStyle;
      const s = wp.active ? 9 : 6;
      ctx.beginPath(); ctx.moveTo(sx, sy - s); ctx.lineTo(sx + s, sy); ctx.lineTo(sx, sy + s); ctx.lineTo(sx - s, sy); ctx.closePath(); ctx.stroke();
      ctx.textAlign = 'left';
      ctx.fillText(`${wp.name}`, sx + 14, sy - 6);
      ctx.fillText(`${d < 1000 ? d.toFixed(0) + ' m' : (d / 1000).toFixed(1) + ' km'}`, sx + 14, sy + 8);
      if (near) { ctx.beginPath(); ctx.arc(sx, sy, 16, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.strokeStyle = cyan + alpha + ')'; ctx.fillStyle = ctx.strokeStyle;
    // ---- radar (bottom centre): waypoints and rings within 3 km, rotated with heading ----
    {
      const rx = cx, ry = H * 0.905, rr = Math.min(58, H * 0.07);
      ctx.globalAlpha = alpha * 0.8;
      ctx.beginPath(); ctx.arc(rx, ry, rr, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(rx, ry, rr * 0.5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(rx, ry - rr); ctx.lineTo(rx, ry - rr + 8); ctx.stroke();
      const all = extra.radar || [];
      for (const wp of all) {
        const dx = wp.x - suit.pos.x, dz = wp.z - suit.pos.z, d = Math.hypot(dx, dz);
        if (d > 3000) continue;
        // rotate into heading space: forward is up
        const ang = Math.atan2(dx, -dz) - (-suit.yaw);
        const rd = (d / 3000) * rr;
        const bx = rx + Math.sin(ang) * rd, by = ry - Math.cos(ang) * rd;
        ctx.fillStyle = wp.active ? 'rgba(255,200,80,' + alpha + ')' : wp.ring ? 'rgba(120,225,255,' + alpha * 0.5 + ')' : cyan + alpha + ')';
        ctx.beginPath(); ctx.arc(bx, by, wp.active ? 3.2 : 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = cyan + alpha + ')';
      ctx.beginPath(); ctx.moveTo(rx, ry - 5); ctx.lineTo(rx + 4, ry + 4); ctx.lineTo(rx - 4, ry + 4); ctx.closePath(); ctx.fill();
      ctx.textAlign = 'center'; ctx.font = `10px ${this.font}`; ctx.fillText('3 km', rx + rr + 16, ry); ctx.font = `13px ${this.font}`;
    }
    // ---- warnings ----
    ctx.textAlign = 'center'; ctx.font = `bold 16px ${this.font}`;
    let wy = H * 0.66;
    const warn = (t, red = true) => { ctx.fillStyle = red ? `rgba(255,80,60,${alpha * (0.6 + 0.4 * Math.sin(performance.now() / 120))})` : cyan + alpha + ')'; ctx.fillText(t, cx, wy); wy += 22; };
    if (!suit.grounded && suit.altAGL < 25 && suit.vel.y < -8) warn('PULL UP');
    if (suit.power < 0.15) warn('POWER LOW');
    if (suit.outOfBounds) warn('LEAVING OPERATIONAL AREA · TURN BACK');
    if (suit.damage > 0.6) warn('SUIT INTEGRITY CRITICAL');
    for (let i = this.msgs.length - 1; i >= 0; i--) { const m = this.msgs[i]; m.t -= dt; if (m.t <= 0) { this.msgs.splice(i, 1); continue; } warn(m.text, false); }
    ctx.font = `13px ${this.font}`;
    // damage tint
    if (suit.damage > 0.3) { ctx.fillStyle = `rgba(255,40,20,${(suit.damage - 0.3) * 0.12})`; ctx.fillRect(0, 0, W, H); }
    if (boot) this._bootText(ctx, W, H);
    ctx.globalAlpha = 1;
  }
  _bootText(ctx, W, H) {
    const t = this.bootT;
    const lines = ['MARK VII · HOLLOW PASS SORTIE', 'ARC REACTOR .......... ONLINE', 'FLIGHT SYSTEMS ....... ONLINE', 'REPULSORS ............ ARMED', 'HUD .................. CALIBRATED', 'WEATHER: SNOW · -8°C · MOON 94%'];
    ctx.font = `13px ${this.font}`; ctx.textAlign = 'left';
    const n = Math.min(lines.length, Math.floor(t / 0.35));
    for (let i = 0; i < n; i++) { ctx.fillStyle = `rgba(120,225,255,${clamp((3.2 - t) * 2, 0, 0.9)})`; ctx.fillText(lines[i], W * 0.06, H * 0.3 + i * 20); }
  }
}
