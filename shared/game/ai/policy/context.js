// 焦点目标选择与战术上下文。
// 这些方法安装在 RulePolicy 的原型上，经 this 访问观测、参数、随机流与策略状态。
import { clamp, distance } from "../../math.js";
import { buildKoizumiBarrierTactics, characterTargetPriorityBonus } from "./tactics/character-counterplay.js";
import { buildShamisenHuntTactics } from "./tactics/shamisen-hunt.js";

export const contextMethods = {
  selectEnemyFocus(main) {
    const F = this.params.focus;
    const contacts = this.knownEnemyContacts({ maxAge: F.maxAge });
    if (contacts.length === 0) {
      return this.primaryEnemyEstimate();
    }

    let best = null;
    let bestScore = -Infinity;
    for (const contact of contacts) {
      if (contact.kind === "scout") {
        continue;
      }
      const dist = distance(main.x, main.y, contact.x, contact.y);
      const proximity = clamp(1 - dist / Math.max(main.stats.range * F.proximityRangeMult, 1), F.proximityMin, F.proximityMax);
      const freshness = clamp(1 - contact.age / F.freshnessWindow, 0, 1);
      const vulnerability = 1 - this.contactHpRatio(contact);
      const isolation = this.enemyIsolationScore(contact, F.isolationMaxAge);
      const overwhelmOpportunity = clamp(
        (this.friendlyPowerAround(contact.x, contact.y, F.overwhelmFriendlyRadius) + 0.2) / Math.max(this.enemyThreatAround(contact.x, contact.y, F.overwhelmEnemyRadius, 6) + 0.2, 0.2) - 1,
        F.overwhelmMin,
        F.overwhelmMax,
      );
      const typeBias = contact.slotKey === "main" ? F.typeMain : contact.kind === "ship" ? F.typeShip : F.typeOther;
      const visibleBias = contact.visible ? F.visible : F.hidden;
      const huntBias = contact.source === "hunt" ? F.hunt : 0;
      const uncertaintyPenalty = clamp((contact.uncertainty || 0) / F.uncertaintyScale, 0, F.uncertaintyMax);
      const score = typeBias
        + proximity
        + freshness * F.freshness
        + vulnerability * F.vulnerability
        + isolation * F.isolation
        + overwhelmOpportunity * F.overwhelm
        + visibleBias
        + huntBias
        + (this.params.features.characterPriority ? characterTargetPriorityBonus(contact, this.obs.time) : 0)
        - uncertaintyPenalty;
      if (score > bestScore) {
        bestScore = score;
        best = contact;
      }
    }
    return best || this.primaryEnemyEstimate();
  },

  buildTacticalContext(main, focus) {
    const X = this.params.context;
    const fleetEnergy = this.energyProfile("main");
    const rangeRef = main.stats.range;
    const dist = distance(main.x, main.y, focus.x, focus.y);
    const mainHull = main.hp / Math.max(main.maxHp, 1);
    const mainEnergyRatio = clamp(main.energy / Math.max(main.maxEnergy, 1), 0, 1);
    const fleetHull = this.obs.self.hullRatio;
    const energyRatio = fleetEnergy.ratio;
    const friendlyLocal = this.friendlyPowerAround(focus.x, focus.y, X.localRadius);
    const friendlyEscort = this.friendlyPowerAround(main.x, main.y, X.escortRadius);
    const enemyLocal = this.enemyThreatAround(focus.x, focus.y, X.localRadius, X.localMaxAge);
    const localAdvantage = (friendlyLocal + friendlyEscort * X.escortWeight + X.advantageBias) / Math.max(enemyLocal + X.advantageBias, X.advantageBias);
    const shamisenHunt = buildShamisenHuntTactics({
      obs: this.obs,
      ships: this.ownShips(),
      main,
      focus,
      knownContacts: this.knownEnemyContacts({ maxAge: X.huntContactMaxAge }),
      localAdvantage,
    });
    const hiddenHuntTarget = Boolean(
      shamisenHunt.attack?.active
      && shamisenHunt.attack.isFocus
      && !shamisenHunt.attack.targetVisible,
    );
    const intelSolid = focus.visible || (
      focus.source !== "spawn"
      && focus.source !== "hunt"
      && focus.age <= X.solidMaxAge
      && focus.confidence >= X.solidMinConfidence
    );
    const searchRequired = hiddenHuntTarget || focus.source === "spawn" || focus.age > X.searchAgeAbove || focus.confidence < X.searchConfidenceBelow;
    const killWindow = this.contactHpRatio(focus) < X.killHpBelow && dist < rangeRef * X.killRange;
    const broadsideWindow = dist > rangeRef * X.broadsideMinRange && dist < rangeRef * X.broadsideMaxRange && intelSolid;
    const detachedShips = [this.obs.self.ships.sub1, this.obs.self.ships.sub2].filter((ship) => ship.alive && !ship.attached);
    const detachedSpread = detachedShips.reduce((max, ship) => Math.max(max, distance(ship.x, ship.y, main.x, main.y)), 0);
    const overextended = detachedSpread > X.overextendedSpread && localAdvantage < X.overextendedAdvantage;
    const shipThreats = new Map();
    let maxShipThreat = 0;
    let overwhelmedShipKey = null;
    for (const ship of [main, ...detachedShips]) {
      const threat = this.shipThreatSnapshot(ship);
      shipThreats.set(ship.key, threat);
      if (threat.danger > maxShipThreat) {
        maxShipThreat = threat.danger;
      }
      if (!overwhelmedShipKey && threat.overwhelmed) {
        overwhelmedShipKey = ship.key;
      }
    }
    const defensivePressure = (localAdvantage < X.defensiveAdvantage && dist < rangeRef * X.defensiveRange)
      || mainHull < X.defensiveHull
      || Boolean(shamisenHunt.defense?.active && shamisenHunt.defense.huntedHpRatio < X.defensiveHuntedHp);
    const flankSign = this.preferredFlankSign(main, focus);
    const ownArcDensity = this.arcDensityFromState(main.angle, main.x, main.y, focus.x, focus.y, this.obs.self.flags.kyonFlagship);
    const enemyArcDensity = this.arcDensityFromState(focus.angle, focus.x, focus.y, main.x, main.y, this.obs.privileged.enemyHasKyonFlagship);
    const arcAdvantage = ownArcDensity - enemyArcDensity;
    const enemyBroadsideRisk = enemyArcDensity >= X.broadsideRiskDensity;
    const safeExchange = enemyArcDensity <= 1 && ownArcDensity >= 1;
    const focusFreshness = clamp(1 - focus.age / X.freshnessWindow, 0, 1);
    const trackableIntel = !intelSolid && focus.source !== "spawn" && focus.age <= X.trackableMaxAge && focus.confidence >= X.trackableMinConfidence;
    const intelUrgency = focus.visible ? X.intelUrgencyVisible : focus.source === "spawn" ? X.intelUrgencySpawn : clamp(X.intelUrgencyBase + focus.age / X.intelUrgencyAgeScale + (1 - focus.confidence) * X.intelUrgencyConfidence, X.intelUrgencyMin, X.intelUrgencyMax);
    const isolatedTargetScore = clamp(this.enemyIsolationScore(focus, X.isolationMaxAge) + Math.max(0, localAdvantage - X.isolationAdvantageFloor) * X.isolationAdvantageWeight, X.isolatedMin, X.isolatedMax);
    const combatUrgency = clamp(
      (focus.visible ? X.combatUrgency.visible : X.combatUrgency.hidden)
      + (dist < rangeRef * X.combatUrgency.inRangeRatio ? X.combatUrgency.inRange : 0)
      + (killWindow ? X.combatUrgency.killWindow : 0)
      + (enemyLocal > friendlyLocal * X.combatUrgency.pressuredRatio && dist < rangeRef * X.combatUrgency.pressuredRange ? X.combatUrgency.pressured : 0)
      + (trackableIntel ? X.combatUrgency.trackableIntel : 0)
      + Math.max(0, maxShipThreat - X.combatUrgency.threatFloor) * X.combatUrgency.threat
      + isolatedTargetScore * X.combatUrgency.isolatedTarget,
      0,
      X.combatUrgency.max,
    );
    const counterCollapse = clamp(maxShipThreat - X.counterCollapseThreatFloor, 0, X.counterCollapseMax) * clamp(localAdvantage, X.counterCollapseAdvantageMin, X.counterCollapseAdvantageMax);
    const emergencyCommit = killWindow
      || maxShipThreat > X.emergencyThreat
      || (focus.visible && (combatUrgency > X.emergencyUrgency || dist < rangeRef * X.emergencyVisibleRange))
      || (trackableIntel && !hiddenHuntTarget && dist < rangeRef * X.emergencyTrackableRange && localAdvantage > X.emergencyTrackableAdvantage);
    const energySurplus = clamp((energyRatio - X.surplusFloor) / X.surplusSpan, 0, 1);
    const energyRecoveryNeed = clamp((X.recoveryCeiling - energyRatio) / X.recoveryCeiling, 0, 1) * (emergencyCommit ? X.recoveryEmergencyFactor : X.recoveryFactor);
    const conserveEnergy = energyRecoveryNeed > X.conserveAbove && !emergencyCommit && !trackableIntel;
    const mobilityBias = clamp(X.mobilityBase + energySurplus * X.mobilitySurplus + (emergencyCommit ? X.mobilityEmergency : 0) - energyRecoveryNeed * X.mobilityRecovery, X.mobilityMin, X.mobilityMax);
    const skillAggression = clamp(
      X.skillAggression.base
      + energySurplus * X.skillAggression.energySurplus
      + combatUrgency * X.skillAggression.combatUrgency
      + (trackableIntel ? X.skillAggression.trackableIntel : 0)
      + isolatedTargetScore * X.skillAggression.isolatedTarget
      - energyRecoveryNeed * X.skillAggression.energyRecoveryNeed,
      0,
      X.skillAggression.max,
    );
    const scoutPriority = clamp(
      intelUrgency * X.scoutPriority.intelUrgency
      + (searchRequired ? X.scoutPriority.searchRequired : 0)
      + (trackableIntel ? X.scoutPriority.trackableIntel : 0)
      + (hiddenHuntTarget ? X.scoutPriority.hiddenHuntTarget : 0)
      + Math.max(0, maxShipThreat - X.scoutPriority.threatFloor) * X.scoutPriority.threat
      - combatUrgency * X.scoutPriority.combatUrgency
      - energyRecoveryNeed * X.scoutPriority.energyRecoveryNeed,
      0,
      X.scoutPriority.max,
    );
    const encirclePressure = clamp(
      X.encirclePressure.base
      + focusFreshness * X.encirclePressure.freshness
      + (trackableIntel ? X.encirclePressure.trackableIntel : 0)
      + (searchRequired ? X.encirclePressure.searchRequired : 0)
      + isolatedTargetScore * X.encirclePressure.isolatedTarget,
      X.encirclePressure.min,
      X.encirclePressure.max,
    );
    const pressureDrive = clamp(localAdvantage - X.pressureDrive.advantageFloor, 0, X.pressureDrive.advantageMax) * X.pressureDrive.advantage
      + energySurplus * X.pressureDrive.energySurplus
      + clamp(focusFreshness - X.pressureDrive.freshnessFloor, 0, X.pressureDrive.freshnessMax) * X.pressureDrive.freshness
      + (killWindow ? X.pressureDrive.killWindow : 0)
      + (trackableIntel ? X.pressureDrive.trackableIntel : 0)
      + (emergencyCommit ? X.pressureDrive.emergencyCommit : 0)
      + counterCollapse * X.pressureDrive.counterCollapse
      + isolatedTargetScore * X.pressureDrive.isolatedTarget
      + (shamisenHunt.attack?.targetVisible && !shamisenHunt.attack.overcommitRisk ? X.pressureDrive.huntTargetVisible : 0)
      - (shamisenHunt.attack?.overcommitRisk ? X.pressureDrive.huntOvercommit : 0)
      - energyRecoveryNeed * X.pressureDrive.energyRecoveryNeed;

    // 收尾判断：是否占优(领先) + 是否到了该收尾的窗口(敌方濒临覆灭)。
    // 领先时不应因自身低血/低能转入防守，而应压制收尾——破解"双方都低血同时转防守"的平局僵局。
    const enemyHullTeam = this.obs.privileged.enemyHullRatio;
    const ownHullTeam = this.obs.self.hullRatio;
    const enemyAliveCount = this.obs.privileged.enemyAliveCount;
    const ownAliveCount = this.ownShips().filter((s) => s && s.alive).length;
    const winning = !this.params.features.closeout ? false : (ownAliveCount > enemyAliveCount || ownHullTeam > enemyHullTeam + X.winningHullLead);
    const closeoutWindow = !this.params.features.closeout ? false : (enemyAliveCount > 0
      && (enemyAliveCount < ownAliveCount || enemyHullTeam < X.closeoutEnemyHull || (killWindow && winning)));
    const enemyMainContact = this.projectContact(this.enemyIntel.main, X.enemyMainLead);
    const advancedCounterplay = this.usesAdvancedSkillCounterplay();
    const barrierTactics = buildKoizumiBarrierTactics({
      obs: this.obs,
      ships: this.ownShips(),
      enemyMainContact,
      main,
      enemyContacts: this.knownEnemyContacts({ maxAge: X.barrierContactMaxAge }),
      now: this.obs.time,
      legacy: !this.params.features.barrierTactics,
      advanced: advancedCounterplay,
    });

    return {
      focus,
      rangeRef,
      winning,
      closeoutWindow,
      dist,
      mainHull,
      mainEnergyRatio,
      fleetHull,
      energyRatio,
      friendlyLocal,
      enemyLocal,
      localAdvantage,
      intelSolid,
      searchRequired,
      killWindow,
      broadsideWindow,
      detachedCount: detachedShips.length,
      detachedSpread,
      overextended,
      defensivePressure,
      edgePressure: this.edgePressure(main),
      flankSign,
      ownArcDensity,
      enemyArcDensity,
      arcAdvantage,
      enemyBroadsideRisk,
      safeExchange,
      fleetEnergy,
      focusFreshness,
      trackableIntel,
      intelUrgency,
      combatUrgency,
      emergencyCommit,
      energySurplus,
      energyRecoveryNeed,
      conserveEnergy,
      mobilityBias,
      skillAggression,
      scoutPriority,
      encirclePressure,
      pressureDrive,
      isolatedTargetScore,
      maxShipThreat,
      overwhelmedShipKey,
      counterCollapse,
      shipThreats,
      shamisenHunt,
      barrierTactics,
    };
  },
};
