import {
  circleIntersectsObstacle,
  firstObstacleHit,
  pointInObstacle,
  positionClearOfObstacles,
  resolveMovementAgainstObstacles,
  segmentIntersectsObstacle,
  sweepCircleAgainstObstacle,
} from "../shared/gameplay/territory-obstacles.js";
import { MatchSimulation } from "../shared/game-core.js";
import { stellarTerritoryMode } from "../shared/modes/stellar-territory.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function closeTo(actual, expected, tolerance, message) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected} +/- ${tolerance}, got ${actual}`,
  );
}

const polygon = {
  id: "poly",
  shape: "polygon",
  points: [
    { x: 100, y: 80 },
    { x: 180, y: 100 },
    { x: 170, y: 180 },
    { x: 90, y: 160 },
  ],
};

const compound = {
  id: "compound",
  shape: "compound",
  primitives: [
    { shape: "circle", center: { x: 340, y: 120 }, radius: 28 },
    { shape: "capsule", start: { x: 390, y: 90 }, end: { x: 470, y: 150 }, radius: 18 },
  ],
};

assert(pointInObstacle({ x: 130, y: 120 }, polygon), "polygon contains inner point");
assert(pointInObstacle({ x: 95, y: 120 }, polygon), "polygon includes boundary point");
assert(!pointInObstacle({ x: 40, y: 40 }, polygon), "polygon excludes outer point");
assert(pointInObstacle({ x: 340, y: 120 }, compound), "compound contains circle center");
assert(pointInObstacle({ x: 430, y: 120 }, compound), "compound contains capsule axis point");
assert(!pointInObstacle({ x: 380, y: 170 }, compound), "compound excludes point outside all primitives");

assert(circleIntersectsObstacle({ x: 84, y: 120 }, 12, polygon), "ship radius reaches polygon edge");
assert(!circleIntersectsObstacle({ x: 70, y: 120 }, 8, polygon), "clear circle remains outside polygon");
assert(circleIntersectsObstacle({ x: 304, y: 120 }, 8, compound), "circle clearance reaches compound circle");
assert(circleIntersectsObstacle({ x: 430, y: 144 }, 8, compound), "circle clearance reaches compound capsule");
assert(!circleIntersectsObstacle({ x: 430, y: 160 }, 7, compound), "circle outside compound clearance stays clear");

assert(
  segmentIntersectsObstacle({ x: 20, y: 130 }, { x: 240, y: 130 }, polygon, 8),
  "cleared segment crosses polygon",
);
assert(
  !segmentIntersectsObstacle({ x: 20, y: 40 }, { x: 240, y: 40 }, polygon, 8),
  "distant segment clears polygon",
);
assert(
  segmentIntersectsObstacle({ x: 280, y: 120 }, { x: 500, y: 120 }, compound),
  "segment crosses both compound primitive kinds",
);
assert(
  segmentIntersectsObstacle({ x: 280, y: 82 }, { x: 370, y: 82 }, compound, 12),
  "segment clearance expands compound circle",
);

const swept = sweepCircleAgainstObstacle({
  previousPosition: { x: 20, y: 130 },
  nextPosition: { x: 240, y: 130 },
  radius: 8,
  obstacle: polygon,
});
assert(swept.hit && swept.time > 0 && swept.time < 1, `high-speed sweep should hit: ${JSON.stringify(swept)}`);
assert(swept.obstacle === polygon, "sweep reports the hit obstacle");
assert(Number.isFinite(swept.point?.x) && Number.isFinite(swept.normal?.x), "sweep reports contact point and normal");

const startInside = sweepCircleAgainstObstacle({
  previousPosition: { x: 130, y: 120 },
  nextPosition: { x: 240, y: 120 },
  radius: 4,
  obstacle: polygon,
});
assert(startInside.hit && startInside.time === 0, "sweep reports an initial overlap immediately");

const first = firstObstacleHit(
  { x: 0, y: 120 },
  { x: 520, y: 120 },
  [compound, polygon],
  6,
);
assert(first?.obstacle === polygon, `first hit should be selected by time, not array order: ${JSON.stringify(first)}`);
assert(first.time > 0 && first.time < 0.3, `first hit time should be normalized: ${JSON.stringify(first)}`);

