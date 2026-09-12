import * as THREE from 'three';
import {
  BloomEffect, BlendFunction, ChromaticAberrationEffect, EffectComposer, EffectPass, NoiseEffect,
  RenderPass, SMAAEffect, VignetteEffect, DepthOfFieldEffect, BrightnessContrastEffect, HueSaturationEffect,
} from 'postprocessing';

/** Renderer + cinematic post chain: HDR bloom, subtle DoF, grain, vignette, cold grade, SMAA. */
export class PostFX {
  constructor(canvas, scene, camera) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
    this.composer.addPass(new EffectPass(camera, this.bloom, this.grade, this.contrast, this.vignette, this.noise, this.ca));
    this.composer.addPass(new EffectPass(camera, new SMAAEffect()));
    this.camera = camera;
    this.scale = 1;
    this.resize();
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.scale);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  setScale(s) { this.scale = THREE.MathUtils.clamp(s, 0.5, 1); this.resize(); }
  render(dt) { this.renderer.info.reset(); this.composer.render(dt); }
}
