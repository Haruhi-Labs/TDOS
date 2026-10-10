// 走位下发：卡死检测、航线提交、光球转向与每轮改航的编排。
// 这些方法安装在 RulePolicy 的原型上，经 this 访问观测、参数、随机流与策略状态。
import { clamp, distance } from "../../math.js";
import { throttleForGear } from "../../throttle.js";
import { bunnyStageRoute } from "./tactics/bunny-stage.js";
import { applyKoizumiBarrierMainStrategy, clampPointToAnchorRadius, keepDirectiveInsideKoizumiBarrier } from "./tactics/character-counterplay.js";
import { planShamisenHuntFormation } from "./tactics/shamisen-hunt.js";

export const movementMethods = {
  updateStuckState(dt) {
    const main = this.obs.self.ships.main;
    if (!main.alive || !main.route) {
      this.stuckTimer = 0;
      this.lastMainPos = { x: main.x, y: main.y };
      return;
    }

    const moved = distance(main.x, main.y, this.lastMainPos.x, this.lastMainPos.y);
    const progressing = main.route.t > 0.08;
    const edgePressure = this.edgePressure(main);
    const pinnedOnEdge = edgePressure > 0.42 && main.speed < 6.5;
    if ((moved < 2.5 && main.speed < 3.5 && progressing) || pinnedOnEdge) {
      this.stuckTimer += dt * (1 + edgePressure * 1.8);
    } else {
      this.stuckTimer = Math.max(0, this.stuckTimer - dt * (0.9 + edgePressure));
    }

    this.lastMainPos = { x: main.x, y: main.y };
  },

  issueShipRoute(ship, targetX, targetY, throttle, padding = this.obs.world.mapPadding) {
    if (!ship || !ship.alive || !ship.canControl) {
      return null;
    }
    if (this.obs.rules.bunnyStage) {
      const target = bunnyStageRoute(ship, { x: targetX, y: targetY }, this.currentContext?.focus, this.obs.time);
      targetX = target.x;
      targetY = target.y;
    }
    const tx = this.clampX(targetX, padding);
    const ty = this.clampY(targetY, padding);
    const requestedThrottle = clamp(throttle, 0.45, 1.2);
    // AI 的战术层以 >1 表示明确的超速意图；离散化后应进入前进4档，
    // 不能因为 1.04～1.18 在数值上更靠近标准巡航而丢掉脱困/追击加速。
    const th = this.energyAwareThrottleForShip(ship, requestedThrottle);
    let update = "new";

    if (!ship.route) {
      this.writeRoute(ship.key, tx, ty, th);
      return {
        x: tx,
        y: ty,
        throttle: th,
        padding,
        update,
      };
    }

    const endpointGap = distance(ship.route.p2.x, ship.route.p2.y, tx, ty);
    if (endpointGap > 90 || ship.route.t > 0.7) {
      this.writeRoute(ship.key, tx, ty, th);
      update = "reset";
    } else {
      this.writeThrottle(ship.key, th);
      this.writeRouteEndpoint(ship.key, tx, ty);
      update = "retarget";
    }
    return {
      x: tx,
      y: ty,
      throttle: th,
      padding,
      update,
    };
  },

  steerActiveKoizumiOrbs(context = this.currentContext) {
    if (this.koizumiOrbSteerTimer > 0) return;
    const activeOrbs = [this.obs.self.ships.sub1, this.obs.self.ships.sub2].filter(
      (ship) => ship?.alive && ship.koizumiOrb?.phase === "active" && ship.canControl,
    );
    if (activeOrbs.length === 0) {
      this.koizumiOrbSteerTimer = 0;
      return;
    }

    for (const ship of activeOrbs) {
      const barrier = context?.barrierTactics?.enemy;
      const knownBarrierMain = barrier?.active
        ? this.projectContact(this.enemyIntel.main, 0.8)
        : null;
      const estimate = knownBarrierMain
        ? { ...knownBarrierMain, x: barrier.x, y: barrier.y }
        : this.selectEnemyFocus(ship) || context?.focus || this.primaryEnemyEstimate();
      if (!estimate || estimate.source === "spawn") continue;
      const dist = distance(ship.x, ship.y, estimate.x, estimate.y);
      const cruiseSpeed = Math.max(120, Number(ship.koizumiOrb.cruiseSpeed) || 164);
      const leadSeconds = clamp(dist / cruiseSpeed, 0.16, 0.72);
      const targetX = estimate.x + Math.cos(Number(estimate.angle) || 0) * (Number(estimate.speed) || 0) * leadSeconds;
      const targetY = estimate.y + Math.sin(Number(estimate.angle) || 0) * (Number(estimate.speed) || 0) * leadSeconds;
      this.issueShipRoute(ship, targetX, targetY, 1.2, this.safeRoutePadding(4));
    }
    // 高速冲撞需要比常规舰队战术更密的前视修正；难度仍通过反应倍率保留差异。
    this.koizumiOrbSteerTimer = clamp(0.18 * Math.sqrt(this.reactionMult || 1), 0.18, 0.48);
  },

  issueMovement(context = this.currentContext) {
    const main = this.obs.self.ships.main;
    if (!main.alive) {
      return;
    }

    const enemyEstimate = context?.focus || this.selectEnemyFocus(main) || this.primaryEnemyEstimate();
    if (!enemyEstimate) {
      return;
    }

    const tactical = context || this.buildTacticalContext(main, enemyEstimate);
    const searchCenter = this.acquireSearchCenter(main, enemyEstimate);
    const mode = this.chooseMode(tactical);
    const center = mode === "search" ? searchCenter : this.combatCenter(enemyEstimate);
    const sectorPlan = ((mode === "search" || mode === "cutoff" || mode === "collapse" || mode === "press") && (tactical.trackableIntel || tactical.searchRequired || tactical.isolatedTargetScore > 0.28 || !tactical.intelSolid))
      ? this.computeSectorEncirclement(main, enemyEstimate, searchCenter, tactical.encirclePressure)
      : null;
    const useSearchSectorPlan = Boolean(sectorPlan && mode === "search" && (tactical.trackableIntel || tactical.focus.source !== "spawn"));
    const searchAssignments = mode === "search"
      ? (useSearchSectorPlan ? sectorPlan : this.computeSearchAssignments(main, enemyEstimate, searchCenter))
      : null;
    let mainTarget = mode === "search"
      ? (useSearchSectorPlan ? sectorPlan.main : this.computeSearchTarget(main, enemyEstimate, searchAssignments.main))
      : sectorPlan && (mode === "cutoff" || mode === "press")
        ? sectorPlan.main
        : this.computeMainTarget(mode, main, enemyEstimate, center);
    const toEnemyX = enemyEstimate.x - main.x;
    const toEnemyY = enemyEstimate.y - main.y;
    const len = Math.max(1, Math.hypot(toEnemyX, toEnemyY));
    const toward = { x: toEnemyX / len, y: toEnemyY / len };
    const side = { x: -toward.y, y: toward.x };
    const sign = tactical.flankSign || this.preferredFlankSign(main, enemyEstimate);
    const detachedPlan = this.planDetachedRoles(main, enemyEstimate, tactical);
    let shamisenHuntPlan = planShamisenHuntFormation({
      tactics: tactical.shamisenHunt,
      obs: this.obs,
      ships: this.ownShips(),
      main,
      focus: enemyEstimate,
      now: this.obs.time,
      padding: this.safeRoutePadding(12),
    });
    // 古泉盾的突破/渗透已有独立的精确策略。猎杀方先执行破盾战术，避免把“追标记”
    // 误解成无视能量圈硬冲；防守方的护卫阵型仍保持生效。
    if (shamisenHuntPlan?.kind === "attack" && tactical.barrierTactics?.enemy?.active) {
      shamisenHuntPlan = null;
    }
    // 脱离地图边缘优先于角色战术，否则后撤中的被猎杀舰可能被自己的护卫阵型钉在边界。
    if (tactical.edgePressure > 0.34) {
      shamisenHuntPlan = null;
    }
    if (shamisenHuntPlan) {
      for (const [shipKey, role] of Object.entries(shamisenHuntPlan.roles)) {
        detachedPlan.roles[shipKey] = role;
      }
      detachedPlan.intelLeadKey = shamisenHuntPlan.kind === "attack"
        ? shamisenHuntPlan.leadKey
        : null;
      detachedPlan.retreatKey = shamisenHuntPlan.kind === "defense"
        ? tactical.shamisenHunt?.defense?.huntedShipKey || null
        : null;
    }
    const debugPlan = {
      focus: this.debugContact(enemyEstimate),
      searchCenter: this.debugPoint(searchCenter),
      combatCenter: this.debugPoint(center),
      searchAssignments: this.debugPointMap(searchAssignments),
      sectorPlan: this.debugPointMap(sectorPlan),
      shamisenHuntPlan: shamisenHuntPlan
        ? {
            kind: shamisenHuntPlan.kind,
            phase: shamisenHuntPlan.phase,
            targetId: shamisenHuntPlan.targetId,
            blockerId: shamisenHuntPlan.blockerId,
            leadKey: shamisenHuntPlan.leadKey,
            points: this.debugPointMap(shamisenHuntPlan.points),
            roles: { ...shamisenHuntPlan.roles },
          }
        : null,
      detachedPlan: this.debugDetachedPlan(detachedPlan),
      orders: {},
      useSearchSectorPlan,
      shouldUseDetachedRoles: false,
    };
    const intelLeadShip = detachedPlan.intelLeadKey ? this.obs.self.ships[detachedPlan.intelLeadKey] : null;
    const barrierBreachWindow = Boolean(
      tactical.barrierTactics?.enemy
      && !tactical.barrierTactics.enemy.active
      && tactical.barrierTactics.enemy.disabledRemaining > 0,
    );
    let mainHeldForIntelLead = false;
    if (
      detachedPlan.intelLeadKey
      && !shamisenHuntPlan
      && !barrierBreachWindow
      && !tactical.killWindow
      && (!tactical.emergencyCommit || (intelLeadShip?.characterId === "yuki" && (enemyEstimate.visible || tactical.intelSolid)))
      && (mode !== "collapse" || (intelLeadShip?.characterId === "yuki" && (enemyEstimate.visible || tactical.intelSolid)))
    ) {
      const supportRange = clamp(
        main.stats.range * (tactical.trackableIntel || tactical.searchRequired ? 1.04 : 0.96) * (intelLeadShip?.characterId === "yuki" ? 1.18 : 1),
        240,
        intelLeadShip?.characterId === "yuki" ? 430 : 390,
      );
      const supportCandidate = {
        x: this.clampX(enemyEstimate.x - toward.x * supportRange - side.x * sign * 54, this.safeRoutePadding(8)),
        y: this.clampY(enemyEstimate.y - toward.y * supportRange - side.y * sign * 54, this.safeRoutePadding(8)),
        intentAngle: Math.atan2(
          enemyEstimate.y - (enemyEstimate.y - toward.y * supportRange - side.y * sign * 54),
          enemyEstimate.x - (enemyEstimate.x - toward.x * supportRange - side.x * sign * 54),
        ),
        preferredRange: supportRange,
      };
      const currentRange = distance(mainTarget.x, mainTarget.y, enemyEstimate.x, enemyEstimate.y);
      const supportExchange = this.evaluateArcExchange(main, enemyEstimate, supportCandidate, 1.24);
      if (currentRange < supportRange - 28 || supportExchange.enemyDensity <= 1.15 || (intelLeadShip?.characterId === "yuki" && (enemyEstimate.visible || tactical.intelSolid))) {
        mainTarget = supportCandidate;
        // 仅长门前探(其视野远、专职侦察)时主舰保持支援位不压近；其余情况仍可压近夺视野/吃侧舷
        mainHeldForIntelLead = intelLeadShip?.characterId === "yuki";
      }
    }
    // U1 视野收尾：主舰若非"为前探僚舰保持火力支援位"，则在进攻意图下压近到视野距离夺取目标
    if (!mainHeldForIntelLead && !shamisenHuntPlan) {
      mainTarget = this.engageTarget(main, enemyEstimate, mainTarget, mode, tactical);
    }
    if (shamisenHuntPlan?.points?.main) {
      mainTarget = shamisenHuntPlan.points.main;
    }
    mainTarget = applyKoizumiBarrierMainStrategy({
      main,
      enemyEstimate,
      target: mainTarget,
      tactics: tactical.barrierTactics,
      worldSize: this.obs.world.size,
      padding: this.safeRoutePadding(14),
      flankSign: tactical.flankSign || 1,
    });
    const throttleShift = tactical.emergencyCommit
      ? 0.06 + tactical.energySurplus * 0.05
      : tactical.energySurplus * 0.05 - tactical.energyRecoveryNeed * 0.18;
    const throttleBand = (min, max) => {
      const adjustedMin = clamp(min + throttleShift, 0.52, 1.18);
      const adjustedMax = clamp(max + throttleShift, adjustedMin + 0.04, 1.2);
      return this.rng.range(adjustedMin, adjustedMax);
    };
    let mainThrottle = mode === "recover"
      ? throttleBand(1.02, 1.18)
      : mode === "harvest"
        ? throttleBand(0.68, 0.88)
        : mode === "search"
          ? throttleBand(tactical.conserveEnergy ? 0.94 : 1.04, tactical.conserveEnergy ? 1.08 : 1.18)
        : mode === "collapse"
          ? throttleBand(1.02, 1.18)
          : mode === "regroup"
            ? throttleBand(0.9, 1.08)
            : mode === "kite"
              ? throttleBand(0.86, 1.04)
              : tactical.pressureDrive > 0.95 || tactical.emergencyCommit
                ? throttleBand(1.02, 1.18)
                : throttleBand(0.94, 1.14);
    if (shamisenHuntPlan?.throttles?.main) {
      const band = shamisenHuntPlan.throttles.main;
      mainThrottle = throttleBand(band.min, band.max);
    }
    const attachedBladeQueenActive = this.fleetMembers(main).some(
      (ship) => ship.alive && this.hasEffect(ship, "bladeQueenUntil"),
    );
    if (attachedBladeQueenActive) {
      mainThrottle = throttleForGear(4);
    } else if (
      tactical.barrierTactics?.incoming
      || (tactical.barrierTactics?.own && !tactical.barrierTactics.own.active)
      || (
        tactical.barrierTactics?.enemy?.active
        && (
          tactical.barrierTactics.breachShipKey === "main"
          || (
            tactical.barrierTactics.infiltration?.phase === "commit"
            && tactical.barrierTactics.infiltration.shipKeys.includes("main")
          )
        )
      )
    ) {
      mainThrottle = throttleForGear(4);
    } else if (
      tactical.barrierTactics?.infiltration?.phase === "stage"
      && tactical.barrierTactics.infiltration.shipKeys.includes("main")
    ) {
      mainThrottle = throttleForGear(3);
    }
    const mainIssued = this.issueShipRoute(
      this.obs.self.ships.main,
      mainTarget.x,
      mainTarget.y,
      mainThrottle,
      this.safeRoutePadding(mode === "recover" ? 24 : 0),
    );
    if (mainIssued) {
      debugPlan.orders.main = {
        shipKey: "main",
        role: shamisenHuntPlan?.roles?.main || mode,
        detached: false,
        target: this.debugPoint(mainTarget),
        throttle: mainIssued.throttle,
        padding: mainIssued.padding,
        update: mainIssued.update,
      };
    }

    const focus = mode === "search" ? searchCenter : enemyEstimate;
    const shouldUseDetachedRoles = this.obs.self.splitLevel > 0 && (Boolean(shamisenHuntPlan)
      || (
        !(sectorPlan && !tactical.intelSolid && !enemyEstimate.visible && tactical.trackableIntel)
        && (mode !== "search" || tactical.trackableIntel || tactical.intelSolid || tactical.focus.source !== "spawn")
      ));
    debugPlan.shouldUseDetachedRoles = shouldUseDetachedRoles;
    const routeDetachedShip = (ship) => {
      if (!ship || !ship.alive || ship.attached) {
        return;
      }
      const role = detachedPlan.roles[ship.key] || "fire";
      const laneSign = detachedPlan.laneSigns[ship.key] || sign;
      const huntPoint = shamisenHuntPlan?.points?.[ship.key];
      let directive = huntPoint
        ? {
            target: huntPoint,
            throttle: shamisenHuntPlan.throttles[ship.key] || { min: 0.9, max: 1.08 },
            role,
          }
        : this.computeDetachedDirective(ship, role, enemyEstimate, tactical, main, mainTarget, laneSign);
      if (!directive) {
        return;
      }
      if (!huntPoint && role !== "breach" && role !== "infiltrate") {
        directive.target = this.engageTarget(ship, enemyEstimate, directive.target, mode, tactical, { combatRole: role === "fire" || role === "front" });
      }
      directive = keepDirectiveInsideKoizumiBarrier(
        directive,
        ship,
        mainTarget,
        tactical.barrierTactics,
        role,
      );
      // 编队凝聚(反孤立)：交战角色的分离舰不得离主力太远，避免被各个击破，并让火力自然汇聚到同一片战区
      // (公平的"集中兵力"——靠站位凝聚，而非锁定目标)。后撤/侦察/逃逸不受此限。
      if (!huntPoint && this.params.features.formationLeash && (role === "fire" || role === "flank" || role === "front") && main.alive) {
        const leash = clamp(main.stats.range * 0.40, 150, 235);
        const dxm = directive.target.x - main.x;
        const dym = directive.target.y - main.y;
        const dm = Math.hypot(dxm, dym);
        if (dm > leash) {
          directive.target = {
            ...directive.target,
            x: this.clampX(main.x + (dxm / dm) * leash, this.safeRoutePadding(8)),
            y: this.clampY(main.y + (dym / dm) * leash, this.safeRoutePadding(8)),
          };
        }
      }
      let throttleRange = directive.throttle;
      if (role === "escape") {
        throttleRange = { min: 1.04, max: 1.2 };
      } else if (role === "breach" || role === "infiltrate") {
        throttleRange = role === "breach"
          ? { min: 1.12, max: 1.2 }
          : tactical.barrierTactics?.infiltration?.phase === "commit"
            ? { min: 1.12, max: 1.2 }
            : { min: 0.94, max: 1.04 };
      } else if (mode === "harvest" && role !== "intel") {
        throttleRange = { min: 0.58, max: Math.min(0.88, throttleRange.max) };
      } else if (mode === "regroup" && role !== "intel" && role !== "front") {
        throttleRange = {
          min: Math.max(0.68, throttleRange.min - 0.08),
          max: Math.max(Math.max(0.78, throttleRange.min), throttleRange.max - 0.06),
        };
      } else if (mode === "kite" && role === "rear") {
        throttleRange = { min: 0.54, max: 0.76 };
      }
      const issued = this.issueShipRoute(
        ship,
        directive.target.x,
        directive.target.y,
        this.hasEffect(ship, "bladeQueenUntil")
          ? throttleForGear(4)
          : throttleBand(throttleRange.min, throttleRange.max),
        this.safeRoutePadding(role === "rear" || role === "escape" ? 14 : 8),
      );
      if (issued) {
        debugPlan.orders[ship.key] = {
          shipKey: ship.key,
          role: directive.role,
          detached: true,
          target: this.debugPoint(directive.target),
          throttle: issued.throttle,
          padding: issued.padding,
          update: issued.update,
        };
      }
    };

    if (this.obs.self.splitLevel >= 1 && this.obs.self.ships.sub1.alive) {
      if (shouldUseDetachedRoles) {
        routeDetachedShip(this.obs.self.ships.sub1);
      } else {
        let sub1Target = mode === "search"
        ? searchAssignments.sub1
        : sectorPlan && (mode === "cutoff" || mode === "press")
          ? sectorPlan.sub1
        : {
            x: mode === "harvest"
              ? main.x - toward.x * 70 + side.x * 145
              : mode === "regroup"
                ? main.x - toward.x * 70 + side.x * 120
                : mode === "kite"
                  ? main.x - toward.x * 40 + side.x * 170
                  : mode === "collapse"
                    ? focus.x - side.x * 180 - toward.x * 28
                    : mode === "broadside"
                      ? focus.x + side.x * sign * 220 - toward.x * 90
                      : focus.x + this.rng.range(-250, 250),
            y: mode === "harvest"
              ? main.y - toward.y * 70 + side.y * 145
              : mode === "regroup"
                ? main.y - toward.y * 70 + side.y * 120
                : mode === "kite"
                  ? main.y - toward.y * 40 + side.y * 170
                  : mode === "collapse"
                    ? focus.y - side.y * 180 - toward.y * 28
                    : mode === "broadside"
                      ? focus.y + side.y * sign * 220 - toward.y * 90
                      : focus.y + this.rng.range(-250, 250),
          };
      if (tactical.barrierTactics?.own) {
        const barrier = tactical.barrierTactics.own;
        sub1Target = clampPointToAnchorRadius(
          sub1Target,
          mainTarget,
          barrier.active ? Math.max(42, barrier.radius - 34) : Math.min(96, barrier.radius * 0.58),
        );
      }
      const issued = this.issueShipRoute(
        this.obs.self.ships.sub1,
        sub1Target.x,
        sub1Target.y,
        mode === "harvest"
          ? throttleBand(0.7, 0.88)
          : mode === "collapse"
            ? throttleBand(1, 1.16)
            : mode === "regroup"
                ? throttleBand(0.92, 1.08)
                : throttleBand(0.86, 1.12),
        this.safeRoutePadding(10),
      );
      if (issued) {
        debugPlan.orders.sub1 = {
          shipKey: "sub1",
          role: mode === "search" ? "search" : "support",
          detached: false,
          target: this.debugPoint(sub1Target),
          throttle: issued.throttle,
          padding: issued.padding,
          update: issued.update,
        };
      }
      }
    }

    if (this.obs.self.splitLevel >= 2 && this.obs.self.ships.sub2.alive) {
      if (shouldUseDetachedRoles) {
        routeDetachedShip(this.obs.self.ships.sub2);
      } else {
        const orbitAngle = Number.isFinite(focus.angle) ? focus.angle : Math.atan2(focus.y - main.y, focus.x - main.x);
        let sub2Target = mode === "search"
        ? searchAssignments.sub2
        : sectorPlan && (mode === "cutoff" || mode === "press")
          ? sectorPlan.sub2
        : {
            x: mode === "harvest"
              ? main.x - toward.x * 70 - side.x * 145
              : mode === "regroup"
                ? main.x - toward.x * 70 - side.x * 120
                : mode === "kite"
                  ? main.x - toward.x * 40 - side.x * 170
                  : mode === "collapse"
                    ? focus.x + side.x * 180 - toward.x * 28
                    : mode === "broadside"
                      ? focus.x + side.x * sign * 120 + toward.x * 70
                      : focus.x + Math.cos(orbitAngle + Math.PI * 0.5) * this.rng.range(160, 300),
            y: mode === "harvest"
              ? main.y - toward.y * 70 - side.y * 145
              : mode === "regroup"
                ? main.y - toward.y * 70 - side.y * 120
                : mode === "kite"
                  ? main.y - toward.y * 40 - side.y * 170
                  : mode === "collapse"
                    ? focus.y + side.y * 180 - toward.y * 28
                    : mode === "broadside"
                      ? focus.y + side.y * sign * 120 + toward.y * 70
                      : focus.y + Math.sin(orbitAngle + Math.PI * 0.5) * this.rng.range(160, 300),
          };
      if (tactical.barrierTactics?.own) {
        const barrier = tactical.barrierTactics.own;
        sub2Target = clampPointToAnchorRadius(
          sub2Target,
          mainTarget,
          barrier.active ? Math.max(42, barrier.radius - 34) : Math.min(96, barrier.radius * 0.58),
        );
      }
      const issued = this.issueShipRoute(
        this.obs.self.ships.sub2,
        sub2Target.x,
        sub2Target.y,
        mode === "harvest"
          ? throttleBand(0.68, 0.86)
          : mode === "collapse"
            ? throttleBand(0.98, 1.14)
            : mode === "regroup"
                ? throttleBand(0.9, 1.06)
                : throttleBand(0.84, 1.1),
        this.safeRoutePadding(6),
      );
      if (issued) {
        debugPlan.orders.sub2 = {
          shipKey: "sub2",
          role: mode === "search" ? "search" : "support",
          detached: false,
          target: this.debugPoint(sub2Target),
          throttle: issued.throttle,
          padding: issued.padding,
          update: issued.update,
        };
      }
      }
    }
    this.lastTacticalPlan = debugPlan;
  },
};
