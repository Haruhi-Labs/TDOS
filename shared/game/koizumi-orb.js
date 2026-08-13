import {
  clamp,
  linePointDistance,
  normalizeAngle,
  quadraticPoint,
  shortestAngleDelta,
} from "./math.js";
import { haruhiHeroPowerSpeedFactor } from "./haruhi-hero-power.js";

const ORB_BASE_CRUISE_SPEED = 164;
const ORB_SPEED_MULTIPLIER = 4.45;
const ORB_MIN_TURN_SPEED_RATIO = 0.78;
const ORB_TURN_AGILITY_MULTIPLIER = 1.5;
const ORB_ACTIVE_MAX_TURN_RATE = 1.72 * ORB_TURN_AGILITY_MULTIPLIER;
const ORB_RETURN_MAX_TURN_RATE = 2.55 * ORB_TURN_AGILITY_MULTIPLIER;
const ORB_ANGULAR_ACCELERATION = 5.4;
const ORB_BOUNDARY_LOOKAHEAD = 1.05;
const ORB_BOUNDARY_MARGIN = 150;
const ORB_RETURN_CAPTURE_RADIUS = 25;
const ORB_RETURN_HARD_ASSIST_AFTER = 5.5;
const ORB_HIT_REARM_SECONDS = 0.62;
const ORB_KNOCKBACK_DURATION = 0.58;
const ORB_SILENCE_DURATION = 5;

function approach(value, target, maximumDelta) {
  if (value < target) return Math.min(target, value + maximumDelta);
  if (value > target) return Math.max(target, value - maximumDelta);
  return target;
}

function activeRouteTarget(ship) {
  const route = ship.route;
  if (!route?.p0 || !route?.p1 || !route?.p2) {
    return null;
  }
  const lookAhead = clamp((Number(route.t) || 0) + 0.2, 0, 1);
  const point = quadraticPoint(route.p0, route.p1, route.p2, lookAhead);
  if (Math.hypot(point.x - ship.x, point.y - ship.y) > 34) {
    return point;
  }
  return route.p2;
}

function boundarySteeringVector(ship, headingX, headingY) {
  const match = ship.team.match;
  const padding = Math.max(20, ship.radius + 8);
  const projectedX = ship.x + headingX * ship.speed * ORB_BOUNDARY_LOOKAHEAD;
  const projectedY = ship.y + headingY * ship.speed * ORB_BOUNDARY_LOOKAHEAD;
  let inwardX = 0;
  let inwardY = 0;

  if (projectedX < padding + ORB_BOUNDARY_MARGIN) {
    inwardX += clamp((padding + ORB_BOUNDARY_MARGIN - projectedX) / ORB_BOUNDARY_MARGIN, 0, 1);
  } else if (projectedX > match.worldSize - padding - ORB_BOUNDARY_MARGIN) {
    inwardX -= clamp((projectedX - (match.worldSize - padding - ORB_BOUNDARY_MARGIN)) / ORB_BOUNDARY_MARGIN, 0, 1);
  }
  if (projectedY < padding + ORB_BOUNDARY_MARGIN) {
    inwardY += clamp((padding + ORB_BOUNDARY_MARGIN - projectedY) / ORB_BOUNDARY_MARGIN, 0, 1);
  } else if (projectedY > match.worldSize - padding - ORB_BOUNDARY_MARGIN) {
    inwardY -= clamp((projectedY - (match.worldSize - padding - ORB_BOUNDARY_MARGIN)) / ORB_BOUNDARY_MARGIN, 0, 1);
  }
  return { x: inwardX, y: inwardY };
}

function transitionToReturn(ship) {
  const state = ship.koizumiOrb;
  if (!state || state.phase === "returning") {
    return false;
  }
  state.phase = "returning";
  state.returnStartedAt = ship.team.match.elapsed;
  state.angularVelocity *= 0.72;
  ship.route = null;
  ship.command = {
    x: ship.team.match.worldSize * 0.5,
    y: ship.team.match.worldSize * 0.5,
  };
  return true;
}

