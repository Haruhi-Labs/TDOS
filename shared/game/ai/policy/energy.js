// 能量管理：能量池状态、推进档位护栏与支出许可。
// 这些方法安装在 RulePolicy 的原型上，经 this 访问观测、参数、随机流与策略状态。
import { energyRateForThrottle, throttleForGear, throttleGearForValue } from "../../throttle.js";

export const energyMethods = {
  energyProfile(shipOrKey) {
    const members = this.fleetMembers(shipOrKey).filter((ship) => ship.alive);
    const pool = this.fleetEnergy(shipOrKey);
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
      high: ratio >= this.params.energy.profile.highRatio,
      low: ratio <= this.params.energy.profile.lowRatio,
      critical: ratio <= this.params.energy.profile.criticalRatio,
    };
  },

  energyThrottleGearCap(shipOrKey) {
    const profile = this.energyProfile(shipOrKey);
    const ship = typeof shipOrKey === "string" ? this.obs.self.ships[shipOrKey] : shipOrKey;
    if (profile.ratio <= this.params.energy.gear.criticalRatio) {
      return 1;
    }
    // 刀锋期间优先以四档迅速穿入敌阵；接触伤害固定，危险能量线前仍降档保留后续机动。
    if (this.hasEffect(ship, "bladeQueenUntil")) {
      return 4;
    }
    if (profile.ratio <= this.params.energy.gear.lowRatio) {
      return 2;
    }
    const currentGear = throttleGearForValue(ship?.throttle);
    const overdriveThreshold = currentGear === 4
      ? this.params.energy.gear.overdriveStopRatio
      : this.params.energy.gear.overdriveStartRatio;
    return profile.ratio >= overdriveThreshold ? 4 : 3;
  },

  energyAwareThrottleForShip(ship, requestedThrottle) {
    const intendedGear = requestedThrottle > 1
      ? 4
      : throttleGearForValue(requestedThrottle);
    return throttleForGear(Math.min(intendedGear, this.energyThrottleGearCap(ship)));
  },

  enforceEnergyThrottleCaps() {
    for (const ship of Object.values(this.obs.self.ships)) {
      if (!ship?.alive || ship.attached) {
        continue;
      }
      const currentGear = throttleGearForValue(ship.throttle);
      const gearCap = this.energyThrottleGearCap(ship);
      if (currentGear > gearCap) {
        this.writeThrottle(ship.key, throttleForGear(gearCap));
      }
    }
  },

  energyRatioAfterSpend(shipOrKey, cost) {
    const profile = this.energyProfile(shipOrKey);
    if (profile.max <= 0) {
      return 0;
    }
    return (profile.current - cost) / profile.max;
  },

  allowEnergyCommit(shipOrKey, cost, context, {
    emergencyFloor = 0.05,
    normalFloor = 0.14,
    conserveFloor = 0.24,
  } = {}) {
    const profile = this.energyProfile(shipOrKey);
    if (profile.current < cost) {
      return false;
    }
    const afterRatio = this.energyRatioAfterSpend(shipOrKey, cost);
    const floor = context?.emergencyCommit
      ? emergencyFloor
      : context?.energyRecoveryNeed > this.params.energy.commit.conserveAbove
        ? conserveFloor
        : normalFloor - Math.min(this.params.energy.commit.surplusDiscountMax, (context?.energySurplus || 0) * this.params.energy.commit.surplusDiscount);
    return afterRatio >= floor || profile.high;
  },
};
