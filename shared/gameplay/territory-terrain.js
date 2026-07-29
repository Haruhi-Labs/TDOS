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

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

export function smoothstep(edge0, edge1, value) {
  const t = clamp01((Number(value) - Number(edge0)) / Math.max(1e-9, Number(edge1) - Number(edge0)));
  return t * t * (3 - 2 * t);
}

function compoundFields(region) {
  return Array.isArray(region?.fields) ? region.fields : [];
}

function fieldIntensityAtPoint(point, field) {
  const radius = Math.max(0, Number(field?.radius) || 0);
  const coreRadius = Math.max(0, Math.min(radius, Number(field?.coreRadius) || 0));
  if (!point || !Number.isFinite(Number(field?.x)) || !Number.isFinite(Number(field?.y)) || radius <= 0) return 0;
  const distance = Math.hypot(Number(point.x) - Number(field.x), Number(point.y) - Number(field.y));
  return 1 - smoothstep(coreRadius, radius, distance);
}

export function terrainIntensityAtPoint(point, region) {
  if (!point || !region) return 0;
  if (region.shape === "compound") {
    return compoundFields(region).reduce(
      (maximum, field) => Math.max(maximum, fieldIntensityAtPoint(point, field)),
      0,
    );
  }
  return pointInTerrainRegion(point, region) ? 1 : 0;
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
  if (!point || !region) return false;
  if (region.shape === "compound") {
    return compoundFields(region).some((field) => (
      Math.hypot(Number(point.x) - Number(field?.x), Number(point.y) - Number(field?.y))
        <= Math.max(0, Number(field?.radius) || 0) + hysteresis
    ));
  }
  if (!region.center) return false;
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

function interpolateMultiplier(value, intensity) {
  return 1 + ((Number(value) || 1) - 1) * clamp01(intensity);
}

function modifierForTerrain(ship, region, intensity) {
  const core = region.type === "speed_lane"
    ? speedLaneDirectionMultiplier(ship, region)
    : (() => {
      const base = TERRAIN_MOVEMENT_MULTIPLIERS[region.type] || {};
      return {
        speedMultiplier: base.speedMultiplier || 1,
        accelerationMultiplier: base.accelerationMultiplier || 1,
        turnMultiplier: base.turnMultiplier || 1,
      };
    })();
  return {
    speedMultiplier: interpolateMultiplier(core.speedMultiplier, intensity),
    accelerationMultiplier: interpolateMultiplier(core.accelerationMultiplier, intensity),
    turnMultiplier: interpolateMultiplier(core.turnMultiplier, intensity),
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

function terrainMemoryEntry(memory, key) {
  const entry = memory?.[key];
  if (Array.isArray(entry)) return { ids: entry, intensities: {} };
  return {
    ids: Array.isArray(entry?.ids) ? entry.ids : [],
    intensities: entry?.intensities && typeof entry.intensities === "object" ? entry.intensities : {},
  };
}

export function updateTerritoryTerrainModifiers({ modeState, simulation, mutate = false } = {}) {
  const next = mutate ? modeState : cloneJson(modeState);
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
      const formationKey = fleet?.fleetKeyForShip?.(ship) || ship.key;
      const movementSource = fleet?.fleetMembersByKey?.(formationKey)?.[0] || ship;
      let modifier = { speedMultiplier: 1, accelerationMultiplier: 1, turnMultiplier: 1 };
      const activeIds = [];
      const activeIntensities = {};
      const key = shipTerrainKey(seat, ship.key);
      const memory = terrainMemoryEntry(previous, key);
      for (const region of terrainRegions) {
        const wasInside = memory.ids.includes(region.id);
        const rawIntensity = terrainIntensityAtPoint(movementSource, region);
        const inside = rawIntensity > 0 || (wasInside && pointInTerrainRegion(movementSource, region, {
          hysteresis: TERRAIN_HYSTERESIS_PX,
        }));
        if (!inside) continue;
        const intensity = rawIntensity > 0 ? rawIntensity : clamp01(memory.intensities[region.id]);
        activeIds.push(region.id);
        activeIntensities[region.id] = intensity;
        modifier = composeModifiers(modifier, modifierForTerrain(movementSource, region, intensity));
        if (!wasInside) {
          events.push({
            type: "terrain_entered",
            position: { x: ship.x, y: ship.y },
            seat,
            payload: { shipKey: ship.key, terrainId: region.id, terrainType: region.type },
          });
        }
      }
      for (const terrainId of memory.ids) {
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
        nextMemory[key] = { ids: activeIds, intensities: activeIntensities };
      }
    }
  }

  next.terrainMemory = nextMemory;
  return { modeState: next, events };
}
