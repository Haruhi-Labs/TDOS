import { BUNNY_HARUHI_CONFIG as C } from "./bunny-haruhi-config.js";

/** 只从未加成基础值派生，不继承已算过的形态、难度或单飞加成。 */
export function deriveBunnyCompanionBase(baseStats = C.baseStats) {
  const base = {};
  for (const [key, ratio] of Object.entries(C.companion.baseRatios)) {
    if (!Number.isFinite(baseStats[key]) || baseStats[key] <= 0) {
      throw new RangeError(`伴随舰基础属性无效：${key}`);
    }
    base[key] = baseStats[key] * ratio;
  }
  return Object.freeze(base);
}

function assertTime(now) {
  if (!Number.isFinite(now) || now < 0) throw new RangeError("伴随舰模拟时间必须为非负有限秒数");
}

/**
 * @typedef {Object} BunnyCompanionState
 * @property {number} ownerShipId 永久母舰ID。
 * @property {"A"|"B"} ownerSeat 永久出生阵营，不是实时阵营。
 * @property {number} convertedUntil 策反截止秒数，0为未策反。
 * @property {number|null} nextReliableAt 下次触发秒数；策反和退场时为null。
 * @property {number} reliableUntil 本次来源效果截止秒数，不替代接收者资格。
 * @property {number} reliableStartedTick
 * @property {{forward:number,lateral:number}} followOffset 母舰朝向坐标系中的世界距离。
 */

/** @returns {BunnyCompanionState} */
export function createBunnyCompanionState(ownerShipId, ownerSeat, now) {
  assertTime(now);
  if (!Number.isSafeInteger(ownerShipId) || ownerShipId < 0 || !["A", "B"].includes(ownerSeat)) {
    throw new RangeError("伴随舰母舰ID或出生阵营无效");
  }
  return {
    ownerShipId, ownerSeat, convertedUntil: 0,
    nextReliableAt: now + C.companion.intervalSeconds,
    reliableUntil: 0, reliableStartedTick: -1,
    followOffset: { ...C.companion.followOffset },
  };
}

/** 清理接收者和炮弹是未来适配器的职责，此处只返回事务意图。 */
export function planBunnyCompanionConversion(state, now) {
  assertTime(now);
  return {
    state: {
      ...state, convertedUntil: now + C.companion.bribeSeconds,
      nextReliableAt: null, reliableUntil: 0, reliableStartedTick: -1,
    },
    clearReliable: true, clearProjectiles: true,
  };
}

/**
 * 死亡优先于归还；迟到的更新只触发一次，不补发积压周期。
 * sameOwnerTeam和canAct由适配器提供；canAct包含沉默/失控，enabled表示全局技能开关。
 */
export function advanceBunnyCompanion(state, {
  now, tick, alive, ownerAlive, sameOwnerTeam, canAct, enabled = true,
}) {
  assertTime(now);
  if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError("伴随舰逻辑帧无效");
  const result = {
    state: { ...state }, triggerReliable: false, returnToOwner: false,
    retire: false, clearReliable: false, clearProjectiles: false,
  };
  const next = result.state;
  if (!alive || !ownerAlive) {
    next.convertedUntil = 0;
    next.nextReliableAt = null;
    next.reliableUntil = 0;
    next.reliableStartedTick = -1;
    result.retire = alive && !ownerAlive;
    result.clearReliable = true;
    result.clearProjectiles = true;
    return result;
  }
  if (next.convertedUntil > 0) {
    if (now >= next.convertedUntil) {
      next.convertedUntil = 0;
      next.nextReliableAt = now + C.companion.intervalSeconds;
      result.returnToOwner = true;
      result.clearReliable = true;
      result.clearProjectiles = true;
    }
    return result;
  }
  if (now >= next.reliableUntil) {
    next.reliableUntil = 0;
    next.reliableStartedTick = -1;
  }
  if (next.nextReliableAt !== null && now >= next.nextReliableAt) {
    next.nextReliableAt = now + C.companion.intervalSeconds;
    if (sameOwnerTeam && canAct && enabled) {
      next.reliableUntil = now + C.companion.durationSeconds;
      next.reliableStartedTick = tick;
      result.triggerReliable = true;
    }
  }
  return result;
}

/** 每名接收者单独创建，不能共用一个可变对象。 */
export function createBunnyReliableState(sourceCompanionId, now, tick) {
  assertTime(now);
  if (!Number.isSafeInteger(sourceCompanionId) || sourceCompanionId < 0
    || !Number.isSafeInteger(tick) || tick < 0) throw new RangeError("可靠技能来源或逻辑帧无效");
  return { sourceCompanionId, until: now + C.companion.durationSeconds, startedTick: tick, suppressed: false };
}

export function purgeBunnyReliable(state, tick) {
  return !state || state.startedTick === tick ? state : { ...state, suppressed: true };
}

/** 来源死亡、策反或不再同阵营时sourceValid=false；返回null时由适配器删除字段。 */
export function expireBunnyReliable(state, now, sourceValid = true) {
  return state && sourceValid && now < state.until ? state : null;
}

export function bunnyReliableRecovery({ hp, maxHp, energy, maxEnergy }) {
  if (hp <= 0) return { hp, energy };
  return {
    hp: Math.min(maxHp, hp + maxHp * C.companion.healRatio),
    energy: Math.min(maxEnergy, energy + maxEnergy * C.companion.energyRatio),
  };
}
