// 分离决策。
// 这些方法安装在 RulePolicy 的原型上，经 this 访问观测、参数、随机流与策略状态。
import { clamp } from "../../math.js";
import { shamisenHuntNeedsSplit } from "./tactics/shamisen-hunt.js";
import { characterProfile } from "./characters/index.js";

export const splitMethods = {
  splitUtilityForShip(ship, context) {
    const SU = this.params.split.utility;
    if (!ship || !ship.alive || !context) {
      return 0;
    }
    const vitality = this.shipVitality(ship);
    const visionEdge = clamp((ship.stats.vision - this.estimateVisionRange(context.focus)) / SU.visionEdgeScale, SU.visionEdgeMin, SU.visionEdgeMax);
    const characterBias = characterProfile(ship.characterId).splitBias?.(SU) ?? SU.otherBias;
    return vitality.value + visionEdge + characterBias;
  },

  shouldSplit(level, context, elapsed) {
    const SP = this.params.split;
    if (!context) {
      return false;
    }
    const huntSplitNeeded = shamisenHuntNeedsSplit(context.shamisenHunt, level, elapsed);
    if (
      huntSplitNeeded
      && (
        context.shamisenHunt?.defense?.active
        || (context.fleetHull > SP.huntMinHull && context.energyRatio > SP.huntMinEnergy)
      )
    ) {
      return true;
    }
    if (level === 1) {
      const ship = this.obs.self.ships.sub1;
      if (this.obs.self.splitLevel !== 0 || !ship.alive) {
        return false;
      }
      if (
        context.barrierTactics?.enemy?.active
        && (
          characterProfile(ship.characterId).splitsEarlyAgainstBarrier
          || context.barrierTactics.infiltration?.splitShipKeys?.includes(ship.key)
        )
        && elapsed > SP.level1.barrierAfter
        && context.fleetHull > SP.level1.barrierMinHull
      ) {
        return true;
      }
      const splitUtility = this.splitUtilityForShip(ship, context);
      if ((context.mainHull < SP.level1.weakMainHull && context.mainEnergyRatio < SP.level1.weakMainEnergy) || context.fleetHull < SP.level1.weakFleetHull || context.energyRatio < SP.level1.weakEnergy || (context.defensivePressure && context.maxShipThreat > SP.level1.weakThreat)) {
        return elapsed > SP.level1.weakAfter && context.dist > context.rangeRef * SP.level1.weakMinRange;
      }
      if (context.searchRequired && elapsed < (splitUtility > SP.level1.searchUtility ? SP.level1.searchHoldHigh : SP.level1.searchHoldLow) && !context.trackableIntel) {
        return false;
      }
      const earlyWindow = splitUtility > SP.level1.earlyUtilityHigh ? SP.level1.earlyHigh : splitUtility > SP.level1.earlyUtilityMid ? SP.level1.earlyMid : SP.level1.earlyLow;
      return elapsed > earlyWindow && (
        context.killWindow
        || context.trackableIntel
        || context.intelSolid
        || context.isolatedTargetScore > SP.level1.isolated
        || context.focusFreshness > SP.level1.freshness
        || context.localAdvantage > (splitUtility > SP.level1.advantageUtility ? SP.level1.advantageHigh : SP.level1.advantageLow)
        || context.dist < context.rangeRef * SP.level1.range
      );
    }
    if (level === 2) {
      const ship = this.obs.self.ships.sub2;
      if (this.obs.self.splitLevel !== 1 || !ship.alive) {
        return false;
      }
      if (
        context.barrierTactics?.enemy?.active
        && (
          characterProfile(ship.characterId).splitsEarlyAgainstBarrier
          || context.barrierTactics.infiltration?.splitShipKeys?.includes(ship.key)
        )
        && elapsed > SP.level2.barrierAfter
        && context.fleetHull > SP.level2.barrierMinHull
        && !context.overextended
      ) {
        return true;
      }
      const splitUtility = this.splitUtilityForShip(ship, context);
      if ((context.mainHull < SP.level2.weakMainHull && context.mainEnergyRatio < SP.level2.weakMainEnergy) || context.fleetHull < SP.level2.weakFleetHull || context.energyRatio < SP.level2.weakEnergy || context.overextended || (context.defensivePressure && context.maxShipThreat > SP.level2.weakThreat)) {
        return elapsed > SP.level2.weakAfter && context.localAdvantage > SP.level2.weakAdvantage;
      }
      if (!context.intelSolid && !context.trackableIntel && elapsed < (splitUtility > SP.level2.intelUtility ? SP.level2.intelHoldHigh : SP.level2.intelHoldLow)) {
        return false;
      }
      const earlyWindow = splitUtility > SP.level2.earlyUtilityHigh ? SP.level2.earlyHigh : splitUtility > SP.level2.earlyUtilityMid ? SP.level2.earlyMid : SP.level2.earlyLow;
      return elapsed > earlyWindow && (
        context.killWindow
        || context.trackableIntel
        || context.intelSolid
        || context.isolatedTargetScore > SP.level2.isolated
        || context.localAdvantage > (splitUtility > SP.level2.advantageUtility ? SP.level2.advantageHigh : SP.level2.advantageLow)
        || context.dist < context.rangeRef * SP.level2.range
      );
    }
    return false;
  },

  evaluateSplit(elapsed, context) {
    const acted = [];
    const attempt1 = this.shouldSplit(1, context, elapsed);
    if (attempt1 && this.writeSplit(1)) {
      acted.push(1);
    }
    const attempt2 = this.shouldSplit(2, context, elapsed);
    if (attempt2 && this.writeSplit(2)) {
      acted.push(2);
    }
    this.lastSplitDecision = {
      attempt1,
      attempt2,
      acted,
      level: this.obs.self.splitLevel,
      at: elapsed,
    };
  },
};
