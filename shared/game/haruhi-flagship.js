import { clamp, distance, linePointDistance, normalizeAngle } from "./math.js";

export const HARUHI_SUPPORTS = Object.freeze([
  "alien",
  "time_traveler",
  "otherworlder",
  "esper",
]);

export const HARUHI_SUPPORT_LABELS = Object.freeze({
  alien: "宇宙人",
  time_traveler: "未来人",
  otherworlder: "异世界人",
  esper: "超能力者",
});

export const HARUHI_BOOST_MULTIPLIER = 1.15;
export const HARUHI_DAMAGE_TAKEN_MULTIPLIER = 0.85;
export const HARUHI_ALIEN_INTERVAL = 6;
export const HARUHI_TIME_TRAVELER_INTERVAL = 10;
export const HARUHI_TIME_TRAVELER_BEAM_GAP = 0.3;
export const HARUHI_OTHERWORLDER_COOLDOWN = 8;
export const HARUHI_OTHERWORLDER_DAMAGE_RATIO = 0.15;
export const HARUHI_OTHERWORLDER_KNOCKBACK_DURATION = 0.85;
export const HARUHI_ESPER_ORBIT_SPEED = 0.72;
export const HARUHI_ESPER_ABSORB_RADIUS_MULTIPLIER = 3;

export function createHaruhiFlagshipState(initialAngle = 0) {
  return {
    supporters: new Set(),
    alienNextAt: 0,
    timeTravelerNextAt: 0,
    queuedBeamAt: [],
    otherworlderReadyAt: 0,
    esperAngle: normalizeAngle(initialAngle),
  };
}

export function hasHaruhiSupport(team, supportId) {
  return Boolean(
    team?.mainCharacterId?.() === "haruhi"
      && team.haruhiFlagship?.supporters?.has(supportId),
  );
}

export function activateHaruhiFlagship(team, duration, random = Math.random) {
  if (!team || team.mainCharacterId() !== "haruhi") {
    return null;
  }
  const now = team.match.elapsed;
  team.effects.haruhiBoostUntil = now + Math.max(0, Number(duration) || 0);
  team.markActiveSkillEffectStarted("haruhiBoostUntil");

  const remaining = HARUHI_SUPPORTS.filter((id) => !team.haruhiFlagship.supporters.has(id));
  if (remaining.length === 0) {
    return null;
  }
  const roll = clamp(Number(random()) || 0, 0, 0.999999);
  const supportId = remaining[Math.floor(roll * remaining.length)];
  team.haruhiFlagship.supporters.add(supportId);
  if (supportId === "alien") {
    team.haruhiFlagship.alienNextAt = now + HARUHI_ALIEN_INTERVAL;
  } else if (supportId === "time_traveler") {
    team.haruhiFlagship.timeTravelerNextAt = now + HARUHI_TIME_TRAVELER_INTERVAL;
  } else if (supportId === "otherworlder") {
    team.haruhiFlagship.otherworlderReadyAt = now;
  }
  return supportId;
}

export function haruhiBoostActive(team) {
  return Boolean(
    team?.mainCharacterId?.() === "haruhi"
      && Number(team.effects?.haruhiBoostUntil || 0) > team.match.elapsed,
  );
}

export function haruhiStatMultiplier(team, statKey) {
  if (!haruhiBoostActive(team)) {
    return 1;
  }
  return ["speed", "turnRate", "accel", "range", "vision", "damage", "fireRate"].includes(statKey)
    ? HARUHI_BOOST_MULTIPLIER
    : 1;
}

export function haruhiDamageTakenMultiplier(team) {
  return haruhiBoostActive(team) ? HARUHI_DAMAGE_TAKEN_MULTIPLIER : 1;
}

