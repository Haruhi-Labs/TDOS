export const DEFAULT_FLUID_REVEAL_OPTIONS = {
  simulationResolution: 192,
  particleCount: 180,
  pointerRadius: 0.075,
  splatForce: 1.25,
  velocityDissipation: 0.982,
  densityDissipation: 0.938,
  curlStrength: 0.34,
  distortionStrength: 0.045,
  revealStrength: 0.92,
  backgroundDarkness: 0.64,
  particleOpacity: 0.58,
  pressureIterations: 8,
  dprCap: 1.6,
};

export const FLUID_REVEAL_PARAMS = [
  { key: "simulationResolution", label: "simulationResolution", min: 96, max: 320, step: 16 },
  { key: "particleCount", label: "particleCount", min: 40, max: 360, step: 10 },
  { key: "pointerRadius", label: "pointerRadius", min: 0.025, max: 0.16, step: 0.005 },
  { key: "splatForce", label: "splatForce", min: 0.2, max: 3.2, step: 0.05 },
  { key: "velocityDissipation", label: "velocityDissipation", min: 0.9, max: 0.998, step: 0.001 },
  { key: "densityDissipation", label: "densityDissipation", min: 0.84, max: 0.985, step: 0.001 },
  { key: "curlStrength", label: "curlStrength", min: 0, max: 1.4, step: 0.02 },
  { key: "distortionStrength", label: "distortionStrength", min: 0, max: 0.13, step: 0.002 },
  { key: "revealStrength", label: "revealStrength", min: 0, max: 1.6, step: 0.02 },
  { key: "backgroundDarkness", label: "backgroundDarkness", min: 0.25, max: 0.9, step: 0.01 },
  { key: "particleOpacity", label: "particleOpacity", min: 0, max: 1, step: 0.01 },
];

export function supportsReducedMotion() {
  return Boolean(
    window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
}

export function mobileFluidOverrides() {
  const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const narrow = window.innerWidth < 760;
  return coarse || narrow
    ? {
        simulationResolution: 128,
        particleCount: 95,
        dprCap: 1.15,
        pressureIterations: 4,
      }
    : {};
}

export function resolveFluidOptions(options = {}) {
  return {
    ...DEFAULT_FLUID_REVEAL_OPTIONS,
    ...mobileFluidOverrides(),
    ...options,
  };
}
