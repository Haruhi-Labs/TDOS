# Three-Lane Map V2 Implementation Plan

> **For agentic workers:** Use the Workflow tool (with `agent()` / `pipeline()` / `parallel()`) or plain Agent tool to implement this plan task-by-task. Per-task subagents keep context small and reviews fast. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Stellar Territory's V1 battlefield with a verified 2160 x 2160 three-lane map that has hard obstacles, shared navigation, large compound terrain, distributed objectives, desktop minimap support, and usage telemetry.

**Architecture:** Keep the Canvas screen coordinate system at 1440 while threading a separate runtime world size through generic camera/render APIs. Keep V2 topology, obstacles, A*, route plans, terrain, AI assignment, and telemetry in focused Territory modules; expose only mode-neutral world-size, collision-provider, and post-step hooks in the shared platform/core.

**Tech Stack:** JavaScript ES modules, Canvas 2D, Vite, Node verification scripts, Playwright browser verification, existing `MatchSimulation` and Prototype mode hooks.

---

## File Map

**Create:**

- `shared/gameplay/territory-obstacles.js`: authoritative obstacle geometry, clearance, sweep, and sliding.
- `shared/gameplay/territory-navigation.js`: graph validation, deterministic A*, waypoint planning, and plan advancement.
- `shared/gameplay/territory-telemetry.js`: per-match spatial and navigation statistics plus warning derivation.
- `scripts/verify-territory-obstacles.mjs`: obstacle geometry and generic collision-provider verification.
- `scripts/verify-territory-navigation.mjs`: direct/A*/unreachable/shared-planner and route-plan lifecycle verification.
- `scripts/verify-territory-telemetry.mjs`: region aggregation and warning-threshold verification.

**Modify:**

- `package.json`: register the three new focused verification scripts.
- `src/battle/camera.js`: separate 1440 screen logical size from runtime world bounds; support persistent minimap.
- `src/battle/render.js`: draw world-sized backgrounds and project minimap content by runtime dimensions.
- `src/battle/input.js`: allow mode presentation to suppress the Bezier control handle for graph routes.
- `src/prototype/index.js`: pass preset world size to runtime/camera/frame and enable desktop minimap generically.
- `src/prototype/runtime.js`: run a generic `afterSimulationStep` hook before snapshot/evaluation.
- `src/prototype/modes/stellar-territory.js`: set `worldSize: 2160` and `persistentMinimap: true`.
- `shared/game-core.js`: add a mode-neutral environment collision provider used by ships, scouts, projectiles, beams, and occupancy checks.
- `shared/gameplay/territory-map.js`: replace V1 generation with fixed V2 topology and seeded compound terrain slots.
- `shared/gameplay/territory-spawns.js`: verify all fleet deployments against obstacle clearance.
- `shared/gameplay/territory-respawn.js`: resolve any stale/invalid respawn reservation through a legal deployment.
- `shared/gameplay/territory-pickups.js`: filter resource reservations through authoritative obstacle clearance.
- `shared/gameplay/territory-skills.js`: filter skill reservations and short-warp endpoints through authoritative clearance.
- `shared/gameplay/territory-terrain.js`: compound-field intensity and interpolated modifiers.
- `shared/gameplay/territory-ai.js`: fixed 25-second lane assignments, dynamic capacities, and shared planner-compatible route actions.
- `shared/modes/stellar-territory.js`: collision-provider installation, route interception, plan lifecycle, telemetry updates, and serialized presentation state.
- `src/modes/stellar-territory/render.js`: lane/connector/obstacle rendering, full waypoint routes, compound terrain, and minimap topology.
- `src/modes/stellar-territory/effects.js`: invalid-target and collision feedback lifetimes.
- `src/modes/stellar-territory/presentation.js`: expose navigation/telemetry state and draw screen feedback.
- Existing `scripts/verify-prototype-platform.mjs` and all focused Territory verifiers: extend authoritative assertions without deleting legacy coverage.

## Task 1: Dynamic 2160 World and Persistent Minimap

**Files:**

- Modify: `scripts/verify-prototype-platform.mjs`
- Modify: `scripts/verify-territory-browser.mjs`
- Modify: `src/battle/camera.js`
- Modify: `src/battle/render.js`
- Modify: `src/prototype/index.js`
- Modify: `src/prototype/modes/stellar-territory.js`

- [ ] **Step 1: Write failing platform assertions**

Import `createBattleCamera` and add a fake 1440-square Canvas. Assert the screen viewport remains 1440 while world clamping and minimap projection use 2160:

```js
const cameraCanvas = {
  width: 1440,
  height: 1440,
  clientWidth: 720,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 720 }),
};
const dynamicCamera = createBattleCamera({
  canvas: cameraCanvas,
  isMobile: () => false,
  showMinimap: () => true,
  worldSize: { width: 2160, height: 2160 },
});
dynamicCamera.reset({ x: 2100, y: 2100, zoom: 2 });
const dynamicView = dynamicCamera.currentViewState();
assert(approxEqual(dynamicView.width, 720), `screen viewport width stays logical: ${dynamicView.width}`);
assert(dynamicView.left + dynamicView.width <= 2160 + 1e-6, `camera clamps to runtime world: ${JSON.stringify(dynamicView)}`);
const dynamicMinimap = dynamicCamera.minimapRect();
assert(dynamicMinimap && dynamicMinimap.y > 720, `desktop minimap should occupy lower-right: ${JSON.stringify(dynamicMinimap)}`);
const worldCorner = dynamicCamera.minimapWorldPointFromScreenPoint(
  dynamicMinimap.x + dynamicMinimap.width,
  dynamicMinimap.y + dynamicMinimap.height,
);
assert(approxEqual(worldCorner.x, 2160) && approxEqual(worldCorner.y, 2160), `minimap should project runtime world: ${JSON.stringify(worldCorner)}`);
assert(stellarTerritoryPreset.runtimePreset.worldSize === 2160, "territory preset should request 2160 world");
assert(stellarTerritoryPreset.runtimePreset.persistentMinimap === true, "territory preset should request persistent minimap");
```

