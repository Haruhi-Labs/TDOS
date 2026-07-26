export const TERRAIN_MOVEMENT_MULTIPLIERS = Object.freeze({
  asteroid_belt: Object.freeze({
    speedMultiplier: 0.78,
    accelerationMultiplier: 0.85,
    turnMultiplier: 0.9,
  }),
  speed_lane: Object.freeze({
    forwardSpeedMultiplier: 1.3,
    forwardAccelerationMultiplier: 1.2,
    reverseSpeedMultiplier: 0.9,
    turnMultiplier: 1,
  }),
  gravity_mire: Object.freeze({
    speedMultiplier: 0.65,
    accelerationMultiplier: 1,
    turnMultiplier: 0.75,
  }),
});

const TERRAIN_HYSTERESIS_PX = 10;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function localPoint(point, region) {
  const angle = -(Number(region.angle) || 0);
  const dx = Number(point.x || 0) - Number(region.center?.x || 0);
  const dy = Number(point.y || 0) - Number(region.center?.y || 0);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  };
}

export function pointInTerrainRegion(point, region, { hysteresis = 0 } = {}) {
  if (!point || !region?.center) return false;
  if (region.shape === "capsule") {
    const local = localPoint(point, region);
    const halfLength = Math.max(0, (Number(region.length) || 0) / 2);
    const radius = Math.max(0, (Number(region.width) || 0) / 2) + hysteresis;
    const clampedX = Math.max(-halfLength, Math.min(halfLength, local.x));
    const dx = local.x - clampedX;
    const dy = local.y;
    return Math.hypot(dx, dy) <= radius;
  }
  const dx = Number(point.x || 0) - Number(region.center.x || 0);
  const dy = Number(point.y || 0) - Number(region.center.y || 0);
  return Math.hypot(dx, dy) <= (Number(region.radius) || 0) + hysteresis;
}

function speedLaneDirectionMultiplier(ship, region) {
  const laneAngle = Number(region.angle) || 0;
  const heading = Number(ship.angle) || 0;
  const dot = Math.cos(heading - laneAngle);
  return dot >= 0
    ? {
        speedMultiplier: TERRAIN_MOVEMENT_MULTIPLIERS.speed_lane.forwardSpeedMultiplier,
        accelerationMultiplier: TERRAIN_MOVEMENT_MULTIPLIERS.speed_lane.forwardAccelerationMultiplier,
        turnMultiplier: TERRAIN_MOVEMENT_MULTIPLIERS.speed_lane.turnMultiplier,
      }
    : {
        speedMultiplier: TERRAIN_MOVEMENT_MULTIPLIERS.speed_lane.reverseSpeedMultiplier,
        accelerationMultiplier: 1,
        turnMultiplier: TERRAIN_MOVEMENT_MULTIPLIERS.speed_lane.turnMultiplier,
      };
}

function modifierForTerrain(ship, region) {
  if (region.type === "speed_lane") return speedLaneDirectionMultiplier(ship, region);
  const base = TERRAIN_MOVEMENT_MULTIPLIERS[region.type] || {};
  return {
    speedMultiplier: base.speedMultiplier || 1,
    accelerationMultiplier: base.accelerationMultiplier || 1,
    turnMultiplier: base.turnMultiplier || 1,
  };
}

function composeModifiers(a, b) {
  return {
    speedMultiplier: (a.speedMultiplier || 1) * (b.speedMultiplier || 1),
    accelerationMultiplier: (a.accelerationMultiplier || 1) * (b.accelerationMultiplier || 1),
    turnMultiplier: (a.turnMultiplier || 1) * (b.turnMultiplier || 1),
  };
}

function shipTerrainKey(seat, shipKey) {
  return `${String(seat || "").trim().toUpperCase()}:${String(shipKey || "").trim()}`;
}

function previousTerrainMemory(modeState) {
  return modeState.terrainMemory && typeof modeState.terrainMemory === "object" ? modeState.terrainMemory : {};
}

export function updateTerritoryTerrainModifiers({ modeState, simulation } = {}) {
  const next = cloneJson(modeState);
  const events = [];
  const map = next.map || {};
  const terrainRegions = Array.isArray(map.terrainRegions) ? map.terrainRegions : [];
  const nextMemory = {};
  const previous = previousTerrainMemory(next);

  simulation?.clearEnvironmentModifiers?.();
  for (const seat of simulation?.fleetSeats || ["A", "B"]) {
    const fleet = simulation?.fleetBySeat?.(seat);
    for (const ship of fleet?.getAllShips?.() || []) {
      if (!ship?.alive) continue;
      let modifier = { speedMultiplier: 1, accelerationMultiplier: 1, turnMultiplier: 1 };
      const activeIds = [];
      for (const region of terrainRegions) {
        const key = shipTerrainKey(seat, ship.key);
        const wasInside = Array.isArray(previous[key]) && previous[key].includes(region.id);
        const inside = pointInTerrainRegion(ship, region, {
          hysteresis: wasInside ? TERRAIN_HYSTERESIS_PX : 0,
        });
        if (!inside) continue;
        activeIds.push(region.id);
        modifier = composeModifiers(modifier, modifierForTerrain(ship, region));
        if (!wasInside) {
          events.push({
            type: "terrain_entered",
            position: { x: ship.x, y: ship.y },
            seat,
            payload: { shipKey: ship.key, terrainId: region.id, terrainType: region.type },
          });
        }
      }
      const key = shipTerrainKey(seat, ship.key);
      const previousIds = Array.isArray(previous[key]) ? previous[key] : [];
      for (const terrainId of previousIds) {
        if (!activeIds.includes(terrainId)) {
          events.push({
            type: "terrain_exited",
            position: { x: ship.x, y: ship.y },
            seat,
            payload: { shipKey: ship.key, terrainId },
          });
        }
      }
      if (activeIds.length > 0) {
        simulation?.setEnvironmentModifier?.(seat, ship.key, modifier);
        nextMemory[key] = activeIds;
      }
    }
  }

  next.terrainMemory = nextMemory;
  return { modeState: next, events };
}
