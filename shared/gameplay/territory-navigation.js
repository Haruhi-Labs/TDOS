import {
  firstObstacleHit,
  positionClearOfObstacles,
} from "./territory-obstacles.js";

const SCORE_EPSILON = 1e-9;
const WATCHDOG_PROGRESS_DISTANCE = 1;
const WATCHDOG_WINDOW_SECONDS = 5;

function finitePoint(value) {
  return Boolean(value && Number.isFinite(value.x) && Number.isFinite(value.y));
}

function pointOf(node) {
  if (finitePoint(node?.center)) return node.center;
  if (finitePoint(node?.position)) return node.position;
  if (finitePoint(node)) return node;
  return null;
}

function clonePoint(value) {
  return { x: Number(value.x), y: Number(value.y) };
}

function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalizeClearance(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function routeFailure(reason, start, target, clearance) {
  return {
    accepted: false,
    reason,
    start: finitePoint(start) ? clonePoint(start) : null,
    target: finitePoint(target) ? clonePoint(target) : null,
    clearance,
    waypoints: [],
  };
}

function routeSuccess(kind, start, target, clearance, waypoints) {
  return {
    accepted: true,
    kind,
    reason: null,
    start: clonePoint(start),
    target: clonePoint(target),
    clearance,
    waypoints,
  };
}

function pathIsClear(start, end, obstacles, clearance) {
  return !firstObstacleHit(start, end, obstacles, clearance);
}

function uniqueVirtualId(base, occupiedIds) {
  let id = base;
  let suffix = 1;
  while (occupiedIds.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  occupiedIds.add(id);
  return id;
}

function simplifyWaypoints(start, waypoints, obstacles, clearance) {
  const simplified = [];
  let anchor = start;
  let nextIndex = 0;

  while (nextIndex < waypoints.length) {
    let selectedIndex = nextIndex;
    for (let candidateIndex = waypoints.length - 1; candidateIndex >= nextIndex; candidateIndex -= 1) {
      if (pathIsClear(anchor, waypoints[candidateIndex], obstacles, clearance)) {
        selectedIndex = candidateIndex;
        break;
      }
    }
    const selected = waypoints[selectedIndex];
    simplified.push(selected);
    anchor = selected;
    nextIndex = selectedIndex + 1;
  }

  return simplified;
}

export function validateNavigationGraph(map) {
  const errors = [];
  const graph = map?.navigationGraph;
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const obstacles = Array.isArray(map?.obstacleRegions) ? map.obstacleRegions : [];

  if (!graph || typeof graph !== "object") errors.push("navigation graph missing");
  if (!Array.isArray(graph?.nodes)) errors.push("navigation nodes must be an array");
  if (!Array.isArray(graph?.edges)) errors.push("navigation edges must be an array");
  if (nodes.length === 0) errors.push("navigation graph must contain nodes");

  const nodeById = new Map();
  for (const node of nodes) {
    const id = typeof node?.id === "string" ? node.id : "";
    if (!id) {
      errors.push("navigation node id missing");
      continue;
    }
    if (nodeById.has(id)) errors.push(`duplicate navigation node id: ${id}`);
    else nodeById.set(id, node);
    const point = pointOf(node);
    if (!point) {
      errors.push(`navigation node position invalid: ${id}`);
      continue;
    }
    if (!positionClearOfObstacles(point, normalizeClearance(node.clearance), obstacles)) {
      errors.push(`navigation node blocked: ${id}`);
    }
  }

  const edgeIds = new Set();
  const adjacency = new Map(Array.from(nodeById.keys(), (id) => [id, []]));
  for (const edge of edges) {
    const id = typeof edge?.id === "string" ? edge.id : "";
    if (!id) errors.push("navigation edge id missing");
    else if (edgeIds.has(id)) errors.push(`duplicate navigation edge id: ${id}`);
    else edgeIds.add(id);

    if (!nodeById.has(edge?.from) || !nodeById.has(edge?.to)) {
      errors.push(`navigation edge references missing node: ${id || "unnamed"}`);
      continue;
    }
    if (edge.from === edge.to) {
      errors.push(`navigation edge self-reference: ${id || edge.from}`);
      continue;
    }
    adjacency.get(edge.from).push(edge.to);
    adjacency.get(edge.to).push(edge.from);
    const from = pointOf(nodeById.get(edge.from));
    const to = pointOf(nodeById.get(edge.to));
    if (from && to && !pathIsClear(from, to, obstacles, normalizeClearance(edge.clearance))) {
      errors.push(`navigation edge blocked: ${id}`);
    }
  }

  if (nodeById.size > 0) {
    const visited = new Set();
    const queue = [Array.from(nodeById.keys()).sort((a, b) => a.localeCompare(b))[0]];
    while (queue.length > 0) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      const neighbors = adjacency.get(id) || [];
      queue.push(...neighbors.filter((neighbor) => !visited.has(neighbor)));
    }
    if (visited.size !== nodeById.size) errors.push("navigation graph disconnected");
  }

  return { valid: errors.length === 0, errors };
}

export function findNavigationPath({ graph, startNodeId, endNodeId } = {}) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const nodeById = new Map();
  for (const node of nodes) {
    if (typeof node?.id !== "string" || nodeById.has(node.id) || !pointOf(node)) continue;
    nodeById.set(node.id, node);
  }
  if (!nodeById.has(startNodeId) || !nodeById.has(endNodeId)) return null;
  if (startNodeId === endNodeId) return [startNodeId];

  const adjacency = new Map(Array.from(nodeById.keys(), (id) => [id, []]));
  for (const edge of edges) {
    if (!nodeById.has(edge?.from) || !nodeById.has(edge?.to) || edge.from === edge.to) continue;
    adjacency.get(edge.from).push(edge.to);
    adjacency.get(edge.to).push(edge.from);
  }
  for (const neighbors of adjacency.values()) neighbors.sort((a, b) => a.localeCompare(b));

  const target = pointOf(nodeById.get(endNodeId));
  const open = new Set([startNodeId]);
  const closed = new Set();
  const cameFrom = new Map();
  const scores = new Map([[startNodeId, 0]]);

  while (open.size > 0) {
    const current = Array.from(open).sort((a, b) => {
      const aScore = (scores.get(a) ?? Infinity) + distanceBetween(pointOf(nodeById.get(a)), target);
      const bScore = (scores.get(b) ?? Infinity) + distanceBetween(pointOf(nodeById.get(b)), target);
      if (Math.abs(aScore - bScore) > SCORE_EPSILON) return aScore - bScore;
      return a.localeCompare(b);
    })[0];

    if (current === endNodeId) {
      const path = [current];
      while (cameFrom.has(path[0])) path.unshift(cameFrom.get(path[0]));
      return path;
    }

    open.delete(current);
    closed.add(current);
    const currentPoint = pointOf(nodeById.get(current));
    for (const neighbor of adjacency.get(current) || []) {
      const tentative = (scores.get(current) ?? Infinity)
        + distanceBetween(currentPoint, pointOf(nodeById.get(neighbor)));
      const existing = scores.get(neighbor) ?? Infinity;
      const existingParent = cameFrom.get(neighbor);
      const improves = tentative < existing - SCORE_EPSILON;
      const winsEqualParent = Math.abs(tentative - existing) <= SCORE_EPSILON
        && (existingParent == null || current.localeCompare(existingParent) < 0);
      if (!improves && !winsEqualParent) continue;
      if (closed.has(neighbor) && !improves) continue;
      cameFrom.set(neighbor, current);
      scores.set(neighbor, tentative);
      if (closed.has(neighbor) && improves) closed.delete(neighbor);
      open.add(neighbor);
    }
  }

  return null;
}

