import { distance, linePointDistance } from "./math.js";
import {
  HARUHI_SUPPORTS, createSupportState, unlockSupport, tickSupportSource,
  supportOrbGeometry, supportOtherworlderReady, triggerSupportOtherworlder,
} from "./haruhi-support.js";

// 保留旧导入路径和导出集合，调用方无需随内部抽取改动。
export {
  HARUHI_SUPPORTS, HARUHI_SUPPORT_LABELS, HARUHI_ALIEN_INTERVAL,
  HARUHI_TIME_TRAVELER_INTERVAL, HARUHI_TIME_TRAVELER_BEAM_GAP,
  HARUHI_OTHERWORLDER_COOLDOWN, HARUHI_OTHERWORLDER_DAMAGE_RATIO,
  HARUHI_OTHERWORLDER_KNOCKBACK_DURATION, HARUHI_ESPER_ORBIT_SPEED,
  HARUHI_ESPER_ABSORB_RADIUS_MULTIPLIER,
} from "./haruhi-support.js";

export const HARUHI_BOOST_MULTIPLIER = 1.15;
export const HARUHI_DAMAGE_TAKEN_MULTIPLIER = 0.85;

export function createHaruhiFlagshipState(initialAngle = 0) {
  return createSupportState(initialAngle);
}

function flagshipSupportSource(team) {
  if (!team || team.mainCharacterId() !== "haruhi") return null;
  // 普通春日沿用原存活判断；不附加新角色的封印/恢复语义。
  return { sourceShip: team.ships.main, state: team.haruhiFlagship, enabled: true };
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

  return unlockSupport(team.haruhiFlagship, HARUHI_SUPPORTS, now, random);
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
  const source = flagshipSupportSource(team);
  if (source) tickSupportSource(source, team.match.elapsed, hooks.dt, hooks);
}

export function haruhiEsperOrb(team) {
  if (!hasHaruhiSupport(team, "esper")) return null;
  return supportOrbGeometry(flagshipSupportSource(team));
}

export function haruhiOtherworlderReady(team) {
  if (!hasHaruhiSupport(team, "otherworlder")) return false;
  return supportOtherworlderReady(flagshipSupportSource(team), team.match.elapsed);
}

export function triggerHaruhiOtherworlder(team) {
  if (!haruhiOtherworlderReady(team)) {
    return false;
  }
  return triggerSupportOtherworlder(flagshipSupportSource(team), team.match.elapsed);
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
