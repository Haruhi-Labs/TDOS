import { BUNNY_HARUHI_CONFIG as C } from "./bunny-haruhi-config.js";
import { energyProfileForThrottle, energyRateForThrottle, throttleForGear } from "./throttle.js";
import { createSupportState } from "./haruhi-support.js";

/**
 * @typedef {"neutral"|"bless"|"knows"|"encore"} BunnyForm
 * @typedef {Object} BunnyHaruhiState
 * @property {BunnyForm} form
 * @property {number} successfulCasts 只计算成功提交的次数。
 * @property {number} formStartedAt 绝对模拟秒数。
 * @property {number} formStartedTick 权威逻辑帧，同帧涤除保护使用。
 * @property {Set<string>} visitedForms 首次奖励历史，不因死亡或涤除重置。
 * @property {boolean} scoutsDisabled 本舰永久失去侦察资格。
 * @property {boolean} positiveSuppressed bless正向属性被涤除。
 * @property {number} immunityUntil
 * @property {number} drainUntil
 * @property {number} broadcastUntil
 * @property {number|null} companionId 由未来实体事务填写。
 * @property {boolean} companionSpawned 永久生成历史。
 * @property {boolean} [companionSpawnPending] encore后的待生成意图，默认不存在，死亡取消。
 * @property {Object} support 独立支援状态，由显式来源适配器解锁和推进。
 */

/** @returns {BunnyHaruhiState} */
export function createBunnyHaruhiState() {
  return {
    form: "neutral", successfulCasts: 0, formStartedAt: 0, formStartedTick: -1,
    visitedForms: new Set(), scoutsDisabled: false, positiveSuppressed: false,
    immunityUntil: 0, drainUntil: 0, broadcastUntil: 0,
    companionId: null, companionSpawned: false,
    support: createSupportState(),
  };
}

/**
 * @typedef {Object} BunnyStageExposure
 * @property {number|null} sourceShipId
 * @property {boolean} inside
 * @property {number|null} enteredAt 连续入圈起点，重复采样不得重置。
 * @property {"none"|"speechless"|"entranced"} phase
 * @property {number} phaseStartedTick
 * @property {number} nextEntryControlAt 整局历史，离圈不清。
 * @property {boolean} firstEntranceHealConsumed 整局历史，满血也消耗。
 * @property {number} lockUntil
 * @property {number} recoveryStartedAt
 * @property {number} recoveryUntil
 */

/** @returns {BunnyStageExposure} */
export function createBunnyStageExposure() {
  return {
    sourceShipId: null, inside: false, enteredAt: null, phase: "none",
    phaseStartedTick: -1, nextEntryControlAt: 0, firstEntranceHealConsumed: false,
    lockUntil: 0, recoveryStartedAt: 0, recoveryUntil: 0,
  };
}

export function nextBunnyForm(state) {
  const count = state.successfulCasts;
  if (!Number.isSafeInteger(count) || count < 0 || count === Number.MAX_SAFE_INTEGER) {
    throw new RangeError("兔女郎春日成功施放次数超出有效范围");
  }
  if (count === 3) return "encore";
  return count % 2 === 0 ? "bless" : "knows";
}

function assertTime(now, tick) {
  if (!Number.isFinite(now) || now < 0 || !Number.isSafeInteger(tick) || tick < 0) {
    throw new RangeError("模拟时间必须为非负有限秒数，逻辑帧必须为非负安全整数");
  }
}

function assertResources({ hp, maxHp, energy, maxEnergy }) {
  if (![hp, maxHp, energy, maxEnergy].every(Number.isFinite)
    || maxHp <= 0 || maxEnergy < 0 || hp < 0 || hp > maxHp || energy < 0 || energy > maxEnergy) {
    throw new RangeError("生命与能量必须为合法范围内的有限值");
  }
}

/**
 * 生成一次施放的纯计算方案，不修改输入，不调用伤害、随机数或实体工厂。
 * 调用者先校验槽位、存活、分离、控制、沉默、封印、CD，并在实体资源准备好后原子提交。
 * 返回的奖励是意图；未提交的方案不能发放奖励，也不能单独写回state。
 */