export function planTerritoryRoute({ map, start, end, clearance = 0 } = {}) {
  const safeClearance = normalizeClearance(clearance);
  if (!finitePoint(start)) return routeFailure("invalid_start", start, end, safeClearance);
  if (!finitePoint(end)) return routeFailure("invalid_target", start, end, safeClearance);

  const obstacles = Array.isArray(map?.obstacleRegions) ? map.obstacleRegions : [];
  if (!positionClearOfObstacles(start, safeClearance, obstacles)) {
    return routeFailure("blocked_start", start, end, safeClearance);
  }
  if (!positionClearOfObstacles(end, safeClearance, obstacles)) {
    return routeFailure("blocked_target", start, end, safeClearance);
  }
  if (pathIsClear(start, end, obstacles, safeClearance)) {
    return routeSuccess("direct", start, end, safeClearance, [{ ...clonePoint(end), nodeId: null }]);
  }

  const validation = validateNavigationGraph(map);
  if (!validation.valid) return routeFailure("invalid_graph", start, end, safeClearance);

  const sourceGraph = map.navigationGraph;
  const sourceNodes = sourceGraph.nodes
    .filter((node) => positionClearOfObstacles(pointOf(node), safeClearance, obstacles))
    .map((node) => ({ ...node, center: clonePoint(pointOf(node)) }));
  const sourceById = new Map(sourceNodes.map((node) => [node.id, node]));
  const edges = sourceGraph.edges
    .filter((edge) => sourceById.has(edge.from) && sourceById.has(edge.to))
    .filter((edge) => pathIsClear(
      pointOf(sourceById.get(edge.from)),
      pointOf(sourceById.get(edge.to)),
      obstacles,
      safeClearance,
    ))
    .map((edge) => ({ ...edge }));

  const occupiedIds = new Set(sourceById.keys());
  const startId = uniqueVirtualId("__territory_start__", occupiedIds);
  const endId = uniqueVirtualId("__territory_end__", occupiedIds);
  const nodes = [
    ...sourceNodes,
    { id: startId, center: clonePoint(start) },
    { id: endId, center: clonePoint(end) },
  ];
  let attachmentIndex = 0;
  for (const node of sourceNodes.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    const point = pointOf(node);
    if (pathIsClear(start, point, obstacles, safeClearance)) {
      attachmentIndex += 1;
      edges.push({ id: `__start_edge_${attachmentIndex}`, from: startId, to: node.id });
    }
    if (pathIsClear(end, point, obstacles, safeClearance)) {
      attachmentIndex += 1;
      edges.push({ id: `__end_edge_${attachmentIndex}`, from: node.id, to: endId });
    }
  }

  const nodeIds = findNavigationPath({ graph: { nodes, edges }, startNodeId: startId, endNodeId: endId });
  if (!nodeIds) return routeFailure("unreachable", start, end, safeClearance);

  const routeNodeById = new Map(nodes.map((node) => [node.id, node]));
  const waypoints = nodeIds.slice(1).map((id) => {
    const point = pointOf(routeNodeById.get(id));
    return { ...clonePoint(point), nodeId: id === endId ? null : id };
  });
  const simplified = simplifyWaypoints(start, waypoints, obstacles, safeClearance);
  return routeSuccess("graph", start, end, safeClearance, simplified);
}