Also construct a camera without `worldSize` and assert its bounds remain 1440. Call `setWorldSize(2160, 2160)`, reset near the far corner, then call `setWorldSize(NaN, 0)` and assert the camera returns to valid 1440 bounds. Extend the Prototype restart fixture to prove runtime creation and every restart reapply the current preset size before camera reset.

- [ ] **Step 2: Run the platform verifier and observe RED**

Run: `npm run test:prototype-platform`

Expected: FAIL because `createBattleCamera` has no `worldSize`/`showMinimap` contract and the preset has no 2160 world.

- [ ] **Step 3: Implement generic camera and render sizing**

Use screen and world dimensions explicitly in `createBattleCamera`:

```js
const SCREEN_LOGICAL = DEFAULT_WORLD_SIZE;

export function createBattleCamera({
  canvas,
  isMobile,
  showMinimap = isMobile,
  worldSize = { width: DEFAULT_WORLD_SIZE, height: DEFAULT_WORLD_SIZE },
  mobileZoomEnabled = () => true,
  overviewWhenIdle = () => false,
  getTrackedShip = () => null,
  onZoomChanged = () => {},
}) {
  let worldWidth = Number(worldSize?.width) || DEFAULT_WORLD_SIZE;
  let worldHeight = Number(worldSize?.height) || DEFAULT_WORLD_SIZE;
  function setWorldSize(width, height = width) {
    worldWidth = Math.max(SCREEN_LOGICAL, Number(width) || DEFAULT_WORLD_SIZE);
    worldHeight = Math.max(SCREEN_LOGICAL, Number(height) || DEFAULT_WORLD_SIZE);
    const centered = clampCameraCenter(centerX, centerY);
    centerX = centered.x;
    centerY = centered.y;
  }
  function clampCameraCenter(cx, cy, zoom = effectiveViewZoom()) {
    const width = SCREEN_LOGICAL / zoom;
    const height = SCREEN_LOGICAL / zoom;
    return {
      x: clamp(cx, width * 0.5, worldWidth - width * 0.5),
      y: clamp(cy, height * 0.5, worldHeight - height * 0.5),
      width,
      height,
      zoom,
    };
  }
  function minimapRect() {
    if (!showMinimap()) return null;
    const size = clamp(SCREEN_LOGICAL * 0.145, 180, 230);
    return { x: SCREEN_LOGICAL - size - 18, y: SCREEN_LOGICAL - size - 18, width: size, height: size };
  }
  return {
    setWorldSize,
    getWorldSize: () => ({ width: worldWidth, height: worldHeight }),
    currentViewState,
    screenPointFromEvent,
    worldPointFromScreenPoint,
    pointerFromEvent,
    minimapRect,
    minimapWorldPointFromScreenPoint,
    centerCameraOn,
    setCameraZoom,
    adjustCameraZoom,
    updateCamera,
    resizeCanvas,
    reset,
    releaseManual() { manualUntil = 0; },
  };
}
```

Update every camera clamp/projection occurrence to use `SCREEN_LOGICAL` for screen coordinates and `worldWidth`/`worldHeight` for world coordinates. Change `drawBackground(ctx, stars, elapsed, worldSize)` and `drawMinimap()` to derive projection denominators from `frame.worldSize` rather than module `LOGICAL`.

- [ ] **Step 4: Thread preset dimensions through Prototype**

Add the preset and runtime/frame wiring:

```js
runtimePreset: {
  worldSize: 2160,
  persistentMinimap: true,
  controlA: "human",
  controlB: "ai",
}
```

```js
const worldSize = Number(mode.runtimePreset?.worldSize) || DEFAULT_WORLD_SIZE;
const runtime = createPrototypeRuntime({
  modeDefinition: mode,
  runtimePreset: mode.runtimePreset || {},
  worldSize,
  teamLoadouts: { A: app.loadoutA, B: app.loadoutB },
  gameplayRules: app.gameplayRules,
  modeParameters: app.modeParameters,
  aiDifficulty: mode.runtimePreset?.aiDifficulty || "normal",
  randomSeed: requestedRandomSeed,
});
runtime.start();
camera.setWorldSize(worldSize, worldSize);
```

Normalize the square simulation size into `frame.worldSize = { width, height }`, with both values sourced from `snap.world.size` and falling back to 1440. Set `frame.showMinimap` from mobile layout or `runtimePreset.persistentMinimap`. Render helpers consume only this object form, while the simulation's existing numeric `world.size` serialization remains unchanged.

- [ ] **Step 5: Verify GREEN and add browser proof**

Run: `npm run test:prototype-platform`

Expected: PASS.

Extend `scripts/verify-territory-browser.mjs` to assert `snapshot.world.size === 2160`, camera bounds reach beyond 1440 after minimap navigation, and a lower-right minimap pixel probe is non-empty on desktop.

Run: `npm run test:territory-browser`

Expected: PASS with real runtime/canvas evidence.

- [ ] **Step 6: Commit Task 1**

```bash
git add scripts/verify-prototype-platform.mjs scripts/verify-territory-browser.mjs src/battle/camera.js src/battle/render.js src/prototype/index.js src/prototype/modes/stellar-territory.js
git commit -m "Add dynamic world sizing to Prototype"
```

## Task 2: Authoritative Obstacle Geometry

**Files:**

