import { generateTerritoryMap } from "../shared/gameplay/territory-map.js";
import {
  firstObstacleHit,
  positionClearOfObstacles,
} from "../shared/gameplay/territory-obstacles.js";
import {
  advanceNavigationPlans,
  createNavigationPlan,
  findNavigationPath,
  planTerritoryRoute,
  validateNavigationGraph,
} from "../shared/gameplay/territory-navigation.js";
import { stellarTerritoryMode } from "../shared/modes/stellar-territory.js";
import { stellarTerritoryPreset } from "../src/prototype/modes/stellar-territory.js";
import { createPrototypeRuntime } from "../src/prototype/runtime.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stableJson(value) {
  return JSON.stringify(value);
}

function makeNode(id, x, y) {
  return { id, center: { x, y } };
}

function makeEdge(id, from, to) {
  return { id, from, to };
}

const map = generateTerritoryMap({ seed: 7251, templateId: "three-lane-v2", worldSize: 3200 });
const graphValidation = validateNavigationGraph(map);
assert(graphValidation.valid, `generated navigation graph should be valid: ${stableJson(graphValidation)}`);

const malformedMap = {
  ...map,
  navigationGraph: {
    nodes: [makeNode("same", 0, 0), makeNode("same", 10, 0), { id: "broken", center: null }],
    edges: [makeEdge("bad-edge", "same", "missing")],
  },
};
const malformedValidation = validateNavigationGraph(malformedMap);
assert(!malformedValidation.valid, "malformed navigation graph should be rejected");
assert(
  malformedValidation.errors.some((error) => error.includes("duplicate navigation node"))
    && malformedValidation.errors.some((error) => error.includes("missing node")),
  `malformed graph should report structural errors: ${stableJson(malformedValidation)}`,
);

const tieGraph = {
  nodes: [
    makeNode("start", 0, 0),
    makeNode("branch-b", 10, 10),
    makeNode("branch-a", 10, -10),
    makeNode("end", 20, 0),
  ],
  edges: [
    makeEdge("s-b", "start", "branch-b"),
    makeEdge("b-e", "branch-b", "end"),
    makeEdge("s-a", "start", "branch-a"),
    makeEdge("a-e", "branch-a", "end"),
  ],
};
assert(
  stableJson(findNavigationPath({ graph: tieGraph, startNodeId: "start", endNodeId: "end" }))
    === stableJson(["start", "branch-a", "end"]),
  "equal-score A* candidates should break ties by node ID",
);

const cyclicTieGraph = {
  nodes: [
    makeNode("start", 0, 0),
    makeNode("branch-a", 10, 0),
    makeNode("branch-b", 10, 0),
    makeNode("end", 20, 0),
  ],
  edges: [
    makeEdge("s-a", "start", "branch-a"),
    makeEdge("s-b", "start", "branch-b"),
    makeEdge("a-b", "branch-a", "branch-b"),
    makeEdge("a-e", "branch-a", "end"),
    makeEdge("b-e", "branch-b", "end"),
  ],
};
assert(
  stableJson(findNavigationPath({ graph: cyclicTieGraph, startNodeId: "start", endNodeId: "end" }))
    === stableJson(["start", "branch-a", "end"]),
  "equal-cost graph cycles should terminate without creating a parent cycle",
);

const unreachableGraph = {
  nodes: [makeNode("start", 0, 0), makeNode("island", 50, 0), makeNode("end", 100, 0)],
  edges: [makeEdge("start-island", "start", "island")],
};
assert(
  findNavigationPath({ graph: unreachableGraph, startNodeId: "start", endNodeId: "end" }) === null,
  "A* should return null when the destination is unreachable",
);

const direct = planTerritoryRoute({
  map,
  start: { x: 160, y: 1900 },
  end: { x: 420, y: 1900 },
  clearance: 18,
});
assert(
  direct.accepted && direct.kind === "direct" && direct.waypoints.length === 1,
  `direct route should contain only its endpoint: ${stableJson(direct)}`,
);
assert(
  direct.waypoints[0].x === 420 && direct.waypoints[0].y === 1900,
  `direct endpoint should be preserved: ${stableJson(direct)}`,
);

