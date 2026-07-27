import { DEFAULT_AI_LOADOUT, DEFAULT_TEAM_LOADOUT, MatchSimulation, cloneLoadout } from "../shared/game-core.js";
import {
  chooseTerritoryAiAction,
  scoreTerritoryObjective,
} from "../shared/gameplay/territory-ai.js";
import { positionClearOfObstacles } from "../shared/gameplay/territory-obstacles.js";
import { stellarTerritoryMode } from "../shared/modes/stellar-territory.js";
import { stellarTerritoryPreset } from "../src/prototype/modes/stellar-territory.js";
import { createPrototypeRuntime } from "../src/prototype/runtime.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeSimulation() {
  return new MatchSimulation({
    mode: "ai",
    worldSize: stellarTerritoryMode.worldSize,
    teamLoadouts: { A: cloneLoadout(DEFAULT_TEAM_LOADOUT), B: cloneLoadout(DEFAULT_AI_LOADOUT) },
    aiSeats: ["B"],
    victoryPolicy: "external",
  });
}

function makeThreeVsThreeSimulation() {
  const fleetLayout = {
    alliances: {
      A: ["A1", "A2", "A3"].map((seat) => ({ seat, control: "ai", loadout: cloneLoadout(DEFAULT_TEAM_LOADOUT) })),
      B: ["B1", "B2", "B3"].map((seat) => ({ seat, control: "ai", loadout: cloneLoadout(DEFAULT_AI_LOADOUT) })),
    },
    localSeat: "A1",
  };
  return new MatchSimulation({
    mode: "ai",
    worldSize: stellarTerritoryMode.worldSize,
    teamLoadouts: { A: cloneLoadout(DEFAULT_TEAM_LOADOUT), B: cloneLoadout(DEFAULT_AI_LOADOUT) },
    aiSeats: ["A1", "A2", "A3", "B1", "B2", "B3"],
    victoryPolicy: "external",
    fleetLayout,
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
assert(action.navigationKey === `capture_control_point:${targetPoint.id}`, "AI route actions should expose their stable objective key");
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

state = makeState(4545);
sim = makeThreeVsThreeSimulation();
const mixedControlLayout = {
  alliances: {
    A: [
      { seat: "A1", control: "human" },
      { seat: "A2", control: "ai" },
      { seat: "A3", control: "ai" },
    ],
    B: ["B1", "B2", "B3"].map((seat) => ({ seat, control: "ai" })),
  },
  localSeat: "A1",
};
state.alliances.A.skillSlot = { skillId: "gravity_field", acquiredAt: 0 };
action = stellarTerritoryMode.buildAiAction({
  seat: "A2",
  simulation: sim,
  modeState: state,
  runtime: { getFleetLayout: () => mixedControlLayout },
});
assert(action?.type === "set_route", `allied AI should retain objective routing without consuming the human alliance slot: ${JSON.stringify(action)}`);
assert(state.alliances.A.skillSlot?.skillId === "gravity_field", "human-alliance AI decision should preserve the shared tactical slot");

state.alliances.B.skillSlot = { skillId: "gravity_field", acquiredAt: 0 };
action = stellarTerritoryMode.buildAiAction({
  seat: "B2",
  simulation: sim,
  modeState: state,
  runtime: { getFleetLayout: () => mixedControlLayout },
});
assert(action?.type === "use_tactical_skill", "all-AI alliance should retain tactical skill authority");

state = makeState(5151);
state.elapsed = 1;
sim = makeThreeVsThreeSimulation();
const sharedResourceNode = state.map.resourceSpawnNodes.find((node) => node.rarity === "common") || state.map.resourceSpawnNodes[0];
state.pickups = [{
  id: "resource-shared",
  resourceType: "energy",
  rarity: "common",
  nodeId: sharedResourceNode.id,
  position: { ...sharedResourceNode.center },
  radius: 28,
  spawnedAt: 0,
}];
for (const seat of ["A1", "A2", "A3"]) {
  const ship = sim.fleetBySeat(seat).shipByKey("main");
  ship.x = sharedResourceNode.center.x + 40;
  ship.y = sharedResourceNode.center.y;
  chooseTerritoryAiAction({ seat, simulation: sim, modeState: state });
}
const allianceAssignments = Object.values(state.aiCoordinator?.A?.assignments || {});
assert(allianceAssignments.length === 3, "all three allied AI fleets should publish coordinator assignments");
assert(allianceAssignments.filter((assignment) => assignment.targetId === "resource-shared").length === 1, "a common resource pickup should reserve capacity for exactly one fleet");
assert(new Set(allianceAssignments.map((assignment) => `${assignment.objectiveType}:${assignment.targetId}`)).size === 3, "capacity-aware fleets should spread across distinct available objectives");

state = makeState(6161);
state.elapsed = 0.5;
sim = makeSimulation();
chooseTerritoryAiAction({ seat: "B", simulation: sim, modeState: state });
const initialLockedAssignment = { ...state.aiCoordinator.B.assignments.B };
const lockResourceNode = state.map.resourceSpawnNodes.find((node) => node.rarity === "rare") || state.map.resourceSpawnNodes[0];
const lockShip = sim.fleetBySeat("B").shipByKey("main");
state.pickups = [{
  id: "resource-lock-challenger",
  resourceType: "repair",
  rarity: "rare",
  nodeId: lockResourceNode.id,
  position: { x: lockShip.x + 5, y: lockShip.y },
  radius: 28,
  spawnedAt: state.elapsed,
}];
state.elapsed = 1;
action = chooseTerritoryAiAction({ seat: "B", simulation: sim, modeState: state });
assert(state.aiCoordinator.B.assignments.B.objectiveKey === initialLockedAssignment.objectiveKey, "a valid objective should remain locked when a stronger routine target appears");
assert(state.aiCoordinator.B.assignments.B.lockUntil > state.elapsed, "AI assignments should expose positive lock time during the minimum task window");
assert(action.reason === initialLockedAssignment.objectiveType, "the route action should continue the locked objective");
state.elapsed = initialLockedAssignment.lockUntil + 0.01;
chooseTerritoryAiAction({ seat: "B", simulation: sim, modeState: state });
assert(state.aiCoordinator.B.assignments.B.targetId === "resource-lock-challenger", "an expired task lock should allow a higher-scoring objective switch");

state = makeState(6162);
state.elapsed = 1;
state.map.controlPoints = [];
state.pickups = [];
state.skillPickups = [];
sim = makeThreeVsThreeSimulation();
const attackShip = sim.fleetBySeat("A1").shipByKey("main");
attackShip.x = 600;
attackShip.y = 600;
for (const seat of ["B1", "B2", "B3"]) {
  for (const ship of sim.fleetBySeat(seat).getAllShips()) {
    ship.x = 1300;
    ship.y = 1300;
  }
}
const lockedEnemy = sim.fleetBySeat("B1").shipByKey("main");
const closerChallenger = sim.fleetBySeat("B1").shipByKey("sub1");
lockedEnemy.x = 680;
lockedEnemy.y = 600;
closerChallenger.x = 760;
closerChallenger.y = 600;
chooseTerritoryAiAction({ seat: "A1", simulation: sim, modeState: state });
const attackLock = { ...state.aiCoordinator.A.assignments.A1 };
assert(attackLock.objectiveType === "attack_enemy" && attackLock.targetId === String(lockedEnemy.id), "attack-lock fixture should begin on the nearest enemy");
state.elapsed = 2;
closerChallenger.x = 620;
chooseTerritoryAiAction({ seat: "A1", simulation: sim, modeState: state });
assert(attackLock.lockUntil > state.elapsed, "nearest-enemy churn fixture should remain inside the original lock window");
assert(state.aiCoordinator.A.assignments.A1.targetId === String(lockedEnemy.id), "a living attack target should remain locked when another enemy becomes nearer");
assert(state.aiCoordinator.A.assignments.A1.lockUntil === attackLock.lockUntil, "nearest-enemy churn should not restart the attack lock");

state = makeState(6163);
state.elapsed = 1;
state.pickups = [];
state.skillPickups = [];
sim = makeThreeVsThreeSimulation();
const capacityPoint = state.map.controlPoints[0];
state.map.controlPoints = [capacityPoint];
capacityPoint.ownerAllianceId = "B";
capacityPoint.capturingAllianceId = null;
capacityPoint.captureProgress = 0;
for (const seat of ["A1", "A2"]) {
  const ship = sim.fleetBySeat(seat).shipByKey("main");
  ship.x = capacityPoint.center.x + (seat === "A1" ? -12 : 12);
  ship.y = capacityPoint.center.y;
}
for (const seat of ["B1", "B2", "B3"]) {
  for (const ship of sim.fleetBySeat(seat).getAllShips()) {
    ship.x = 1400;
    ship.y = 1400;
  }
}
chooseTerritoryAiAction({ seat: "A1", simulation: sim, modeState: state });
chooseTerritoryAiAction({ seat: "A2", simulation: sim, modeState: state });
assert(Object.values(state.aiCoordinator.A.assignments).filter((assignment) => assignment.targetId === capacityPoint.id).length === 2, "an enemy-owned point should accept two capture assignments");
capacityPoint.ownerAllianceId = null;
state.elapsed = 2;
chooseTerritoryAiAction({ seat: "A1", simulation: sim, modeState: state });
chooseTerritoryAiAction({ seat: "A2", simulation: sim, modeState: state });
assert(Object.values(state.aiCoordinator.A.assignments).filter((assignment) => assignment.targetId === capacityPoint.id).length === 1, "a neutralized point should reconcile locked assignments to capacity one");

state = makeState(6262);
state.elapsed = 0.5;
sim = makeSimulation();
chooseTerritoryAiAction({ seat: "B", simulation: sim, modeState: state });
const routineAssignment = { ...state.aiCoordinator.B.assignments.B };
for (const ship of sim.fleetBySeat("B").getAllShips()) {
  ship.hp = ship.maxHp * 0.18;
}
state.elapsed = 1;
action = chooseTerritoryAiAction({ seat: "B", simulation: sim, modeState: state });
assert(routineAssignment.lockUntil > state.elapsed, "emergency-retreat fixture should still be inside its routine task lock");
assert(action.reason === "retreat", "low hull should preempt a locked routine objective");
assert(state.aiCoordinator.B.assignments.B.objectiveType === "retreat", "emergency retreat should replace the coordinator assignment immediately");

state = makeState(6363);
state.elapsed = 0.5;
sim = makeThreeVsThreeSimulation();
for (const seat of ["A1", "A2", "A3"]) {
  chooseTerritoryAiAction({ seat, simulation: sim, modeState: state });
}
assert(state.aiCoordinator.A.assignments.A1.objectiveType === "capture_control_point", "opening seat A1 should take a neutral capture task");
assert(state.aiCoordinator.A.assignments.A2.objectiveType === "capture_control_point", "opening seat A2 should take a second neutral capture task");
assert(state.aiCoordinator.A.assignments.A1.targetId !== state.aiCoordinator.A.assignments.A2.targetId, "neutral capture capacity should distribute A1 and A2");
assert(["collect_resource", "collect_skill", "attack_enemy", "defend_control_point"].includes(state.aiCoordinator.A.assignments.A3.objectiveType), "opening seat A3 should support or seek pickups rather than duplicate a neutral capture");

state = makeState(6464);
state.elapsed = 0.5;
sim = makeSimulation();
const disappearingShip = sim.fleetBySeat("B").shipByKey("main");
state.pickups = [{
  id: "resource-disappearing",
  resourceType: "energy",
  rarity: "rare",
  nodeId: state.map.resourceSpawnNodes[0].id,
  position: { x: disappearingShip.x + 5, y: disappearingShip.y },
  radius: 28,
  spawnedAt: 0,
}];
chooseTerritoryAiAction({ seat: "B", simulation: sim, modeState: state });
const disappearingAssignment = { ...state.aiCoordinator.B.assignments.B };
assert(disappearingAssignment.targetId === "resource-disappearing", "disappearing-target fixture should begin with the pickup assignment");
state.pickups = [];
state.elapsed = 1;
chooseTerritoryAiAction({ seat: "B", simulation: sim, modeState: state });
assert(disappearingAssignment.lockUntil > state.elapsed, "disappearing-target fixture should remain inside the original lock window");
assert(state.aiCoordinator.B.assignments.B.targetId !== "resource-disappearing", "a vanished pickup should release its assignment before lock expiry");

const aiDiagnostics = stellarTerritoryMode.buildDiagnostics({
  modeState: state,
  parameters: stellarTerritoryMode.defaultParameters,
});
const diagnosticAssignment = state.aiCoordinator.B.assignments.B;
const diagnosticLine = aiDiagnostics["AI任务 B"];
assert(typeof diagnosticLine === "string", "mode diagnostics should expose one task row per AI seat");
for (const expected of [diagnosticAssignment.objectiveType, diagnosticAssignment.targetId, "分数", "锁定"]) {
  assert(diagnosticLine.includes(expected), `AI diagnostic row should include ${expected}: ${diagnosticLine}`);
}

state = makeState(6565);
sim = makeSimulation();
const casualtyFleet = sim.fleetBySeat("B");
casualtyFleet.shipByKey("main").takeDamage(casualtyFleet.shipByKey("main").maxHp * 10, null, sim, false);
action = chooseTerritoryAiAction({ seat: "B", simulation: sim, modeState: state });
assert(action?.type === "set_route" && ["sub1", "sub2"].includes(action.shipKey), "AI should continue its fleet assignment through a living controllable sub after flagship loss");
assert(state.aiCoordinator.B.assignments.B, "flagship loss should not leave surviving fleet capacity untracked");
for (const ship of casualtyFleet.getAllShips()) {
  if (ship.alive) ship.takeDamage(ship.maxHp * 10, null, sim, false);
}
action = chooseTerritoryAiAction({ seat: "B", simulation: sim, modeState: state });
assert(action === null, "a fully wiped fleet should not issue an objective route");
assert(!state.aiCoordinator.B.assignments.B, "a fully wiped fleet should release its reserved objective capacity");

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
const runtimeAiPlan = runtime.getModeState().navigationPlans?.["B:main"];
assert(runtimeAiPlan?.target, "runtime AI actions should create a mode-owned navigation plan");
assert(
  Math.hypot(runtimeAiPlan.target.x - runtimePoint.center.x, runtimeAiPlan.target.y - runtimePoint.center.y) < 40,
  `runtime AI plan should retain the scored objective as its final target: ${JSON.stringify(runtimeAiPlan)}`,
);
assert(
  runtimeAiPlan.waypoints.every((waypoint) => positionClearOfObstacles(
    waypoint,
    runtimeAiPlan.clearance,
    runtime.getModeState().map.obstacleRegions,
  )),
  `runtime AI waypoints should use the shared obstacle-clear planner: ${JSON.stringify(runtimeAiPlan)}`,
);
runtime.destroy();

const routeAuthorityRuntime = createPrototypeRuntime({
  modeDefinition: stellarTerritoryMode,
  runtimePreset: stellarTerritoryPreset.runtimePreset,
  randomSeed: 5656,
});
routeAuthorityRuntime.start();
routeAuthorityRuntime.step();
const routeAuthorityState = routeAuthorityRuntime.getModeState();
const routeAuthoritySim = routeAuthorityRuntime.getSimulation();
const routeAuthorityShip = routeAuthoritySim.fleetBySeat("A2").shipByKey("main");
const routeAuthorityAssignment = routeAuthorityState.aiCoordinator?.A?.assignments?.A2;
assert(routeAuthorityAssignment?.lockUntil > routeAuthorityState.elapsed, "route-authority fixture should hold a live territory assignment lock");
assert(routeAuthorityShip.route?.p2, "route-authority fixture should begin with a territory AI route");
const lockedRouteEnd = { ...routeAuthorityShip.route.p2 };
routeAuthoritySim.botBySeat("A2").moveTimer = 0;
routeAuthorityRuntime.step();
assert(
  Math.hypot(routeAuthorityShip.route.p2.x - lockedRouteEnd.x, routeAuthorityShip.route.p2.y - lockedRouteEnd.y) <= 1e-9,
  `core BotController must not replace a mode-owned route during its assignment lock: ${JSON.stringify(lockedRouteEnd)} -> ${JSON.stringify(routeAuthorityShip.route.p2)}`,
);
routeAuthorityRuntime.destroy();

console.log("territory AI verification passed");
