import * as THREE from 'three';
import { Simplex, mulberry32, clamp } from './noise.js';

const sx = new Simplex(9001);

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function makeTex(c, { repeat = 1, srgb = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Height field (Float32, 0..1) -> tangent-space normal map canvas. */
function normalFromHeight(hf, w, h, strength = 2.0) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = hf[y * w + ((x - 1 + w) % w)], r = hf[y * w + ((x + 1) % w)];
      const u = hf[((y - 1 + h) % h) * w + x], dn = hf[((y + 1) % h) * w + x];
      let nx = (l - r) * strength, ny = (u - dn) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * w + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Wet, cracked, salt-stained asphalt. Returns {map, roughnessMap, normalMap}. */
export function asphaltTextures() {
  const S = 512;
  const rnd = mulberry32(42);
  const hf = new Float32Array(S * S);
  const alb = canvas(S, S), rough = canvas(S, S);
  const actx = alb.getContext('2d'), rctx = rough.getContext('2d');
  const aimg = actx.createImageData(S, S), rimg = rctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      // fine aggregate grain (tileable via wrapped noise coordinates)
      const grain = sx.fbm(x * 0.35, y * 0.35, 3, 2.1, 0.55);
      const patch = sx.fbm(u * 6 + 30, v * 6 + 30, 4);
      const wetPools = sx.fbm(u * 4 + 100, v * 4 + 100, 3);
      const crack = Math.abs(sx.noise2(u * 9 + 7, v * 9 + 7));
      const crackLine = crack < 0.025 ? 1 : 0;
      let base = 0.11 + grain * 0.06 + patch * 0.03;
      base = clamp(base, 0.03, 0.4);
      // salt / ice streaks
      const salt = Math.max(0, sx.fbm(u * 3 + 50, v * 40 + 3, 2)) ** 3;
      base += salt * 0.35;
      if (crackLine) base *= 0.35;
      const g = base * 255;
      const i = (y * S + x) * 4;
      aimg.data[i] = g * 0.98; aimg.data[i + 1] = g * 1.0; aimg.data[i + 2] = g * 1.08; aimg.data[i + 3] = 255;
      // roughness: wet pools are glossy, salt is rough
      let r = 0.55 + grain * 0.15 - Math.max(0, wetPools) * 0.55 + salt * 0.4;
      if (crackLine) r = 0.85;
      r = clamp(r, 0.12, 0.95);
      rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = r * 255; rimg.data[i + 3] = 255;
      hf[y * S + x] = 0.5 + grain * 0.5 - (crackLine ? 0.4 : 0) + Math.max(0, wetPools) * 0.05;
    }
  }
  actx.putImageData(aimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  void rnd;
  return {
    map: makeTex(alb, { srgb: true, aniso: 16 }),
    roughnessMap: makeTex(rough, { aniso: 16 }),
    normalMap: makeTex(normalFromHeight(hf, S, S, 1.6), { aniso: 16 }),
  };
}

/** Snow + rock detail normal (used with vertex-colour blending on the terrain). */
export function snowTextures() {
  const S = 512;
  const hf = new Float32Array(S * S);
  const alb = canvas(S, S), rough = canvas(S, S);
  const actx = alb.getContext('2d'), rctx = rough.getContext('2d');
  const aimg = actx.createImageData(S, S), rimg = rctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const drift = sx.fbm(u * 5 + 10, v * 5 + 10, 4, 2, 0.5);
      const grain = sx.fbm(x * 0.5, y * 0.5, 2, 2, 0.5);
      const sparkle = 0;
      let b = 0.82 + drift * 0.08 + grain * 0.04 + sparkle * 0.15;
      b = clamp(b, 0.5, 1);
      const i = (y * S + x) * 4;
      aimg.data[i] = b * 235; aimg.data[i + 1] = b * 242; aimg.data[i + 2] = b * 255; aimg.data[i + 3] = 255;
      const r = clamp(0.62 + grain * 0.2 - sparkle * 0.5, 0.15, 0.9);
      rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = r * 255; rimg.data[i + 3] = 255;
      hf[y * S + x] = 0.5 + drift * 0.5 + grain * 0.2;
    }
  }
  actx.putImageData(aimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  return {
    map: makeTex(alb, { srgb: true }),
    roughnessMap: makeTex(rough),
    normalMap: makeTex(normalFromHeight(hf, S, S, 2.5)),
  };
}

export function rockTextures() {
  const S = 512;
  const hf = new Float32Array(S * S);
  const alb = canvas(S, S);
  const actx = alb.getContext('2d');
  const aimg = actx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const strata = Math.sin(v * 60 + sx.fbm(u * 4, v * 4, 3) * 6) * 0.5 + 0.5;
      const ridge = sx.ridged(u * 8 + 3, v * 8 + 3, 4);
      const grain = sx.fbm(x * 0.4, y * 0.4, 3);
      let b = 0.16 + ridge * 0.16 + strata * 0.06 + grain * 0.05;
      b = clamp(b, 0.05, 0.6);
      const i = (y * S + x) * 4;
      aimg.data[i] = b * 235; aimg.data[i + 1] = b * 228; aimg.data[i + 2] = b * 222; aimg.data[i + 3] = 255;
      hf[y * S + x] = ridge * 0.7 + strata * 0.2 + grain * 0.1;
    }
  }
  actx.putImageData(aimg, 0, 0);
  return { map: makeTex(alb, { srgb: true }), normalMap: makeTex(normalFromHeight(hf, S, S, 3.0)) };
}

