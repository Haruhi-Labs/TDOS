const DIRECT_RADIUS_LIMIT = 0.25;
const SCALE_TO_RADIUS = 0.09;
const MIN_RADIUS = 0.006;
const MAX_RADIUS = 0.16;

export function resolvePointerSplatRadius(value, fallback = 0.07) {
  const numeric = Number(value);
  const radius = Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
  const resolved = radius <= DIRECT_RADIUS_LIMIT ? radius : radius * SCALE_TO_RADIUS;
  return clampPointerSplatRadius(resolved, fallback);
}

export function clampPointerSplatRadius(value, fallback = 0.07) {
  const numeric = Number(value);
  const radius = Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
  return Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, radius));
}
