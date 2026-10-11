// 船体句柄不暴露实体、舰队或对局。几何保持实时读取，连续接触消费已提交位移。
export function createHullCollisionPort(ship, rules) {
  return {
    id: ship.id,
    seat: ship.team.seat,
    radius: ship.radius,
    get x() { return ship.x; },
    get y() { return ship.y; },
    get participates() { return rules.participatesInHullCollision(ship); },
    get attached() { return ship.isAttached(); },
    get collidesWithAttachedAllies() { return rules.collidesWithAttachedAllies(ship); },
    displaceTo: (x, y, padding) => ship.displaceTo(x, y, padding),
    applyCollisionSlow: (until, floor) => ship.applyCollisionSlow(until, floor),
  };
}