- Create: `shared/gameplay/territory-obstacles.js`
- Create: `scripts/verify-territory-obstacles.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing geometry tests**

Create fixtures for a polygon and a compound circle/capsule obstacle. Assert point, circle clearance, segment crossing, high-speed sweep, and tangent slide:

```js
const polygon = {
  id: "poly",
  shape: "polygon",
  points: [{ x: 100, y: 80 }, { x: 180, y: 100 }, { x: 170, y: 180 }, { x: 90, y: 160 }],
};
assert(pointInObstacle({ x: 130, y: 120 }, polygon), "polygon contains inner point");
assert(!pointInObstacle({ x: 40, y: 40 }, polygon), "polygon excludes outer point");
assert(circleIntersectsObstacle({ x: 82, y: 120 }, 12, polygon), "ship radius reaches polygon edge");
assert(segmentIntersectsObstacle({ x: 20, y: 130 }, { x: 240, y: 130 }, polygon, 8), "cleared segment crosses polygon");
const swept = sweepCircleAgainstObstacle({
  previousPosition: { x: 20, y: 130 },
  nextPosition: { x: 240, y: 130 },
  radius: 8,
  obstacle: polygon,
});
assert(swept.hit && swept.time > 0 && swept.time < 1, `high-speed sweep should hit: ${JSON.stringify(swept)}`);
const slid = resolveMovementAgainstObstacles({
  previousPosition: { x: 70, y: 70 },
  nextPosition: { x: 150, y: 150 },
  radius: 8,
  obstacles: [polygon],
});
assert(!circleIntersectsObstacle(slid.position, 8, polygon), `resolved position must remain clear: ${JSON.stringify(slid)}`);
assert(slid.collided && Math.hypot(slid.position.x - 70, slid.position.y - 70) > 1, "collision should preserve tangential movement");
```

- [ ] **Step 2: Run the new verifier and observe RED**

Run: `node scripts/verify-territory-obstacles.mjs`

Expected: module-not-found failure for `territory-obstacles.js`.

- [ ] **Step 3: Implement the geometry API**

Export these exact contracts:

```js
export function pointInObstacle(point, obstacle) {}
export function circleIntersectsObstacle(center, radius, obstacle) {}
export function segmentIntersectsObstacle(start, end, obstacle, clearance = 0) {}
export function sweepCircleAgainstObstacle({ previousPosition, nextPosition, radius, obstacle }) {}
export function resolveMovementAgainstObstacles({ previousPosition, nextPosition, radius, obstacles, maxSlides = 2 }) {}
export function firstObstacleHit(start, end, obstacles, clearance = 0) {}
export function positionClearOfObstacles(position, radius, obstacles) {}
```

Implement polygon inclusion with ray casting, closest-point edge distance for circle clearance, analytic segment-circle/capsule intersections for compound primitives, and earliest-time sweep selection. `resolveMovementAgainstObstacles()` must move to `time - 1e-4`, project the remaining delta onto the contact tangent, and repeat no more than `maxSlides`.

- [ ] **Step 4: Register and verify GREEN**

Add:

```json
"test:territory-obstacles": "node scripts/verify-territory-obstacles.mjs"
```

Run: `npm run test:territory-obstacles`

Expected: `territory obstacle verification passed`.

Run: `npm run test:core`

Expected: PASS because the pure module is not yet installed into the simulation.

- [ ] **Step 5: Commit Task 2**

```bash
git add package.json shared/gameplay/territory-obstacles.js scripts/verify-territory-obstacles.mjs
git commit -m "Add territory obstacle geometry"
```

## Task 3: Fixed Three-Lane V2 Topology

**Files:**

- Modify: `shared/gameplay/territory-map.js`
- Modify: `shared/modes/stellar-territory.js`
- Modify: `scripts/verify-territory-map.mjs`
- Modify: `scripts/verify-prototype-platform.mjs`

- [ ] **Step 1: Replace V1 expectations with failing V2 assertions**

Use 2160 dimensions and assert exact fixed geometry:

```js
const mapA = generateTerritoryMap({ seed: 111, templateId: "three-lane-v2", worldSize: { width: 2160, height: 2160 }, teamSize: 3 });
assert(mapA.templateId === "three-lane-v2" && mapA.version === 2, "V2 identity");
assert(mapA.controlPoints.map((point) => `${point.id}:${point.center.x}:${point.center.y}`).join("|") ===
  "control-top:860:330|control-mid:1080:1080|control-bottom:1300:1830", "exact control layout");