function finishReturn(ship) {
  const match = ship.team.match;
  const center = match.worldSize * 0.5;
  ship.x = center;
  ship.y = center;
  ship.command = { x: center, y: center };
  ship.route = null;
  ship.speed = Math.min(ship.speed, ship.effectiveSpeed() * 0.9);
  ship.koizumiOrb = null;
  match.spawnBurst(center, center, "#ff526f", 16);
  match.spawnFloatingTextKey(center + 12, center - 16, "归航", {}, "#ff9bad");
}

export function isKoizumiOrbActive(ship) {
  return Boolean(ship?.alive && ship.koizumiOrb);
}

export function isKoizumiOrbReturning(ship) {
  return Boolean(isKoizumiOrbActive(ship) && ship.koizumiOrb.phase === "returning");
}

export function beginKoizumiOrbReturn(ship) {
  return transitionToReturn(ship);
}

export function activateKoizumiOrb(ship, duration = 8) {
  if (!ship?.alive || ship.characterId !== "koizumi" || ship.koizumiOrb) {
    return false;
  }
  const now = ship.team.match.elapsed;
  const cruiseSpeed = Math.max(ORB_BASE_CRUISE_SPEED, ship.baseSpeed() * ORB_SPEED_MULTIPLIER);
  ship.koizumiOrb = {
    phase: "active",
    startedAt: now,
    activeUntil: now + Math.max(0.1, Number(duration) || 8),
    returnStartedAt: 0,
    previousX: ship.x,
    previousY: ship.y,
    angularVelocity: 0,
    cruiseSpeed,
    hitAt: new Map(),
  };
  // 从既有航速连续加速，既不会瞬移，也能在半秒内形成明确的高速感。
  ship.speed = Math.max(ship.speed, cruiseSpeed * 0.46);
  ship.effects.brakeUntil = 0;
  ship.collisionSlowUntil = 0;
  ship.team.match.spawnBurst(ship.x, ship.y, "#ff405f", 14);
  ship.team.match.spawnFloatingTextKey(ship.x + 10, ship.y - 14, "超能力", {}, "#ff8da1");
  return true;
}

