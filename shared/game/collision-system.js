import { distance, randomInRange } from "./math.js";
import { throttleForGear } from "./throttle.js";
import { isKoizumiOrbActive } from "./koizumi-orb.js";
import {
  HARUHI_OTHERWORLDER_DAMAGE_RATIO,
  HARUHI_OTHERWORLDER_KNOCKBACK_DURATION,
  haruhiOtherworlderReady,
  triggerHaruhiOtherworlder,
} from "./haruhi-flagship.js";
import { DAMAGE_KIND } from "./damage.js";

const TAU = Math.PI * 2;
const BLADE_QUEEN_HIT_INTERVAL = 1;
export const BLADE_QUEEN_DAMAGE_RATIO_BY_GEAR = Object.freeze({
  2: 0.05,
  3: 0.13,
  4: 0.2,
});
export const BLADE_QUEEN_RANGE_MULTIPLIER = 1.25;
const HARUHI_BOW_CONTACT_TOLERANCE = 5;
const HARUHI_BOW_ARC_COS = Math.cos(Math.PI / 4);
const HARUHI_RAM_MINIMUM_GEAR = 2;
const HARUHI_RAM_SPEED_TOLERANCE = 0.5;
export const HARUHI_OTHERWORLDER_AURA_FORWARD_RADIUS_MULTIPLIER = 5;
export const HARUHI_OTHERWORLDER_AURA_REAR_RADIUS_MULTIPLIER = 1.45;
export const HARUHI_OTHERWORLDER_AURA_HALF_WIDTH_RADIUS_MULTIPLIER = 2.25;
const HARUHI_OTHERWORLDER_AURA_MIN_FORWARD_RADIUS_MULTIPLIER = 0.5;
export const COLLISION_SLOW_DURATION = 3;
export const COLLISION_SLOW_FLOOR = 0.5;
const COLLISION_RELEASE_MARGIN = 30;

export function resolveShipCollisions(match) {
  const ships = [...match.teamA.getAllShips(), ...match.teamB.getAllShips()].filter((ship) => ship.alive);
  const previousContacts = match._contactPairs || new Set();
  const contacts = new Set();
  for (let leftIndex = 0; leftIndex < ships.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < ships.length; rightIndex += 1) {
      const left = ships[leftIndex];
      const right = ships[rightIndex];
      if (left.forcedKnockback || right.forcedKnockback) continue;
      if (isKoizumiOrbActive(left) || isKoizumiOrbActive(right)) continue;
      if (left.team === right.team && (left.isAttached() || right.isAttached())) continue;
      if (left.hasEffect("bladeQueenUntil") || right.hasEffect("bladeQueenUntil")) continue;

      const deltaX = right.x - left.x;
      const deltaY = right.y - left.y;
      const currentDistance = Math.hypot(deltaX, deltaY);
      const minimumDistance = left.radius + right.radius;
      const pairKey = left.id < right.id ? `${left.id}:${right.id}` : `${right.id}:${left.id}`;
      if (currentDistance > 0 && currentDistance < minimumDistance) {
        const normalX = deltaX / currentDistance;
        const normalY = deltaY / currentDistance;
        const push = (minimumDistance - currentDistance) * 0.5;
        left.x = match.clampX(left.x - normalX * push, 8);
        left.y = match.clampY(left.y - normalY * push, 8);
        right.x = match.clampX(right.x + normalX * push, 8);
        right.y = match.clampY(right.y + normalY * push, 8);
        if (!previousContacts.has(pairKey)) {
          const until = match.elapsed + COLLISION_SLOW_DURATION;
          left.collisionSlowUntil = Math.max(left.collisionSlowUntil, until);
          right.collisionSlowUntil = Math.max(right.collisionSlowUntil, until);
          left.speed = Math.min(left.speed, left.effectiveSpeed() * COLLISION_SLOW_FLOOR);
          right.speed = Math.min(right.speed, right.effectiveSpeed() * COLLISION_SLOW_FLOOR);
        }
        contacts.add(pairKey);
      } else if (previousContacts.has(pairKey) && currentDistance < minimumDistance + COLLISION_RELEASE_MARGIN) {
        contacts.add(pairKey);
      }
    }
  }
  match._contactPairs = contacts;
}

