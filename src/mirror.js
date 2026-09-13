import * as THREE from 'three';

/**
 * Rear-view mirror: the scene rendered from a camera on the car looking back,
 * into a small render target, then blitted (horizontally flipped like a real
 * mirror) into a viewport at the top of the screen. Shadow maps are shared
 * with the main pass. Objects on layer 3 exist only in the mirror.
 */
export class Mirror {
  constructor(renderer, scene) {
    this.renderer = renderer; this.scene = scene;
    this.cam = new THREE.PerspectiveCamera(48, 3.0, 0.4, 500);
    this.cam.layers.enable(3);
    this.cam.layers.disable(2);
    this.rt = new THREE.WebGLRenderTarget(384, 128, { type: THREE.HalfFloatType, depthBuffer: true });
    const geo = new THREE.PlaneGeometry(2, 2);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); // mirror flip
    this.quadMat = new THREE.MeshBasicMaterial({ map: this.rt.texture, toneMapped: true });
    this.quad = new THREE.Mesh(geo, this.quadMat);
    this.qScene = new THREE.Scene(); this.qScene.add(this.quad);
    this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.enabled = true; this.frame = 0; this.interval = 2;
    this.dim = 1.0;
  }
  /** Place the camera at the interior mirror position, looking back. */
  update(carMatrix) {
    this.cam.position.set(0, 1.75, -2.75).applyMatrix4(carMatrix);
    const back = new THREE.Vector3(0, 1.45, -40).applyMatrix4(carMatrix);
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(back);
  }
  render(camera, fog, W, H) {
    if (!this.enabled) return;
    const r = this.renderer;
    this.frame++;
    if (this.frame % this.interval === 0) {
      // render the rear view into the target (reusing this frame's shadow maps)
      const prevAuto = r.shadowMap.autoUpdate; r.shadowMap.autoUpdate = false;
      const prevRT = r.getRenderTarget();
      const prevExposure = r.toneMappingExposure;
      camera.layers.disable(3);
      r.setRenderTarget(this.rt);
      r.setClearColor(fog ? fog.color : 0x000000, 1);
      r.clear(true, true, false);
      r.render(this.scene, this.cam);
      r.setRenderTarget(prevRT);
      r.shadowMap.autoUpdate = prevAuto;
      r.toneMappingExposure = prevExposure;
    }
    // blit into the mirror viewport
    const mw = Math.round(Math.min(W * 0.24, 420)), mh = Math.round(mw / 3);
    const x = Math.round((W - mw) / 2), y = H - mh - Math.round(H * 0.055);
    // setViewport/setScissor take CSS pixels (three multiplies by the pixel ratio itself)
    r.setScissorTest(true);
    r.setViewport(x, y, mw, mh);
    r.setScissor(x, y, mw, mh);
    const prevAutoClear = r.autoClear; r.autoClear = false;
    this.quadMat.color.setScalar(this.dim);
    r.render(this.qScene, this.qCam);
    r.autoClear = prevAutoClear;
    r.setScissorTest(false);
    r.setViewport(0, 0, W, H);
    r.setScissor(0, 0, W, H);
    this.rect = { x, y, w: mw, h: mh };
  }
}
