// 场景清理沿用正式的来源退场操作，不替换集合或修改数组长度。
export function discardScenarioProjectiles(match) {
  for (const sourceId of new Set(match.projectiles.map((projectile) => projectile.sourceId))) {
    match.discardProjectilesFrom(sourceId);
  }
}
