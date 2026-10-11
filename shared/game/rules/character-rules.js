import { sampleAttributeFacts, sampleControlFacts, sampleImmunityFacts, sampleDamageFacts } from "./attribute-facts.js";
import { evaluateAttribute, evaluateControl, evaluateDamageImmunity, evaluateDamageTaken, evaluateFlightSpeed, evaluateMinimumSpeed } from "./attribute-evaluation.js";
// 角色能力适配层：集中解释角色状态，只返回规则结果，不写入实体。
// 对局将此契约注入通用系统，让通用系统无需导入具体角色模块。
import { energyRateForThrottle } from "../throttle.js";
import { isKoizumiOrbActive, isKoizumiOrbReturning } from "../koizumi-orb.js";
import { haruhiOtherworlderReady, haruhiBoostActive } from "../haruhi-flagship.js";
import { bunnyEnergyRate, isBunnyEncoreLocked, canBunnyLaunchScout } from "../bunny-haruhi.js";
import { bunnyStageEnabled, bunnyBroadcastsShip } from "../bunny-haruhi-runtime.js";
import { bunnyOwnerDamageBlocked, isBunnyCompanion, countsForVictory, isFleetParticipant } from "../bunny-haruhi-companion.js";
import { shamisenHuntDamageMultiplier } from "../shamisen-hunt.js";

import { SOLO_FIRE_RATE_BONUS, YUKI_COMBAT_SCOUT_STATS, YUKI_COMBAT_SCOUT_LAUNCH_COUNT } from "../model/model-support.js";

import { activeClawMarks } from "../shamisen-claw.js";

import { bunnyHaruhiSupportSource } from "../bunny-haruhi-support.js";
import { supportOtherworlderReady } from "../haruhi-support.js";
import { haruhiOtherworlderAuraForwardReach, haruhiRamApproachEligible } from "../contact-geometry.js";

