import { createSeededRng } from "./seeded-rng.js";
import {
  firstObstacleHit,
  positionClearOfObstacles,
} from "./territory-obstacles.js";

export const TERRITORY_MAP_TEMPLATE_ID = "three-lane-v2";

const BASE_REFERENCE_SIZE = 2160;
const REFERENCE_SIZE = 3200;
const CORE_SCALE = 1.25;
const CORE_OFFSET = (REFERENCE_SIZE - BASE_REFERENCE_SIZE * CORE_SCALE) / 2;
const TERRAIN_TYPES = Object.freeze(["asteroid_belt", "speed_lane", "gravity_mire"]);
const BASE_LANE_LAYOUT = freezeCorridorLayout([
  {
    id: "top",
    width: 340,
    path: [[210, 1950], [260, 1150], [360, 500], [860, 330], [1580, 300], [1950, 210]],
  },
  {
    id: "mid",
    width: 380,
    path: [[210, 1950], [500, 1730], [620, 1200], [1080, 1080], [1540, 960], [1660, 430], [1950, 210]],
  },
  {
    id: "bottom",
    width: 340,
    path: [[210, 1950], [580, 1860], [1300, 1830], [1800, 1660], [1900, 1010], [1950, 210]],
  },
]);
const BASE_CONNECTOR_LAYOUT = freezeCorridorLayout([
  { id: "connector-top-mid-west", mirrorId: "connector-mid-bottom-east", fromLaneId: "top", toLaneId: "mid", path: [[300, 850], [620, 1200]], width: 260, risk: false },
  { id: "connector-top-mid-east", mirrorId: "connector-mid-bottom-west", fromLaneId: "top", toLaneId: "mid", path: [[1750, 350], [1840, 760], [1540, 960]], width: 250, risk: false },
  { id: "connector-mid-bottom-west", mirrorId: "connector-top-mid-east", fromLaneId: "mid", toLaneId: "bottom", path: [[620, 1200], [320, 1400], [410, 1810]], width: 250, risk: false },
  { id: "connector-mid-bottom-east", mirrorId: "connector-top-mid-west", fromLaneId: "mid", toLaneId: "bottom", path: [[1540, 960], [1860, 1310]], width: 260, risk: false },
  { id: "connector-top-mid-risk", mirrorId: "connector-mid-bottom-risk", fromLaneId: "top", toLaneId: "mid", path: [[980, 600], [1020, 900]], width: 190, risk: true },
  { id: "connector-mid-bottom-risk", mirrorId: "connector-top-mid-risk", fromLaneId: "mid", toLaneId: "bottom", path: [[1140, 1260], [1180, 1560]], width: 190, risk: true },
]);
const LANE_LAYOUT = scaleCorridorLayout(BASE_LANE_LAYOUT);
const CONNECTOR_LAYOUT = scaleCorridorLayout(BASE_CONNECTOR_LAYOUT);
const LANE_IDS = Object.freeze(BASE_LANE_LAYOUT.map((lane) => lane.id));
const CONTROL_ZONE_IDS = Object.freeze(["top", "mid", "bottom", "left", "right"]);
const ROTATED_LANE_ID = Object.freeze({ top: "bottom", mid: "mid", bottom: "top" });
const SPAWN_LAYOUT = Object.freeze([
  { id: "spawn-A", allianceId: "A", x: scaleCoreCoordinate(210), y: scaleCoreCoordinate(1950) },
  { id: "spawn-B", allianceId: "B", x: scaleCoreCoordinate(1950), y: scaleCoreCoordinate(210) },
]);
const BASE_CONTROL_LAYOUT = Object.freeze([
  { id: "control-top", laneId: "top", x: 860, y: 330, width: 340, height: 240 },
  { id: "control-mid", laneId: "mid", x: 1080, y: 1080, width: 360, height: 260 },
  { id: "control-bottom", laneId: "bottom", x: 1300, y: 1830, width: 340, height: 240 },
]);
const CONTROL_LAYOUT = Object.freeze([
  ...BASE_CONTROL_LAYOUT.map((control) => ({
    ...control,
    x: scaleCoreCoordinate(control.x),
    y: scaleCoreCoordinate(control.y),
    width: scaleCoreLength(control.width),
    height: scaleCoreLength(control.height),
  })),
  { id: "control-left", laneId: "left", x: 520, y: 1600, width: 425, height: 300 },
  { id: "control-right", laneId: "right", x: 2680, y: 1600, width: 425, height: 300 },
]);
const CONNECTOR_IDS = Object.freeze(CONNECTOR_LAYOUT.map((connector) => connector.id));
const NAVIGATION_NODE_IDS = Object.freeze([
  "nav-spawn-a",
  "nav-top-a-entry",
  "nav-top-west",
  "nav-control-top",
  "nav-top-east",
  "nav-spawn-b",
  "nav-mid-a-entry",
  "nav-mid-west",
  "nav-control-mid",
  "nav-mid-east",
  "nav-mid-b-entry",
  "nav-bottom-west",
  "nav-control-bottom",
  "nav-bottom-east",
  "nav-bottom-b-entry",
  "nav-connector-top-mid-west",
  "nav-connector-top-mid-east",
  "nav-connector-mid-bottom-west",
  "nav-connector-mid-bottom-east",
  "nav-risk-upper-top",
  "nav-risk-upper-mid",
  "nav-risk-lower-mid",
  "nav-risk-lower-bottom",
  "nav-control-left",
  "nav-control-right",
]);
const NAVIGATION_EDGE_IDS = Object.freeze(Array.from({ length: 34 }, (_, index) => `nav-edge-${index + 1}`));

function point(x, y) {
  return { x: Number(x), y: Number(y) };
}

function scaleCoreCoordinate(value) {
  return CORE_OFFSET + Number(value) * CORE_SCALE;
}

function scaleCoreLength(value) {
  return Number(value) * CORE_SCALE;
}

function scaleCorePoint(value) {
  return point(scaleCoreCoordinate(value.x), scaleCoreCoordinate(value.y));
}

function scaleCorePath(path) {
  return (path || []).map((value) => scaleCorePoint(value));
}

