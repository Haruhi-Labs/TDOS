import { CHARACTER_EXTENSIONS } from "./registry.js";
import { compileHooks, SHIP_HOOKS } from "./extension-contract.js";

export function createShipEffects(extensions = CHARACTER_EXTENSIONS) {
  const timedKeys = extensions.flatMap((extension) => extension.positiveTimedEffects || []);
  if (new Set(timedKeys).size !== timedKeys.length) throw new Error("定时效果重复登记净化所有者");
  const timedEffects = { hooks: { clearPositive: [[30, (ship, preserve) => {
    let cleared = false;
    for (const key of timedKeys) if (ship.clearTimedEffect(key, preserve)) cleared = true;
    return cleared;
  }]] } };
  const hooks = compileHooks([...extensions.map((extension) => extension.ship || {}), timedEffects], SHIP_HOOKS);
  return Object.freeze({
    initialize: (ship, capabilities) => hooks.all("initialize", ship, capabilities),
    clearControl: (ship) => hooks.all("clearControl", ship),
    clearPositive: (ship, preserve) => hooks.all("clearPositive", ship, preserve).some(Boolean),
    hasNegative: (ship) => hooks.some("hasNegative", ship),
    clearNegative: (ship) => hooks.all("clearNegative", ship),
    expireMarks: (ship) => hooks.all("expireMarks", ship),
    registerClawHit: (...args) => hooks.first("registerClawHit", undefined, ...args),
    advanceMovement: (...args) => hooks.first("advanceMovement", false, ...args),
    castExclusiveSubSkill: (ship) => hooks.first("castExclusiveSubSkill", null, ship),
    consumeBarrierRam: (...args) => hooks.first("consumeBarrierRam", true, ...args),
    prepareShotDamage: (ship, damage, match) => hooks.reduce("prepareShotDamage", damage, ship, match),
    onProjectileHit: (...args) => hooks.all("onProjectileHit", ...args),
  });
}

export const SHIP_EFFECTS = createShipEffects();