export function updateHaruhiFlagship(team, hooks = {}) {
  if (!team || team.mainCharacterId() !== "haruhi") {
    return;
  }
  const main = team.ships.main;
  const state = team.haruhiFlagship;
  const now = team.match.elapsed;
  if (!main?.alive) {
    state.queuedBeamAt.length = 0;
    return;
  }

  if (hasHaruhiSupport(team, "alien")) {
    while (state.alienNextAt > 0 && now + 1e-9 >= state.alienNextAt) {
      hooks.launchAlienWingmen?.(main);
      state.alienNextAt += HARUHI_ALIEN_INTERVAL;
    }
  }

  if (hasHaruhiSupport(team, "time_traveler")) {
    while (state.timeTravelerNextAt > 0 && now + 1e-9 >= state.timeTravelerNextAt) {
      state.queuedBeamAt.push(
        state.timeTravelerNextAt,
        state.timeTravelerNextAt + HARUHI_TIME_TRAVELER_BEAM_GAP,
        state.timeTravelerNextAt + HARUHI_TIME_TRAVELER_BEAM_GAP * 2,
      );
      state.timeTravelerNextAt += HARUHI_TIME_TRAVELER_INTERVAL;
    }
    while (state.queuedBeamAt.length > 0 && now + 1e-9 >= state.queuedBeamAt[0]) {
      state.queuedBeamAt.shift();
      hooks.launchRandomBeam?.(main);
    }
  }

  if (hasHaruhiSupport(team, "esper")) {
    state.esperAngle = normalizeAngle(state.esperAngle + HARUHI_ESPER_ORBIT_SPEED * (Number(hooks.dt) || 0));
  }
}

export function haruhiEsperOrb(team) {
  if (!hasHaruhiSupport(team, "esper")) {
    return null;
  }
  const main = team.ships.main;
  if (!main?.alive) {
    return null;
  }
  const orbitRadius = main.effectiveVision();
  const radius = Math.max(8, main.radius * 0.92);
  return {
    x: main.x + Math.cos(team.haruhiFlagship.esperAngle) * orbitRadius,
    y: main.y + Math.sin(team.haruhiFlagship.esperAngle) * orbitRadius,
    angle: team.haruhiFlagship.esperAngle,
    orbitRadius,
    radius,
    absorbRadius: radius * HARUHI_ESPER_ABSORB_RADIUS_MULTIPLIER,
  };
}

export function haruhiOtherworlderReady(team) {
  return Boolean(
    hasHaruhiSupport(team, "otherworlder")
      && team.ships.main?.alive
      && team.match.elapsed + 1e-9 >= team.haruhiFlagship.otherworlderReadyAt,
  );
}

export function triggerHaruhiOtherworlder(team) {
  if (!haruhiOtherworlderReady(team)) {
    return false;
  }
  team.haruhiFlagship.otherworlderReadyAt = team.match.elapsed + HARUHI_OTHERWORLDER_COOLDOWN;
  return true;
}

export function projectileAbsorptionPoint(projectile, dt, orb) {
  if (!projectile?.alive || !orb) {
    return null;
  }
  const dx = projectile.targetX - projectile.x;
  const dy = projectile.targetY - projectile.y;
  const remaining = Math.hypot(dx, dy);
  if (remaining < 1e-6) {
    return distance(projectile.x, projectile.y, orb.x, orb.y) <= orb.absorbRadius
      ? { x: projectile.x, y: projectile.y }
      : null;
  }
  const step = Math.min(remaining, Math.max(0, Number(projectile.speed) || 0) * Math.max(0, Number(dt) || 0));
  const nextX = projectile.x + (dx / remaining) * step;
  const nextY = projectile.y + (dy / remaining) * step;
  const probe = linePointDistance(projectile.x, projectile.y, nextX, nextY, orb.x, orb.y);
  if (probe.dist > orb.absorbRadius) {
    return null;
  }
  return {
    x: projectile.x + (nextX - projectile.x) * probe.t,
    y: projectile.y + (nextY - projectile.y) * probe.t,
  };
}

export function serializeHaruhiFlagship(team) {
  const orb = haruhiEsperOrb(team);
  return {
    boostActive: haruhiBoostActive(team),
    supporters: HARUHI_SUPPORTS.filter((id) => team.haruhiFlagship.supporters.has(id)),
    otherworlderReady: haruhiOtherworlderReady(team),
    esperOrb: orb ? { ...orb } : null,
  };
}
