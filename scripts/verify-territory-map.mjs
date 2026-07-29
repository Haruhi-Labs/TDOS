import { createSeededRng } from "../shared/gameplay/seeded-rng.js";
import {
  firstObstacleHit,
  positionClearOfObstacles,
} from "../shared/gameplay/territory-obstacles.js";
import {
  generateTerritoryMap,
  TERRITORY_MAP_TEMPLATE_ID,
  validateTerritoryMap,
} from "../shared/gameplay/territory-map.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stableJson(value) {
  return JSON.stringify(value);
}

function pointOf(node) {
  return node?.center || node?.position || null;
}

function topologySnapshot(map) {
  return {
    version: map.version,
    templateId: map.templateId,
    worldSize: map.worldSize,
    safeBounds: map.safeBounds,
    spawnAreas: map.spawnAreas,
    controlPoints: map.controlPoints,
    laneCorridors: map.laneCorridors,
    obstacleRegions: map.obstacleRegions,
    connectorCorridors: map.connectorCorridors,
    navigationGraph: map.navigationGraph,
    terrainSlots: map.terrainSlots,
    resourceSpawnNodes: map.resourceSpawnNodes,
    skillSpawnNodes: map.skillSpawnNodes,
  };
}

function axisDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  return Math.abs(dx * (start.y - point.y) - (start.x - point.x) * dy) / length;
}

function assertRotatedPoint(a, b, size, message) {
  assert(a && b, `${message}: points missing`);
  assert(a.x + b.x === size.width && a.y + b.y === size.height, `${message}: ${stableJson({ a, b, size })}`);
}

function assertRotatedPath(a, b, size, message) {
  assert(Array.isArray(a) && Array.isArray(b) && a.length === b.length, `${message}: path length mismatch`);
  for (let index = 0; index < a.length; index += 1) {
    assertRotatedPoint(a[index], b[b.length - 1 - index], size, `${message} point ${index}`);
  }
}

function assertGraphConnected(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const adjacency = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    assert(adjacency.has(edge.from) && adjacency.has(edge.to), `graph edge references missing node: ${stableJson(edge)}`);
    adjacency.get(edge.from).push(edge.to);
    adjacency.get(edge.to).push(edge.from);
  }
  const visited = new Set();
  const queue = nodes.length ? [nodes[0].id] : [];
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    queue.push(...(adjacency.get(id) || []).filter((next) => !visited.has(next)));
  }
  assert(nodes.length > 12 && edges.length > 12, `navigation graph should cover strategic nodes: ${nodes.length}/${edges.length}`);
  assert(visited.size === nodes.length, `navigation graph disconnected: visited ${visited.size}/${nodes.length}`);
}

function validationResult(map) {
  try {
    return { threw: false, result: validateTerritoryMap(map) };
  } catch (error) {
    return { threw: true, error: error instanceof Error ? error.message : String(error) };
  }
}

const rngA = createSeededRng(12345);
const rngB = createSeededRng(12345);
const seqA = [rngA.next(), rngA.nextInt(1, 10), rngA.pick(["a", "b", "c"]), rngA.shuffle([1, 2, 3, 4]).join(",")];
const seqB = [rngB.next(), rngB.nextInt(1, 10), rngB.pick(["a", "b", "c"]), rngB.shuffle([1, 2, 3, 4]).join(",")];
assert(stableJson(seqA) === stableJson(seqB), "same seed should produce same rng sequence");

const rngC = createSeededRng(54321);
const seqC = [rngC.next(), rngC.nextInt(1, 10), rngC.pick(["a", "b", "c"]), rngC.shuffle([1, 2, 3, 4]).join(",")];
assert(stableJson(seqA) !== stableJson(seqC), "different seed should produce different rng sequence");

const rootA = createSeededRng(24680);
const mapStreamBeforeResource = rootA.fork("map");
const mapSeqBeforeResource = [mapStreamBeforeResource.next(), mapStreamBeforeResource.next(), mapStreamBeforeResource.next()];
rootA.fork("resource").next();
rootA.fork("skill").next();
const mapStreamAfterResource = rootA.fork("map");
const mapSeqAfterResource = [mapStreamAfterResource.next(), mapStreamAfterResource.next(), mapStreamAfterResource.next()];
assert(stableJson(mapSeqBeforeResource) === stableJson(mapSeqAfterResource), "substreams should be independent and repeatable");

