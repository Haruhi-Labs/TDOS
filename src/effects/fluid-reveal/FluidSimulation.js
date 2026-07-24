import * as THREE from "three";

import { resolveFluidOptions } from "./presets.js";
import { clampPointerSplatRadius, resolvePointerSplatRadius } from "./pointerRadius.js";
import fullscreenVert from "./shaders/fullscreen.vert?raw";
import advectionFrag from "./shaders/advection.frag?raw";
import splatFrag from "./shaders/splat.frag?raw";
import divergenceFrag from "./shaders/divergence.frag?raw";
import pressureFrag from "./shaders/pressure.frag?raw";
import compositeFrag from "./shaders/composite.frag?raw";

function createFallbackTexture(color) {
  const data = new Uint8Array(color);
  const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

function createTarget(width, height) {
  return new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
}

function targetPair(width, height) {
  return {
    read: createTarget(width, height),
    write: createTarget(width, height),
  };
}

function disposePair(pair) {
  pair.read.dispose();
  pair.write.dispose();
}

function swap(pair) {
  const next = pair.read;
  pair.read = pair.write;
  pair.write = next;
}

export class FluidSimulation {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.options = resolveFluidOptions(options);
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.targetWidth = 1;
    this.targetHeight = 1;
    this.time = 0;
    this.enabled = true;

    this.mainTexture = createFallbackTexture([10, 16, 34, 255]);
    this.revealTexture = createFallbackTexture([42, 72, 132, 255]);
    this.ownsFallbackTextures = true;
    this.mainAspect = 16 / 9;
    this.revealAspect = 16 / 9;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: false,
      antialias: false,
      powerPreference: "high-performance",
    });
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x02060e, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(this.geometry);
    this.scene.add(this.quad);

    this.texelSize = new THREE.Vector2(1, 1);
    this.resolution = new THREE.Vector2(1, 1);
    this.createMaterials();
    this.createTargets();
  }

  createMaterials() {
    this.advectionMaterial = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: advectionFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tInput: { value: null },
        tVelocity: { value: null },
        texelSize: { value: this.texelSize },
        dt: { value: 0.016 },
        dissipation: { value: 0.98 },
        mode: { value: 0 },
      },
    });

    this.splatMaterial = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: splatFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tInput: { value: null },
        point: { value: new THREE.Vector2() },
        delta: { value: new THREE.Vector2() },
        radius: { value: 0.08 },
        force: { value: 1 },
        aspect: { value: 1 },
        curlStrength: { value: 0.3 },
        time: { value: 0 },
        mode: { value: 0 },
      },
    });

    this.divergenceMaterial = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: divergenceFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tVelocity: { value: null },
        texelSize: { value: this.texelSize },
      },
    });

    this.pressureMaterial = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: pressureFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tPressure: { value: null },
        tDivergence: { value: null },
        texelSize: { value: this.texelSize },
      },
    });

    this.compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: compositeFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tMain: { value: this.mainTexture },
        tReveal: { value: this.revealTexture },
        tVelocity: { value: null },
        tDensity: { value: null },
        tMask: { value: null },
        tPressure: { value: null },
        resolution: { value: this.resolution },
        time: { value: 0 },
        mainAspect: { value: this.mainAspect },
        revealAspect: { value: this.revealAspect },
        distortionStrength: { value: this.options.distortionStrength },
        revealStrength: { value: this.options.revealStrength },
        backgroundDarkness: { value: this.options.backgroundDarkness },
        particleOpacity: { value: this.options.particleOpacity },
        particleCount: { value: this.options.particleCount },
        enabled: { value: 1 },
      },
    });
  }

  createTargets() {
    const size = this.computeTargetSize();
    this.targetWidth = size.width;
    this.targetHeight = size.height;
    this.texelSize.set(1 / this.targetWidth, 1 / this.targetHeight);

    this.velocity = targetPair(this.targetWidth, this.targetHeight);
    this.density = targetPair(this.targetWidth, this.targetHeight);
    this.mask = targetPair(this.targetWidth, this.targetHeight);
    this.pressure = targetPair(this.targetWidth, this.targetHeight);
    this.divergence = createTarget(this.targetWidth, this.targetHeight);
    this.clearTargets();
  }

  computeTargetSize() {
    const base = Math.max(64, Math.round(this.options.simulationResolution || 192));
    const aspect = this.width > 1 && this.height > 1 ? this.width / this.height : 16 / 9;
    return {
      width: Math.max(64, Math.round(base * Math.min(1.8, Math.max(0.72, aspect)))),
      height: base,
    };
  }

  clearTarget(target, color) {
    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(new THREE.Color(color[0], color[1], color[2]), color[3]);
    this.renderer.clear(true, false, false);
    this.renderer.setRenderTarget(prevTarget);
  }

  clearTargets() {
    for (const target of [this.velocity.read, this.velocity.write]) {
      this.clearTarget(target, [0.5, 0.5, 0.5, 1]);
    }
    for (const pair of [this.density, this.mask]) {
      this.clearTarget(pair.read, [0, 0, 0, 1]);
      this.clearTarget(pair.write, [0, 0, 0, 1]);
    }
    for (const target of [this.pressure.read, this.pressure.write, this.divergence]) {
      this.clearTarget(target, [0.5, 0.5, 0.5, 1]);
    }
    this.renderer.setClearColor(0x02060e, 1);
  }

  resize(width, height, dpr = window.devicePixelRatio || 1) {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.dpr = Math.min(Number(this.options.dprCap || 1.5), Math.max(1, dpr));
    this.resolution.set(this.width * this.dpr, this.height * this.dpr);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.width, this.height, false);

    const size = this.computeTargetSize();
    if (size.width !== this.targetWidth || size.height !== this.targetHeight) {
      disposePair(this.velocity);
      disposePair(this.density);
      disposePair(this.mask);
      disposePair(this.pressure);
      this.divergence.dispose();
      this.createTargets();
    }
  }

  setOptions(options = {}) {
    const previousResolution = this.options.simulationResolution;
    this.options = resolveFluidOptions({ ...this.options, ...options });
    if (previousResolution !== this.options.simulationResolution) {
      this.resize(this.width, this.height, this.dpr);
    }
  }

  setTextures(mainTexture, revealTexture, aspects = {}) {
    if (mainTexture) this.mainTexture = mainTexture;
    if (revealTexture) this.revealTexture = revealTexture;
    this.mainAspect = aspects.mainAspect || this.mainAspect;
    this.revealAspect = aspects.revealAspect || this.revealAspect;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  renderPass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  advect(pair, mode, dissipation) {
    const uniforms = this.advectionMaterial.uniforms;
    uniforms.tInput.value = pair.read.texture;
    uniforms.tVelocity.value = this.velocity.read.texture;
    uniforms.dt.value = Math.min(0.033, this.frameDt || 0.016);
    uniforms.dissipation.value = dissipation;
    uniforms.mode.value = mode;
    this.renderPass(this.advectionMaterial, pair.write);
    swap(pair);
  }

  splat(pair, mode, splat) {
    const speed = Math.min(2.8, Math.max(0, splat.speed || 0));
    const len = Math.hypot(splat.dx || 0, splat.dy || 0) || 1;
    const uniforms = this.splatMaterial.uniforms;
    uniforms.tInput.value = pair.read.texture;
    uniforms.point.value.set(splat.x, splat.y);
    uniforms.delta.value.set((splat.dx || 0) / len, (splat.dy || 0) / len);
    const rawRadius =
      splat.radius || resolvePointerSplatRadius(this.options.pointerRadius);
    uniforms.radius.value = clampPointerSplatRadius(rawRadius);
    uniforms.force.value = Math.max(0.05, (splat.force || 1) * (0.75 + speed * 0.14));
    uniforms.aspect.value = this.width / Math.max(1, this.height);
    uniforms.curlStrength.value = this.options.curlStrength;
    uniforms.time.value = this.time;
    uniforms.mode.value = mode;
    this.renderPass(this.splatMaterial, pair.write);
    swap(pair);
  }

  solvePressure() {
    this.divergenceMaterial.uniforms.tVelocity.value = this.velocity.read.texture;
    this.renderPass(this.divergenceMaterial, this.divergence);

    const iterations = Math.max(1, Math.round(this.options.pressureIterations || 6));
    for (let i = 0; i < iterations; i += 1) {
      this.pressureMaterial.uniforms.tPressure.value = this.pressure.read.texture;
      this.pressureMaterial.uniforms.tDivergence.value = this.divergence.texture;
      this.renderPass(this.pressureMaterial, this.pressure.write);
      swap(this.pressure);
    }
  }

  update(dt, splats = []) {
    this.frameDt = Math.min(0.04, Math.max(0.001, dt || 0.016));
    this.time += this.frameDt;

    if (this.enabled) {
      this.advect(this.velocity, 0, this.options.velocityDissipation);
      this.advect(this.density, 1, this.options.densityDissipation);
      this.advect(this.mask, 2, this.options.densityDissipation);

      for (const splat of splats) {
        this.splat(this.velocity, 0, splat);
        this.splat(this.density, 1, splat);
        this.splat(this.mask, 2, splat);
      }

      this.solvePressure();
    }

    this.renderComposite();
  }

  renderComposite() {
    const uniforms = this.compositeMaterial.uniforms;
    uniforms.tMain.value = this.mainTexture;
    uniforms.tReveal.value = this.revealTexture;
    uniforms.tVelocity.value = this.velocity.read.texture;
    uniforms.tDensity.value = this.density.read.texture;
    uniforms.tMask.value = this.mask.read.texture;
    uniforms.tPressure.value = this.pressure.read.texture;
    uniforms.time.value = this.time;
    uniforms.mainAspect.value = this.mainAspect;
    uniforms.revealAspect.value = this.revealAspect;
    uniforms.distortionStrength.value = this.options.distortionStrength;
    uniforms.revealStrength.value = this.options.revealStrength;
    uniforms.backgroundDarkness.value = this.options.backgroundDarkness;
    uniforms.particleOpacity.value = this.options.particleOpacity;
    uniforms.particleCount.value = this.options.particleCount;
    uniforms.enabled.value = this.enabled ? 1 : 0;
    this.renderPass(this.compositeMaterial, null);
  }

  dispose() {
    disposePair(this.velocity);
    disposePair(this.density);
    disposePair(this.mask);
    disposePair(this.pressure);
    this.divergence.dispose();
    for (const material of [
      this.advectionMaterial,
      this.splatMaterial,
      this.divergenceMaterial,
      this.pressureMaterial,
      this.compositeMaterial,
    ]) {
      material.dispose();
    }
    this.geometry.dispose();
    this.renderer.dispose();
    if (this.ownsFallbackTextures) {
      this.mainTexture.dispose();
      this.revealTexture.dispose();
    }
  }
}
