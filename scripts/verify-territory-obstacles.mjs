import {
  circleIntersectsObstacle,
  firstObstacleHit,
  pointInObstacle,
  positionClearOfObstacles,
  resolveMovementAgainstObstacles,
  segmentIntersectsObstacle,
  sweepCircleAgainstObstacle,
} from "../shared/gameplay/territory-obstacles.js";

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
closeTo(unobstructed.position.x, 60, 1e-9, "clear movement preserves x");
closeTo(unobstructed.position.y, 40, 1e-9, "clear movement preserves y");

assert(positionClearOfObstacles({ x: 40, y: 40 }, 6, [polygon, compound]), "clear position accepted");
assert(!positionClearOfObstacles({ x: 130, y: 120 }, 6, [polygon, compound]), "polygon overlap rejected");
assert(!positionClearOfObstacles({ x: 430, y: 120 }, 6, [polygon, compound]), "compound overlap rejected");
assert(positionClearOfObstacles({ x: 40, y: 40 }, 6, null), "missing obstacle list is clear");

console.log("territory obstacle verification passed");
