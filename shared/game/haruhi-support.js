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
 * @property {Object} state 此来源独占的支援状态。
 * @property {boolean} enabled 由角色适配器决定是否启用。
 */

export function createSupportState(initialAngle = 0) {
  return {
    supporters: new Set(), alienNextAt: 0, timeTravelerNextAt: 0,
    queuedBeamAt: [], otherworlderReadyAt: 0, esperAngle: normalizeAngle(initialAngle),
  };
}

/** eligibleIds由可信角色配置提供有序、无重复的池；只有实际解锁才取一次随机数。 */
export function unlockSupport(state, eligibleIds, now, random) {
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
  const { sourceShip, state, enabled } = source;
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
  source.state.otherworlderReadyAt = now + HARUHI_OTHERWORLDER_COOLDOWN;
  return true;
}
