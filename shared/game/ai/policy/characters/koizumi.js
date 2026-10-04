export default {
  id: "koizumi",
  splitsEarlyAgainstBarrier: true,
  sub: {
    purgeableBuff: true,
    shouldCast(policy, { K, ship, estimate, context, dist, assignedToBreach, breachDistance }) {
      if (assignedToBreach) {
        return Boolean(
          estimate
          && !ship.koizumiOrbActive
          && estimate.source !== "spawn"
          && (estimate.visible || estimate.age <= K.koizumiBreachAge)
          && breachDistance <= ship.stats.range * K.koizumiBreachRange,
        );
      }
      return Boolean(
        estimate
        && !ship.koizumiOrbActive
        && estimate.source !== "spawn"
        && (estimate.visible || estimate.age <= K.koizumiAge || context?.trackableIntel)
        && dist <= ship.stats.range * K.koizumiRange
        && (((context?.skillAggression) || 0) > K.koizumiAggression || policy.energyProfile(ship).high),
      );
    },
  },
};
