const impactStates = new WeakMap();
const states = new WeakMap();

import {
  clamp,
  linePointDistance,
  normalizeAngle,
  quadraticPoint,
  shortestAngleDelta,
} from "../../foundation/math.js";
import { createExpandingWave, expandingWaveCoversEntity } from "../../systems/expanding-wave.js";

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
  const state = states.get(ship);
  if (!state || state.phase === "returning") {
    return false;
  }
  state.phase = "returning";
  state.returnStartedAt = ship.team.match.elapsed;
  state.angularVelocity *= 0.72;
  ship.navigateTo({ x: ship.team.match.worldSize * 0.5, y: ship.team.match.worldSize * 0.5 });
  return true;
}

function finishReturn(ship) {
  const match = ship.team.match;
  const center = match.worldSize * 0.5;
  ship.displaceTo(center, center);
  ship.navigateTo({ x: center, y: center });
  ship.setFlightSpeed(Math.min(ship.speed, ship.effectiveSpeed() * 0.9));
  states.set(ship, null);
  match.spawnBurst(center, center, "#ff526f", 16);
  match.spawnFloatingTextKey(center + 12, center - 16, "归航", {}, "#ff9bad");
}

export function initializeKoizumiOrb(ship) {
  if (states.has(ship)) return;
  states.set(ship, null);
  Object.defineProperty(ship, "koizumiOrb", { enumerable: true, get: () => {
    const state = states.get(ship);
    if (!state) return null;
    const { hitAt, ...view } = state;
    return Object.freeze(view);
  } });
}

export function isKoizumiOrbActive(ship) {
  return Boolean(ship?.alive && states.get(ship));
}

export function isKoizumiOrbReturning(ship) {
  return Boolean(isKoizumiOrbActive(ship) && states.get(ship).phase === "returning");
}

export function beginKoizumiOrbReturn(ship) {
  return transitionToReturn(ship);
}

export function dispelKoizumiOrb(ship) {
  if (!states.get(ship)) return false;
  // 净化直接解除形态，不触发归航或瞬移；当前位置与已有航向继续交给普通推进。
  states.set(ship, null);
  ship.setFlightSpeed(Math.min(ship.speed, ship.effectiveSpeed()));
  return true;
}

export function activateKoizumiOrb(ship, duration = 8) {
  if (!ship?.alive || ship.characterId !== "koizumi" || states.get(ship)) {
    return false;
  }
  const now = ship.team.match.elapsed;
  const cruiseSpeed = Math.max(ORB_BASE_CRUISE_SPEED, ship.baseSpeed() * ORB_SPEED_MULTIPLIER);
  states.set(ship, {
    phase: "active",
    startedAt: now,
    activeUntil: now + Math.max(0.1, Number(duration) || 8),
    returnStartedAt: 0,
    previousX: ship.x,
    previousY: ship.y,
    angularVelocity: 0,
    cruiseSpeed,
    hitAt: new Map(),
  });
  // 从既有航速连续加速，既不会瞬移，也能在半秒内形成明确的高速感。
  ship.setFlightSpeed(Math.max(ship.speed, cruiseSpeed * 0.46));
  ship.clearControlEffects();
  ship.team.match.spawnBurst(ship.x, ship.y, "#ff405f", 14);
  ship.team.match.spawnFloatingTextKey(ship.x + 10, ship.y - 14, "超能力粒子", {}, "#ff8da1");
  return true;
}

