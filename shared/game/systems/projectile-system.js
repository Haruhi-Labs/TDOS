// 弹体集合、遍历和发布归同一所有者；角色只提供当轮拦截、推进及收尾能力。
export class ProjectileSystem {
  #create;
  #items = [];
  #view;

  constructor(create) { this.#create = create; }

  get items() {
    return this.#view ??= Object.freeze([...this.#items]);
  }

  spawn(profile) {
    const projectile = this.#create(profile);
    this.#items.push(projectile);
    this.#view = undefined;
    return projectile;
  }

  discardFrom(sourceId) {
    for (const projectile of this.#items) {
      if (projectile.sourceId === sourceId) projectile.discard();
    }
    this.#items = this.#items.filter((projectile) => projectile.alive);
    this.#view = undefined;
  }

  advance(dt, phase) {
    // 捕获本轮活数组：普通追加仍在本轮消费。若来源清理另行发布集合，
    // 当前遍历继续原数组，最终仍按它筛选；不能擅自改成帧末队列或合并新集合。
    const active = this.#items;
    for (const projectile of active) {
      if (!phase.intercept(projectile, dt)) phase.advance(projectile, dt);
    }
    this.#items = active.filter((projectile) => projectile.alive);
    this.#view = undefined;
    phase.finish();
  }
}
