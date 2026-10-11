import { readonlyIdSet } from "../data/readonly-id-set.js";
import { normalizeAngle, clamp } from "./math.js";

export const HARUHI_SUPPORTS = Object.freeze(["alien", "time_traveler", "otherworlder", "esper"]);
export const HARUHI_SUPPORT_LABELS = Object.freeze({
  alien: "宇宙人", time_traveler: "未来人", otherworlder: "异世界人", esper: "超能力者",
});
export const HARUHI_ALIEN_INTERVAL = 6;
export const HARUHI_TIME_TRAVELER_INTERVAL = 10;
export const HARUHI_TIME_TRAVELER_BEAM_GAP = 0.3;
export const HARUHI_OTHERWORLDER_COOLDOWN = 8;
export const HARUHI_OTHERWORLDER_DAMAGE_RATIO = 0.15;
export const HARUHI_OTHERWORLDER_KNOCKBACK_DURATION = 0.85;
export const HARUHI_ESPER_ORBIT_SPEED = 1.44;
export const HARUHI_ESPER_ABSORB_RADIUS_MULTIPLIER = 3;

/**
 * @typedef {Object} SupportSource
 * @property {Object} sourceShip 实际发射/几何来源，不通过队伍旗舰反查。
 * @property {Object} owner 已初始化的支援来源身份，供调度写入。
 * @property {Object} state 此来源的不可变支援快照，仅供查询。
 * @property {boolean} enabled 由角色适配器决定是否启用。
 */

export function createSupportState(initialAngle = 0) {
  return {
    supporters: new Set(), alienNextAt: 0, timeTravelerNextAt: 0,
    queuedBeamAt: [], otherworlderReadyAt: 0, esperAngle: normalizeAngle(initialAngle),
  };
}

// 写入口以来源身份定位私有存储；读快照不再充当写入凭证，也不回退修改普通对象。
const ownedStates = new WeakMap();
function writableState(owner) {
  const record = ownedStates.get(owner);
  if (!record) throw new TypeError("支援写入要求已初始化的来源");
  return record.state;
}
export function replaceSupportState(owner, initial) {
  ownedStates.set(owner, { state: { ...initial,
    supporters: new Set(initial.supporters), queuedBeamAt: [...initial.queuedBeamAt],
  }, view: null });
}
export function initializeSupport(owner, initial = createSupportState()) {
  if (!ownedStates.has(owner)) replaceSupportState(owner, initial);
}
export function readSupportState(owner) {
  const record = ownedStates.get(owner);
  if (!record) return null;
  const { state, view } = record;
  // 发射回调可在同一次追帧中读取支援；逐项比较确保回调后继续推进不会留下旧缓存。
  if (view && Object.keys(view).length === Object.keys(state).length
    && ["alienNextAt", "timeTravelerNextAt", "otherworlderReadyAt", "esperAngle", "suspended"].every((key) => view[key] === state[key])
    && view.supporters.size === state.supporters.size && [...state.supporters].every((id) => view.supporters.has(id))
    && view.queuedBeamAt.length === state.queuedBeamAt.length && state.queuedBeamAt.every((at, index) => view.queuedBeamAt[index] === at)) return view;
  return record.view = Object.freeze({ ...record.state,
    supporters: readonlyIdSet(record.state.supporters),
    queuedBeamAt: Object.freeze([...record.state.queuedBeamAt]),
  });
}

export function clearSupportQueue(owner) {
  const state = writableState(owner);
  state.queuedBeamAt.length = 0;
}

// 新来源选择封印后重新计时；旧旗舰仍保留原有追帧规则。
export function suspendSupportSchedule(owner) {
  const state = writableState(owner);
  state.suspended = true;
}

export function resumeSupportSchedule(owner, now) {
  const state = writableState(owner);
  if (!state.suspended) return;
  state.timeTravelerNextAt = state.supporters.has("time_traveler") ? now + HARUHI_TIME_TRAVELER_INTERVAL : 0;
  state.queuedBeamAt.length = 0;
  delete state.suspended;
}

