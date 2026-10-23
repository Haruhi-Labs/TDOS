import { distance } from "../foundation/math.js";

export const COLLISION_SLOW_DURATION = 3;
export const COLLISION_SLOW_FLOOR = 0.5;
const COLLISION_RELEASE_MARGIN = 30;

// 接触历史和迟滞判定归同一组件所有，不接受外部集合替换。
export class HullCollisionSystem {
  #contacts = new Set();

  resolve({ ships, elapsed }) {
    const previousContacts = this.#contacts;
    const contacts = new Set();
    for (let leftIndex = 0; leftIndex < ships.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < ships.length; rightIndex += 1) {
        const left = ships[leftIndex];
        const right = ships[rightIndex];
        if (!left.participates || !right.participates) continue;
        if (left.seat === right.seat && (left.attached || right.attached)
          && !left.collidesWithAttachedAllies && !right.collidesWithAttachedAllies) continue;

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
            const until = elapsed + COLLISION_SLOW_DURATION;
            left.applyCollisionSlow(until, COLLISION_SLOW_FLOOR);
            right.applyCollisionSlow(until, COLLISION_SLOW_FLOOR);
          }
          contacts.add(pairKey);
        } else if (previousContacts.has(pairKey) && currentDistance < minimumDistance + COLLISION_RELEASE_MARGIN) {
          contacts.add(pairKey);
        }
      }
    }
    this.#contacts = contacts;
  }
}

export function resolveScoutClashes({ leftScouts, rightScouts, collide }) {
  for (const scoutA of leftScouts) {
    if (!scoutA.alive) continue;
    for (const scoutB of rightScouts) {
      if (!scoutB.alive) continue;
      if (distance(scoutA.x, scoutA.y, scoutB.x, scoutB.y) <= scoutA.radius + scoutB.radius + 2) {
        collide(scoutA, scoutB);
      }
    }
  }
}
