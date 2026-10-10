export default {
  id: "yuki",
  splitBias: (SU) => SU.yukiBias,
  intelLeadBias: (D) => D.yukiBias,
  sub: {
    shouldCast(policy, { K, ship, estimate, context }) {
      return (((context?.scoutPriority) || 0) > K.yukiScoutPriority || policy.energyProfile(ship).high)
        && (!estimate || !estimate.visible || estimate.age > K.yukiVisibleAge || policy.obs.self.scouts.length < K.yukiMinScouts);
    },
  },
};