export function planBunnyTransform(state, resources, now, tick) {
  assertTime(now, tick);
  assertResources(resources);
  const form = nextBunnyForm(state);
  const cost = form === "bless" ? resources.maxHp * C.bless.hpCostRatio : 0;
  if (resources.hp <= cost) {
    return { ok: false, reason: resources.hp === 0 ? "dead" : "insufficient_hp" };
  }
  const firstVisit = !state.visitedForms.has(form);
  const spawnCompanion = form === "encore" && !state.companionSpawned;
  const next = {
    ...state, form, successfulCasts: state.successfulCasts + 1,
    formStartedAt: now, formStartedTick: tick,
    visitedForms: new Set([...state.visitedForms, form]),
    scoutsDisabled: state.scoutsDisabled || form === "bless", positiveSuppressed: false,
    immunityUntil: form === "knows" ? now + C.knows.immunitySeconds : 0,
    drainUntil: form === "knows" ? now + C.knows.selfDrainSeconds : 0,
    broadcastUntil: form === "knows" ? now + C.knows.broadcastSeconds : 0,
    companionSpawned: state.companionSpawned || spawnCompanion,
    support: {
      ...state.support, supporters: new Set(state.support.supporters),
      queuedBeamAt: [...state.support.queuedBeamAt],
    },
  };
  const energyFloor = form === "bless" ? C.bless.energyFloorRatio
    : form === "knows" ? C.knows.energyFloorRatio : 0;
  return {
    ok: true, reason: null, state: next,
    hp: Math.min(resources.maxHp, resources.hp - cost
      + (form === "encore" ? resources.maxHp * C.encore.healRatio : 0)),
    energy: Math.max(resources.energy, resources.maxEnergy * energyFloor),
    cooldownSeconds: C.form.cooldownSeconds,
    unlockSupport: firstVisit, spawnCompanion,
  };
}

/** 死亡只清临时窗口，保留形态、侦察和奖励历史；本模块不负责实体退场。 */
export function clearBunnyFormWindows(state) {
  return { ...state, immunityUntil: 0, drainUntil: 0, broadcastUntil: 0 };
}

export function purgeBunnyForm(state, tick) {
  if (state.formStartedTick === tick) return state;
  return {
    ...state,
    positiveSuppressed: state.positiveSuppressed || state.form === "bless",
    immunityUntil: state.form === "knows" ? 0 : state.immunityUntil,
  };
}

export function leaveBunnyStage(state) {
  return {
    ...createBunnyStageExposure(),
    nextEntryControlAt: state.nextEntryControlAt,
    firstEntranceHealConsumed: state.firstEntranceHealConsumed,
  };
}

/**
 * 成员关系由调用者采样：只传存活敌方玩家舰位；源死亡/目标死亡/封印等价于inside=false。
 * 可在同帧重复调用；只在首次进入入迷时返回一次治疗比例，满血也消耗历史。
 */
export function resolveBunnyStageExposure(state, { inside, sourceShipId, now, tick }) {
  assertTime(now, tick);
  if (!inside) return { state: leaveBunnyStage(state), healRatio: 0 };
  if (!Number.isSafeInteger(sourceShipId) || sourceShipId < 0) {
    throw new RangeError("舞台来源必须具有有效舰船ID");
  }
  let next = { ...state };
  if (!next.inside || next.sourceShipId !== sourceShipId) {
    next = {
      ...leaveBunnyStage(next), sourceShipId, inside: true, enteredAt: now,
      phase: "speechless", phaseStartedTick: tick,
    };
    if (now >= next.nextEntryControlAt) {
      next.lockUntil = now + C.stage.lockSeconds;
      next.recoveryStartedAt = next.lockUntil;
      next.recoveryUntil = next.lockUntil + C.stage.recoverySeconds;
      next.nextEntryControlAt = now + C.stage.entryCooldownSeconds;
    }
  }
  let healRatio = 0;
  if (next.phase === "speechless" && now >= next.enteredAt + C.stage.entranceSeconds) {
    next.phase = "entranced";
    next.phaseStartedTick = tick;
    if (!next.firstEntranceHealConsumed) {
      next.firstEntranceHealConsumed = true;
      healRatio = C.stage.firstHealRatio;
    }
  }
  return { state: next, healRatio };
}

export function cleanseBunnyStageControl(state) {
  return { ...state, lockUntil: 0, recoveryStartedAt: 0, recoveryUntil: 0 };
}

