// 主舰目标点：搜索、包围与各走位模式的候选点，以及视野交火距离修正。
// 这些方法安装在 RulePolicy 的原型上，经 this 访问观测、参数、随机流与策略状态。
import { clamp, distance, lerp } from "../../math.js";

export const targetsMethods = {
  acquireSearchCenter(main, enemyEstimate = null) {
    // 看得见敌人→直接以其所在战区为中心
    if (enemyEstimate && enemyEstimate.visible && enemyEstimate.zoneId) {
      this.enemyIntel.searchZoneId = enemyEstimate.zoneId;
      return this.zoneCenter(enemyEstimate.zoneId);
    }

    // 看不见→去 belief 占据图的"最高概率(且未被排除)区域"——类人:持续预测+排除看过的+缩小可能区
    const peak = this.beliefPeak();
    if (peak) {
      const zone = this.zoneForPoint(peak.x, peak.y);
      if (zone) this.enemyIntel.searchZoneId = zone.id;
      return { zoneId: this.enemyIntel.searchZoneId || 5, x: peak.x, y: peak.y };
    }

    if (!this.enemyIntel.searchZoneId) {
      this.enemyIntel.searchZoneId = this.searchOrder[this.searchCursor % this.searchOrder.length];
      this.searchCursor = (this.searchCursor + 1) % this.searchOrder.length;
    }

    const current = this.zoneCenter(this.enemyIntel.searchZoneId);
    if (
      distance(main.x, main.y, current.x, current.y) <= this.profile.searchArrivalRadius
      || this.obs.time - this.lastSearchAdvanceAt > this.profile.searchAdvanceWindow
    ) {
      this.enemyIntel.searchZoneId = this.searchOrder[this.searchCursor % this.searchOrder.length];
      this.searchCursor = (this.searchCursor + 1) % this.searchOrder.length;
      this.searchSweepSign *= -1;
      this.lastSearchAdvanceAt = this.obs.time;
    }

    return this.zoneCenter(this.enemyIntel.searchZoneId);
  },

  combatCenter(enemyEstimate) {
    const worldCenter = this.obs.world.size * 0.5;
    return {
      x: lerp(worldCenter, enemyEstimate.x, 0.24),
      y: lerp(worldCenter, enemyEstimate.y, 0.24),
    };
  },

  computeRecoveryTarget(main, enemyEstimate) {
    const padding = this.safeRoutePadding(24);
    const worldSize = this.obs.world.size;
    const inwardX = clamp(main.x, padding, worldSize - padding);
    const inwardY = clamp(main.y, padding, worldSize - padding);
    const toEnemyX = enemyEstimate.x - main.x;
    const toEnemyY = enemyEstimate.y - main.y;
    const len = Math.max(1, Math.hypot(toEnemyX, toEnemyY));
    const towardX = toEnemyX / len;
    const towardY = toEnemyY / len;

    return {
      x: clamp(lerp(main.x, inwardX, 0.92) + towardX * 150, padding, worldSize - padding),
      y: clamp(lerp(main.y, inwardY, 0.92) + towardY * 150, padding, worldSize - padding),
    };
  },

  computeSearchTarget(main, enemyEstimate, searchCenter) {
    // 直奔 belief 占据图给出的最高概率区(searchCenter 已含"预测扩散+排除看过的")，
    // 仅叠加小幅横扫提升覆盖。不再按"敌朝向"额外外推——belief 已含预测，再外推会把搜索带偏
    // (静止/朝我之敌会被推过头而错过)，这正是原搜索找不到龟缩敌人的根因。
    const visible = enemyEstimate && enemyEstimate.visible;
    if (visible) {
      // 看得见时(罕见进此分支)：贴近其估计位置
      const t = Math.atan2(enemyEstimate.y - main.y, enemyEstimate.x - main.x);
      const sweep = this.searchSweepSign * 90;
      return {
        x: enemyEstimate.x + Math.cos(t + Math.PI * 0.5) * sweep,
        y: enemyEstimate.y + Math.sin(t + Math.PI * 0.5) * sweep,
      };
    }
    const unc = enemyEstimate ? (enemyEstimate.uncertainty || 0) : 90;
    const spread = clamp(64 + unc * 0.4, 64, 190);
    const toward = Math.atan2(searchCenter.y - main.y, searchCenter.x - main.x);
    const perp = toward + Math.PI * 0.5;
    const sweepOffset = this.searchSweepSign * spread * 0.34;
    return {
      x: searchCenter.x + Math.cos(perp) * sweepOffset + this.rng.range(-spread * 0.14, spread * 0.14),
      y: searchCenter.y + Math.sin(perp) * sweepOffset + this.rng.range(-spread * 0.14, spread * 0.14),
    };
  },

  computeSearchAssignments(main, focus, searchCenter) {
    const basisAngle = Number.isFinite(focus?.angle)
      ? focus.angle
      : Math.atan2(searchCenter.y - main.y, searchCenter.x - main.x);
    const sideAngle = basisAngle + Math.PI * 0.5;
    const zoneSpan = this.obs.world.size / 3;
    const spawnFactor = focus?.source === "spawn" ? 1.48 : 1;
    const wingReach = clamp((zoneSpan * 0.54 + (focus?.uncertainty || 0) * 0.32) * spawnFactor, 160, 430);
    const forwardReach = clamp((zoneSpan * 0.36 + (focus?.uncertainty || 0) * 0.22) * (focus?.source === "spawn" ? 1.16 : 1), 120, 300);
    const feintBias = this.searchSweepSign * clamp(zoneSpan * (focus?.source === "spawn" ? 0.22 : 0.14), 54, 150);

    return {
      main: {
        x: searchCenter.x + Math.cos(sideAngle) * feintBias,
        y: searchCenter.y + Math.sin(sideAngle) * feintBias,
      },
      sub1: {
        x: searchCenter.x - Math.cos(sideAngle) * wingReach + Math.cos(basisAngle) * forwardReach,
        y: searchCenter.y - Math.sin(sideAngle) * wingReach + Math.sin(basisAngle) * forwardReach,
      },
      sub2: {
        x: searchCenter.x + Math.cos(sideAngle) * wingReach + Math.cos(basisAngle) * forwardReach,
        y: searchCenter.y + Math.sin(sideAngle) * wingReach + Math.sin(basisAngle) * forwardReach,
      },
    };
  },

  computeSectorEncirclement(main, focus, searchCenter, pressure = 1) {
    const target = focus || searchCenter;
    const basisAngle = Number.isFinite(focus?.angle)
      ? focus.angle
      : Math.atan2(searchCenter.y - main.y, searchCenter.x - main.x);
    const sideAngle = basisAngle + Math.PI * 0.5;
    const uncertainty = focus?.uncertainty || 0;
    const forwardReach = clamp(main.stats.range * (0.7 + pressure * 0.18) + uncertainty * 0.42, 190, 430);
    const wingReach = clamp(main.stats.range * 0.56 + uncertainty * 0.42 + pressure * 56, 165, 390);
    const centerReach = clamp(forwardReach * 0.86, 150, 360);
    const mainBias = this.searchSweepSign * clamp(54 + uncertainty * 0.1, 54, 118);

    return {
      main: {
        x: target.x + Math.cos(basisAngle) * centerReach + Math.cos(sideAngle) * mainBias,
        y: target.y + Math.sin(basisAngle) * centerReach + Math.sin(sideAngle) * mainBias,
      },
      sub1: {
        x: target.x + Math.cos(basisAngle) * forwardReach - Math.cos(sideAngle) * wingReach,
        y: target.y + Math.sin(basisAngle) * forwardReach - Math.sin(sideAngle) * wingReach,
      },
      sub2: {
        x: target.x + Math.cos(basisAngle) * forwardReach + Math.cos(sideAngle) * wingReach,
        y: target.y + Math.sin(basisAngle) * forwardReach + Math.sin(sideAngle) * wingReach,
      },
    };
  },

  computeMainTarget(mode, main, enemyEstimate, center) {
    const toEnemyX = enemyEstimate.x - main.x;
    const toEnemyY = enemyEstimate.y - main.y;
    const len = Math.max(1, Math.hypot(toEnemyX, toEnemyY));
    const toward = { x: toEnemyX / len, y: toEnemyY / len };
    const side = { x: -toward.y, y: toward.x };
    const enemyForward = { x: Math.cos(enemyEstimate.angle), y: Math.sin(enemyEstimate.angle) };
    const enemySide = { x: -enemyForward.y, y: enemyForward.x };
    const broadsideSign = this.preferredFlankSign(main, enemyEstimate);
    const preferredRange = clamp(main.stats.range * 0.88, 180, 340);

    const pickBest = (candidates, exposureWeight = 1) => {
      let best = null;
      let bestScore = -Infinity;
      for (const item of candidates) {
        const candidate = {
          ...item,
          x: this.clampX(item.x, this.safeRoutePadding()),
          y: this.clampY(item.y, this.safeRoutePadding()),
        };
        const exchange = this.evaluateArcExchange(main, enemyEstimate, candidate, exposureWeight);
        if (exchange.score > bestScore) {
          bestScore = exchange.score;
          best = candidate;
        }
      }
      return best || candidates[0];
    };

    if (mode === "recover") {
      return this.computeRecoveryTarget(main, enemyEstimate);
    }
    if (mode === "harvest") {
      const conserveRange = clamp(main.stats.range * 1.22, 240, 420);
      return pickBest([
        {
          x: enemyEstimate.x - toward.x * conserveRange + side.x * 130,
          y: enemyEstimate.y - toward.y * conserveRange + side.y * 130,
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - toward.y * conserveRange + side.y * 130), enemyEstimate.x - (enemyEstimate.x - toward.x * conserveRange + side.x * 130)),
          preferredRange: conserveRange,
        },
        {
          x: enemyEstimate.x - toward.x * (conserveRange + 45) - side.x * 130,
          y: enemyEstimate.y - toward.y * (conserveRange + 45) - side.y * 130,
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - toward.y * (conserveRange + 45) - side.y * 130), enemyEstimate.x - (enemyEstimate.x - toward.x * (conserveRange + 45) - side.x * 130)),
          preferredRange: conserveRange * 1.05,
        },
      ], 1.42);
    }
    if (mode === "regroup") {
      return pickBest([
        {
          x: lerp(center.x, main.x, 0.74) - toward.x * 140 + side.x * 110,
          y: lerp(center.y, main.y, 0.74) - toward.y * 140 + side.y * 110,
          intentAngle: Math.atan2(enemyEstimate.y - main.y, enemyEstimate.x - main.x),
          preferredRange: preferredRange * 1.08,
        },
        {
          x: lerp(center.x, main.x, 0.74) - toward.x * 140 - side.x * 110,
          y: lerp(center.y, main.y, 0.74) - toward.y * 140 - side.y * 110,
          intentAngle: Math.atan2(enemyEstimate.y - main.y, enemyEstimate.x - main.x),
          preferredRange: preferredRange * 1.08,
        },
      ], 1.35);
    }
    if (mode === "kite") {
      const retreatRange = clamp(main.stats.range * 1.16, 220, 420);
      return pickBest([
        {
          x: enemyEstimate.x - toward.x * retreatRange + side.x * 140,
          y: enemyEstimate.y - toward.y * retreatRange + side.y * 140,
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - toward.y * retreatRange + side.y * 140), enemyEstimate.x - (enemyEstimate.x - toward.x * retreatRange + side.x * 140)),
          preferredRange: retreatRange,
        },
        {
          x: enemyEstimate.x - toward.x * retreatRange - side.x * 140,
          y: enemyEstimate.y - toward.y * retreatRange - side.y * 140,
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - toward.y * retreatRange - side.y * 140), enemyEstimate.x - (enemyEstimate.x - toward.x * retreatRange - side.x * 140)),
          preferredRange: retreatRange,
        },
      ], 1.5);
    }
    if (mode === "collapse") {
      return pickBest([
        {
          x: enemyEstimate.x - enemyForward.x * 54 + enemySide.x * broadsideSign * 150,
          y: enemyEstimate.y - enemyForward.y * 54 + enemySide.y * broadsideSign * 150,
          intentAngle: this.broadsideIntentAngle(
            enemyEstimate.x - enemyForward.x * 54 + enemySide.x * broadsideSign * 150,
            enemyEstimate.y - enemyForward.y * 54 + enemySide.y * broadsideSign * 150,
            enemyEstimate.x,
            enemyEstimate.y,
            broadsideSign,
          ),
          preferredRange: clamp(preferredRange * 0.72, 100, 230),
        },
        {
          x: enemyEstimate.x - toward.x * 62,
          y: enemyEstimate.y - toward.y * 62,
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - toward.y * 62), enemyEstimate.x - (enemyEstimate.x - toward.x * 62)),
          preferredRange: clamp(preferredRange * 0.62, 80, 180),
        },
      ], 1.05);
    }
    if (mode === "broadside") {
      const sideOffset = clamp(main.stats.range * 0.82, 180, 320);
      const rearOffset = clamp(main.stats.range * 0.24, 50, 130);
      return pickBest([
        {
          x: enemyEstimate.x - enemyForward.x * rearOffset + enemySide.x * broadsideSign * sideOffset,
          y: enemyEstimate.y - enemyForward.y * rearOffset + enemySide.y * broadsideSign * sideOffset,
          intentAngle: this.broadsideIntentAngle(
            enemyEstimate.x - enemyForward.x * rearOffset + enemySide.x * broadsideSign * sideOffset,
            enemyEstimate.y - enemyForward.y * rearOffset + enemySide.y * broadsideSign * sideOffset,
            enemyEstimate.x,
            enemyEstimate.y,
            broadsideSign,
          ),
          preferredRange,
        },
        {
          x: enemyEstimate.x - enemyForward.x * (rearOffset + 54) + enemySide.x * broadsideSign * (sideOffset * 0.9),
          y: enemyEstimate.y - enemyForward.y * (rearOffset + 54) + enemySide.y * broadsideSign * (sideOffset * 0.9),
          intentAngle: this.broadsideIntentAngle(
            enemyEstimate.x - enemyForward.x * (rearOffset + 54) + enemySide.x * broadsideSign * (sideOffset * 0.9),
            enemyEstimate.y - enemyForward.y * (rearOffset + 54) + enemySide.y * broadsideSign * (sideOffset * 0.9),
            enemyEstimate.x,
            enemyEstimate.y,
            broadsideSign,
          ),
          preferredRange: preferredRange * 0.96,
        },
      ], 1.25);
    }
    if (mode === "cutoff") {
      return pickBest([
        {
          x: enemyEstimate.x + enemyForward.x * 250 + enemySide.x * broadsideSign * 110,
          y: enemyEstimate.y + enemyForward.y * 250 + enemySide.y * broadsideSign * 110,
          intentAngle: this.broadsideIntentAngle(
            enemyEstimate.x + enemyForward.x * 250 + enemySide.x * broadsideSign * 110,
            enemyEstimate.y + enemyForward.y * 250 + enemySide.y * broadsideSign * 110,
            enemyEstimate.x,
            enemyEstimate.y,
            broadsideSign,
          ),
          preferredRange: preferredRange * 1.02,
        },
        {
          x: enemyEstimate.x + enemyForward.x * 220 - enemySide.x * broadsideSign * 90,
          y: enemyEstimate.y + enemyForward.y * 220 - enemySide.y * broadsideSign * 90,
          intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y + enemyForward.y * 220 - enemySide.y * broadsideSign * 90), enemyEstimate.x - (enemyEstimate.x + enemyForward.x * 220 - enemySide.x * broadsideSign * 90)),
          preferredRange: preferredRange * 1.1,
        },
      ], 1.18);
    }
    return pickBest([
      {
        x: enemyEstimate.x - enemyForward.x * 96 + enemySide.x * broadsideSign * 90,
        y: enemyEstimate.y - enemyForward.y * 96 + enemySide.y * broadsideSign * 90,
        intentAngle: this.broadsideIntentAngle(
          enemyEstimate.x - enemyForward.x * 96 + enemySide.x * broadsideSign * 90,
          enemyEstimate.y - enemyForward.y * 96 + enemySide.y * broadsideSign * 90,
          enemyEstimate.x,
          enemyEstimate.y,
          broadsideSign,
        ),
        preferredRange: preferredRange * 0.94,
      },
      {
        x: enemyEstimate.x - toward.x * 122,
        y: enemyEstimate.y - toward.y * 122,
        intentAngle: Math.atan2(enemyEstimate.y - (enemyEstimate.y - toward.y * 122), enemyEstimate.x - (enemyEstimate.x - toward.x * 122)),
        preferredRange: preferredRange * 0.88,
      },
      {
        x: enemyEstimate.x - enemyForward.x * 70 - enemySide.x * broadsideSign * 110,
        y: enemyEstimate.y - enemyForward.y * 70 - enemySide.y * broadsideSign * 110,
        intentAngle: this.broadsideIntentAngle(
          enemyEstimate.x - enemyForward.x * 70 - enemySide.x * broadsideSign * 110,
          enemyEstimate.y - enemyForward.y * 70 - enemySide.y * broadsideSign * 110,
          enemyEstimate.x,
          enemyEstimate.y,
          -broadsideSign,
        ),
        preferredRange,
      },
    ], 1.22);
  },

  // U1 视野收尾：交火落点常停在"打得到却看不见"的盲区(vision≈166 ≪ range≈505)，
  // 双方互相失明便不开火、拖成平局。此处在进攻意图下把落点从盲区沿原方向(保留侧舷角)
  // 拉进视野距离，使舰真正夺取目标并持续开火。仅作用于进攻模式+愿意交战时。
  engageTarget(ship, enemy, target, mode, tactical, { combatRole = true } = {}) {
    if (!this.params.features.visionEngage) return target; // 旧版AI：不做视野收尾压近
    if (!target || !enemy || !ship) return target;
    // 情报前探、后卫和侧翼已有各自的距离契约；通用交火收尾只能改写正面火力角色，
    // 否则会把长门前探从视野边缘推回普通射击距离，反而丢失情报价值。
    if (!combatRole) return target;
    // 吊在远处打(攻击射程≈505 ≫ 视野≈166，开火只需"队伍视野")：已侦得目标(enemy.visible)且落点在
    // 0.9×射程以内→把落点外推到 0.9×射程。敌视野够不到这个距离→敌看不见我便打不还手。
    // 情境化：中立交火期远吊安全输出(也抗对手远吊)；但到了收尾窗口(已占优、敌濒覆灭)就改为压近快速补杀。
    const barrierBreachWindow = Boolean(
      tactical.barrierTactics?.enemy
      && !tactical.barrierTactics.enemy.active
      && tactical.barrierTactics.enemy.disabledRemaining > 0,
    );
    if (enemy.visible && !tactical.closeoutWindow && !barrierBreachWindow) {
      // 站在敌视野之外打：交火距离取"敌方视野×POKE_VISION_MULT"(刚好够不到我)，clamp 在射程内。
      // 比满射程远吊更靠前→火力更集中/压制更强，又仍在敌视野外→不挨打。
      const enemyVis = this.estimateVisionRange(enemy);
      const pokeR = clamp(enemyVis * this.params.movement.engage.pokeVisionMult, enemyVis + 30, ship.stats.range * 0.95);
      const px = target.x - enemy.x;
      const py = target.y - enemy.y;
      const pOff = Math.hypot(px, py);
      if (pOff > 1 && Math.abs(pOff - pokeR) > 12 && pOff < ship.stats.range * 0.98) {
        const pk = pokeR / pOff;
        return {
          ...target,
          x: this.clampX(enemy.x + px * pk, this.safeRoutePadding()),
          y: this.clampY(enemy.y + py * pk, this.safeRoutePadding()),
        };
      }
    }
    const aggressive = combatRole && (mode === "press" || mode === "collapse" || mode === "broadside" || mode === "cutoff");
    if (!aggressive) return target;
    // 是否压近夺视野要judicious：常规敌人压近能吃到侧舷1.5倍密度，值得贴上去交火；
    // 但对手是阿虚(Kyon)旗舰时射界密度被抹平、贴脸纯比血厚——此时只有真正占优/收尾才压近，
    // 否则保持站位别一头扎进肉阵容被对耗(对抗实测的回归)。
    const enemyFlatDensity = this.obs.privileged.enemyHasKyonFlagship;
    const want = tactical.killWindow || tactical.emergencyCommit || tactical.winning
      || (enemyFlatDensity
        ? tactical.localAdvantage >= 1.05
        : (tactical.localAdvantage >= 0.82 || tactical.intelSolid));
    if (!want) return target;
    const vision = ship.stats.vision;
    const ox = target.x - enemy.x;
    const oy = target.y - enemy.y;
    const off = Math.hypot(ox, oy);
    if (off < 1) return target;
    const visionEngage = clamp(vision * 0.88, 90, Math.max(vision, 90));
    if (off <= visionEngage + 6) return target; // 已在视野内
    const k = visionEngage / off;
    return {
      ...target,
      x: this.clampX(enemy.x + ox * k, this.safeRoutePadding()),
      y: this.clampY(enemy.y + oy * k, this.safeRoutePadding()),
    };
  },
};
