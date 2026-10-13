import { RadarRuntime } from "./radar-runtime.js";

// 此表只负责实体与运行时的绑定，扫描状态只由 RadarRuntime 持有。
const radars = new WeakMap();

function radarSource(team) {
  const source = team.ships.main;
  return team.hasYukiFlagship() && source?.alive ? source : null;
}

export function initializeRadar(team, facing) {
  if (!radars.has(team)) radars.set(team, new RadarRuntime(facing));
}

export function updateRadarPassive(team, enemyTeam, dt) {
  const radar = radars.get(team);
  if (!radar) return;
  const source = radarSource(team);
  const targets = source ? enemyTeam.getAllShips() : [];
  const revealedIds = radar.advance({
    source: source ? { x: source.x, y: source.y } : null,
    targets: targets.map((target) => ({
      id: target.id, x: target.x, y: target.y, angle: target.angle,
      alive: target.alive, characterId: target.characterId,
      visible: team.visibleEnemyIds.has(target.id),
    })),
    now: team.match.elapsed, tick: team.match.tick, worldSize: team.match.worldSize,
  }, dt);
  // 名称识别只改标志，不参与后续目标的扫描计算；仍在本方雷达阶段内同步消费。
  const targetById = new Map(targets.map((target) => [target.id, target]));
  for (const id of revealedIds) targetById.get(id).revealName();
}

export function serializeRadarSweep(team) {
  return radars.get(team)?.sweep(radarSource(team)?.id ?? null, team.match.elapsed) ?? null;
}

export function serializeRadarPassive(team) {
  return radars.get(team)?.snapshot(radarSource(team)?.id ?? null, team.match.elapsed) ?? null;
}