const request = {
  templateId: "three-lane-v2",
  worldSize: { width: 3200, height: 3200 },
  teamSize: 3,
};
const mapA = generateTerritoryMap({ ...request, seed: 111 });
const mapB = generateTerritoryMap({ ...request, seed: 111 });
const mapC = generateTerritoryMap({ ...request, seed: 112 });

assert(stableJson(mapA) === stableJson(mapB), "same seed should produce identical maps");
assert(stableJson(mapA) !== stableJson(mapC), "different seed should vary terrain content");
assert(stableJson(topologySnapshot(mapA)) === stableJson(topologySnapshot(mapC)), "fixed topology must not vary by seed");
assert(stableJson(mapA.terrainRegions) !== stableJson(mapC.terrainRegions), "seed should vary generated terrain regions");

const validation = validateTerritoryMap(mapA);
assert(validation.valid, `generated V2 map should be valid: ${validation.errors.join("; ")}`);
assert(TERRITORY_MAP_TEMPLATE_ID === "three-lane-v2", `exported V2 template id: ${TERRITORY_MAP_TEMPLATE_ID}`);
assert(mapA.templateId === "three-lane-v2" && mapA.version === 2, `V2 identity: ${mapA.templateId}/${mapA.version}`);
assert(stableJson(mapA.worldSize) === stableJson({ width: 3200, height: 3200 }), `V2 world size: ${stableJson(mapA.worldSize)}`);
assert(mapA.safeBounds?.width === 3200 && mapA.safeBounds?.height === 3200, `V2 safe bounds: ${stableJson(mapA.safeBounds)}`);

const spawnA = mapA.spawnAreas.find((area) => area.allianceId === "A");
const spawnB = mapA.spawnAreas.find((area) => area.allianceId === "B");
assert(spawnA?.center.x < 700 && spawnA?.center.y > 2500, `A spawn should remain lower-left: ${stableJson(spawnA)}`);
assert(spawnB?.center.x > 2500 && spawnB?.center.y < 700, `B spawn should remain upper-right: ${stableJson(spawnB)}`);
assertRotatedPoint(spawnA.center, spawnB.center, mapA.worldSize, "spawn rotation");

const expectedControls = [
  ["control-top", "top", 1325, 662.5, 425, 300],
  ["control-mid", "mid", 1600, 1600, 450, 325],
  ["control-bottom", "bottom", 1875, 2537.5, 425, 300],
  ["control-left", "left", 520, 1600, 425, 300],
  ["control-right", "right", 2680, 1600, 425, 300],
];
assert(mapA.controlPoints.length === expectedControls.length, "map has exactly five control points");
for (let index = 0; index < expectedControls.length; index += 1) {
  const [id, laneId, x, y, width, height] = expectedControls[index];
  const control = mapA.controlPoints[index];
  assert(
    control.id === id && control.laneId === laneId && control.center.x === x && control.center.y === y,
    `control ${index} identity/location: ${stableJson(control)}`,
  );
  assert(control.shape === "rect" && control.width === width && control.height === height, `control ${id} size: ${stableJson(control)}`);
  assert(control.ownerAllianceId === null && control.captureProgress === 0 && control.contested === false, `control ${id} neutral state`);
}
assertRotatedPoint(mapA.controlPoints[0].center, mapA.controlPoints[2].center, mapA.worldSize, "top/bottom control rotation");
assertRotatedPoint(mapA.controlPoints[3].center, mapA.controlPoints[4].center, mapA.worldSize, "left/right control rotation");
assert(
  mapA.controlPoints.some((control) => axisDistance(control.center, spawnA.center, spawnB.center) > 200),
  "control points must not all remain on the A-to-B base diagonal",
);

assert(mapA.laneCorridors.map((lane) => lane.id).join(",") === "top,mid,bottom", `three named lanes: ${stableJson(mapA.laneCorridors)}`);
assert(stableJson(mapA.laneCorridors.map((lane) => lane.width)) === stableJson([425, 475, 425]), "lane widths should match expanded V2 design");
assert(mapA.laneCorridors.every((lane) => Array.isArray(lane.path) && lane.path.length >= 4), "each lane has an explicit corridor path");
assertRotatedPath(mapA.laneCorridors[0].path, mapA.laneCorridors[2].path, mapA.worldSize, "top/bottom lane rotation");

