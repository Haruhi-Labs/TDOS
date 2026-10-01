import { CHARACTER_DEFS } from "./characters.js";
import { COLLISION_SLOW_DURATION } from "./collision-system.js";
import { HARUHI_SUPPORT_LABELS } from "./haruhi-flagship.js";
import { serializeKoizumiBarrier } from "./koizumi-barrier.js";
import { STATUS_EFFECT_DEFS } from "./status-effect-definitions.js";

export function statusEffectNames(effects) {
  return effects.map(({ id }) => STATUS_EFFECT_DEFS[id].name);
}

// 状态卡只读取权威数据；常驻效果不虚构倒计时，复合形态分别列出增益与减益。
export function serializeShipStatusEffects(ship) {
  if (!ship.alive) return [];
  const team = ship.team;
  const now = team.match.elapsed;
  const statuses = [];
  const add = (id, expiresAt = null, duration = null, detail = {}) => {
    if (expiresAt !== null && expiresAt <= now) return;
    statuses.push({ id, expiresAt, duration, remaining: expiresAt === null ? null : Math.max(0, expiresAt - now), ...detail });
  };
  const timed = (id, expiresAt, duration) => add(id, Number(expiresAt) || 0, Math.max(duration, (Number(expiresAt) || 0) - now));
  timed("reliable", ship.effects.reliableUntil, CHARACTER_DEFS.kyon.subSkill.duration);
  timed("blade_queen", ship.effects.bladeQueenUntil, CHARACTER_DEFS.asakura.subSkill.duration);
  timed("cat_paw", ship.effects.catPawUntil, CHARACTER_DEFS.shamisen.subSkill.duration);
  if (ship.effects.nextShotDamageMultiplier > 1) add("next_shot", null, null, { multiplier: ship.effects.nextShotDamageMultiplier });
  if (ship.koizumiOrb) {
    if (ship.koizumiOrb.phase === "active") timed("esper_orb", ship.koizumiOrb.activeUntil, CHARACTER_DEFS.koizumi.subSkill.duration);
    else add("esper_return");
  }
  timed("stun", ship.effects.stunnedUntil, CHARACTER_DEFS.koizumi.subSkill.stunDuration);
  timed("silence", ship.effects.silencedUntil, CHARACTER_DEFS.koizumi.subSkill.silenceDuration);
  const shock = ship.heroPowerShock;
  timed("hero_lock", shock.lockUntil, Math.max(0, shock.lockUntil - shock.hitAt));
  timed("hero_shock", shock.recoveryUntil, Math.max(0, shock.recoveryUntil - shock.hitAt));
  timed("collision_slow", ship.collisionSlowUntil, COLLISION_SLOW_DURATION);
  if (ship.forcedKnockback) {
    const { startedAt, endsAt } = ship.forcedKnockback;
    timed("knockback", endsAt, endsAt - startedAt);
  }
  if (ship.clawMarks.stacks > 0) add("claw_marks", ship.clawMarks.expiresAt, CHARACTER_DEFS.shamisen.subSkill.markDuration, {
    stacks: ship.clawMarks.stacks, required: ship.clawMarks.required,
  });
  const enemy = team.match.enemyTeamBySeat(team.seat);
  if (enemy?.mainCharacterId() === "shamisen" && enemy.shamisenHunt.targetId === ship.id) add("hunt", null, null, { multiplier: CHARACTER_DEFS.shamisen.flagshipSkill.damageMultiplier });
  timed("sponsor", team.effects.sponsorUntil, CHARACTER_DEFS.tsuruya.flagshipSkill.duration);
  timed("vision_wave", team.visionWaveSkill.activeUntil, CHARACTER_DEFS.asakura.flagshipSkill.duration);
  if (team.hasKyonFlagship()) add("kyon_maneuver");
  if (team.mainCharacterId() === "haruhi") {
    timed("haruhi_boost", team.effects.haruhiBoostUntil, CHARACTER_DEFS.haruhi.flagshipSkill.duration);
    timed("broadcast", team.effects.haruhiBoostUntil, CHARACTER_DEFS.haruhi.flagshipSkill.duration);
    if (ship.key === "main") {
      for (const support of Object.keys(HARUHI_SUPPORT_LABELS)) {
        if (team.haruhiFlagship.supporters.has(support)) add(`support_${support}`);
      }
    }
  }
  if (team.mainCharacterId() === "future1096" && team.future1096Form) {
    add(team.future1096Form === "A" ? "form_a_boost" : "form_b_defense");
    add(team.future1096Form === "A" ? "form_a_vulnerable" : "form_b_slow");
  }
  if (ship.key === "main" && team.mainCharacterId() === "koizumi") {
    const barrier = serializeKoizumiBarrier(team);
    if (barrier.active) add("barrier", null, null, { stacks: barrier.remainingHits, required: barrier.maxHits });
  }
  return statuses;
}