export function updateKoizumiOrb(ship, dt) {
  const state = ship?.koizumiOrb;
  if (!state || !ship.alive) {
    return false;
  }
  const match = ship.team.match;
  const now = match.elapsed;
  if (state.phase === "active" && now >= state.activeUntil) {
    transitionToReturn(ship);
  }

  state.previousX = ship.x;
  state.previousY = ship.y;
  const returning = state.phase === "returning";
  const center = match.worldSize * 0.5;
  const target = returning
    ? { x: center, y: center }
    : activeRouteTarget(ship);

  let desiredX;
  let desiredY;
  if (target) {
    desiredX = target.x - ship.x;
    desiredY = target.y - ship.y;
  } else {
    desiredX = Math.cos(ship.angle) * 420;
    desiredY = Math.sin(ship.angle) * 420;
  }
  const desiredLength = Math.max(1e-6, Math.hypot(desiredX, desiredY));
  desiredX /= desiredLength;
  desiredY /= desiredLength;

  const headingX = Math.cos(ship.angle);
  const headingY = Math.sin(ship.angle);
  const boundary = boundarySteeringVector(ship, headingX, headingY);
  // 提前转向而非撞到边界再反弹；较大的前向权重保留高速物体的惯性。
  desiredX += boundary.x * 1.55;
  desiredY += boundary.y * 1.55;
  const adjustedLength = Math.max(1e-6, Math.hypot(desiredX, desiredY));
  const desiredAngle = Math.atan2(desiredY / adjustedLength, desiredX / adjustedLength);
  const delta = shortestAngleDelta(ship.angle, desiredAngle);

  const returnElapsed = returning ? Math.max(0, now - state.returnStartedAt) : 0;
  const centerDistance = returning ? Math.hypot(center - ship.x, center - ship.y) : Infinity;
  const closeReturnAssist = returning ? clamp((260 - centerDistance) / 220, 0, 1) : 0;
  const lateReturnAssist = returning ? clamp((returnElapsed - 2.6) / 2.9, 0, 1) : 0;
  const maximumTurnRate = returning
    ? ORB_RETURN_MAX_TURN_RATE + closeReturnAssist * 1.25 + lateReturnAssist * 0.85
    : ORB_ACTIVE_MAX_TURN_RATE;
  const requestedAngularVelocity = clamp(
    delta * (returning ? 3.15 : 2.35) * ORB_TURN_AGILITY_MULTIPLIER,
    -maximumTurnRate,
    maximumTurnRate,
  );
  state.angularVelocity = approach(
    state.angularVelocity,
    requestedAngularVelocity,
    ORB_ANGULAR_ACCELERATION * (returning ? 1.18 : 1) * dt,
  );
  ship.angle = normalizeAngle(ship.angle + state.angularVelocity * dt);

  const turnLoad = clamp(Math.abs(state.angularVelocity) / Math.max(0.01, maximumTurnRate), 0, 1);
  let targetSpeed = state.cruiseSpeed * (1 - (1 - ORB_MIN_TURN_SPEED_RATIO) * turnLoad);
  targetSpeed *= haruhiHeroPowerSpeedFactor(ship, now);
  if (returning && centerDistance < 230) {
    // 末段仍显著快于普通舰，但收一点速度，避免围绕中心形成不自然的无限小圆。
    targetSpeed *= clamp(0.58 + centerDistance / 520, 0.58, 1);
  }
  if (returning && returnElapsed > ORB_RETURN_HARD_ASSIST_AFTER) {
    targetSpeed = Math.min(targetSpeed, state.cruiseSpeed * 0.72);
  }
  ship.speed = approach(ship.speed, targetSpeed, state.cruiseSpeed * dt * (returning ? 2.15 : 1.85));

  ship.x += Math.cos(ship.angle) * ship.speed * dt;
  ship.y += Math.sin(ship.angle) * ship.speed * dt;
  const padding = Math.max(8, ship.radius + 2);
  ship.x = match.clampX(ship.x, padding);
  ship.y = match.clampY(ship.y, padding);

  if (!returning && ship.route) {
    const alignment = clamp((Math.cos(delta) + 0.35) / 1.35, 0.16, 1);
    ship.route.t = clamp(
      (Number(ship.route.t) || 0) + (ship.speed * dt * alignment) / Math.max(130, Number(ship.route.length) || 1),
      0,
      1,
    );
    if (ship.route.t >= 1 && Math.hypot(ship.route.p2.x - ship.x, ship.route.p2.y - ship.y) <= 38) {
      ship.route = null;
    } else {
      // 光球运动走独立更新分支，不会经过 Ship.update 中的常规航线约束刷新。
      // 在移动完成后重新锚定航线，保证航线起点与高速移动的古泉始终贴合。
      ship.enforceRouteFeasibility(ship.route.p1, false);
    }
  }

  if (returning) {
    ship.route = null;
    const centerProbe = linePointDistance(state.previousX, state.previousY, ship.x, ship.y, center, center);
    if (centerProbe.dist <= ORB_RETURN_CAPTURE_RADIUS || centerDistance <= ORB_RETURN_CAPTURE_RADIUS) {
      finishReturn(ship);
    }
  }
  return true;
}

function actualKnockbackDistance(match, ship, directionX, directionY, knockbackDistance) {
  const padding = Math.max(8, ship.radius + 2);
  const targetX = match.clampX(ship.x + directionX * knockbackDistance, padding);
  const targetY = match.clampY(ship.y + directionY * knockbackDistance, padding);
  return {
    x: targetX,
    y: targetY,
    distance: Math.hypot(targetX - ship.x, targetY - ship.y),
  };
}

