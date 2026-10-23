import { clamp } from "../foundation/math.js";
import { TICK_DT } from "../foundation/constants.js";

// 权威逻辑时间只随模拟步前进；它不负责显示追帧，也不允许跳时或重置。
export class SimulationTime {
  #frame = Object.freeze({ tick: 0, elapsed: 0 });

  get frame() { return this.#frame; }

  advance(dt = TICK_DT) {
    const delta = clamp(dt, 0, 0.05);
    this.#frame = Object.freeze({ tick: this.#frame.tick + 1, elapsed: this.#frame.elapsed + delta });
    return delta;
  }
}
