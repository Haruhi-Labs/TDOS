// 仅测试使用：以隔离的传感器/敌方输入建立可见集，不能直接注入或修改组件结果。
export function sampleVisibility(team, ids) {
  const selected = new Set(ids);
  const enemy = team.match.enemyTeamBySeat(team.seat);
  const entities = enemy.getEntities().filter((entity) => selected.has(entity.id));
  const sensors = team.getVisionSources;
  const getEntities = enemy.getEntities;
  try {
    team.getVisionSources = () => entities.map((entity) => ({ x: entity.x, y: entity.y, range: 0 }));
    enemy.getEntities = () => entities;
    team.computeVisibility(enemy);
  } finally {
    team.getVisionSources = sensors;
    enemy.getEntities = getEntities;
  }
}
