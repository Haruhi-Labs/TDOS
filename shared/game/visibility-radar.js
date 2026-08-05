import { YUKI_RADAR_ROTATION_SECONDS } from "./combat-rules.js";
import {
  clamp,
  counterClockwiseSweepDistance,
  distance,
  distanceSq,
  lerp,
  normalizeAngle,
  stableRadarNoise,
} from "./math.js";

const TAU = Math.PI * 2;
const RADAR_ANGULAR_SPEED = TAU / YUKI_RADAR_ROTATION_SECONDS;
const RADAR_IDENTIFY_ZONE_WIDTHS = 1;
const RADAR_CONTACT_MIN_LIFE = 2.6;
const RADAR_CONTACT_MAX_LIFE = 3.8;

export function radarMaxDistanceFrom(team, source) {
  const size = team.match.worldSize;
  return Math.max(
    Math.hypot(source.x, source.y),
    Math.hypot(size - source.x, source.y),
    Math.hypot(source.x, size - source.y),
    Math.hypot(size - source.x, size - source.y),
    1,
  );
}

export function createRadarContact(team, target, source) {
  const radar = team.radarPassive;
  radar.scanSequence += 1;
  const targetDistance = distance(source.x, source.y, target.x, target.y);
  const distanceRatio = clamp(targetDistance / radarMaxDistanceFrom(team, source), 0, 1);
  const clarity = clamp(0.96 - distanceRatio * 0.86, 0.12, 0.9);
  const uncertainty = 10 + 210 * distanceRatio * distanceRatio;
  const seed = target.id * 131 + radar.scanSequence * 977 + team.match.tick * 17;
  const errorAngle = stableRadarNoise(seed, 1) * TAU;
  const errorDistance = uncertainty * Math.sqrt(stableRadarNoise(seed, 2));
  const headingError = (stableRadarNoise(seed, 3) - 0.5) * (0.15 + distanceRatio * 0.9);
  const identifyDistance = (team.match.worldSize / 3) * RADAR_IDENTIFY_ZONE_WIDTHS;
  const afterimage = targetDistance <= identifyDistance;
  const life = lerp(RADAR_CONTACT_MIN_LIFE, RADAR_CONTACT_MAX_LIFE, clarity);

  return {
    id: target.id,
    targetId: target.id,
    x: clamp(target.x + Math.cos(errorAngle) * errorDistance, 8, team.match.worldSize - 8),
    y: clamp(target.y + Math.sin(errorAngle) * errorDistance, 8, team.match.worldSize - 8),
    angle: normalizeAngle((Number(target.angle) || 0) + headingError),
    kind: afterimage ? "afterimage" : "disturbance",
    characterId: afterimage ? target.characterId : null,
    clarity,
    uncertainty,
    distanceRatio,
    detectedAt: team.match.elapsed,
    expiresAt: team.match.elapsed + life,
    seed: Math.floor(stableRadarNoise(seed, 4) * 1_000_000),
  };
}

export function updateRadarPassive(team, enemyTeam, dt) {
  const radar = team.radarPassive;
  const source = team.ships.main;
  if (!radar || !team.hasYukiFlagship() || !source?.alive) {
    if (radar) radar.contacts.clear();
    return;
  }

  const now = team.match.elapsed;
  const enemyById = new Map(enemyTeam.getAllShips().map((ship) => [ship.id, ship]));
  for (const [targetId, contact] of radar.contacts) {
    const target = enemyById.get(targetId);
    if (!target?.alive || contact.expiresAt <= now || team.visibleEnemyIds.has(targetId)) {
      radar.contacts.delete(targetId);
    }
  }

  // 角度只由对局绝对时间决定，舰队移动只改变雷达圆心。
  const safeDt = Math.max(0, Number(dt) || 0);
  const previousTime = Math.max(0, now - safeDt);
  const previousAngle = normalizeAngle(radar.epochAngle - RADAR_ANGULAR_SPEED * previousTime);
  const currentAngle = normalizeAngle(radar.epochAngle - RADAR_ANGULAR_SPEED * now);
  const sweepDistance = Math.min(TAU, RADAR_ANGULAR_SPEED * (now - previousTime));
  radar.angle = currentAngle;

  for (const target of enemyTeam.getAllShips()) {
    if (!target.alive) continue;
    const bearing = normalizeAngle(Math.atan2(target.y - source.y, target.x - source.x));
    if (counterClockwiseSweepDistance(previousAngle, bearing) > sweepDistance + 1e-9) continue;
    if (team.visibleEnemyIds.has(target.id)) {
      target.nameRevealed = true;
      radar.contacts.delete(target.id);
      continue;
    }
    radar.contacts.set(target.id, createRadarContact(team, target, source));
  }
}

export function serializeRadarPassive(team) {
  const source = team.ships.main;
  if (!team.hasYukiFlagship() || !source?.alive || !team.radarPassive) return null;
  return {
    active: true,
    sourceShipId: source.id,
    angle: team.radarPassive.angle,
    angularVelocity: -RADAR_ANGULAR_SPEED,
    rotationSeconds: YUKI_RADAR_ROTATION_SECONDS,
    sampledAt: team.match.elapsed,
    contacts: [...team.radarPassive.contacts.values()].map((contact) => ({ ...contact })),
  };
}

export function computeVisibility(team, enemyTeam) {
  team.visibleEnemyIds.clear();
  const sensors = team.getVisionSources();
  if (sensors.length === 0) {
    if (team.effects.revealEnemiesUntil > team.match.elapsed) {
      for (const enemy of enemyTeam.getEntities()) team.visibleEnemyIds.add(enemy.id);
    }
    return;
  }

  const enemyEntities = enemyTeam.getEntities();
  for (const enemy of enemyEntities) {
    for (const sensor of sensors) {
      if (distanceSq(enemy.x, enemy.y, sensor.x, sensor.y) <= sensor.range * sensor.range) {
        team.visibleEnemyIds.add(enemy.id);
        break;
      }
    }
  }
  if (team.effects.revealEnemiesUntil > team.match.elapsed) {
    for (const enemy of enemyEntities) team.visibleEnemyIds.add(enemy.id);
  }
}
