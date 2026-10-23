import { cloneLoadout } from "../characters/catalog.js";
import { CHARACTER_EXTENSIONS } from "../characters/assembly/registry.js";
import { projectExtensions } from "../characters/assembly/extension-contract.js";
import { orderedProjection, TEAM_WIRE_FIELDS } from "./projection-order.js";

// 只消费领域读数；角色协议字段不再由 Team 的生命周期实现列举。
export function projectTeam(team) {
    return orderedProjection({
      seat: team.seat,
      name: team.name,
      color: team.color,
      splitLevel: team.splitLevel,
      loadout: team.match.bunnyHaruhiActive ? { ...team.loadout } : cloneLoadout(team.loadout),
      energy: team.fleetEnergyForShip("main").current,
      maxEnergy: team.fleetEnergyForShip("main").max,
      hullRatio: team.hullRatio(),
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
      ships: {
        main: team.ships.main.serialize(),
        sub1: team.ships.sub1.serialize(),
        sub2: team.ships.sub2.serialize(),
      },
      extraShips: team.extraShips.map((ship) => ship.serialize()),
      scouts: team.scouts.filter((item) => item.alive).map((item) => item.serialize()),
      wingmen: team.wingmen.filter((item) => item.alive).map((item) => item.serialize()),
      beams: team.serializeBeams(),
    }, projectExtensions(CHARACTER_EXTENSIONS, "projectTeam", team), TEAM_WIRE_FIELDS);
}