const detourStart = map.spawnAreas[0].center;
const detourEnd = map.controlPoints[0].center;
const detour = planTerritoryRoute({ map, start: detourStart, end: detourEnd, clearance: 18 });
assert(
  detour.accepted && detour.kind === "graph" && detour.waypoints.length >= 2,
  `blocked direct route should use A*: ${stableJson(detour)}`,
);
const detourPath = [detourStart, ...detour.waypoints];
for (let index = 0; index < detourPath.length - 1; index += 1) {
  assert(
    !firstObstacleHit(detourPath[index], detourPath[index + 1], map.obstacleRegions, 18),
    `planned segment ${index} must be obstacle-clear`,
  );
}
for (let index = 0; index < detourPath.length - 2; index += 1) {
  assert(
    firstObstacleHit(detourPath[index], detourPath[index + 2], map.obstacleRegions, 18),
    `line-of-sight simplification should remove redundant waypoint ${index + 1}`,
  );
}

const obstacle = map.obstacleRegions.find((candidate) => candidate.shape === "compound");
const obstacleInterior = obstacle.primitives.find((primitive) => primitive.shape === "circle").center;
const blocked = planTerritoryRoute({ map, start: detourStart, end: obstacleInterior, clearance: 18 });
assert(
  !blocked.accepted && blocked.reason === "blocked_target",
  `blocked target should be rejected: ${stableJson(blocked)}`,
);

const clearanceMap = {
  obstacleRegions: [{
    id: "near-line",
    shape: "circle",
    center: { x: 50, y: 10 },
    radius: 5,
  }],
  navigationGraph: {
    nodes: [makeNode("lower-a", 20, -24), makeNode("lower-b", 80, -24)],
    edges: [makeEdge("lower", "lower-a", "lower-b")],
  },
};
const zeroClearance = planTerritoryRoute({
  map: clearanceMap,
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
  clearance: 0,
});
const wideClearance = planTerritoryRoute({
  map: clearanceMap,
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
  clearance: 6,
});
assert(zeroClearance.accepted && zeroClearance.kind === "direct", `zero-clearance route: ${stableJson(zeroClearance)}`);
assert(wideClearance.accepted && wideClearance.kind === "graph", `wide-clearance route: ${stableJson(wideClearance)}`);
assert(
  wideClearance.waypoints.every((waypoint) => positionClearOfObstacles(waypoint, 6, clearanceMap.obstacleRegions)),
  `wide-clearance waypoints must remain legal: ${stableJson(wideClearance)}`,
);

const repeatDetour = planTerritoryRoute({ map, start: detourStart, end: detourEnd, clearance: 18 });
assert(stableJson(detour) === stableJson(repeatDetour), "repeat planner calls should be byte-for-byte deterministic");

const plan = createNavigationPlan({
  seat: "A1",
  shipKey: "main",
  route: detour,
  now: 12.5,
  reason: "player_command",
  throttle: 1.1,
});
assert(
  plan.seat === "A1"
    && plan.shipKey === "main"
    && plan.currentSegment === 0
    && plan.target.x === detourEnd.x
    && plan.clearance === 18
    && plan.createdAt === 12.5
    && plan.reason === "player_command"
    && plan.throttle === 1.1,
  `navigation plan should retain route authority metadata: ${stableJson(plan)}`,
);

const stagedPlan = createNavigationPlan({
  seat: "A1",
  shipKey: "main",
  route: {
    accepted: true,
    kind: "graph",
    clearance: 18,
    start: { x: 0, y: 0 },
    target: { x: 100, y: 0 },
    waypoints: [
      { x: 40, y: 20, nodeId: "mid" },
      { x: 100, y: 0, nodeId: null },
    ],
  },
  now: 2,
  reason: "test",
  throttle: 0.9,
});
const ship = { x: 40, y: 20, radius: 18, alive: true, route: null };
const issued = [];
const simulation = {
  fleetBySeat: () => ({ shipByKey: () => ship }),
  applyActionForSeat: (seat, action) => {
    issued.push({ seat, action });
    ship.route = { p2: { x: action.endX, y: action.endY } };
    return true;
  },
};
const advanced = advanceNavigationPlans({
  modeState: { navigationPlans: { "A1:main": stagedPlan } },
  simulation,
  dt: 0.1,
});
assert(
  advanced.modeState.navigationPlans["A1:main"].currentSegment === 1,
  `completed segment should advance: ${stableJson(advanced)}`,
);
assert(
  issued.length === 1
    && issued[0].seat === "A1"
    && issued[0].action.type === "set_route"
    && issued[0].action.endX === 100
    && issued[0].action.endY === 0
    && issued[0].action.throttle === 0.9,
  `advancement should issue the next segment: ${stableJson(issued)}`,
);

