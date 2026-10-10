import { clamp, distance, lerp, shortestAngleDelta } from "../../shared/game/math.js";
import { advanceStatusEffects } from "../battle/status-effect-timing.js";
import {
  advanceProjectile,
  advanceVisualEffect,
  cloneRoute,
  interpolateBattleState,
} from "../battle/state-interpolation.js";

export function createOnlineStateSync({ timeline, pruneBefore = () => {}, getSeat = () => null, getRouteOverride = () => null, nowMs, worldSize, maxExtrapolateMs }) {
  const smoothEntities = new Map();
  let lastRenderMs = 0;
  function reset() {
    smoothEntities.clear();
    lastRenderMs = 0;
  }

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
    const override = getRouteOverride(ship.key);
    if (override && override.route) {
      return override.route;
    }
    return ship.route || null;
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
  
  function extrapolateShip(ship, dt) {
    if (!ship || !ship.alive) {
      return ship;
    }
    return {
      ...ship,
      statusEffects: advanceStatusEffects(ship.statusEffects, dt),
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
        ? state.bursts.map((b) => advanceVisualEffect(b, safeDt))
        : state.bursts,
      haruhiHeroPowerEffects: Array.isArray(state.haruhiHeroPowerEffects)
        ? state.haruhiHeroPowerEffects.map((effect) => ({
            ...effect,
            progress: clamp(
              (Number(effect.progress) || 0) + safeDt / Math.max(0.001, Number(effect.maxLife) || 0.8),
              0,
              1,
            ),
            life: Math.max(0, (Number(effect.life) || 0) - safeDt),
          }))
        : state.haruhiHeroPowerEffects,
      shamisenHuntKillEffects: Array.isArray(state.shamisenHuntKillEffects)
        ? state.shamisenHuntKillEffects.map((effect) => ({
            ...effect,
            life: Math.max(0, (Number(effect.life) || 0) - safeDt),
          }))
        : state.shamisenHuntKillEffects,
      koizumiBarrierImpacts: Array.isArray(state.koizumiBarrierImpacts)
        ? state.koizumiBarrierImpacts.map((effect) => advanceVisualEffect(effect, safeDt))
        : state.koizumiBarrierImpacts,
      floatingTexts: Array.isArray(state.floatingTexts)
        ? state.floatingTexts.map((f) => ({ ...f, life: Math.max(0, (Number(f.life) || 0) - safeDt) }))
        : state.floatingTexts,
      teams: {
        A: {
          ...state.teams.A,
          beams: (state.teams.A.beams || []).map((beam) => advanceVisualEffect(beam, safeDt)),
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
          beams: (state.teams.B.beams || []).map((beam) => advanceVisualEffect(beam, safeDt)),
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
    if (!timeline.clockReady) {
      return nowMs();
    }
    return nowMs() + timeline.clockOffsetMs;
  }
  
  function smoothEntity(entity, dt, followRate, teleportDistance, teamSeat) {
    if (!entity || !Number.isFinite(entity.id)) {
      return entity;
    }
    if (!entity.alive) {
      smoothEntities.delete(entity.id);
      return entity;
    }
  
    const cache = smoothEntities.get(entity.id);
    const seenAt = nowMs();
    // 只有新伴随舰需要换队隔离；旧飞行器保留原平滑行为。
    const companion = entity.entityRole === "bunny_kyon";
    if (!cache || (companion && cache.teamSeat !== teamSeat)) {
      smoothEntities.set(entity.id, {
        x: entity.x,
        y: entity.y,
        angle: entity.angle || 0,
        seenAt,
        ...(companion ? { teamSeat } : {}),
      });
      return entity;
    }
  
    const d = distance(cache.x, cache.y, entity.x, entity.y);
    if (d > teleportDistance) {
      smoothEntities.set(entity.id, {
        x: entity.x,
        y: entity.y,
        angle: entity.angle || 0,
        seenAt,
        ...(companion ? { teamSeat } : {}),
      });
      return entity;
    }
  
    const alpha = clamp(1 - Math.exp(-dt * followRate), 0.08, 1);
    const x = lerp(cache.x, entity.x, alpha);
    const y = lerp(cache.y, entity.y, alpha);
    const baseAngle = Number.isFinite(cache.angle) ? cache.angle : entity.angle || 0;
    const targetAngle = Number.isFinite(entity.angle) ? entity.angle : baseAngle;
    const angle = baseAngle + shortestAngleDelta(baseAngle, targetAngle) * alpha;
  
    smoothEntities.set(entity.id, {
      x,
      y,
      angle,
      seenAt,
      ...(companion ? { teamSeat } : {}),
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
        ? team.extraShips.map((ship) => smoothEntity(ship, dt, followRate, teleportDistance, team.seat))
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
    const dt = lastRenderMs > 0 ? clamp((renderNowMs - lastRenderMs) / 1000, 1 / 144, 0.05) : 1 / 60;
    lastRenderMs = renderNowMs;
  
    for (const [entityId, cache] of smoothEntities) {
      if (renderNowMs - cache.seenAt > 1400) {
        smoothEntities.delete(entityId);
      }
    }
  
    const ownSeat = getSeat() || "A";
    return {
      ...state,
      teams: {
        A: smoothTeamState(state.teams.A, ownSeat === "A", dt),
        B: smoothTeamState(state.teams.B, ownSeat === "B", dt),
      },
    };
  }
  
  function interpolateSnapshotState(previousSnapshot, nextSnapshot, t) {
    return interpolateBattleState(previousSnapshot.state, nextSnapshot.state, t, {
      spanSeconds: Math.max(1, nextSnapshot.tick - previousSnapshot.tick) / timeline.serverTickRate,
    });
  }
  
  function getRenderState() {
    let snapshots = timeline.snapshots;
    if (snapshots.length === 0) {
      return null;
    }
  
    const latest = snapshots[snapshots.length - 1];
    const serverNowMs = estimateServerNowMs();
    const latestServerTime = Number(latest.serverTimeMs) || 0;
    const advanceMs = latestServerTime > 0 ? clamp(serverNowMs - latestServerTime, -120, MAX_EXTRAPOLATE_MS) : clamp(nowMs() - latest.receivedAtMs, 0, MAX_EXTRAPOLATE_MS);
    const advancedTick = latest.tick + (advanceMs / 1000) * timeline.serverTickRate;
    const targetTick = advancedTick - (timeline.interpDelayMs / 1000) * timeline.serverTickRate;
  
    pruneBefore(targetTick);
    snapshots = timeline.snapshots;
  
    const first = snapshots[0];
    if (targetTick <= first.tick) {
      return stabilizeRenderState(first.state);
    }
  
    for (let i = 1; i < snapshots.length; i += 1) {
      const previous = snapshots[i - 1];
      const next = snapshots[i];
      if (targetTick <= next.tick) {
        const span = Math.max(1, next.tick - previous.tick);
        const t = clamp((targetTick - previous.tick) / span, 0, 1);
        return stabilizeRenderState(interpolateSnapshotState(previous, next, t));
      }
    }
  
    const extraTicks = Math.max(0, targetTick - latest.tick);
    const extraSeconds = clamp(extraTicks / timeline.serverTickRate, 0, MAX_EXTRAPOLATE_MS / 1000);
    return stabilizeRenderState(extrapolateState(latest.state, extraSeconds));
  }
  

  return {
    reset,
    cloneRoute,
    estimateServerNowMs,
    getDisplayRouteForShip,
    getRenderState,
    interpolateSnapshotState,
    extrapolateState,
  };
}