assert(mapA.connectorCorridors.length >= 4, `at least four cross-lane connectors: ${mapA.connectorCorridors.length}`);
assert(mapA.connectorCorridors.every((connector) => Array.isArray(connector.path) && connector.path.length >= 2), "connectors have explicit paths");
assert(mapA.connectorCorridors.every((connector) => connector.fromLaneId !== connector.toLaneId), "connectors cross lane boundaries");

assert(mapA.obstacleRegions.length >= 4 && mapA.obstacleRegions.length <= 6, `four to six hard obstacles: ${mapA.obstacleRegions.length}`);
assert(mapA.obstacleRegions.every((obstacle) => obstacle.blocksMovement && obstacle.blocksProjectiles && obstacle.blocksBeam), "every obstacle blocks movement/projectiles/beams");
assert(mapA.obstacleRegions.every((obstacle) => ["polygon", "compound"].includes(obstacle.shape)), "obstacles use irregular/compound shapes");
assert(firstObstacleHit(spawnA.center, spawnB.center, mapA.obstacleRegions, 0), "A-to-B direct line must be blocked");

const graphNodes = mapA.navigationGraph.nodes;
const graphById = new Map(graphNodes.map((node) => [node.id, node]));
assertGraphConnected(mapA.navigationGraph);
for (const node of graphNodes) {
  assert(positionClearOfObstacles(pointOf(node), Number(node.clearance) || 24, mapA.obstacleRegions), `graph node blocked: ${stableJson(node)}`);
}
for (const edge of mapA.navigationGraph.edges) {
  const from = pointOf(graphById.get(edge.from));
  const to = pointOf(graphById.get(edge.to));
  assert(!firstObstacleHit(from, to, mapA.obstacleRegions, Number(edge.clearance) || 18), `graph edge blocked: ${stableJson(edge)}`);
}

for (const node of [...mapA.resourceSpawnNodes, ...mapA.skillSpawnNodes]) {
  assert(positionClearOfObstacles(node.center, node.radius, mapA.obstacleRegions), `candidate node blocked: ${stableJson(node)}`);
}
for (const laneId of ["top", "mid", "bottom"]) {
  assert(
    mapA.resourceSpawnNodes.filter((node) => node.rarity === "common" && node.laneId === laneId).length === 2,
    `${laneId} should have two common resource candidates`,
  );
}
assert(mapA.resourceSpawnNodes.some((node) => node.rarity === "rare" && node.regionId === "upper-wild"), "upper wild has rare resource candidates");
assert(mapA.resourceSpawnNodes.some((node) => node.rarity === "rare" && node.regionId === "lower-wild"), "lower wild has rare resource candidates");
for (const laneId of ["left", "right"]) {
  assert(
    mapA.resourceSpawnNodes.filter((node) => node.rarity === "common" && node.laneId === laneId).length === 1,
    `${laneId} should have one common resource candidate`,
  );
}
assert(
  new Set(mapA.skillSpawnNodes.map((node) => node.regionId)).size === 7,
  `skill candidates should cover seven strategy regions: ${stableJson(mapA.skillSpawnNodes)}`,
);
assert(mapA.terrainSlots.length === 7, `seven fixed terrain slots: ${stableJson(mapA.terrainSlots)}`);
assert(mapA.terrainRegions.length === 7, `seven fixed terrain regions: ${mapA.terrainRegions.length}`);
for (const [first, second] of [["top", "bottom"], ["upper-wild", "lower-wild"], ["left", "right"]]) {
  const source = mapA.terrainRegions.find((region) => region.regionId === first);
  const mirror = mapA.terrainRegions.find((region) => region.regionId === second);
  assert(source?.type === mirror?.type, `${first}/${second} terrain types should match`);
  assertRotatedPoint(source?.center, mirror?.center, mapA.worldSize, `${first}/${second} terrain rotation`);
}

const invalid = validateTerritoryMap({
  ...mapA,
  navigationGraph: {
    ...mapA.navigationGraph,
    nodes: mapA.navigationGraph.nodes.map((node, index) => (
      index === 0 ? { ...node, center: { ...pointOf(mapA.obstacleRegions[0]) } } : node
    )),
  },
});
assert(!invalid.valid, `validator must reject an invalid navigation graph: ${stableJson(invalid)}`);

