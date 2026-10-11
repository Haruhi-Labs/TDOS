import { SOLO_FIRE_RATE_BONUS } from "../../model/model-support.js";
import { isBunnyCompanion } from "../bunny-haruhi/companion-rules.js";
// 通用定时效果的消费仍统一经过 ShipStatus；角色声明不另存第二份状态。
export default {
  queries: {
    fireRate: [[20, (value, ship) => !isBunnyCompanion(ship) && ship.team.fleetMemberCountForShip(ship) <= 1 ? value * SOLO_FIRE_RATE_BONUS : value]],
  },
  id: "common",
  ship: { hooks: {
    clearPositive: [[30, (ship, preserve) => {
      let cleared = false;
      for (const key of ["reliableUntil", "bladeQueenUntil", "catPawUntil"]) if (ship.clearTimedEffect(key, preserve)) cleared = true;
      return cleared;
    }], [50, (ship, preserve) => {
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
