// 编队只取得身份、几何、资源及有限命令；真实实体映射留在装配层。
export function createFormationPort(team) {
  const handles = new WeakMap();
  function handle(ship) {
    if (!ship) return null;
    if (!handles.has(ship)) handles.set(ship, Object.freeze({
      get key() { return ship.key; },
      get alive() { return ship.alive; },
      get x() { return ship.x; }, get y() { return ship.y; },
      get angle() { return ship.angle; }, get radius() { return ship.radius; },
      get energy() { return ship.energy; }, get maxEnergy() { return ship.maxEnergy; },
      get participates() { return team.match.rules.isFleetParticipant(ship); },
      baseSpeed: () => ship.baseSpeed(),
      spendEnergy: (amount) => ship.spendEnergy(amount),
      isControlLocked: () => ship.isControlLocked(),
      setBezierRoute: (...args) => ship.setBezierRoute(...args),
    }));
    return handles.get(ship);
  }
  return Object.freeze({
    primary: Object.freeze({
      get main() { return handle(team.ships.main); },
      get sub1() { return handle(team.ships.sub1); },
      get sub2() { return handle(team.ships.sub2); },
    }),
    get extras() { return team.extraShips.map(handle); },
    lookup: (key) => handle(team.shipByKey(key)),
    participates: (unit) => unit?.participates ?? true,
    accelerationMultiplier: () => team.match.rules.accelerationMultiplier(team),
    get mapPadding() { return team.match.mapPadding; },
    clampX: (x, padding) => team.match.clampX(x, padding),
    clampY: (y, padding) => team.match.clampY(y, padding),
    recordSplit: () => team.match.recordAction(team.seat, "split"),
  });
}