const invalidTerrainCenter = validateTerritoryMap({
  ...mapA,
  terrainRegions: mapA.terrainRegions.map((region, index) => (
    index === 0 ? { ...region, center: { ...region.center, x: Number.NaN } } : region
  )),
});
assert(
  !invalidTerrainCenter.valid && invalidTerrainCenter.errors.some((error) => error.includes("terrain center invalid")),
  `validator must reject terrain with a non-finite center: ${stableJson(invalidTerrainCenter)}`,
);

const templateCompound = mapA.terrainRegions.find((region) => region.shape === "compound");
const templateLane = mapA.terrainRegions.find((region) => region.type === "speed_lane");
assert(templateCompound && templateLane, `terrain validation fixtures missing: ${stableJson(mapA.terrainRegions)}`);
const invalidTerrainSchemaCases = [
  [
    "missing terrain id",
    validateTerritoryMap({
      ...mapA,
      terrainRegions: mapA.terrainRegions.map((region) => (
        region.id === templateCompound.id ? { ...region, id: "" } : region
      )),
    }),
    "terrain id missing",
  ],
  [
    "duplicate terrain id",
    validateTerritoryMap({
      ...mapA,
      terrainRegions: mapA.terrainRegions.map((region, index) => (
        index === 1 ? { ...region, id: mapA.terrainRegions[0].id } : region
      )),
    }),
    "duplicate terrain id",
  ],
  [
    "compound speed lane",
    validateTerritoryMap({
      ...mapA,
      terrainRegions: mapA.terrainRegions.map((region) => (
        region.id === templateCompound.id ? { ...region, type: "speed_lane" } : region
      )),
    }),
    "compound terrain type invalid",
  ],
  [
    "compound missing envelope",
    validateTerritoryMap({
      ...mapA,
      terrainRegions: mapA.terrainRegions.map((region) => (
        region.id === templateCompound.id ? { ...region, radius: Number.NaN } : region
      )),
    }),
    "compound terrain envelope invalid",
  ],
  [
    "field beyond compound envelope",
    validateTerritoryMap({
      ...mapA,
      terrainRegions: mapA.terrainRegions.map((region) => (
        region.id === templateCompound.id
          ? {
            ...region,
            fields: region.fields.map((field, index) => (
              index === 0
                ? { ...field, x: region.center.x + region.radius + field.radius + 1 }
                : field
            )),
          }
          : region
      )),
    }),
    "compound terrain field outside envelope",
  ],
  [
    "non-finite lane dimensions",
    validateTerritoryMap({
      ...mapA,
      terrainRegions: mapA.terrainRegions.map((region) => (
        region.id === templateLane.id ? { ...region, length: Number.NaN, width: Number.NaN } : region
      )),
    }),
    "speed lane terrain dimensions invalid",
  ],
  [
    "lane outside safe bounds",
    validateTerritoryMap({
      ...mapA,
      terrainRegions: mapA.terrainRegions.map((region) => (
        region.id === templateLane.id ? { ...region, center: { x: -600, y: -600 } } : region
      )),
    }),
    "speed lane terrain outside safe bounds",
  ],
];
assert(
  invalidTerrainSchemaCases.every(([, result, expectedError]) => (
    !result.valid && result.errors.some((error) => error.includes(expectedError))
  )),
  `validator must reject malformed terrain schemas: ${stableJson(invalidTerrainSchemaCases)}`,
);

const asymmetricObstacleMap = JSON.parse(stableJson(mapA));
asymmetricObstacleMap.obstacleRegions.find((obstacle) => obstacle.id === "obstacle-lower-east").points[0].x += 1;
const asymmetricObstacle = validateTerritoryMap(asymmetricObstacleMap);
assert(
  !asymmetricObstacle.valid && asymmetricObstacle.errors.some((error) => error.includes("obstacle rotation mismatch")),
  `validator must reject obstacle mirror drift: ${stableJson(asymmetricObstacle)}`,
);

const asymmetricConnectorMap = JSON.parse(stableJson(mapA));
asymmetricConnectorMap.connectorCorridors.find((connector) => connector.id === "connector-mid-bottom-east").path[0].x += 1;
const asymmetricConnector = validateTerritoryMap(asymmetricConnectorMap);
assert(
  !asymmetricConnector.valid && asymmetricConnector.errors.some((error) => error.includes("connector rotation mismatch")),
  `validator must reject connector mirror drift: ${stableJson(asymmetricConnector)}`,
);

