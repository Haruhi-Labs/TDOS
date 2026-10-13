import { YUKI_RADAR_ROTATION_SECONDS } from "../../rules/combat-rules.js";
import { clamp, counterClockwiseSweepDistance, distance, lerp, normalizeAngle, stableRadarNoise } from "../../foundation/math.js";

const TAU = Math.PI * 2;
const RADAR_ANGULAR_SPEED = TAU / YUKI_RADAR_ROTATION_SECONDS;
const RADAR_IDENTIFY_ZONE_WIDTHS = 1;
const RADAR_CONTACT_MIN_LIFE = 2.6;
const RADAR_CONTACT_MAX_LIFE = 3.8;

function radarMaxDistanceFrom(size, source) {
  return Math.max(
    Math.hypot(source.x, source.y),
    Math.hypot(size - source.x, source.y),
    Math.hypot(source.x, size - source.y),
    Math.hypot(size - source.x, size - source.y),
    1,
  );
}

function createRadarContact({ worldSize, tick, now }, target, source, scanSequence) {
  const targetDistance = distance(source.x, source.y, target.x, target.y);
  const distanceRatio = clamp(targetDistance / radarMaxDistanceFrom(worldSize, source), 0, 1);
  const clarity = clamp(0.96 - distanceRatio * 0.86, 0.12, 0.9);
  const uncertainty = 10 + 210 * distanceRatio * distanceRatio;
  const seed = target.id * 131 + scanSequence * 977 + tick * 17;
  const errorAngle = stableRadarNoise(seed, 1) * TAU;
  const errorDistance = uncertainty * Math.sqrt(stableRadarNoise(seed, 2));
  const headingError = (stableRadarNoise(seed, 3) - 0.5) * (0.15 + distanceRatio * 0.9);
  const identifyDistance = (worldSize / 3) * RADAR_IDENTIFY_ZONE_WIDTHS;
  const afterimage = targetDistance <= identifyDistance;
  const life = lerp(RADAR_CONTACT_MIN_LIFE, RADAR_CONTACT_MAX_LIFE, clarity);

  return {
    id: target.id,
    targetId: target.id,
    x: clamp(target.x + Math.cos(errorAngle) * errorDistance, 8, worldSize - 8),
    y: clamp(target.y + Math.sin(errorAngle) * errorDistance, 8, worldSize - 8),
    angle: normalizeAngle((Number(target.angle) || 0) + headingError),
    kind: afterimage ? "afterimage" : "disturbance",
    characterId: afterimage ? target.characterId : null,
    clarity,
    uncertainty,
    distanceRatio,
    detectedAt: now,
    expiresAt: now + life,
    seed: Math.floor(stableRadarNoise(seed, 4) * 1_000_000),
  };
}

// 只持有扫描相位、序号和回波；输入是当次值样本，输出是待识别的目标编号。
export class RadarRuntime {
  #epochAngle;
  #angle;
  #scanSequence = 0;
  #contacts = new Map();

  constructor(facing) {
    this.#epochAngle = normalizeAngle(facing);
    this.#angle = this.#epochAngle;
  }

  advance({ source, targets, now, tick, worldSize }, dt) {
    const revealedIds = [];
    if (!source) {
      this.#contacts.clear();
      return revealedIds;
    }
    const targetById = new Map(targets.map((target) => [target.id, target]));
    for (const [targetId, contact] of this.#contacts) {
      const target = targetById.get(targetId);
      if (!target?.alive || contact.expiresAt <= now || target.visible) this.#contacts.delete(targetId);
    }

    // 角度只由对局绝对时间决定，舰队移动只改变雷达圆心。
    const safeDt = Math.max(0, Number(dt) || 0);
    const previousTime = Math.max(0, now - safeDt);
    const previousAngle = normalizeAngle(this.#epochAngle - RADAR_ANGULAR_SPEED * previousTime);
    this.#angle = normalizeAngle(this.#epochAngle - RADAR_ANGULAR_SPEED * now);
    const sweepDistance = Math.min(TAU, RADAR_ANGULAR_SPEED * (now - previousTime));

    for (const target of targets) {
      if (!target.alive) continue;
      const bearing = normalizeAngle(Math.atan2(target.y - source.y, target.x - source.x));
      if (counterClockwiseSweepDistance(previousAngle, bearing) > sweepDistance + 1e-9) continue;
      if (target.visible) {
        revealedIds.push(target.id);
        this.#contacts.delete(target.id);
        continue;
      }
      this.#scanSequence += 1;
      this.#contacts.set(target.id, createRadarContact({ worldSize, tick, now }, target, source, this.#scanSequence));
    }
    return revealedIds;
  }

  // 公开扫线不含私有回波；读取不推进扫描，也不清理状态。
  sweep(sourceShipId, now) {
    if (sourceShipId === null) return null;
    return {
      active: true,
      sourceShipId,
      angle: this.#angle,
      angularVelocity: -RADAR_ANGULAR_SPEED,
      rotationSeconds: YUKI_RADAR_ROTATION_SECONDS,
      sampledAt: now,
    };
  }

  snapshot(sourceShipId, now) {
    const sweep = this.sweep(sourceShipId, now);
    if (!sweep) return null;
    return { ...sweep, contacts: [...this.#contacts.values()].map((contact) => ({ ...contact })) };
  }
}
