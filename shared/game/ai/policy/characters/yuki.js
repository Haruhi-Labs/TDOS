export default {
  id: "yuki",
  splitBias: (SU) => SU.yukiBias,
  intelLeadBias: (D) => D.yukiBias,
  sub: {
    shouldCast(facts, { K, ship, estimate, context }) {
      return (((context?.scoutPriority) || 0) > K.yukiScoutPriority || facts.energyHigh)
        && (!estimate || !estimate.visible || estimate.age > K.yukiVisibleAge || facts.obs.self.scouts.length < K.yukiMinScouts);
    },
  },
};
