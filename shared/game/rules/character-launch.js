import { Scout } from "../model/scout.js";
import { rngFor } from "../rng.js";
import { zoneContains } from "../math.js";
const TAU = Math.PI * 2;

// 角色层决定技能机群和随机支援的生成规则；成员归属仍交给舰队校验。
export function launchBurstScouts(team, ship) {
  const directions = 8;
  for (let i = 0; i < directions; i += 1) {
    const angle = (TAU / directions) * i;
    for (const offset of [-0.07, 0.07]) {
      const targetAngle = angle + offset;
      const anchor = {
        x: team.match.clampX(ship.x + Math.cos(targetAngle) * 230, 22),
        y: team.match.clampY(ship.y + Math.sin(targetAngle) * 230, 22),
      };
      team.addScout(
        new Scout(team, ship.x, ship.y, {
          pattern: "burst",
          anchor,
          anchorRadius: 18,
          speed: 118,
          vision: 82,
          life: 10.5,
          radius: 3,
        }),
      );
    }
  }
}

export function launchHaruhiAlienWingmen(team, ship) {
  const zone = team.match.zones.find((zone) => zoneContains(zone, ship.x, ship.y)) || team.match.zones[4];
  const releaseAngle = rngFor(team.match).range(0, TAU);
  const spawnRadius = ship.radius + 12;
  const x = team.match.clampX(ship.x + Math.cos(releaseAngle) * spawnRadius, 8);
  const y = team.match.clampY(ship.y + Math.sin(releaseAngle) * spawnRadius, 8);
  team.addScout(new Scout(team, x, y, { zone, combatCapable: true }));
  team.match.spawnBurst(x, y, "#8fe8ff", 5);
}

export function launchHaruhiRandomBeam(team, ship) {
  const angle = rngFor(team.match).range(0, TAU);
  return team.queueBeamDirection(ship, Math.cos(angle), Math.sin(angle));
}