assert(mapA.laneCorridors.map((lane) => lane.id).join(",") === "top,mid,bottom", "three named lanes");
assert(mapA.connectorCorridors.length >= 4, "at least four cross-lane connectors");
assert(mapA.obstacleRegions.length >= 4 && mapA.obstacleRegions.length <= 6, "four to six hard obstacle groups");
assert(mapA.navigationGraph.nodes.length > 12 && mapA.navigationGraph.edges.length > 12, "navigation graph covers strategic nodes");
assert(firstObstacleHit(spawnA.center, spawnB.center, mapA.obstacleRegions, 0), "base-to-base line must be blocked");
assert(!collinear(mapA.controlPoints.map((point) => point.center)), "control points must not share one diagonal");
```

For seeds 1 through 1000, assert the fixed topology arrays are identical, `validateTerritoryMap()` is valid, every graph node is obstacle-clear, every graph edge is clear, and all required graph nodes are connected.

- [ ] **Step 2: Run map/platform verifiers and observe RED**

Run: `npm run test:territory-map`

Expected: FAIL on V1 template/topology.

Run: `npm run test:prototype-platform`

Expected: FAIL because the default parameter still records `three-lane-v1`.

- [ ] **Step 3: Build deterministic V2 map data**

Set:

```js
export const TERRITORY_MAP_TEMPLATE_ID = "three-lane-v2";
```

Return this top-level shape from both candidate and safe generation:

```js
{
  version: 2,
  seed,
  templateId: TERRITORY_MAP_TEMPLATE_ID,
  worldSize: { width: 2160, height: 2160 },
  safeBounds,
  spawnAreas,
  controlPoints,
  laneCorridors,
  obstacleRegions,
  connectorCorridors,
  navigationGraph,
  terrainSlots,
  terrainRegions,
  resourceSpawnNodes,
  skillSpawnNodes,
}
```

Define fixed geometry in normalized 2160 coordinates and rotate paired structures with:

```js
function rotate180(pointValue, size) {
  return point(size.width - pointValue.x, size.height - pointValue.y);
}
```

Only terrain types, bounded field offsets, field radii, and strength may consume seeded randomness.

- [ ] **Step 4: Strengthen map validation**

Validate exact counts/IDs, rotational pairs, lane membership, connector count, obstacle clearance for all spawns/control/resource/skill/terrain slots, graph edge clearance, graph connectivity, and blocked A-to-B line. Unsupported templates return the deterministic V2 safe map.

- [ ] **Step 5: Verify GREEN**

Run: `npm run test:territory-map`

Expected: PASS for all 1000 seeds.

Run: `npm run test:prototype-platform`

Expected: PASS with `mapTemplate === "three-lane-v2"` and state version 2.

- [ ] **Step 6: Commit Task 3**

```bash
git add shared/gameplay/territory-map.js shared/modes/stellar-territory.js scripts/verify-territory-map.mjs scripts/verify-prototype-platform.mjs
git commit -m "Build fixed three-lane territory map"
```

## Task 4: Generic Environment Collision Provider

**Files:**

- Modify: `shared/game-core.js`
- Modify: `shared/gameplay/territory-spawns.js`
- Modify: `shared/gameplay/territory-respawn.js`
- Modify: `shared/gameplay/territory-pickups.js`
- Modify: `shared/gameplay/territory-skills.js`
- Modify: `shared/modes/stellar-territory.js`
- Modify: `scripts/verify-territory-obstacles.mjs`
- Modify: `scripts/verify-territory-respawn.mjs`
- Modify: `scripts/verify-territory-resources.mjs`
- Modify: `scripts/verify-territory-skills.mjs`

- [ ] **Step 1: Add failing integration assertions**

Install a recording provider on a `MatchSimulation` and assert generic behavior without a mode ID:

```js
simulation.setEnvironmentCollisionProvider({
  resolveMovement({ entity, previousPosition, nextPosition }) {
    calls.push({ kind: entity.kind, previousPosition, nextPosition });
    return nextPosition.x > 500
      ? { position: { x: 500, y: nextPosition.y }, collided: true, normal: { x: -1, y: 0 } }
      : { position: nextPosition, collided: false, normal: null };
  },
  traceSegment({ start, end, kind }) {
    return end.x > 500 ? { point: { x: 500, y: start.y }, time: 0.5, kind } : null;
  },
  canOccupy({ position }) {
    return position.x <= 500;
  },
});
```

Assert a ship and scout stop/slide before x=500, a projectile dies at the boundary, a beam endpoint clips to x=500 before target resolution, and standard simulations with no provider retain byte-equivalent behavior.

- [ ] **Step 2: Run obstacle/core tests and observe RED**

Run: `npm run test:territory-obstacles`

Expected: FAIL because `setEnvironmentCollisionProvider()` is absent.

- [ ] **Step 3: Add the mode-neutral provider API**

Add to `MatchSimulation`:

```js
setEnvironmentCollisionProvider(provider = null) {
  this.environmentCollisionProvider = provider && typeof provider === "object" ? provider : null;
}

resolveEnvironmentMovement(entity, previousPosition, nextPosition) {
  const resolved = this.environmentCollisionProvider?.resolveMovement?.({ entity, previousPosition, nextPosition });
  return resolved?.position ? resolved : { position: nextPosition, collided: false, normal: null };
}

traceEnvironmentSegment(start, end, options = {}) {
  return this.environmentCollisionProvider?.traceSegment?.({ start, end, ...options }) || null;
}

canOccupyEnvironment(position, radius = 0, options = {}) {
  const result = this.environmentCollisionProvider?.canOccupy?.({ position, radius, ...options });
  return result !== false;
}
```

Initialize `environmentCollisionProvider = null`. Route ship, attached-ship, scout, and wingman proposed positions through `resolveEnvironmentMovement()`. Route projectile travel through `traceEnvironmentSegment()` before impact. Clip charged beam endpoints through the same trace before scanning targets.

- [ ] **Step 4: Install the Territory provider and legal-placement checks**

In `prepareSimulation()`, create provider closures over `modeState.map.obstacleRegions`:

```js
simulation.setEnvironmentCollisionProvider({
  resolveMovement: ({ entity, previousPosition, nextPosition }) => resolveMovementAgainstObstacles({
    previousPosition,
    nextPosition,
    radius: Number(entity?.radius) || 0,
    obstacles: modeState.map.obstacleRegions,
  }),
  traceSegment: ({ start, end, radius = 0 }) => firstObstacleHit(start, end, modeState.map.obstacleRegions, radius),
  canOccupy: ({ position, radius = 0 }) => positionClearOfObstacles(position, radius, modeState.map.obstacleRegions),
});
```

Use `positionClearOfObstacles()` in spawn deployment, respawn fallback, resource node selection, skill node selection, and short-warp endpoint validation. A blocked short warp returns `accepted: false` and emits no effect.

- [ ] **Step 5: Verify collision and lifecycle GREEN**

Run:

```text
npm run test:territory-obstacles
npm run test:territory-respawn
npm run test:territory-resources
npm run test:territory-skills
npm run test:core
npm run test:2v2-core
```

Expected: all PASS; core and 2v2 prove the unset provider preserves legacy behavior.

- [ ] **Step 6: Commit Task 4**

```bash
git add shared/game-core.js shared/gameplay/territory-spawns.js shared/gameplay/territory-respawn.js shared/gameplay/territory-pickups.js shared/gameplay/territory-skills.js shared/modes/stellar-territory.js scripts/verify-territory-obstacles.mjs scripts/verify-territory-respawn.mjs scripts/verify-territory-resources.mjs scripts/verify-territory-skills.mjs
git commit -m "Enforce territory obstacle collisions"
```

## Task 5: Deterministic A* Navigation

**Files:**

- Create: `shared/gameplay/territory-navigation.js`
- Create: `scripts/verify-territory-navigation.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing planner tests**

Cover direct, detour, unreachable, deterministic tie-breaking, clearance differences, and simplification:

