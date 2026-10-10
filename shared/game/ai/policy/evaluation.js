// 战力估值与局部态势：接触与舰船的战力、局部优势、威胁、孤立度和射界交换。
// 这些方法安装在 RulePolicy 的原型上，经 this 访问观测、参数、随机流与策略状态。
import { CHARACTER_DEFS } from "../../characters.js";
import { clamp, distance } from "../../math.js";

export const evaluationMethods = {
  contactHpRatio(contact) {
    const V = this.params.value;
    const hp = Number(contact?.hp);
    const maxHp = Number(contact?.maxHp);
    if (Number.isFinite(hp) && Number.isFinite(maxHp) && maxHp > 0) {
      return clamp(hp / maxHp, V.contactHpMin, 1);
    }
    return contact?.kind === "scout" ? V.unknownScoutHp : contact?.kind === "wingman" ? V.unknownWingmanHp : V.unknownShipHp;
  },

  contactCombatValue(contact) {
    const V = this.params.value;
    if (!contact) {
      return 0;
    }
    const confidence = clamp(contact.confidence ?? 1, V.contactConfidenceMin, 1);
    if (contact.kind === "scout") {
      const baseValue = contact.combatCapable ? V.combatScout : V.scout;
      return baseValue * confidence * (contact.visible ? 1 : V.scoutHiddenFactor);
    }
    if (contact.kind === "wingman") {
      return V.wingman * this.contactHpRatio(contact) * confidence * (contact.visible ? 1 : V.wingmanHiddenFactor);
    }

    const stats = CHARACTER_DEFS[contact.characterId]?.stats || null;
    const roleFactor = contact.slotKey === "main" ? V.contactMainRole : V.contactSubRole;
    const rangeFactor = stats ? clamp(stats.range / V.rangeRef, V.rangeFactorMin, V.contactRangeFactorMax) : 1;
    const dpsFactor = stats ? clamp((stats.damage / Math.max(stats.fireRate, V.fireRateFloor)) / V.contactDpsRef, V.dpsFactorMin, V.contactDpsFactorMax) : 1;
    return roleFactor * rangeFactor * dpsFactor * (V.contactHpBase + V.contactHpWeight * this.contactHpRatio(contact)) * confidence * (contact.visible ? 1 : V.shipHiddenFactor);
  },

  shipCombatValue(ship) {
    const V = this.params.value;
    if (!ship || !ship.alive) {
      return 0;
    }
    const hpRatio = clamp(ship.hp / Math.max(ship.maxHp, 1), V.shipHpMin, 1);
    const energyRatio = clamp(ship.energy / Math.max(ship.maxEnergy, 1), 0, 1);
    const roleFactor = ship.key === "main" ? V.shipMainRole : ship.isAuxiliary ? V.shipAuxRole : 1;
    const rangeFactor = clamp(ship.stats.range / V.rangeRef, V.rangeFactorMin, V.shipRangeFactorMax);
    const dpsFactor = clamp((ship.stats.damage / Math.max(ship.stats.fireRate, V.fireRateFloor)) / V.shipDpsRef, V.dpsFactorMin, V.shipDpsFactorMax);
    return roleFactor * rangeFactor * dpsFactor * (V.shipHpBase + V.shipHpWeight * hpRatio) * (V.shipEnergyBase + V.shipEnergyWeight * energyRatio);
  },

  friendlyPowerAround(x, y, radius = 320) {
    const V = this.params.value;
    let total = 0;
    for (const ship of this.ownShips()) {
      if (!ship.alive) {
        continue;
      }
      const d = distance(ship.x, ship.y, x, y);
      if (d > radius * V.friendlyReach) {
        continue;
      }
      total += this.shipCombatValue(ship) * clamp(1 - d / Math.max(radius * V.friendlyReach, 1), V.friendlyShipFalloffMin, 1);
    }
    for (const wingman of this.obs.self.wingmen) {
      if (!wingman.alive) {
        continue;
      }
      const d = distance(wingman.x, wingman.y, x, y);
      if (d > radius * V.friendlyReach) {
        continue;
      }
      total += V.friendlyWingman * clamp(wingman.hp / Math.max(wingman.maxHp, 1), V.friendlyWingmanHpMin, 1) * clamp(1 - d / Math.max(radius * V.friendlyReach, 1), V.friendlyAircraftFalloffMin, 1);
    }
    for (const scout of this.obs.self.scouts) {
      if (!scout.alive || !scout.combatCapable) {
        continue;
      }
      const d = distance(scout.x, scout.y, x, y);
      if (d > radius * V.friendlyReach) {
        continue;
      }
      total += V.friendlyCombatScout * clamp(1 - d / Math.max(radius * V.friendlyReach, 1), V.friendlyAircraftFalloffMin, 1);
    }
    return total;
  },

  enemyThreatAround(x, y, radius = 320, maxAge = 8) {
    const V = this.params.value;
    let total = 0;
    for (const contact of this.knownEnemyContacts({ maxAge })) {
      const d = distance(contact.x, contact.y, x, y);
      if (d > radius * V.enemyReach) {
        continue;
      }
      total += this.contactCombatValue(contact) * clamp(1 - d / Math.max(radius * V.enemyReach, 1), V.enemyFalloffMin, 1);
    }
    return total;
  },

  enemyIsolationScore(contact, maxAge = 6) {
    const V = this.params.value;
    if (!contact) {
      return 0;
    }
    const nearbyThreat = this.enemyThreatAround(contact.x, contact.y, V.isolationRadius, maxAge) - this.contactCombatValue(contact);
    return clamp(V.isolationBase - nearbyThreat, V.isolationMin, V.isolationMax);
  },

  estimateVisionRange(contact) {
    if (!contact) {
      return 165;
    }
    if (contact.kind === "scout") {
      return contact.combatCapable ? CHARACTER_DEFS.yuki.stats.vision : 100;
    }
    if (contact.kind === "wingman") {
      return 100;
    }
    const stats = CHARACTER_DEFS[contact.characterId]?.stats;
    let value = stats?.vision || 165;
    if (contact.characterId === "yuki" && contact.slotKey && contact.slotKey !== "main") {
      value += 24;
    }
    return value;
  },

  shipVitality(ship) {
    const V = this.params.value;
    if (!ship || !ship.alive) {
      return {
        hpRatio: 0,
        energyRatio: 0,
        value: 0,
        fragile: true,
        healthy: false,
      };
    }
    const hpRatio = clamp(ship.hp / Math.max(ship.maxHp, 1), 0, 1);
    const energyRatio = clamp(ship.energy / Math.max(ship.maxEnergy, 1), 0, 1);
    const value = hpRatio * V.vitalityHp + energyRatio * V.vitalityEnergy;
    return {
      hpRatio,
      energyRatio,
      value,
      fragile: hpRatio < V.fragileHp || energyRatio < V.fragileEnergy,
      healthy: hpRatio >= V.healthyHp && energyRatio >= V.healthyEnergy,
    };
  },

  shipThreatSnapshot(ship, maxAge = 7) {
    const V = this.params.value;
    if (!ship || !ship.alive) {
      return {
        sources: 0,
        pressure: 0,
        friendlySupport: 0,
        danger: 0,
        overwhelmed: false,
      };
    }

    let sources = 0;
    let pressure = 0;
    for (const contact of this.knownEnemyContacts({ maxAge })) {
      if (contact.kind === "scout" && !contact.combatCapable) {
        continue;
      }
      const range = contact.kind === "ship"
        ? ((CHARACTER_DEFS[contact.characterId]?.stats?.range || V.threatDefaultRange) + V.threatRangeMargin)
        : contact.combatCapable
          ? CHARACTER_DEFS.yuki.stats.range + V.threatRangeMargin
          : V.threatAircraftRange;
      const d = distance(ship.x, ship.y, contact.x, contact.y);
      if (d > range) {
        continue;
      }
      sources += 1;
      pressure += this.contactCombatValue(contact) * clamp(1 - d / Math.max(range, 1), V.threatFalloffMin, 1);
    }

    const friendlySupport = Math.max(V.supportFloor, this.friendlyPowerAround(ship.x, ship.y, V.supportRadius) - this.shipCombatValue(ship) * V.supportSelfDiscount);
    const danger = pressure / friendlySupport;
    return {
      sources,
      pressure,
      friendlySupport,
      danger,
      overwhelmed: sources >= 2 && danger > V.overwhelmedDanger,
    };
  },

  escapeTargetForShip(ship, anchorX, anchorY, maxAge = 7) {
    if (!ship || !ship.alive) {
      return null;
    }
    const hostiles = this.knownEnemyContacts({ maxAge }).filter((contact) => {
      if (contact.kind === "scout" && !contact.combatCapable) {
        return false;
      }
      return distance(ship.x, ship.y, contact.x, contact.y) <= 360;
    });
    if (hostiles.length === 0) {
      return null;
    }

    let sumX = 0;
    let sumY = 0;
    let weightTotal = 0;
    for (const hostile of hostiles) {
      const weight = this.contactCombatValue(hostile) * clamp(1.2 - this.contactHpRatio(hostile) * 0.2, 0.8, 1.3);
      sumX += hostile.x * weight;
      sumY += hostile.y * weight;
      weightTotal += weight;
    }
    const centerX = weightTotal > 0 ? sumX / weightTotal : ship.x;
    const centerY = weightTotal > 0 ? sumY / weightTotal : ship.y;
    const awayX = ship.x - centerX;
    const awayY = ship.y - centerY;
    const awayLen = Math.max(1, Math.hypot(awayX, awayY));
    const anchorDx = anchorX - ship.x;
    const anchorDy = anchorY - ship.y;
    const anchorLen = Math.max(1, Math.hypot(anchorDx, anchorDy));
    const safeReach = clamp(210 + hostiles.length * 18, 210, 320);
    return {
      x: this.clampX(ship.x + (awayX / awayLen) * safeReach + (anchorDx / anchorLen) * 90, this.safeRoutePadding(14)),
      y: this.clampY(ship.y + (awayY / awayLen) * safeReach + (anchorDy / anchorLen) * 90, this.safeRoutePadding(14)),
      hostiles,
    };
  },

  evaluateArcExchange(ship, enemyEstimate, candidate, exposureWeight = 1) {
    if (!ship || !enemyEstimate || !candidate) {
      return {
        ownDensity: 1,
        enemyDensity: 1,
        score: 0,
      };
    }

    const intentAngle = Number.isFinite(candidate.intentAngle)
      ? candidate.intentAngle
      : Math.atan2(candidate.y - ship.y, candidate.x - ship.x);
    const enemyFacing = Number.isFinite(candidate.enemyFacingAngle) ? candidate.enemyFacingAngle : enemyEstimate.angle;
    const ownDensity = this.arcDensityFromState(
      intentAngle,
      candidate.x,
      candidate.y,
      enemyEstimate.x,
      enemyEstimate.y,
      this.obs.self.flags.kyonFlagship,
    );
    const enemyDensity = this.arcDensityFromState(
      enemyFacing,
      enemyEstimate.x,
      enemyEstimate.y,
      candidate.x,
      candidate.y,
      this.obs.privileged.enemyHasKyonFlagship,
    );
    const edgePenalty = clamp((150 - this.pointEdgeClearance(candidate.x, candidate.y)) / 150, 0, 1) * 0.55;
    const preferredRange = Number.isFinite(candidate.preferredRange) ? candidate.preferredRange : ship.stats.range * 0.9;
    const actualRange = distance(candidate.x, candidate.y, enemyEstimate.x, enemyEstimate.y);
    const rangePenalty = Math.abs(actualRange - preferredRange) / Math.max(preferredRange, 1);
    return {
      ownDensity,
      enemyDensity,
      score: ownDensity * 1.35 - enemyDensity * exposureWeight - edgePenalty - rangePenalty * 0.3,
    };
  },

  preferredFlankSign(main, contact) {
    if (!contact) {
      return this.searchSweepSign;
    }
    const enemyForward = { x: Math.cos(contact.angle), y: Math.sin(contact.angle) };
    const enemySide = { x: -enemyForward.y, y: enemyForward.x };
    const sideOffset = clamp(main.stats.range * 0.82, 180, 320);
    const rearOffset = clamp(main.stats.range * 0.22, 55, 130);
    let bestSign = this.searchSweepSign;
    let bestScore = -Infinity;
    for (const sign of [1, -1]) {
      const candidate = {
        x: this.clampX(contact.x - enemyForward.x * rearOffset + enemySide.x * sideOffset * sign, this.safeRoutePadding()),
        y: this.clampY(contact.y - enemyForward.y * rearOffset + enemySide.y * sideOffset * sign, this.safeRoutePadding()),
      };
      candidate.intentAngle = this.broadsideIntentAngle(candidate.x, candidate.y, contact.x, contact.y, sign);
      candidate.preferredRange = clamp(main.stats.range * 0.86, 180, 340);
      const exchange = this.evaluateArcExchange(main, contact, candidate, 1.2);
      const clearanceBias = this.pointEdgeClearance(candidate.x, candidate.y) / 220;
      const score = exchange.score + clearanceBias;
      if (score > bestScore) {
        bestScore = score;
        bestSign = sign;
      }
    }
    return bestSign;
  },
};
