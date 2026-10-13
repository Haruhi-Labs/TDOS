import { BattleRuntime } from "./battle-runtime.js";
import { SimulationTime } from "./simulation-time.js";
import { TICK_DT } from "../foundation/constants.js";

// 对外的权威模拟独占时钟；角色世界只获得读取样本的能力。
export class MatchSimulation extends BattleRuntime {
  #time;

  constructor(options = {}) {
    const time = new SimulationTime();
    super(options, () => time.frame);
    this.#time = time;
  }

  update(dt = TICK_DT) {
    if (this.phase !== "running") return;
    const delta = this.#time.advance(dt);
    super.update(delta);
  }
}
