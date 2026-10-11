// 分离决策。
// 每个算法显式声明事实和查询输入；执行算法按需重读动作后的事实。
import { clamp } from "../../math.js";
import { shamisenHuntNeedsSplit } from "./tactics/shamisen-hunt.js";
import { characterProfile } from "./characters/index.js";

export const splitMethods = {
  splitUtilityForShip({ params: policyParams, shipVitality: capShipVitality, estimateVisionRange: capEstimateVisionRange }, ship, context) {
    const SU = policyParams.split.utility;
    if (!ship || !ship.alive || !context) {
      return 0;
    }
    const vitality = capShipVitality(ship);
    const visionEdge = clamp((ship.stats.vision - capEstimateVisionRange(context.focus)) / SU.visionEdgeScale, SU.visionEdgeMin, SU.visionEdgeMax);
    const characterBias = characterProfile(ship.characterId).splitBias?.(SU) ?? SU.otherBias;
    return vitality.value + visionEdge + characterBias;
  },

  shouldSplit({ params: policyParams, obs: policyObs, splitUtilityForShip: capSplitUtilityForShip }, level, context, elapsed) {
    const SP = policyParams.split;
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
      const ship = policyObs.self.ships.sub1;
      if (policyObs.self.splitLevel !== 0 || !ship.alive) {
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
      const splitUtility = capSplitUtilityForShip(ship, context);
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
      const ship = policyObs.self.ships.sub2;
      if (policyObs.self.splitLevel !== 1 || !ship.alive) {
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
      const splitUtility = capSplitUtilityForShip(ship, context);
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

};
