import { distanceSq } from "../math.js";

// 按现有实体顺序采样；调用方持有并更新可见集合。
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
