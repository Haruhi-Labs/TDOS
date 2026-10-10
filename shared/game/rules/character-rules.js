// 角色能力适配层：集中解释角色状态，只返回规则结果，不写入实体。
// 通用系统由对局注入此契约；不导入任何具体角色模块。
import { CHARACTER_DEFS } from "../characters.js";
import { throttleForGear } from "../throttle.js";
import { isKoizumiOrbActive } from "../koizumi-orb.js";
import { haruhiBoostActive, haruhiStatMultiplier, haruhiDamageTakenMultiplier } from "../haruhi-flagship.js";
import { haruhiHeroPowerSpeedFactor, haruhiHeroPowerDamageTakenMultiplier, isHaruhiHeroPowerControlLocked } from "../haruhi-hero-power.js";
import { bunnyStatMultiplier, bunnyDamageTakenMultiplier, isBunnyDamageImmune, isBunnyControlLocked, bunnyStageSpeedFactor } from "../bunny-haruhi.js";
import { bunnyStageEnabled, bunnyBroadcastsShip } from "../bunny-haruhi-runtime.js";
import { bunnyCompanionForm, bunnyReliableState } from "../bunny-companion-runtime.js";
import { bunnyOwnerDamageBlocked, isBunnyCompanion } from "../bunny-haruhi-companion.js";
import { shamisenHuntDamageMultiplier } from "../shamisen-hunt.js";

export const CHARACTER_RULES = Object.freeze({
  controlLocked(ship) {
    return !ship.isControlImmune() && (ship.hasEffect("stunnedUntil") || isHaruhiHeroPowerControlLocked(ship)
      || Boolean(ship.bunnyStageExposure && isBunnyControlLocked(ship.bunnyStageExposure, ship.team.match.elapsed, bunnyStageEnabled(ship))));
  },
  silenced(ship) {
    return !ship.isControlImmune() && (ship.hasEffect("silencedUntil")
      || (ship.bunnyStageExposure?.phase === "speechless" && bunnyStageEnabled(ship)));
  },
  controlImmune(ship) {
    return ship.isKoizumiOrbActive();
  },
  damageImmune(ship) {
    return ship.isKoizumiOrbActive()
      || Boolean((ship.bunnyHaruhi || ship.bunnyCompanion)
        && isBunnyDamageImmune(ship.bunnyHaruhi || bunnyCompanionForm(ship), ship.team.match.elapsed, !ship.team.areSkillsDisabled()));
  },
  statWithBuffs(ship, statKey, baseValue) {
    let value = baseValue;

    if (ship.hasEffect("reliableUntil")) {
      if (statKey === "turnRate") {
        value *= 1.28;
      }
      if (statKey === "speed") {
        value *= 1.08;
      }
      if (statKey === "damage") {
        value *= 1.08;
      }
      if (statKey === "accel") {
        value *= 1.12;
      }
    }

    if (ship.hasEffect("bladeQueenUntil")) {
      if (statKey === "speed") {
        value *= CHARACTER_DEFS.asakura.subSkill.speedMultiplier;
      }
      if (statKey === "accel") {
        value *= CHARACTER_DEFS.asakura.subSkill.accelerationMultiplier;
      }
      if (statKey === "turnRate") {
        value *= CHARACTER_DEFS.asakura.subSkill.turnMultiplier;
      }
    }

    value *= ship.team.future1096StatMultiplier(statKey);
    value *= haruhiStatMultiplier(ship.team, statKey);

    if (ship.bunnyHaruhi) value *= bunnyStatMultiplier({ form: ship.bunnyHaruhi, enabled: !ship.team.areSkillsDisabled() }, statKey, ship.team.match.elapsed);
    if (ship.bunnyCompanion) value *= bunnyStatMultiplier({ form: bunnyCompanionForm(ship), enabled: !ship.team.areSkillsDisabled() }, statKey, ship.team.match.elapsed);
    if (ship.bunnyReliable) value *= bunnyStatMultiplier({ reliable: bunnyReliableState(ship), enabled: !ship.team.areSkillsDisabled() }, statKey, ship.team.match.elapsed);
    if (ship.bunnyStageExposure) value *= bunnyStatMultiplier({ stage: ship.bunnyStageExposure, enabled: bunnyStageEnabled(ship) }, statKey, ship.team.match.elapsed);

    return value;
  },
  effectiveSpeed(ship) {
    const speed = ship.team.fleetSpeedForShip(ship) * haruhiHeroPowerSpeedFactor(ship);
    return ship.bunnyStageExposure && !ship.isControlImmune()
      ? speed * bunnyStageSpeedFactor(ship.bunnyStageExposure, ship.team.match.elapsed, bunnyStageEnabled(ship)) : speed;
  },
  minimumFlightSpeed(ship) {
    // 刀锋下限取技能强化后的满能量航速，不使用能量、震慑或碰撞减速系数。
    if (!ship.hasEffect("bladeQueenUntil")) return 0;
    const meta = CHARACTER_DEFS.asakura.subSkill;
    // 舰队防御形态等属性减速也不能压低角色自身的刀锋巡航下限。
    return Math.max(ship.base.speed * meta.speedMultiplier, ship.baseSpeed()) * throttleForGear(meta.minimumGear);
  },
  damageTakenMultiplier(ship) {
    let value = 1;
    if (ship.hasEffect("reliableUntil")) {
      value *= 0.84;
    }
    value *= ship.team.future1096DamageTakenMultiplier();
    value *= haruhiDamageTakenMultiplier(ship.team);
    value *= haruhiHeroPowerDamageTakenMultiplier(ship);
    if (ship.bunnyHaruhi) value *= bunnyDamageTakenMultiplier(ship.bunnyHaruhi);
    if (ship.bunnyCompanion) value *= bunnyDamageTakenMultiplier(bunnyCompanionForm(ship));
    return value;
  },
  participatesInHullCollision(ship) {
    return !ship.forcedKnockback && !isKoizumiOrbActive(ship) && !ship.hasEffect("bladeQueenUntil");
  },
  collidesWithAttachedAllies: isBunnyCompanion,
  canDamage(source, target) {
    return !bunnyOwnerDamageBlocked(source, target);
  },
  preferredTargetId(team) {
    return team.shamisenHunt?.targetId;
  },
  // 攻击来源修正先于编队分摊；分摊投递不得再次调用。
  attackDamageMultiplier: shamisenHuntDamageMultiplier,
  broadcastShips(team) {
    const ships = haruhiBoostActive(team) ? team.getAllShips().filter((ship) => ship.alive) : [];
    if (team.match.bunnyHaruhiActive) {
      ships.push(...team.getPlayerShips().filter((ship) => bunnyBroadcastsShip(team, ship)));
    }
    return ships;
  },
});
