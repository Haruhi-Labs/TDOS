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

// 仅在同步测试作用域内固定随机序列，异常时也恢复运行环境。
export function withSeededRandom(seed, run) {
  const original = Math.random;
  let state = seed >>> 0;
  Math.random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  try { return run(); } finally { Math.random = original; }
}
