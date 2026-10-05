// 走位模式的评分与选择。
// 这些方法安装在 RulePolicy 的原型上，经 this 访问观测、参数、随机流与策略状态。

export const modeMethods = {
  scoreMode(mode, context) {
    const S = this.params.mode.scores;
    const rangeRatio = context.dist / Math.max(context.rangeRef, 1);
    const ownBarrier = context.barrierTactics?.own;
    const enemyBarrier = context.barrierTactics?.enemy;
    const barrierBreachWindow = Boolean(
      enemyBarrier
      && !enemyBarrier.active
      && enemyBarrier.disabledRemaining > 0,
    );
    const organizedBreach = Boolean(
      enemyBarrier?.active
      && context.barrierTactics?.breachShipKey,
    );
    const organizedInfiltration = Boolean(
      enemyBarrier?.active
      && context.barrierTactics?.infiltration?.shipKeys?.length,
    );
    if (mode === "recover") {
      return context.edgePressure * S.recover.edgePressure + (context.mainHull < S.recover.lowHullBelow ? S.recover.lowHull : 0);
    }
    if (mode === "harvest") {
      return context.energyRecoveryNeed * S.harvest.energyRecoveryNeed
        + (context.emergencyCommit ? S.harvest.emergencyCommit : S.harvest.noEmergency)
        + (context.dist > context.rangeRef * S.harvest.farRangeRatio ? S.harvest.far : S.harvest.near)
        + (context.intelSolid ? S.harvest.intelSolid : S.harvest.intelWeak)
        - context.pressureDrive * S.harvest.pressureDrive
        - context.isolatedTargetScore * S.harvest.isolatedTarget;
    }
    if (mode === "search") {
      return (context.searchRequired ? (context.focus.source === "spawn" ? S.search.spawn : S.search.required) : S.search.notRequired)
        + (context.intelSolid ? S.search.intelSolid : S.search.intelWeak)
        + (context.trackableIntel ? S.search.trackableIntel : 0)
        + context.encirclePressure * S.search.encirclePressure
        - context.energyRecoveryNeed * S.search.energyRecoveryNeed;
    }
    if (mode === "regroup") {
      return (context.overextended ? S.regroup.overextended : 0)
        + (context.defensivePressure ? S.regroup.defensivePressure : 0)
        + (ownBarrier && !ownBarrier.active ? S.regroup.ownBarrierDown : 0)
        + (context.barrierTactics?.incoming ? S.regroup.incomingBreaker : 0)
        + (context.energyRatio < S.regroup.lowEnergyBelow ? S.regroup.lowEnergy : 0)
        + (context.enemyBroadsideRisk ? S.regroup.enemyBroadsideRisk : 0)
        + context.energyRecoveryNeed * S.regroup.energyRecoveryNeed
        - context.counterCollapse * S.regroup.counterCollapse;
    }
    if (mode === "kite") {
      return (context.defensivePressure ? S.kite.defensivePressure : 0)
        + (ownBarrier && !ownBarrier.active ? S.kite.ownBarrierDown : 0)
        + (context.barrierTactics?.incoming ? S.kite.incomingBreaker : 0)
        + (rangeRatio < S.kite.closeRangeBelow ? S.kite.closeRange : 0)
        + (context.localAdvantage < S.kite.outnumberedBelow ? S.kite.outnumbered : 0)
        + (context.enemyArcDensity > 1 ? S.kite.enemyArc : 0)
        + context.maxShipThreat * S.kite.maxShipThreat
        + context.energyRecoveryNeed * S.kite.energyRecoveryNeed;
    }
    if (mode === "collapse") {
      return (context.killWindow ? S.collapse.killWindow : 0)
        + (barrierBreachWindow ? S.collapse.barrierBreachWindow : 0)
        + (organizedBreach ? S.collapse.organizedBreach : 0)
        + (context.barrierTactics?.infiltration?.phase === "commit" ? S.collapse.infiltrationCommit : 0)
        - (enemyBarrier?.active && !organizedBreach && !organizedInfiltration ? S.collapse.enemyBarrierUp : 0)
        + (context.localAdvantage > 1 ? S.collapse.advantage : 0)
        + (context.closeoutWindow ? S.collapse.closeoutWindow : 0) // 收尾窗口：强力倾向冲杀残敌
        + (context.intelSolid ? S.collapse.intelSolid : S.collapse.intelWeak)
        + (context.safeExchange ? S.collapse.safeExchange : 0)
        + context.isolatedTargetScore * S.collapse.isolatedTarget
        + context.counterCollapse * S.collapse.counterCollapse
        + (context.pressureDrive > S.collapse.pressureDriveAbove ? S.collapse.pressureDrive : 0)
        + context.energySurplus * S.collapse.energySurplus
        - context.energyRecoveryNeed * (context.closeoutWindow ? S.collapse.energyRecoveryCloseout : S.collapse.energyRecoveryNeed); // 收尾时不为省能放弃击杀
    }
    if (mode === "broadside") {
      return (context.broadsideWindow ? S.broadside.window : S.broadside.noWindow)
        + (ownBarrier?.active ? S.broadside.ownBarrierUp : 0)
        + (barrierBreachWindow ? S.broadside.barrierBreachWindow : 0)
        - (enemyBarrier?.active && !organizedBreach ? S.broadside.enemyBarrierUp : 0)
        + (context.localAdvantage > S.broadside.advantageAbove ? S.broadside.advantage : 0)
        + (context.killWindow ? S.broadside.killWindow : 0)
        + (context.arcAdvantage < S.broadside.arcDeficitBelow ? S.broadside.arcDeficit : 0)
        + (context.enemyBroadsideRisk ? S.broadside.enemyBroadsideRisk : 0)
        + context.energySurplus * S.broadside.energySurplus
        - context.energyRecoveryNeed * S.broadside.energyRecoveryNeed;
    }
    if (mode === "cutoff") {
      return (context.intelSolid ? S.cutoff.intelSolid : S.cutoff.intelWeak)
        + (context.barrierTactics?.infiltration?.phase === "stage" ? S.cutoff.infiltrationStage : 0)
        + (context.barrierTactics?.infiltration?.phase === "commit" ? S.cutoff.infiltrationCommit : 0)
        + (organizedBreach ? S.cutoff.organizedBreach : 0)
        + (rangeRatio > S.cutoff.rangeMin && rangeRatio < S.cutoff.rangeMax ? S.cutoff.inRange : 0)
        + (context.localAdvantage > S.cutoff.advantageAbove ? S.cutoff.advantage : 0)
        + (context.enemyArcDensity > S.cutoff.enemyArcAbove ? S.cutoff.enemyArc : 0)
        + (context.trackableIntel ? S.cutoff.trackableIntel : 0)
        + context.isolatedTargetScore * S.cutoff.isolatedTarget
        + context.energySurplus * S.cutoff.energySurplus
        - context.energyRecoveryNeed * S.cutoff.energyRecoveryNeed;
    }
    if (mode === "press") {
      return S.press.base
        + (barrierBreachWindow ? S.press.barrierBreachWindow : 0)
        + (organizedBreach ? S.press.organizedBreach : 0)
        + (context.barrierTactics?.infiltration?.phase === "commit" ? S.press.infiltrationCommit : 0)
        - (enemyBarrier?.active && !organizedBreach && !organizedInfiltration ? S.press.enemyBarrierUp : 0)
        + (context.closeoutWindow ? S.press.closeoutWindow : 0) // 收尾窗口：维持压制把残敌打死
        + (rangeRatio > S.press.farRangeAbove ? S.press.farRange : 0)
        + (context.localAdvantage > S.press.advantageAbove ? S.press.advantage : 0)
        - (context.defensivePressure && !context.winning ? S.press.defensivePressure : 0) // 占优时防御压力不削弱压制
        - (context.enemyBroadsideRisk ? S.press.enemyBroadsideRisk : 0)
        + (context.arcAdvantage > S.press.arcAdvantageAbove ? S.press.arcAdvantage : 0)
        + context.pressureDrive * S.press.pressureDrive
        + (context.trackableIntel ? S.press.trackableIntel : 0)
        + context.counterCollapse * S.press.counterCollapse
        + context.energySurplus * S.press.energySurplus
        - context.energyRecoveryNeed * (context.emergencyCommit || context.closeoutWindow ? S.press.energyRecoveryCommitted : S.press.energyRecoveryNeed);
    }
    return 0;
  },

  chooseMode(context) {
    const C = this.params.mode.choose;
    const ownBarrier = context.barrierTactics?.own;
    const forcedMode = context.edgePressure > C.recoverEdgePressure
      ? "recover"
      : ownBarrier && !ownBarrier.active && context.dist < context.rangeRef * C.ownBarrierDownRange && !context.winning
        ? context.detachedCount > 0 ? "regroup" : "kite"
      : context.barrierTactics?.incoming && !context.killWindow
        ? "kite"
      : context.barrierTactics?.enemy
        && !context.barrierTactics.enemy.active
        && context.barrierTactics.enemy.disabledRemaining > 0
        && context.intelSolid
        && context.mainHull > C.breachCollapseMinHull
        ? "collapse"
      // 收尾窗口下不强制去充能(harvest)——该把残局打完，否则双方都去充能拖成平局
      : (context.energyRecoveryNeed >= C.harvestRecoveryNeed || context.energyRatio < C.harvestEnergyBelow) && !context.emergencyCommit && !context.closeoutWindow && !context.focus.visible && context.dist > context.rangeRef * C.harvestMinRange
        ? "harvest"
      : context.shamisenHunt?.attack?.active
        && context.shamisenHunt.attack.isFocus
        && !context.shamisenHunt.attack.targetVisible
        ? "search"
      : context.searchRequired && context.focus.source === "spawn"
        ? "search"
        : null;
    if (forcedMode) {
      this.mode = forcedMode;
      this.modeTimer = this.rng.range(C.forcedHoldMin, forcedMode === "search" ? C.forcedHoldSearch : forcedMode === "harvest" ? C.forcedHoldHarvest : C.forcedHoldOther);
      return this.mode;
    }

    // 低血转防守——但若正占优(领先/敌濒覆灭)则不退，继续压制把对手打死，避免领先方陪跑成平局
    if (context.mainHull < C.lowHullBelow && context.dist < context.rangeRef * C.lowHullRange && !context.winning) {
      this.mode = context.detachedCount > 0 ? "regroup" : "kite";
      this.modeTimer = this.rng.range(C.lowHullHold[0], C.lowHullHold[1]);
      return this.mode;
    }
    if ((context.focus.visible || context.maxShipThreat > C.lowEnergyThreat) && context.energyRatio < C.lowEnergyBelow && context.dist < context.rangeRef * C.lowEnergyRange && !context.winning) {
      this.mode = "regroup";
      this.modeTimer = this.rng.range(C.lowEnergyHold[0], C.lowEnergyHold[1]);
      return this.mode;
    }

    if (this.modeTimer > 0) {
      return this.mode;
    }

    const modes = ["harvest", "regroup", "kite", "collapse", "broadside", "cutoff", "press"];
    let bestMode = "press";
    let bestScore = -Infinity;
    for (const mode of modes) {
      const score = this.scoreMode(mode, context);
      if (score > bestScore) {
        bestScore = score;
        bestMode = mode;
      }
    }
    this.mode = bestMode;
    this.modeTimer = this.rng.range(
      bestMode === "collapse" || bestMode === "kite" || bestMode === "cutoff" ? C.holdMinShort : C.holdMinLong,
      bestMode === "regroup" || bestMode === "harvest" ? C.holdMaxLong : C.holdMaxShort,
    );
    return this.mode;
  },
};
