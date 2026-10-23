// 单人、联机、AI 与服务端统一使用离散推进档位。
export const THROTTLE_GEAR_VALUES = Object.freeze([0, 0.4, 0.7, 1, 1.4]);
export const DEFAULT_THROTTLE_GEAR = 3;

export const ENERGY_GEAR_PROFILES = Object.freeze([
  Object.freeze({ regenMultiplier: 1.25, moveCostMultiplier: 0 }),
  Object.freeze({ regenMultiplier: 1.15, moveCostMultiplier: 0.25 }),
  Object.freeze({ regenMultiplier: 1.05, moveCostMultiplier: 0.55 }),
  Object.freeze({ regenMultiplier: 0.9, moveCostMultiplier: 1 }),
  Object.freeze({ regenMultiplier: 0.55, moveCostMultiplier: 1.65 }),
]);

function clampGear(gear) {
  return Math.max(0, Math.min(THROTTLE_GEAR_VALUES.length - 1, gear));
}

export function throttleForGear(gear) {
  return THROTTLE_GEAR_VALUES[clampGear(Math.round(Number(gear) || 0))];
}

export function throttleGearForValue(value, fallback = DEFAULT_THROTTLE_GEAR) {
  const throttle = Number(value);
  if (!Number.isFinite(throttle)) {
    const fallbackNumber = Number(fallback);
    const fallbackGear = Number.isFinite(fallbackNumber) ? fallbackNumber : DEFAULT_THROTTLE_GEAR;
    return clampGear(Math.round(fallbackGear));
  }
  let closestGear = 0;
  let closestGap = Infinity;
  for (let gear = 0; gear < THROTTLE_GEAR_VALUES.length; gear += 1) {
    const gap = Math.abs(THROTTLE_GEAR_VALUES[gear] - throttle);
    if (gap < closestGap) {
      closestGear = gear;
      closestGap = gap;
    }
  }
  return closestGear;
}

export function normalizeThrottleToGear(value, fallback = THROTTLE_GEAR_VALUES[DEFAULT_THROTTLE_GEAR]) {
  return throttleForGear(throttleGearForValue(value, throttleGearForValue(fallback)));
}

export function energyProfileForThrottle(throttle) {
  return ENERGY_GEAR_PROFILES[throttleGearForValue(throttle)];
}

export function energyRateForThrottle(baseRegen, moveDrain, throttle) {
  const profile = energyProfileForThrottle(throttle);
  const regen = Math.max(1.2, Number(baseRegen) * profile.regenMultiplier);
  const moveCost = Math.max(0, Number(moveDrain)) * profile.moveCostMultiplier;
  return regen - moveCost;
}
