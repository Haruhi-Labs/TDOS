import * as THREE from "three";

import { FluidSimulation } from "./FluidSimulation.js";
import { PointerTracker } from "./PointerTracker.js";
import { resolveFluidOptions, supportsReducedMotion } from "./presets.js";

const STATIC_IMAGE_PATTERN = /\.(?:avif|jpe?g|png|webp)(?:[?#].*)?$/i;

function textureAspectFromImage(image) {
  const width = image.videoWidth || image.naturalWidth || image.width || 16;
  const height = image.videoHeight || image.naturalHeight || image.height || 9;
  return width / Math.max(1, height);
}

function isStaticImageUrl(url) {
  return STATIC_IMAGE_PATTERN.test(url);
}

function prepareTexture(texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function createVideoTexture(url) {
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.autoplay = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  const texture = new THREE.VideoTexture(video);
  prepareTexture(texture);
  return { kind: "video", video, texture };
}

export function createFluidRevealBackground(options = {}) {
  let canvas = null;
  let container = null;
  let simulation = null;
  let pointer = null;
  let resizeObserver = null;
  let raf = 0;
  let lastTime = 0;
  let mounted = false;
  let enabled = options.enabled !== false;
  let hidden = false;
  let disposed = false;
  let reducedMotion = false;
  let config = resolveFluidOptions(options);
  let mainMedia = null;
  let revealTexture = null;
  let cursorRing = null;
  let cursorRingPulseTimer = 0;
  const cleanups = [];

  function resize() {
    if (!container || !simulation) return;
    const rect = container.getBoundingClientRect();
    simulation.resize(rect.width || window.innerWidth, rect.height || window.innerHeight);
  }

  function updateEnabledState() {
    const active = enabled && !reducedMotion;
    if (canvas) {
      canvas.style.opacity = active ? "1" : "0.35";
    }
    if (simulation) {
      simulation.setEnabled(active);
    }
  }

  function tick(now) {
    if (!mounted || hidden) return;
    const maxFps = Number(config.maxFps || 0);
    const frameInterval = maxFps > 0 ? 1000 / Math.max(1, maxFps) : 0;
    if (frameInterval && lastTime && now - lastTime < frameInterval) {
      raf = requestAnimationFrame(tick);
      return;
    }
    const dt = lastTime ? (now - lastTime) / 1000 : 0.016;
    lastTime = now;
    const splats = pointer ? pointer.consumeSplats() : [];
    simulation?.update(dt, splats);
    raf = requestAnimationFrame(tick);
  }

  function start() {
    if (!mounted || raf || hidden) return;
    lastTime = 0;
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  function mount(target) {
    if (mounted) return;
    disposed = false;
    container = target;
    canvas = document.createElement("canvas");
    canvas.className = "fluid-reveal-canvas";
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = String(config.canvasZIndex ?? 1);
    canvas.setAttribute("aria-hidden", "true");
    container.prepend(canvas);

    reducedMotion = supportsReducedMotion();
    simulation = new FluidSimulation(canvas, config);
    pointer = new PointerTracker(container, {
      getOptions: () => config,
    });
    mountCursorRing();

    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", handleVisibility);
    cleanups.push(() => window.removeEventListener("resize", resize));
    cleanups.push(() => document.removeEventListener("visibilitychange", handleVisibility));

    mounted = true;
    resize();
    updateEnabledState();
    start();
  }

  function mountCursorRing() {
    if (!config.cursorRing || !container) return;

    const coarsePointer =
      window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (coarsePointer) return;

    cursorRing = document.createElement("div");
    cursorRing.className = "fluid-pointer-ring";
    cursorRing.setAttribute("aria-hidden", "true");
    container.append(cursorRing);

    const cursorAc = new AbortController();
    const signal = cursorAc.signal;

    function move(event) {
      if (!cursorRing || !container) return;
      const rect = container.getBoundingClientRect();
      cursorRing.style.left = `${event.clientX - rect.left}px`;
      cursorRing.style.top = `${event.clientY - rect.top}px`;
      cursorRing.classList.add("is-visible");
    }

    function hide() {
      cursorRing?.classList.remove("is-visible", "is-pulsing");
    }

    function pulse(event) {
      move(event);
      if (!cursorRing) return;
      window.clearTimeout(cursorRingPulseTimer);
      cursorRing.classList.remove("is-pulsing");
      void cursorRing.offsetWidth;
      cursorRing.classList.add("is-pulsing");
      cursorRingPulseTimer = window.setTimeout(() => {
        cursorRing?.classList.remove("is-pulsing");
      }, 800);
    }

    container.addEventListener("pointerenter", move, { signal });
    container.addEventListener("pointermove", move, { signal });
    container.addEventListener("pointerdown", pulse, { signal });
    container.addEventListener("pointerleave", hide, { signal });
    container.addEventListener("pointercancel", hide, { signal });
    cleanups.push(() => {
      cursorAc.abort();
      window.clearTimeout(cursorRingPulseTimer);
      cursorRing?.remove();
      cursorRing = null;
    });
  }

  function handleVisibility() {
    hidden = document.hidden;
    if (hidden) {
      stop();
    } else {
      start();
    }
  }

  function setOptions(nextOptions = {}) {
    config = resolveFluidOptions({ ...config, ...nextOptions });
    simulation?.setOptions(config);
    resize();
    updateEnabledState();
  }

  function disposeMainMedia() {
    if (!mainMedia) return;
    if (mainMedia.video) {
      mainMedia.video.pause();
      mainMedia.video.removeAttribute("src");
      mainMedia.video.load();
    }
    mainMedia.texture?.dispose();
    mainMedia = null;
  }

  function setTextures(mainTexture, revealSource) {
    if (typeof mainTexture === "string") {
      disposeMainMedia();
      if (isStaticImageUrl(mainTexture)) {
        const media = { kind: "image", texture: null };
        mainMedia = media;
        const loader = new THREE.TextureLoader();
        loader.load(mainTexture, (texture) => {
          if (disposed || mainMedia !== media) {
            texture.dispose();
            return;
          }
          media.texture = prepareTexture(texture);
          simulation?.setTextures(media.texture, null, {
            mainAspect: textureAspectFromImage(texture.image),
          });
        });
      } else {
        const media = createVideoTexture(mainTexture);
        mainMedia = media;
        const playPromise = media.video.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch(() => {});
        }
        media.video.addEventListener(
          "loadedmetadata",
          () => {
            if (disposed || mainMedia !== media) return;
            simulation?.setTextures(media.texture, null, {
              mainAspect: textureAspectFromImage(media.video),
            });
          },
          { once: true },
        );
        simulation?.setTextures(media.texture, null);
      }
    } else if (mainTexture instanceof THREE.Texture) {
      disposeMainMedia();
      simulation?.setTextures(mainTexture, null);
    }

    if (typeof revealSource === "string") {
      const loader = new THREE.TextureLoader();
      loader.load(revealSource, (texture) => {
        if (disposed) {
          texture.dispose();
          return;
        }
        if (revealTexture) revealTexture.dispose();
        revealTexture = texture;
        revealTexture.colorSpace = THREE.SRGBColorSpace;
        simulation?.setTextures(null, revealTexture, {
          revealAspect: textureAspectFromImage(texture.image),
        });
      });
    } else if (revealSource instanceof THREE.Texture) {
      if (revealTexture && revealTexture !== revealSource) revealTexture.dispose();
      revealTexture = revealSource;
      simulation?.setTextures(null, revealTexture);
    }
  }

  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    updateEnabledState();
  }

  function destroy() {
    disposed = true;
    mounted = false;
    stop();
    pointer?.destroy();
    pointer = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    for (const cleanup of cleanups.splice(0)) cleanup();
    disposeMainMedia();
    revealTexture?.dispose();
    revealTexture = null;
    simulation?.dispose();
    simulation = null;
    window.clearTimeout(cursorRingPulseTimer);
    cursorRing?.remove();
    cursorRing = null;
    canvas?.remove();
    canvas = null;
    container = null;
  }

  return {
    mount,
    setTextures,
    setEnabled,
    setOptions,
    resize,
    destroy,
  };
}
