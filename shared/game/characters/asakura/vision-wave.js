import { copyPlainData, freezePlainData } from "../../../data/plain-data.js";
const states = new WeakMap();
const views = new WeakMap();
import { createExpandingWave as createWave, expandingWaveCoversEntity } from "../../systems/expanding-wave.js";

// 保留技能模块原有入口；通用几何只消费显式的时间、地图和来源数据。
export function createExpandingWave(team, source, id) {
  return createWave({ worldSize: team.match.worldSize, now: team.match.elapsed, source, id });
}

export { expandingWaveCoversEntity } from "../../systems/expanding-wave.js";

function emitVisionWave(team, source) {
  views.delete(team);
  const state = states.get(team);
  state.sequence += 1;
  state.waves.push(createExpandingWave(team, source, state.sequence));
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
  views.delete(team);
  const source = team.ships.main;
  if (!source?.alive) return false;

  const duration = Math.max(0.1, Number(options.duration) || 6);
  const interval = Math.max(0.1, Number(options.interval) || 1);
  const pulseCount = Math.max(1, Math.round(duration / interval));
  const state = states.get(team);
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
  views.delete(team);
  const state = states.get(team);
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
  views.delete(team);
  const state = states.get(team);
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
  const state = states.get(team);
  if (!state || !entity) return false;
  const now = team.match.elapsed;
  for (const wave of state.waves) {
    if (expandingWaveCoversEntity(wave, entity, now)) return true;
  }
  return false;
}

export function serializeVisionWaves(team) {
  return states.get(team).waves.map((wave) => ({
    id: wave.id,
    x: wave.x,
    y: wave.y,
    emittedAt: wave.emittedAt,
    speed: wave.speed,
    width: wave.width,
    expiresAt: wave.expiresAt,
  }));
}

export function initializeVisionWaves(team) {
  if (states.has(team)) return;
  states.set(team, createVisionWaveSkillState());
  Object.defineProperty(team, "visionWaveSkill", { enumerable: true,
    get: () => {
      if (!views.has(team)) views.set(team, freezePlainData(copyPlainData(states.get(team))));
      return views.get(team);
    },
  });
}