```js
const direct = planTerritoryRoute({ map, start: { x: 160, y: 1900 }, end: { x: 420, y: 1900 }, clearance: 18 });
assert(direct.accepted && direct.kind === "direct" && direct.waypoints.length === 1, `direct route: ${JSON.stringify(direct)}`);
const detour = planTerritoryRoute({ map, start: map.spawnAreas[0].center, end: map.controlPoints[0].center, clearance: 18 });
assert(detour.accepted && detour.kind === "graph" && detour.waypoints.length >= 2, `A* detour: ${JSON.stringify(detour)}`);
const detourPath = [map.spawnAreas[0].center, ...detour.waypoints];
for (let index = 0; index < detourPath.length - 1; index += 1) {
  assert(!firstObstacleHit(detourPath[index], detourPath[index + 1], map.obstacleRegions, 18), "planned segment must be clear");
}
const invalid = planTerritoryRoute({ map, start: map.spawnAreas[0].center, end: obstacleInterior, clearance: 18 });
assert(!invalid.accepted && invalid.reason === "blocked_target", `blocked endpoint: ${JSON.stringify(invalid)}`);
assert(stableJson(detour) === stableJson(planTerritoryRoute({ map, start: map.spawnAreas[0].center, end: map.controlPoints[0].center, clearance: 18 })), "A* is deterministic");
```

- [ ] **Step 2: Run the navigation verifier and observe RED**

Run: `node scripts/verify-territory-navigation.mjs`

Expected: module-not-found failure.

- [ ] **Step 3: Implement graph validation and A***

Export:

```js
export function validateNavigationGraph(map) {}
export function findNavigationPath({ graph, startNodeId, endNodeId }) {}
export function planTerritoryRoute({ map, start, end, clearance = 0 }) {}
export function createNavigationPlan({ seat, shipKey, route, now, reason, throttle }) {}
export function advanceNavigationPlans({ modeState, simulation, dt }) {}
```

`findNavigationPath()` uses Euclidean edge cost/heuristic and sorts equal-score candidates by node ID. `planTerritoryRoute()` rejects blocked endpoints, returns one waypoint for a clear direct segment, otherwise attaches start/end to every visible graph node, runs A*, and removes any intermediate waypoint made redundant by a clear line of sight.

- [ ] **Step 4: Register and verify GREEN**

Add:

```json
"test:territory-navigation": "node scripts/verify-territory-navigation.mjs"
```

Run: `npm run test:territory-navigation`

Expected: `territory navigation verification passed`.

Run: `npm run test:territory-map`

Expected: PASS; map graph and planner agree.

- [ ] **Step 5: Commit Task 5**

```bash
git add package.json shared/gameplay/territory-navigation.js scripts/verify-territory-navigation.mjs
git commit -m "Add shared territory A star navigation"
```

## Task 6: Mode Route Plans and Player/AI Parity

**Files:**

- Modify: `src/prototype/runtime.js`
- Modify: `shared/modes/stellar-territory.js`
- Modify: `shared/gameplay/territory-ai.js`
- Modify: `scripts/verify-prototype-platform.mjs`
- Modify: `scripts/verify-territory-navigation.mjs`
- Modify: `scripts/verify-territory-ai.mjs`

- [ ] **Step 1: Write failing hook and route-lifecycle tests**

Extend the virtual mode to count `afterSimulationStep` calls and assert it runs after simulation time advances but before `updateModeState()` reads the snapshot. Add Territory tests that submit the same blocked direct target through human and AI seats and compare planned waypoint IDs.

```js
const accepted = runtime.applyAction({ type: "set_route", shipKey: "main", endX: target.x, endY: target.y }, "A1");
assert(accepted, "player detour command should be accepted");
const playerPlan = runtime.getModeState().navigationPlans["A1:main"];
assert(playerPlan.waypoints.length >= 2, `player route should detour: ${JSON.stringify(playerPlan)}`);
const aiAction = stellarTerritoryMode.buildAiAction({ seat: "B2", modeState: runtime.getModeState(), simulation: runtime.getSimulation(), runtime });
runtime.applyAction(aiAction, "B2");
const aiPlan = runtime.getModeState().navigationPlans["B2:main"];
assert(aiPlan && aiPlan.waypoints.every((waypoint) => positionClearOfObstacles(
  waypoint,
  aiPlan.clearance,
  runtime.getModeState().map.obstacleRegions,
)), "AI uses the same legal planner");
```

- [ ] **Step 2: Run platform/navigation/AI verifiers and observe RED**

Run: `npm run test:prototype-platform`

Expected: FAIL because `afterSimulationStep` is not called.

Run: `npm run test:territory-navigation`

Expected: FAIL because route actions bypass mode planning.

- [ ] **Step 3: Add the generic post-step hook**

In `step()`:

```js
runBeforeSimulationStep(safeDt);
state.simulation.update(safeDt);
runAfterSimulationStep(safeDt);
state.elapsedTicks += 1;
evaluateMode(safeDt);
runModeAiActions();
```

`runAfterSimulationStep()` mirrors result/event handling from `runBeforeSimulationStep()` and refreshes no snapshot itself.

- [ ] **Step 4: Intercept and advance Territory routes**

Handle `set_route`, `route_end`, `route_control`, and `clear_route` in `stellarTerritoryMode.handleAction()`. Plan direct/graph routes with the selected ship radius. On success, store `navigationPlans[key]` and apply only the first waypoint through `simulation.applyActionForSeat()`. On a blocked endpoint, retain the prior plan and emit `invalid_route_target`.

Treat route edits explicitly: `route_end` replans from the ship's current position to the edited endpoint; `route_control` is accepted only when the stored plan is a direct single-segment plan and is rejected without mutating the route for graph plans; `clear_route` clears both the core route and the stored navigation plan.

In `afterSimulationStep()`, call `advanceNavigationPlans()`. Advance when the current segment clears or the ship reaches the waypoint. Replan once after five seconds without meaningful progress; on the second watchdog failure clear the plan and emit `navigation_stuck`.

