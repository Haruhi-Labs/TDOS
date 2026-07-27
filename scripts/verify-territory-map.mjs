import { createSeededRng } from "../shared/gameplay/seeded-rng.js";
import { generateTerritoryMap, validateTerritoryMap } from "../shared/gameplay/territory-map.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stableJson(value) {
  return JSON.stringify(value);
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
assert(
  stableJson(mapSeqBeforeResource) === stableJson(mapSeqAfterResource),
  "substreams should be independent and repeatable",
);

const mapA = generateTerritoryMap({
  seed: 111,
  templateId: "three-lane-v1",
  worldSize: { width: 1200, height: 800 },
  teamSize: 1,
});
const mapB = generateTerritoryMap({
  seed: 111,
  templateId: "three-lane-v1",
  worldSize: { width: 1200, height: 800 },
  teamSize: 1,
});
assert(stableJson(mapA) === stableJson(mapB), "same seed should produce identical maps");

const mapC = generateTerritoryMap({
  seed: 112,
  templateId: "three-lane-v1",
  worldSize: { width: 1200, height: 800 },
  teamSize: 1,
});
assert(stableJson(mapA) !== stableJson(mapC), "different seed should change part of the map");
assert(
  stableJson(mapA.controlPoints) === stableJson(mapC.controlPoints),
  "control points must stay fixed across random seeds",
);

const validation = validateTerritoryMap(mapA);
assert(validation.valid, `generated map should be valid: ${validation.errors.join("; ")}`);
assert(mapA.templateId === "three-lane-v1", "map template recorded");
assert(mapA.spawnAreas.length === 2, "map has A and B spawn areas");
const spawnA = mapA.spawnAreas.find((area) => area.allianceId === "A");
const spawnB = mapA.spawnAreas.find((area) => area.allianceId === "B");
assert(spawnA, "map has A spawn area");
assert(spawnB, "map has B spawn area");
assert(spawnA.center.x < mapA.worldSize.width * 0.16, "A spawn should be in the lower-left corner");
assert(spawnA.center.y > mapA.worldSize.height * 0.84, "A spawn should be in the lower-left corner");
assert(spawnB.center.x > mapA.worldSize.width * 0.84, "B spawn should be in the upper-right corner");
assert(spawnB.center.y < mapA.worldSize.height * 0.16, "B spawn should be in the upper-right corner");
assert(mapA.controlPoints.length === 3, "map has three control points");
const expectedControlPoints = [
  ["alpha", "A", 0.32, 0.68],
  ["beta", "B", 0.5, 0.5],
  ["gamma", "C", 0.68, 0.32],
];
for (let index = 0; index < expectedControlPoints.length; index += 1) {
  const [id, label, xRatio, yRatio] = expectedControlPoints[index];
  const point = mapA.controlPoints[index];
  assert(point.id === id, `control point ${index} id should be ${id}`);
  assert(point.label === label, `control point ${id} label should be ${label}`);
  assert(point.shape === "rect", `control point ${id} should be rectangular`);
  assert(Math.abs(point.center.x - mapA.worldSize.width * xRatio) <= 1, `control point ${id} x should be fixed`);
  assert(Math.abs(point.center.y - mapA.worldSize.height * yRatio) <= 1, `control point ${id} y should be fixed`);
  assert(point.width >= 280 && point.width <= 340, `control point ${id} width should be large, got ${point.width}`);
  assert(point.height >= 200 && point.height <= 260, `control point ${id} height should be large, got ${point.height}`);
  assert(!("radius" in point), `control point ${id} must not use legacy radius`);
  assert(point.ownerAllianceId === null, `control point ${id} starts neutral`);
  assert(point.capturingAllianceId === null, `control point ${id} starts with no capturer`);
  assert(point.captureProgress === 0, `control point ${id} starts at zero capture`);
  assert(point.contested === false, `control point ${id} starts uncontested`);
  assert(Array.isArray(point.occupants?.A), `control point ${id} tracks A occupants`);
  assert(Array.isArray(point.occupants?.B), `control point ${id} tracks B occupants`);
}
assert(mapA.resourceSpawnNodes.some((node) => node.rarity === "common"), "map has common resource nodes");
assert(mapA.resourceSpawnNodes.some((node) => node.rarity === "rare"), "map has rare resource nodes");
assert(mapA.skillSpawnNodes.length >= 2, "map has skill spawn nodes");
assert(mapA.terrainRegions.length >= 3 && mapA.terrainRegions.length <= 4, "map has 3-4 terrain regions");
assert(mapA.lanes.length >= 3, "map records primary lanes");
assert(mapA.safeBounds && mapA.safeBounds.width > 0 && mapA.safeBounds.height > 0, "map records safe bounds");

const invalid = validateTerritoryMap({
  ...mapA,
  spawnAreas: [
    { ...mapA.spawnAreas[0], center: { ...mapA.controlPoints[0].center }, radius: Math.max(mapA.controlPoints[0].width, mapA.controlPoints[0].height) / 2 },
    mapA.spawnAreas[1],
  ],
});
assert(!invalid.valid && invalid.errors.some((error) => error.includes("spawn overlaps control")), "validator catches overlap");

const fallback = generateTerritoryMap({
  seed: 999,
  templateId: "bad-template",
  worldSize: { width: 1200, height: 800 },
  teamSize: 1,
  maxAttempts: 1,
});
assert(fallback.templateId === "three-lane-v1", "unsupported template should fall back to safe template");
assert(validateTerritoryMap(fallback).valid, "fallback map should be valid");

for (let seed = 1; seed <= 1000; seed += 1) {
  const map = generateTerritoryMap({
    seed,
    templateId: "three-lane-v1",
    worldSize: { width: 1200, height: 800 },
    teamSize: 3,
  });
  const result = validateTerritoryMap(map);
  assert(result.valid, `seed ${seed} generated invalid map: ${result.errors.join("; ")}`);
}

console.log("territory map verification passed");
