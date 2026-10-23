// 能量管理：能量池状态、推进档位护栏与支出许可。
// 每个算法显式声明事实和查询输入；执行算法按需重读动作后的事实。
import { energyRateForThrottle, throttleForGear, throttleGearForValue } from "../../../rules/throttle.js";

export const energyMethods = {
  energyProfile({ fleetMembers: capFleetMembers, fleetEnergy: capFleetEnergy, params: policyParams }, shipOrKey) {
    const members = capFleetMembers(shipOrKey).filter((ship) => ship.alive);
    const pool = capFleetEnergy(shipOrKey);
    const ratio = pool.current / Math.max(pool.max, 1);
    const regen = members.reduce((sum, ship) => sum + ship.stats.energyRegen, 0);
    const moveLoad = members.reduce((sum, ship) => sum + ship.stats.moveDrain, 0);
    const sustainCruise = members.reduce((sum, ship) => (
      sum + energyRateForThrottle(ship.stats.energyRegen, ship.stats.moveDrain, throttleForGear(3))
    ), 0);
    const sustainRecover = members.reduce((sum, ship) => (
      sum + energyRateForThrottle(ship.stats.energyRegen, ship.stats.moveDrain, throttleForGear(2))
    ), 0);
    return {
      current: pool.current,
      max: pool.max,
      ratio,
      regen,
      moveLoad,
      sustainCruise,
      sustainRecover,
      high: ratio >= policyParams.energy.profile.highRatio,
      low: ratio <= policyParams.energy.profile.lowRatio,
      critical: ratio <= policyParams.energy.profile.criticalRatio,
    };
  },

  energyThrottleGearCap({ energyProfile: capEnergyProfile, obs: policyObs, params: policyParams, hasEffect: capHasEffect }, shipOrKey) {
    const profile = capEnergyProfile(shipOrKey);
    const ship = typeof shipOrKey === "string" ? policyObs.self.ships[shipOrKey] : shipOrKey;
    if (profile.ratio <= policyParams.energy.gear.criticalRatio) {
      return 1;
    }
    // 刀锋期间优先以四档迅速穿入敌阵；接触伤害固定，危险能量线前仍降档保留后续机动。
    if (capHasEffect(ship, "bladeQueenUntil")) {
      return 4;
    }
    if (profile.ratio <= policyParams.energy.gear.lowRatio) {
      return 2;
    }
    const currentGear = throttleGearForValue(ship?.throttle);
    const overdriveThreshold = currentGear === 4
      ? policyParams.energy.gear.overdriveStopRatio
      : policyParams.energy.gear.overdriveStartRatio;
    return profile.ratio >= overdriveThreshold ? 4 : 3;
  },

  energyAwareThrottleForShip({ energyThrottleGearCap: capEnergyThrottleGearCap }, ship, requestedThrottle) {
    const intendedGear = requestedThrottle > 1
      ? 4
      : throttleGearForValue(requestedThrottle);
    return throttleForGear(Math.min(intendedGear, capEnergyThrottleGearCap(ship)));
  },

  planEnergyThrottleCap({ energyThrottleGearCap: capEnergyThrottleGearCap }, ship) {
    if (!ship?.alive || ship.attached) return null;
    const gearCap = capEnergyThrottleGearCap(ship);
    return throttleGearForValue(ship.throttle) > gearCap
      ? { shipKey: ship.key, throttle: throttleForGear(gearCap) } : null;
  },

  energyRatioAfterSpend({ energyProfile: capEnergyProfile }, shipOrKey, cost) {
    const profile = capEnergyProfile(shipOrKey);
    if (profile.max <= 0) {
      return 0;
    }
    return (profile.current - cost) / profile.max;
  },

  allowEnergyCommit({ energyProfile: capEnergyProfile, energyRatioAfterSpend: capEnergyRatioAfterSpend, params: policyParams }, shipOrKey, cost, context, {
    emergencyFloor = 0.05,
    normalFloor = 0.14,
    conserveFloor = 0.24,
  } = {}) {
    const profile = capEnergyProfile(shipOrKey);
    if (profile.current < cost) {
      return false;
    }
    const afterRatio = capEnergyRatioAfterSpend(shipOrKey, cost);
    const floor = context?.emergencyCommit
      ? emergencyFloor
      : context?.energyRecoveryNeed > policyParams.energy.commit.conserveAbove
        ? conserveFloor
        : normalFloor - Math.min(policyParams.energy.commit.surplusDiscountMax, (context?.energySurplus || 0) * policyParams.energy.commit.surplusDiscount);
    return afterRatio >= floor || profile.high;
  },
};
