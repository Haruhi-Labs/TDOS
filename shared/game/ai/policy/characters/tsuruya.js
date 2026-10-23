export default {
  id: "tsuruya",
  flagship: {
    purgeableBuff: true,
    shouldCast(facts, { K, context }) {
      return facts.obs.self.hullRatio < K.tsuruyaHull || (context?.skillAggression || 0) > K.tsuruyaAggression || (context?.combatUrgency || 0) > K.tsuruyaUrgency;
    },
  },
  sub: {
    shouldCast(facts, { K, estimate, context }) {
      return Boolean(
        estimate
        && (estimate.visible || estimate.age <= K.tsuruyaAge)
        && (((context?.skillAggression) || 0) > K.tsuruyaAggression || (context?.trackableIntel)),
      );
    },
    target(facts, { estimate }) {
      return { zoneId: estimate?.zoneId || facts.searchZoneId || 5 };
    },
  },
};