/** Tyre tread ring texture. */
export function tyreTextures() {
  const W = 256, H = 64;
  const alb = canvas(W, H), hfc = new Float32Array(W * H);
  const ctx = alb.getContext('2d');
  ctx.fillStyle = '#141414'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#080808';
  for (let x = 0; x < W; x += 12) {
    ctx.fillRect(x, 6, 5, H - 12);
    ctx.fillRect(x + 3, 0, 3, 8);
    ctx.fillRect(x + 3, H - 8, 3, 8);
  }
  ctx.fillRect(0, 22, W, 3); ctx.fillRect(0, 40, W, 3);
  const img = ctx.getImageData(0, 0, W, H).data;
  for (let i = 0; i < W * H; i++) hfc[i] = img[i * 4] / 255;
  return { map: makeTex(alb, { srgb: true }), normalMap: makeTex(normalFromHeight(hfc, W, H, 3)) };
}

export function concreteTextures() {
  const S = 512;
  const hf = new Float32Array(S * S);
  const alb = canvas(S, S);
  const actx = alb.getContext('2d');
  const aimg = actx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const grain = sx.fbm(x * 0.6, y * 0.6, 3);
      const stain = Math.max(0, sx.fbm(u * 3 + 20, v * 9 + 20, 4));
      const seam = (x % 128 < 2 || y % 256 < 2) ? 0.5 : 1;
      let b = (0.32 + grain * 0.06 - stain * 0.2) * seam;
      b = clamp(b, 0.05, 0.6);
      const i = (y * S + x) * 4;
      aimg.data[i] = b * 230; aimg.data[i + 1] = b * 226; aimg.data[i + 2] = b * 218; aimg.data[i + 3] = 255;
      hf[y * S + x] = 0.5 + grain * 0.3 - (seam < 1 ? 0.4 : 0);
    }
  }
  actx.putImageData(aimg, 0, 0);
  return { map: makeTex(alb, { srgb: true }), normalMap: makeTex(normalFromHeight(hf, S, S, 2.2)) };
}

export function barkTextures() {
  const W = 128, H = 512;
  const hf = new Float32Array(W * H);
  const alb = canvas(W, H);
  const actx = alb.getContext('2d');
  const aimg = actx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const furrow = Math.abs(sx.noise2(u * 10, v * 60)) ;
      const grain = sx.fbm(x * 0.7, y * 0.2, 3);
      let b = 0.12 + furrow * 0.12 + grain * 0.05;
      const i = (y * W + x) * 4;
      aimg.data[i] = b * 210; aimg.data[i + 1] = b * 190; aimg.data[i + 2] = b * 175; aimg.data[i + 3] = 255;
      hf[y * W + x] = furrow;
    }
  }
  actx.putImageData(aimg, 0, 0);
  return { map: makeTex(alb, { srgb: true }), normalMap: makeTex(normalFromHeight(hf, W, H, 3)) };
}

/** Soft radial sprite for particles / glows. */
export function glowSprite(size = 128, inner = 0.0, color = '#ffffff') {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, inner * size / 2, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(0.35, color.replace(')', ',0.5)').replace('rgb(', 'rgba(') === color ? color : color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function snowflakeSprite() {
  const size = 64;
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.15)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Road sign face: text on reflective green/yellow/white. */
export function signTexture(lines, { bg = '#0b3d1f', fg = '#f4f7ec', w = 512, h = 256, border = true } = {}) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  if (border) { ctx.strokeStyle = fg; ctx.lineWidth = 8; ctx.strokeRect(12, 12, w - 24, h - 24); }
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const fs = Math.min(h / (lines.length + 0.8), w / 9);
  ctx.font = `bold ${fs}px Helvetica, Arial, sans-serif`;
  lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * fs * 1.15));
  // grime
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const x = (i / 4) % w, y = Math.floor(i / 4 / w);
    const g = 1 - Math.max(0, sx.fbm(x / 60, y / 60, 3)) * 0.35;
    img.data[i] *= g; img.data[i + 1] *= g; img.data[i + 2] *= g;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Star field on a big cube-friendly equirect. */
export function starTexture() {
  const W = 2048, H = 1024;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const rnd = mulberry32(77);
  // milky way band
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      // band tilted across the sky
      const band = Math.exp(-Math.pow((v - 0.5 + Math.sin(u * Math.PI * 2) * 0.18) * 7, 2));
      const cloud = Math.max(0, sx.fbm(u * 14, v * 7, 5, 2.2, 0.55)) * band;
      const dark = Math.max(0, sx.fbm(u * 30 + 9, v * 15 + 9, 3)) * band;
      const val = clamp(cloud * 0.9 - dark * 0.5, 0, 1) * 80;
      const i = (y * W + x) * 4;
      img.data[i] = val * 0.8; img.data[i + 1] = val * 0.85; img.data[i + 2] = val * 1.1; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * W, y = rnd() * H;
    const m = rnd();
    const r = m > 0.985 ? 2.2 : m > 0.9 ? 1.3 : 0.7;
    const b = m > 0.985 ? 255 : 120 + rnd() * 120;
    const tint = rnd();
    ctx.fillStyle = tint > 0.8 ? `rgb(${b},${b * 0.85},${b * 0.7})` : tint > 0.6 ? `rgb(${b * 0.8},${b * 0.88},${b})` : `rgb(${b},${b},${b})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

export function fogNoiseTexture() {
  const S = 256;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = sx.fbm(x / 40, y / 40, 4) * 0.5 + 0.5;
    const i = (y * S + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = n * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return makeTex(c);
}
