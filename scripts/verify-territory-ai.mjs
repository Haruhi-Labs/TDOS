import { DEFAULT_AI_LOADOUT, DEFAULT_TEAM_LOADOUT, MatchSimulation, cloneLoadout } from "../shared/game-core.js";
import {
  chooseTerritoryAiAction,
  scoreTerritoryObjective,
} from "../shared/gameplay/territory-ai.js";
import { stellarTerritoryMode } from "../shared/modes/stellar-territory.js";
import { createPrototypeRuntime } from "../src/prototype/runtime.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeSimulation() {
  return new MatchSimulation({
    mode: "ai",
    teamLoadouts: { A: cloneLoadout(DEFAULT_TEAM_LOADOUT), B: cloneLoadout(DEFAULT_AI_LOADOUT) },
    aiSeats: ["B"],
    victoryPolicy: "external",
  });
}

function makeState(seed = 1111) {
  return stellarTerritoryMode.createInitialModeState({
    randomSeed: seed,
    parameters: stellarTerritoryMode.defaultParameters,
  });
}

let sim = makeSimulation();
let state = makeState();
const bMain = sim.fleetBySeat("B").shipByKey("main");
const targetPoint = state.map.controlPoints[0];
bMain.x = targetPoint.center.x + 360;
bMain.y = targetPoint.center.y;
targetPoint.ownerAllianceId = "A";
let captureScore = scoreTerritoryObjective({
  objective: { type: "capture_control_point", target: targetPoint },
  seat: "B",
  simulation: sim,
  modeState: state,
});
let defendScore = scoreTerritoryObjective({
  objective: { type: "defend_control_point", target: targetPoint },
  seat: "B",
  simulation: sim,
  modeState: state,
});
assert(captureScore > defendScore + 15, "AI should value enemy control points as capture objectives");

let action = chooseTerritoryAiAction({ seat: "B", simulation: sim, modeState: state });
assert(action?.type === "set_route", "AI objective layer issues standard route actions");
assert(action.shipKey === "main", "AI route action controls main ship");
assert(Math.hypot(action.endX - targetPoint.center.x, action.endY - targetPoint.center.y) < 12, "AI routes toward selected control point");
assert(state.map.controlPoints[0].ownerAllianceId === "A", "AI action selection must not mutate control-point state");

state = makeState(2222);
sim = makeSimulation();
const resourceNode = state.map.resourceSpawnNodes.find((node) => node.rarity === "common") || state.map.resourceSpawnNodes[0];
state.pickups = [
  {
    id: "resource-ai",
    resourceType: "energy",
    rarity: "common",
    nodeId: resourceNode.id,
    position: { ...resourceNode.center },
    radius: 28,
    spawnedAt: 0,
    expiresAt: 30,
  },
];
action = chooseTerritoryAiAction({ seat: "B", simulation: sim, modeState: state });
assert(action?.type === "set_route", "AI routes to pickups through normal route action");
assert(Math.hypot(action.endX - resourceNode.center.x, action.endY - resourceNode.center.y) < 12, "AI prioritizes available resource pickup");

state = makeState(3333);
sim = makeSimulation();
const bFleet = sim.fleetBySeat("B");
for (const ship of bFleet.getAllShips()) {
  ship.hp = ship.maxHp * 0.18;
}
action = chooseTerritoryAiAction({ seat: "B", simulation: sim, modeState: state });
assert(action?.type === "set_route", "low hull AI still issues route action");
assert(action.reason === "retreat", "low hull AI chooses retreat objective");
assert(action.endX > sim.worldSize * 0.55, "B retreat target stays near B-side safe area");

state = makeState(4444);
sim = makeSimulation();
state.alliances.B.skillSlot = { skillId: "repair_drones", acquiredAt: 0 };
for (const ship of sim.fleetBySeat("B").getAllShips()) {
  ship.hp = ship.maxHp * 0.45;
}
action = chooseTerritoryAiAction({ seat: "B", simulation: sim, modeState: state });
assert(action?.type === "use_tactical_skill", "AI uses tactical skills through mode action interface");
assert(action.targetType === "fleet" && action.targetSeat === "B", "AI targets own fleet for repair drones");
assert(state.alliances.B.skillSlot?.skillId === "repair_drones", "AI skill action selection does not consume skill directly");

state.alliances.B.skillSlot = { skillId: "gravity_field", acquiredAt: 0 };
const enemyMain = sim.fleetBySeat("A").shipByKey("main");
enemyMain.x = sim.worldSize * 0.48;
enemyMain.y = sim.worldSize * 0.52;
action = chooseTerritoryAiAction({ seat: "B", simulation: sim, modeState: state });
assert(action?.type === "use_tactical_skill", "AI uses point tactical skills through mode action interface");
assert(action.targetType === "point", "AI gravity field targets a point");
assert(Math.hypot(action.targetX - enemyMain.x, action.targetY - enemyMain.y) < 40, "AI gravity field targets visible enemy position");

const runtime = createPrototypeRuntime({
  modeDefinition: stellarTerritoryMode,
  runtimePreset: { controlA: "human", controlB: "ai", victoryPolicy: "external" },
  randomSeed: 5555,
});
runtime.start();
const runtimeState = runtime.getModeState();
const runtimePoint = runtimeState.map.controlPoints[0];
const runtimeBMain = runtime.getSimulation().fleetBySeat("B").shipByKey("main");
runtimeBMain.x = runtimePoint.center.x + 340;
runtimeBMain.y = runtimePoint.center.y;
runtimeState.map.controlPoints[0].ownerAllianceId = "A";
runtime.step();
assert(runtimeBMain.route?.p2, "runtime invokes mode AI hook and applies returned route action");
assert(Math.hypot(runtimeBMain.route.p2.x - runtimePoint.center.x, runtimeBMain.route.p2.y - runtimePoint.center.y) < 40, "runtime-applied AI route targets mode objective");
runtime.destroy();

console.log("territory AI verification passed");