function scaleCorridorLayout(entries) {
  return freezeCorridorLayout(entries.map((entry) => ({
    ...entry,
    path: (entry.path || []).map((value) => [scaleCoreCoordinate(value.x), scaleCoreCoordinate(value.y)]),
    width: scaleCoreLength(entry.width),
  })));
}

function freezeCorridorLayout(entries) {
  return Object.freeze(entries.map((entry) => Object.freeze({
    ...entry,
    path: Object.freeze(entry.path.map(([x, y]) => Object.freeze({ x, y }))),
  })));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizedWorldSize() {
  return { width: REFERENCE_SIZE, height: REFERENCE_SIZE };
}

function rotate180(value, size = { width: REFERENCE_SIZE, height: REFERENCE_SIZE }) {
  return point(size.width - value.x, size.height - value.y);
}

function rotatePath(path, size) {
  return path.slice().reverse().map((value) => rotate180(value, size));
}

function makeNode(id, x, y, extra = {}) {
  return {
    id,
    center: point(x, y),
    radius: Number(extra.radius) || 34,
    ...extra,
  };
}

function makeControlPoint(id, label, laneId, x, y, width, height) {
  return {
    id,
    label,
    laneId,
    shape: "rect",
    center: point(x, y),
    x: Math.round(x - width / 2),
    y: Math.round(y - height / 2),
    width,
    height,
    ownerAllianceId: null,
    capturingAllianceId: null,
    captureProgress: 0,
    contested: false,
    occupants: { A: [], B: [] },
  };
}

function scaleCoreNode(node) {
  return {
    ...node,
    center: scaleCorePoint(node.center),
    radius: scaleCoreLength(node.radius),
    ...(Number.isFinite(Number(node.clearance)) ? { clearance: scaleCoreLength(node.clearance) } : {}),
  };
}

function scaleCorePrimitive(primitive) {
  if (primitive.shape === "circle") {
    return { ...primitive, center: scaleCorePoint(primitive.center), radius: scaleCoreLength(primitive.radius) };
  }
  if (primitive.shape === "capsule") {
    return {
      ...primitive,
      start: scaleCorePoint(primitive.start),
      end: scaleCorePoint(primitive.end),
      radius: scaleCoreLength(primitive.radius),
    };
  }
  return clone(primitive);
}

function scaleCoreObstacle(obstacle) {
  return {
    ...obstacle,
    ...(obstacle.center ? { center: scaleCorePoint(obstacle.center) } : {}),
    ...(obstacle.points ? { points: scaleCorePath(obstacle.points) } : {}),
    ...(obstacle.primitives ? { primitives: obstacle.primitives.map(scaleCorePrimitive) } : {}),
  };
}

function scaleCoreControl(control) {
  const width = scaleCoreLength(control.width);
  const height = scaleCoreLength(control.height);
  const center = scaleCorePoint(control.center);
  return { ...control, center, width, height, x: Math.round(center.x - width / 2), y: Math.round(center.y - height / 2) };
}

function scaleCoreGeometry(fixed) {
  const laneCorridors = fixed.laneCorridors.map((lane) => ({
    ...lane,
    path: scaleCorePath(lane.path),
    width: scaleCoreLength(lane.width),
  }));
  const connectorCorridors = fixed.connectorCorridors.map((connector) => ({
    ...connector,
    path: scaleCorePath(connector.path),
    width: scaleCoreLength(connector.width),
  }));
  const graphNodes = fixed.navigationGraph.nodes.map(scaleCoreNode);
  const graphEdges = fixed.navigationGraph.edges.map((edge) => ({
    ...edge,
    clearance: scaleCoreLength(edge.clearance),
  }));
  const leftControl = makeControlPoint("control-left", "L", "left", 520, 1600, 425, 300);
  const rightControl = makeControlPoint("control-right", "R", "right", 2680, 1600, 425, 300);

  graphNodes.push(
    makeNode("nav-control-left", 520, 1600, { kind: "control", laneId: "left", controlPointId: leftControl.id, clearance: 30 }),
    makeNode("nav-control-right", 2680, 1600, { kind: "control", laneId: "right", controlPointId: rightControl.id, clearance: 30 }),
  );
  graphEdges.push(
    { id: "nav-edge-31", from: "nav-control-left", to: "nav-mid-west", clearance: 22.5 },
    { id: "nav-edge-32", from: "nav-control-left", to: "nav-connector-top-mid-west", clearance: 22.5 },
    { id: "nav-edge-33", from: "nav-control-right", to: "nav-mid-east", clearance: 22.5 },
    { id: "nav-edge-34", from: "nav-control-right", to: "nav-connector-mid-bottom-east", clearance: 22.5 },
  );

  return {
    ...fixed,
    spawnAreas: fixed.spawnAreas.map(scaleCoreNode),
    controlPoints: [...fixed.controlPoints.map(scaleCoreControl), leftControl, rightControl],
    laneCorridors,
    obstacleRegions: fixed.obstacleRegions.map(scaleCoreObstacle),
    connectorCorridors,
    navigationGraph: { nodes: graphNodes, edges: graphEdges },
    terrainSlots: [
      ...fixed.terrainSlots.map(scaleCoreNode),
      makeNode("terrain-slot-left", 500, 1600, { regionId: "left", radius: 60 }),
      makeNode("terrain-slot-right", 2700, 1600, { regionId: "right", radius: 60 }),
    ],
    resourceSpawnNodes: [
      ...fixed.resourceSpawnNodes.map(scaleCoreNode),
      makeNode("res-common-left", 420, 1450, { rarity: "common", laneId: "left", regionId: "left", radius: 42.5, mirrorId: "res-common-right" }),
      makeNode("res-common-right", 2780, 1750, { rarity: "common", laneId: "right", regionId: "right", radius: 42.5, mirrorId: "res-common-left" }),
    ],
    skillSpawnNodes: [
      ...fixed.skillSpawnNodes.map(scaleCoreNode),
      makeNode("skill-left-strategy", 420, 1700, { laneId: "left", regionId: "left", radius: 50 }),
      makeNode("skill-right-strategy", 2780, 1500, { laneId: "right", regionId: "right", radius: 50 }),
    ],
    lanes: laneCorridors.map((lane) => ({ id: lane.id, path: lane.path, width: lane.width })),
  };
}

function rotatePrimitive(primitive, size) {
  if (primitive.shape === "circle") {
    return { ...primitive, center: rotate180(primitive.center, size) };
  }
  if (primitive.shape === "capsule") {
    return {
      ...primitive,
      start: rotate180(primitive.end, size),
      end: rotate180(primitive.start, size),
    };
  }
  if (primitive.shape === "polygon") {
    return { ...primitive, points: rotatePath(primitive.points, size) };
  }
  return clone(primitive);
}

function rotateObstacle(obstacle, id, mirrorId, size) {
  return {
    ...obstacle,
    id,
    mirrorId,
    points: obstacle.points ? rotatePath(obstacle.points, size) : undefined,
    primitives: obstacle.primitives?.map((primitive) => rotatePrimitive(primitive, size)),
  };
}

function pointsEqual(a, b) {
  return Boolean(a && b) && a.x === b.x && a.y === b.y;
}

function pathsEqual(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length
    && a.every((value, index) => pointsEqual(value, b[index]));
}

function primitiveMatchesRotation(source, target, size) {
  if (!source || !target || source.shape !== target.shape) return false;
  const rotated = rotatePrimitive(source, size);
  if (source.shape === "circle") {
    return pointsEqual(rotated.center, target.center) && source.radius === target.radius;
  }
  if (source.shape === "capsule") {
    return pointsEqual(rotated.start, target.start)
      && pointsEqual(rotated.end, target.end)
      && source.radius === target.radius;
  }
  if (source.shape === "polygon") {
    return pathsEqual(rotated.points, target.points);
  }
  return false;
}

function obstacleMatchesRotation(source, target, size) {
  if (!source || !target || source.shape !== target.shape || source.type !== target.type) return false;
  if (source.shape === "polygon") {
    return pathsEqual(rotatePath(source.points || [], size), target.points || []);
  }
  if (source.shape === "compound") {
    const sourcePrimitives = source.primitives || [];
    const targetPrimitives = target.primitives || [];
    return sourcePrimitives.length === targetPrimitives.length
      && sourcePrimitives.every((primitive, index) => primitiveMatchesRotation(primitive, targetPrimitives[index], size));
  }
  return false;
}

function connectorMatchesRotation(source, target, size) {
  return Boolean(source && target)
    && target.mirrorId === source.id
    && target.fromLaneId === ROTATED_LANE_ID[source.toLaneId]
    && target.toLaneId === ROTATED_LANE_ID[source.fromLaneId]
    && Number(target.width) === Number(source.width)
    && Boolean(target.risk) === Boolean(source.risk)
    && pathsEqual(rotatePath(source.path || [], size), target.path || []);
}

function terrainFieldMatchesRotation(source, target, size) {
  return Number(source?.x) + Number(target?.x) === size.width
    && Number(source?.y) + Number(target?.y) === size.height
    && Number(source?.radius) === Number(target?.radius)
    && Number(source?.coreRadius) === Number(target?.coreRadius);
}

function terrainMatchesRotation(source, target, size) {
  if (!source || !target || source.type !== target.type || source.shape !== target.shape
    || !pointsEqual(rotate180(source.center, size), target.center)
    || Number(source.strength) !== Number(target.strength)) return false;
  if (source.shape === "capsule") {
    return Number(source.length) === Number(target.length)
      && Number(source.width) === Number(target.width)
      && Math.abs(Math.sin(Number(source.angle) - Number(target.angle))) < 1e-9;
  }
  if (source.shape !== "compound" || !Array.isArray(source.fields) || !Array.isArray(target.fields)
    || Number(source.radius) !== Number(target.radius) || source.fields.length !== target.fields.length) return false;
  const unmatched = [...target.fields];
  return source.fields.every((field) => {
    const index = unmatched.findIndex((candidate) => terrainFieldMatchesRotation(field, candidate, size));
    if (index < 0) return false;
    unmatched.splice(index, 1);
    return true;
  });
}

function obstacleCenter(obstacle) {
  if (obstacle?.center) return obstacle.center;
  const points = obstacle?.points || obstacle?.primitives?.flatMap((primitive) => {
    if (primitive.center) return [primitive.center];
    return [primitive.start, primitive.end].filter(Boolean);
  }) || [];
  if (!points.length) return null;
  return point(
    points.reduce((sum, value) => sum + value.x, 0) / points.length,
    points.reduce((sum, value) => sum + value.y, 0) / points.length,
  );
}

function makeObstacle(id, mirrorId, shape) {
  return {
    id,
    mirrorId,
    type: id.includes("station") ? "station_wreck" : "asteroid_massif",
    blocksMovement: true,
    blocksProjectiles: true,
    blocksBeam: true,
    ...shape,
  };
}

function buildFixedGeometry(size, teamSize) {
  const spawnRadius = Math.max(96, Math.min(122, 92 + Math.max(1, Number(teamSize) || 1) * 8));
  const spawnA = { id: "spawn-A", allianceId: "A", center: point(210, 1950), radius: spawnRadius };
  const spawnB = { id: "spawn-B", allianceId: "B", center: rotate180(spawnA.center, size), radius: spawnRadius };

  const upperWest = makeObstacle("obstacle-upper-west", "obstacle-lower-east", {
    shape: "polygon",
    points: [
      point(430, 700), point(520, 590), point(710, 610), point(820, 760),
      point(760, 900), point(560, 930), point(440, 840),
    ],
  });
  const upperEast = makeObstacle("obstacle-upper-east-station", "obstacle-lower-west-station", {
    shape: "compound",
    primitives: [
      { shape: "capsule", start: point(1180, 550), end: point(1500, 520), radius: 90 },
      { shape: "circle", center: point(1440, 720), radius: 125 },
    ],
  });
  const obstacleRegions = [
    upperWest,
    upperEast,
    rotateObstacle(upperEast, "obstacle-lower-west-station", upperEast.id, size),
    rotateObstacle(upperWest, "obstacle-lower-east", upperWest.id, size),
  ];
  for (const obstacle of obstacleRegions) obstacle.center = obstacleCenter(obstacle);

  const laneLabels = { top: "\u4e0a\u8def", mid: "\u4e2d\u8def", bottom: "\u4e0b\u8def" };
  const laneCorridors = BASE_LANE_LAYOUT.map((lane) => ({ ...clone(lane), label: laneLabels[lane.id] }));
  const connectorCorridors = BASE_CONNECTOR_LAYOUT.map((connector) => clone(connector));

  const graphNodes = [
    makeNode("nav-spawn-a", 210, 1950, { kind: "spawn", allianceId: "A", clearance: 30 }),
    makeNode("nav-top-a-entry", 260, 1150, { kind: "lane", laneId: "top" }),
    makeNode("nav-top-west", 360, 500, { kind: "lane", laneId: "top" }),
    makeNode("nav-control-top", 860, 330, { kind: "control", laneId: "top", controlPointId: "control-top" }),
    makeNode("nav-top-east", 1580, 300, { kind: "lane", laneId: "top" }),
    makeNode("nav-spawn-b", 1950, 210, { kind: "spawn", allianceId: "B", clearance: 30 }),
    makeNode("nav-mid-a-entry", 500, 1730, { kind: "lane", laneId: "mid" }),
    makeNode("nav-mid-west", 620, 1200, { kind: "lane", laneId: "mid" }),
    makeNode("nav-control-mid", 1080, 1080, { kind: "control", laneId: "mid", controlPointId: "control-mid" }),
    makeNode("nav-mid-east", 1540, 960, { kind: "lane", laneId: "mid" }),
    makeNode("nav-mid-b-entry", 1660, 430, { kind: "lane", laneId: "mid" }),
    makeNode("nav-bottom-west", 580, 1860, { kind: "lane", laneId: "bottom" }),
    makeNode("nav-control-bottom", 1300, 1830, { kind: "control", laneId: "bottom", controlPointId: "control-bottom" }),
    makeNode("nav-bottom-east", 1800, 1660, { kind: "lane", laneId: "bottom" }),
    makeNode("nav-bottom-b-entry", 1900, 1010, { kind: "lane", laneId: "bottom" }),
    makeNode("nav-connector-top-mid-west", 300, 850, { kind: "connector", connectorId: "connector-top-mid-west" }),
    makeNode("nav-connector-top-mid-east", 1840, 760, { kind: "connector", connectorId: "connector-top-mid-east" }),
    makeNode("nav-connector-mid-bottom-west", 320, 1400, { kind: "connector", connectorId: "connector-mid-bottom-west" }),
    makeNode("nav-connector-mid-bottom-east", 1860, 1310, { kind: "connector", connectorId: "connector-mid-bottom-east" }),
    makeNode("nav-risk-upper-top", 980, 600, { kind: "connector", connectorId: "connector-top-mid-risk" }),
    makeNode("nav-risk-upper-mid", 1020, 900, { kind: "connector", connectorId: "connector-top-mid-risk" }),
    makeNode("nav-risk-lower-mid", 1140, 1260, { kind: "connector", connectorId: "connector-mid-bottom-risk" }),
    makeNode("nav-risk-lower-bottom", 1180, 1560, { kind: "connector", connectorId: "connector-mid-bottom-risk" }),
  ];
  const edgePairs = [
    ["nav-spawn-a", "nav-top-a-entry"], ["nav-top-a-entry", "nav-top-west"],
    ["nav-top-west", "nav-control-top"], ["nav-control-top", "nav-top-east"], ["nav-top-east", "nav-spawn-b"],
    ["nav-spawn-a", "nav-mid-a-entry"], ["nav-mid-a-entry", "nav-mid-west"],
    ["nav-mid-west", "nav-control-mid"], ["nav-control-mid", "nav-mid-east"],
    ["nav-mid-east", "nav-mid-b-entry"], ["nav-mid-b-entry", "nav-spawn-b"],
    ["nav-spawn-a", "nav-bottom-west"], ["nav-bottom-west", "nav-control-bottom"],
    ["nav-control-bottom", "nav-bottom-east"], ["nav-bottom-east", "nav-bottom-b-entry"],
    ["nav-bottom-b-entry", "nav-spawn-b"],
    ["nav-top-west", "nav-connector-top-mid-west"], ["nav-connector-top-mid-west", "nav-mid-west"],
    ["nav-top-east", "nav-connector-top-mid-east"], ["nav-connector-top-mid-east", "nav-mid-east"],
    ["nav-mid-west", "nav-connector-mid-bottom-west"], ["nav-connector-mid-bottom-west", "nav-bottom-west"],
    ["nav-mid-east", "nav-connector-mid-bottom-east"], ["nav-connector-mid-bottom-east", "nav-bottom-b-entry"],
    ["nav-control-top", "nav-risk-upper-top"], ["nav-risk-upper-top", "nav-risk-upper-mid"],
    ["nav-risk-upper-mid", "nav-control-mid"], ["nav-control-mid", "nav-risk-lower-mid"],
    ["nav-risk-lower-mid", "nav-risk-lower-bottom"], ["nav-risk-lower-bottom", "nav-control-bottom"],
  ];

  const terrainSlots = [
    makeNode("terrain-slot-top", 1080, 300, { regionId: "top", radius: 48 }),
    makeNode("terrain-slot-mid", 1080, 1080, { regionId: "mid", radius: 48 }),
    makeNode("terrain-slot-bottom", 1080, 1860, { regionId: "bottom", radius: 48 }),
    makeNode("terrain-slot-upper-wild", 980, 760, { regionId: "upper-wild", radius: 48 }),
    makeNode("terrain-slot-lower-wild", 1180, 1400, { regionId: "lower-wild", radius: 48 }),
  ];

  const resourceSpawnNodes = [
    makeNode("res-common-top-west", 520, 360, { rarity: "common", laneId: "top", regionId: "top", mirrorId: "res-common-bottom-east" }),
    makeNode("res-common-top-east", 1500, 300, { rarity: "common", laneId: "top", regionId: "top", mirrorId: "res-common-bottom-west" }),
    makeNode("res-common-mid-west", 760, 1160, { rarity: "common", laneId: "mid", regionId: "mid", mirrorId: "res-common-mid-east" }),
    makeNode("res-common-mid-east", 1400, 1000, { rarity: "common", laneId: "mid", regionId: "mid", mirrorId: "res-common-mid-west" }),
    makeNode("res-common-bottom-west", 660, 1860, { rarity: "common", laneId: "bottom", regionId: "bottom", mirrorId: "res-common-top-east" }),
    makeNode("res-common-bottom-east", 1640, 1800, { rarity: "common", laneId: "bottom", regionId: "bottom", mirrorId: "res-common-top-west" }),
    makeNode("res-rare-upper-wild", 1020, 700, { rarity: "rare", regionId: "upper-wild", radius: 38, mirrorId: "res-rare-lower-wild" }),
    makeNode("res-rare-lower-wild", 1140, 1460, { rarity: "rare", regionId: "lower-wild", radius: 38, mirrorId: "res-rare-upper-wild" }),
  ];
  const skillSpawnNodes = [
    makeNode("skill-top-strategy", 1080, 220, { laneId: "top", regionId: "top", radius: 40 }),
    makeNode("skill-mid-strategy", 1080, 1080, { laneId: "mid", regionId: "mid", radius: 40 }),
    makeNode("skill-bottom-strategy", 1080, 1940, { laneId: "bottom", regionId: "bottom", radius: 40 }),
    makeNode("skill-upper-wild", 980, 820, { regionId: "upper-wild", radius: 40 }),
    makeNode("skill-lower-wild", 1180, 1340, { regionId: "lower-wild", radius: 40 }),
  ];

  return {
    spawnAreas: [spawnA, spawnB],
    controlPoints: BASE_CONTROL_LAYOUT.map((control) => makeControlPoint(
      control.id,
      control.id === "control-top" ? "T" : control.id === "control-mid" ? "M" : "B",
      control.laneId,
      control.x,
      control.y,
      control.width,
      control.height,
    )),
    laneCorridors,
    obstacleRegions,
    connectorCorridors,
    navigationGraph: {
      nodes: graphNodes,
      edges: edgePairs.map(([from, to], index) => ({ id: `nav-edge-${index + 1}`, from, to, clearance: 18 })),
    },
    terrainSlots,
    resourceSpawnNodes,
    skillSpawnNodes,
    lanes: laneCorridors.map((lane) => ({ id: lane.id, path: lane.path, width: lane.width })),
  };
}

function terrainAngle(regionId) {
  if (regionId === "mid") return -Math.PI / 4;
  if (regionId.includes("wild")) return Math.PI / 3;
  if (regionId === "left" || regionId === "right") return Math.PI / 2;
  return 0;
}

function terrainField(rng, center, angle, offset, radius) {
  return {
    x: Math.round(center.x + Math.cos(angle) * offset),
    y: Math.round(center.y + Math.sin(angle) * offset),
    radius,
    coreRadius: Math.round(radius * (0.34 + rng.next() * 0.08)),
  };
}

function buildTerrainRegion(rng, slot, type, { centered = false } = {}) {
  const center = centered
    ? point(slot.center.x, slot.center.y)
    : point(slot.center.x + rng.nextInt(-30, 30), slot.center.y + rng.nextInt(-25, 25));
  if (type === "speed_lane") {
    return {
      id: `terrain-${slot.regionId}`,
      slotId: slot.id,
      regionId: slot.regionId,
      type,
      shape: "capsule",
      center,
      length: scaleCoreLength(680 + rng.nextInt(0, 220)),
      width: scaleCoreLength(240 + rng.nextInt(0, 60)),
      angle: terrainAngle(slot.regionId),
      strength: 0.9 + rng.next() * 0.2,
      blocksPath: false,
    };
  }
  const phase = rng.next() * Math.PI * 2;
  const makeField = (angle) => {
    const offset = scaleCoreLength(58 + rng.nextInt(0, 24));
    const radius = scaleCoreLength(150 + rng.nextInt(0, 34));
    return terrainField(rng, center, angle, offset, radius);
  };
  const fields = centered
    ? (() => {
      const centralRadius = scaleCoreLength(150 + rng.nextInt(0, 34));
      const central = {
        x: center.x,
        y: center.y,
        radius: centralRadius,
        coreRadius: Math.round(centralRadius * (0.34 + rng.next() * 0.08)),
      };
      const outer = makeField(phase);
      return [central, outer, {
        x: Math.round(center.x * 2 - outer.x),
        y: Math.round(center.y * 2 - outer.y),
        radius: outer.radius,
        coreRadius: outer.coreRadius,
      }];
    })()
    : [0, 1, 2].map((fieldIndex) => makeField(
      phase + fieldIndex * (Math.PI * 2 / 3) + rng.nextInt(-8, 8) * (Math.PI / 180),
    ));
  const radius = Math.max(
    scaleCoreLength(220),
    Math.min(scaleCoreLength(360), Math.ceil(Math.max(...fields.map((field) => (
      Math.hypot(field.x - center.x, field.y - center.y) + field.radius
    ))) / 10) * 10),
  );
  return {
    id: `terrain-${slot.regionId}`,
    slotId: slot.id,
    regionId: slot.regionId,
    type,
    shape: "compound",
    center,
    radius,
    fields,
    strength: 0.9 + rng.next() * 0.2,
    blocksPath: false,
  };
}

function rotateTerrainRegion(region, targetSlot, size) {
  const mirrored = {
    ...region,
    id: `terrain-${targetSlot.regionId}`,
    slotId: targetSlot.id,
    regionId: targetSlot.regionId,
    center: rotate180(region.center, size),
  };
  if (region.shape === "capsule") return { ...mirrored, angle: region.angle + Math.PI };
  return {
    ...mirrored,
    fields: region.fields.map((field) => ({
      ...field,
      x: size.width - field.x,
      y: size.height - field.y,
    })),
  };
}

function buildTerrainRegions(seed, slots) {
  const rng = createSeededRng(seed).fork("terrain-v2");
  const types = rng.shuffle(TERRAIN_TYPES);
  const byRegionId = new Map(slots.map((slot) => [slot.regionId, slot]));
  const result = new Map();
  const pairs = [["top", "bottom"], ["upper-wild", "lower-wild"], ["left", "right"]];
  const size = normalizedWorldSize();

  pairs.forEach(([sourceId, targetId], index) => {
    const sourceSlot = byRegionId.get(sourceId);
    const targetSlot = byRegionId.get(targetId);
    const source = buildTerrainRegion(rng, sourceSlot, types[index]);
    result.set(sourceId, source);
    result.set(targetId, rotateTerrainRegion(source, targetSlot, size));
  });

  const midSlot = byRegionId.get("mid");
  result.set("mid", buildTerrainRegion(rng, midSlot, types[0], { centered: true }));
  return slots.map((slot) => result.get(slot.regionId));
}

function buildV2Map({ seed, worldSize, teamSize, fallback = false }) {
  const size = normalizedWorldSize();
  const baseSize = { width: BASE_REFERENCE_SIZE, height: BASE_REFERENCE_SIZE };
  const fixed = scaleCoreGeometry(buildFixedGeometry(baseSize, teamSize));
  return {
    version: 2,
    seed: Number(seed) || 0,
    templateId: TERRITORY_MAP_TEMPLATE_ID,
    worldSize: size,
    safeBounds: { x: 0, y: 0, width: size.width, height: size.height },
    ...fixed,
    terrainRegions: buildTerrainRegions(seed, fixed.terrainSlots),
    fallback,
  };
}

function withinBounds(center, radius, bounds) {
  return Boolean(center && bounds) && center.x - radius >= bounds.x && center.y - radius >= bounds.y
    && center.x + radius <= bounds.x + bounds.width && center.y + radius <= bounds.y + bounds.height;
}

function capsuleWithinBounds(region, bounds) {
  const center = region?.center;
  const length = Number(region?.length);
  const width = Number(region?.width);
  const angle = Number(region?.angle);
  if (!center || !bounds || !Number.isFinite(center.x) || !Number.isFinite(center.y)
    || !Number.isFinite(length) || !Number.isFinite(width) || !Number.isFinite(angle)) return false;
  const halfLength = length / 2;
  const radius = width / 2;
  const extentX = Math.abs(Math.cos(angle)) * halfLength + radius;
  const extentY = Math.abs(Math.sin(angle)) * halfLength + radius;
  return center.x - extentX >= bounds.x && center.y - extentY >= bounds.y
    && center.x + extentX <= bounds.x + bounds.width && center.y + extentY <= bounds.y + bounds.height;
}

function axisDistance(value, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  return Math.abs(dx * (start.y - value.y) - (start.x - value.x) * dy) / length;
}

function graphConnected(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (!nodes.length || nodeIds.size !== nodes.length) return false;
  const adjacency = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of graph?.edges || []) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) return false;
    adjacency.get(edge.from).push(edge.to);
    adjacency.get(edge.to).push(edge.from);
  }
  const visited = new Set();
  const queue = [nodes[0].id];
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    queue.push(...adjacency.get(id).filter((next) => !visited.has(next)));
  }
  return visited.size === nodes.length;
}

