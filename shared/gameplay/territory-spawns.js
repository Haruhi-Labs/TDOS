import { positionClearOfObstacles } from "./territory-obstacles.js";

function allianceIdForSeat(seat) {
  return String(seat || "A").toUpperCase().startsWith("B") ? "B" : "A";
}

function spawnAreaForAlliance(modeState, allianceId) {
  return (modeState?.map?.spawnAreas || []).find((area) => area.allianceId === allianceId) || null;
}

function rotateOffset(offset, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    x: offset.x * c - offset.y * s,
    y: offset.x * s + offset.y * c,
  };
}

function shipSpawnOffsetsForFacing(facing) {
  return {
    main: { x: 0, y: 0 },
    sub1: rotateOffset({ x: -28, y: 16 }, facing),
    sub2: rotateOffset({ x: -28, y: -16 }, facing),
  };
}

function fleetAnchorOffset(seat, index, facing) {
  const normalized = String(seat || "").toUpperCase();
  if (normalized.endsWith("1") || index <= 0) return { x: 0, y: 0 };
  const allianceId = allianceIdForSeat(seat);
  const primaryOffsets = allianceId === "A"
    ? {
        2: { x: 0, y: -96 },
        3: { x: 96, y: 0 },
      }
    : {
        2: { x: 0, y: 96 },
        3: { x: -96, y: 0 },
      };
  const suffix = normalized.match(/(\d+)$/)?.[1];
  if (primaryOffsets[suffix]) return primaryOffsets[suffix];
  return rotateOffset({ x: 0, y: index * 92 }, facing);
}

function indexForSeat(seat, fallback = 0) {
  const suffix = String(seat || "").toUpperCase().match(/(\d+)$/)?.[1];
  return suffix ? Math.max(0, Number(suffix) - 1) : Math.max(0, Number(fallback) || 0);
}

function shipCollisionRadius(simulation, seat, shipKey) {
  return Math.max(1, Number(simulation?.fleetBySeat?.(seat)?.shipByKey?.(shipKey)?.radius) || 18);
}

function withinSafeBounds(position, radius, bounds) {
  if (!bounds) return true;
  return position.x - radius >= bounds.x
    && position.y - radius >= bounds.y
    && position.x + radius <= bounds.x + bounds.width
    && position.y + radius <= bounds.y + bounds.height;
}

function deploymentCandidates(intended, spawn, facing) {
  const candidates = [intended];
  for (const distance of [72, 96, 120, 160, 220, 300]) {
    for (let index = 0; index < 16; index += 1) {
      const angle = facing + (Math.PI * 2 * index) / 16;
      candidates.push({
        x: spawn.center.x + Math.cos(angle) * distance,
        y: spawn.center.y + Math.sin(angle) * distance,
      });
    }
  }
  return candidates;
}

export function territorySpawnDeployment({ modeState, simulation = null, seat, shipKey = "main", fleetIndex = null } = {}) {
  const allianceId = allianceIdForSeat(seat);
  const spawn = spawnAreaForAlliance(modeState, allianceId);
  if (!spawn?.center) return null;
  const facing = allianceId === "A" ? -Math.PI / 4 : (Math.PI * 3) / 4;
  const index = fleetIndex == null ? indexForSeat(seat) : Math.max(0, Number(fleetIndex) || 0);
  const anchorOffset = fleetAnchorOffset(seat, index, facing);
  const shipOffset = shipSpawnOffsetsForFacing(facing)[shipKey] || { x: 0, y: 0 };
  const intended = {
    x: spawn.center.x + anchorOffset.x + shipOffset.x,
    y: spawn.center.y + anchorOffset.y + shipOffset.y,
  };
  const obstacles = modeState?.map?.obstacleRegions || [];
  const radius = shipCollisionRadius(simulation, seat, shipKey);
  const position = deploymentCandidates(intended, spawn, facing).find((candidate) => (
    withinSafeBounds(candidate, radius, modeState?.map?.safeBounds)
    && positionClearOfObstacles(candidate, radius, obstacles)
  ));
  return position ? { ...position, angle: facing } : null;
}

export function getTerritoryInitialDeployments({ modeState, simulation = null, fleetLayout } = {}) {
  const deployments = {};
  const entries = fleetLayout
    ? [...(fleetLayout.alliances?.A || []), ...(fleetLayout.alliances?.B || [])]
    : [{ seat: "A" }, { seat: "B" }];
  const allianceIndexes = { A: 0, B: 0 };

  for (const entry of entries) {
    const seat = String(entry?.seat || "").trim().toUpperCase();
    if (!seat) continue;
    const allianceId = allianceIdForSeat(seat);
    const fleetIndex = allianceIndexes[allianceId] || 0;
    allianceIndexes[allianceId] = fleetIndex + 1;
    deployments[seat] = Object.fromEntries(
      ["main", "sub1", "sub2"].map((shipKey) => [
        shipKey,
        territorySpawnDeployment({ modeState, simulation, seat, shipKey, fleetIndex }),
      ]),
    );
  }

  return deployments;
}