export function createNavigationPlan({ seat, shipKey, route, now = 0, reason = "route", throttle = 1, anchorToMain = true, navigationKey = null } = {}) {
  if (!route?.accepted || !Array.isArray(route.waypoints) || route.waypoints.length === 0) return null;
  const createdAt = Number.isFinite(Number(now)) ? Number(now) : 0;
  const numericThrottle = Number(throttle);
  return {
    seat: String(seat || ""),
    shipKey: String(shipKey || "main"),
    kind: route.kind === "direct" ? "direct" : "graph",
    start: finitePoint(route.start) ? clonePoint(route.start) : null,
    target: finitePoint(route.target) ? clonePoint(route.target) : clonePoint(route.waypoints.at(-1)),
    clearance: normalizeClearance(route.clearance),
    waypoints: route.waypoints.map((waypoint) => ({
      ...clonePoint(waypoint),
      nodeId: typeof waypoint.nodeId === "string" ? waypoint.nodeId : null,
    })),
    currentSegment: 0,
    reason: String(reason || "route"),
    navigationKey: navigationKey ? String(navigationKey) : null,
    createdAt,
    updatedAt: createdAt,
    throttle: Number.isFinite(numericThrottle) ? Math.min(1.4, Math.max(0.25, numericThrottle)) : 1,
    anchorToMain: anchorToMain !== false,
    watchdog: {
      elapsed: 0,
      lastDistance: null,
      replans: 0,
    },
  };
}

function shipForPlan(simulation, plan) {
  const fleet = simulation?.fleetBySeat?.(plan.seat);
  return fleet?.shipByKey?.(plan.shipKey) || fleet?.ships?.[plan.shipKey] || null;
}

function issuePlanSegment(simulation, plan, waypoint) {
  return simulation?.applyActionForSeat?.(plan.seat, {
    type: "set_route",
    shipKey: plan.shipKey,
    endX: waypoint.x,
    endY: waypoint.y,
    throttle: plan.throttle,
    anchorToMain: plan.anchorToMain,
  }) === true;
}

