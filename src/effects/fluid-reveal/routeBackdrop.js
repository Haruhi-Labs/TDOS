const ASSET_BASE = `${import.meta.env.BASE_URL}assets/fluid-reveal/`;

export const ROUTE_FLUID_MAIN_IMAGE_URL = `${ASSET_BASE}A1.jpeg`;
export const ROUTE_FLUID_REVEAL_IMAGE_URL = `${ASSET_BASE}B.png`;

export const ROUTE_FLUID_BACKDROP_OPTIONS = {
  maxFps: 24,
  simulationResolution: 112,
  particleCount: 72,
  cursorRing: true,
  pointerRadius: 0.91,
  splatForce: 0.91,
  clickRadiusMultiplier: 1.08,
  clickSplatForce: 2.05,
  velocityDissipation: 0.986,
  densityDissipation: 0.95,
  curlStrength: 0.34,
  distortionStrength: 0.032,
  revealStrength: 0.88,
  backgroundDarkness: 0.58,
  particleOpacity: 0.46,
  pressureIterations: 3,
  dprCap: 1,
};

export function mountRouteFluidBackdrop(target, options = {}) {
  let effect = null;
  let destroyed = false;
  let enabled = options.enabled !== false;
  const activeClass = options.activeClass || "route-fluid-active";
  const noRingClass = "route-fluid-no-ring";

  const controller = {
    setEnabled(nextEnabled) {
      enabled = Boolean(nextEnabled);
      effect?.setEnabled(enabled);
    },
    destroy() {
      destroyed = true;
      effect?.destroy();
      effect = null;
      target?.classList.remove("route-fluid-backdrop", activeClass, noRingClass, "route-fluid-failed");
    },
  };

  if (!target) {
    return controller;
  }

  target.classList.add("route-fluid-backdrop");
  if (options.cursorRing === false) {
    target.classList.add(noRingClass);
  }

  const fluidOptions = {
    ...ROUTE_FLUID_BACKDROP_OPTIONS,
    ...(options.fluidOptions || {}),
    cursorRing: options.cursorRing !== false,
    canvasZIndex: options.canvasZIndex ?? 1,
    enabled,
  };

  import("./FluidRevealBackground.js")
    .then(({ createFluidRevealBackground }) => {
      if (destroyed) return;
      effect = createFluidRevealBackground(fluidOptions);
      target.classList.add(activeClass);
      effect.mount(target);
      effect.setTextures(
        options.mainTexture || ROUTE_FLUID_MAIN_IMAGE_URL,
        options.revealTexture || ROUTE_FLUID_REVEAL_IMAGE_URL,
      );
      if (!enabled) effect.setEnabled(false);
      options.onReady?.(effect);
    })
    .catch((error) => {
      if (destroyed) return;
      target.classList.remove(activeClass);
      target.classList.add("route-fluid-failed");
      if (typeof options.onError === "function") {
        options.onError(error);
      } else {
        console.warn(`${options.logLabel || "Route fluid backdrop"} unavailable; using fallback.`, error);
      }
    });

  return controller;
}