const slid = resolveMovementAgainstObstacles({
  previousPosition: { x: 70, y: 70 },
  nextPosition: { x: 150, y: 150 },
  radius: 8,
  obstacles: [polygon],
});
assert(!circleIntersectsObstacle(slid.position, 8, polygon), `resolved position must remain clear: ${JSON.stringify(slid)}`);
assert(slid.collided && Math.hypot(slid.position.x - 70, slid.position.y - 70) > 1, "collision preserves movement");
assert(slid.position.y > 100, `collision preserves tangential movement: ${JSON.stringify(slid)}`);
assert(Array.isArray(slid.hits) && slid.hits.length >= 1, "movement resolution reports contacts");

const unobstructed = resolveMovementAgainstObstacles({
  previousPosition: { x: 20, y: 20 },
  nextPosition: { x: 60, y: 40 },
  radius: 5,
  obstacles: [polygon, compound],
});
assert(!unobstructed.collided, "clear movement is not reported as a collision");
assert(unobstructed.normal === null, "clear movement reports a null contact normal");
closeTo(unobstructed.position.x, 60, 1e-9, "clear movement preserves x");
closeTo(unobstructed.position.y, 40, 1e-9, "clear movement preserves y");

const tangentCapsule = {
  id: "tangent-capsule",
  shape: "capsule",
  start: { x: 100, y: 80 },
  end: { x: 100, y: 140 },
  radius: 20,
};
const parallelTangent = resolveMovementAgainstObstacles({
  previousPosition: { x: 125, y: 90 },
  nextPosition: { x: 125, y: 130 },
  radius: 5,
  obstacles: [tangentCapsule],
});
assert(!parallelTangent.collided, `parallel tangent movement should remain free: ${JSON.stringify(parallelTangent)}`);
assert(
  parallelTangent.position.x > 125 && parallelTangent.position.x < 125.001,
  `parallel tangent movement only receives a microscopic outward nudge: ${JSON.stringify(parallelTangent)}`,
);
closeTo(parallelTangent.position.y, 130, 1e-9, "parallel tangent movement reaches target y");
assert(positionClearOfObstacles(parallelTangent.position, 5, [tangentCapsule]), "exact tangent position is clear");
assert(
  !sweepCircleAgainstObstacle({
    previousPosition: { x: 125, y: 90 },
    nextPosition: { x: 125, y: 130 },
    radius: 5,
    obstacle: tangentCapsule,
  }).hit,
  "parallel time-zero contact is not a blocking sweep",
);

const tangentCircle = { id: "tangent-circle", shape: "circle", center: { x: 100, y: 100 }, radius: 20 };
const separatingTangent = resolveMovementAgainstObstacles({
  previousPosition: { x: 125, y: 100 },
  nextPosition: { x: 140, y: 100 },
  radius: 5,
  obstacles: [tangentCircle],
});
assert(!separatingTangent.collided, `separating tangent movement should remain free: ${JSON.stringify(separatingTangent)}`);
closeTo(separatingTangent.position.x, 140, 1e-9, "separating tangent movement reaches target");
assert(
  !sweepCircleAgainstObstacle({
    previousPosition: { x: 125, y: 100 },
    nextPosition: { x: 140, y: 100 },
    radius: 5,
    obstacle: tangentCircle,
  }).hit,
  "separating time-zero contact is not a blocking sweep",
);

const enteringTangent = resolveMovementAgainstObstacles({
  previousPosition: { x: 125, y: 100 },
  nextPosition: { x: 110, y: 100 },
  radius: 5,
  obstacles: [tangentCircle],
});
assert(enteringTangent.collided, "inward movement from tangent contact remains blocked");
assert(enteringTangent.normal?.x > 0.99, `blocked movement exposes outward normal: ${JSON.stringify(enteringTangent)}`);
assert(positionClearOfObstacles(enteringTangent.position, 5, [tangentCircle]), "blocked tangent movement stays clear");
assert(
  sweepCircleAgainstObstacle({
    previousPosition: { x: 125, y: 100 },
    nextPosition: { x: 110, y: 100 },
    radius: 5,
    obstacle: tangentCircle,
  }).hit,
  "inward movement from time-zero contact remains a blocking sweep",
);