export function advanceNavigationPlans({ modeState, simulation, dt = 0 } = {}) {
  const sourceState = modeState && typeof modeState === "object" ? modeState : {};
  const sourcePlans = sourceState.navigationPlans && typeof sourceState.navigationPlans === "object"
    ? sourceState.navigationPlans
    : {};
  const navigationPlans = {};
  for (const [key, sourcePlan] of Object.entries(sourcePlans)) {
    if (!sourcePlan || typeof sourcePlan !== "object") continue;
    navigationPlans[key] = {
      ...sourcePlan,
      waypoints: Array.isArray(sourcePlan.waypoints)
        ? sourcePlan.waypoints.map((waypoint) => ({ ...waypoint }))
        : [],
      watchdog: { ...(sourcePlan.watchdog || {}) },
    };
  }

  const nextState = { ...sourceState, navigationPlans };
  const events = [];
  const safeDt = Math.max(0, Number(dt) || 0);
  for (const key of Object.keys(navigationPlans).sort((a, b) => a.localeCompare(b))) {
    const plan = navigationPlans[key];
    const ship = shipForPlan(simulation, plan);
    const segmentIndex = Math.max(0, Math.floor(Number(plan.currentSegment) || 0));
    const waypoint = plan.waypoints[segmentIndex];
    if (!ship?.alive || !waypoint || !finitePoint(waypoint)) {
      delete navigationPlans[key];
      continue;
    }

    plan.updatedAt = Number(plan.updatedAt || plan.createdAt || 0) + safeDt;
    const waypointDistance = distanceBetween(ship, waypoint);
    const reached = waypointDistance <= Math.max(20, normalizeClearance(plan.clearance));
    if (ship.route && !reached) {
      const watchdog = plan.watchdog;
      if (!Number.isFinite(watchdog.lastDistance)) {
        watchdog.lastDistance = waypointDistance;
        watchdog.elapsed = safeDt;
      } else if (watchdog.lastDistance - waypointDistance >= WATCHDOG_PROGRESS_DISTANCE) {
        watchdog.elapsed = 0;
        watchdog.lastDistance = waypointDistance;
        watchdog.replans = 0;
      } else {
        watchdog.elapsed = Math.max(0, Number(watchdog.elapsed) || 0) + safeDt;
      }
      if (watchdog.elapsed + SCORE_EPSILON < WATCHDOG_WINDOW_SECONDS) continue;

      if (Math.max(0, Number(watchdog.replans) || 0) >= 1) {
        simulation?.applyActionForSeat?.(plan.seat, { type: "clear_route", shipKey: plan.shipKey });
        delete navigationPlans[key];
        events.push({
          type: "navigation_stuck",
          seat: plan.seat,
          position: { x: ship.x, y: ship.y },
          payload: { shipKey: plan.shipKey, target: clonePoint(plan.target), reason: plan.reason },
        });
        continue;
      }

      const route = planTerritoryRoute({
        map: sourceState.map,
        start: { x: ship.x, y: ship.y },
        end: plan.target,
        clearance: plan.clearance,
      });
      const replanned = createNavigationPlan({
        seat: plan.seat,
        shipKey: plan.shipKey,
        route,
        now: plan.updatedAt,
        reason: plan.reason,
        throttle: plan.throttle,
        anchorToMain: plan.anchorToMain,
        navigationKey: plan.navigationKey,
      });
      const firstWaypoint = replanned?.waypoints?.[0];
      if (replanned && firstWaypoint && issuePlanSegment(simulation, replanned, firstWaypoint)) {
        replanned.createdAt = plan.createdAt;
        replanned.watchdog.replans = Math.max(0, Number(watchdog.replans) || 0) + 1;
        replanned.watchdog.lastDistance = distanceBetween(ship, firstWaypoint);
        navigationPlans[key] = replanned;
        events.push({
          type: "navigation_replanned",
          seat: plan.seat,
          position: { x: ship.x, y: ship.y },
          payload: { shipKey: plan.shipKey, target: clonePoint(plan.target), reason: plan.reason },
        });
      } else {
        watchdog.elapsed = 0;
        watchdog.lastDistance = waypointDistance;
        watchdog.replans = 1;
      }
      continue;
    }

    const nextSegment = segmentIndex + 1;
    if (nextSegment >= plan.waypoints.length) {
      delete navigationPlans[key];
      continue;
    }
    const nextWaypoint = plan.waypoints[nextSegment];
    if (issuePlanSegment(simulation, plan, nextWaypoint)) {
      plan.currentSegment = nextSegment;
      plan.watchdog = {
        elapsed: 0,
        lastDistance: distanceBetween(ship, nextWaypoint),
        replans: 0,
      };
    }
  }

  return { modeState: nextState, events };
}