export const CHARACTER_RULES = Object.freeze({
  activeClawMarks,
  barrierRamProfile(source, attackerTeam, defendingMain) {
    if (isKoizumiOrbActive(source)) return { ramKind: "koizumi_orb", extraRadius: source.radius };
    if (source.hasEffect?.("bladeQueenUntil")) return { ramKind: "blade_queen", extraRadius: source.radius };
    const bunny = source.bunnyHaruhi ? bunnyHaruhiSupportSource(source, !attackerTeam.areSkillsDisabled()) : null;
    const ready = bunny ? supportOtherworlderReady(bunny, attackerTeam.match.elapsed)
      : source === attackerTeam.ships.main && haruhiOtherworlderReady(attackerTeam);
    if (!ready || !haruhiRamApproachEligible(source, defendingMain.x, defendingMain.y)) return null;
    return { ramKind: "haruhi_otherworlder", bow: true, bowOffset: haruhiOtherworlderAuraForwardReach(source), extraRadius: 5 };
  },
  scoutProfile(team, config, pattern) {
    const combatCapable = config.combatCapable ?? team.hasYukiFlagship();
    const vision = combatCapable ? YUKI_COMBAT_SCOUT_STATS.vision : config.vision || (pattern === "burst" ? 86 : 95);
    return {
      combatCapable, vision, attackRange: combatCapable ? vision : 0,
      damage: combatCapable ? YUKI_COMBAT_SCOUT_STATS.damage : 0,
      fireRate: combatCapable ? YUKI_COMBAT_SCOUT_STATS.fireRate : 0,
    };
  },
  scoutLaunchCount(team) {
    return team.hasYukiFlagship() ? YUKI_COMBAT_SCOUT_LAUNCH_COUNT : 1;
  },
  scoutOrderAvailable(ship) {
    return !isBunnyCompanion(ship);
  },
  scoutLaunchAvailable(ship) {
    return canBunnyLaunchScout(ship.bunnyHaruhi);
  },
  flagshipSkillAvailable(team) {
    return !team.ships.main.bunnyHaruhi;
  },
  navigationAvailable(ship) {
    return !isKoizumiOrbReturning(ship);
  },
  weaponAvailable(ship) {
    return !isKoizumiOrbActive(ship);
  },
  orbActive: isKoizumiOrbActive,
  countsForVictory,
  isFleetParticipant,
  controlStopsFlight(ship) {
    return evaluateControl(sampleControlFacts(ship), ship.isControlImmune()).stopsFlight;
  },
  depletedEnergySpeedFactor(ship) {
    return ship.team.availableEnergyForShip(ship) <= 0
      && !isBunnyEncoreLocked(ship.bunnyHaruhi, ship.team.match.elapsed, !ship.team.areSkillsDisabled()) ? 0.15 : 1;
  },
  energyRate(ship, throttle) {
    return ship.bunnyStageExposure
      ? bunnyEnergyRate(ship.bunnyStageExposure, ship.baseEnergyRegen(), ship.moveEnergyDrain(), throttle, bunnyStageEnabled(ship))
      : energyRateForThrottle(ship.baseEnergyRegen(), ship.moveEnergyDrain(), throttle);
  },
  turnRateMultiplier(team, formation = false) {
    return team.hasKyonFlagship() ? (formation ? 1.2 : 1.28) : 1;
  },
  accelerationMultiplier(team) {
    return team.hasKyonFlagship() ? 1.16 : 1;
  },
  routeTurnRadiusMultiplier(team) {
    return team.hasKyonFlagship() ? 0.62 : 1;
  },
  routeDeviationMultiplier(team) {
    return team.hasKyonFlagship() ? 1.4 : 1;
  },
  improvedFireArcs(team) {
    return team.hasKyonFlagship();
  },
  effectiveVision(ship) {
    let value = ship.statWithBuffs("vision", ship.base.vision);
    if (ship.characterId === "yuki" && !ship.isAttached()) value += 24;
    return value;
  },
  effectiveFireRate(ship) {
    let value = ship.statWithBuffs("fireRate", ship.base.fireRate);
    if (ship.characterId === "shamisen" && ship.hasEffect("catPawUntil")) {
      value *= Math.max(0.01, Number(ship.character.subSkill.fireRateMultiplier) || 1);
    }
    if (!isBunnyCompanion(ship) && ship.team.fleetMemberCountForShip(ship) <= 1) value *= SOLO_FIRE_RATE_BONUS;
    return value;
  },
  projectileProfile(ship) {
    const meta = ship.characterId === "shamisen" && ship.hasEffect("catPawUntil") ? ship.character.subSkill : null;
    return {
      color: meta ? (ship.team.seat === "A" ? "#8fe8ff" : "#ff9eb8") : ship.team.projectileColor,
      visualKind: meta ? "cat_paw" : "shell",
      claw: meta ? { triggerHits: meta.triggerHits || 4, burstDamage: meta.burstDamage || 0, markDuration: meta.markDuration || 8 } : null,
    };
  },
  controlLocked(ship) {
    return evaluateControl(sampleControlFacts(ship), ship.isControlImmune()).locked;
  },
  silenced(ship) {
    return evaluateControl(sampleControlFacts(ship), ship.isControlImmune()).silenced;
  },
  controlImmune(ship) {
    return ship.isKoizumiOrbActive();
  },
  damageImmune(ship) {
    return evaluateDamageImmunity(sampleImmunityFacts(ship), ship.isKoizumiOrbActive());
  },
  statWithBuffs(ship, statKey, baseValue) {
    return evaluateAttribute(sampleAttributeFacts(ship), statKey, baseValue);
  },
  effectiveSpeed(ship) {
    const speeds = ship.team.fleetMembersForShip(ship).map((member) =>
      evaluateAttribute(sampleAttributeFacts(member), "speed", member.base.speed));
    return evaluateFlightSpeed(sampleControlFacts(ship), speeds, ship.isControlImmune());
  },
  minimumFlightSpeed(ship) {
    return evaluateMinimumSpeed(sampleAttributeFacts(ship));
  },
  damageTakenMultiplier(ship) {
    return evaluateDamageTaken(sampleDamageFacts(ship));
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