assert(positionClearOfObstacles({ x: 40, y: 40 }, 6, [polygon, compound]), "clear position accepted");
assert(!positionClearOfObstacles({ x: 130, y: 120 }, 6, [polygon, compound]), "polygon overlap rejected");
assert(!positionClearOfObstacles({ x: 430, y: 120 }, 6, [polygon, compound]), "compound overlap rejected");
assert(positionClearOfObstacles({ x: 40, y: 40 }, 6, null), "missing obstacle list is clear");

function environmentCollisionProviderIntegrationCheck() {
  const simulation = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "haruhi", sub1: "koizumi", sub2: "future1096" },
      B: { main: "kyon", sub1: "tsuruya", sub2: "yuki" },
    },
  });
  const beforeProvider = JSON.stringify(simulation.serializeState());
  simulation.setEnvironmentCollisionProvider(null);
  assert(JSON.stringify(simulation.serializeState()) === beforeProvider, "clearing provider preserves serialized legacy state");
  const legacyMovement = simulation.resolveEnvironmentMovement(
    { kind: "ship" },
    { x: 100, y: 120 },
    { x: 140, y: 160 },
  );
  assert(
    !legacyMovement.collided && legacyMovement.position.x === 140 && legacyMovement.position.y === 160,
    `missing provider preserves movement: ${JSON.stringify(legacyMovement)}`,
  );
  assert(simulation.traceEnvironmentSegment({ x: 0, y: 0 }, { x: 100, y: 0 }) === null, "missing provider preserves traces");
  assert(simulation.canOccupyEnvironment({ x: 900, y: 900 }, 20), "missing provider permits occupancy");

  const calls = [];
  simulation.setEnvironmentCollisionProvider({
    resolveMovement({ entity, previousPosition, nextPosition }) {
      calls.push({ kind: entity.kind, previousPosition: { ...previousPosition }, nextPosition: { ...nextPosition } });
      return nextPosition.x > 500
        ? { position: { x: 500, y: nextPosition.y }, collided: true, normal: { x: -1, y: 0 } }
        : { position: nextPosition, collided: false, normal: null };
    },
    traceSegment({ start, end, kind }) {
      calls.push({ kind, start: { ...start }, end: { ...end } });
      return end.x > 500 ? { point: { x: 500, y: start.y }, time: 0.5, kind } : null;
    },
    canOccupy({ position }) {
      calls.push({ kind: "occupancy", position: { ...position } });
      return position.x <= 500;
    },
  });

  const teamA = simulation.teamA;
  const teamB = simulation.teamB;
  const main = teamA.ships.main;
  main.x = 499;
  main.y = 600;
  main.angle = 0;
  main.speed = 120;
  main.throttle = 1.4;
  main.command = { x: 900, y: 600 };
  main.route = null;
  main.update(0.05);
  assert(main.x === 500, `ship movement should stop at provider boundary: ${JSON.stringify(main.serialize())}`);

  const attached = teamA.ships.sub1;
  assert(attached.isAttached(), "attached-ship fixture should begin attached");
  main.x = 600;
  main.y = 680;
  main.angle = 0;
  main.speed = 80;
  attached.x = 499;
  attached.y = 680;
  attached.speed = 80;
  attached.update(0.05);
  assert(attached.x === 500, `attached ship should stop at provider boundary: ${JSON.stringify(attached.serialize())}`);

  main.x = 499;
  main.y = 760;
  main.energy = main.maxEnergy;
  teamA.cooldowns.scout = 0;
  assert(teamA.launchScout(6), "scout collision fixture should launch");
  const scout = teamA.scouts.at(-1);
  scout.command = { x: 800, y: scout.y };
  scout.update(0.05);
  assert(scout.x === 500, `scout should stop at provider boundary: ${JSON.stringify(scout.serialize())}`);

  main.energy = main.maxEnergy;
  teamA.cooldowns.flagship = 0;
  assert(teamA.launchWingman(6), "wingman collision fixture should launch");
  const wingman = teamA.wingmen.at(-1);
  wingman.command = { x: 800, y: wingman.y };
  wingman.update(0.05);
  assert(wingman.x === 500, `wingman should stop at provider boundary: ${JSON.stringify(wingman.serialize())}`);

  main.x = 490;
  main.y = 900;
  main.angle = 0;
  main.cooldown = 0;
  const projectileTarget = teamB.ships.main;
  projectileTarget.x = 520;
  projectileTarget.y = 900;
  teamA.computeVisibility(teamB);
  main.tryAttack(simulation, teamB);
  const projectile = simulation.projectiles.at(-1);
  assert(projectile, "projectile collision fixture should fire");
  projectile.x = 490;
  projectile.y = 900;
  projectile.targetX = 700;
  projectile.targetY = 900;
  const targetHpBeforeProjectile = projectileTarget.hp;
  projectile.update(0.1, simulation);
  assert(!projectile.alive && projectile.x === 500, `projectile should die at boundary: ${JSON.stringify(projectile.serialize())}`);
  assert(projectileTarget.hp === targetHpBeforeProjectile, "obstacle-clipped projectile must not resolve target impact");

  teamA.split(1);
  teamA.split(2);
  const beamShip = teamA.ships.sub2;
  beamShip.x = 400;
  beamShip.y = 1000;
  beamShip.command = { x: beamShip.x, y: beamShip.y };
  beamShip.route = null;
  beamShip.energy = beamShip.maxEnergy;
  teamA.cooldowns.sub2 = 0;
  projectileTarget.x = 550;
  projectileTarget.y = 1000;
  const targetHpBeforeBeam = projectileTarget.hp;
  assert(teamA.castSubSkill("sub2", { targetX: 800, targetY: 1000 }), "beam collision fixture should cast");
  const beam = teamA.beams.at(-1);
  assert(beam.x2 === 500, `charging beam should clip at boundary: ${JSON.stringify(beam)}`);
  beam.life = 0;
  teamA.resolveChargedBeams(teamB);
  assert(beam.x2 === 500, `fired beam should remain clipped at boundary: ${JSON.stringify(beam)}`);
  assert(projectileTarget.hp === targetHpBeforeBeam, "beam target behind environment boundary must not take damage");

  assert(simulation.canOccupyEnvironment({ x: 500, y: 1100 }, 20), "provider accepts legal occupancy");
  assert(!simulation.canOccupyEnvironment({ x: 501, y: 1100 }, 20), "provider rejects blocked occupancy");
  const respawnCandidate = teamB.ships.sub1;
  respawnCandidate.alive = false;
  respawnCandidate.hp = 0;
  assert(
    !simulation.respawnShipForSeat("B", "sub1", { x: 501, y: 1100 }),
    "generic respawn should reject provider-blocked occupancy",
  );
  assert(!respawnCandidate.alive, "rejected generic respawn should keep the ship dead");
  assert(
    simulation.respawnShipForSeat("B", "sub1", { x: 500, y: 1100 }),
    "generic respawn should accept provider-clear occupancy",
  );
  assert(calls.some((call) => call.kind === "ship"), "provider records ship and attached-ship movement");
  assert(calls.some((call) => call.kind === "scout"), "provider records scout movement");
  assert(calls.some((call) => call.kind === "wingman"), "provider records wingman movement");
  assert(calls.some((call) => call.kind === "projectile"), "provider records projectile traces");
  assert(calls.some((call) => call.kind === "beam"), "provider records beam traces");

  const territorySimulation = new MatchSimulation({ mode: "pvp", worldSize: stellarTerritoryMode.worldSize });
  const territoryState = stellarTerritoryMode.createInitialModeState({
    parameters: stellarTerritoryMode.defaultParameters,
    randomSeed: 4141,
    worldSize: { width: stellarTerritoryMode.worldSize, height: stellarTerritoryMode.worldSize },
  });
  stellarTerritoryMode.prepareSimulation({ simulation: territorySimulation, modeState: territoryState });
  const territoryObstacle = territoryState.map.obstacleRegions[0];
  assert(
    !territorySimulation.canOccupyEnvironment(territoryObstacle.center, 1),
    "Stellar Territory should install obstacle occupancy on the generic provider",
  );
  assert(
    territorySimulation.traceEnvironmentSegment(
      territoryState.map.spawnAreas[0].center,
      territoryState.map.spawnAreas[1].center,
      { kind: "probe" },
    )?.obstacle,
    "Stellar Territory should install obstacle segment tracing on the generic provider",
  );
}

environmentCollisionProviderIntegrationCheck();

console.log("territory obstacle verification passed");
