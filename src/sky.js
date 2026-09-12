import * as THREE from 'three';

/**
 * Night sky dome: horizon glow, star field, moon with halo, animated aurora
 * curtains and a slow-moving veil of high cloud. Rendered inside-out at the
 * far plane so it also feeds the PMREM environment map for car reflections.
 */
export const MOON_DIR = new THREE.Vector3(-0.45, 0.42, -0.79).normalize();

export function buildSky(starTex) {
  const uniforms = {
    uTime: { value: 0 },
    uStars: { value: starTex },
    uMoonDir: { value: MOON_DIR.clone() },
    uAurora: { value: 0.0 },
    uHorizon: { value: new THREE.Color(0x0d1626) },
    uZenith: { value: new THREE.Color(0x02040a) },
    uMoonCol: { value: new THREE.Color(0xdde6ff) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_Position.z = gl_Position.w; // far plane
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform sampler2D uStars;
      uniform vec3 uMoonDir;
      uniform float uAurora;
      uniform vec3 uHorizon, uZenith, uMoonCol;
      varying vec3 vDir;
      #define PI 3.14159265
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
      }
      float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*noise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5;} return s; }
      void main() {
        vec3 d = normalize(vDir);
        float up = d.y;
        // base gradient: cold blue-grey horizon haze -> near black zenith
        float h = clamp(up, -0.2, 1.0);
        vec3 col = mix(uHorizon, uZenith, smoothstep(-0.05, 0.55, h));
        col += uHorizon * 0.6 * exp(-abs(up) * 14.0); // haze band
        // stars (equirect lookup), dimmed by haze near horizon
        float u = atan(d.z, d.x) / (2.0*PI) + 0.5;
        float v = 0.5 - asin(clamp(d.y,-1.0,1.0)) / PI;
        vec3 stars = texture2D(uStars, vec2(u, v)).rgb;
        float twinkle = 0.85 + 0.15 * sin(uTime * 2.0 + hash(floor(vec2(u,v)*900.0)) * 40.0);
        col += stars * smoothstep(0.0, 0.25, up) * twinkle * 1.6;
        // moon
        float m = dot(d, uMoonDir);
        float disc = smoothstep(0.9993, 0.9996, m);
        float halo = pow(max(m, 0.0), 180.0) * 0.5 + pow(max(m, 0.0), 24.0) * 0.12 + pow(max(m,0.0), 6.0) * 0.05;
        // craters
        vec3 t = normalize(cross(uMoonDir, vec3(0,1,0)));
        vec3 b = cross(uMoonDir, t);
        vec2 mp = vec2(dot(d, t), dot(d, b)) * 1400.0;
        float crater = fbm(mp * 0.9 + 3.0) * 0.5 + 0.5;
        col += uMoonCol * disc * (0.9 + crater * 1.2) * 4.0;
        col += uMoonCol * halo * 1.4;
        // aurora curtains to the north, animated
        if (uAurora > 0.001 && up > 0.02) {
          vec2 ap = vec2(atan(d.x, d.z) * 3.0, up * 6.0);
          float curtain = fbm(vec2(ap.x * 1.5 + uTime * 0.05, uTime * 0.03));
          float ribbon = smoothstep(0.35, 0.9, curtain) * smoothstep(0.04, 0.25, up) * smoothstep(0.85, 0.35, up);
          float rays = fbm(vec2(ap.x * 12.0 + uTime * 0.2, ap.y * 0.5 - uTime * 0.08));
          float north = smoothstep(-0.2, 0.8, -d.z * 0.7 - d.x * 0.5);
          vec3 acol = mix(vec3(0.05, 0.9, 0.45), vec3(0.45, 0.15, 0.8), smoothstep(0.2, 0.7, up));
          col += acol * ribbon * (0.35 + rays * 0.9) * north * uAurora * 0.9;
        }
        // high veil cloud, drifts slowly, lit faintly by the moon
        if (up > 0.0) {
          vec2 cp = d.xz / (up + 0.15);
          float veil = fbm(cp * 1.8 + vec2(uTime * 0.004, uTime * 0.002));
          veil = smoothstep(0.45, 0.8, veil) * smoothstep(0.0, 0.2, up);
          col = mix(col, uHorizon * 1.6 + uMoonCol * 0.15 * pow(max(m,0.0), 3.0), veil * 0.55);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 32), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return { mesh, uniforms };
}
