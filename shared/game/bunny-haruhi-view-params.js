import { BUNNY_HARUHI_CONFIG as C } from "./bunny-haruhi-config.js";
import { HARUHI_TIME_TRAVELER_INTERVAL, HARUHI_OTHERWORLDER_COOLDOWN } from "./haruhi-support.js";

// 展示参数只从冻结规则配置派生，三种语言共用，不参与战斗计算。
export const BUNNY_VIEW_PARAMS = Object.freeze({
  cost: C.bless.hpCostRatio * 100, energy: C.bless.energyFloorRatio * 100,
  vulnerable: Math.round((C.bless.damageTakenMultiplier - 1) * 100),
  immunity: C.knows.immunitySeconds, drain: C.knows.selfDrainSeconds,
  drainRate: C.knows.hpDrainPerSecondRatio * 100, cooldown: C.form.cooldownSeconds,
  heal: C.encore.healRatio * 100, gear: C.encore.lockedGear, encoreDuration: C.encore.lockSeconds,
  entrance: C.stage.entranceSeconds, lock: C.stage.lockSeconds, recovery: C.stage.recoverySeconds,
  entryCooldown: C.stage.entryCooldownSeconds, stageHeal: C.stage.firstHealRatio * 100,
  stageRegen: C.stage.healPerSecondRatio * 100, stageBoost: Math.round((C.stage.entrancedMultiplier - 1) * 100),
  interval: C.companion.intervalSeconds, duration: C.companion.durationSeconds,
  companionHeal: C.companion.healRatio * 100, companionEnergy: C.companion.energyRatio * 100,
  bribe: C.companion.bribeSeconds,
  speechlessSlow: Math.round((1 - C.stage.speechlessSpeedMultiplier) * 100),
  guardMove: C.knows.multipliers.speed * 100, guardAttack: C.knows.multipliers.damage * 100,
  assaultSpeed: Math.round((C.bless.multipliers.speed - 1) * 100),
  assaultManeuver: Math.round((C.bless.multipliers.turnRate - 1) * 100),
  assaultRange: Math.round((C.bless.multipliers.range - 1) * 100),
  assaultDamage: Math.round((C.bless.multipliers.damage - 1) * 100),
  assaultRate: Math.round((C.bless.multipliers.fireRate - 1) * 100),
  reliableTurn: Math.round((C.companion.multipliers.turnRate - 1) * 100),
  reliableSpeed: Math.round((C.companion.multipliers.speed - 1) * 100),
  reliableAccel: Math.round((C.companion.multipliers.accel - 1) * 100),
  beamInterval: HARUHI_TIME_TRAVELER_INTERVAL, impactCooldown: HARUHI_OTHERWORLDER_COOLDOWN,
});
