import { copyPlainData } from "../../../data/plain-data.js";
// 调试状态序列化：供推演页展示决策中间量，结构保持稳定。
// 每个算法显式声明事实和查询输入；执行算法按需重读动作后的事实。

export const debugStateMethods = {
  debugPoint({ zoneForPoint: capZoneForPoint }, point) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return null;
    }
    return {
      x: point.x,
      y: point.y,
      zoneId: Number.isFinite(point.zoneId) ? point.zoneId : capZoneForPoint(point.x, point.y).id,
      intentAngle: Number.isFinite(point.intentAngle) ? point.intentAngle : null,
      preferredRange: Number.isFinite(point.preferredRange) ? point.preferredRange : null,
    };
  },

  debugPointMap({ debugPoint: capDebugPoint }, plan) {
    if (!plan) {
      return null;
    }
    const output = {};
    for (const [key, point] of Object.entries(plan)) {
      output[key] = capDebugPoint(point);
    }
    return output;
  },

  debugContact({ obs: policyObs, zoneForPoint: capZoneForPoint }, contact) {
    if (!contact) {
      return null;
    }
    const age = Number.isFinite(contact.age) ? contact.age : Math.max(0, policyObs.time - (contact.seenAt || policyObs.time));
    return {
      id: contact.id,
      kind: contact.kind || "ship",
      key: contact.key || null,
      slotKey: contact.slotKey || null,
      characterId: contact.characterId || null,
      x: contact.x,
      y: contact.y,
      angle: Number.isFinite(contact.angle) ? contact.angle : 0,
      speed: Number.isFinite(contact.speed) ? contact.speed : 0,
      zoneId: Number.isFinite(contact.zoneId) ? contact.zoneId : capZoneForPoint(contact.x, contact.y).id,
      source: contact.source || "visible",
      age,
      confidence: Number.isFinite(contact.confidence) ? contact.confidence : 1,
      uncertainty: Number.isFinite(contact.uncertainty) ? contact.uncertainty : 0,
      visible: Boolean(contact.visible || contact.source === "visible"),
      hp: Number.isFinite(contact.hp) ? contact.hp : null,
      maxHp: Number.isFinite(contact.maxHp) ? contact.maxHp : null,
      combatCapable: Boolean(contact.combatCapable),
    };
  },

  debugThreatMap(_inputs, shipThreats) {
    const output = {};
    if (!shipThreats) {
      return output;
    }
    for (const [key, threat] of Object.entries(shipThreats)) {
      output[key] = {
        sources: threat.sources || 0,
        pressure: threat.pressure || 0,
        friendlySupport: threat.friendlySupport || 0,
        danger: threat.danger || 0,
        overwhelmed: Boolean(threat.overwhelmed),
      };
    }
    return output;
  },

  debugContext({ debugThreatMap: capDebugThreatMap }, context) {
    if (!context) {
      return null;
    }
    return {
      dist: context.dist,
      rangeRef: context.rangeRef,
      mainHull: context.mainHull,
      mainEnergyRatio: context.mainEnergyRatio,
      fleetHull: context.fleetHull,
      energyRatio: context.energyRatio,
      friendlyLocal: context.friendlyLocal,
      enemyLocal: context.enemyLocal,
      localAdvantage: context.localAdvantage,
      intelSolid: Boolean(context.intelSolid),
      searchRequired: Boolean(context.searchRequired),
      killWindow: Boolean(context.killWindow),
      broadsideWindow: Boolean(context.broadsideWindow),
      detachedCount: context.detachedCount,
      detachedSpread: context.detachedSpread,
      overextended: Boolean(context.overextended),
      defensivePressure: Boolean(context.defensivePressure),
      edgePressure: context.edgePressure,
      flankSign: context.flankSign,
      ownArcDensity: context.ownArcDensity,
      enemyArcDensity: context.enemyArcDensity,
      arcAdvantage: context.arcAdvantage,
      enemyBroadsideRisk: Boolean(context.enemyBroadsideRisk),
      safeExchange: Boolean(context.safeExchange),
      focusFreshness: context.focusFreshness,
      trackableIntel: Boolean(context.trackableIntel),
      intelUrgency: context.intelUrgency,
      combatUrgency: context.combatUrgency,
      emergencyCommit: Boolean(context.emergencyCommit),
      energySurplus: context.energySurplus,
      energyRecoveryNeed: context.energyRecoveryNeed,
      conserveEnergy: Boolean(context.conserveEnergy),
      mobilityBias: context.mobilityBias,
      skillAggression: context.skillAggression,
      scoutPriority: context.scoutPriority,
      encirclePressure: context.encirclePressure,
      pressureDrive: context.pressureDrive,
      isolatedTargetScore: context.isolatedTargetScore,
      maxShipThreat: context.maxShipThreat,
      overwhelmedShipKey: context.overwhelmedShipKey || null,
      counterCollapse: context.counterCollapse,
      shipThreats: capDebugThreatMap(context.shipThreats),
      shamisenHunt: context.shamisenHunt
        ? {
            attack: context.shamisenHunt.attack
              ? {
                  active: true,
                  targetId: context.shamisenHunt.attack.targetId,
                  targetVisible: Boolean(context.shamisenHunt.attack.targetVisible),
                  phase: context.shamisenHunt.attack.phase,
                  overcommitRisk: Boolean(context.shamisenHunt.attack.overcommitRisk),
                  leadShipKey: context.shamisenHunt.attack.leadShipKey,
                  leadGap: context.shamisenHunt.attack.leadGap,
                  spread: context.shamisenHunt.attack.spread,
                  blockerId: context.shamisenHunt.attack.blockerId,
                }
              : null,
            defense: context.shamisenHunt.defense
              ? {
                  active: true,
                  huntedShipKey: context.shamisenHunt.defense.huntedShipKey,
                  huntedShipId: context.shamisenHunt.defense.huntedShipId,
                  huntedIsMain: Boolean(context.shamisenHunt.defense.huntedIsMain),
                  huntedHpRatio: context.shamisenHunt.defense.huntedHpRatio,
                }
              : null,
          }
        : null,
      barrierTactics: context.barrierTactics
        ? {
            own: context.barrierTactics.own
              ? {
                  active: Boolean(context.barrierTactics.own.active),
                  radius: context.barrierTactics.own.radius,
                  disabledRemaining: context.barrierTactics.own.disabledRemaining,
                }
              : null,
            enemy: context.barrierTactics.enemy
              ? {
                  active: Boolean(context.barrierTactics.enemy.active),
                  radius: context.barrierTactics.enemy.radius,
                  disabledRemaining: context.barrierTactics.enemy.disabledRemaining,
                  age: context.barrierTactics.enemy.age,
                }
              : null,
            breachShipKey: context.barrierTactics.breachShipKey || null,
            breachKind: context.barrierTactics.breachKind || null,
            breachActive: Boolean(context.barrierTactics.breachActive),
            infiltration: context.barrierTactics.infiltration
              ? {
                  phase: context.barrierTactics.infiltration.phase,
                  shipKeys: [...context.barrierTactics.infiltration.shipKeys],
                  splitShipKeys: [...context.barrierTactics.infiltration.splitShipKeys],
                  stagedShipKeys: [...context.barrierTactics.infiltration.stagedShipKeys],
                  insideShipKeys: [...context.barrierTactics.infiltration.insideShipKeys],
                }
              : null,
            incomingKind: context.barrierTactics.incoming?.kind || null,
            incomingId: context.barrierTactics.incoming?.contact?.id || null,
          }
        : null,
    };
  },

  debugDetachedPlan(_inputs, plan) {
    if (!plan) {
      return null;
    }
    return {
      intelLeadKey: plan.intelLeadKey || null,
      retreatKey: plan.retreatKey || null,
      roles: { ...plan.roles },
      laneSigns: { ...plan.laneSigns },
    };
  },

  serializeDebugState({
    currentContext: policyCurrentContext,
    lastTacticalPlan: policyLastTacticalPlan,
    rememberedMain: policyRememberedMain,
    rememberedContacts: policyRememberedContacts,
    obs: policyObs,
    seat: policySeat,
    mode: policyMode,
    modeTimer: policyModeTimer,
    moveTimer: policyMoveTimer,
    scoutTimer: policyScoutTimer,
    flagshipTimer: policyFlagshipTimer,
    subTimers: policySubTimers,
    searchZoneId: policySearchZoneId,
    knownContactCount: policyKnownContactCount,
    pendingContactCount: policyPendingContactCount,
    debugContact: capDebugContact,
    debugContext: capDebugContext,
    lastScoutDecision: policyLastScoutDecision,
    scoutDoctrine: policyScoutDoctrine,
    lastFlagshipDecision: policyLastFlagshipDecision,
    lastSubSkillDecision: policyLastSubSkillDecision,
    lastSplitDecision: policyLastSplitDecision,
  }) {
    const focus = policyCurrentContext?.focus || policyLastTacticalPlan?.focus || policyRememberedMain;
    let visibleContacts = 0;
    for (const contact of policyRememberedContacts) {
      const age = policyObs.time - contact.seenAt;
      if ((contact.source === "visible" || age <= 0.6) && age <= 1.2) {
        visibleContacts += 1;
      }
    }
    // 已投影的标量和新对象可直接发布，仅复制仍由策略持有的计划与决策。
    return {
      seat: policySeat,
      mode: policyMode,
      modeTimer: policyModeTimer,
      moveTimer: policyMoveTimer,
      scoutTimer: policyScoutTimer,
      flagshipTimer: policyFlagshipTimer,
      subTimers: {
        sub1: policySubTimers.sub1,
        sub2: policySubTimers.sub2,
      },
      intel: {
        searchZoneId: policySearchZoneId || null,
        knownContacts: policyKnownContactCount,
        visibleContacts,
        pendingContacts: policyPendingContactCount,
      },
      focus: capDebugContact(focus),
      context: capDebugContext(policyCurrentContext),
      searchCenter: copyPlainData(policyLastTacticalPlan?.searchCenter || null),
      combatCenter: copyPlainData(policyLastTacticalPlan?.combatCenter || null),
      searchAssignments: copyPlainData(policyLastTacticalPlan?.searchAssignments || null),
      sectorPlan: copyPlainData(policyLastTacticalPlan?.sectorPlan || null),
      shamisenHuntPlan: copyPlainData(policyLastTacticalPlan?.shamisenHuntPlan || null),
      detachedPlan: copyPlainData(policyLastTacticalPlan?.detachedPlan || null),
      orders: copyPlainData(policyLastTacticalPlan?.orders || {}),
      useSearchSectorPlan: Boolean(policyLastTacticalPlan?.useSearchSectorPlan),
      shouldUseDetachedRoles: Boolean(policyLastTacticalPlan?.shouldUseDetachedRoles),
      scoutDecision: {
        ...copyPlainData(policyLastScoutDecision),
        nextIn: policyScoutTimer,
      },
      scoutDoctrine: {
        mode: policyScoutDoctrine.mode,
        primaryZoneId: policyScoutDoctrine.primaryZoneId,
        committedUntil: policyScoutDoctrine.committedUntil,
        deployments: policyScoutDoctrine.deployments,
        lastPlan: copyPlainData(policyScoutDoctrine.lastPlan),
      },
      flagshipDecision: {
        ...copyPlainData(policyLastFlagshipDecision),
        nextIn: policyFlagshipTimer,
      },
      subSkillDecision: {
        sub1: {
          ...copyPlainData(policyLastSubSkillDecision.sub1),
          nextIn: policySubTimers.sub1,
        },
        sub2: {
          ...copyPlainData(policyLastSubSkillDecision.sub2),
          nextIn: policySubTimers.sub2,
        },
      },
      splitDecision: {
        ...copyPlainData(policyLastSplitDecision),
        level: policyObs.self.splitLevel,
      },
    };
  },
};
