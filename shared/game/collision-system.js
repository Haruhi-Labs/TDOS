import { distance } from "./math.js";

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
      if (!match.rules.participatesInHullCollision(left) || !match.rules.participatesInHullCollision(right)) continue;
      if (left.team === right.team && (left.isAttached() || right.isAttached())
        && !match.rules.collidesWithAttachedAllies(left) && !match.rules.collidesWithAttachedAllies(right)) continue;

      const deltaX = right.x - left.x;
      const deltaY = right.y - left.y;
      const currentDistance = Math.hypot(deltaX, deltaY);
      const minimumDistance = left.radius + right.radius;
      const pairKey = left.id < right.id ? `${left.id}:${right.id}` : `${right.id}:${left.id}`;
      if (currentDistance > 0 && currentDistance < minimumDistance) {
        const normalX = deltaX / currentDistance;
        const normalY = deltaY / currentDistance;
        const push = (minimumDistance - currentDistance) * 0.5;
        left.displaceTo(left.x - normalX * push, left.y - normalY * push, 8);
        right.displaceTo(right.x + normalX * push, right.y + normalY * push, 8);
        if (!previousContacts.has(pairKey)) {
          const until = match.elapsed + COLLISION_SLOW_DURATION;
          left.applyCollisionSlow(until, COLLISION_SLOW_FLOOR);
          right.applyCollisionSlow(until, COLLISION_SLOW_FLOOR);
        }
        contacts.add(pairKey);
      } else if (previousContacts.has(pairKey) && currentDistance < minimumDistance + COLLISION_RELEASE_MARGIN) {
        contacts.add(pairKey);
      }
    }
  }
  return contacts;
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
