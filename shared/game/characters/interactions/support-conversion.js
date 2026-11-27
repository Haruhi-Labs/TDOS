import { zoneContains } from "../../foundation/math.js";
import { convertBunnyCompanion } from "../bunny-haruhi/companion-runtime.js";
import { refreshBunnyVisibility } from "../bunny-haruhi/form-port.js";

// 鹤屋效果的同步事务：先跨全部敌对舰队按稳定顺序收集并去重候选，再逐一调用原转移事务；舰队只维护成员归属。
export function convertZoneSupport(ship, zoneId) {
  const team = ship.team;
  const zone = team.match.zoneById(zoneId);
  const enemyTeams = team.match.enemyTeamsOf(team.seat);
  const seen = new Set();
  const scouts = [];
  const wingmen = [];
  const companions = [];

  for (const enemyTeam of enemyTeams) {
    for (const scout of enemyTeam.scouts) {
      if (scout.alive && zoneContains(zone, scout.x, scout.y) && !seen.has(scout)) {
        seen.add(scout);
        scouts.push(scout);
      }
    }
    for (const wingman of enemyTeam.wingmen) {
      if (wingman.alive && zoneContains(zone, wingman.x, wingman.y) && !seen.has(wingman)) {
        seen.add(wingman);
        wingmen.push(wingman);
      }
    }
    // 使用固定收集快照，避免原地转移遗漏实体；普通飞行器保留原永久策反语义。
    for (const companion of enemyTeam.extraShips) {
      if (companion.alive && zoneContains(zone, companion.x, companion.y) && !seen.has(companion)) {
        seen.add(companion);
        companions.push(companion);
      }
    }
  }

  let converted = 0;
  for (const scout of scouts) {
    if (scout.transferToTeam(team, zone)) converted += 1;
  }
  for (const wingman of wingmen) {
    if (wingman.transferToTeam(team, zone)) converted += 1;
  }
  for (const companion of companions) {
    if (convertBunnyCompanion(companion, team, zone)) converted += 1;
  }
  if (team.match.bunnyHaruhiActive && converted > 0) refreshBunnyVisibility(team.match);

  if (converted > 0) {
    team.match.spawnFloatingTextKey(ship.x + 10, ship.y - 14, "钞能力 x{count}", { count: converted }, "#ffd27e", `钞能力 x${converted}`);
  }
  return converted > 0;
}
