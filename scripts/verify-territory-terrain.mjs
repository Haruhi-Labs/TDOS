import { DEFAULT_AI_LOADOUT, DEFAULT_TEAM_LOADOUT, MatchSimulation, TICK_DT, cloneLoadout } from "../shared/game-core.js";
import {
  TERRAIN_MOVEMENT_MULTIPLIERS,
  pointInTerrainRegion,
  terrainIntensityAtPoint,
  updateTerritoryTerrainModifiers,
} from "../shared/gameplay/territory-terrain.js";
import { stellarTerritoryMode } from "../shared/modes/stellar-territory.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function approximatelyEqual(actual, expected, message) {
  assert(Math.abs(actual - expected) < 1e-6, `${message}: expected ${expected}, got ${actual}`);
}

function makeSimulation() {
  return new MatchSimulation({
    mode: "ai",
    teamLoadouts: { A: cloneLoadout(DEFAULT_TEAM_LOADOUT), B: cloneLoadout(DEFAULT_AI_LOADOUT) },
    aiSeats: [],
  });
}

function makeState(seed = 606) {
  return stellarTerritoryMode.createInitialModeState({
    randomSeed: seed,
    parameters: stellarTerritoryMode.defaultParameters,
  });
}

assert(TERRAIN_MOVEMENT_MULTIPLIERS.asteroid_belt.speedMultiplier === 0.78, "asteroid speed multiplier");
assert(TERRAIN_MOVEMENT_MULTIPLIERS.asteroid_belt.accelerationMultiplier === 0.85, "asteroid acceleration multiplier");
assert(TERRAIN_MOVEMENT_MULTIPLIERS.asteroid_belt.turnMultiplier === 0.9, "asteroid turn multiplier");
assert(TERRAIN_MOVEMENT_MULTIPLIERS.speed_lane.forwardSpeedMultiplier === 1.3, "speed lane forward multiplier");
assert(TERRAIN_MOVEMENT_MULTIPLIERS.speed_lane.reverseSpeedMultiplier === 0.9, "speed lane reverse multiplier");
assert(TERRAIN_MOVEMENT_MULTIPLIERS.gravity_mire.speedMultiplier === 0.65, "gravity mire speed multiplier");
assert(TERRAIN_MOVEMENT_MULTIPLIERS.gravity_mire.turnMultiplier === 0.75, "gravity mire turn multiplier");

const circle = { shape: "circle", center: { x: 100, y: 100 }, radius: 40 };
assert(pointInTerrainRegion({ x: 130, y: 100 }, circle), "circle terrain contains inner point");
assert(!pointInTerrainRegion({ x: 151, y: 100 }, circle), "circle terrain rejects outer point");
assert(pointInTerrainRegion({ x: 151, y: 100 }, circle, { hysteresis: 12 }), "circle hysteresis includes edge point");

const capsule = { shape: "capsule", center: { x: 100, y: 100 }, length: 120, width: 40, angle: 0 };
assert(pointInTerrainRegion({ x: 150, y: 100 }, capsule), "capsule terrain contains lane point");
assert(!pointInTerrainRegion({ x: 100, y: 135 }, capsule), "capsule terrain rejects side point");

let sim;
let state;
let result;

const compound = {
  id: "compound",
  type: "asteroid_belt",
  shape: "compound",
  center: { x: 360, y: 330 },
  radius: 260,
  fields: [
    { x: 300, y: 300, radius: 180, coreRadius: 70 },
    { x: 420, y: 300, radius: 170, coreRadius: 65 },
    { x: 360, y: 410, radius: 160, coreRadius: 60 },
  ],
};
const outsideIntensity = terrainIntensityAtPoint({ x: 40, y: 40 }, compound);
const edgeIntensity = terrainIntensityAtPoint({ x: 125, y: 300 }, compound);
const middleIntensity = terrainIntensityAtPoint({ x: 210, y: 300 }, compound);
const coreIntensity = terrainIntensityAtPoint({ x: 300, y: 300 }, compound);
assert(
  outsideIntensity === 0 && edgeIntensity > 0 && edgeIntensity < middleIntensity && middleIntensity < coreIntensity && coreIntensity === 1,
  `compound terrain intensity should rise smoothly from edge to core: ${outsideIntensity}, ${edgeIntensity}, ${middleIntensity}, ${coreIntensity}`,
);

sim = makeSimulation();
state = makeState(808);
state.map.terrainRegions = [compound];
const compoundShip = sim.fleetBySeat("A").shipByKey("main");
compoundShip.angle = 0;
const compoundBase = {
  speed: compoundShip.baseSpeed(),
  acceleration: compoundShip.baseAcceleration(),
  turn: compoundShip.baseTurnRate(),
};
for (const [name, position, intensity] of [
  ["edge", { x: 125, y: 300 }, edgeIntensity],
  ["middle", { x: 210, y: 300 }, middleIntensity],
  ["core", { x: 300, y: 300 }, coreIntensity],
]) {
  compoundShip.x = position.x;
  compoundShip.y = position.y;
  result = updateTerritoryTerrainModifiers({ modeState: state, simulation: sim });
  state = result.modeState;
  approximatelyEqual(
    compoundShip.baseSpeed() / compoundBase.speed,
    1 + (TERRAIN_MOVEMENT_MULTIPLIERS.asteroid_belt.speedMultiplier - 1) * intensity,
    `compound ${name} speed should interpolate by terrain intensity`,
  );
  approximatelyEqual(
    compoundShip.baseAcceleration() / compoundBase.acceleration,
    1 + (TERRAIN_MOVEMENT_MULTIPLIERS.asteroid_belt.accelerationMultiplier - 1) * intensity,
    `compound ${name} acceleration should interpolate by terrain intensity`,
  );
  approximatelyEqual(
    compoundShip.baseTurnRate() / compoundBase.turn,
    1 + (TERRAIN_MOVEMENT_MULTIPLIERS.asteroid_belt.turnMultiplier - 1) * intensity,
    `compound ${name} turn rate should interpolate by terrain intensity`,
  );
}
assert(
  state.terrainMemory["A:main"]?.ids?.includes(compound.id)
    && state.terrainMemory["A:main"]?.intensities?.[compound.id] === 1,
  `compound terrain memory should retain ids and intensities: ${JSON.stringify(state.terrainMemory)}`,
);