/** eligibleIds由可信角色配置提供有序、无重复的池；只有实际解锁才取一次随机数。 */
export function unlockSupport(owner, eligibleIds, now, random) {
  const state = writableState(owner);
  const remaining = eligibleIds.filter((id) => !state.supporters.has(id));
  if (remaining.length === 0) return null;
  const roll = clamp(Number(random()) || 0, 0, 0.999999);
  const supportId = remaining[Math.floor(roll * remaining.length)];
  state.supporters.add(supportId);
  if (supportId === "alien") state.alienNextAt = now + HARUHI_ALIEN_INTERVAL;
  else if (supportId === "time_traveler") state.timeTravelerNextAt = now + HARUHI_TIME_TRAVELER_INTERVAL;
  else if (supportId === "otherworlder") state.otherworlderReadyAt = now;
  return supportId;
}

/**
 * 保留旧调度次序：宇宙人追帧 → 未来人排队 → 光线发射 → 超能力者转动。
 * 本函数不取随机数，发射回调仍在原时机消费模拟随机数；dt仅供轨道转动。
 * 停止仅清待发光线；恢复时是否重排由适配器决定，不能改变旧旗舰的追帧语义。
 */
export function tickSupportSource(source, now, dt, hooks = {}) {
  if (!source) return;
  const { sourceShip, enabled } = source;
  const state = writableState(source.owner);
  if (!enabled || !sourceShip?.alive) {
    state.queuedBeamAt.length = 0;
    return;
  }
  if (state.supporters.has("alien")) {
    while (state.alienNextAt > 0 && now + 1e-9 >= state.alienNextAt) {
      hooks.launchAlienWingmen?.(sourceShip);
      state.alienNextAt += HARUHI_ALIEN_INTERVAL;
    }
  }
  if (state.supporters.has("time_traveler")) {
    while (state.timeTravelerNextAt > 0 && now + 1e-9 >= state.timeTravelerNextAt) {
      state.queuedBeamAt.push(
        state.timeTravelerNextAt,
        state.timeTravelerNextAt + HARUHI_TIME_TRAVELER_BEAM_GAP,
        state.timeTravelerNextAt + HARUHI_TIME_TRAVELER_BEAM_GAP * 2,
      );
      state.timeTravelerNextAt += HARUHI_TIME_TRAVELER_INTERVAL;
    }
    while (state.queuedBeamAt.length > 0 && now + 1e-9 >= state.queuedBeamAt[0]) {
      state.queuedBeamAt.shift();
      hooks.launchRandomBeam?.(sourceShip);
    }
  }
  if (state.supporters.has("esper")) {
    state.esperAngle = normalizeAngle(state.esperAngle + HARUHI_ESPER_ORBIT_SPEED * (Number(dt) || 0));
  }
}

export function supportOrbGeometry(source) {
  if (!source?.enabled || !source.sourceShip?.alive || !source.state.supporters.has("esper")) return null;
  const { sourceShip, state } = source;
  const orbitRadius = sourceShip.effectiveVision();
  const radius = Math.max(8, sourceShip.radius * 0.92);
  return {
    x: sourceShip.x + Math.cos(state.esperAngle) * orbitRadius,
    y: sourceShip.y + Math.sin(state.esperAngle) * orbitRadius,
    angle: state.esperAngle, orbitRadius, radius,
    absorbRadius: radius * HARUHI_ESPER_ABSORB_RADIUS_MULTIPLIER,
  };
}

export function supportOtherworlderReady(source, now) {
  return Boolean(source?.enabled && source.sourceShip?.alive
    && source.state.supporters.has("otherworlder")
    && now + 1e-9 >= source.state.otherworlderReadyAt);
}

export function triggerSupportOtherworlder(source, now) {
  if (!supportOtherworlderReady(source, now)) return false;
  writableState(source.owner).otherworlderReadyAt = now + HARUHI_OTHERWORLDER_COOLDOWN;
  return true;
}