ship.x = 100;
ship.y = 0;
ship.route = null;
const completed = advanceNavigationPlans({ modeState: advanced.modeState, simulation, dt: 0.1 });
assert(
  !completed.modeState.navigationPlans["A1:main"],
  `final segment completion should remove the plan: ${stableJson(completed)}`,
);
assert(Array.isArray(completed.events) && completed.events.length === 0, "normal advancement should not emit events");

const stuckShip = { x: 0, y: 0, radius: 18, alive: true, route: { p2: { x: 100, y: 0 } } };
const stuckActions = [];
const stuckSimulation = {
  fleetBySeat: () => ({ shipByKey: () => stuckShip }),
  applyActionForSeat: (seat, action) => {
    stuckActions.push({ seat, action });
    stuckShip.route = action.type === "clear_route" ? null : { p2: { x: action.endX, y: action.endY } };
    return true;
  },
};
let stuckState = {
  map: { obstacleRegions: [] },
  navigationPlans: {
    "A1:main": createNavigationPlan({
      seat: "A1",
      shipKey: "main",
      route: {
        accepted: true,
        kind: "direct",
        clearance: 18,
        start: { x: 0, y: 0 },
        target: { x: 100, y: 0 },
        waypoints: [{ x: 100, y: 0, nodeId: null }],
      },
      reason: "watchdog_test",
    }),
  },
};
for (let second = 0; second < 4; second += 1) {
  const watchdogStep = advanceNavigationPlans({ modeState: stuckState, simulation: stuckSimulation, dt: 1 });
  stuckState = watchdogStep.modeState;
  assert(watchdogStep.events.length === 0, `watchdog should not fire before five seconds: ${stableJson(watchdogStep)}`);
}
const replannedStep = advanceNavigationPlans({ modeState: stuckState, simulation: stuckSimulation, dt: 1 });
stuckState = replannedStep.modeState;
assert(
  replannedStep.events.some((event) => event.type === "navigation_replanned"),
  `first five-second watchdog failure should replan: ${stableJson(replannedStep)}`,
);
assert(stuckState.navigationPlans["A1:main"]?.watchdog?.replans === 1, "first watchdog failure should retain one replan attempt");
for (let second = 0; second < 4; second += 1) {
  const watchdogStep = advanceNavigationPlans({ modeState: stuckState, simulation: stuckSimulation, dt: 1 });
  stuckState = watchdogStep.modeState;
  assert(watchdogStep.events.length === 0, `second watchdog window should remain bounded: ${stableJson(watchdogStep)}`);
}
const stuckStep = advanceNavigationPlans({ modeState: stuckState, simulation: stuckSimulation, dt: 1 });
assert(!stuckStep.modeState.navigationPlans["A1:main"], "second watchdog failure should clear the navigation plan");
assert(stuckShip.route === null, "second watchdog failure should clear the active core route");
assert(
  stuckStep.events.some((event) => event.type === "navigation_stuck"),
  `second watchdog failure should emit navigation_stuck: ${stableJson(stuckStep)}`,
);

