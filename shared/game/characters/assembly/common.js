import { COLLISION_SLOW_DURATION } from "../../systems/collision-system.js";
import { CHARACTER_DEFS } from "../catalog.js";
import { SOLO_FIRE_RATE_BONUS } from "../../model/model-support.js";
import { isBunnyCompanion } from "../bunny-haruhi/companion-rules.js";
// 通用定时效果的消费仍统一经过 ShipStatus；角色声明不另存第二份状态。
export default {
  statusEffects: [
    [40, (ship, { add }) => {
      if (ship.effects.nextShotDamageMultiplier > 1) add("next_shot", null, null, { multiplier: ship.effects.nextShotDamageMultiplier });
    }],
    [60, (ship, { timed }) => {
      timed("stun", ship.effects.stunnedUntil, CHARACTER_DEFS.koizumi.subSkill.stunDuration);
      timed("silence", ship.effects.silencedUntil, CHARACTER_DEFS.koizumi.subSkill.silenceDuration);
    }],
    [80, (ship, { timed }) => {
      timed("collision_slow", ship.collisionSlowUntil, COLLISION_SLOW_DURATION);
      if (ship.forcedKnockback) {
        const { startedAt, endsAt } = ship.forcedKnockback;
        timed("knockback", endsAt, endsAt - startedAt);
      }
    }]
  ],
  queries: {
    fireRate: [[20, (value, ship) => !isBunnyCompanion(ship) && ship.team.fleetMemberCountForShip(ship) <= 1 ? value * SOLO_FIRE_RATE_BONUS : value]],
  },
  id: "common",
  ship: { hooks: {
    clearPositive: [[50, (ship, preserve) => {
      if (!ship.canClearActiveSkillEffect("nextShotDamageMultiplier", preserve)) return false;
      const cleared = ship.effects.nextShotDamageMultiplier > 1;
      ship.consumeNextShotMultiplier(); return cleared;
    }]],
    prepareShotDamage: [[10, (damage, ship, match) => {
      if (ship.effects.nextShotDamageMultiplier > 1) {
        damage *= ship.effects.nextShotDamageMultiplier;
        match.spawnFloatingTextKey(ship.x + 12, ship.y - 12, "超能力", {}, "#9be0ff");
        ship.consumeNextShotMultiplier();
      }
      return damage;
    }]],
  } },
};
