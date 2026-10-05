export default {
  id: "asakura",
  splitBias: (SU) => SU.asakuraBias,
  intelLeadBias: (D) => D.asakuraBias,
  detachedDefaultRole: "flank",
  splitsEarlyAgainstBarrier: true,
  flagship: {
    purgeableBuff: true,
    // 视野波：能在敌方可见增益到期前净化它，或隐藏敌舰附近有值得一扫的线索时施放。
    shouldCast(policy, { K, estimate, context, dist }) {
      const now = policy.obs.time;
      const visibleShips = policy.obs.enemy.visible.filter((entity) => entity.kind === "ship");
      const teamBuffs = policy.obs.enemy.visibleTeamBuffs;
      let visibleBuffRemaining = 0;
      if (visibleShips.length > 0) {
        visibleBuffRemaining = Math.max(
          0,
          teamBuffs.sponsorUntil - now,
          teamBuffs.haruhiBoostUntil - now,
          teamBuffs.visionWaveActiveUntil - now,
        );
        for (const ship of visibleShips) {
          visibleBuffRemaining = Math.max(
            visibleBuffRemaining,
            Number(ship.effects.reliableUntil || 0) - now,
            Number(ship.effects.bladeQueenUntil || 0) - now,
            ship.effects.nextShotDamageMultiplier > 1 ? K.asakuraChargedShotSeconds : 0,
          );
        }
      }

      const waveArrivalSeconds = dist / K.asakuraWaveSpeed;
      const canPurgeBeforeExpiry = visibleBuffRemaining > waveArrivalSeconds + K.asakuraPurgeMargin;
      const hasHiddenEnemyShip = policy.obs.privileged.hasHiddenEnemyShip;
      const usefulSearchPulse = hasHiddenEnemyShip && Boolean(
        estimate.source === "radar"
        || (!estimate.visible && estimate.source !== "spawn" && estimate.age <= K.asakuraSearchAge)
        || context?.trackableIntel
        || (policy.mode === "search" && (context?.searchRequired || context?.intelUrgency > K.asakuraSearchUrgency)),
      );
      return canPurgeBeforeExpiry || usefulSearchPulse;
    },
  },
  sub: {
    purgeableBuff: true,
    shouldCast(policy, { K, ship, estimate, context, dist, assignedToBreach, breachDistance }) {
      if (assignedToBreach) {
        return Boolean(
          estimate
          && (estimate.visible || estimate.age <= K.asakuraBreachAge)
          && breachDistance <= ship.stats.range * K.asakuraBreachRange,
        );
      }
      return Boolean(
        estimate
        && (estimate.visible || estimate.age <= K.asakuraAge)
        && dist <= ship.stats.range * K.asakuraRange
        && (((context?.skillAggression) || 0) > K.asakuraAggression || context?.killWindow || context?.combatUrgency > K.asakuraUrgency),
      );
    },
  },
};
