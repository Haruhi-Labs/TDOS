import { CHARACTER_EXTENSIONS } from "./registry.js";
import { compileHooks, SHIP_HOOKS } from "./extension-contract.js";

const hooks = compileHooks(CHARACTER_EXTENSIONS.map((extension) => extension.ship || {}), SHIP_HOOKS);
export const SHIP_EFFECTS = Object.freeze({
  initialize: (ship, capabilities) => hooks.all("initialize", ship, capabilities),
  clearControl: (ship) => hooks.all("clearControl", ship),
  clearPositive: (ship, preserve) => hooks.all("clearPositive", ship, preserve).some(Boolean),
  hasNegative: (ship) => hooks.some("hasNegative", ship),
  clearNegative: (ship) => hooks.first("clearNegative", undefined, ship),
  expireMarks: (ship) => hooks.all("expireMarks", ship),
  registerClawHit: (...args) => hooks.first("registerClawHit", undefined, ...args),
  advanceMovement: (...args) => hooks.first("advanceMovement", false, ...args),
  castExclusiveSubSkill: (ship) => hooks.first("castExclusiveSubSkill", null, ship),
  consumeBarrierRam: (...args) => hooks.first("consumeBarrierRam", true, ...args),
  prepareShotDamage: (ship, damage, match) => hooks.reduce("prepareShotDamage", damage, ship, match),
  onProjectileHit: (...args) => hooks.all("onProjectileHit", ...args),
});
