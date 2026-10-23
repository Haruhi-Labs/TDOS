// 独立规则配置；角色注册、随机池与技能入口不在配置模块内执行。
function freezeTree(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") freezeTree(child);
  }
  return Object.freeze(value);
}

export const BUNNY_FORMS = Object.freeze(["neutral", "bless", "knows", "encore"]);
export const BUNNY_STAGE_PHASES = Object.freeze(["none", "speechless", "entranced"]);
export const BUNNY_HARUHI_CONFIG = freezeTree({
  characterId: "bunny_haruhi",
  flagshipSkillId: "lost_my_music",
  subSkillId: "god_knows",
  companionRole: "bunny_kyon",
  supportIds: ["time_traveler", "otherworlder", "esper"],
  baseStats: {
    hp: 880, energy: 130, speed: 33, turnRate: 0.36, accel: 1.02,
    energyRegen: 12.5, moveDrain: 8.2, vision: 172, range: 520,
    damage: 29, fireRate: 0.47, radius: 12.8,
  },
  stage: {
    lockSeconds: 0.5, recoverySeconds: 1.5, entryCooldownSeconds: 15,
    entranceSeconds: 10, speechlessSpeedMultiplier: 0.9,
    speechlessFireRateMultiplier: 0.9, firstHealRatio: 0.15,
    healPerSecondRatio: 0.004, entrancedMultiplier: 1.2,
  },
  form: { cooldownSeconds: 30, energyCost: 0, target: "none" },
  bless: {
    hpCostRatio: 0.15, energyFloorRatio: 0.8, damageTakenMultiplier: 1.2,
    multipliers: {
      speed: 1.15, turnRate: 1.2, accel: 1.2, range: 1.1,
      vision: 1.1, damage: 1.25, fireRate: 1.2,
    },
  },
  knows: {
    selfDrainSeconds: 16, hpDrainPerSecondRatio: 0.005, energyFloorRatio: 0.8,
    broadcastSeconds: 16, immunitySeconds: 4,
    multipliers: {
      speed: 0.8, turnRate: 0.8, accel: 0.8, range: 0.8,
      vision: 0.8, damage: 0.7, fireRate: 0.7,
    },
  },
  encore: { healRatio: 0.2, lockedGear: 4, lockSeconds: 10 },
  companion: {
    baseRatios: {
      hp: 0.35, energy: 0.5, damage: 0.4, fireRate: 0.6,
      speed: 1, turnRate: 1, accel: 1, range: 0.8, vision: 0.6,
      energyRegen: 0.5, moveDrain: 0.5, radius: 0.7,
    },
    intervalSeconds: 20, durationSeconds: 6, healRatio: 0.06, energyRatio: 0.15,
    multipliers: { turnRate: 1.2, speed: 1.06, damage: 1.06, accel: 1.1 },
    bribeSeconds: 5, followOffset: { forward: -28, lateral: 24 },
  },
});
