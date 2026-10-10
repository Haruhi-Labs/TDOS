// 调试状态序列化：供推演页展示决策中间量，结构保持稳定。
// 这些方法安装在 RulePolicy 的原型上，经 this 访问观测、参数、随机流与策略状态。

export const debugStateMethods = {
  debugPoint(point) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return null;
    }
    return {
      x: point.x,
      y: point.y,
      zoneId: Number.isFinite(point.zoneId) ? point.zoneId : this.zoneForPoint(point.x, point.y).id,
      intentAngle: Number.isFinite(point.intentAngle) ? point.intentAngle : null,
      preferredRange: Number.isFinite(point.preferredRange) ? point.preferredRange : null,
    };
  },

  debugPointMap(plan) {
    if (!plan) {
      return null;
    }
    const output = {};
    for (const [key, point] of Object.entries(plan)) {
      output[key] = this.debugPoint(point);
    }
    return output;
  },

  debugContact(contact) {
    if (!contact) {
      return null;
    }
    const age = Number.isFinite(contact.age) ? contact.age : Math.max(0, this.obs.time - (contact.seenAt || this.obs.time));
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
      zoneId: Number.isFinite(contact.zoneId) ? contact.zoneId : this.zoneForPoint(contact.x, contact.y).id,
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

  debugThreatMap(shipThreats) {
    const output = {};
    if (!(shipThreats instanceof Map)) {
      return output;
    }
    for (const [key, threat] of shipThreats.entries()) {
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

  debugContext(context) {
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
      shipThreats: this.debugThreatMap(context.shipThreats),
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

  debugDetachedPlan(plan) {
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

  serializeDebugState() {
    const focus = this.currentContext?.focus || this.lastTacticalPlan?.focus || this.enemyIntel.main;
    let visibleContacts = 0;
    for (const contact of this.enemyIntel.entities.values()) {
      const age = this.obs.time - contact.seenAt;
      if ((contact.source === "visible" || age <= 0.6) && age <= 1.2) {
        visibleContacts += 1;
      }
    }
    return {
      seat: this.seat,
      mode: this.mode,
      modeTimer: this.modeTimer,
      moveTimer: this.moveTimer,
      scoutTimer: this.scoutTimer,
      flagshipTimer: this.flagshipTimer,
      subTimers: {
        sub1: this.subTimers.sub1,
        sub2: this.subTimers.sub2,
      },
      intel: {
        searchZoneId: this.enemyIntel.searchZoneId || null,
        knownContacts: this.enemyIntel.entities.size,
        visibleContacts,
        pendingContacts: this.pendingSightings.size,
      },
      focus: this.debugContact(focus),
      context: this.debugContext(this.currentContext),
      searchCenter: this.lastTacticalPlan?.searchCenter || null,
      combatCenter: this.lastTacticalPlan?.combatCenter || null,
      searchAssignments: this.lastTacticalPlan?.searchAssignments || null,
      sectorPlan: this.lastTacticalPlan?.sectorPlan || null,
      shamisenHuntPlan: this.lastTacticalPlan?.shamisenHuntPlan || null,
      detachedPlan: this.lastTacticalPlan?.detachedPlan || null,
      orders: this.lastTacticalPlan?.orders || {},
      useSearchSectorPlan: Boolean(this.lastTacticalPlan?.useSearchSectorPlan),
      shouldUseDetachedRoles: Boolean(this.lastTacticalPlan?.shouldUseDetachedRoles),
      scoutDecision: {
        ...this.lastScoutDecision,
        nextIn: this.scoutTimer,
      },
      scoutDoctrine: {
        mode: this.scoutDoctrine.mode,
        primaryZoneId: this.scoutDoctrine.primaryZoneId,
        committedUntil: this.scoutDoctrine.committedUntil,
        deployments: this.scoutDoctrine.deployments,
        lastPlan: this.scoutDoctrine.lastPlan,
      },
      flagshipDecision: {
        ...this.lastFlagshipDecision,
        nextIn: this.flagshipTimer,
      },
      subSkillDecision: {
        sub1: {
          ...this.lastSubSkillDecision.sub1,
          nextIn: this.subTimers.sub1,
        },
        sub2: {
          ...this.lastSubSkillDecision.sub2,
          nextIn: this.subTimers.sub2,
        },
      },
      splitDecision: {
        ...this.lastSplitDecision,
        level: this.obs.self.splitLevel,
      },
    };
  },
};
