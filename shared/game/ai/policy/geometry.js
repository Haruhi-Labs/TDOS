// 战区、边界与射界的几何工具，以及确定性噪声。
// 这些方法安装在 RulePolicy 的原型上，经 this 访问观测、参数、随机流与策略状态。
import { fireArcDensityMultiplier } from "../../combat-rules.js";
import { clamp, shortestAngleDelta, zoneContains } from "../../math.js";

export const geometryMethods = {
  zoneForPoint(x, y) {
    return this.obs.world.zones.find((zone) => zoneContains(zone, x, y)) || this.obs.world.zones[4];
  },

  zoneCenter(zoneId) {
    const zone = this.zoneById(zoneId);
    return {
      zoneId: zone.id,
      x: zone.x + zone.width * 0.5,
      y: zone.y + zone.height * 0.5,
    };
  },

  safeRoutePadding(extra = 0) {
    return clamp(this.obs.world.size * 0.08, 90, 145) + extra;
  },

  edgePressure(ship) {
    if (!ship) {
      return 0;
    }
    const worldSize = this.obs.world.size;
    const margin = clamp(worldSize * 0.12, 120, 190);
    const edgeDistance = Math.min(ship.x, ship.y, worldSize - ship.x, worldSize - ship.y);
    if (edgeDistance >= margin) {
      return 0;
    }
    return clamp(1 - edgeDistance / margin, 0, 1);
  },

  stableNoise(seed, salt = 0) {
    const value = Math.sin(seed * 12.9898 + salt * 78.233 + 0.9157) * 43758.5453;
    return value - Math.floor(value);
  },

  pointEdgeClearance(x, y) {
    const size = this.obs.world.size;
    return Math.min(x, y, size - x, size - y);
  },

  arcDensityFromState(facingAngle, fromX, fromY, toX, toY, uniformOutput = false) {
    const bearing = Math.atan2(toY - fromY, toX - fromX);
    return fireArcDensityMultiplier(Math.abs(shortestAngleDelta(facingAngle, bearing)), uniformOutput);
  },

  broadsideIntentAngle(fromX, fromY, targetX, targetY, sign = 1) {
    const bearing = Math.atan2(targetY - fromY, targetX - fromX);
    return bearing - sign * Math.PI * 0.5;
  },
};
