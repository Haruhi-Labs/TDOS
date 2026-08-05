import { clamp, distance, lerp, shortestAngleDelta } from "../../shared/game/math.js";

export function createOnlineStateSync({ app, nowMs, worldSize, maxExtrapolateMs }) {
  const LOGICAL = worldSize;
  const MAX_EXTRAPOLATE_MS = maxExtrapolateMs;

  function clampToMapX(x, padding = 0) {
    return clamp(x, padding, LOGICAL - padding);
  }

  function clampToMapY(y, padding = 0) {
    return clamp(y, padding, LOGICAL - padding);
  }

  function getRouteForShip(ship) {
    if (!ship) {
      return null;
    }
    const override = app.routeOverrides.get(ship.key);
    if (override && override.route) {
      return override.route;
    }
    return ship.route || null;
  }
  
  function clonePoint(point) {
    if (!point) {
      return { x: 0, y: 0 };
    }
    return { x: point.x, y: point.y };
  }
  
  function cloneRoute(route) {
    if (!route) {
      return null;
    }
    return {
      anchorToMain: route.anchorToMain !== false,
      p0: clonePoint(route.p0),
      p1: clonePoint(route.p1),
      p2: clonePoint(route.p2),
      t: Number(route.t) || 0,
    };
  }
  
  function getDisplayRouteForShip(team, ship) {
    const route = getRouteForShip(ship);
    if (!route) {
      return null;
    }
    const output = cloneRoute(route);
    let anchor = ship;
    if (route.anchorToMain && team && team.ships && team.ships.main && team.ships.main.alive) {
      anchor = team.ships.main;
    }
    output.p0 = {
      x: anchor.x,
      y: anchor.y,
    };
    return output;
  }
  
  function interpolateRoute(a, b, t) {
    if (!a && !b) {
      return null;
    }
    if (!a && b) {
      return t < 0.35 ? null : cloneRoute(b);
    }
    if (a && !b) {
      return t > 0.65 ? null : cloneRoute(a);
    }
    return {
      anchorToMain: b.anchorToMain !== false,
      p0: {
        x: lerp(a.p0.x, b.p0.x, t),
        y: lerp(a.p0.y, b.p0.y, t),
      },
      p1: {
        x: lerp(a.p1.x, b.p1.x, t),
        y: lerp(a.p1.y, b.p1.y, t),
      },
      p2: {
        x: lerp(a.p2.x, b.p2.x, t),
        y: lerp(a.p2.y, b.p2.y, t),
      },
      t: lerp(Number(a.t) || 0, Number(b.t) || 0, t),
    };
  }
  
  function interpolateShip(a, b, t) {
    if (!a || !b) {
      return b || a || null;
    }
  
    const bothAlive = a.alive && b.alive;
    if (!bothAlive) {
      return t < 0.5 ? a : b;
    }
  
    return {
      ...b,
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      angle: a.angle + shortestAngleDelta(a.angle, b.angle) * t,
      speed: lerp(a.speed, b.speed, t),
      hp: lerp(a.hp, b.hp, t),
      throttle: lerp(a.throttle, b.throttle, t),
      route: interpolateRoute(a.route, b.route, t),
    };
  }
  
  // 1096 双子舰等额外舰船与编制舰使用同一套舰船插值，不能按普通单位直接跳快照。
  function interpolateShipList(previousList, nextList, t) {
    const prev = Array.isArray(previousList) ? previousList : [];
    const next = Array.isArray(nextList) ? nextList : [];
    const prevMap = new Map(prev.map((ship) => [ship.id, ship]));
    return next.map((ship) => {
      const previous = prevMap.get(ship.id);
      return previous ? interpolateShip(previous, ship, t) : ship;
    });
  }
  
  function interpolateUnitList(previousList, nextList, t) {
    const prev = Array.isArray(previousList) ? previousList : [];
    const next = Array.isArray(nextList) ? nextList : [];
    const prevMap = new Map(prev.map((item) => [item.id, item]));
    const result = [];
  
    for (const current of next) {
      const old = prevMap.get(current.id);
      if (old && old.alive && current.alive) {
        const oldAngle = Number.isFinite(old.angle) ? old.angle : 0;
        const currentAngle = Number.isFinite(current.angle) ? current.angle : oldAngle;
        result.push({
          ...current,
          x: lerp(old.x, current.x, t),
          y: lerp(old.y, current.y, t),
          angle: oldAngle + shortestAngleDelta(oldAngle, currentAngle) * t,
          hp: Number.isFinite(old.hp) && Number.isFinite(current.hp) ? lerp(old.hp, current.hp, t) : current.hp,
          life: Number.isFinite(old.life) && Number.isFinite(current.life) ? lerp(old.life, current.life, t) : current.life,
        });
      } else {
        result.push(current);
      }
    }
    return result;
  }
  
  function interpolateBeamList(previousList, nextList, t) {
    const prev = Array.isArray(previousList) ? previousList : [];
    const next = Array.isArray(nextList) ? nextList : [];
    const prevMap = new Map(prev.map((item) => [item.id, item]));
    const result = [];
  
    for (const current of next) {
      const old = prevMap.get(current.id);
      if (old) {
        result.push({
          ...current,
          x1: lerp(old.x1, current.x1, t),
          y1: lerp(old.y1, current.y1, t),
          x2: lerp(old.x2, current.x2, t),
          y2: lerp(old.y2, current.y2, t),
          progress: Number.isFinite(old.progress) && Number.isFinite(current.progress)
            ? lerp(old.progress, current.progress, t)
            : current.progress,
          life: Number.isFinite(old.life) && Number.isFinite(current.life) ? lerp(old.life, current.life, t) : current.life,
          maxLife: Number.isFinite(old.maxLife) && Number.isFinite(current.maxLife)
            ? lerp(old.maxLife, current.maxLife, t)
            : current.maxLife,
        });
      } else {
        result.push(current);
      }
    }
    return result;
  }
  
  // 子弹是「恒速直线飞向 target」的确定性弹道,可做精确航位推算
  function advanceProjectile(projectile, dt) {
    const speed = Number(projectile.speed) || 0;
    const dx = projectile.targetX - projectile.x;
    const dy = projectile.targetY - projectile.y;
    const remaining = Math.hypot(dx, dy);
    if (speed <= 0 || remaining < 1e-3) {
      return projectile;
    }
    const step = clamp(speed * dt, -remaining * 4, remaining); // 向前不越过目标;向后(回退)限幅
    return {
      ...projectile,
      x: projectile.x + (dx / remaining) * step,
      y: projectile.y + (dy / remaining) * step,
    };
  }
  
  function interpolateProjectileList(previousList, nextList, t, spanSeconds) {
    const prev = Array.isArray(previousList) ? previousList : [];
    const next = Array.isArray(nextList) ? nextList : [];
    const prevMap = new Map(prev.map((item) => [item.id, item]));
    const result = [];
  
    for (const current of next) {
      const old = prevMap.get(current.id);
      if (old && old.alive && current.alive) {
        result.push({
          ...current,
          x: lerp(old.x, current.x, t),
          y: lerp(old.y, current.y, t),
        });
      } else {
        // 两帧之间新生的子弹:沿弹道回退 (1-t)*span,让它从炮口平滑飞出,
        // 而不是整个插值区间冻结在快照位置(连发时表现为颗颗子弹出生即卡顿)
        result.push(advanceProjectile(current, -(1 - t) * (spanSeconds || 0)));
      }
    }
    return result;
  }
  
  function interpolateVisualList(previousList, nextList, t) {
    const prev = Array.isArray(previousList) ? previousList : [];
    const next = Array.isArray(nextList) ? nextList : [];
    const prevMap = new Map(prev.map((item) => [item.id, item]));
    const result = [];
  
    for (const current of next) {
      const old = prevMap.get(current.id);
      if (old) {
        result.push({
          ...current,
          x: lerp(old.x, current.x, t),
          y: lerp(old.y, current.y, t),
          radius: Number.isFinite(old.radius) && Number.isFinite(current.radius) ? lerp(old.radius, current.radius, t) : current.radius,
          life: Number.isFinite(old.life) && Number.isFinite(current.life) ? lerp(old.life, current.life, t) : current.life,
        });
      } else {
        result.push(current);
      }
    }
    return result;
  }
  
  function interpolateTeam(a, b, t) {
    if (!a || !b) {
      return b || a || null;
    }
  
    return {
      ...b,
      energy: lerp(a.energy, b.energy, t),
      hullRatio: lerp(a.hullRatio, b.hullRatio, t),
      autoScout: {
        enabled: Boolean(b.autoScout?.enabled),
        zoneId: Number(b.autoScout?.zoneId) || 5,
      },
      cooldowns: {
        scout: lerp(a.cooldowns?.scout || 0, b.cooldowns?.scout || 0, t),
        flagship: lerp(a.cooldowns?.flagship || 0, b.cooldowns?.flagship || 0, t),
        sub1: lerp(a.cooldowns?.sub1 || 0, b.cooldowns?.sub1 || 0, t),
        sub2: lerp(a.cooldowns?.sub2 || 0, b.cooldowns?.sub2 || 0, t),
      },
      ships: {
        main: interpolateShip(a.ships.main, b.ships.main, t),
        sub1: interpolateShip(a.ships.sub1, b.ships.sub1, t),
        sub2: interpolateShip(a.ships.sub2, b.ships.sub2, t),
      },
      extraShips: interpolateShipList(a.extraShips, b.extraShips, t),
      scouts: interpolateUnitList(a.scouts, b.scouts, t),
      wingmen: interpolateUnitList(a.wingmen, b.wingmen, t),
      beams: interpolateBeamList(a.beams, b.beams, t),
    };
  }
  
  function extrapolateShip(ship, dt) {
    if (!ship || !ship.alive) {
      return ship;
    }
    return {
      ...ship,
      x: clampToMapX(ship.x + Math.cos(ship.angle) * ship.speed * dt, 2),
      y: clampToMapY(ship.y + Math.sin(ship.angle) * ship.speed * dt, 2),
    };
  }
  
  function extrapolateState(state, dt) {
    if (!state || !state.teams) {
      return state;
    }
  
    const safeDt = clamp(dt, 0, MAX_EXTRAPOLATE_MS / 1000);
    return {
      ...state,
      elapsed: state.elapsed + safeDt,
      // 子弹弹道确定,外推期间继续飞;爆发/浮字寿命本地衰减,避免冻结后跳变
      projectiles: Array.isArray(state.projectiles) ? state.projectiles.map((p) => advanceProjectile(p, safeDt)) : state.projectiles,
      bursts: Array.isArray(state.bursts)
        ? state.bursts.map((b) => ({ ...b, life: Math.max(0, (Number(b.life) || 0) - safeDt) }))
        : state.bursts,
      floatingTexts: Array.isArray(state.floatingTexts)
        ? state.floatingTexts.map((f) => ({ ...f, life: Math.max(0, (Number(f.life) || 0) - safeDt) }))
        : state.floatingTexts,
      teams: {
        A: {
          ...state.teams.A,
          ships: {
            main: extrapolateShip(state.teams.A.ships.main, safeDt),
            sub1: extrapolateShip(state.teams.A.ships.sub1, safeDt),
            sub2: extrapolateShip(state.teams.A.ships.sub2, safeDt),
          },
          extraShips: Array.isArray(state.teams.A.extraShips)
            ? state.teams.A.extraShips.map((ship) => extrapolateShip(ship, safeDt))
            : [],
        },
        B: {
          ...state.teams.B,
          ships: {
            main: extrapolateShip(state.teams.B.ships.main, safeDt),
            sub1: extrapolateShip(state.teams.B.ships.sub1, safeDt),
            sub2: extrapolateShip(state.teams.B.ships.sub2, safeDt),
          },
          extraShips: Array.isArray(state.teams.B.extraShips)
            ? state.teams.B.extraShips.map((ship) => extrapolateShip(ship, safeDt))
            : [],
        },
      },
    };
  }
  
  function estimateServerNowMs() {
    if (!app.clockReady) {
      return nowMs();
    }
    return nowMs() + app.clockOffsetMs;
  }
  
  function smoothEntity(entity, dt, followRate, teleportDistance) {
    if (!entity || !Number.isFinite(entity.id)) {
      return entity;
    }
    if (!entity.alive) {
      app.smoothEntities.delete(entity.id);
      return entity;
    }
  
    const cache = app.smoothEntities.get(entity.id);
    const seenAt = nowMs();
    if (!cache) {
      app.smoothEntities.set(entity.id, {
        x: entity.x,
        y: entity.y,
        angle: entity.angle || 0,
        seenAt,
      });
      return entity;
    }
  
    const d = distance(cache.x, cache.y, entity.x, entity.y);
    if (d > teleportDistance) {
      app.smoothEntities.set(entity.id, {
        x: entity.x,
        y: entity.y,
        angle: entity.angle || 0,
        seenAt,
      });
      return entity;
    }
  
    const alpha = clamp(1 - Math.exp(-dt * followRate), 0.08, 1);
    const x = lerp(cache.x, entity.x, alpha);
    const y = lerp(cache.y, entity.y, alpha);
    const baseAngle = Number.isFinite(cache.angle) ? cache.angle : entity.angle || 0;
    const targetAngle = Number.isFinite(entity.angle) ? entity.angle : baseAngle;
    const angle = baseAngle + shortestAngleDelta(baseAngle, targetAngle) * alpha;
  
    app.smoothEntities.set(entity.id, {
      x,
      y,
      angle,
      seenAt,
    });
    return {
      ...entity,
      x,
      y,
      angle,
    };
  }
  
  function smoothTeamState(team, isOwnTeam, dt) {
    if (!team) {
      return team;
    }
    const followRate = isOwnTeam ? 18 : 13;
    const teleportDistance = isOwnTeam ? 160 : 230;
    return {
      ...team,
      ships: {
        main: smoothEntity(team.ships.main, dt, followRate, teleportDistance),
        sub1: smoothEntity(team.ships.sub1, dt, followRate, teleportDistance),
        sub2: smoothEntity(team.ships.sub2, dt, followRate, teleportDistance),
      },
      extraShips: Array.isArray(team.extraShips)
        ? team.extraShips.map((ship) => smoothEntity(ship, dt, followRate, teleportDistance))
        : [],
      scouts: Array.isArray(team.scouts) ? team.scouts.map((item) => smoothEntity(item, dt, followRate - 2, teleportDistance * 0.9)) : [],
      wingmen: Array.isArray(team.wingmen) ? team.wingmen.map((item) => smoothEntity(item, dt, followRate - 2, teleportDistance * 0.9)) : [],
    };
  }
  
  function stabilizeRenderState(state) {
    if (!state || !state.teams) {
      return state;
    }
    const renderNowMs = nowMs();
    const dt = app.lastRenderMs > 0 ? clamp((renderNowMs - app.lastRenderMs) / 1000, 1 / 144, 0.05) : 1 / 60;
    app.lastRenderMs = renderNowMs;
  
    for (const [entityId, cache] of app.smoothEntities) {
      if (renderNowMs - cache.seenAt > 1400) {
        app.smoothEntities.delete(entityId);
      }
    }
  
    const ownSeat = app.seat || "A";
    return {
      ...state,
      teams: {
        A: smoothTeamState(state.teams.A, ownSeat === "A", dt),
        B: smoothTeamState(state.teams.B, ownSeat === "B", dt),
      },
    };
  }
  
  function interpolateSnapshotState(previousSnapshot, nextSnapshot, t) {
    return {
      ...nextSnapshot.state,
      elapsed: lerp(previousSnapshot.state.elapsed, nextSnapshot.state.elapsed, t),
      phase: nextSnapshot.state.phase,
      winnerSeat: nextSnapshot.state.winnerSeat,
      projectiles: interpolateProjectileList(
        previousSnapshot.state.projectiles,
        nextSnapshot.state.projectiles,
        t,
        Math.max(1, nextSnapshot.tick - previousSnapshot.tick) / app.serverTickRate,
      ),
      bursts: interpolateVisualList(previousSnapshot.state.bursts, nextSnapshot.state.bursts, t),
      floatingTexts: interpolateVisualList(previousSnapshot.state.floatingTexts, nextSnapshot.state.floatingTexts, t),
      teams: {
        A: interpolateTeam(previousSnapshot.state.teams.A, nextSnapshot.state.teams.A, t),
        B: interpolateTeam(previousSnapshot.state.teams.B, nextSnapshot.state.teams.B, t),
      },
    };
  }
  
  function getRenderState() {
    if (app.snapshots.length === 0) {
      return null;
    }
  
    const latest = app.snapshots[app.snapshots.length - 1];
    const serverNowMs = estimateServerNowMs();
    const latestServerTime = Number(latest.serverTimeMs) || 0;
    const advanceMs = latestServerTime > 0 ? clamp(serverNowMs - latestServerTime, -120, MAX_EXTRAPOLATE_MS) : clamp(nowMs() - latest.receivedAtMs, 0, MAX_EXTRAPOLATE_MS);
    const advancedTick = latest.tick + (advanceMs / 1000) * app.serverTickRate;
    const targetTick = advancedTick - (app.interpDelayMs / 1000) * app.serverTickRate;
  
    while (app.snapshots.length > 4 && app.snapshots[1].tick < targetTick - app.serverTickRate * 0.6) {
      app.snapshots.shift();
    }
  
    const first = app.snapshots[0];
    if (targetTick <= first.tick) {
      return stabilizeRenderState(first.state);
    }
  
    for (let i = 1; i < app.snapshots.length; i += 1) {
      const previous = app.snapshots[i - 1];
      const next = app.snapshots[i];
      if (targetTick <= next.tick) {
        const span = Math.max(1, next.tick - previous.tick);
        const t = clamp((targetTick - previous.tick) / span, 0, 1);
        return stabilizeRenderState(interpolateSnapshotState(previous, next, t));
      }
    }
  
    const extraTicks = Math.max(0, targetTick - latest.tick);
    const extraSeconds = clamp(extraTicks / app.serverTickRate, 0, MAX_EXTRAPOLATE_MS / 1000);
    return stabilizeRenderState(extrapolateState(latest.state, extraSeconds));
  }
  

  return {
    cloneRoute,
    estimateServerNowMs,
    getDisplayRouteForShip,
    getRenderState,
    interpolateSnapshotState,
    extrapolateState,
  };
}