function applyForcedKnockback(match, source, contactTarget, contact = null) {
  const targetTeam = contactTarget.team;
  const fleetKey = targetTeam.fleetKeyForShip(contactTarget);
  const fleet = targetTeam.fleetMembersByKey(fleetKey);
  const deltaX = contactTarget.x - source.x;
  const deltaY = contactTarget.y - source.y;
  const length = Math.hypot(deltaX, deltaY);
  const directionX = Number.isFinite(contact?.directionX)
    ? contact.directionX
    : length > 1e-6 ? deltaX / length : Math.cos(source.angle);
  const directionY = Number.isFinite(contact?.directionY)
    ? contact.directionY
    : length > 1e-6 ? deltaY / length : Math.sin(source.angle);
  const knockbackDistance = Math.max(1, source.effectiveVision());
  const startedAt = match.elapsed;
  const endsAt = startedAt + HARUHI_OTHERWORLDER_KNOCKBACK_DURATION;

  for (const ship of fleet) {
    const padding = Math.max(8, ship.radius + 2);
    ship.forcedKnockback = {
      startedAt,
      endsAt,
      fromX: ship.x,
      fromY: ship.y,
      toX: match.clampX(ship.x + directionX * knockbackDistance, padding),
      toY: match.clampY(ship.y + directionY * knockbackDistance, padding),
    };
    ship.speed = 0;
    ship.route = null;
  }

  contactTarget.takeDamage(
    contactTarget.maxHp * HARUHI_OTHERWORLDER_DAMAGE_RATIO,
    source,
    match,
    { kind: DAMAGE_KIND.COLLISION },
  );
  match.spawnFloatingTextKey(contactTarget.x + 10, contactTarget.y - 16, "异世界冲击", {}, "#ffcf8e");
  match.spawnBurst(contactTarget.x, contactTarget.y, "#ffcf8e", 14);
}

export function haruhiRamApproachEligible(source, targetX, targetY) {
  const minimumRamSpeed = source.effectiveSpeed() * throttleForGear(HARUHI_RAM_MINIMUM_GEAR);
  if (source.speed + HARUHI_RAM_SPEED_TOLERANCE < minimumRamSpeed) {
    return false;
  }
  const forwardX = Math.cos(source.angle);
  const forwardY = Math.sin(source.angle);
  const deltaX = targetX - source.x;
  const deltaY = targetY - source.y;
  const centerDistance = Math.hypot(deltaX, deltaY);
  if (centerDistance < 1e-6) {
    return false;
  }
  const facingDot = (deltaX * forwardX + deltaY * forwardY) / centerDistance;
  return facingDot >= HARUHI_BOW_ARC_COS;
}

export function haruhiOtherworlderAuraForwardReach(source) {
  return Math.max(1, Number(source?.radius) || 0) * HARUHI_OTHERWORLDER_AURA_FORWARD_RADIUS_MULTIPLIER;
}

function haruhiOtherworlderAuraHalfWidth(source, localX) {
  const radius = Math.max(1, Number(source?.radius) || 0);
  const forwardReach = haruhiOtherworlderAuraForwardReach(source);
  const rearReach = radius * HARUHI_OTHERWORLDER_AURA_REAR_RADIUS_MULTIPLIER;
  const progress = Math.max(0, Math.min(1, (localX + rearReach) / (forwardReach + rearReach)));
  const curve = Math.pow(Math.max(0, Math.sin(progress * Math.PI)), 0.72);
  return radius * HARUHI_OTHERWORLDER_AURA_HALF_WIDTH_RADIUS_MULTIPLIER * curve;
}

export function haruhiOtherworlderAuraContact(source, target) {
  if (!haruhiRamApproachEligible(source, target.x, target.y)) {
    return null;
  }
  const forwardX = Math.cos(source.angle);
  const forwardY = Math.sin(source.angle);
  const sideX = -forwardY;
  const sideY = forwardX;
  const deltaX = target.x - source.x;
  const deltaY = target.y - source.y;
  const localX = deltaX * forwardX + deltaY * forwardY;
  const localY = deltaX * sideX + deltaY * sideY;
  const radius = Math.max(1, Number(source.radius) || 0);
  const targetRadius = Math.max(0, Number(target.radius) || 0) + HARUHI_BOW_CONTACT_TOLERANCE;
  const minimumForward = radius * HARUHI_OTHERWORLDER_AURA_MIN_FORWARD_RADIUS_MULTIPLIER;
  const forwardReach = haruhiOtherworlderAuraForwardReach(source);
  if (localX < minimumForward || localX > forwardReach + targetRadius) {
    return null;
  }
  const widthSampleX = Math.min(forwardReach, Math.max(minimumForward, localX));
  if (Math.abs(localY) > haruhiOtherworlderAuraHalfWidth(source, widthSampleX) + targetRadius) {
    return null;
  }
  const contactLength = Math.hypot(deltaX, deltaY);
  const directionX = contactLength > 1e-6 ? deltaX / contactLength : forwardX;
  const directionY = contactLength > 1e-6 ? deltaY / contactLength : forwardY;
  return {
    x: source.x + directionX * Math.max(0, contactLength - targetRadius),
    y: source.y + directionY * Math.max(0, contactLength - targetRadius),
    angle: Math.atan2(directionY, directionX),
    directionX,
    directionY,
    localX,
    localY,
  };
}