const generatedTerrain = makeState(909).map.terrainRegions;
assert(generatedTerrain.length >= 3 && generatedTerrain.length <= 5, `terrain generator should create three to five regions: ${generatedTerrain.length}`);
const generatedCompounds = generatedTerrain.filter((region) => region.shape === "compound");
assert(generatedCompounds.length >= 1, `terrain generator should include a compound region: ${JSON.stringify(generatedTerrain)}`);
for (const region of generatedCompounds) {
  assert(
    region.fields?.length >= 3 && region.radius >= 220 && region.radius <= 360,
    `compound terrain should expose a large three-field envelope: ${JSON.stringify(region)}`,
  );
}
for (const region of generatedTerrain.filter((entry) => entry.type === "speed_lane")) {
  assert(
    region.length >= 600 && region.length <= 1000 && region.width >= 220 && region.width <= 320,
    `speed lane terrain should be a large tactical corridor: ${JSON.stringify(region)}`,
  );
}

sim = makeSimulation();
state = makeState();
const asteroid = state.map.terrainRegions.find((region) => region.type === "asteroid_belt") || state.map.terrainRegions[0];
asteroid.type = "asteroid_belt";
asteroid.shape = "circle";
asteroid.radius = 80;
const ship = sim.fleetBySeat("A").shipByKey("main");
ship.x = asteroid.center.x;
ship.y = asteroid.center.y;
ship.angle = 0;
const baseSpeed = ship.baseSpeed();
const baseTurn = ship.baseTurnRate();
const baseAccel = ship.baseAcceleration();
result = updateTerritoryTerrainModifiers({ modeState: state, simulation: sim });
state = result.modeState;
assert(result.events.some((event) => event.type === "terrain_entered"), "terrain entered event emitted");
assert(ship.baseSpeed() < baseSpeed && Math.abs(ship.baseSpeed() / baseSpeed - 0.78) < 1e-6, "terrain speed modifier applied");
assert(ship.baseTurnRate() < baseTurn && Math.abs(ship.baseTurnRate() / baseTurn - 0.9) < 1e-6, "terrain turn modifier applied");
assert(
  ship.baseAcceleration() < baseAccel && Math.abs(ship.baseAcceleration() / baseAccel - 0.85) < 1e-6,
  "terrain acceleration modifier applied",
);

ship.x = asteroid.center.x + asteroid.radius + 8;
result = updateTerritoryTerrainModifiers({ modeState: state, simulation: sim });
assert(!result.events.some((event) => event.type === "terrain_exited"), "hysteresis should prevent immediate edge exit");
assert(ship.baseSpeed() < baseSpeed, "modifier should remain inside hysteresis band");

ship.x = asteroid.center.x + asteroid.radius + 20;
result = updateTerritoryTerrainModifiers({ modeState: result.modeState, simulation: sim });
assert(result.events.some((event) => event.type === "terrain_exited"), "terrain exited event emitted outside hysteresis");
assert(Math.abs(ship.baseSpeed() - baseSpeed) < 1e-6, "terrain speed modifier cleared after exit");

sim = makeSimulation();
state = makeState(707);
const lane = state.map.terrainRegions.find((region) => region.shape === "capsule") || state.map.terrainRegions[0];
lane.type = "speed_lane";
lane.shape = "capsule";
lane.angle = 0;
lane.length = 240;
lane.width = 80;
state.map.terrainRegions = [lane];
const laneShip = sim.fleetBySeat("A").shipByKey("main");
laneShip.x = lane.center.x;
laneShip.y = lane.center.y;
laneShip.angle = 0;
const laneBase = laneShip.baseSpeed();
updateTerritoryTerrainModifiers({ modeState: state, simulation: sim });
assert(Math.abs(laneShip.baseSpeed() / laneBase - 1.3) < 1e-6, "speed lane forward speed applied");
laneShip.angle = Math.PI;
sim.clearEnvironmentModifiers();
updateTerritoryTerrainModifiers({ modeState: state, simulation: sim });
assert(Math.abs(laneShip.baseSpeed() / laneBase - 0.9) < 1e-6, "speed lane reverse speed applied");

sim.clearEnvironmentModifiers();
assert(Math.abs(laneShip.baseSpeed() - laneBase) < 1e-6, "environment modifier clear restores base speed");

const coreSource = await import("node:fs/promises").then((fs) => fs.readFile("shared/game-core.js", "utf8"));
assert(!coreSource.includes('modeId === "stellar-territory"'), "game-core must not hardcode stellar territory");
assert(!coreSource.includes('mode === "stellar-territory"'), "game-core must not branch on stellar territory");

console.log("territory terrain verification passed");