- [ ] **Step 5: Route Territory AI through the same action path**

Keep `chooseTerritoryAiAction()` returning a generic `set_route` objective action. Do not call the planner inside AI scoring. The runtime sends that action through `stellarTerritoryMode.handleAction()`, ensuring human and AI parity.

- [ ] **Step 6: Verify GREEN**

Run:

```text
npm run test:prototype-platform
npm run test:territory-navigation
npm run test:territory-ai
npm run test:territory-control
```

Expected: all PASS with multi-segment advancement and route-authority regressions intact.

- [ ] **Step 7: Commit Task 6**

```bash
git add src/prototype/runtime.js shared/modes/stellar-territory.js shared/gameplay/territory-ai.js scripts/verify-prototype-platform.mjs scripts/verify-territory-navigation.mjs scripts/verify-territory-ai.mjs
git commit -m "Route territory fleets through shared navigation"
```

## Task 7: V2 World, Route, and Minimap Presentation

**Files:**

- Modify: `src/modes/stellar-territory/render.js`
- Modify: `src/modes/stellar-territory/effects.js`
- Modify: `src/modes/stellar-territory/presentation.js`
- Modify: `src/battle/input.js`
- Modify: `src/prototype/index.js`
- Modify: `scripts/verify-territory-browser.mjs`

- [ ] **Step 1: Write failing renderer and browser assertions**

Build a recording context and assert obstacle/lane/connector draw calls, full waypoint route segments, red invalid-target feedback, and strategic minimap arrays. In Playwright, right-click an obstacle interior and assert the old valid route remains while a red feedback pixel appears; then right-click across an obstacle and assert `navigationPlans["A1:main"].waypoints.length >= 2`.

- [ ] **Step 2: Run browser verifier and observe RED**

Run: `npm run test:territory-browser`

Expected: FAIL because V2 obstacles/routes are not drawn and invalid targets have no feedback.

- [ ] **Step 3: Extend presentation state and effects**

Expose copied `navigationPlans`, `navigationFeedback`, `telemetry`, `laneCorridors`, `connectorCorridors`, `obstacleRegions`, and `navigationGraph` in presentation state. Convert `invalid_route_target`, `navigation_replanned`, `navigation_stuck`, and collision events into bounded visual effects. Extend `routeHandleAtPoint()` with an `allowControl` option and have Prototype pass `false` when the selected ship has a graph navigation plan, while retaining endpoint dragging for replanning.

- [ ] **Step 4: Draw V2 topology and full planned routes**

Render layers in this order:

```js
drawLaneCorridors(ctx, map.laneCorridors);
drawConnectorCorridors(ctx, map.connectorCorridors);
drawTerrainRegions(ctx, map.terrainRegions, options);
drawObstacleRegions(ctx, map.obstacleRegions, options);
drawControlPoints(ctx, map.controlPoints, options);
drawNavigationPlans(ctx, options.navigationPlans, options.localSeat);
```

Draw obstacle fills/edges below ships. Draw all local planned waypoints as connected segments and keep generic single-Bezier handles only for a direct plan. Extend the existing `buildTerritoryMinimapState()` with obstacle/lane/connector arrays and project them using the minimap world-size argument.

- [ ] **Step 5: Verify GREEN and review artifacts**

Run: `npm run test:territory-browser`

Expected: PASS.

Save desktop/mobile screenshots for full map, invalid target, A* detour, and persistent desktop minimap. Review each image for readable topology, no HUD overlap, and correct lower-right placement.

- [ ] **Step 6: Commit Task 7**

```bash
git add src/modes/stellar-territory/render.js src/modes/stellar-territory/effects.js src/modes/stellar-territory/presentation.js src/battle/input.js src/prototype/index.js scripts/verify-territory-browser.mjs
git commit -m "Render territory map V2 navigation"
```

## Task 8: Large Compound Terrain with Shared Intensity

**Files:**

- Modify: `shared/gameplay/territory-terrain.js`
- Modify: `shared/gameplay/territory-map.js`
- Modify: `src/modes/stellar-territory/render.js`
- Modify: `scripts/verify-territory-terrain.mjs`
- Modify: `scripts/verify-territory-browser.mjs`

- [ ] **Step 1: Write failing compound-intensity tests**

Assert region envelopes and smooth samples:

```js
const compound = {
  id: "compound",
  type: "gravity_mire",
  shape: "compound",
  fields: [
    { x: 300, y: 300, radius: 180, coreRadius: 70 },
    { x: 420, y: 300, radius: 170, coreRadius: 65 },
    { x: 360, y: 410, radius: 160, coreRadius: 60 },
  ],
};
const outside = terrainIntensityAtPoint({ x: 40, y: 40 }, compound);
const edge = terrainIntensityAtPoint({ x: 125, y: 300 }, compound);
const middle = terrainIntensityAtPoint({ x: 210, y: 300 }, compound);
const core = terrainIntensityAtPoint({ x: 300, y: 300 }, compound);
assert(outside === 0 && edge > 0 && edge < middle && middle < core && core === 1, `smooth intensity: ${outside},${edge},${middle},${core}`);
```

Place a ship at edge/middle/core and assert its multiplier is `lerp(1, coreMultiplier, intensity)` rather than binary full strength.

- [ ] **Step 2: Run terrain verifier and observe RED**

Run: `npm run test:territory-terrain`

Expected: FAIL because compound fields and `terrainIntensityAtPoint()` are absent.

- [ ] **Step 3: Implement shared terrain intensity**

Export:

```js
export function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(1e-9, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function terrainIntensityAtPoint(point, region) {
  if (region.shape === "compound") {
    return Math.max(0, ...(region.fields || []).map((field) => {
      const distance = Math.hypot(point.x - field.x, point.y - field.y);
      return 1 - smoothstep(Number(field.coreRadius) || 0, Number(field.radius) || 0, distance);
    }));
  }
  return pointInTerrainRegion(point, region) ? 1 : 0;
}
```