export function resolveHaruhiOtherworlderContacts(match) {
  const pairs = [[match.teamA, match.teamB], [match.teamB, match.teamA]];
  for (const [team, enemyTeam] of pairs) {
    const source = team.ships.main;
    if (!source?.alive || !haruhiOtherworlderReady(team)) continue;
    let hit = null;
    for (const target of enemyTeam.getAllShips()) {
      if (!target.alive || target.forcedKnockback) continue;
      const contact = haruhiOtherworlderAuraContact(source, target);
      if (contact && (!hit || contact.localX < hit.contact.localX)) {
        hit = { target, contact };
      }
    }
    if (!hit || !triggerHaruhiOtherworlder(team)) continue;
    applyForcedKnockback(match, source, hit.target, hit.contact);
  }
}

export function resolveScoutClashes(match) {
  for (const scoutA of match.teamA.scouts) {
    if (!scoutA.alive) continue;
    for (const scoutB of match.teamB.scouts) {
      if (!scoutB.alive) continue;
      if (distance(scoutA.x, scoutA.y, scoutB.x, scoutB.y) <= scoutA.radius + scoutB.radius + 2) {
        scoutA.takeDamage(1, null, match);
        scoutB.takeDamage(1, null, match);
      }
    }
  }
}

export function bladeQueenDamageRatioForSpeed(ship) {
  const fullSpeed = Math.max(0.01, Number(ship?.effectiveSpeed?.()) || 0);
  const actualSpeed = Math.max(0, Number(ship?.speed) || 0);
  const gear2Speed = fullSpeed * throttleForGear(2);
  const gear3Speed = fullSpeed * throttleForGear(3);
  const gear4Speed = fullSpeed * throttleForGear(4);
  if (actualSpeed <= gear2Speed) {
    return BLADE_QUEEN_DAMAGE_RATIO_BY_GEAR[2];
  }
  if (actualSpeed <= gear3Speed) {
    const progress = (actualSpeed - gear2Speed) / Math.max(0.01, gear3Speed - gear2Speed);
    return BLADE_QUEEN_DAMAGE_RATIO_BY_GEAR[2]
      + (BLADE_QUEEN_DAMAGE_RATIO_BY_GEAR[3] - BLADE_QUEEN_DAMAGE_RATIO_BY_GEAR[2]) * progress;
  }
  if (actualSpeed <= gear4Speed) {
    const progress = (actualSpeed - gear3Speed) / Math.max(0.01, gear4Speed - gear3Speed);
    return BLADE_QUEEN_DAMAGE_RATIO_BY_GEAR[3]
      + (BLADE_QUEEN_DAMAGE_RATIO_BY_GEAR[4] - BLADE_QUEEN_DAMAGE_RATIO_BY_GEAR[3]) * progress;
  }
  return BLADE_QUEEN_DAMAGE_RATIO_BY_GEAR[4];
}

export function resolveBladeQueenContacts(match) {
  const pairs = [[match.teamA, match.teamB], [match.teamB, match.teamA]];
  for (const [team, enemyTeam] of pairs) {
    for (const ship of team.getAllShips()) {
      if (!ship.alive || !ship.hasEffect("bladeQueenUntil")) continue;
      const hitLog = ship._bladeHitAt || (ship._bladeHitAt = new Map());
      for (const target of enemyTeam.getAllShips()) {
        if (!target.alive) continue;
        const hitRadius = (ship.radius + 4) * BLADE_QUEEN_RANGE_MULTIPLIER + target.radius;
        if (distance(ship.x, ship.y, target.x, target.y) > hitRadius) continue;
        const lastHitAt = hitLog.get(target.id);
        if (lastHitAt !== undefined && match.elapsed - lastHitAt < BLADE_QUEEN_HIT_INTERVAL) continue;
        hitLog.set(target.id, match.elapsed);
        const damageRatio = bladeQueenDamageRatioForSpeed(ship);
        target.takeDamage(
          target.maxHp * damageRatio,
          ship,
          match,
          { kind: DAMAGE_KIND.SKILL },
        );
        for (let spark = 0; spark < 3; spark += 1) {
          const offset = randomInRange(0, target.radius + 6);
          const angle = randomInRange(0, TAU);
          match.spawnBurst(
            match.clampX(target.x + Math.cos(angle) * offset, 0),
            match.clampY(target.y + Math.sin(angle) * offset, 0),
            spark % 2 === 0 ? "#ff2d55" : "#ff8aa0",
            randomInRange(7, 12),
          );
        }
      }
    }
  }
}