const repeatingAiShip = {
  x: 0,
  y: 0,
  radius: 18,
  alive: true,
  throttle: 1,
  route: null,
  canControl: () => true,
};
const repeatingAiSimulation = {
  fleetBySeat: () => ({ shipByKey: () => repeatingAiShip }),
  applyActionForSeat: (seat, action) => {
    if (action.type === "clear_route") {
      repeatingAiShip.route = null;
      return true;
    }
    if (action.type !== "set_route") return false;
    repeatingAiShip.throttle = action.throttle;
    repeatingAiShip.route = { p2: { x: action.endX, y: action.endY } };
    return true;
  },
};
const repeatingAiAction = {
  type: "set_route",
  shipKey: "main",
  endX: 100,
  endY: 0,
  throttle: 1.05,
  reason: "capture_control_point",
  navigationKey: "capture_control_point:control-top",
};
let repeatingAiState = {
  elapsed: 0,
  map: { obstacleRegions: [], navigationGraph: { nodes: [], edges: [] } },
  navigationPlans: {},
};
let repeatingAiResult = stellarTerritoryMode.handleAction({
  action: repeatingAiAction,
  seat: "A2",
  modeState: repeatingAiState,
  simulation: repeatingAiSimulation,
});
assert(repeatingAiResult.accepted, "repeating AI watchdog fixture should accept its initial route");
repeatingAiState = repeatingAiResult.modeState;
const repeatingAiEvents = [];
for (let tick = 1; tick <= 48; tick += 1) {
  const advancedAi = advanceNavigationPlans({
    modeState: repeatingAiState,
    simulation: repeatingAiSimulation,
    dt: 0.25,
  });
  repeatingAiState = { ...advancedAi.modeState, elapsed: tick * 0.25 };
  repeatingAiEvents.push(...advancedAi.events);
  if (tick % 3 === 0) {
    repeatingAiResult = stellarTerritoryMode.handleAction({
      action: repeatingAiAction,
      seat: "A2",
      modeState: repeatingAiState,
      simulation: repeatingAiSimulation,
    });
    assert(repeatingAiResult.accepted, "periodic AI route refresh should remain accepted");
    repeatingAiState = repeatingAiResult.modeState;
  }
}
assert(
  repeatingAiEvents.some((event) => event.type === "navigation_replanned"),
  `periodic AI commands should not suppress watchdog replanning: ${stableJson(repeatingAiEvents)}`,
);
assert(
  repeatingAiEvents.some((event) => event.type === "navigation_stuck"),
  `periodic AI commands should not suppress navigation_stuck: ${stableJson(repeatingAiEvents)}`,
);

let changedObjectiveState = {
  elapsed: 0,
  map: { obstacleRegions: [], navigationGraph: { nodes: [], edges: [] } },
  navigationPlans: {},
};
let changedObjectiveResult = stellarTerritoryMode.handleAction({
  action: repeatingAiAction,
  seat: "A2",
  modeState: changedObjectiveState,
  simulation: repeatingAiSimulation,
});
changedObjectiveState = changedObjectiveResult.modeState;
changedObjectiveState.navigationPlans["A2:main"].watchdog = { elapsed: 4.9, lastDistance: 100, replans: 1 };
changedObjectiveResult = stellarTerritoryMode.handleAction({
  action: {
    ...repeatingAiAction,
    endX: 200,
    navigationKey: "capture_control_point:control-mid",
  },
  seat: "A2",
  modeState: changedObjectiveState,
  simulation: repeatingAiSimulation,
});
const changedObjectivePlan = changedObjectiveResult.modeState.navigationPlans["A2:main"];
assert(
  changedObjectivePlan.navigationKey === "capture_control_point:control-mid"
    && stableJson(changedObjectivePlan.watchdog) === stableJson({ elapsed: 0, lastDistance: null, replans: 0 }),
  `changing AI objective keys should reset watchdog state: ${stableJson(changedObjectivePlan)}`,
);
const changedObjectiveStep = advanceNavigationPlans({
  modeState: changedObjectiveResult.modeState,
  simulation: repeatingAiSimulation,
  dt: 0.25,
});
assert(
  changedObjectiveStep.modeState.navigationPlans["A2:main"]
    && !changedObjectiveStep.events.some((event) => event.type === "navigation_stuck"),
  `a changed AI objective should not inherit immediate stuck failure: ${stableJson(changedObjectiveStep)}`,
);

