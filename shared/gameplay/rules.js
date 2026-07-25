// 通用玩法倍率：正式模式不传时保持历史行为；原型平台可注入实验值。

function finiteOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export const GAMEPLAY_RULE_LIMITS = Object.freeze({
  damageMultiplier: { min: 0.25, max: 3, step: 0.05 },
  movementSpeedMultiplier: { min: 0.5, max: 2, step: 0.05 },
  turnRateMultiplier: { min: 0.5, max: 2, step: 0.05 },
  energyRegenMultiplier: { min: 0.25, max: 3, step: 0.05 },
  visionMultiplier: { min: 0.5, max: 2, step: 0.05 },
  rangeMultiplier: { min: 0.5, max: 2, step: 0.05 },
});

export const DEFAULT_GAMEPLAY_RULES = Object.freeze({
  damageMultiplier: 1,
  movementSpeedMultiplier: 1,
  turnRateMultiplier: 1,
  energyRegenMultiplier: 1,
  visionMultiplier: 1,
  rangeMultiplier: 1,
});

export const GAMEPLAY_RULE_SCHEMA = Object.freeze([
  { key: "damageMultiplier", label: "伤害倍率", type: "number", ...GAMEPLAY_RULE_LIMITS.damageMultiplier, default: 1 },
  { key: "movementSpeedMultiplier", label: "航速倍率", type: "number", ...GAMEPLAY_RULE_LIMITS.movementSpeedMultiplier, default: 1 },
  { key: "turnRateMultiplier", label: "转向倍率", type: "number", ...GAMEPLAY_RULE_LIMITS.turnRateMultiplier, default: 1 },
  { key: "energyRegenMultiplier", label: "能量恢复倍率", type: "number", ...GAMEPLAY_RULE_LIMITS.energyRegenMultiplier, default: 1 },
  { key: "visionMultiplier", label: "视野倍率", type: "number", ...GAMEPLAY_RULE_LIMITS.visionMultiplier, default: 1 },
  { key: "rangeMultiplier", label: "射程倍率", type: "number", ...GAMEPLAY_RULE_LIMITS.rangeMultiplier, default: 1 },
]);

export function normalizeGameplayRules(input = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const out = { ...DEFAULT_GAMEPLAY_RULES };
  for (const key of Object.keys(DEFAULT_GAMEPLAY_RULES)) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const limits = GAMEPLAY_RULE_LIMITS[key];
    out[key] = clamp(finiteOr(raw[key], DEFAULT_GAMEPLAY_RULES[key]), limits.min, limits.max);
  }
  return out;
}
