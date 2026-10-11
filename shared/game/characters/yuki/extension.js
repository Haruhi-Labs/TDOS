import { YUKI_COMBAT_SCOUT_STATS, YUKI_COMBAT_SCOUT_LAUNCH_COUNT } from "../../model/model-support.js";
import { initializeRadar, updateRadarPassive, serializeRadarSweep } from "../../adapters/visibility-radar.js";
export default {
  activeSkills: {
    sub: (port) => { port.launchBurstScouts(); return true; },
  },
  rules: {
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
    effectiveVision(ship) {
      let value = ship.statWithBuffs("vision", ship.base.vision);
      if (ship.characterId === "yuki" && !ship.isAttached()) value += 24;
      return value;
    },
  },
  id: "yuki",
  createTeam: (team, facing) => ({ hooks: { initializeMembers: [[10, () => initializeRadar(team, facing)]] } }),
  createBattle: (match) => ({ operations: { radar: { phases: { beforeBeams: 10 }, run: (dt) => { updateRadarPassive(match.teamA, match.teamB, dt); updateRadarPassive(match.teamB, match.teamA, dt); } } } }),
  projectTeam: (team) => ({ radarSweep: serializeRadarSweep(team) }),
};
