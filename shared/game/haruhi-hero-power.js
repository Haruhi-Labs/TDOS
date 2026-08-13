import { clamp, distance } from "./math.js";

export const HARUHI_HERO_POWER_CHARGE_SECONDS = 0.8;
export const HARUHI_HERO_POWER_LOCK_SECONDS = 1;
export const HARUHI_HERO_POWER_RECOVERY_SECONDS = 4;
export const HARUHI_HERO_POWER_VISUAL_SECONDS = 1.15;
export const HARUHI_HERO_POWER_ZONE_RADIUS_RATIO = 0.5;

export function createHaruhiHeroPowerShockState() {
  return {
    hitAt: 0,
    lockUntil: 0,
    recoveryUntil: 0,
  };
}

export function isHaruhiHeroPowerControlLocked(ship, now = ship?.team?.match?.elapsed || 0) {
  return Boolean(ship?.heroPowerShock && Number(ship.heroPowerShock.lockUntil) > now);
}

export function haruhiHeroPowerSpeedFactor(ship, now = ship?.team?.match?.elapsed || 0) {
  const shock = ship?.heroPowerShock;
  if (!shock || Number(shock.recoveryUntil) <= now) {
    return 1;
  }
  if (Number(shock.lockUntil) > now) {
    return 0;
  }
  const recoveryDuration = Math.max(0.001, shock.recoveryUntil - shock.lockUntil);
  return clamp((now - shock.lockUntil) / recoveryDuration, 0, 1);
}

export function applyHaruhiHeroPowerShock(ship, now, options = {}) {
  if (!ship?.alive) {
    return false;
  }
  const lockDuration = Math.max(0, Number(options.lockDuration) || HARUHI_HERO_POWER_LOCK_SECONDS);
  const recoveryDuration = Math.max(0, Number(options.recoveryDuration) || HARUHI_HERO_POWER_RECOVERY_SECONDS);
  ship.heroPowerShock = {
    hitAt: now,
    lockUntil: now + lockDuration,
    recoveryUntil: now + lockDuration + recoveryDuration,
  };
  ship.speed = 0;
  return true;
}

export function serializeHaruhiHeroPowerShock(ship) {
  const now = ship?.team?.match?.elapsed || 0;
  const shock = ship?.heroPowerShock;
  const active = Boolean(shock && Number(shock.recoveryUntil) > now);
  return {
    active,
    controlLocked: active && Number(shock.lockUntil) > now,
    lockRemaining: active ? Math.max(0, shock.lockUntil - now) : 0,
    recoveryRemaining: active ? Math.max(0, shock.recoveryUntil - now) : 0,
    speedFactor: active ? haruhiHeroPowerSpeedFactor(ship, now) : 1,
  };
}

export function createHaruhiHeroPowerEvent({ id, ship, now, worldSize, meta = {} }) {
  const zoneWidth = Math.max(1, Number(worldSize) || 1440) / 3;
  const chargeDuration = Math.max(
    0.1,
    Number(meta.chargeDuration) || HARUHI_HERO_POWER_CHARGE_SECONDS,
  );
  return {
    id,
    teamSeat: ship.team.seat,
    casterShipId: ship.id,
    shipKey: ship.key,
    phase: "charge",
    x: ship.x,
    y: ship.y,
    radius: zoneWidth * (Number(meta.radiusZoneRatio) || HARUHI_HERO_POWER_ZONE_RADIUS_RATIO),
    startedAt: now,
    releaseAt: now + chargeDuration,
    chargeDuration,
    lockDuration: Math.max(0, Number(meta.lockDuration) || HARUHI_HERO_POWER_LOCK_SECONDS),
    recoveryDuration: Math.max(0, Number(meta.recoveryDuration) || HARUHI_HERO_POWER_RECOVERY_SECONDS),
    progress: 0,
    life: chargeDuration,
    maxLife: chargeDuration,
    hitShipIds: [],
    destroyedAircraftIds: [],
  };
}

function destroyAircraftWithin(match, event, caster) {
  const destroyedIds = [];
  for (const team of [match.teamA, match.teamB]) {
    for (const aircraft of [...team.scouts, ...team.wingmen]) {
      if (!aircraft.alive) continue;
      if (distance(event.x, event.y, aircraft.x, aircraft.y) > event.radius + (aircraft.radius || 0)) {
        continue;
      }
      aircraft.takeDamage(Infinity, caster, match);
      if (!aircraft.alive) {
        destroyedIds.push(aircraft.id);
      }
    }
  }
  return destroyedIds;
}

function releaseHaruhiHeroPower(match, event, caster) {
  const now = match.elapsed;
  const enemyTeam = match.enemyTeamBySeat(event.teamSeat);
  event.phase = "shock";
  event.x = caster.x;
  event.y = caster.y;
  event.releasedAt = now;
  event.expiresAt = now + HARUHI_HERO_POWER_VISUAL_SECONDS;
  event.life = HARUHI_HERO_POWER_VISUAL_SECONDS;
  event.maxLife = HARUHI_HERO_POWER_VISUAL_SECONDS;
  event.progress = 0;
  event.hitShipIds = enemyTeam.getAllShips()
    .filter((ship) => (
      ship.alive
      && distance(event.x, event.y, ship.x, ship.y) <= event.radius + ship.radius
    ))
    .filter((ship) => applyHaruhiHeroPowerShock(ship, now, {
      lockDuration: event.lockDuration,
      recoveryDuration: event.recoveryDuration,
    }))
    .map((ship) => ship.id);
  event.destroyedAircraftIds = destroyAircraftWithin(match, event, caster);

  match.spawnBurst(event.x, event.y, "#fff0b5", 14);
  for (const ship of enemyTeam.getAllShips()) {
    if (!event.hitShipIds.includes(ship.id)) continue;
    match.spawnFloatingTextKey(ship.x + 10, ship.y - 14, "震慑", {}, "#ffe29a");
  }
}

export function updateHaruhiHeroPowerEvent(match, event) {
  const casterTeam = match.teamBySeat(event.teamSeat);
  const caster = casterTeam?.getAllShips().find((ship) => ship.id === event.casterShipId);
  if (event.phase === "charge") {
    if (!caster?.alive || caster.isAttached()) {
      return false;
    }
    event.x = caster.x;
    event.y = caster.y;
    event.life = Math.max(0, event.releaseAt - match.elapsed);
    event.progress = clamp(
      (match.elapsed - event.startedAt) / Math.max(0.001, event.chargeDuration),
      0,
      1,
    );
    if (match.elapsed + 1e-9 >= event.releaseAt) {
      releaseHaruhiHeroPower(match, event, caster);
    }
    return true;
  }

  event.life = Math.max(0, event.expiresAt - match.elapsed);
  event.progress = clamp(
    (match.elapsed - event.releasedAt) / HARUHI_HERO_POWER_VISUAL_SECONDS,
    0,
    1,
  );
  return event.life > 0;
}

export function serializeHaruhiHeroPowerEvent(event) {
  return {
    id: event.id,
    teamSeat: event.teamSeat,
    casterShipId: event.casterShipId,
    phase: event.phase,
    x: event.x,
    y: event.y,
    radius: event.radius,
    progress: event.progress,
    life: event.life,
    maxLife: event.maxLife,
    hitShipIds: [...event.hitShipIds],
    destroyedAircraftIds: [...event.destroyedAircraftIds],
  };
}
