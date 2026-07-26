import { DEFAULT_AI_LOADOUT, DEFAULT_TEAM_LOADOUT, MatchSimulation, TICK_DT, cloneLoadout } from "../shared/game-core.js";
import {
  TERRAIN_MOVEMENT_MULTIPLIERS,
  pointInTerrainRegion,
  updateTerritoryTerrainModifiers,
} from "../shared/gameplay/territory-terrain.js";
import { stellarTerritoryMode } from "../shared/modes/stellar-territory.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

let sim = makeSimulation();
let state = makeState();
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
let result = updateTerritoryTerrainModifiers({ modeState: state, simulation: sim });
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
