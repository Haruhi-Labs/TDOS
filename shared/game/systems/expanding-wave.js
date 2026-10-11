import { clamp } from "../math.js";

const WAVE_SPEED = 480;
const COVERAGE_SECONDS = 0.24;
const MIN_WIDTH_RATIO = 0.11;
const MAX_WIDTH_RATIO = 0.26;

function farthestMapCornerRadius(size, x, y) {
  return Math.max(
    Math.hypot(x, y),
    Math.hypot(size - x, y),
    Math.hypot(x, size - y),
    Math.hypot(size - x, size - y),
    1,
  );
}

export function createExpandingWave({ worldSize, now, source, id }) {
  const edgeRadius = farthestMapCornerRadius(worldSize, source.x, source.y);
  const speed = WAVE_SPEED;
  // 共用波带几何，确保30Hz权威判定和15Hz快照都能覆盖整圈传播。
  const width = clamp(
    speed * COVERAGE_SECONDS,
    worldSize * MIN_WIDTH_RATIO,
    worldSize * MAX_WIDTH_RATIO,
  );
  const emittedAt = now;
  const maxRadius = edgeRadius + width * 0.5;
  return {
    id,
    sourceShipId: source.id,
    x: source.x,
    y: source.y,
    emittedAt,
    speed,
    width,
    edgeRadius,
    maxRadius,
    expiresAt: emittedAt + maxRadius / speed,
  };
}

export function expandingWaveCoversEntity(wave, entity, now) {
  const age = now - wave.emittedAt;
  if (age < 0 || now >= wave.expiresAt) return false;
  const radius = age * wave.speed;
  const targetRadius = Math.hypot(entity.x - wave.x, entity.y - wave.y);
  const entityRadius = Math.max(0, Number(entity.radius) || 0);
  return Math.abs(targetRadius - radius) <= wave.width * 0.5 + entityRadius;
}

