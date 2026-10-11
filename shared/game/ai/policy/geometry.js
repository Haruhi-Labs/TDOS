// 几何计算只消费显式地图数据，不读取策略或观测上下文。
import { fireArcDensityMultiplier } from "../../combat-rules.js";
import { clamp, shortestAngleDelta, zoneContains } from "../../math.js";
export function zoneById(zones, zoneId) {
const safeId = clamp(Number(zoneId) || 5, 1, 9);
return zones.find((zone) => zone.id === safeId) || zones[4];
}
export function clampPosition(size, value, padding = 0) { return clamp(value, padding, size - padding); }

export function zoneForPoint(zones, x, y) {
  return zones.find((zone) => zoneContains(zone, x, y)) || zones[4];
}

export function zoneCenter(zones, zoneId) {
  const zone = zoneById(zones, zoneId);
  return {
    zoneId: zone.id,
    x: zone.x + zone.width * 0.5,
    y: zone.y + zone.height * 0.5,
  };
}

export function safeRoutePadding(worldSize, extra = 0) {
  return clamp(worldSize * 0.08, 90, 145) + extra;
}

export function edgePressure(worldSize, ship) {
  if (!ship) {
    return 0;
  }
  const margin = clamp(worldSize * 0.12, 120, 190);
  const edgeDistance = Math.min(ship.x, ship.y, worldSize - ship.x, worldSize - ship.y);
  if (edgeDistance >= margin) {
    return 0;
  }
  return clamp(1 - edgeDistance / margin, 0, 1);
}

export function stableNoise(seed, salt = 0) {
  const value = Math.sin(seed * 12.9898 + salt * 78.233 + 0.9157) * 43758.5453;
  return value - Math.floor(value);
}

export function pointEdgeClearance(worldSize, x, y) {
  const size = worldSize;
  return Math.min(x, y, size - x, size - y);
}

export function arcDensityFromState(facingAngle, fromX, fromY, toX, toY, uniformOutput = false) {
  const bearing = Math.atan2(toY - fromY, toX - fromX);
  return fireArcDensityMultiplier(Math.abs(shortestAngleDelta(facingAngle, bearing)), uniformOutput);
}

export function broadsideIntentAngle(fromX, fromY, targetX, targetY, sign = 1) {
  const bearing = Math.atan2(targetY - fromY, targetX - fromX);
  return bearing - sign * Math.PI * 0.5;
}