function sweptCollisionDirection(source, target, startX, startY, probe, collisionRadius) {
  const sweepX = source.x - startX;
  const sweepY = source.y - startY;
  const relativeX = startX - target.x;
  const relativeY = startY - target.y;
  const a = sweepX * sweepX + sweepY * sweepY;
  const b = 2 * (relativeX * sweepX + relativeY * sweepY);
  const c = relativeX * relativeX + relativeY * relativeY - collisionRadius * collisionRadius;
  let contactT = probe.t;
  if (c <= 0) {
    contactT = 0;
  } else if (a > 1e-8) {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const firstContact = (-b - Math.sqrt(discriminant)) / (2 * a);
      if (firstContact >= 0 && firstContact <= 1) {
        contactT = firstContact;
      }
    }
  }

  const contactX = startX + sweepX * contactT;
  const contactY = startY + sweepY * contactT;
  let directionX = target.x - contactX;
  let directionY = target.y - contactY;
  let length = Math.hypot(directionX, directionY);
  if (length < 1e-6) {
    directionX = sweepX;
    directionY = sweepY;
    length = Math.hypot(directionX, directionY);
  }
  if (length < 1e-6) {
    directionX = Math.cos(source.angle);
    directionY = Math.sin(source.angle);
    length = 1;
  }
  return { x: directionX / length, y: directionY / length };
}

function applyCollisionKnockback(match, source, contactTarget, direction) {
  const knockbackDistance = Math.max(1, source.effectiveVision());
  const startedAt = match.elapsed;
  const endsAt = startedAt + ORB_KNOCKBACK_DURATION;
  const fleet = contactTarget.team.fleetMembersForShip(contactTarget);

  for (const ship of fleet) {
    const destination = actualKnockbackDistance(match, ship, direction.x, direction.y, knockbackDistance);
    ship.forcedKnockback = {
      startedAt,
      endsAt,
      fromX: ship.x,
      fromY: ship.y,
      toX: destination.x,
      toY: destination.y,
    };
    ship.speed = 0;
    ship.route = null;
  }
}

export function resolveKoizumiOrbContacts(match) {
  const pairs = [[match.teamA, match.teamB], [match.teamB, match.teamA]];
  for (const [team, enemyTeam] of pairs) {
    for (const source of team.getAllShips()) {
      const state = source.koizumiOrb;
      if (!source.alive || !state) continue;
      for (const target of enemyTeam.getAllShips()) {
        if (!target.alive) continue;
        const startX = Number.isFinite(state.previousX) ? state.previousX : source.x;
        const startY = Number.isFinite(state.previousY) ? state.previousY : source.y;
        const collisionRadius = source.radius + target.radius + 5;
        const probe = linePointDistance(
          startX,
          startY,
          source.x,
          source.y,
          target.x,
          target.y,
        );
        if (probe.dist > collisionRadius) continue;
        const lastHitAt = state.hitAt.get(target.id);
        if (lastHitAt !== undefined && match.elapsed - lastHitAt < ORB_HIT_REARM_SECONDS) continue;
        state.hitAt.set(target.id, match.elapsed);
        const direction = sweptCollisionDirection(source, target, startX, startY, probe, collisionRadius);
        applyCollisionKnockback(match, source, target, direction);
        target.effects.silencedUntil = Math.max(
          Number(target.effects.silencedUntil) || 0,
          match.elapsed + ORB_SILENCE_DURATION,
        );
        match.spawnFloatingTextKey(target.x + 12, target.y - 18, "沉默", {}, "#ff8fb5");
        match.spawnBurst(target.x, target.y, "#ff4168", 13);
      }
    }
  }
}

export function serializeKoizumiOrb(ship) {
  const state = ship?.koizumiOrb;
  if (!state) return null;
  return {
    active: true,
    phase: state.phase,
    activeRemaining: Math.max(0, state.activeUntil - ship.team.match.elapsed),
    angularVelocity: state.angularVelocity,
    cruiseSpeed: state.cruiseSpeed,
  };
}
