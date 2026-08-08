import { MatchSimulation, TICK_DT } from "../game-core.js";
import { createSeededRandom } from "../game/random.js";
import { applyRlAction, buildRlActionMask } from "./actions.js";
import { buildRlObservation } from "./observation.js";
import {
  DEFAULT_RL_DECISION_TICKS,
  DEFAULT_RL_EPISODE_SECONDS,
  RL_OUTCOME_REWARDS,
  sampleUniversalLoadout,
} from "./environment.js";

function integer(value, fallback, minimum = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.trunc(number)) : fallback;
}

function rewardForLearner(winnerSeat, learnerSeat, timedOut) {
  if (timedOut) return RL_OUTCOME_REWARDS.timeout;
  if (!winnerSeat) return RL_OUTCOME_REWARDS.draw;
  return winnerSeat === learnerSeat ? RL_OUTCOME_REWARDS.win : RL_OUTCOME_REWARDS.loss;
}

export class RlBenchmarkEnvironment {
  constructor(options = {}) {
    this.streamId = integer(options.streamId, 0, 0);
    this.decisionTicks = integer(options.decisionTicks, DEFAULT_RL_DECISION_TICKS);
    this.maxEpisodeSeconds = Math.max(
      TICK_DT,
      Number(options.maxEpisodeSeconds) || DEFAULT_RL_EPISODE_SECONDS,
    );
    this.simulation = null;
    this.learnerSeat = "A";
    this.done = true;
    this.seed = 1;
    this.loadouts = null;
  }

  reset(options = {}) {
    this.seed = integer(options.seed, 1, 0);
    this.learnerSeat = options.learnerSeat === "B" ? "B" : "A";
    const botSeat = this.learnerSeat === "A" ? "B" : "A";
    const random = createSeededRandom(this.seed ^ 0x51a3f20d);
    const learnerLoadout = options.learnerLoadout || sampleUniversalLoadout(random);
    const botLoadout = options.botLoadout
      || (options.mirrorLoadout !== false ? learnerLoadout : sampleUniversalLoadout(random));
    this.loadouts = {
      [this.learnerSeat]: learnerLoadout,
      [botSeat]: botLoadout,
    };
    this.simulation = new MatchSimulation({
      mode: "pvp",
      randomSeed: this.seed,
      isolatedEntityIds: true,
      aiSeats: [botSeat],
      aiDifficulty: "master",
      teamLoadouts: this.loadouts,
    });
    this.done = false;
    return this.frame(false, false, 0);
  }

  frame(terminated, truncated, simulatedTicks) {
    return {
      seat: {
        observation: buildRlObservation(this.simulation, this.learnerSeat),
        actionMask: buildRlActionMask(this.simulation, this.learnerSeat),
      },
      reward: terminated || truncated
        ? rewardForLearner(this.simulation.winnerSeat, this.learnerSeat, truncated)
        : 0,
      terminated,
      truncated,
      info: {
        streamId: this.streamId,
        seed: this.seed,
        learnerSeat: this.learnerSeat,
        botSeat: this.learnerSeat === "A" ? "B" : "A",
        elapsed: this.simulation.elapsed,
        winnerSeat: this.simulation.winnerSeat,
        loadouts: this.loadouts,
        simulatedTicks,
      },
    };
  }

  step(policyAction = {}) {
    if (!this.simulation || this.done) {
      throw new Error("评测环境已结束，继续推进前必须 reset");
    }
    applyRlAction(this.simulation, this.learnerSeat, policyAction);
    let simulatedTicks = 0;
    let truncated = false;
    while (simulatedTicks < this.decisionTicks && this.simulation.phase === "running") {
      this.simulation.update(TICK_DT);
      simulatedTicks += 1;
      if (this.simulation.elapsed + 1e-9 >= this.maxEpisodeSeconds) {
        truncated = this.simulation.phase === "running";
        break;
      }
    }
    const terminated = this.simulation.phase === "finished";
    this.done = terminated || truncated;
    return this.frame(terminated, truncated, simulatedTicks);
  }
}

export class RlBenchmarkBatchEnvironment {
  constructor(options = {}) {
    const count = integer(options.count, 1);
    const offset = integer(options.streamOffset, 0, 0);
    this.environments = Array.from({ length: count }, (_, index) => new RlBenchmarkEnvironment({
      ...options,
      streamId: offset + index,
    }));
  }

  get count() {
    return this.environments.length;
  }

  reset(options = []) {
    return this.environments.map((environment, index) => environment.reset(options[index] || {}));
  }

  resetAt(index, options = {}) {
    if (!this.environments[index]) throw new RangeError(`评测环境下标越界：${index}`);
    return this.environments[index].reset(options);
  }

  step(actions = []) {
    if (actions.length !== this.count) {
      throw new RangeError(`批评测动作数量应为 ${this.count}，实际为 ${actions.length}`);
    }
    return this.environments.map((environment, index) => environment.step(actions[index] || {}));
  }
}