let refreshedObjectiveState = stellarTerritoryMode.handleAction({
  action: repeatingAiAction,
  seat: "A2",
  modeState: {
    elapsed: 0,
    map: repeatingAiState.map,
    navigationPlans: {},
  },
  simulation: repeatingAiSimulation,
}).modeState;
refreshedObjectiveState.navigationPlans["A2:main"].watchdog = { elapsed: 2, lastDistance: 100, replans: 1 };
const refreshedObjectiveResult = stellarTerritoryMode.handleAction({
  action: { ...repeatingAiAction, endX: 150 },
  seat: "A2",
  modeState: refreshedObjectiveState,
  simulation: repeatingAiSimulation,
});
assert(
  stableJson(refreshedObjectiveResult.modeState.navigationPlans["A2:main"].watchdog)
    === stableJson({ elapsed: 2, lastDistance: 150, replans: 1 }),
  `same-objective waypoint changes should rebase watchdog distance: ${stableJson(refreshedObjectiveResult.modeState.navigationPlans["A2:main"])}`,
);

const progressShip = { x: 2, y: 0, radius: 18, alive: true, route: { p2: { x: 100, y: 0 } } };
const progressPlan = createNavigationPlan({
  seat: "A1",
  shipKey: "main",
  route: {
    accepted: true,
    kind: "direct",
    clearance: 18,
    start: { x: 0, y: 0 },
    target: { x: 100, y: 0 },
    waypoints: [{ x: 100, y: 0, nodeId: null }],
  },
});
progressPlan.watchdog = { elapsed: 4, lastDistance: 100, replans: 1 };
const progressStep = advanceNavigationPlans({
  modeState: { map: { obstacleRegions: [] }, navigationPlans: { "A1:main": progressPlan } },
  simulation: { fleetBySeat: () => ({ shipByKey: () => progressShip }) },
  dt: 1,
});
assert(
  stableJson(progressStep.modeState.navigationPlans["A1:main"].watchdog)
    === stableJson({ elapsed: 0, lastDistance: 98, replans: 0 }),
  `meaningful watchdog progress should reset the bounded window: ${stableJson(progressStep)}`,
);

