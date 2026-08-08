import {
  CHARACTER_ORDER,
  MatchSimulation,
  TICK_DT,
} from "../game-core.js";
import { createSeededRandom } from "../game/random.js";
import { applyRlAction, buildRlActionMask } from "./actions.js";
import { buildRlObservation } from "./observation.js";

export const RL_ENVIRONMENT_SCHEMA_VERSION = 2;
export const DEFAULT_RL_DECISION_TICKS = 3;
export const DEFAULT_RL_EPISODE_SECONDS = 180;
export const RL_OUTCOME_REWARDS = Object.freeze({
  win: 1,
  loss: -1,
  draw: 0,
  timeout: -0.02,
});

function finiteInteger(value, fallback, minimum = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.trunc(number)) : fallback;
}

function normalizeSeed(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) >>> 0 : fallback >>> 0;
}

function mixSeed(baseSeed, stream, episode) {
  let value = normalizeSeed(baseSeed) ^ Math.imul(normalizeSeed(stream + 1), 0x9e3779b1);
  value ^= Math.imul(normalizeSeed(episode + 1), 0x85ebca77);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return value >>> 0;
}

function shuffle(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

/** 均匀抽取角色与槽位，不使用现有 AI 的旗舰排除表或角色偏好。 */
export function sampleUniversalLoadout(random) {
  const selected = shuffle(CHARACTER_ORDER, random).slice(0, 3);
  return {
    main: selected[0],
    sub1: selected[1],
    sub2: selected[2],
  };
}

function terminalRewards(winnerSeat, timedOut) {
  if (timedOut) {
    return { A: RL_OUTCOME_REWARDS.timeout, B: RL_OUTCOME_REWARDS.timeout };
  }
  if (winnerSeat === "A") {
    return { A: RL_OUTCOME_REWARDS.win, B: RL_OUTCOME_REWARDS.loss };
  }
  if (winnerSeat === "B") {
    return { A: RL_OUTCOME_REWARDS.loss, B: RL_OUTCOME_REWARDS.win };
  }
  return { A: RL_OUTCOME_REWARDS.draw, B: RL_OUTCOME_REWARDS.draw };
}

function seatFrame(simulation, seat) {
  return {
    observation: buildRlObservation(simulation, seat),
    actionMask: buildRlActionMask(simulation, seat),
  };
}

/** 单局双席位、全控制、无规则 AI 的训练环境。 */
export class RlMatchEnvironment {
  constructor(options = {}) {
    this.streamId = finiteInteger(options.streamId, 0, 0);
    this.baseSeed = normalizeSeed(options.baseSeed, 1);
    this.decisionTicks = finiteInteger(
      options.decisionTicks,
      DEFAULT_RL_DECISION_TICKS,
    );
    this.maxEpisodeSeconds = Math.max(
      TICK_DT,
      Number.isFinite(Number(options.maxEpisodeSeconds))
        ? Number(options.maxEpisodeSeconds)
        : DEFAULT_RL_EPISODE_SECONDS,
    );
    this.episodeIndex = 0;
    this.simulation = null;
    this.episodeSeed = null;
    this.loadouts = null;
    this.done = true;
    this.timedOut = false;
  }

  reset(options = {}) {
    const episodeSeed = options.seed === undefined
      ? mixSeed(this.baseSeed, this.streamId, this.episodeIndex)
      : normalizeSeed(options.seed, this.baseSeed);
    this.episodeIndex += 1;
    const loadoutRandom = createSeededRandom(episodeSeed ^ 0xa5a5a5a5);
    const teamLoadouts = {
      A: options.teamLoadouts?.A || sampleUniversalLoadout(loadoutRandom),
      B: options.teamLoadouts?.B || sampleUniversalLoadout(loadoutRandom),
    };
    this.simulation = new MatchSimulation({
      mode: "pvp",
      randomSeed: episodeSeed,
      isolatedEntityIds: true,
      teamLoadouts,
    });
    this.episodeSeed = episodeSeed;
    this.loadouts = teamLoadouts;
    this.done = false;
    this.timedOut = false;
    return {
      schemaVersion: RL_ENVIRONMENT_SCHEMA_VERSION,
      seats: {
        A: seatFrame(this.simulation, "A"),
        B: seatFrame(this.simulation, "B"),
      },
      reward: { A: 0, B: 0 },
      terminated: false,
      truncated: false,
      info: this.info(),
    };
  }

  info() {
    return {
      episodeSeed: this.episodeSeed,
      episodeIndex: Math.max(0, this.episodeIndex - 1),
      streamId: this.streamId,
      decisionTicks: this.decisionTicks,
      elapsed: this.simulation?.elapsed || 0,
      winnerSeat: this.simulation?.winnerSeat || null,
      loadouts: this.loadouts,
    };
  }

  step(actionsBySeat = {}) {
    if (!this.simulation || this.done) {
      throw new Error("训练环境已结束，继续推进前必须 reset");
    }

    const acceptedActions = {
      A: applyRlAction(this.simulation, "A", actionsBySeat.A || {}),
      B: applyRlAction(this.simulation, "B", actionsBySeat.B || {}),
    };
    let simulatedTicks = 0;
    while (simulatedTicks < this.decisionTicks && this.simulation.phase === "running") {
      this.simulation.update(TICK_DT);
      simulatedTicks += 1;
      if (this.simulation.elapsed + 1e-9 >= this.maxEpisodeSeconds) {
        this.timedOut = this.simulation.phase === "running";
        break;
      }
    }

    const terminated = this.simulation.phase === "finished";
    const truncated = this.timedOut;
    this.done = terminated || truncated;
    const reward = this.done
      ? terminalRewards(this.simulation.winnerSeat, truncated)
      : { A: 0, B: 0 };
    return {
      schemaVersion: RL_ENVIRONMENT_SCHEMA_VERSION,
      seats: {
        A: seatFrame(this.simulation, "A"),
        B: seatFrame(this.simulation, "B"),
      },
      reward,
      terminated,
      truncated,
      info: {
        ...this.info(),
        simulatedTicks,
        acceptedActions,
      },
    };
  }
}

/**
 * 同一进程内顺序推进多个独立环境。权威模拟远快于实时，先避免 worker 通信开销；
 * Python 桥接层可按吞吐测试启动多个批进程分摊到性能核。
 */
export class RlBatchEnvironment {
  constructor(options = {}) {
    const count = finiteInteger(options.count, 1);
    this.environments = Array.from({ length: count }, (_, index) => new RlMatchEnvironment({
      ...options,
      streamId: finiteInteger(options.streamOffset, 0, 0) + index,
    }));
  }

  get count() {
    return this.environments.length;
  }

  reset(optionsByEnvironment = []) {
    return this.environments.map((environment, index) => environment.reset(optionsByEnvironment[index] || {}));
  }

  resetAt(index, options = {}) {
    const environment = this.environments[index];
    if (!environment) throw new RangeError(`训练环境下标越界：${index}`);
    return environment.reset(options);
  }

  step(actionsByEnvironment = []) {
    if (actionsByEnvironment.length !== this.count) {
      throw new RangeError(`批动作数量应为 ${this.count}，实际为 ${actionsByEnvironment.length}`);
    }
    return this.environments.map((environment, index) => environment.step(actionsByEnvironment[index] || {}));
  }
}