function validateUniqueIds(values, label, errors) {
  const ids = new Set();
  for (const value of values) {
    if (!value?.id) errors.push(`${label} id missing`);
    else if (ids.has(value.id)) errors.push(`duplicate ${label} id: ${value.id}`);
    else ids.add(value.id);
  }
}

export function validateTerritoryMap(map) {
  if (!map || typeof map !== "object") return { valid: false, errors: ["map must be an object"] };
  const errors = [];
  const bounds = map.safeBounds;
  const obstacles = Array.isArray(map.obstacleRegions) ? map.obstacleRegions : [];
  const spawns = Array.isArray(map.spawnAreas) ? map.spawnAreas : [];
  const controls = Array.isArray(map.controlPoints) ? map.controlPoints : [];
  const lanes = Array.isArray(map.laneCorridors) ? map.laneCorridors : [];
  const connectors = Array.isArray(map.connectorCorridors) ? map.connectorCorridors : [];
  const resources = Array.isArray(map.resourceSpawnNodes) ? map.resourceSpawnNodes : [];
  const skills = Array.isArray(map.skillSpawnNodes) ? map.skillSpawnNodes : [];
  const terrainSlots = Array.isArray(map.terrainSlots) ? map.terrainSlots : [];
  const terrain = Array.isArray(map.terrainRegions) ? map.terrainRegions : [];
  const graphNodes = Array.isArray(map.navigationGraph?.nodes) ? map.navigationGraph.nodes : [];
  const graphEdges = Array.isArray(map.navigationGraph?.edges) ? map.navigationGraph.edges : [];
  const rotationSize = map.worldSize?.width === REFERENCE_SIZE && map.worldSize?.height === REFERENCE_SIZE
    ? map.worldSize
    : normalizedWorldSize();

  if (map.version !== 2) errors.push("map version must be 2");
  if (map.templateId !== TERRITORY_MAP_TEMPLATE_ID) errors.push(`unsupported template ${map.templateId}`);
  if (map.worldSize?.width !== REFERENCE_SIZE || map.worldSize?.height !== REFERENCE_SIZE) errors.push("world size must be 3200");
  if (!bounds || bounds.x !== 0 || bounds.y !== 0 || bounds.width !== REFERENCE_SIZE || bounds.height !== REFERENCE_SIZE) {
    errors.push("safe bounds must cover the 3200 world");
  }
  if (spawns.length !== 2) errors.push("expected two spawn areas");
  if (controls.length !== 5) errors.push("expected five control points");
  if (lanes.map((lane) => lane.id).join(",") !== LANE_IDS.join(",")) errors.push("expected top,mid,bottom lane corridors");
  if (connectors.length !== CONNECTOR_IDS.length) errors.push("expected six fixed connectors");
  if (obstacles.length < 4 || obstacles.length > 6) errors.push("expected 4-6 obstacle regions");
  if (terrainSlots.length !== 7) errors.push("expected seven terrain slots");
  if (terrain.length !== 7) errors.push("expected seven terrain regions");

  validateUniqueIds(spawns, "spawn", errors);
  validateUniqueIds(controls, "control", errors);
  validateUniqueIds(lanes, "lane", errors);
  validateUniqueIds(connectors, "connector", errors);
  validateUniqueIds(obstacles, "obstacle", errors);
  validateUniqueIds(graphNodes, "navigation node", errors);
  validateUniqueIds(graphEdges, "navigation edge", errors);
  validateUniqueIds(resources, "resource node", errors);
  validateUniqueIds(skills, "skill node", errors);
  validateUniqueIds(terrain, "terrain", errors);

  for (const expected of SPAWN_LAYOUT) {
    const spawn = spawns.find((candidate) => candidate.id === expected.id);
    if (!spawn) {
      errors.push(`required spawn missing: ${expected.id}`);
      continue;
    }
    if (spawn.allianceId !== expected.allianceId || !pointsEqual(spawn.center, point(expected.x, expected.y))) {
      errors.push(`spawn layout mismatch: ${expected.id}`);
    }
  }
  if (spawns.length === 2 && Number(spawns[0].radius) !== Number(spawns[1].radius)) errors.push("spawn radii must be rotationally paired");

  for (const expected of CONTROL_LAYOUT) {
    const control = controls.find((candidate) => candidate.id === expected.id);
    if (!control) {
      errors.push(`required control missing: ${expected.id}`);
      continue;
    }
    if (
      control.laneId !== expected.laneId
      || !pointsEqual(control.center, point(expected.x, expected.y))
      || Number(control.width) !== expected.width
      || Number(control.height) !== expected.height
      || Number(control.x) !== Math.round(expected.x - expected.width / 2)
      || Number(control.y) !== Math.round(expected.y - expected.height / 2)
    ) {
      errors.push(`control layout mismatch: ${expected.id}`);
    }
  }

  const connectorIds = new Set(connectors.map((connector) => connector.id));
  for (const id of CONNECTOR_IDS) {
    if (!connectorIds.has(id)) errors.push(`required connector missing: ${id}`);
  }
  if (connectors.filter((connector) => connector.risk === true).length !== 2) errors.push("expected two risk connectors");

  for (const obstacle of obstacles) {
    if (!["polygon", "compound"].includes(obstacle.shape)) errors.push(`invalid obstacle shape: ${obstacle.id}`);
    if (!obstacle.blocksMovement || !obstacle.blocksProjectiles || !obstacle.blocksBeam) errors.push(`obstacle flags invalid: ${obstacle.id}`);
    const mirror = obstacles.find((candidate) => candidate.id === obstacle.mirrorId);
    if (!obstacle.mirrorId || !mirror) errors.push(`obstacle mirror missing: ${obstacle.id}`);
    else if (mirror.mirrorId !== obstacle.id || !obstacleMatchesRotation(obstacle, mirror, rotationSize)) {
      errors.push(`obstacle rotation mismatch: ${obstacle.id}/${obstacle.mirrorId}`);
    }
  }

  const fixedNodes = [...spawns, ...resources, ...skills, ...terrainSlots];
  for (const node of fixedNodes) {
    if (!node?.center || !Number.isFinite(node.center.x) || !Number.isFinite(node.center.y)) {
      errors.push(`${node?.id || "node"} center invalid`);
      continue;
    }
    const radius = Math.max(1, Number(node.radius) || 1);
    if (bounds && !withinBounds(node.center, radius, bounds)) errors.push(`${node.id} outside safe bounds`);
    if (!positionClearOfObstacles(node.center, radius, obstacles)) errors.push(`${node.id} inside obstacle`);
  }

  for (const control of controls) {
    if (!control?.center || control.shape !== "rect") errors.push(`${control?.id || "control"} invalid`);
    if (!CONTROL_ZONE_IDS.includes(control?.laneId)) errors.push(`${control?.id || "control"} lane invalid`);
    if (!control.occupants || !Array.isArray(control.occupants.A) || !Array.isArray(control.occupants.B)) errors.push(`${control?.id || "control"} occupants invalid`);
    const radius = Math.max(Number(control.width) || 0, Number(control.height) || 0) / 2;
    if (control.center && !positionClearOfObstacles(control.center, radius, obstacles)) errors.push(`${control.id} inside obstacle`);
  }

  if (spawns.length === 2) {
    if (!firstObstacleHit(spawns[0].center, spawns[1].center, obstacles, 0)) errors.push("A-to-B line must be blocked");
    if (controls.length === 5 && controls.every((control) => axisDistance(control.center, spawns[0].center, spawns[1].center) < 1)) {
      errors.push("control points remain on A-to-B diagonal");
    }
  }

  for (const lane of lanes) {
    if (!Array.isArray(lane.path) || lane.path.length < 4 || Number(lane.width) < 300) errors.push(`lane corridor invalid: ${lane.id}`);
  }
  for (const expected of LANE_LAYOUT) {
    const lane = lanes.find((candidate) => candidate.id === expected.id);
    if (!lane || lane.width !== expected.width || !pathsEqual(lane.path, expected.path)) {
      errors.push(`lane layout mismatch: ${expected.id}`);
    }
  }
  for (const connector of connectors) {
    const pathValid = Array.isArray(connector.path)
      && connector.path.length >= 2
      && connector.path.every((value) => Number.isFinite(value?.x) && Number.isFinite(value?.y));
    if (!pathValid || connector.fromLaneId === connector.toLaneId) errors.push(`connector invalid: ${connector.id}`);
    const mirror = connectors.find((candidate) => candidate.id === connector.mirrorId);
    if (!connector.mirrorId || !mirror) errors.push(`connector mirror missing: ${connector.id}`);
    else if (pathValid && !connectorMatchesRotation(connector, mirror, rotationSize)) {
      errors.push(`connector rotation mismatch: ${connector.id}/${connector.mirrorId}`);
    }
  }
  for (const expected of CONNECTOR_LAYOUT) {
    const connector = connectors.find((candidate) => candidate.id === expected.id);
    if (
      !connector
      || connector.mirrorId !== expected.mirrorId
      || connector.fromLaneId !== expected.fromLaneId
      || connector.toLaneId !== expected.toLaneId
      || connector.width !== expected.width
      || connector.risk !== expected.risk
      || !pathsEqual(connector.path, expected.path)
    ) {
      errors.push(`connector layout mismatch: ${expected.id}`);
    }
  }

  const graphById = new Map(graphNodes.map((node) => [node.id, node]));
  const graphNodeIds = new Set(graphNodes.map((node) => node.id));
  const graphEdgeIds = new Set(graphEdges.map((edge) => edge.id));
  if (graphNodes.length !== NAVIGATION_NODE_IDS.length) errors.push(`navigation node count mismatch: ${graphNodes.length}`);
  if (graphEdges.length !== NAVIGATION_EDGE_IDS.length) errors.push(`navigation edge count mismatch: ${graphEdges.length}`);
  for (const id of NAVIGATION_NODE_IDS) {
    if (!graphNodeIds.has(id)) errors.push(`required navigation node missing: ${id}`);
  }
  for (const id of NAVIGATION_EDGE_IDS) {
    if (!graphEdgeIds.has(id)) errors.push(`required navigation edge missing: ${id}`);
  }
  if (!graphConnected(map.navigationGraph)) errors.push("navigation graph disconnected");
  for (const node of graphNodes) {
    if (!node?.center || !Number.isFinite(node.center.x) || !Number.isFinite(node.center.y)) {
      errors.push(`${node?.id || "navigation node"} center invalid`);
      continue;
    }
    if (!positionClearOfObstacles(node.center, Number(node.clearance) || 24, obstacles)) errors.push(`navigation node blocked: ${node.id}`);
  }
  for (const edge of graphEdges) {
    const from = graphById.get(edge.from)?.center;
    const to = graphById.get(edge.to)?.center;
    if (!from || !to) continue;
    if (firstObstacleHit(from, to, obstacles, Number(edge.clearance) || 18)) errors.push(`navigation edge blocked: ${edge.id}`);
  }

  for (const laneId of LANE_IDS) {
    if (resources.filter((node) => node.rarity === "common" && node.laneId === laneId).length !== 2) errors.push(`common resource distribution invalid: ${laneId}`);
  }
  for (const laneId of ["left", "right"]) {
    if (resources.filter((node) => node.rarity === "common" && node.laneId === laneId).length !== 1) errors.push(`side resource distribution invalid: ${laneId}`);
  }
  if (!resources.some((node) => node.rarity === "rare" && node.regionId === "upper-wild")) errors.push("upper wild rare resource missing");
  if (!resources.some((node) => node.rarity === "rare" && node.regionId === "lower-wild")) errors.push("lower wild rare resource missing");
  if (new Set(skills.map((node) => node.regionId)).size !== 7) errors.push("skill strategy groups incomplete");

  const terrainByRegionId = new Map(terrain.map((region) => [region.regionId, region]));
  for (const [sourceId, targetId] of [["top", "bottom"], ["upper-wild", "lower-wild"], ["left", "right"]]) {
    const source = terrainByRegionId.get(sourceId);
    const target = terrainByRegionId.get(targetId);
    if (!terrainMatchesRotation(source, target, rotationSize)) errors.push(`terrain rotation mismatch: ${sourceId}/${targetId}`);
  }
  const midTerrain = terrainByRegionId.get("mid");
  if (!terrainMatchesRotation(midTerrain, midTerrain, rotationSize)) errors.push("terrain rotation mismatch: mid");

  for (const region of terrain) {
    if (!TERRAIN_TYPES.includes(region.type)) errors.push(`invalid terrain type: ${region.type}`);
    if (region.blocksPath) errors.push(`terrain blocks path: ${region.id}`);
    if (!region.center || !Number.isFinite(region.center.x) || !Number.isFinite(region.center.y)) {
      errors.push(`terrain center invalid: ${region.id}`);
      continue;
    }
    if (region.shape === "compound") {
      if (region.type === "speed_lane") errors.push(`compound terrain type invalid: ${region.id}`);
      if (!Number.isFinite(region.radius) || region.radius < scaleCoreLength(220) || region.radius > scaleCoreLength(360)) errors.push(`compound terrain envelope invalid: ${region.id}`);
      if (!Array.isArray(region.fields) || region.fields.length < 3) errors.push(`compound terrain fields invalid: ${region.id}`);
      for (const field of region.fields || []) {
        const fieldRadius = Number(field?.radius) || 0;
        const coreRadius = Number(field?.coreRadius) || 0;
        if (!Number.isFinite(field?.x) || !Number.isFinite(field?.y) || coreRadius <= 0 || coreRadius >= fieldRadius) {
          errors.push(`compound terrain field invalid: ${region.id}`);
          continue;
        }
        if (bounds && !withinBounds(field, fieldRadius, bounds)) errors.push(`compound terrain outside safe bounds: ${region.id}`);
        if (Math.hypot(field.x - region.center.x, field.y - region.center.y) + fieldRadius > region.radius) {
          errors.push(`compound terrain field outside envelope: ${region.id}`);
        }
      }
    } else if (region.type === "speed_lane") {
      if (region.shape !== "capsule" || !Number.isFinite(region.length) || !Number.isFinite(region.width)
        || !Number.isFinite(region.angle) || region.length < scaleCoreLength(600) || region.length > scaleCoreLength(1000) || region.width < scaleCoreLength(220) || region.width > scaleCoreLength(320)) {
        errors.push(`speed lane terrain dimensions invalid: ${region.id}`);
      }
      if (bounds && !capsuleWithinBounds(region, bounds)) errors.push(`speed lane terrain outside safe bounds: ${region.id}`);
    } else {
      errors.push(`terrain shape invalid: ${region.id}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function generateTerritoryMap({
  seed = 0,
  templateId = TERRITORY_MAP_TEMPLATE_ID,
  worldSize = null,
  teamSize = 1,
} = {}) {
  const fallback = templateId !== TERRITORY_MAP_TEMPLATE_ID;
  const map = buildV2Map({ seed, worldSize, teamSize, fallback });
  if (validateTerritoryMap(map).valid) return map;
  return buildV2Map({ seed: 0, worldSize, teamSize, fallback: true });
}
