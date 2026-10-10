export default {
  id: "tsuruya",
  flagship: {
    purgeableBuff: true,
    shouldCast(policy, { K, context }) {
      return policy.obs.self.hullRatio < K.tsuruyaHull || (context?.skillAggression || 0) > K.tsuruyaAggression || (context?.combatUrgency || 0) > K.tsuruyaUrgency;
    },
  },
  sub: {
    shouldCast(policy, { K, estimate, context }) {
      return Boolean(
        estimate
        && (estimate.visible || estimate.age <= K.tsuruyaAge)
        && (((context?.skillAggression) || 0) > K.tsuruyaAggression || (context?.trackableIntel)),
      );
    },
    target(policy, { estimate }) {
      return { zoneId: estimate?.zoneId || policy.enemyIntel.searchZoneId || 5 };
    },
  },
};
