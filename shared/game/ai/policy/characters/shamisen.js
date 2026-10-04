export default {
  id: "shamisen",
  splitBias: (SU) => SU.shamisenBias,
  detachedDefaultRole: "flank",
  sub: {
    purgeableBuff: true,
    shouldCast(policy, { K, ship, estimate, context, dist, blockedByBarrier }) {
      if (blockedByBarrier) {
        return false;
      }
      return Boolean(
        estimate
        && (estimate.visible || estimate.age <= K.shamisenAge)
        && dist <= ship.stats.range * K.shamisenRange
        && (((context?.skillAggression) || 0) > K.shamisenAggression || context?.killWindow || policy.energyProfile(ship).high),
      );
    },
  },
};
