import { TICK_DT } from "./constants.js";

export function createFixedStepClock({
  stepSeconds = TICK_DT,
  maxCatchupSteps = 6,
  maxFrameSeconds = 0.25,
  initialTimeMs = 0,
} = {}) {
  let lastTimeMs = Number(initialTimeMs) || 0;
  let accumulatorSeconds = 0;

  function reset(currentTimeMs = 0) {
    lastTimeMs = Number(currentTimeMs) || 0;
    accumulatorSeconds = 0;
  }

  function advance(currentTimeMs, onStep, { active = true } = {}) {
    const safeCurrentTimeMs = Number(currentTimeMs);
    if (!Number.isFinite(safeCurrentTimeMs)) {
      return 0;
    }
    const frameSeconds = Math.max(
      0,
      Math.min(maxFrameSeconds, (safeCurrentTimeMs - lastTimeMs) / 1000),
    );
    lastTimeMs = safeCurrentTimeMs;
    if (!active) {
      return 0;
    }

    accumulatorSeconds += frameSeconds;
    let steps = 0;
    while (accumulatorSeconds >= stepSeconds && steps < maxCatchupSteps) {
      onStep(stepSeconds);
      accumulatorSeconds -= stepSeconds;
      steps += 1;
    }
    if (steps >= maxCatchupSteps) {
      accumulatorSeconds = 0;
    }
    return steps;
  }

  return {
    advance,
    reset,
    getAccumulatorSeconds: () => accumulatorSeconds,
  };
}