const parityRuntime = createPrototypeRuntime({
  modeDefinition: stellarTerritoryMode,
  runtimePreset: stellarTerritoryPreset.runtimePreset,
  randomSeed: 7351,
});
parityRuntime.start();
const parityState = parityRuntime.getModeState();
const paritySimulation = parityRuntime.getSimulation();
const parityStart = parityState.map.spawnAreas[0].center;
const parityTarget = parityState.map.controlPoints[0].center;
for (const seat of ["A1", "A2"]) {
  const parityShip = paritySimulation.fleetBySeat(seat).shipByKey("main");
  parityShip.x = parityStart.x;
  parityShip.y = parityStart.y;
  parityShip.command = { ...parityStart };
  parityShip.route = null;
  assert(parityRuntime.applyAction({
    type: "set_route",
    shipKey: "main",
    endX: parityTarget.x,
    endY: parityTarget.y,
    throttle: 1,
  }, seat), `${seat} detour command should be accepted`);
}
const humanPlan = parityRuntime.getModeState().navigationPlans?.["A1:main"];
const aiPlan = parityRuntime.getModeState().navigationPlans?.["A2:main"];
assert(humanPlan?.waypoints?.length >= 2, `human route should create a graph detour: ${stableJson(humanPlan)}`);
assert(aiPlan?.waypoints?.length >= 2, `AI-seat route should create a graph detour: ${stableJson(aiPlan)}`);
assert(
  stableJson(humanPlan.waypoints.map((waypoint) => waypoint.nodeId))
    === stableJson(aiPlan.waypoints.map((waypoint) => waypoint.nodeId)),
  `human and AI seats should use identical waypoint IDs: ${stableJson({ humanPlan, aiPlan })}`,
);
for (const [seat, parityPlan] of [["A1", humanPlan], ["A2", aiPlan]]) {
  const routeEnd = paritySimulation.fleetBySeat(seat).shipByKey("main").route?.p2;
  assert(
    routeEnd?.x === parityPlan.waypoints[0].x && routeEnd?.y === parityPlan.waypoints[0].y,
    `${seat} should issue only the first planned segment: ${stableJson({ routeEnd, parityPlan })}`,
  );
}
const editedShip = paritySimulation.fleetBySeat("A1").shipByKey("main");
const planBeforeBlockedEdit = stableJson(parityRuntime.getModeState().navigationPlans["A1:main"]);
const routeBeforeBlockedEdit = stableJson(editedShip.route);
const parityObstacle = parityState.map.obstacleRegions.find((candidate) => candidate.shape === "compound");
const blockedEditTarget = parityObstacle.primitives.find((primitive) => primitive.shape === "circle").center;
const blockedRouteEdit = parityRuntime.applyAction({
  type: "route_end",
  shipKey: "main",
  endX: blockedEditTarget.x,
  endY: blockedEditTarget.y,
}, "A1");
assert(!blockedRouteEdit, "graph route endpoint edits inside obstacles should be rejected");
assert(
  stableJson(parityRuntime.getModeState().navigationPlans["A1:main"]) === planBeforeBlockedEdit,
  "rejected endpoint edits should retain the previous navigation plan",
);
assert(stableJson(editedShip.route) === routeBeforeBlockedEdit, "rejected endpoint edits should retain the active core segment");
assert(
  parityRuntime.consumeModeEvents().some((event) => event.type === "invalid_route_target"),
  "rejected endpoint edits should emit invalid_route_target",
);
const planBeforeGraphControl = stableJson(parityRuntime.getModeState().navigationPlans["A1:main"]);
const routeBeforeGraphControl = stableJson(editedShip.route);
const graphControlAccepted = parityRuntime.applyAction({
  type: "route_control",
  shipKey: "main",
  controlX: editedShip.x + 40,
  controlY: editedShip.y + 60,
}, "A1");
assert(!graphControlAccepted, "graph navigation plans should reject manual Bezier control edits");
assert(
  stableJson(parityRuntime.getModeState().navigationPlans["A1:main"]) === planBeforeGraphControl,
  "rejected graph control edits should retain the navigation plan",
);
assert(stableJson(editedShip.route) === routeBeforeGraphControl, "rejected graph control edits should retain the core segment");
const editedTarget = parityState.map.controlPoints[1].center;
assert(parityRuntime.applyAction({
  type: "route_end",
  shipKey: "main",
  endX: editedTarget.x,
  endY: editedTarget.y,
}, "A1"), "legal endpoint edits should replan the full route");
assert(
  parityRuntime.getModeState().navigationPlans["A1:main"].target.x === editedTarget.x
    && parityRuntime.getModeState().navigationPlans["A1:main"].target.y === editedTarget.y,
  "legal endpoint edits should replace the stored final target",
);
assert(
  parityRuntime.applyAction({ type: "clear_route", shipKey: "main" }, "A1"),
  "clearing a planned route should be accepted",
);
assert(editedShip.route === null, "clearing a planned route should clear the active core segment");
assert(
  !parityRuntime.getModeState().navigationPlans?.["A1:main"],
  "clearing a planned route should remove the stored navigation plan",
);
const directTarget = { x: editedShip.x + 40, y: editedShip.y };
assert(parityRuntime.applyAction({
  type: "set_route",
  shipKey: "main",
  endX: directTarget.x,
  endY: directTarget.y,
}, "A1"), "direct control fixture should accept a nearby route");
const directControlPlan = parityRuntime.getModeState().navigationPlans["A1:main"];
assert(directControlPlan.kind === "direct" && directControlPlan.waypoints.length === 1, "direct control fixture should use one segment");
assert(parityRuntime.applyAction({
  type: "route_control",
  shipKey: "main",
  controlX: editedShip.x + 10,
  controlY: editedShip.y + 20,
}, "A1"), "direct single-segment plans should allow Bezier control edits");
assert(parityRuntime.applyAction({ type: "set_throttle", shipKey: "main", throttle: 0.25 }, "A1"), "reasoned-route fixture should accept throttle changes");
const attributedTarget = { x: editedShip.x + 60, y: editedShip.y };
assert(parityRuntime.applyAction({
  type: "set_route",
  shipKey: "main",
  endX: attributedTarget.x,
  endY: attributedTarget.y,
  reason: "capture_control_point",
  navigationKey: "capture_control_point:control-mid",
}, "A1"), "reasoned-route fixture should accept its initial route");
let attributedPlan = parityRuntime.getModeState().navigationPlans["A1:main"];
assert(attributedPlan.throttle === 0.25 && editedShip.throttle === 0.25, "throttle-less set_route should retain the current ship throttle");
attributedPlan.watchdog = { elapsed: 3, lastDistance: 60, replans: 1 };
assert(parityRuntime.applyAction({
  type: "route_end",
  shipKey: "main",
  endX: editedShip.x + 80,
  endY: editedShip.y,
}, "A1"), "reasoned endpoint edits should remain accepted");
attributedPlan = parityRuntime.getModeState().navigationPlans["A1:main"];
assert(
  attributedPlan.reason === "capture_control_point"
    && attributedPlan.navigationKey === "capture_control_point:control-mid",
  `endpoint replanning should preserve route attribution: ${stableJson(attributedPlan)}`,
);
assert(
  stableJson(attributedPlan.watchdog) === stableJson({ elapsed: 0, lastDistance: null, replans: 0 }),
  "endpoint replanning should start a fresh watchdog window",
);
parityRuntime.destroy();