const asymmetricTerrainMap = JSON.parse(stableJson(mapA));
asymmetricTerrainMap.terrainRegions.find((region) => region.regionId === "bottom").center.x += 1;
const asymmetricTerrain = validateTerritoryMap(asymmetricTerrainMap);
assert(
  !asymmetricTerrain.valid && asymmetricTerrain.errors.some((error) => error.includes("terrain rotation mismatch")),
  `validator must reject terrain mirror drift: ${stableJson(asymmetricTerrain)}`,
);

const oversizedRequest = generateTerritoryMap({ ...request, seed: 111, worldSize: { width: 2400, height: 2400 } });
const oversizedValidation = validateTerritoryMap(oversizedRequest);
assert(
  stableJson(oversizedRequest.worldSize) === stableJson({ width: 3200, height: 3200 }) && oversizedValidation.valid,
  `V2 should normalize unsupported world dimensions to a valid 3200 map: ${stableJson({ map: oversizedRequest.worldSize, oversizedValidation })}`,
);

const missingControlNodeMap = JSON.parse(stableJson(mapA));
missingControlNodeMap.navigationGraph.nodes = missingControlNodeMap.navigationGraph.nodes
  .filter((node) => node.id !== "nav-control-top");
missingControlNodeMap.navigationGraph.edges = missingControlNodeMap.navigationGraph.edges
  .filter((edge) => edge.from !== "nav-control-top" && edge.to !== "nav-control-top");
const missingControlNode = validateTerritoryMap(missingControlNodeMap);
assert(
  !missingControlNode.valid && missingControlNode.errors.some((error) => error.includes("required navigation node missing")),
  `validator must reject connected graphs without every strategic node: ${stableJson(missingControlNode)}`,
);

const fixedTopologyDriftCases = [];
const missingBoundsMap = JSON.parse(stableJson(mapA));
delete missingBoundsMap.safeBounds;
fixedTopologyDriftCases.push(["missing safe bounds", validationResult(missingBoundsMap), "safe bounds"]);
const shiftedControlMap = JSON.parse(stableJson(mapA));
shiftedControlMap.controlPoints[0].center.x += 1;
fixedTopologyDriftCases.push(["shifted control", validationResult(shiftedControlMap), "control layout mismatch"]);
const wrongControlIdMap = JSON.parse(stableJson(mapA));
wrongControlIdMap.controlPoints[0].id = "control-wrong";
fixedTopologyDriftCases.push(["wrong control id", validationResult(wrongControlIdMap), "required control missing"]);
const duplicateControlLaneMap = JSON.parse(stableJson(mapA));
duplicateControlLaneMap.controlPoints[2].laneId = "mid";
fixedTopologyDriftCases.push(["duplicate control lane", validationResult(duplicateControlLaneMap), "control layout mismatch"]);
const badSpawnAllianceMap = JSON.parse(stableJson(mapA));
badSpawnAllianceMap.spawnAreas[0].allianceId = "B";
fixedTopologyDriftCases.push(["bad spawn alliance", validationResult(badSpawnAllianceMap), "spawn layout mismatch"]);
const missingRiskConnectorsMap = JSON.parse(stableJson(mapA));
missingRiskConnectorsMap.connectorCorridors = missingRiskConnectorsMap.connectorCorridors.filter((connector) => !connector.risk);
fixedTopologyDriftCases.push(["missing risk connectors", validationResult(missingRiskConnectorsMap), "expected six fixed connectors"]);
const reassignedRiskConnectorsMap = JSON.parse(stableJson(mapA));
for (const connector of reassignedRiskConnectorsMap.connectorCorridors) {
  connector.risk = ["connector-top-mid-west", "connector-mid-bottom-east"].includes(connector.id);
}
fixedTopologyDriftCases.push(["reassigned risk connectors", validationResult(reassignedRiskConnectorsMap), "connector layout mismatch"]);
const crossMapConnectorsMap = JSON.parse(stableJson(mapA));
for (const connector of crossMapConnectorsMap.connectorCorridors) {
  connector.fromLaneId = "top";
  connector.toLaneId = "bottom";
}
fixedTopologyDriftCases.push(["cross-map connector lanes", validationResult(crossMapConnectorsMap), "connector layout mismatch"]);
const renamedConnectorMap = JSON.parse(stableJson(mapA));
const renamedConnector = renamedConnectorMap.connectorCorridors
  .find((connector) => connector.id === "connector-top-mid-west");
