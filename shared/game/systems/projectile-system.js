// 通用弹体阶段只规定消费顺序；防御规则和实体推进由权威装配端口执行。
export function advanceProjectiles(projectiles, dt, phase) {
  for (const projectile of projectiles) {
    if (!phase.intercept(projectile, dt)) phase.advance(projectile, dt);
  }
  return projectiles.filter((projectile) => projectile.alive);
}
