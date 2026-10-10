import { distance } from "../../../math.js";

export default {
  id: "haruhi",
  flagship: {
    purgeableBuff: true,
    timerFollowsCooldown: true,
    energyFloors: (K) => ({
      emergencyFloor: K.haruhiEmergencyFloor,
      normalFloor: K.haruhiNormalFloor,
      conserveFloor: K.haruhiConserveFloor,
    }),
    // 常驻支援集齐后，16秒团队强化本身仍值得尽快使用；不再等待接敌或距离条件。
  },
  sub: {
    timerFollowsCooldown: true,
    shouldCast(policy, { K, ship, estimate, context, dist }) {
      const shockRadius = policy.obs.world.size / K.haruhiShockRadiusDivisor;
      const visibleEnemyShips = policy.obs.enemy.visible.filter((enemyShip) => (
        enemyShip.kind === "ship"
        && distance(ship.x, ship.y, enemyShip.x, enemyShip.y) <= shockRadius + enemyShip.radius
      ));
      const visibleEnemyAircraft = policy.obs.enemy.visible.filter((aircraft) => (
        aircraft.kind !== "ship"
        && distance(ship.x, ship.y, aircraft.x, aircraft.y) <= shockRadius + aircraft.radius
      ));
      const ownAircraftAtRisk = [...policy.obs.self.scouts, ...policy.obs.self.wingmen].filter((aircraft) => (
        aircraft.alive
        && distance(ship.x, ship.y, aircraft.x, aircraft.y) <= shockRadius + aircraft.radius
      )).length;
      const focusWillStayInRange = Boolean(
        estimate
        && estimate.source !== "spawn"
        && (estimate.visible || estimate.age <= K.haruhiFocusAge)
        && dist <= shockRadius * K.haruhiFocusRange,
      );
      const worthwhileAircraftPurge = visibleEnemyAircraft.length >= Math.max(2, ownAircraftAtRisk + 1);
      return Boolean(
        (focusWillStayInRange || visibleEnemyShips.length >= 2 || worthwhileAircraftPurge)
        && (((context?.skillAggression) || 0) > K.haruhiAggression || policy.energyProfile(ship).high),
      );
    },
  },
};
