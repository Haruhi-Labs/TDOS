import { isKoizumiOrbActive, isKoizumiOrbReturning } from "../../koizumi-orb.js";
import { initializeKoizumiOrb, dispelKoizumiOrb, updateKoizumiOrb, initializeKoizumiImpactWaves, resolveKoizumiOrbContacts, updateKoizumiImpactWaves, serializeKoizumiOrb, serializeKoizumiImpactWaves } from "../../koizumi-orb.js";
import { initializeKoizumiBarrier, resolveKoizumiBarrierRamContacts, serializeKoizumiBarrier } from "../../koizumi-barrier.js";
export default {
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
