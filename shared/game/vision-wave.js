import { clamp } from "./math.js";

const VISION_WAVE_SPEED = 480;
const COVERAGE_SECONDS = 0.24;
const MIN_WIDTH_RATIO = 0.11;
const MAX_WIDTH_RATIO = 0.26;

function farthestMapCornerRadius(team, x, y) {
  const size = team.match.worldSize;
  return Math.max(
    Math.hypot(x, y),
    Math.hypot(size - x, y),
    Math.hypot(x, size - y),
    Math.hypot(size - x, size - y),
    1,
  );
}

function emitVisionWave(team, source) {
  const state = team.visionWaveSkill;
  const edgeRadius = farthestMapCornerRadius(team, source.x, source.y);
  // 使用全场统一的固定传播速度，避免舰队位置改变波纹节奏。
  const speed = VISION_WAVE_SPEED;
  // 波带宽度按传播速度缩放，确保30Hz权威判定和15Hz快照都不会漏过整圈视野。
  const width = clamp(
    speed * COVERAGE_SECONDS,
    team.match.worldSize * MIN_WIDTH_RATIO,
    team.match.worldSize * MAX_WIDTH_RATIO,
  );
  const emittedAt = team.match.elapsed;
  const maxRadius = edgeRadius + width * 0.5;
  state.sequence += 1;
  state.waves.push({
    id: state.sequence,
    sourceShipId: source.id,
    x: source.x,
    y: source.y,
    emittedAt,
    speed,
    width,
    edgeRadius,
    maxRadius,
    expiresAt: emittedAt + maxRadius / speed,
  });
}

export function createVisionWaveSkillState() {
  return {
    activeUntil: 0,
    nextPulseAt: 0,
    pulsesRemaining: 0,
    interval: 1,
    startedTick: -1,
    sequence: 0,
    waves: [],
  };
}

export function activateVisionWaveSkill(team, options = {}) {
  const source = team.ships.main;
  if (!source?.alive) return false;

  const duration = Math.max(0.1, Number(options.duration) || 6);
  const interval = Math.max(0.1, Number(options.interval) || 1);
  const pulseCount = Math.max(1, Math.round(duration / interval));
  const state = team.visionWaveSkill;
  state.activeUntil = team.match.elapsed + duration;
  state.nextPulseAt = team.match.elapsed + interval;
  state.pulsesRemaining = pulseCount - 1;
  state.interval = interval;
  state.startedTick = team.match.tick;
  state.waves.length = 0;
  emitVisionWave(team, source);
  return true;
}

export function cancelVisionWaveSkill(team, { preserveCurrentTick = true } = {}) {
  const state = team.visionWaveSkill;
  if (!state) return false;
  if (preserveCurrentTick && state.startedTick === team.match.tick) return false;
  const cleared = state.activeUntil > team.match.elapsed || state.waves.length > 0;
  state.activeUntil = 0;
  state.nextPulseAt = 0;
  state.pulsesRemaining = 0;
  state.startedTick = -1;
  state.waves.length = 0;
  return cleared;
}

export function updateVisionWaveSkill(team) {
  const state = team.visionWaveSkill;
  if (!state) return;
  const now = team.match.elapsed;
  state.waves = state.waves.filter((wave) => wave.expiresAt > now);

  const source = team.ships.main;
  if (!source?.alive || now >= state.activeUntil || state.pulsesRemaining <= 0) {
    if (!source?.alive) {
      state.activeUntil = 0;
      state.pulsesRemaining = 0;
    }
    return;
  }

  while (
    state.pulsesRemaining > 0
    && state.nextPulseAt < state.activeUntil - 1e-9
    && now + 1e-9 >= state.nextPulseAt
  ) {
    emitVisionWave(team, source);
    state.pulsesRemaining -= 1;
    state.nextPulseAt += state.interval;
  }
}

export function visionWavesCoverEntity(team, entity) {
  const state = team.visionWaveSkill;
  if (!state || !entity) return false;
  const now = team.match.elapsed;
  const entityRadius = Math.max(0, Number(entity.radius) || 0);
  for (const wave of state.waves) {
    const age = now - wave.emittedAt;
    if (age < 0 || now >= wave.expiresAt) continue;
    const radius = age * wave.speed;
    const targetRadius = Math.hypot(entity.x - wave.x, entity.y - wave.y);
    if (Math.abs(targetRadius - radius) <= wave.width * 0.5 + entityRadius) {
      return true;
    }
  }
  return false;
}

export function serializeVisionWaves(team) {
  return team.visionWaveSkill.waves.map((wave) => ({
    id: wave.id,
    x: wave.x,
    y: wave.y,
    emittedAt: wave.emittedAt,
    speed: wave.speed,
    width: wave.width,
    expiresAt: wave.expiresAt,
  }));
}