Interpolate every speed/acceleration/turn value from neutral to the direction-aware core modifier. Store `{ ids, intensities }` in terrain memory so enter/exit hysteresis remains stable.

- [ ] **Step 4: Generate and render large compound terrain**

Generate three to five regions from fixed top/mid/bottom/upper-wild/lower-wild slots. Circle-like region envelopes must measure 220-360; speed lanes must measure 600-1000 by 220-320. Draw overlapping fields with alpha/particle density derived from the same exported intensity contract.

- [ ] **Step 5: Verify GREEN and visual parity**

Run:

```text
npm run test:territory-terrain
npm run test:territory-map
npm run test:territory-browser
```

Expected: all PASS. Review desktop/mobile terrain screenshots for natural boundaries and visible edge-to-core strength.

- [ ] **Step 6: Commit Task 8**

```bash
git add shared/gameplay/territory-terrain.js shared/gameplay/territory-map.js src/modes/stellar-territory/render.js scripts/verify-territory-terrain.mjs scripts/verify-territory-browser.mjs
git commit -m "Add compound territory terrain"
```

## Task 9: Three-Lane AI and Distributed Spawns

**Files:**

- Modify: `shared/gameplay/territory-ai.js`
- Modify: `shared/gameplay/territory-pickups.js`
- Modify: `shared/gameplay/territory-skills.js`
- Modify: `scripts/verify-territory-ai.mjs`
- Modify: `scripts/verify-territory-resources.mjs`
- Modify: `scripts/verify-territory-skills.mjs`
- Modify: `scripts/verify-territory-performance.mjs`

- [ ] **Step 1: Write failing opening-lane and capacity tests**

At elapsed 0, 24.9, and 25.1 seconds assert assignments:

```js
const expectedOpeningLanes = { A1: "mid", A2: "top", A3: "bottom", B1: "mid", B2: "top", B3: "bottom" };
for (const [seat, laneId] of Object.entries(expectedOpeningLanes)) {
  const action = chooseTerritoryAiAction({ seat, simulation, modeState });
  const assignment = modeState.aiCoordinator[seat[0]].assignments[seat];
  assert(assignment.laneId === laneId, `${seat} opening lane should be ${laneId}: ${JSON.stringify(assignment)}`);
  assert(assignment.lockUntil === 25, `${seat} opening lock should end at 25 seconds`);
  assert(action.type === "set_route", `${seat} should receive a route action`);
}
```

Assert ordinary capacity 1, contested capacity 2, emergency defense capacity 3, retreat override, and post-lock support reassignment. Assert two common candidate nodes per lane, rare candidates in both wild connectors, and five skill strategy groups.

- [ ] **Step 2: Run AI/resource/skill verifiers and observe RED**

Run:

```text
npm run test:territory-ai
npm run test:territory-resources
npm run test:territory-skills
```

Expected: AI fails on the existing 4-second/general scoring lock; spawn distribution assertions fail on V1 grouping.

- [ ] **Step 3: Implement fixed opening assignments**

Add:

```js
const OPENING_LANE_LOCK_SECONDS = 25;
const OPENING_LANE_BY_SUFFIX = Object.freeze({ "1": "mid", "2": "top", "3": "bottom" });

function openingLaneForSeat(seat, modeState) {
  if (Number(modeState?.elapsed || 0) >= OPENING_LANE_LOCK_SECONDS) return null;
  return OPENING_LANE_BY_SUFFIX[String(seat).slice(-1)] || "mid";
}
```

During the lock, choose the control point with matching `laneId`, store `laneId`, and set `lockUntil: 25`. Permit only retreat/death to break it. After the lock, calculate capacities from objective state: ordinary 1, contested 2, emergency defense 3, collection 1.

- [ ] **Step 4: Enforce distributed node groups**

Preserve lifecycle intervals/bags/reservations. Filter candidate nodes by requested rarity/group and authoritative obstacle clearance. Include `laneId`/`regionId` on reservation events so browser and telemetry can prove distribution without positional guesses.

- [ ] **Step 5: Verify GREEN and simulation distribution**

Run:

```text
npm run test:territory-ai
npm run test:territory-resources
npm run test:territory-skills
npm run test:territory-performance
```

Expected: all PASS, with performance still finishing 3/3 deterministic matches and top/bottom occupancy present before 30 seconds.

- [ ] **Step 6: Commit Task 9**

```bash
git add shared/gameplay/territory-ai.js shared/gameplay/territory-pickups.js shared/gameplay/territory-skills.js scripts/verify-territory-ai.mjs scripts/verify-territory-resources.mjs scripts/verify-territory-skills.mjs scripts/verify-territory-performance.mjs
git commit -m "Distribute territory AI across three lanes"
```

## Task 10: Map Usage Telemetry

**Files:**

- Create: `shared/gameplay/territory-telemetry.js`
- Create: `scripts/verify-territory-telemetry.mjs`
- Modify: `package.json`
- Modify: `shared/modes/stellar-territory.js`
- Modify: `src/modes/stellar-territory/presentation.js`
- Modify: `scripts/verify-territory-performance.mjs`

- [ ] **Step 1: Write failing telemetry tests**

Construct deterministic samples and assert exact accumulation/warnings:

```js
let telemetry = createTerritoryTelemetry();
telemetry = updateTerritoryTelemetry({
  telemetry,
  modeState,
  simulation,
  dt: 1,
  events: [
    { type: "resource_collected", position: { x: 860, y: 330 }, payload: { nodeId: "res-top-west" } },
    { type: "navigation_stuck", seat: "A2", position: { x: 900, y: 600 } },
  ],
});
assert(telemetry.residencyByRegion.top > 0, `top residency: ${JSON.stringify(telemetry)}`);
assert(telemetry.pickupsByRegion.top === 1, "pickup should be assigned to top region");
assert(telemetry.navigation.stuck === 1, "stuck event counted");
const warnings = deriveTerritoryTelemetryWarnings({
  ...telemetry,
  combatTime: { total: 100, central: 60 },
  residencyByRegion: { top: 10, mid: 75, bottom: 5, upperWild: 5, lowerWild: 5 },
  navigation: { requests: 14, aiRequests: 10, stuck: 3, aiStuck: 2, replans: 2, failures: 0 },
});
assert(warnings.some((warning) => warning.code === "central_combat_concentration"), "central combat warning");
assert(warnings.some((warning) => warning.code === "lane_underused" && warning.regionId === "bottom"), "underused lane warning");
assert(warnings.some((warning) => warning.code === "navigation_stuck_rate"), "stuck-rate warning");
const aggregate = aggregateTerritoryValidationTelemetry([
  { completed: true, controlContestCounts: { "control-top": 1, "control-mid": 2, "control-bottom": 2 } },
  { completed: true, controlContestCounts: { "control-top": 0, "control-mid": 2, "control-bottom": 1 } },
]);
assert(aggregate.warnings.some((warning) => (
  warning.code === "control_point_undercontested" && warning.controlPointId === "control-top"
)), `cross-match control warning: ${JSON.stringify(aggregate)}`);
```

- [ ] **Step 2: Run telemetry verifier and observe RED**

Run: `node scripts/verify-territory-telemetry.mjs`

Expected: module-not-found failure.

- [ ] **Step 3: Implement telemetry and mode integration**

Export:

```js
export function createTerritoryTelemetry() {}
export function territoryRegionAtPoint(point, map) {}
export function updateTerritoryTelemetry({ telemetry, modeState, simulation, dt, events }) {}
export function deriveTerritoryTelemetryWarnings(telemetry) {}
export function aggregateTerritoryValidationTelemetry(matches) {}
```

Classify every living ship each tick; accumulate combat when a visible/alive enemy is within effective engagement distance. Track total combat time and the overlapping central-25% combat time separately so the concentration ratio has an unambiguous denominator. Derive damage and death positions from per-entity HP/alive sample deltas, consume pickup/control/navigation events, mark navigation requests and stuck events by AI versus player origin, and record lane transitions and completed travel durations. Add telemetry and warnings to diagnostics/presentation serialization without changing rules.

- [ ] **Step 4: Register and verify GREEN**

Add:

```json
"test:territory-telemetry": "node scripts/verify-territory-telemetry.mjs"
```

Run:

```text
npm run test:territory-telemetry
npm run test:territory-performance
```

Expected: PASS. Performance output includes region usage, contest counts, travel time, and navigation rates for each seeded match.

- [ ] **Step 5: Commit Task 10**

```bash
git add package.json shared/gameplay/territory-telemetry.js shared/modes/stellar-territory.js src/modes/stellar-territory/presentation.js scripts/verify-territory-telemetry.mjs scripts/verify-territory-performance.mjs
git commit -m "Add territory map usage telemetry"
```

## Task 11: Browser Acceptance, Full Regression, and Completion Audit

**Files:**

- Modify: `scripts/verify-territory-browser.mjs`
- Modify: `scripts/verify-territory-performance.mjs`
- Create/update: `artifacts/` evidence generated by existing verifier conventions
- Modify: `task_plan.md`, `findings.md`, `progress.md` only for local execution evidence

- [ ] **Step 1: Add final browser acceptance assertions**

Use real runtime state and input to prove:

- 2160 world and desktop/mobile camera coverage;
- A lower-left/B upper-right deployments;
- three distinct lane/control pairs and four connectors;
- real obstacle detour and illegal-target rejection;
- no ship/scout/projectile/beam/warp/respawn/pickup obstacle violation;
- persistent desktop minimap content and visibility filtering;
- top/mid/bottom opening assignments through 25 seconds;
- top and bottom control contests;
- compound terrain rule/render intensity samples;
- telemetry records matching real events.

- [ ] **Step 2: Run focused Map V2 gate**

Run:

```text
npm run test:prototype-platform
npm run test:prototype-browser
npm run test:territory-map
npm run test:territory-obstacles
npm run test:territory-navigation
npm run test:territory-control
npm run test:territory-resources
npm run test:territory-terrain
npm run test:territory-skills
npm run test:territory-respawn
npm run test:territory-scale
npm run test:territory-ai
npm run test:territory-telemetry
npm run test:territory-browser
npm run test:territory-performance
```

Expected: every command PASS; performance finishes 3/3 matches within the unchanged gate.

- [ ] **Step 3: Review required visual evidence**

Open and inspect desktop and mobile screenshots for full topology, invalid target, A* route, terrain edge/core, 3v3 lane split, desktop minimap, and an active top/bottom contest. Reject any artifact with blank Canvas, clipped map, hidden required information, unreadable labels, or overlapping HUD.

- [ ] **Step 4: Run all legacy and build gates**

Run:

```text
npm run test:core
npm run test:2v2-core
npm run test:2v2-server
npm run test:2v2-client
npm run test:2v2-comm
npm run test:2v2-reconnect
npm run test:2v2-result
npm run test:2v2-browser
npm run build
git diff --check
```

Expected: all tests/build PASS; only the existing Vite large-chunk warning is allowed; `git diff --check` has no output.

- [ ] **Step 5: Audit all 23 `map.md` acceptance criteria**

For every checkbox, record the authoritative test/state/artifact that proves it. Treat missing, indirect, or screenshot-only evidence as incomplete. Confirm no new skill/resource/control point/networked 3v3/shop/fog/teleport scope entered the diff.

- [ ] **Step 6: Request independent code review**

Run the repository review workflow against the current baseline and all Map V2 commits. Resolve every Critical/Important finding test-first, rerun affected focused tests, then rerun the full gate.

- [ ] **Step 7: Commit final acceptance updates**

```bash
git add scripts/verify-territory-browser.mjs scripts/verify-territory-performance.mjs
git commit -m "Verify territory map V2 acceptance"
```

Do not add generated `.vite/`, `temp/`, or unrelated pre-existing artifact files. Do not push, merge, deploy, or create a PR unless separately requested.
