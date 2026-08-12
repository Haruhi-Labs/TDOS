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
const BLADE_QUEEN_HIT_FRACTION = 0.15;
const HARUHI_BOW_CONTACT_TOLERANCE = 5;
const HARUHI_BOW_ARC_COS = Math.cos(Math.PI / 4);
const HARUHI_RAM_MINIMUM_GEAR = 2;
const HARUHI_RAM_SPEED_TOLERANCE = 0.5;
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

function applyForcedKnockback(match, source, contactTarget) {
  const targetTeam = contactTarget.team;
  const fleetKey = targetTeam.fleetKeyForShip(contactTarget);
  const fleet = targetTeam.fleetMembersByKey(fleetKey);
  const deltaX = contactTarget.x - source.x;
  const deltaY = contactTarget.y - source.y;
  const length = Math.hypot(deltaX, deltaY);
  const directionX = length > 1e-6 ? deltaX / length : Math.cos(source.angle);
  const directionY = length > 1e-6 ? deltaY / length : Math.sin(source.angle);
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

function haruhiBowTouchesTarget(source, target) {
  if (!haruhiRamApproachEligible(source, target.x, target.y)) {
    return false;
  }
  const forwardX = Math.cos(source.angle);
  const forwardY = Math.sin(source.angle);
  const bowX = source.x + forwardX * source.radius;
  const bowY = source.y + forwardY * source.radius;
  return distance(bowX, bowY, target.x, target.y) <= target.radius + HARUHI_BOW_CONTACT_TOLERANCE;
}

export function resolveHaruhiOtherworlderContacts(match) {
  const pairs = [[match.teamA, match.teamB], [match.teamB, match.teamA]];
  for (const [team, enemyTeam] of pairs) {
    const source = team.ships.main;
    if (!source?.alive || !haruhiOtherworlderReady(team)) continue;
    const target = enemyTeam.getAllShips().find(
      (enemy) => enemy.alive
        && !enemy.forcedKnockback
        && haruhiBowTouchesTarget(source, enemy),
    );
    if (!target || !triggerHaruhiOtherworlder(team)) continue;
    applyForcedKnockback(match, source, target);
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

export function resolveBladeQueenContacts(match) {
  const pairs = [[match.teamA, match.teamB], [match.teamB, match.teamA]];
  for (const [team, enemyTeam] of pairs) {
    for (const ship of team.getAllShips()) {
      if (!ship.alive || !ship.hasEffect("bladeQueenUntil")) continue;
      const hitLog = ship._bladeHitAt || (ship._bladeHitAt = new Map());
      for (const target of enemyTeam.getAllShips()) {
        if (!target.alive) continue;
        if (distance(ship.x, ship.y, target.x, target.y) > ship.radius + target.radius + 4) continue;
        const lastHitAt = hitLog.get(target.id);
        if (lastHitAt !== undefined && match.elapsed - lastHitAt < BLADE_QUEEN_HIT_INTERVAL) continue;
        hitLog.set(target.id, match.elapsed);
        target.takeDamage(
          target.maxHp * BLADE_QUEEN_HIT_FRACTION,
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
