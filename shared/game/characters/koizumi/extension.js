import { CHARACTER_DEFS } from "../catalog.js";
import { isKoizumiOrbActive, isKoizumiOrbReturning } from "./orb.js";
import { initializeKoizumiOrb, dispelKoizumiOrb, updateKoizumiOrb, initializeKoizumiImpactWaves, resolveKoizumiOrbContacts, updateKoizumiImpactWaves, serializeKoizumiOrb, serializeKoizumiImpactWaves } from "./orb.js";
import { initializeKoizumiBarrier, resolveKoizumiBarrierRamContacts, serializeKoizumiBarrier } from "./barrier.js";
export default {
  statusEffects: [
    [50, (ship, { timed, add }) => {
    if (ship.koizumiOrb) {
      if (ship.koizumiOrb.phase === "active") timed("esper_orb", ship.koizumiOrb.activeUntil, CHARACTER_DEFS.koizumi.subSkill.duration);
      else add("esper_return");
    }
    }],
    [150, (ship, { add }) => {
    const team = ship.team;
    if (ship.key === "main" && team.mainCharacterId() === "koizumi") {
      const barrier = serializeKoizumiBarrier(team);
      if (barrier.active) add("barrier", null, null, { stacks: barrier.remainingHits, required: barrier.maxHits });
    }
    }]
  ],
  activeSkills: {
    sub: (port, meta) => port.activateOrb(meta.duration || 8),
  },
  queries: {
    barrierRamProfile: [[10, (source) => isKoizumiOrbActive(source) ? { ramKind: "koizumi_orb", extraRadius: source.radius } : null]],
    hullCollision: [[10, (ship) => !isKoizumiOrbActive(ship)]],
  },
  rules: {
    navigationAvailable(ship) {
      return !isKoizumiOrbReturning(ship);
    },
    weaponAvailable(ship) {
      return !isKoizumiOrbActive(ship);
    },
    orbActive: isKoizumiOrbActive,
  },
  id: "koizumi",
  ship: { hooks: {
    initialize: [[10, initializeKoizumiOrb]], advanceMovement: [[10, updateKoizumiOrb]],
    clearPositive: [[40, (ship, preserve) => {
      if (!ship.canClearActiveSkillEffect("koizumiOrb", preserve) || !dispelKoizumiOrb(ship)) return false;
      ship.forgetActiveSkillEffect("koizumiOrb"); return true;
    }]],
  } },
  createTeam(team) { initializeKoizumiBarrier(team); return { hooks: { initializeMembers: [[30, () => initializeKoizumiImpactWaves(team)]] } }; },
  createBattle: (match) => ({ operations: {
    barrierRam: { phases: { afterTeams: 20 }, run: () => resolveKoizumiBarrierRamContacts(match) },
    orbContacts: { phases: { afterTeams: 30 }, run: () => resolveKoizumiOrbContacts(match) },
    impactWaves: { phases: { afterTeams: 40 }, run: () => updateKoizumiImpactWaves(match) },
  } }),
  projectShip: (ship) => ({ koizumiOrb: serializeKoizumiOrb(ship) }),
  projectTeam: (team) => ({ koizumiBarrier: serializeKoizumiBarrier(team), koizumiImpactWaves: serializeKoizumiImpactWaves(team) }),
};
