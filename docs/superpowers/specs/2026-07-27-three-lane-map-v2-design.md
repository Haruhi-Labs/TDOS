# TDOS Stellar Territory Three-Lane Map V2 Design

Status: approved architecture, pending written-spec review

Source requirements: `docs/plans/map.md`

Selected approach: Approach A, generic platform seams with mode-owned V2 gameplay

## 1. Scope

This design replaces the existing Stellar Territory map topology in place. It does not create a second mode or change the standard elimination and 2v2 maps.

The deliverable includes:

- a 2160 x 2160 Stellar Territory world;
- a fixed, rotationally symmetric top/mid/bottom topology;
- hard obstacles, four or more lane connectors, and shared player/AI navigation;
- radius-aware movement collision, projectile blocking, beam clipping, and valid warp endpoints;
- three to five large compound terrain regions with smooth gameplay and visual intensity;
- lane-distributed resources, skill pickups, and 3v3 AI assignments;
- a persistent desktop minimap and map-usage telemetry;
- automated and browser evidence for every acceptance criterion in `map.md`.

The work explicitly excludes new skills, new resource types, extra control points, formal networked 3v3, shops, fog of war, and random teleport gates.

## 2. Architecture Boundaries

### 2.1 Generic Prototype platform

The Prototype platform gains only mode-neutral capabilities:

- runtime world dimensions passed to camera and rendering;
- a persistent-minimap presentation flag;
- an `afterSimulationStep` lifecycle hook;
- a generic simulation environment-collision provider.

No platform or shared-core branch may check for `stellar-territory` by ID.

### 2.2 Stellar Territory gameplay

The existing mode remains the owner of map data and orchestration. Focused modules own one responsibility each:

- `territory-map.js`: fixed topology, seeded terrain slots, candidate nodes, validation;
- `territory-obstacles.js`: geometry, clearance, sweep, segment intersection, spawn validity;
- `territory-navigation.js`: graph validation, deterministic A*, route planning, replan/stuck accounting;
- `territory-terrain.js`: compound-field intensity and movement modifiers;
- `territory-ai.js`: opening lane assignment, objective capacity, support and reassignment;
- `territory-telemetry.js`: zone residency, combat, damage, death, pickup, contest, and navigation metrics.

Presentation continues to consume the mode's public presentation state. It does not become authoritative for geometry or rules.

### 2.3 Existing battle core

Legacy movement remains a quadratic Bezier segment. Territory multi-segment routes are stored as mode-owned navigation plans keyed by seat and ship. The mode feeds one planned waypoint at a time into the existing route API.

The shared simulation exposes generic collision callbacks for movement, projectiles, and beams. Standard modes leave the provider unset and retain current behavior.

## 3. Coordinate Model

The Canvas logical screen remains 1440 x 1440. The navigable world is independently sized.

For Stellar Territory:

```js
runtimePreset: {
  worldSize: 2160,
  persistentMinimap: true,
}
```

Screen-logical dimensions control Canvas backing scale, HUD placement, and minimap placement. Runtime world dimensions control:

- camera bounds and reset/focus clamping;
- pointer-to-world conversion;
- minimap world projection;
- world background and layer extents;
- navigation, collision, spawn, terrain, and telemetry bounds.

The camera exposes a generic `setWorldSize(width, height)` operation. Runtime creation and restart call it before camera reset. A missing/invalid mode size falls back to the existing 1440 world.

## 4. Fixed Map Topology

The map template ID becomes `three-lane-v2`, version 2. Topology is deterministic for every seed; only terrain type, bounded terrain offsets, compound-field variation, and strength are seeded.

Authoritative control points at 2160 scale are:

| Lane | ID | Center | Size |
| --- | --- | --- | --- |
| top | `control-top` | `(860, 330)` | `340 x 240` |
| mid | `control-mid` | `(1080, 1080)` | `360 x 260` |
| bottom | `control-bottom` | `(1300, 1830)` | `340 x 240` |

A spawns in the lower-left and B in the upper-right. All fixed geometry is invariant under 180-degree rotation around `(1080, 1080)`.

