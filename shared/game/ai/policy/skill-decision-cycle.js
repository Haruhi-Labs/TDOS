import { copyPlainData, freezePlainData } from "../../../data/plain-data.js";
import { characterProfile } from "./characters/index.js";

// 技能调度独占检查时钟与历史决策；执行端口只提供判定、施放及施放后的冷却读取。
// 破盾后仅返回重规划结果，移动时钟由策略协调层消费。
export class SkillDecisionCycle {
  #timers;
  #decisions;
  constructor({ flagship, sub1, sub2, now }) {
    this.#timers = { flagship, sub1, sub2 };
    this.#decisions = Object.fromEntries(["flagship", "sub1", "sub2"].map((key) => [key, {
      action: "idle", cast: false, at: now, target: null,
    }]));
  }
  get timers() { return Object.freeze({ ...this.#timers }); }
  get decisions() { return freezePlainData(copyPlainData(this.#decisions)); }
  advance(dt) {
    this.#timers.flagship -= dt;
    this.#timers.sub1 -= dt;
    this.#timers.sub2 -= dt;
  }
  schedule(key, delay) {
    if (!["flagship", "sub1", "sub2"].includes(key) || !Number.isFinite(delay)) {
      throw new TypeError("技能检查计划要求合法技能槽与有限时间");
    }
    this.#timers[key] = delay;
  }
  tryFlagship({ T, now, characterId, estimate, context }, actions) {
    if (this.#timers.flagship > 0) {
      return;
    }
    const followsCooldown = Boolean(characterProfile(characterId).flagship?.timerFollowsCooldown);
    if (!actions.shouldCast()) {
      this.#decisions.flagship = {
        action: "hold",
        cast: false,
        at: now,
        target: copyPlainData(actions.describeTarget(estimate)),
      };
      this.#timers.flagship = followsCooldown
        ? actions.randomRange(T.haruhiHold[0], T.haruhiHold[1])
        : context?.conserveEnergy
          ? actions.randomRange(T.conserveHold[0], T.conserveHold[1])
          : context?.skillAggression > T.aggressiveAbove
            ? actions.randomRange(T.aggressiveHold[0], T.aggressiveHold[1])
            : actions.randomRange(T.hold[0], T.hold[1]);
      return;
    }
    const ok = actions.cast();
    this.#decisions.flagship = {
      action: ok ? "cast" : "retry",
      cast: ok,
      at: now,
      target: copyPlainData(actions.describeTarget(estimate)),
    };
    this.#timers.flagship = ok
      ? followsCooldown
        // 与真实冷却对齐；两者每帧同步递减，冷却归零的同一帧立即进入下一次施放判断。
        ? Math.max(T.haruhiMinInterval, Number(actions.cooldown()) || 0)
        : (context?.skillAggression > T.aggressiveAbove ? actions.randomRange(T.aggressiveCooldown[0], T.aggressiveCooldown[1]) : actions.randomRange(T.cooldown[0], T.cooldown[1]))
      : followsCooldown
        ? actions.randomRange(T.haruhiRetry[0], T.haruhiRetry[1])
        : context?.conserveEnergy
          ? actions.randomRange(T.conserveRetry[0], T.conserveRetry[1])
          : context?.skillAggression > T.aggressiveAbove
            ? actions.randomRange(T.aggressiveRetry[0], T.aggressiveRetry[1])
            : actions.randomRange(T.retry[0], T.retry[1]);
  }

  trySub({ T, now, shipKey, ship, estimate, context, facts }, actions) {
    if (this.#timers[shipKey] > 0) {
      return;
    }
    if (!ship || !ship.alive || ship.attached) {
      this.#decisions[shipKey] = {
        action: "unavailable",
        cast: false,
        at: now,
        target: null,
      };
      this.#timers[shipKey] = actions.randomRange(T.unavailable[0], T.unavailable[1]);
      return;
    }

    if (!actions.shouldCast()) {
      this.#decisions[shipKey] = {
        action: "hold",
        cast: false,
        at: now,
        target: copyPlainData(actions.describeTarget(estimate)),
      };
      this.#timers[shipKey] = context?.conserveEnergy
        ? actions.randomRange(T.conserveHold[0], T.conserveHold[1])
        : context?.skillAggression > T.aggressiveAbove
          ? actions.randomRange(T.aggressiveHold[0], T.aggressiveHold[1])
          : actions.randomRange(T.hold[0], T.hold[1]);
      return;
    }
    const subProfile = characterProfile(ship.characterId).sub;
    const target = subProfile?.target?.(facts, Object.freeze({ T, estimate }));
    const ok = actions.cast(target);
    this.#decisions[shipKey] = {
      action: ok ? "cast" : "retry",
      cast: ok,
      at: now,
      target: copyPlainData(actions.describeTarget(estimate)),
    };
    const replanMovement = Boolean(ok && context?.barrierTactics?.enemy?.active
      && context.barrierTactics.breachShipKey === shipKey);
    this.#timers[shipKey] = ok
      ? subProfile?.timerFollowsCooldown
        ? Math.max(T.haruhiMinInterval, Number(actions.cooldown()) || 0)
        : (context?.skillAggression > T.aggressiveAbove ? actions.randomRange(T.aggressiveCooldown[0], T.aggressiveCooldown[1]) : actions.randomRange(T.cooldown[0], T.cooldown[1]))
      : context?.conserveEnergy
        ? actions.randomRange(T.conserveRetry[0], T.conserveRetry[1])
        : context?.skillAggression > T.aggressiveAbove
          ? actions.randomRange(T.aggressiveRetry[0], T.aggressiveRetry[1])
          : actions.randomRange(T.retry[0], T.retry[1]);
    return replanMovement;
  }

}
