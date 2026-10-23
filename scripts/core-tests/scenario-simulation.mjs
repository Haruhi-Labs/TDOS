import { BattleRuntime } from "../../shared/game/runtime/battle-runtime.js";
import { TICK_DT } from "../../shared/game/foundation/constants.js";
import { clamp } from "../../shared/game/foundation/math.js";

const clocks = new WeakMap();

// 组件场景使用独立的假时间源，明确跳过中间世界推进；不创建或修改权威模拟时钟。
// 真正的推进、权威一致性及原始回放测试仍直接使用 MatchSimulation。
export class ScenarioSimulation extends BattleRuntime {
  constructor(options = {}) {
    const clock = { frame: Object.freeze({ tick: 0, elapsed: 0 }) };
    super(options, () => clock.frame);
    clocks.set(this, clock);
  }

  update(dt = TICK_DT) {
    if (this.phase !== "running") return;
    const delta = clamp(dt, 0, 0.05);
    const clock = clocks.get(this);
    clock.frame = Object.freeze({ tick: this.tick + 1, elapsed: this.elapsed + delta });
    super.update(delta);
  }
}

export function sampleScenarioTime(scenario, fields) {
  const clock = clocks.get(scenario);
  if (!clock) throw new Error("只允许给组件场景采样时间，不能修改权威 MatchSimulation");
  for (const [key, value] of Object.entries(fields)) {
    if (!["elapsed", "tick"].includes(key) || !Number.isFinite(value) || value < 0 || (key === "tick" && !Number.isInteger(value))) {
      throw new Error(`无效的场景时间样本：${key}`);
    }
  }
  clock.frame = Object.freeze({ ...clock.frame, ...fields });
}
