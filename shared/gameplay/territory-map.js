import { createSeededRng } from "./seeded-rng.js";

export const TERRITORY_MAP_TEMPLATE_ID = "three-lane-v1";

const TERRAIN_TYPES = Object.freeze(["asteroid_belt", "speed_lane", "gravity_mire"]);

function point(x, y) {
  return { x: Math.round(x), y: Math.round(y) };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(a, b) {
  const dx = Number(a?.x || 0) - Number(b?.x || 0);
  const dy = Number(a?.y || 0) - Number(b?.y || 0);
  return Math.hypot(dx, dy);
}

function circleOverlap(a, b, padding = 0) {
  return distance(a.center, b.center) < Number(a.radius || 0) + Number(b.radius || 0) + padding;
}

function withinBounds(center, radius, bounds) {
  return (
    center.x - radius >= bounds.x &&
    center.y - radius >= bounds.y &&
    center.x + radius <= bounds.x + bounds.width &&
    center.y + radius <= bounds.y + bounds.height
  );
}

function makeNode(id, x, y, extra = {}) {
  return {
    id,
    center: point(x, y),
    radius: extra.radius || 34,
    ...extra,
  };
}

function nodeCollides(node, nodes, padding = 18) {
  return nodes.some((existing) => circleOverlap(node, existing, padding));
}

function normalizedWorldSize(worldSize) {
  const width = Number(worldSize?.width) || 1200;
  const height = Number(worldSize?.height) || 800;
  return {
    width: Math.max(900, width),
    height: Math.max(620, height),
  };
}

function buildSafeTemplate({ seed, worldSize, teamSize }) {
  const size = normalizedWorldSize(worldSize);
  const laneY = [size.height * 0.28, size.height * 0.5, size.height * 0.72];
  const safeBounds = {
    x: 60,
    y: 60,
    width: size.width - 120,
    height: size.height - 120,
  };
  const spawnRadius = clamp(82 + (Number(teamSize) - 1) * 10, 82, 112);

  return {
    version: 1,
    seed: Number(seed) || 0,
    templateId: TERRITORY_MAP_TEMPLATE_ID,
    worldSize: size,
    safeBounds,
    spawnAreas: [
      { id: "spawn-A", allianceId: "A", center: point(size.width * 0.15, size.height * 0.5), radius: spawnRadius },
      { id: "spawn-B", allianceId: "B", center: point(size.width * 0.85, size.height * 0.5), radius: spawnRadius },
    ],
    controlPoints: [
      { id: "alpha", center: point(size.width * 0.36, laneY[0]), radius: 62, ownerAllianceId: null },
      { id: "beta", center: point(size.width * 0.5, laneY[1]), radius: 70, ownerAllianceId: null },
      { id: "gamma", center: point(size.width * 0.64, laneY[2]), radius: 62, ownerAllianceId: null },
    ],
    terrainRegions: [
      {
        id: "terrain-north",
        type: "asteroid_belt",
        shape: "circle",
        center: point(size.width * 0.5, size.height * 0.24),
        radius: 78,
        blocksPath: false,
      },
      {
        id: "terrain-mid",
        type: "speed_lane",
        shape: "capsule",
        center: point(size.width * 0.5, size.height * 0.5),
        length: Math.round(size.width * 0.32),
        width: 78,
        angle: 0,
        blocksPath: false,
      },
      {
        id: "terrain-south",
        type: "gravity_mire",
        shape: "circle",
        center: point(size.width * 0.5, size.height * 0.76),
        radius: 82,
        blocksPath: false,
      },
    ],
    resourceSpawnNodes: [
      makeNode("res-common-a-north", size.width * 0.28, laneY[0], { rarity: "common", mirrorId: "res-common-b-north" }),
      makeNode("res-common-b-north", size.width * 0.72, laneY[0], { rarity: "common", mirrorId: "res-common-a-north" }),
      makeNode("res-common-a-south", size.width * 0.28, laneY[2], { rarity: "common", mirrorId: "res-common-b-south" }),
      makeNode("res-common-b-south", size.width * 0.72, laneY[2], { rarity: "common", mirrorId: "res-common-a-south" }),
      makeNode("res-rare-center", size.width * 0.5, size.height * 0.36, { rarity: "rare", radius: 38 }),
      makeNode("res-rare-low", size.width * 0.5, size.height * 0.64, { rarity: "rare", radius: 38 }),
    ],
    skillSpawnNodes: [
      makeNode("skill-north-mid", size.width * 0.5, size.height * 0.18, { radius: 40 }),
      makeNode("skill-center-risk", size.width * 0.5, size.height * 0.5, { radius: 40 }),
      makeNode("skill-south-mid", size.width * 0.5, size.height * 0.82, { radius: 40 }),
    ],
    lanes: [
      { id: "north", from: "spawn-A", through: ["alpha"], to: "spawn-B" },
      { id: "middle", from: "spawn-A", through: ["beta"], to: "spawn-B" },
      { id: "south", from: "spawn-A", through: ["gamma"], to: "spawn-B" },
    ],
    fallback: true,
  };
}

function buildCandidateMap({ seed, worldSize, teamSize, attempt }) {
  const size = normalizedWorldSize(worldSize);
  const rng = createSeededRng(seed).fork(`map:${attempt}`);
  const terrainRng = createSeededRng(seed).fork(`terrain:${attempt}`);
  const nodeRng = createSeededRng(seed).fork(`nodes:${attempt}`);
  const safe = buildSafeTemplate({ seed, worldSize: size, teamSize });
  const laneJitter = size.height * 0.035;
  const lateralJitter = size.width * 0.025;

  const controlPoints = safe.controlPoints.map((cp, index) => ({
    ...cp,
    center: point(
      cp.center.x + rng.nextInt(-Math.round(lateralJitter), Math.round(lateralJitter)),
      cp.center.y + rng.nextInt(-Math.round(laneJitter), Math.round(laneJitter)),
    ),
    radius: cp.radius + rng.nextInt(-6, 6),
    ownerAllianceId: null,
    capturingAllianceId: null,
    captureProgress: 0,
    contested: false,
    occupants: [],
    laneIndex: index,
  }));

  const terrainTypes = terrainRng.shuffle(TERRAIN_TYPES).concat(terrainRng.pick(TERRAIN_TYPES));
  const terrainRegions = safe.terrainRegions.map((region, index) => ({
    ...region,
    type: terrainTypes[index],
    center: point(
      region.center.x + terrainRng.nextInt(-45, 45),
      region.center.y + terrainRng.nextInt(-34, 34),
    ),
    radius: region.radius ? region.radius + terrainRng.nextInt(-12, 14) : undefined,
    length: region.length ? region.length + terrainRng.nextInt(-50, 50) : undefined,
    width: region.width ? region.width + terrainRng.nextInt(-10, 12) : undefined,
    angle: region.type === "speed_lane" ? 0 : region.angle,
    blocksPath: false,
  }));

  if (terrainRng.next() > 0.55) {
    terrainRegions.push({
      id: "terrain-flank",
      type: terrainRng.pick(TERRAIN_TYPES),
      shape: "circle",
      center: point(size.width * terrainRng.pick([0.38, 0.62]), size.height * terrainRng.pick([0.36, 0.64])),
      radius: terrainRng.nextInt(48, 68),
      blocksPath: false,
    });
  }

  const resourceCandidates = [
    [0.25, 0.3, "common", "north"],
    [0.75, 0.3, "common", "north"],
    [0.25, 0.7, "common", "south"],
    [0.75, 0.7, "common", "south"],
    [0.4, 0.5, "common", "middle-a"],
    [0.6, 0.5, "common", "middle-b"],
    [0.5, 0.35, "rare", "upper-center"],
    [0.5, 0.65, "rare", "lower-center"],
  ];
  const resourceSpawnNodes = nodeRng.shuffle(resourceCandidates).map(([x, y, rarity, label], index) =>
    makeNode(
      `res-${rarity}-${label}`,
      size.width * x + nodeRng.nextInt(-24, 24),
      size.height * y + nodeRng.nextInt(-22, 22),
      { rarity, radius: rarity === "rare" ? 38 : 34, order: index },
    ),
  );

  const skillSpawnNodes = [
    makeNode("skill-north-mid", size.width * 0.5 + nodeRng.nextInt(-34, 34), size.height * 0.2, { radius: 40 }),
    makeNode("skill-center-risk", size.width * 0.5 + nodeRng.nextInt(-24, 24), size.height * 0.5, { radius: 40 }),
    makeNode("skill-south-mid", size.width * 0.5 + nodeRng.nextInt(-34, 34), size.height * 0.8, { radius: 40 }),
  ];

  return {
    ...safe,
    fallback: false,
    controlPoints,
    terrainRegions,
    resourceSpawnNodes,
    skillSpawnNodes,
  };
}

export function validateTerritoryMap(map) {
  const errors = [];
  const bounds = map?.safeBounds;
  if (!map || typeof map !== "object") {
    return { valid: false, errors: ["map must be an object"] };
  }
  if (map.templateId !== TERRITORY_MAP_TEMPLATE_ID) {
    errors.push(`unsupported template ${map.templateId}`);
  }
  if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
    errors.push("safe bounds missing");
  }

  const spawnAreas = Array.isArray(map.spawnAreas) ? map.spawnAreas : [];
  const controlPoints = Array.isArray(map.controlPoints) ? map.controlPoints : [];
  const resourceNodes = Array.isArray(map.resourceSpawnNodes) ? map.resourceSpawnNodes : [];
  const skillNodes = Array.isArray(map.skillSpawnNodes) ? map.skillSpawnNodes : [];
  const terrainRegions = Array.isArray(map.terrainRegions) ? map.terrainRegions : [];

  if (spawnAreas.length !== 2) errors.push("expected two spawn areas");
  if (controlPoints.length !== 3) errors.push("expected three control points");
  if (!resourceNodes.some((node) => node.rarity === "common")) errors.push("missing common resource node");
  if (!resourceNodes.some((node) => node.rarity === "rare")) errors.push("missing rare resource node");
  if (skillNodes.length < 2) errors.push("expected at least two skill nodes");
  if (terrainRegions.length < 3 || terrainRegions.length > 4) errors.push("expected 3-4 terrain regions");

  const circularNodes = [...spawnAreas, ...controlPoints, ...resourceNodes, ...skillNodes];
  for (const node of circularNodes) {
    if (!node?.id) errors.push("node id missing");
    if (!node?.center || !Number.isFinite(node.center.x) || !Number.isFinite(node.center.y)) {
      errors.push(`${node?.id || "node"} center invalid`);
      continue;
    }
    const radius = Number(node.radius) || 0;
    if (radius <= 0) errors.push(`${node.id} radius invalid`);
    if (bounds && !withinBounds(node.center, radius, bounds)) {
      errors.push(`${node.id} outside safe bounds`);
    }
  }

  for (const spawn of spawnAreas) {
    for (const cp of controlPoints) {
      if (circleOverlap(spawn, cp, 28)) {
        errors.push(`spawn overlaps control: ${spawn.id}/${cp.id}`);
      }
    }
    for (const node of resourceNodes) {
      if (circleOverlap(spawn, node, 12)) {
        errors.push(`spawn contains resource: ${spawn.id}/${node.id}`);
      }
    }
  }

  for (let i = 0; i < controlPoints.length; i += 1) {
    for (let j = i + 1; j < controlPoints.length; j += 1) {
      if (distance(controlPoints[i].center, controlPoints[j].center) < 180) {
        errors.push(`control points too close: ${controlPoints[i].id}/${controlPoints[j].id}`);
      }
    }
  }

  for (let i = 0; i < resourceNodes.length; i += 1) {
    for (let j = i + 1; j < resourceNodes.length; j += 1) {
      if (nodeCollides(resourceNodes[i], [resourceNodes[j]], 6)) {
        errors.push(`resource overlap: ${resourceNodes[i].id}/${resourceNodes[j].id}`);
      }
    }
  }
  for (let i = 0; i < skillNodes.length; i += 1) {
    for (let j = i + 1; j < skillNodes.length; j += 1) {
      if (nodeCollides(skillNodes[i], [skillNodes[j]], 6)) {
        errors.push(`skill overlap: ${skillNodes[i].id}/${skillNodes[j].id}`);
      }
    }
  }

  const allowedTerrain = new Set(TERRAIN_TYPES);
  for (const region of terrainRegions) {
    if (!allowedTerrain.has(region.type)) errors.push(`invalid terrain type: ${region.type}`);
    if (region.blocksPath) errors.push(`terrain blocks path: ${region.id}`);
    if (bounds && region.center && !withinBounds(region.center, Number(region.radius || region.width || 40), bounds)) {
      errors.push(`terrain outside safe bounds: ${region.id}`);
    }
  }

  const laneCount = Array.isArray(map.lanes) ? map.lanes.length : 0;
  if (laneCount < 3) errors.push("key lanes unreachable");

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function generateTerritoryMap({
  seed = 0,
  templateId = TERRITORY_MAP_TEMPLATE_ID,
  worldSize = null,
  teamSize = 1,
  maxAttempts = 8,
} = {}) {
  if (templateId !== TERRITORY_MAP_TEMPLATE_ID) {
    return buildSafeTemplate({ seed, worldSize, teamSize });
  }

  const attempts = Math.max(1, Math.floor(Number(maxAttempts) || 1));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = buildCandidateMap({ seed, worldSize, teamSize, attempt });
    if (validateTerritoryMap(candidate).valid) {
      return candidate;
    }
  }
  return buildSafeTemplate({ seed, worldSize, teamSize });
}
