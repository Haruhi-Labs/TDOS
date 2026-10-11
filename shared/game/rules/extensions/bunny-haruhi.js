import { bunnyBroadcastsShip } from "../../bunny-haruhi-runtime.js";
import { bunnyEnergyRate, isBunnyEncoreLocked, canBunnyLaunchScout } from "../../bunny-haruhi.js";
import { bunnyOwnerDamageBlocked, isBunnyCompanion, countsForVictory, isFleetParticipant } from "../../bunny-haruhi-companion.js";
import { energyRateForThrottle } from "../../throttle.js";
import { bunnyStageEnabled } from "../bunny-stage-port.js";
import { initializeBunnyShip, purgeBunnyShipForm, commitBunnyTransform, updateBunnyTeamSupports, refreshBunnyVisibility } from "../../bunny-haruhi-runtime.js";
import { initializeBunnyStageReceiver, cleanseBunnyShipControl, initializeBunnyBattle, resolveBunnyStages, advanceBunnyRules, cleanupBunnySources } from "../bunny-stage-port.js";
import { initializeBunnyReliableReceiver, purgeBunnyReliableEffect, prepareBunnyCompanions, cleanupBunnyCompanions, serializeBunnyCompanion } from "../../bunny-companion-runtime.js";
import { resolveBunnyOtherworlderContacts } from "../../character-contacts.js";
import { serializeBunnyShip } from "../bunny-projection.js";
export default {
  queries: {
    broadcast: [[20, (team) => team.match.bunnyHaruhiActive ? team.getPlayerShips().filter((ship) => bunnyBroadcastsShip(team, ship)) : []]],
  },
  rules: {
    scoutOrderAvailable(ship) {
      return !isBunnyCompanion(ship);
    },
    scoutLaunchAvailable(ship) {
      return canBunnyLaunchScout(ship.bunnyHaruhi);
    },
    flagshipSkillAvailable(team) {
      return !team.ships.main.bunnyHaruhi;
    },
    countsForVictory,
    isFleetParticipant,
    depletedEnergySpeedFactor(ship) {
      return ship.team.availableEnergyForShip(ship) <= 0
        && !isBunnyEncoreLocked(ship.bunnyHaruhi, ship.team.match.elapsed, !ship.team.areSkillsDisabled()) ? 0.15 : 1;
    },
    energyRate(ship, throttle) {
      return ship.bunnyStageExposure
        ? bunnyEnergyRate(ship.bunnyStageExposure, ship.baseEnergyRegen(), ship.moveEnergyDrain(), throttle, bunnyStageEnabled(ship))
        : energyRateForThrottle(ship.baseEnergyRegen(), ship.moveEnergyDrain(), throttle);
    },
    collidesWithAttachedAllies: isBunnyCompanion,
    canDamage(source, target) {
      return !bunnyOwnerDamageBlocked(source, target);
    },
  },
  id: "bunny_haruhi",
  ship: { hooks: {
    initialize: [[40, initializeBunnyReliableReceiver], [45, initializeBunnyStageReceiver], [50, (ship, capabilities) => initializeBunnyShip(ship, capabilities?.createShip)]],
    clearControl: [[20, cleanseBunnyShipControl]],
    clearPositive: [[10, (ship, preserve) => purgeBunnyReliableEffect(ship, preserve ? ship.team.match.tick : -1)], [20, (ship, preserve) => purgeBunnyShipForm(ship, preserve ? ship.team.match.tick : -1)]],
    hasNegative: [[20, (ship) => (ship.bunnyStageExposure?.recoveryUntil || 0) > ship.team.match.elapsed]],
    castExclusiveSubSkill: [[10, (ship) => ship?.bunnyHaruhi ? commitBunnyTransform(ship) : null]],
  } },
  createTeam: (team) => ({ hooks: { afterMovement: [[20, (dt) => { if (team.match.bunnyHaruhiActive) updateBunnyTeamSupports(team, dt); }]] } }),
  createBattle(match) {
    const run = (fn) => () => { if (match.bunnyHaruhiActive) fn(match); };
    return {
      initialize: [[10, () => { if (initializeBunnyBattle(match)) { resolveBunnyStages(match); refreshBunnyVisibility(match); } }]],
      operations: {
        sustain: { phases: { beforeAi: 10 }, run: run(advanceBunnyRules) },
        companions: { phases: { beforeAi: 20 }, run: run(prepareBunnyCompanions) },
        bunnyRam: { phases: { afterTeams: 60 }, run: run(resolveBunnyOtherworlderContacts) },
        stages: { phases: { beforeVisibility: 10 }, run: run(resolveBunnyStages) },
        sourceCleanup: { phases: { beforeVisibility: 30, afterVisuals: 20 }, run: run(cleanupBunnySources) },
        companionCleanup: { phases: { afterVisuals: 10 }, run: run(cleanupBunnyCompanions) },
        stageVisibility: { phases: { afterVisuals: 30 }, run: run(refreshBunnyVisibility) },
      },
    };
  },
  projectShip: (ship) => ({
    ...(ship.bunnyHaruhi || ship.bunnyStageExposure ? serializeBunnyShip(ship) : {}),
    ...(ship.bunnyCompanion ? serializeBunnyCompanion(ship) : {}),
    ...(ship.bunnyReliable ? { bunnyReliable: { sourceCompanionId: ship.bunnyReliable.sourceCompanionId, remaining: Math.max(0, ship.bunnyReliable.until - ship.team.match.elapsed), suppressed: ship.bunnyReliable.suppressed } } : {}),
  }),
  projectTeam: (team) => team.ships.main.bunnyHaruhi ? { bunnyStage: team.bunnyStage ? { ...team.bunnyStage } : null } : {},
};