const renamedConnectorMirror = renamedConnectorMap.connectorCorridors
  .find((connector) => connector.id === "connector-mid-bottom-east");
renamedConnector.id = "connector-top-mid-west-renamed";
renamedConnectorMirror.mirrorId = renamedConnector.id;
fixedTopologyDriftCases.push(["coordinated connector id rename", validationResult(renamedConnectorMap), "required connector missing"]);
const malformedConnectorPathMap = JSON.parse(stableJson(mapA));
malformedConnectorPathMap.connectorCorridors
  .find((connector) => connector.id === "connector-top-mid-west").path = {};
fixedTopologyDriftCases.push(["malformed connector path", validationResult(malformedConnectorPathMap), "connector invalid"]);
const malformedConnectorPointMap = JSON.parse(stableJson(mapA));
malformedConnectorPointMap.connectorCorridors
  .find((connector) => connector.id === "connector-top-mid-west").path[0] = null;
fixedTopologyDriftCases.push(["malformed connector path point", validationResult(malformedConnectorPointMap), "connector invalid"]);
const mirroredConnectorWidthMap = JSON.parse(stableJson(mapA));
const widenedConnector = mirroredConnectorWidthMap.connectorCorridors
  .find((connector) => connector.id === "connector-top-mid-west");
const widenedConnectorMirror = mirroredConnectorWidthMap.connectorCorridors
  .find((connector) => connector.id === "connector-mid-bottom-east");
widenedConnector.width += 1;
widenedConnectorMirror.width += 1;
fixedTopologyDriftCases.push(["mirrored connector width", validationResult(mirroredConnectorWidthMap), "connector layout mismatch"]);
const mirroredConnectorPathMap = JSON.parse(stableJson(mapA));
const shiftedConnector = mirroredConnectorPathMap.connectorCorridors
  .find((connector) => connector.id === "connector-top-mid-west");
const shiftedConnectorMirror = mirroredConnectorPathMap.connectorCorridors
  .find((connector) => connector.id === "connector-mid-bottom-east");
shiftedConnector.path[0].x += 1;
shiftedConnectorMirror.path[shiftedConnectorMirror.path.length - 1].x -= 1;
fixedTopologyDriftCases.push(["mirrored connector path", validationResult(mirroredConnectorPathMap), "connector layout mismatch"]);
const widenedLaneMap = JSON.parse(stableJson(mapA));
widenedLaneMap.laneCorridors.find((lane) => lane.id === "top").width = 999;
fixedTopologyDriftCases.push(["widened fixed lane", validationResult(widenedLaneMap), "lane layout mismatch"]);
assert(
  fixedTopologyDriftCases.every(([, outcome, expectedError]) => (
    !outcome.threw
    && outcome.result?.valid === false
    && outcome.result.errors.some((error) => error.includes(expectedError))
  )),
  `validator must reject fixed-topology drift without throwing: ${stableJson(fixedTopologyDriftCases)}`,
);

const fallback = generateTerritoryMap({ ...request, seed: 999, templateId: "bad-template", maxAttempts: 1 });
assert(fallback.templateId === "three-lane-v2" && fallback.version === 2, "unsupported template falls back to deterministic V2");
assert(validateTerritoryMap(fallback).valid, "fallback V2 map should be valid");

const fixedTopology = stableJson(topologySnapshot(mapA));
for (let seed = 1; seed <= 1000; seed += 1) {
  const map = generateTerritoryMap({ ...request, seed });
  const result = validateTerritoryMap(map);
  assert(result.valid, `seed ${seed} generated invalid map: ${result.errors.join("; ")}`);
  assert(stableJson(topologySnapshot(map)) === fixedTopology, `seed ${seed} changed fixed topology`);
  assert(firstObstacleHit(map.spawnAreas[0].center, map.spawnAreas[1].center, map.obstacleRegions, 0), `seed ${seed} opened direct base line`);
}

console.log("territory map verification passed");
