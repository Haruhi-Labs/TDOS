import { visionWavesCoverEntity } from "../characters/asakura/vision-wave.js";

// 实体集合支持敌对集合视图或单个敌对 Team；
// 广播处理器依赖真实 Team（读取 team.match / getPlayerShips），按 enemyTeamsOf(team.seat) 逐队拼接，不向广播处理器传入视图。
export function visibilityInputs(team, enemyTeam) {
  const enemyTeams = team.match.enemyTeamsOf(team.seat);
  const broadcast = enemyTeams.length === 0
    ? []
    : (enemyTeams.length === 1
      ? team.match.rules.broadcastShips(enemyTeams[0])
      : enemyTeams.flatMap((enemy) => team.match.rules.broadcastShips(enemy)));
  return {
    sensors: team.getVisionSources(),
    entities: enemyTeam.getEntities(),
    coveredByWave: (entity) => visionWavesCoverEntity(team, entity),
    broadcast,
  };
}
