import * as THREE from 'three';
import {
  Effect,
  BloomEffect, BlendFunction, ChromaticAberrationEffect, EffectComposer, EffectPass, NoiseEffect,
  RenderPass, SMAAEffect, VignetteEffect, DepthOfFieldEffect, BrightnessContrastEffect, HueSaturationEffect,
} from 'postprocessing';

/** Cold film grade: blue lifted shadows, warm highlights, gentle S-curve, slight desaturation in the dark. */
class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', `
      uniform float uAmount;
      vec3 sCurve(vec3 c) { return c * c * (3.0 - 2.0 * c); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        vec3 shadowTint = vec3(0.86, 0.93, 1.12);
        vec3 highTint = vec3(1.06, 1.0, 0.93);
        vec3 tint = mix(shadowTint, highTint, smoothstep(0.15, 0.75, l));
        c *= tint;
        c = mix(c, sCurve(clamp(c, 0.0, 1.0)), 0.35);
        c = mix(vec3(l), c, mix(0.8, 1.05, smoothstep(0.05, 0.5, l)));
        c += vec3(0.010, 0.014, 0.024); // lifted blacks, cold
        outputColor = vec4(mix(inputColor.rgb, c, uAmount), inputColor.a);
      }`, { uniforms: new Map([['uAmount', new THREE.Uniform(1.0)]]) });
  }
}

/** Renderer + cinematic post chain: HDR bloom, subtle DoF, grain, vignette, cold grade, SMAA. */
export class PostFX {
  constructor(canvas, scene, camera) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.15;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setClearColor(0x000000, 1);
    r.info.autoReset = false;

    this.composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.72, luminanceSmoothing: 0.25, intensity: 1.35, radius: 0.85 });
    this.vignette = new VignetteEffect({ darkness: 0.55, offset: 0.25 });
    this.noise = new NoiseEffect({ blendFunction: BlendFunction.SOFT_LIGHT, premultiply: false });
    this.noise.blendMode.opacity.value = 0.11;
    this.grade = new HueSaturationEffect({ saturation: -0.08, hue: 0 });
    this.contrast = new BrightnessContrastEffect({ brightness: -0.02, contrast: 0.08 });
    this.ca = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0009, 0.0006), radialModulation: true, modulationOffset: 0.4 });
    this.filmGrade = new GradeEffect();
    this.composer.addPass(new EffectPass(camera, this.bloom, this.filmGrade, this.grade, this.contrast, this.vignette, this.noise, this.ca));
    this.composer.addPass(new EffectPass(camera, new SMAAEffect()));
    this.camera = camera;
    this.scale = 1;
    this.resize();
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * this.scale);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  /** Momentary lens/sensor glitch: chromatic aberration and grain spike, decays over ~0.5 s. */
  setGlitch(strength) { this.glitch = Math.max(this.glitch || 0, strength); }
  tick(dt) {
    this.glitch = (this.glitch || 0) * Math.exp(-dt * 5);
    const g = this.glitch;
    this.ca.offset.set(0.0009 + g * 0.012, 0.0006 + g * 0.008);
    this.noise.blendMode.opacity.value = 0.11 + g * 0.6;
  }
  setScale(s) { this.scale = THREE.MathUtils.clamp(s, 0.5, 1); this.resize(); }
  render(dt) { this.tick(dt); this.renderer.info.reset(); this.composer.render(dt); }
}
