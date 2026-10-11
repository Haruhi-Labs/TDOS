import { convertZoneSupport } from "./support-conversion.js";
import { skillMetaForCharacter } from "../characters.js";
import { activateKoizumiOrb } from "../koizumi-orb.js";
import { activateVisionWaveSkill } from "../vision-wave.js";
import { executeFlagshipEffect, executeSubEffect } from "./active-skills.js";

export function createTeamSkillPort(team, flagship) {
  function subEffects(ship, options) {
    return {
      emitHeroPower: (meta) => team.match.queueHeroPower(ship, meta),
      activateOrb: (duration) => {
        const ok = activateKoizumiOrb(ship, duration);
        if (ok) ship.markActiveSkillEffectStarted("koizumiOrb");
        return ok;
      },
      launchBurstScouts: () => team.launchBurstScouts(ship),
      castBeam: () => team.castBeamFromShip(ship.key, options.targetX, options.targetY),
      refundEnergy: (amount) => ship.restoreEnergy(amount),
      activateEffect: (key, duration) => ship.activateTimedEffect(key, duration),
      restoreHullFraction: (fraction) => ship.restoreHull(ship.maxHp * fraction),
      bribeZone: () => convertZoneSupport(ship, Number(options.zoneId) || 5),
      ensureMinimumSpeed: () => ship.setFlightSpeed(Math.max(ship.speed, ship.minimumFlightSpeed())),
    };
  }
  return Object.freeze({
    flagshipAvailable: () => team.match.rules.flagshipSkillAvailable(team),
    metadata: (key, mode) => skillMetaForCharacter(team.ships[key].characterId, mode),
    caster: (key) => {
      const ship = team.ships[key];
      return ship && Object.freeze({
        get alive() { return ship.alive; },
        canControl: () => ship.canControl(), isSilenced: () => ship.isSilenced(),
        isAttached: () => ship.isAttached(),
        exclusiveMovement: () => team.match.rules.orbActive(ship),
      });
    },
    disabled: () => team.areSkillsDisabled(),
    exclusive: (key) => team.match.shipEffects.castExclusiveSubSkill(team.ships[key]),
    spendEnergy: (key, cost) => team.spendEnergyForShip(team.ships[key], cost),
    executeFlagship: (meta) => executeFlagshipEffect(team.loadout.main, {
      spendEnergy: (cost) => team.spendEnergyForShip("main", cost),
      switchForm: () => team.switchFuture1096Form(),
      activateVisionWave: (options) => activateVisionWaveSkill(team, options),
      ...flagship,
    }, meta),
    executeSub: (key, options, meta) => executeSubEffect(team.ships[key].characterId, subEffects(team.ships[key], options), meta),
    refreshVisibility: () => {
      team.match.teamA.computeVisibility(team.match.teamB);
      team.match.teamB.computeVisibility(team.match.teamA);
    },
    record: (action) => team.match.recordAction(team.seat, action),
    reveal: (key) => {
      const ship = team.ships[key];
      if (!ship || ship.nameRevealed) return;
      const enemy = team.match.enemyTeamBySeat(team.seat);
      if (enemy?.visibleEnemyIds?.has(ship.id)) ship.revealName();
    },
  });
}
