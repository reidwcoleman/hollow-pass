import * as THREE from 'three';
import { snowflakeSprite } from './textures.js';

/** Simple CPU particle pool rendered as additive soft points: snow spray from the wheels, exhaust vapour. */
export class Puffs {
  constructor(scene, count, { color = 0xdde6f2, size = 1.0, additive = true } = {}) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.sizeA = new Float32Array(count);
    this.head = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizeA, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uSprite: { value: snowflakeSprite() }, uColor: { value: new THREE.Color(color) }, uPR: { value: Math.min(window.devicePixelRatio, 2) }, uSize: { value: size } },
      vertexShader: `attribute float aLife; attribute float aSize; uniform float uPR; uniform float uSize; varying float vA; varying float vNear;
        void main(){ vA = aLife; vec4 mv = modelViewMatrix * vec4(position,1.0); float d = max(-mv.z, 1.0); gl_PointSize = min(aSize * uSize * uPR * 140.0 / d, 42.0 * uPR); vNear = smoothstep(1.5, 6.0, d); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uSprite; uniform vec3 uColor; varying float vA; varying float vNear;
        void main(){ vec4 s = texture2D(uSprite, gl_PointCoord); float a = s.a * vA * (1.0 - vA) * 4.0 * 0.55 * vNear; gl_FragColor = vec4(uColor * a, a); }`,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, size) {
    const i = this.head; this.head = (this.head + 1) % this.count;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = 0.001; this.maxLife[i] = life; this.sizeA[i] = size;
  }
  update(dt, drag = 2.0, gravity = -2.0, wind = null) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] += dt / this.maxLife[i];
      if (this.life[i] >= 1) { this.life[i] = 0; this.pos[i * 3 + 1] = -9999; continue; }
      const k = Math.exp(-dt * drag);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k + gravity * dt; this.vel[i * 3 + 2] *= k;
      if (wind) { this.vel[i * 3] += wind.x * dt; this.vel[i * 3 + 2] += wind.z * dt; }
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.sizeA[i] += dt * 0.6;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aLife.needsUpdate = true;
    this.points.geometry.attributes.aSize.needsUpdate = true;
  }
}
