import { zoneContains } from "../../foundation/math.js";
import { convertBunnyCompanion } from "../bunny-haruhi/companion-runtime.js";
import { refreshBunnyVisibility } from "../bunny-haruhi/form-port.js";

// 鹤屋效果的同步事务：按原集合顺序转移，完成后刷新广播与表现；舰队只维护成员归属。
export function convertZoneSupport(ship, zoneId) {
  const team = ship.team;
  const zone = team.match.zoneById(zoneId);
  const enemyTeam = team.match.enemyTeamBySeat(team.seat);
  let converted = 0;

  for (const scout of [...enemyTeam.scouts]) {
    if (!scout.alive || !zoneContains(zone, scout.x, scout.y)) {
      continue;
    }
    if (scout.transferToTeam(team, zone)) converted += 1;
  }

  for (const wingman of [...enemyTeam.wingmen]) {
    if (!wingman.alive || !zoneContains(zone, wingman.x, wingman.y)) {
      continue;
    }
    if (wingman.transferToTeam(team, zone)) converted += 1;
  }

  // 使用固定集合，避免原地转移遗漏实体；普通飞行器保留原永久策反语义。
  for (const companion of [...enemyTeam.extraShips]) {
    if (companion.alive && zoneContains(zone, companion.x, companion.y)
      && convertBunnyCompanion(companion, team, zone)) converted += 1;
  }
  if (team.match.bunnyHaruhiActive && converted > 0) refreshBunnyVisibility(team.match);

  if (converted > 0) {
    team.match.spawnFloatingTextKey(ship.x + 10, ship.y - 14, "钞能力 x{count}", { count: converted }, "#ffd27e", `钞能力 x${converted}`);
  }
  return converted > 0;
}
