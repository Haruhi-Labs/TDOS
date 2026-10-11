import { cloneLoadout } from "../characters.js";
import { serializeHaruhiFlagship } from "../haruhi-flagship.js";
import { serializeKoizumiBarrier } from "../koizumi-barrier.js";
import { serializeShamisenHunt } from "../shamisen-hunt.js";
import { serializeRadarSweep } from "../visibility-radar.js";
import { serializeKoizumiImpactWaves } from "../koizumi-orb.js";

// 只消费领域读数；角色协议字段不再由 Team 的生命周期实现列举。
export function projectTeam(team) {
    return {
      seat: team.seat,
      name: team.name,
      color: team.color,
      splitLevel: team.splitLevel,
      loadout: team.match.bunnyHaruhiActive ? { ...team.loadout } : cloneLoadout(team.loadout),
      ...(team.ships.main.bunnyHaruhi ? { bunnyStage: team.bunnyStage ? { ...team.bunnyStage } : null } : {}),
      energy: team.fleetEnergyForShip("main").current,
      maxEnergy: team.fleetEnergyForShip("main").max,
      hullRatio: team.hullRatio(),
      future1096Form: team.future1096Form,
      haruhiFlagship: serializeHaruhiFlagship(team),
      koizumiBarrier: serializeKoizumiBarrier(team),
      shamisenHunt: serializeShamisenHunt(team),
      skillsDisabled: team.areSkillsDisabled(),
      autoScout: {
        enabled: team.autoScout.enabled,
        zoneId: team.autoScout.zoneId,
      },
      cooldowns: {
        scout: team.cooldowns.scout,
        flagship: team.cooldowns.flagship,
        sub1: team.cooldowns.sub1,
        sub2: team.cooldowns.sub2,
      },
      visibleEnemyIds: Array.from(team.visibleEnemyIds),
      radarSweep: serializeRadarSweep(team),
      visionWaves: team.serializeVisionWaves(),
      koizumiImpactWaves: serializeKoizumiImpactWaves(team),
      ships: {
        main: team.ships.main.serialize(),
        sub1: team.ships.sub1.serialize(),
        sub2: team.ships.sub2.serialize(),
      },
      extraShips: team.extraShips.map((ship) => ship.serialize()),
      scouts: team.scouts.filter((item) => item.alive).map((item) => item.serialize()),
      wingmen: team.wingmen.filter((item) => item.alive).map((item) => item.serialize()),
      beams: team.serializeBeams(),
    };
}
