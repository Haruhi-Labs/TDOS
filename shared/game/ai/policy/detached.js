// 分离舰的角色分配与各角色的站位指令。
// 这些方法安装在 RulePolicy 的原型上，经 this 访问观测、参数、随机流与策略状态。
import {
  clamp,
  distance,
  lerp,
  shortestAngleDelta,
} from "../../math.js";
import { koizumiBarrierRoleDirective } from "./tactics/character-counterplay.js";
import { characterProfile } from "./characters/index.js";

export const detachedMethods = {
  chooseDetachedIntelLead(detachedShips, enemyEstimate, context) {
    const D = this.params.detached.intelLead;
    if (!enemyEstimate || !detachedShips.length) {
      return null;
    }
    let best = null;
    let bestScore = -Infinity;
    const enemyVision = this.estimateVisionRange(enemyEstimate);
    for (const ship of detachedShips) {
      const vitality = this.shipVitality(ship);
      if (vitality.fragile) {
        continue;
      }
      const visionMargin = ship.stats.vision - enemyVision;
      const score = vitality.value
        + clamp(visionMargin / D.visionMarginScale, D.visionMarginMin, D.visionMarginMax)
        + clamp((ship.stats.vision - D.visionBase) / D.visionScale, 0, D.visionMax)
        + clamp((ship.stats.baseSpeed - D.speedBase) / D.speedScale, D.speedMin, D.speedMax)
        + (characterProfile(ship.characterId).intelLeadBias?.(D) ?? 0)
        + (context?.searchRequired || context?.trackableIntel ? D.searchBias : 0);
      if (score > bestScore) {
        bestScore = score;
        best = ship;
      }
    }
    return bestScore > D.minScore ? best : null;
  },

  detachedRetreatNeed(ship, enemyEstimate, context) {
    const D = this.params.detached.retreat;
    if (!ship || !ship.alive || !enemyEstimate || !context) {
      return 0;
    }
    const vitality = this.shipVitality(ship);
    const dist = distance(ship.x, ship.y, enemyEstimate.x, enemyEstimate.y);
    return clamp(
      (D.hpCeiling - vitality.hpRatio) * D.hpWeight
      + (D.energyCeiling - vitality.energyRatio) * D.energyWeight
      + (dist < ship.stats.range * D.closeRange ? D.close : 0)
      + (context.enemyBroadsideRisk ? D.enemyBroadsideRisk : 0)
      + (context.defensivePressure ? D.defensivePressure : 0),
      0,
      D.max,
    );
  },

  planDetachedRoles(main, enemyEstimate, context) {
    const detachedShips = [this.obs.self.ships.sub1, this.obs.self.ships.sub2].filter((ship) => ship.alive && !ship.attached);
    const preferredSign = context?.flankSign || this.preferredFlankSign(main, enemyEstimate);
    const intelLead = this.chooseDetachedIntelLead(detachedShips, enemyEstimate, context);
    let retreatShip = null;
    let retreatScore = 0.72;
    for (const ship of detachedShips) {
      const score = this.detachedRetreatNeed(ship, enemyEstimate, context);
      if (score > retreatScore && (!intelLead || ship.id !== intelLead.id)) {
        retreatScore = score;
        retreatShip = ship;
      }
    }

    const plan = {
      intelLeadKey: intelLead?.key || null,
      retreatKey: retreatShip?.key || null,
      laneSigns: {},
      roles: {},
    };

    for (const ship of detachedShips) {
      if (context?.barrierTactics?.breachShipKey === ship.key) {
        plan.roles[ship.key] = "breach";
      } else if (context?.barrierTactics?.infiltration?.shipKeys?.includes(ship.key)) {
        plan.roles[ship.key] = "infiltrate";
      } else if (intelLead && ship.id === intelLead.id) {
        plan.roles[ship.key] = "intel";
      } else if (retreatShip && ship.id === retreatShip.id) {
        plan.roles[ship.key] = "rear";
      } else if (characterProfile(ship.characterId).detachedDefaultRole === "flank") {
        plan.roles[ship.key] = "flank";
      } else if (this.shipVitality(ship).healthy && ((context?.pressureDrive || 0) > 0.42 || (context?.isolatedTargetScore || 0) > 0.34)) {
        plan.roles[ship.key] = "front";
      } else {
        plan.roles[ship.key] = (context?.pressureDrive || 0) > 0.72 ? "flank" : "fire";
      }
    }

    let nextSign = preferredSign;
    for (const ship of detachedShips) {
      if (plan.roles[ship.key] === "rear") {
        plan.laneSigns[ship.key] = -preferredSign;
        continue;
      }
      plan.laneSigns[ship.key] = nextSign;
      nextSign *= -1;
    }
    return plan;
  },

  computeDetachedDirective(ship, role, enemyEstimate, context, main, mainTarget, laneSign = 1) {
    if (!ship || !ship.alive || !enemyEstimate) {
      return null;
    }
    const toEnemyX = enemyEstimate.x - main.x;
    const toEnemyY = enemyEstimate.y - main.y;
    const len = Math.max(1, Math.hypot(toEnemyX, toEnemyY));
    const toward = { x: toEnemyX / len, y: toEnemyY / len };
    const side = { x: -toward.y, y: toward.x };
    const enemyForward = { x: Math.cos(enemyEstimate.angle), y: Math.sin(enemyEstimate.angle) };
    const enemySide = { x: -enemyForward.y, y: enemyForward.x };
    const vitality = this.shipVitality(ship);
    const threat = this.shipThreatSnapshot(ship, 7);
    const ownVision = ship.stats.vision;
    const enemyVision = this.estimateVisionRange(enemyEstimate);
    const blindLower = enemyVision + 16;
    const blindUpper = ownVision - 8;
    const mainAngle = Math.atan2(mainTarget.y - enemyEstimate.y, mainTarget.x - enemyEstimate.x);
    const preferredRange = clamp(ship.stats.range * 0.9, 170, 380);
    const emergencyEscape = threat.overwhelmed || (threat.danger > 1.18 && role !== "intel");

    const barrierDirective = koizumiBarrierRoleDirective(
      ship,
      role,
      enemyEstimate,
      context?.barrierTactics,
      laneSign,
    );
    if (barrierDirective) {
      return barrierDirective;
    }

    if (emergencyEscape) {
      const escape = this.escapeTargetForShip(ship, main.x, main.y, 7);
      if (escape) {
        return {
          target: {
            x: escape.x,
            y: escape.y,
            intentAngle: Math.atan2(enemyEstimate.y - escape.y, enemyEstimate.x - escape.x),
            preferredRange: clamp(ship.stats.range * 1.08, 220, 420),
          },
          throttle: { min: 1.04, max: 1.2 },
          role: "escape",
        };
      }
    }

    const scoreCandidate = (candidate, exposureWeight) => {
      const exchange = this.evaluateArcExchange(ship, enemyEstimate, candidate, exposureWeight);
      const candidateDist = distance(candidate.x, candidate.y, enemyEstimate.x, enemyEstimate.y);
      const candidateAngle = Math.atan2(candidate.y - enemyEstimate.y, candidate.x - enemyEstimate.x);
      const spread = Math.abs(shortestAngleDelta(candidateAngle, mainAngle));
      let score = exchange.score;

      if (role === "intel") {
        if (blindUpper > blindLower) {
          if (candidateDist >= blindLower && candidateDist <= blindUpper) {
            score += 1.35;
          }
          if (candidateDist < enemyVision + 6) {
            score -= 1.55;
          }
          if (candidateDist > ownVision - 4) {
            score -= 1.1;
          }
        } else {
          score += clamp((ownVision - candidateDist) / 80, -0.5, 0.5);
        }
        score += clamp(spread / 1.7, 0, 0.5);
        score += clamp(distance(candidate.x, candidate.y, main.x, main.y) / 280, 0, 0.55);
      } else if (role === "rear") {
        score += candidateDist > distance(mainTarget.x, mainTarget.y, enemyEstimate.x, enemyEstimate.y) + 26 ? 0.72 : -0.65;
        score += exchange.enemyDensity <= 1 ? 0.34 : -0.42;
        score += vitality.hpRatio < 0.35 ? 0.24 : 0;
      } else if (role === "fire") {
        score += clamp(spread / 1.55, 0, 0.82);
        score += candidateDist >= ship.stats.range * 0.72 && candidateDist <= ship.stats.range * 1.02 ? 0.4 : -0.16;
      } else if (role === "flank") {
        const rearBias = -Math.cos(shortestAngleDelta(candidateAngle, enemyEstimate.angle));
        score += clamp(spread / 1.4, 0, 0.98);
        score += candidateDist <= ship.stats.range * 0.9 ? 0.34 : 0;
        score += clamp(rearBias * 0.7, -0.18, 0.8);
      } else if (role === "front") {
        score += candidateDist < distance(mainTarget.x, mainTarget.y, enemyEstimate.x, enemyEstimate.y) - 16 ? 0.42 : -0.08;
        score += candidateDist <= ship.stats.range * 0.94 ? 0.3 : -0.12;
      }
      return score;
    };

    const pickBest = (candidates, exposureWeight = 1.18) => {
      let best = null;
      let bestScore = -Infinity;
      for (const item of candidates) {
        const candidate = {
          ...item,
          x: this.clampX(item.x, this.safeRoutePadding(10)),
          y: this.clampY(item.y, this.safeRoutePadding(10)),
        };
        const score = scoreCandidate(candidate, exposureWeight);
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      return best || candidates[0];
    };

    let candidates = [];
    let throttle = { min: 0.76, max: 1.02 };
    if (role === "intel") {
      const fallbackMax = Math.max(150, Math.min(ownVision, preferredRange));
      const scoutRange = blindUpper > blindLower
        ? clamp(lerp(blindLower, blindUpper, 0.52), blindLower, blindUpper)
        : Math.min(Math.max(enemyVision + 22, 150), fallbackMax);
      const sideOffset = clamp(140 + Math.max(0, ownVision - enemyVision) * 1.1, 140, 260);
      candidates = [
        {
          x: enemyEstimate.x - enemyForward.x * scoutRange + enemySide.x * laneSign * sideOffset,
          y: enemyEstimate.y - enemyForward.y * scoutRange + enemySide.y * laneSign * sideOffset,
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - enemyForward.y * scoutRange + enemySide.y * laneSign * sideOffset), enemyEstimate.x - (enemyEstimate.x - enemyForward.x * scoutRange + enemySide.x * laneSign * sideOffset)),
          preferredRange: scoutRange,
        },
        {
          x: enemyEstimate.x - toward.x * scoutRange + side.x * laneSign * (sideOffset * 1.08),
          y: enemyEstimate.y - toward.y * scoutRange + side.y * laneSign * (sideOffset * 1.08),
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - toward.y * scoutRange + side.y * laneSign * (sideOffset * 1.08)), enemyEstimate.x - (enemyEstimate.x - toward.x * scoutRange + side.x * laneSign * (sideOffset * 1.08))),
          preferredRange: scoutRange,
        },
        {
          x: enemyEstimate.x - enemyForward.x * (scoutRange * 0.88) - enemySide.x * laneSign * (sideOffset * 0.54),
          y: enemyEstimate.y - enemyForward.y * (scoutRange * 0.88) - enemySide.y * laneSign * (sideOffset * 0.54),
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - enemyForward.y * (scoutRange * 0.88) - enemySide.y * laneSign * (sideOffset * 0.54)), enemyEstimate.x - (enemyEstimate.x - enemyForward.x * (scoutRange * 0.88) - enemySide.x * laneSign * (sideOffset * 0.54))),
          preferredRange: scoutRange * 0.94,
        },
      ];
      throttle = {
        min: context?.searchRequired || context?.trackableIntel ? 0.94 : 0.84,
        max: context?.searchRequired || context?.trackableIntel ? 1.12 : 1.02,
      };
    } else if (role === "rear") {
      const safeRange = clamp(ship.stats.range * 1.04 + (0.6 - vitality.hpRatio) * 110, 220, 460);
      candidates = [
        {
          x: enemyEstimate.x - toward.x * safeRange + side.x * laneSign * 170,
          y: enemyEstimate.y - toward.y * safeRange + side.y * laneSign * 170,
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - toward.y * safeRange + side.y * laneSign * 170), enemyEstimate.x - (enemyEstimate.x - toward.x * safeRange + side.x * laneSign * 170)),
          preferredRange: safeRange,
        },
        {
          x: mainTarget.x - toward.x * 70 + side.x * laneSign * 155,
          y: mainTarget.y - toward.y * 70 + side.y * laneSign * 155,
          intentAngle: Math.atan2(enemyEstimate.y - (mainTarget.y - toward.y * 70 + side.y * laneSign * 155), enemyEstimate.x - (mainTarget.x - toward.x * 70 + side.x * laneSign * 155)),
          preferredRange: safeRange * 0.92,
        },
      ];
      throttle = { min: 0.58, max: 0.84 };
    } else if (role === "flank") {
      const strikeRange = clamp(ship.stats.range * 0.72, 130, 280);
      candidates = [
        {
          x: enemyEstimate.x - enemyForward.x * 48 + enemySide.x * laneSign * 220,
          y: enemyEstimate.y - enemyForward.y * 48 + enemySide.y * laneSign * 220,
          intentAngle: this.broadsideIntentAngle(
            enemyEstimate.x - enemyForward.x * 48 + enemySide.x * laneSign * 220,
            enemyEstimate.y - enemyForward.y * 48 + enemySide.y * laneSign * 220,
            enemyEstimate.x,
            enemyEstimate.y,
            laneSign,
          ),
          preferredRange: strikeRange,
        },
        {
          x: enemyEstimate.x + enemyForward.x * 46 + enemySide.x * laneSign * 165,
          y: enemyEstimate.y + enemyForward.y * 46 + enemySide.y * laneSign * 165,
          intentAngle: this.broadsideIntentAngle(
            enemyEstimate.x + enemyForward.x * 46 + enemySide.x * laneSign * 165,
            enemyEstimate.y + enemyForward.y * 46 + enemySide.y * laneSign * 165,
            enemyEstimate.x,
            enemyEstimate.y,
            laneSign,
          ),
          preferredRange: strikeRange * 0.88,
        },
        {
          x: enemyEstimate.x - enemyForward.x * 210 + enemySide.x * laneSign * 150,
          y: enemyEstimate.y - enemyForward.y * 210 + enemySide.y * laneSign * 150,
          intentAngle: this.broadsideIntentAngle(
            enemyEstimate.x - enemyForward.x * 210 + enemySide.x * laneSign * 150,
            enemyEstimate.y - enemyForward.y * 210 + enemySide.y * laneSign * 150,
            enemyEstimate.x,
            enemyEstimate.y,
            laneSign,
          ),
          preferredRange: strikeRange * 1.04,
        },
        {
          x: enemyEstimate.x - enemyForward.x * 240 - enemySide.x * laneSign * 46,
          y: enemyEstimate.y - enemyForward.y * 240 - enemySide.y * laneSign * 46,
          intentAngle: Math.atan2(
            enemyEstimate.y - (enemyEstimate.y - enemyForward.y * 240 - enemySide.y * laneSign * 46),
            enemyEstimate.x - (enemyEstimate.x - enemyForward.x * 240 - enemySide.x * laneSign * 46),
          ),
          preferredRange: strikeRange * 1.06,
        },
        {
          x: enemyEstimate.x - toward.x * strikeRange + side.x * laneSign * 210,
          y: enemyEstimate.y - toward.y * strikeRange + side.y * laneSign * 210,
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - toward.y * strikeRange + side.y * laneSign * 210), enemyEstimate.x - (enemyEstimate.x - toward.x * strikeRange + side.x * laneSign * 210)),
          preferredRange: strikeRange,
        },
      ];
      throttle = { min: 0.98, max: 1.18 };
    } else if (role === "front") {
      const screenRange = clamp(Math.max(enemyVision + 12, ship.stats.range * 0.78), 150, 320);
      candidates = [
        {
          x: enemyEstimate.x - toward.x * screenRange + side.x * laneSign * 120,
          y: enemyEstimate.y - toward.y * screenRange + side.y * laneSign * 120,
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - toward.y * screenRange + side.y * laneSign * 120), enemyEstimate.x - (enemyEstimate.x - toward.x * screenRange + side.x * laneSign * 120)),
          preferredRange: screenRange,
        },
        {
          x: enemyEstimate.x - enemyForward.x * (screenRange * 0.84) + enemySide.x * laneSign * 175,
          y: enemyEstimate.y - enemyForward.y * (screenRange * 0.84) + enemySide.y * laneSign * 175,
          intentAngle: this.broadsideIntentAngle(
            enemyEstimate.x - enemyForward.x * (screenRange * 0.84) + enemySide.x * laneSign * 175,
            enemyEstimate.y - enemyForward.y * (screenRange * 0.84) + enemySide.y * laneSign * 175,
            enemyEstimate.x,
            enemyEstimate.y,
            laneSign,
          ),
          preferredRange: screenRange,
        },
      ];
      throttle = { min: 0.96, max: 1.14 };
    } else {
      const supportRange = clamp(ship.stats.range * 0.94, 180, 360);
      candidates = [
        {
          x: enemyEstimate.x - enemyForward.x * 72 + enemySide.x * laneSign * 210,
          y: enemyEstimate.y - enemyForward.y * 72 + enemySide.y * laneSign * 210,
          intentAngle: this.broadsideIntentAngle(
            enemyEstimate.x - enemyForward.x * 72 + enemySide.x * laneSign * 210,
            enemyEstimate.y - enemyForward.y * 72 + enemySide.y * laneSign * 210,
            enemyEstimate.x,
            enemyEstimate.y,
            laneSign,
          ),
          preferredRange: supportRange,
        },
        {
          x: enemyEstimate.x - toward.x * supportRange + side.x * laneSign * 155,
          y: enemyEstimate.y - toward.y * supportRange + side.y * laneSign * 155,
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - toward.y * supportRange + side.y * laneSign * 155), enemyEstimate.x - (enemyEstimate.x - toward.x * supportRange + side.x * laneSign * 155)),
          preferredRange: supportRange,
        },
        {
          x: mainTarget.x + side.x * laneSign * 92 - toward.x * 36,
          y: mainTarget.y + side.y * laneSign * 92 - toward.y * 36,
          intentAngle: Math.atan2(enemyEstimate.y - (mainTarget.y + side.y * laneSign * 92 - toward.y * 36), enemyEstimate.x - (mainTarget.x + side.x * laneSign * 92 - toward.x * 36)),
          preferredRange: supportRange * 0.94,
        },
      ];
      throttle = { min: 0.84, max: 1.08 };
    }

    return {
      target: pickBest(candidates, role === "rear" ? 1.4 : role === "intel" ? 1.26 : 1.12),
      throttle,
      role,
    };
  },
};
