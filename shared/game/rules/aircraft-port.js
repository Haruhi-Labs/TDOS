import { Scout } from "../model/scout.js";
import { Wingman } from "../model/wingman.js";
import { rngFor } from "../rng.js";

export function createAircraftPort(team) {
  const source = (ship) => ship && Object.freeze({
    key: ship.key, x: ship.x, y: ship.y, angle: ship.angle, radius: ship.radius,
    alive: ship.alive, controlLocked: ship.isControlLocked(),
    launchAvailable: team.match.rules.scoutLaunchAvailable(ship),
  });
  return Object.freeze({
    sameMatch: (entity) => entity.team?.match === team.match,
    owns: (entity) => entity.team === team,
    source: (key) => source(team.ships[key]), sources: () => team.getAllShips().map(source),
    orderAvailable: (key) => team.match.rules.scoutOrderAvailable(team.shipByKey(key)),
    disabled: () => team.areScoutsDisabled(), launchCount: () => team.match.rules.scoutLaunchCount(team),
    get cooldowns() { return team.cooldowns; },
    startCooldown: (key, duration) => team.startCooldown(key, duration),
    spendEnergy: (key, cost) => team.spendEnergyForShip(key, cost),
    createScout: (x, y, options) => new Scout(team, x, y, options),
    createWingman: (x, y, zone) => new Wingman(team, x, y, zone),
    record: (action) => team.match.recordAction(team.seat, action),
    randomRange: (min, max) => rngFor(team.match).range(min, max),
    zoneForPoint: (x, y) => team.zoneForPoint(x, y),
    world: Object.freeze({
      zoneById: (id) => team.match.zoneById(id),
      clampX: (x, padding) => team.match.clampX(x, padding),
      clampY: (y, padding) => team.match.clampY(y, padding),
      spawnBurst: (...args) => team.match.spawnBurst(...args),
    }),
  });
}
