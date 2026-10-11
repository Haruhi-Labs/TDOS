// 导航适配只发布运动读数和提交运动的权限，不暴露实体、舰队或对局引用。
export function createShipNavigationPort(ship) {
  const anchor = (source) => Object.freeze({
    x: source.x, y: source.y, angle: source.angle, speed: source.speed, alive: source.alive,
    get turnRate() { return source.effectiveTurnRate(); },
    get flightSpeed() { return source.effectiveSpeed(); },
  });
  return Object.freeze({
    world: Object.freeze({
      get elapsed() { return ship.team.match.elapsed; },
      get worldSize() { return ship.team.match.worldSize; },
      get mapPadding() { return ship.team.match.mapPadding; },
      clampX: (value, padding) => ship.team.match.clampX(value, padding),
      clampY: (value, padding) => ship.team.match.clampY(value, padding),
    }),
    get x() { return ship.x; },
    get y() { return ship.y; },
    get angle() { return ship.angle; },
    get speed() { return ship.speed; },
    get throttle() { return ship.throttle; },
    setThrottle: (value) => ship.setThrottle(value),
    get formationOffset() { return Object.freeze({ ...ship.formationOffset }); },
    anchor: () => anchor(ship),
    leader: () => ship.team.ships.main && anchor(ship.team.ships.main),
    formationSize: () => ship.team.fleetMembersByKey("main").length,
    routeTurnRadiusMultiplier: () => ship.team.match.rules.routeTurnRadiusMultiplier(ship.team),
    routeDeviationMultiplier: () => ship.team.match.rules.routeDeviationMultiplier(ship.team),
    energySpeedFactor: () => ship.team.match.rules.depletedEnergySpeedFactor(ship),
    accelerationMultiplier: () => ship.team.accelerationModifierForShip(ship),
    effectiveTurnRate: () => ship.effectiveTurnRate(),
    effectiveFormationTurnRate: () => ship.effectiveFormationTurnRate(),
    effectiveSpeed: () => ship.effectiveSpeed(),
    minimumFlightSpeed: () => ship.minimumFlightSpeed(),
    baseAcceleration: () => ship.baseAcceleration(),
    isControlImmune: () => ship.isControlImmune(),
    isAttached: () => ship.isAttached(),
    collisionSpeedFactor: () => ship.collisionSpeedFactor(),
    advanceSteeredFlight: (angle, speed, dt) => ship.advanceSteeredFlight(angle, speed, dt),
    advanceFormationFlight: (angle, speed, dt, settle) => ship.advanceFormationFlight(angle, speed, dt, settle),
    applyKnockbackSample: (x, y, completed) => ship.applyKnockbackSample(x, y, completed),
  });
}
