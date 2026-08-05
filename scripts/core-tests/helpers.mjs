import { TICK_DT } from "../../shared/game-core.js";

export function runSteps(sim, seconds) {
  const steps = Math.floor(seconds / TICK_DT);
  for (let i = 0; i < steps; i += 1) {
    sim.update(TICK_DT);
  }
}

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