The map contains:

- three lane corridors with widths 340, 380, and 340;
- four primary connector corridors, two between top/mid and two between mid/bottom;
- at least one narrower risk entrance in each obstacle band;
- four to six irregular obstacle groups represented by polygons and compound circle/capsule primitives;
- a fixed navigation graph covering spawns, lane entries, control points, connectors, resource areas, and skill areas;
- two common-resource candidates per lane, rare-resource candidates near upper/lower wild connectors, and five strategic skill-node groups.

Map validation rejects topology when any required node is outside bounds, inside an obstacle, disconnected, too narrow for fleet clearance, or when a direct unobstructed A-to-B segment exists. Generation falls back only to a deterministic valid V2 template, never to V1.

## 5. Obstacle Geometry and Collision

Obstacle geometry uses a single rules implementation for all consumers. Required operations are:

```js
pointInObstacle(point, obstacle)
circleIntersectsObstacle(center, radius, obstacle)
segmentIntersectsObstacle(start, end, obstacle, clearance)
sweepCircleAgainstObstacle({ previousPosition, nextPosition, radius, obstacle })
```

Polygon tests include edge clearance, not only point-in-polygon checks. Compound obstacles are unions of their child primitives.

Movement resolution finds the earliest swept collision, moves the entity to a small clearance before contact, projects the remaining displacement onto the hit tangent, and retries at most twice for corners. It never teleports an entity or zeros all velocity merely because of contact.

The collision provider applies to controllable ships and scouts. Projectile segments terminate on their first obstacle hit. Beam traces clip at the nearest obstacle before damage targets are resolved. Short warp may cross an obstacle, but its destination must pass radius-aware clearance checks.

Respawn selection, resource/skill reservation, and debug spawning use the same clearance API. No separate ad hoc obstacle checks are allowed.

## 6. Shared Navigation

`planTerritoryRoute()` is the only planner used by player commands and Territory AI:

1. Reject an endpoint whose ship-radius clearance intersects an obstacle and emit an `invalid_route_target` event.
2. Use a direct route when the start-to-end segment is clear.
3. Otherwise connect start/end to visible navigation nodes, run deterministic A*, simplify line-of-sight-redundant waypoints, and return a multi-waypoint plan.
4. Reject a route when no legal graph path exists.

A plan stores the final target, clearance radius, ordered waypoints, current segment, reason, creation time, and progress watchdog data. Each segment uses the current Bezier mover. Completion advances to the next waypoint. Player endpoint editing replans the full path; manual control-point editing is enabled only for a direct single-segment plan.

The watchdog samples progress over a bounded window. A ship that fails to advance first replans from its current position. Repeated failure clears the plan, emits `navigation_stuck`, and increments telemetry rather than continuously driving into an obstacle.

The renderer shows every planned segment and marks rejected destinations in red long enough to be visible, without exposing hidden enemy information.

## 7. Compound Terrain

Each match uses three to five large terrain regions selected from five fixed slots: top, mid, bottom, upper wild, and lower wild.

Circle-like terrain contains three to six overlapping fields whose combined envelope has an effective radius in the 220-360 range. Speed-lane terrain uses a 600-1000 length and 220-320 width. Each region remains traversable and has `blocksPath: false`.

For each child field, intensity is a smooth edge-to-core value in `[0, 1]`. Region intensity is the maximum child intensity. Gameplay multipliers interpolate between neutral and core values using this intensity. The same computed intensity contract drives visual opacity, particle density, and ship feedback.

The renderer draws the compound field rather than a perfect diagnostic circle. Debug outlines remain available only when explicitly enabled.

## 8. AI, Resources, and Skills

For the first 25 simulated seconds:

- A1/B1 are assigned to mid;
- A2/B2 are assigned to top;
- A3/B3 are assigned to bottom.

These assignments are emergency-breakable only for retreat/death. After the lock, normal scoring may reassign fleets for stable capture, contested support, enemy pressure, announced skill pickups, empty lanes, or ticket pressure.