const combatStats = new Set(["speed", "turnRate", "accel", "range", "vision", "damage", "fireRate"]);
function multiplier(table, key) {
  return Object.hasOwn(table, key) ? table[key] : 1;
}

/**
 * 只接收必要状态，不读team或墙钟。伴随舰由适配器传母舰form，策反时不传。
 * enabled=false暂停正向增益；bless易伤和knows降属性仍是形态代价。
 */
export function bunnyStatMultiplier({ form, stage, reliable, enabled = true } = {}, statKey, now) {
  let result = 1;
  if (form?.form === "bless" && enabled && !form.positiveSuppressed) {
    result *= multiplier(C.bless.multipliers, statKey);
  } else if (form?.form === "knows") {
    result *= multiplier(C.knows.multipliers, statKey);
  }
  if (!enabled) return result;
  if (stage?.inside && stage.phase === "speechless") {
    if (statKey === "speed") result *= C.stage.speechlessSpeedMultiplier;
    if (statKey === "fireRate") result *= C.stage.speechlessFireRateMultiplier;
    if (statKey === "regen") result = 0;
  } else if (stage?.inside && stage.phase === "entranced" && combatStats.has(statKey)) {
    result *= C.stage.entrancedMultiplier;
  }
  if (reliable && !reliable.suppressed && now < reliable.until) {
    result *= multiplier(C.companion.multipliers, statKey);
  }
  return result;
}

export function bunnyDamageTakenMultiplier(state) {
  return state?.form === "bless" ? C.bless.damageTakenMultiplier : 1;
}

export function isBunnyDamageImmune(state, now, enabled = true) {
  return Boolean(enabled && state?.form === "knows" && now < state.immunityUntil);
}

export function isBunnyBroadcasting(state, now, enabled = true) {
  return Boolean(enabled && (state?.form === "bless"
    || (state?.form === "knows" && now < state.broadcastUntil)));
}

export function isBunnyControlLocked(state, now, enabled = true) {
  return Boolean(enabled && state?.inside && now < state.lockUntil);
}

export function bunnyStageSpeedFactor(state, now, enabled = true) {
  if (!enabled || !state?.inside || now >= state.recoveryUntil) return 1;
  if (now < state.lockUntil) return 0;
  const duration = state.recoveryUntil - state.recoveryStartedAt;
  return duration > 0 ? Math.max(0, Math.min(1, (now - state.recoveryStartedAt) / duration)) : 1;
}

export function canBunnyLaunchScout(state) {
  return !state?.scoutsDisabled;
}

export function resolveBunnyThrottle(state, requestedThrottle, enabled = true) {
  return enabled && state?.form === "encore" ? throttleForGear(C.encore.lockedGear) : requestedThrottle;
}

/** 绕过普通回能的最低值保护，只去掉自然恢复，不改变推进耗能。 */
export function bunnyEnergyRate(stage, regen, moveDrain, throttle, enabled = true) {
  if (enabled && stage?.inside && stage.phase === "speechless") {
    return -Math.max(0, moveDrain) * energyProfileForThrottle(throttle).moveCostMultiplier;
  }
  return energyRateForThrottle(regen, moveDrain, throttle);
}

function overlapSeconds(from, to, start, end) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from) {
    throw new RangeError("持续效果要求有效且单调递增的模拟时间区间");
  }
  return Math.max(0, Math.min(to, end) - Math.max(from, start));
}

/** 调用者每个权威区间只应用一次；在切换、死亡、进出圈与封印边界拆分区间。 */
export function bunnySelfDrainAmount(state, { from, to, hp, maxHp, enabled = true }) {
  const seconds = overlapSeconds(from, to, state?.formStartedAt ?? 0, state?.drainUntil ?? 0);
  if (!enabled || state?.form !== "knows" || hp <= 1) return 0;
  return Math.min(hp - 1, maxHp * C.knows.hpDrainPerSecondRatio * seconds);
}

export function bunnyStageHealAmount(state, { from, to, hp, maxHp, enabled = true }) {
  const seconds = overlapSeconds(from, to, (state?.enteredAt ?? to) + C.stage.entranceSeconds, to);
  if (!enabled || !state?.inside || hp <= 0) return 0;
  return Math.min(Math.max(0, maxHp - hp), maxHp * C.stage.healPerSecondRatio * seconds);
}
