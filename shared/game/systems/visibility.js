import { distanceSq } from "../math.js";

// 按现有实体顺序采样；可见集合只由感知组件替换，读方没有集合写权限。
export function collectVisibleEntityIds({ sensors, entities, coveredByWave, broadcast }) {
  const visible = new Set();
  for (const entity of entities) {
    for (const sensor of sensors) {
      if (distanceSq(entity.x, entity.y, sensor.x, sensor.y) <= sensor.range * sensor.range) {
        visible.add(entity.id);
        break;
      }
    }
    if (!visible.has(entity.id) && coveredByWave(entity)) visible.add(entity.id);
  }
  for (const entity of broadcast) visible.add(entity.id);
  return visible;
}

export class FleetPerception {
  #view = this.#readView(new Set());
  #readView(ids) {
    // 每次发布绑定本次采样，历史视图不会随下一帧改变。
    return Object.freeze({
      size: ids.size,
      has: (id) => ids.has(id),
      values: () => ids.values(),
      [Symbol.iterator]: () => ids.values(),
    });
  }
  get visibleIds() { return this.#view; }
  sample(input) { this.#view = this.#readView(collectVisibleEntityIds(input)); }
}
