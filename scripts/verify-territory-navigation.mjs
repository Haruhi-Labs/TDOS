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

const map = generateTerritoryMap({ seed: 7251, templateId: "three-lane-v2", worldSize: 2160 });
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

console.log("territory navigation verification passed");
