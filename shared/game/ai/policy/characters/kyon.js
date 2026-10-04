export default {
  id: "kyon",
  sub: {
    purgeableBuff: true,
    shouldCast(policy, { K, ship, estimate, dist }) {
      return ship.hp / Math.max(1, ship.maxHp) < K.kyonHull || Boolean(estimate && dist <= ship.stats.range * K.kyonRange);
    },
  },
};