export function updateKoizumiOrb(ship, dt) {
  const state = states.get(ship);
  if (!state || !ship.alive) {
    return false;
  }
  const match = ship.team.match;
  const now = match.elapsed;
  if (state.phase === "active" && now >= state.activeUntil) {
    transitionToReturn(ship);
  }

  sampleKoizumiOrbMotion(ship);
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
  ship.setFlightHeading(normalizeAngle(ship.angle + state.angularVelocity * dt));

  const turnLoad = clamp(Math.abs(state.angularVelocity) / Math.max(0.01, maximumTurnRate), 0, 1);
  let targetSpeed = state.cruiseSpeed * (1 - (1 - ORB_MIN_TURN_SPEED_RATIO) * turnLoad);
  if (returning && centerDistance < 230) {
    // 末段仍显著快于普通舰，但收一点速度，避免围绕中心形成不自然的无限小圆。
    targetSpeed *= clamp(0.58 + centerDistance / 520, 0.58, 1);
  }
  if (returning && returnElapsed > ORB_RETURN_HARD_ASSIST_AFTER) {
    targetSpeed = Math.min(targetSpeed, state.cruiseSpeed * 0.72);
  }
  ship.setFlightSpeed(approach(ship.speed, targetSpeed, state.cruiseSpeed * dt * (returning ? 2.15 : 1.85)));

  ship.advanceFlight(dt, Math.max(8, ship.radius + 2));

  if (!returning && ship.route) {
    const alignment = clamp((Math.cos(delta) + 0.35) / 1.35, 0.16, 1);
    // 特殊飞行也由舰船推进并重新锚定航线，不跨组件修改 route。
    ship.advanceSpecialRoute(ship.speed * dt * alignment, 130, 38);
  }

  if (returning) {
    ship.clearRoute();
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
    if (ship.isControlImmune() || ship.minimumFlightSpeed() > 0) continue;
    const destination = actualKnockbackDistance(match, ship, direction.x, direction.y, knockbackDistance);
    ship.beginForcedKnockback({
      startedAt,
      endsAt,
      fromX: ship.x,
      fromY: ship.y,
      toX: destination.x,
      toY: destination.y,
    });
  }
}

export function resolveKoizumiOrbContacts(match) {
  const pairs = [[match.teamA, match.teamB], [match.teamB, match.teamA]];
  for (const [team, enemyTeam] of pairs) {
    for (const source of team.getAllShips()) {
      const state = states.get(source);
      if (!source.alive || !state || source.isControlLocked()) continue;
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
        const wave = createExpandingWave({
          worldSize: match.worldSize, now: match.elapsed,
          source: { id: source.id, x: target.x, y: target.y }, id: ++impactStates.get(team).sequence,
        });
        wave.hitShipIds = new Set();
        impactStates.get(team).waves.push(wave);
        applyCollisionKnockback(match, source, target, direction);
        if (!target.isControlImmune()) {
          target.silenceUntil(match.elapsed + ORB_SILENCE_DURATION);
          match.spawnFloatingTextKey(target.x + 12, target.y - 18, "沉默", {}, "#ff8fb5");
        }
        match.spawnBurst(target.x, target.y, "#ff4168", 13);
      }
    }
  }
}

export function updateKoizumiImpactWaves(match) {
  for (const team of [match.teamA, match.teamB]) {
    impactStates.get(team).waves = impactStates.get(team).waves.filter((wave) => wave.expiresAt > match.elapsed);
    const enemyTeam = match.enemyTeamBySeat(team.seat);
    for (const wave of impactStates.get(team).waves) {
      for (const target of enemyTeam.getAllShips()) {
        if (!target.alive || wave.hitShipIds.has(target.id)) continue;
        if (!expandingWaveCoversEntity(wave, target, match.elapsed)) continue;
        // 一圈波对每艘敌舰只施加一次，避免宽波带每帧续期眩晕。
        wave.hitShipIds.add(target.id);
        if (target.isControlImmune()) continue;
        target.stunUntil(match.elapsed + 1);
        match.spawnFloatingTextKey(target.x + 10, target.y - 14, "眩晕", {}, "#ff9bad");
      }
    }
  }
}

export function serializeKoizumiImpactWaves(team) {
  return impactStates.get(team).waves.map(({ hitShipIds, sourceShipId, edgeRadius, maxRadius, ...wave }) => ({ ...wave, kind: "koizumi" }));
}

export function serializeKoizumiOrb(ship) {
  const state = states.get(ship);
  if (!state) return null;
  return {
    active: true,
    phase: state.phase,
    activeRemaining: Math.max(0, state.activeUntil - ship.team.match.elapsed),
    angularVelocity: state.angularVelocity,
    cruiseSpeed: state.cruiseSpeed,
  };
}

// 碰撞消费的是本次推进前采样的位姿，不能通过公共投影改写接触历史。
export function sampleKoizumiOrbMotion(ship) {
  const state = states.get(ship);
  if (!state) return;
  state.previousX = ship.x;
  state.previousY = ship.y;
}

export function initializeKoizumiImpactWaves(team) {
  if (impactStates.has(team)) return;
  impactStates.set(team, { sequence: 0, waves: [] });
  Object.defineProperty(team, "koizumiImpactWaves", { enumerable: true,
    get: () => Object.freeze(impactStates.get(team).waves.map(({ hitShipIds, ...wave }) => Object.freeze(wave))),
  });
}