Objective capacity is one fleet for ordinary capture, two for contested capture, and three for emergency defense. Collection objectives retain capacity one. Every selected objective is routed through `planTerritoryRoute()`.

Resource and skill lifecycle rules remain unchanged. Only their candidate-node distribution changes. Spawn warnings reserve an exact legal node, and all reservations are obstacle-clear.

## 9. Minimap and Presentation

Stellar Territory displays the minimap in the lower-right on desktop and mobile. The existing screen-logical minimap rectangle remains stable while projection uses runtime world width/height.

The minimap includes:

- spawn areas, lane corridors, connectors, and hard obstacles;
- all three control points;
- resource and skill pickups;
- allied fleets and only currently visible enemy fleets;
- the current camera viewport.

World rendering layers obstacles beneath ships but above terrain/background. Collision feedback, route plans, and map labels cannot resize or shift the HUD.

## 10. Telemetry

The mode partitions the world into top, mid, bottom, upper wild, lower wild, and spawn regions. It records, per match and per alliance where applicable:

- ship residency and combat time by region;
- damage and death positions;
- resource pickup positions;
- control-point contested time and contest count;
- lane switches and average travel time;
- navigation requests, replans, failures, and stuck events.

Per-match diagnostics expose the first three warnings below. The validation harness aggregates completed-match telemetry and applies the fourth:

- the central 25% carries more than 55% of combat time;
- any lane receives under 15% of total residency;
- more than 10% of AI navigation tasks become stuck;
- any control point averages under one contest per completed validation match across the validation batch.

Telemetry is observational. It does not change match rules during a live game.

## 11. Failure Handling and Determinism

- Invalid world sizes fall back to 1440 without changing legacy modes.
- Invalid V2 maps fail validation and use the deterministic V2 safe template.
- Invalid player destinations are rejected without replacing the current valid route.
- Failed A* requests emit diagnostics and leave the ship controllable.
- Collision resolution has bounded iterations to prevent corner loops.
- All graph tie-breaking, slot selection, and geometry jitter are seed-stable.
- Serialization includes navigation plans and telemetry required for replay/debug inspection, but presentation-only transient feedback remains outside authoritative state.

## 12. Verification Strategy

Implementation follows test-driven stages. Each production change is preceded by a focused failing assertion.

### Stage 1: dynamic world

- unit tests for camera bounds, pointer conversion, minimap projection, renderer extents, runtime restart, and legacy 1440 fallback;
- browser proof that Stellar Territory reports and reaches the 2160 world while the HUD stays correctly framed.

### Stage 2: topology

- exact control/spawn/rotation assertions;
- lane, connector, obstacle-band, candidate-node, and no-clear-base-line assertions;
- 1000 seeded generations proving fixed connectivity and legal placement.

### Stage 3: obstacle and navigation

- geometry unit matrices for polygon/compound clearance and high-speed sweep;
- ship/scout sliding, projectile stop, beam clip, warp landing, respawn, resource, and skill legality;
- direct/A*/unreachable route tests, player/AI planner parity, multi-segment advancement, and watchdog recovery;
- browser tests for a real right-click detour and visible invalid-target feedback.

### Stage 4: terrain

- compound intensity samples at outside/edge/mid/core positions;
- interpolated movement values and rule/render intensity parity;
- desktop/mobile visual evidence for all terrain types and natural boundaries.

### Stage 5: distribution

- deterministic 3v3 opening assignments through 25 seconds;
- capacity, support, reassignment, and lane-distributed spawn assertions;
- seeded simulation proving top and bottom control contests occur.

### Stage 6: acceptance

- telemetry warning/aggregation tests;
- long-running wall-tunneling/stuck and map-performance gates;
- 1v1 and 3v3 browser rounds with desktop minimap evidence;
- all existing core, 2v2, Prototype, Territory, performance, and build checks;
- requirement-by-requirement completion audit and independent code review.

No acceptance item is complete based solely on a screenshot or a test that does not inspect its authoritative rule state.