const advanceRuntime = createPrototypeRuntime({
  modeDefinition: stellarTerritoryMode,
  runtimePreset: stellarTerritoryPreset.runtimePreset,
  randomSeed: 7352,
});
advanceRuntime.start();
const advanceState = advanceRuntime.getModeState();
const advanceSimulation = advanceRuntime.getSimulation();
const advanceShip = advanceSimulation.fleetBySeat("A1").shipByKey("main");
const advanceStart = advanceState.map.spawnAreas[0].center;
const advanceTarget = advanceState.map.controlPoints[0].center;
advanceShip.x = advanceStart.x;
advanceShip.y = advanceStart.y;
advanceShip.command = { ...advanceStart };
advanceShip.route = null;
assert(advanceRuntime.applyAction({
  type: "set_route",
  shipKey: "main",
  endX: advanceTarget.x,
  endY: advanceTarget.y,
  anchorToMain: false,
}, "A1"), "multi-segment advancement fixture should accept its graph route");
const initialAdvancePlan = advanceRuntime.getModeState().navigationPlans["A1:main"];
assert(initialAdvancePlan.waypoints.length >= 2, `advancement fixture requires multiple segments: ${stableJson(initialAdvancePlan)}`);
assert(initialAdvancePlan.anchorToMain === false, "multi-segment plans should retain anchorToMain=false");
assert(advanceRuntime.applyAction({
  type: "set_throttle",
  shipKey: "main",
  throttle: 0.25,
}, "A1"), "active multi-segment routes should accept throttle changes");
assert(
  advanceRuntime.getModeState().navigationPlans["A1:main"].throttle === 0.25,
  "active navigation plans should track the latest ship throttle",
);
assert(advanceRuntime.applyAction({
  type: "set_route",
  shipKey: "main",
  endX: advanceTarget.x,
  endY: advanceTarget.y,
  anchorToMain: false,
}, "A1"), "throttle-less graph refresh should remain accepted");
assert(
  advanceRuntime.getModeState().navigationPlans["A1:main"].throttle === 0.25 && advanceShip.throttle === 0.25,
  "throttle-less graph refresh should retain the current ship throttle",
);
const reachedWaypoint = initialAdvancePlan.waypoints[0];
advanceShip.x = reachedWaypoint.x;
advanceShip.y = reachedWaypoint.y;
advanceShip.command = { x: reachedWaypoint.x, y: reachedWaypoint.y };
advanceShip.route = null;
advanceRuntime.step(1 / 30);
const advancedRuntimePlan = advanceRuntime.getModeState().navigationPlans["A1:main"];
assert(advancedRuntimePlan?.currentSegment === 1, `runtime post-step should advance to segment 1: ${stableJson(advancedRuntimePlan)}`);
assert(
  advanceShip.route?.p2?.x === advancedRuntimePlan.waypoints[1].x
    && advanceShip.route?.p2?.y === advancedRuntimePlan.waypoints[1].y,
  `runtime post-step should issue the second segment: ${stableJson({ route: advanceShip.route, advancedRuntimePlan })}`,
);
assert(advanceShip.route.anchorToMain === false, "later route segments should retain anchorToMain=false");
assert(advanceShip.throttle === 0.25, "later route segments should retain the latest throttle");
advanceRuntime.destroy();

console.log("territory navigation verification passed");
