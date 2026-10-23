import { HARUHI_BOOST_MULTIPLIER, HARUHI_DAMAGE_TAKEN_MULTIPLIER } from "../haruhi/flagship.js";
import { HARUHI_HERO_POWER_DAMAGE_TAKEN_MULTIPLIER } from "../haruhi/hero-power.js";
import { CHARACTER_DEFS } from "../catalog.js";
import { throttleForGear } from "../../rules/throttle.js";
import { clamp } from "../../foundation/math.js";
import { bunnyStatMultiplier, bunnyDamageTakenMultiplier, isBunnyDamageImmune, isBunnyControlLocked, bunnyStageSpeedFactor } from "../bunny-haruhi/rules.js";

const active = (facts, key) => Number(facts.effects[key] || 0) > facts.now;

// 乘法顺序属于行为契约；每个求值只消费事实，不回调 Ship、Team 或世界查询。
export function evaluateAttribute(facts, key, base, timedAttributes) {
  let value = base;
  for (const modifier of timedAttributes) if (active(facts, modifier.until)) value *= modifier.multipliers[key] || 1;
  value *= facts.futureEnabled && ["speed", "fireRate"].includes(key) ? facts.futureForm[key] : 1;
  value *= facts.haruhiBoost && ["speed", "turnRate", "accel", "range", "vision", "damage", "fireRate"].includes(key) ? HARUHI_BOOST_MULTIPLIER : 1;
  if (facts.form) value *= bunnyStatMultiplier({ form: facts.form, enabled: facts.enabled }, key, facts.now);
  if (facts.companionForm) value *= bunnyStatMultiplier({ form: facts.companionForm, enabled: facts.enabled }, key, facts.now);
  if (facts.reliable) value *= bunnyStatMultiplier({ reliable: facts.reliable, enabled: facts.enabled }, key, facts.now);
  if (facts.stage) value *= bunnyStatMultiplier({ stage: facts.stage, enabled: facts.stageEnabled }, key, facts.now);
  return value;
}

export function evaluateControl(facts, immune = facts.orbActive) {
  const stageLocked = Boolean(facts.stage && isBunnyControlLocked(facts.stage, facts.now, facts.stageEnabled));
  return Object.freeze({
    stopsFlight: stageLocked && !immune,
    locked: !immune && (active(facts, "stunnedUntil") || Number(facts.shock?.lockUntil) > facts.now || stageLocked),
    silenced: !immune && (active(facts, "silencedUntil") || (facts.stage?.phase === "speechless" && facts.stageEnabled)),
  });
}

export function evaluateDamageImmunity(facts, immune = facts.orbActive) {
  return immune || Boolean((facts.form || facts.companionForm)
    && isBunnyDamageImmune(facts.form || facts.companionForm, facts.now, facts.enabled));
}

export function evaluateDamageTaken(facts) {
  let value = active(facts, "reliableUntil") ? 0.84 : 1;
  value *= facts.futureEnabled ? facts.futureForm.damageTaken : 1;
  value *= facts.haruhiBoost ? HARUHI_DAMAGE_TAKEN_MULTIPLIER : 1;
  value *= Number(facts.shock?.recoveryUntil) > facts.now ? HARUHI_HERO_POWER_DAMAGE_TAKEN_MULTIPLIER : 1;
  if (facts.form) value *= bunnyDamageTakenMultiplier(facts.form);
  if (facts.companionForm) value *= bunnyDamageTakenMultiplier(facts.companionForm);
  return value;
}

export function evaluateFlightSpeed(facts, memberSpeeds, immune = facts.orbActive) {
  let factor = 1;
  if (!immune && facts.shock && Number(facts.shock.recoveryUntil) > facts.now) {
    factor = Number(facts.shock.lockUntil) > facts.now ? 0
      : clamp((facts.now - facts.shock.lockUntil) / Math.max(0.001, facts.shock.recoveryUntil - facts.shock.lockUntil), 0, 1);
  }
  const speed = (memberSpeeds.length ? Math.min(...memberSpeeds) : 0) * factor;
  return facts.stage && !immune ? speed * bunnyStageSpeedFactor(facts.stage, facts.now, facts.stageEnabled) : speed;
}

export function evaluateMinimumSpeed(facts, timedAttributes) {
  if (!active(facts, "bladeQueenUntil")) return 0;
  const meta = CHARACTER_DEFS.asakura.subSkill;
  return Math.max(facts.base.speed * meta.speedMultiplier, evaluateAttribute(facts, "speed", facts.base.speed, timedAttributes)) * throttleForGear(meta.minimumGear);
}
