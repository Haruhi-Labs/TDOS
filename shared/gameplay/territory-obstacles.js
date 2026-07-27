const EPSILON = 1e-9;
const SWEEP_BACKOFF = 1e-4;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pointValue(value) {
  return {
    x: finiteNumber(value?.x),
    y: finiteNumber(value?.y),
  };
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(vector, amount) {
  return { x: vector.x * amount, y: vector.y * amount };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function lengthSquared(vector) {
  return dot(vector, vector);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalize(vector, fallback = { x: 1, y: 0 }) {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= EPSILON) return { ...fallback };
  return { x: vector.x / length, y: vector.y / length };
}

function shapeOf(obstacle) {
  return String(obstacle?.shape || obstacle?.type || "").toLowerCase();
}

function circleCenter(circle) {
  return pointValue(circle?.center || circle);
}

function circleRadius(circle) {
  return Math.max(0, finiteNumber(circle?.radius));
}

function capsuleGeometry(capsule) {
  const radius = Math.max(0, finiteNumber(capsule?.radius, finiteNumber(capsule?.width) / 2));
  const startValue = capsule?.start || capsule?.a || capsule?.from || capsule?.points?.[0];
  const endValue = capsule?.end || capsule?.b || capsule?.to || capsule?.points?.[1];
  if (startValue && endValue) {
    return { start: pointValue(startValue), end: pointValue(endValue), radius };
  }

  const center = circleCenter(capsule);
  const halfLength = Math.max(0, finiteNumber(capsule?.length) / 2);
  const angle = finiteNumber(capsule?.angle);
  const axis = { x: Math.cos(angle) * halfLength, y: Math.sin(angle) * halfLength };
  return {
    start: subtract(center, axis),
    end: add(center, axis),
    radius,
  };
}

function compoundPrimitives(obstacle) {
  const values = obstacle?.primitives || obstacle?.children || obstacle?.parts || obstacle?.shapes;
  return Array.isArray(values) ? values : [];
}

function polygonPoints(obstacle) {
  return Array.isArray(obstacle?.points) ? obstacle.points.map(pointValue) : [];
}

function closestPointOnSegment(point, start, end) {
  const segment = subtract(end, start);
  const denominator = lengthSquared(segment);
  const time = denominator <= EPSILON ? 0 : clamp(dot(subtract(point, start), segment) / denominator, 0, 1);
  return add(start, scale(segment, time));
}

function distanceToSegment(point, start, end) {
  const closest = closestPointOnSegment(point, start, end);
  return {
    closest,
    distance: Math.hypot(point.x - closest.x, point.y - closest.y),
  };
}

function pointOnSegment(point, start, end) {
  return distanceToSegment(point, start, end).distance <= EPSILON;
}

function pointInPolygon(point, points) {
  if (points.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const a = points[previous];
    const b = points[index];
    if (pointOnSegment(point, a, b)) return true;
    const crosses = (a.y > point.y) !== (b.y > point.y);
    if (!crosses) continue;
    const edgeX = a.x + ((point.y - a.y) * (b.x - a.x)) / (b.y - a.y);
    if (point.x < edgeX) inside = !inside;
  }
  return inside;
}

function nearestPolygonEdge(point, points) {
  let nearest = null;
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const candidate = distanceToSegment(point, start, end);
    if (!nearest || candidate.distance < nearest.distance) nearest = { ...candidate, start, end };
  }
  return nearest;
}

function polygonSignedArea(points) {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return twiceArea / 2;
}

function polygonContactNormal(point, points) {
  const nearest = nearestPolygonEdge(point, points);
  if (!nearest) return { x: 1, y: 0 };
  if (!pointInPolygon(point, points) && nearest.distance > EPSILON) {
    return normalize(subtract(point, nearest.closest));
  }
  const edge = subtract(nearest.end, nearest.start);
  return polygonSignedArea(points) >= 0
    ? normalize({ x: edge.y, y: -edge.x })
    : normalize({ x: -edge.y, y: edge.x });
}

function pointInPrimitive(point, obstacle) {
  const shape = shapeOf(obstacle);
  if (shape === "circle") {
    const center = circleCenter(obstacle);
    return Math.hypot(point.x - center.x, point.y - center.y) <= circleRadius(obstacle) + EPSILON;
  }
  if (shape === "capsule") {
    const capsule = capsuleGeometry(obstacle);
    return distanceToSegment(point, capsule.start, capsule.end).distance <= capsule.radius + EPSILON;
  }
  if (shape === "polygon") return pointInPolygon(point, polygonPoints(obstacle));
  if (shape === "compound") return compoundPrimitives(obstacle).some((primitive) => pointInPrimitive(point, primitive));
  return false;
}

export function pointInObstacle(point, obstacle) {
  if (!point || !obstacle) return false;
  return pointInPrimitive(pointValue(point), obstacle);
}

function circleIntersectsPrimitive(center, radius, obstacle) {
  const shape = shapeOf(obstacle);
  if (shape === "circle") {
    const obstacleCenter = circleCenter(obstacle);
    return Math.hypot(center.x - obstacleCenter.x, center.y - obstacleCenter.y)
      <= radius + circleRadius(obstacle) + EPSILON;
  }
  if (shape === "capsule") {
    const capsule = capsuleGeometry(obstacle);
    return distanceToSegment(center, capsule.start, capsule.end).distance <= radius + capsule.radius + EPSILON;
  }
  if (shape === "polygon") {
    const points = polygonPoints(obstacle);
    if (pointInPolygon(center, points)) return true;
    const nearest = nearestPolygonEdge(center, points);
    return Boolean(nearest && nearest.distance <= radius + EPSILON);
  }
  if (shape === "compound") {
    return compoundPrimitives(obstacle).some((primitive) => circleIntersectsPrimitive(center, radius, primitive));
  }
  return false;
}

export function circleIntersectsObstacle(center, radius, obstacle) {
  if (!center || !obstacle) return false;
  return circleIntersectsPrimitive(pointValue(center), Math.max(0, finiteNumber(radius)), obstacle);
}

function noHit(end, obstacle = null) {
  return {
    hit: false,
    time: 1,
    position: { ...end },
    point: null,
    normal: null,
    obstacle,
  };
}

function contactHit(time, position, point, normal, obstacle, primitive = obstacle) {
  return {
    hit: true,
    time: clamp(time, 0, 1),
    position,
    point,
    normal: normalize(normal),
    obstacle,
    primitive,
  };
}

function sweepPointAgainstCircle(start, end, center, expandedRadius, obstacle, primitive, baseRadius) {
  const movement = subtract(end, start);
  const relative = subtract(start, center);
  const distance = Math.hypot(relative.x, relative.y);
  if (distance <= expandedRadius + EPSILON) {
    const normal = normalize(relative, normalize(scale(movement, -1)));
    return contactHit(0, start, add(center, scale(normal, baseRadius)), normal, obstacle, primitive);
  }

  const a = lengthSquared(movement);
  if (a <= EPSILON) return noHit(end, obstacle);
  const b = 2 * dot(relative, movement);
  const c = lengthSquared(relative) - expandedRadius * expandedRadius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return noHit(end, obstacle);
  const root = Math.sqrt(Math.max(0, discriminant));
  const time = (-b - root) / (2 * a);
  if (time < -EPSILON || time > 1 + EPSILON) return noHit(end, obstacle);
  const position = add(start, scale(movement, clamp(time, 0, 1)));
  const normal = normalize(subtract(position, center), normalize(scale(movement, -1)));
  return contactHit(time, position, add(center, scale(normal, baseRadius)), normal, obstacle, primitive);
}

function earliestHit(hits, end, obstacle) {
  let earliest = null;
  for (const hit of hits) {
    if (!hit?.hit) continue;
    if (!earliest || hit.time < earliest.time - EPSILON) earliest = hit;
  }
  return earliest || noHit(end, obstacle);
}

function sweepPointAgainstCapsule(start, end, axisStart, axisEnd, expandedRadius, obstacle, primitive, baseRadius) {
  const initial = distanceToSegment(start, axisStart, axisEnd);
  const movement = subtract(end, start);
  if (initial.distance <= expandedRadius + EPSILON) {
    const normal = normalize(subtract(start, initial.closest), normalize(scale(movement, -1)));
    return contactHit(0, start, add(initial.closest, scale(normal, baseRadius)), normal, obstacle, primitive);
  }

  const hits = [
    sweepPointAgainstCircle(start, end, axisStart, expandedRadius, obstacle, primitive, baseRadius),
    sweepPointAgainstCircle(start, end, axisEnd, expandedRadius, obstacle, primitive, baseRadius),
  ];
  const axis = subtract(axisEnd, axisStart);
  const axisLength = Math.hypot(axis.x, axis.y);
  if (axisLength > EPSILON) {
    const unit = scale(axis, 1 / axisLength);
    const perpendicular = { x: -unit.y, y: unit.x };
    const startOffset = subtract(start, axisStart);
    const signedDistance = dot(startOffset, perpendicular);
    const signedVelocity = dot(movement, perpendicular);
    if (Math.abs(signedVelocity) > EPSILON) {
      for (const side of [-1, 1]) {
        const time = (side * expandedRadius - signedDistance) / signedVelocity;
        if (time < -EPSILON || time > 1 + EPSILON) continue;
        const position = add(start, scale(movement, clamp(time, 0, 1)));
        const projection = dot(subtract(position, axisStart), unit);
        if (projection < -EPSILON || projection > axisLength + EPSILON) continue;
        const axisPoint = add(axisStart, scale(unit, clamp(projection, 0, axisLength)));
        const normal = scale(perpendicular, side);
        hits.push(contactHit(time, position, add(axisPoint, scale(normal, baseRadius)), normal, obstacle, primitive));
      }
    }
  }
  return earliestHit(hits, end, obstacle);
}

function sweepAgainstPrimitive(start, end, radius, obstacle, rootObstacle = obstacle) {
  const shape = shapeOf(obstacle);
  if (shape === "circle") {
    const obstacleRadius = circleRadius(obstacle);
    return sweepPointAgainstCircle(
      start,
      end,
      circleCenter(obstacle),
      radius + obstacleRadius,
      rootObstacle,
      obstacle,
      obstacleRadius,
    );
  }
  if (shape === "capsule") {
    const capsule = capsuleGeometry(obstacle);
    return sweepPointAgainstCapsule(
      start,
      end,
      capsule.start,
      capsule.end,
      radius + capsule.radius,
      rootObstacle,
      obstacle,
      capsule.radius,
    );
  }
  if (shape === "polygon") {
    const points = polygonPoints(obstacle);
    if (points.length < 3) return noHit(end, rootObstacle);
    if (circleIntersectsPrimitive(start, radius, obstacle)) {
      const normal = polygonContactNormal(start, points);
      const nearest = nearestPolygonEdge(start, points);
      return contactHit(0, start, nearest?.closest || start, normal, rootObstacle, obstacle);
    }
    const hits = [];
    for (let index = 0; index < points.length; index += 1) {
      hits.push(sweepPointAgainstCapsule(
        start,
        end,
        points[index],
        points[(index + 1) % points.length],
        radius,
        rootObstacle,
        obstacle,
        0,
      ));
    }
    return earliestHit(hits, end, rootObstacle);
  }
  if (shape === "compound") {
    return earliestHit(
      compoundPrimitives(obstacle).map((primitive) => sweepAgainstPrimitive(start, end, radius, primitive, rootObstacle)),
      end,
      rootObstacle,
    );
  }
  return noHit(end, rootObstacle);
}

export function sweepCircleAgainstObstacle({ previousPosition, nextPosition, radius, obstacle } = {}) {
  const start = pointValue(previousPosition);
  const end = pointValue(nextPosition || previousPosition);
  if (!obstacle) return noHit(end);
  return sweepAgainstPrimitive(start, end, Math.max(0, finiteNumber(radius)), obstacle);
}

export function segmentIntersectsObstacle(start, end, obstacle, clearance = 0) {
  if (!start || !end || !obstacle) return false;
  return sweepCircleAgainstObstacle({
    previousPosition: start,
    nextPosition: end,
    radius: clearance,
    obstacle,
  }).hit;
}

export function firstObstacleHit(start, end, obstacles, clearance = 0) {
  if (!Array.isArray(obstacles) || obstacles.length === 0) return null;
  let first = null;
  for (const obstacle of obstacles) {
    const hit = sweepCircleAgainstObstacle({
      previousPosition: start,
      nextPosition: end,
      radius: clearance,
      obstacle,
    });
    if (hit.hit && (!first || hit.time < first.time - EPSILON)) first = hit;
  }
  return first;
}

export function positionClearOfObstacles(position, radius, obstacles) {
  if (!Array.isArray(obstacles) || obstacles.length === 0) return true;
  return !obstacles.some((obstacle) => circleIntersectsObstacle(position, radius, obstacle));
}

export function resolveMovementAgainstObstacles({
  previousPosition,
  nextPosition,
  radius,
  obstacles,
  maxSlides = 2,
} = {}) {
  let position = pointValue(previousPosition);
  const target = pointValue(nextPosition || previousPosition);
  let remaining = subtract(target, position);
  const hits = [];
  const slideLimit = Math.max(0, Math.floor(finiteNumber(maxSlides, 2)));

  for (let slideIndex = 0; slideIndex <= slideLimit; slideIndex += 1) {
    if (lengthSquared(remaining) <= EPSILON) break;
    const hit = firstObstacleHit(position, add(position, remaining), obstacles, radius);
    if (!hit) {
      position = add(position, remaining);
      remaining = { x: 0, y: 0 };
      break;
    }

    hits.push(hit);
    const safeTime = Math.max(0, hit.time - SWEEP_BACKOFF);
    position = add(position, scale(remaining, safeTime));
    const afterContact = scale(remaining, Math.max(0, 1 - hit.time));
    const intoSurface = dot(afterContact, hit.normal);
    remaining = intoSurface < 0
      ? subtract(afterContact, scale(hit.normal, intoSurface))
      : afterContact;
    if (slideIndex >= slideLimit) break;
  }

  return {
    position,
    collided: hits.length > 0,
    hits,
  };
}
