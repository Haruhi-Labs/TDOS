import { clamp, lerp, shortestAngleDelta } from "../../shared/game/math.js";

function clonePoint(point) {
  if (!point) {
    return { x: 0, y: 0 };
  }
  return { x: point.x, y: point.y };
}

export function cloneRoute(route) {
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

function interpolateRoute(previous, current, ratio) {
  if (!previous && !current) {
    return null;
  }
  if (!previous || !current) {
    return cloneRoute(current);
  }

  const sameEndpoint = Math.hypot(
    previous.p2.x - current.p2.x,
    previous.p2.y - current.p2.y,
  ) <= 0.5;
  const sameAnchorMode = (previous.anchorToMain !== false) === (current.anchorToMain !== false);
  const progressDidNotReset = (Number(current.t) || 0) + 1e-4 >= (Number(previous.t) || 0);
  if (!sameEndpoint || !sameAnchorMode || !progressDidNotReset) {
    // 新建、清除或改道是一次输入状态切换，不是物体运动；若在两条航线之间插值，
    // 右键下达命令后会短暂画出一条从未存在过的中间航线。
    return cloneRoute(current);
  }
  return {
    anchorToMain: current.anchorToMain !== false,
    p0: {
      x: lerp(previous.p0.x, current.p0.x, ratio),
      y: lerp(previous.p0.y, current.p0.y, ratio),
    },
    p1: {
      x: lerp(previous.p1.x, current.p1.x, ratio),
      y: lerp(previous.p1.y, current.p1.y, ratio),
    },
    p2: {
      x: lerp(previous.p2.x, current.p2.x, ratio),
      y: lerp(previous.p2.y, current.p2.y, ratio),
    },
    t: lerp(Number(previous.t) || 0, Number(current.t) || 0, ratio),
  };
}

function interpolateShip(previous, current, ratio) {
  if (!previous || !current) {
    return current || previous || null;
  }

  if (!previous.alive || !current.alive) {
    return ratio < 0.5 ? previous : current;
  }

  return {
    ...current,
    x: lerp(previous.x, current.x, ratio),
    y: lerp(previous.y, current.y, ratio),
    angle: previous.angle + shortestAngleDelta(previous.angle, current.angle) * ratio,
    speed: lerp(previous.speed, current.speed, ratio),
    hp: lerp(previous.hp, current.hp, ratio),
    throttle: lerp(previous.throttle, current.throttle, ratio),
    route: interpolateRoute(previous.route, current.route, ratio),
  };
}

function interpolateShipList(previousList, currentList, ratio) {
  const previousItems = Array.isArray(previousList) ? previousList : [];
  const currentItems = Array.isArray(currentList) ? currentList : [];
  const previousById = new Map(previousItems.map((ship) => [ship.id, ship]));
  return currentItems.map((ship) => {
    const previous = previousById.get(ship.id);
    return previous ? interpolateShip(previous, ship, ratio) : ship;
  });
}

function interpolateUnitList(previousList, currentList, ratio) {
  const previousItems = Array.isArray(previousList) ? previousList : [];
  const currentItems = Array.isArray(currentList) ? currentList : [];
  const previousById = new Map(previousItems.map((item) => [item.id, item]));

  return currentItems.map((current) => {
    const previous = previousById.get(current.id);
    if (!previous || !previous.alive || !current.alive) {
      return current;
    }
    const previousAngle = Number.isFinite(previous.angle) ? previous.angle : 0;
    const currentAngle = Number.isFinite(current.angle) ? current.angle : previousAngle;
    return {
      ...current,
      x: lerp(previous.x, current.x, ratio),
      y: lerp(previous.y, current.y, ratio),
      angle: previousAngle + shortestAngleDelta(previousAngle, currentAngle) * ratio,
      hp: Number.isFinite(previous.hp) && Number.isFinite(current.hp)
        ? lerp(previous.hp, current.hp, ratio)
        : current.hp,
      life: Number.isFinite(previous.life) && Number.isFinite(current.life)
        ? lerp(previous.life, current.life, ratio)
        : current.life,
    };
  });
}

function interpolateBeamList(previousList, currentList, ratio) {
  const previousItems = Array.isArray(previousList) ? previousList : [];
  const currentItems = Array.isArray(currentList) ? currentList : [];
  const previousById = new Map(previousItems.map((item) => [item.id, item]));

  return currentItems.map((current) => {
    const previous = previousById.get(current.id);
    if (!previous) {
      return current;
    }
    return {
      ...current,
      x1: lerp(previous.x1, current.x1, ratio),
      y1: lerp(previous.y1, current.y1, ratio),
      x2: lerp(previous.x2, current.x2, ratio),
      y2: lerp(previous.y2, current.y2, ratio),
      progress: Number.isFinite(previous.progress) && Number.isFinite(current.progress)
        ? lerp(previous.progress, current.progress, ratio)
        : current.progress,
      life: Number.isFinite(previous.life) && Number.isFinite(current.life)
        ? lerp(previous.life, current.life, ratio)
        : current.life,
      maxLife: Number.isFinite(previous.maxLife) && Number.isFinite(current.maxLife)
        ? lerp(previous.maxLife, current.maxLife, ratio)
        : current.maxLife,
    };
  });
}

// 子弹是恒速直线弹道；新生子弹要从当前快照位置沿弹道回退，
// 避免在前后状态只有一端存在时冻结一整个插值区间。
export function advanceProjectile(projectile, deltaSeconds) {
  const speed = Number(projectile.speed) || 0;
  const dx = projectile.targetX - projectile.x;
  const dy = projectile.targetY - projectile.y;
  const remaining = Math.hypot(dx, dy);
  if (speed <= 0 || remaining < 1e-3) {
    return projectile;
  }
  const step = clamp(speed * deltaSeconds, -remaining * 4, remaining);
  return {
    ...projectile,
    x: projectile.x + (dx / remaining) * step,
    y: projectile.y + (dy / remaining) * step,
  };
}

function interpolateProjectileList(previousList, currentList, ratio, spanSeconds) {
  const previousItems = Array.isArray(previousList) ? previousList : [];
  const currentItems = Array.isArray(currentList) ? currentList : [];
  const previousById = new Map(previousItems.map((item) => [item.id, item]));

  return currentItems.map((current) => {
    const previous = previousById.get(current.id);
    if (previous && previous.alive && current.alive) {
      return {
        ...current,
        x: lerp(previous.x, current.x, ratio),
        y: lerp(previous.y, current.y, ratio),
      };
    }
    return advanceProjectile(current, -(1 - ratio) * spanSeconds);
  });
}

function interpolateVisualList(previousList, currentList, ratio) {
  const previousItems = Array.isArray(previousList) ? previousList : [];
  const currentItems = Array.isArray(currentList) ? currentList : [];
  const previousById = new Map(previousItems.map((item) => [item.id, item]));

  return currentItems.map((current) => {
    const previous = previousById.get(current.id);
    if (!previous) {
      return current;
    }
    return {
      ...current,
      x: lerp(previous.x, current.x, ratio),
      y: lerp(previous.y, current.y, ratio),
      radius: Number.isFinite(previous.radius) && Number.isFinite(current.radius)
        ? lerp(previous.radius, current.radius, ratio)
        : current.radius,
      life: Number.isFinite(previous.life) && Number.isFinite(current.life)
        ? lerp(previous.life, current.life, ratio)
        : current.life,
    };
  });
}

function interpolateTeam(previous, current, ratio) {
  if (!previous || !current) {
    return current || previous || null;
  }

  return {
    ...current,
    energy: lerp(previous.energy, current.energy, ratio),
    hullRatio: lerp(previous.hullRatio, current.hullRatio, ratio),
    autoScout: {
      enabled: Boolean(current.autoScout?.enabled),
      zoneId: Number(current.autoScout?.zoneId) || 5,
    },
    cooldowns: {
      scout: lerp(previous.cooldowns?.scout || 0, current.cooldowns?.scout || 0, ratio),
      flagship: lerp(previous.cooldowns?.flagship || 0, current.cooldowns?.flagship || 0, ratio),
      sub1: lerp(previous.cooldowns?.sub1 || 0, current.cooldowns?.sub1 || 0, ratio),
      sub2: lerp(previous.cooldowns?.sub2 || 0, current.cooldowns?.sub2 || 0, ratio),
    },
    haruhiFlagship: {
      ...(current.haruhiFlagship || {}),
      esperOrb: previous.haruhiFlagship?.esperOrb && current.haruhiFlagship?.esperOrb
        ? {
            ...current.haruhiFlagship.esperOrb,
            x: lerp(previous.haruhiFlagship.esperOrb.x, current.haruhiFlagship.esperOrb.x, ratio),
            y: lerp(previous.haruhiFlagship.esperOrb.y, current.haruhiFlagship.esperOrb.y, ratio),
            angle: previous.haruhiFlagship.esperOrb.angle + shortestAngleDelta(
              previous.haruhiFlagship.esperOrb.angle,
              current.haruhiFlagship.esperOrb.angle,
            ) * ratio,
          }
        : current.haruhiFlagship?.esperOrb || null,
    },
    ships: {
      main: interpolateShip(previous.ships.main, current.ships.main, ratio),
      sub1: interpolateShip(previous.ships.sub1, current.ships.sub1, ratio),
      sub2: interpolateShip(previous.ships.sub2, current.ships.sub2, ratio),
    },
    extraShips: interpolateShipList(previous.extraShips, current.extraShips, ratio),
    scouts: interpolateUnitList(previous.scouts, current.scouts, ratio),
    wingmen: interpolateUnitList(previous.wingmen, current.wingmen, ratio),
    beams: interpolateBeamList(previous.beams, current.beams, ratio),
  };
}

// 仅生成显示状态。离散规则字段始终采用当前权威帧，位置、角度、生命和视觉寿命
// 才在前后帧之间过渡，调用方不得把返回值写回仿真。
export function interpolateBattleState(previousState, currentState, ratio, { spanSeconds = 0 } = {}) {
  if (!previousState || !currentState) {
    return currentState || previousState || null;
  }
  const safeRatio = clamp(Number(ratio) || 0, 0, 1);
  const safeSpanSeconds = Math.max(0, Number(spanSeconds) || 0);
  return {
    ...currentState,
    elapsed: lerp(previousState.elapsed, currentState.elapsed, safeRatio),
    phase: currentState.phase,
    winnerSeat: currentState.winnerSeat,
    projectiles: interpolateProjectileList(
      previousState.projectiles,
      currentState.projectiles,
      safeRatio,
      safeSpanSeconds,
    ),
    bursts: interpolateVisualList(previousState.bursts, currentState.bursts, safeRatio),
    floatingTexts: interpolateVisualList(previousState.floatingTexts, currentState.floatingTexts, safeRatio),
    teams: {
      A: interpolateTeam(previousState.teams.A, currentState.teams.A, safeRatio),
      B: interpolateTeam(previousState.teams.B, currentState.teams.B, safeRatio),
    },
  };
}
