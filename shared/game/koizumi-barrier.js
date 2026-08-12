import { clamp } from "./math.js";
import { isKoizumiOrbActive } from "./koizumi-orb.js";
import { haruhiRamApproachEligible } from "./collision-system.js";
import {
  haruhiOtherworlderReady,
  triggerHaruhiOtherworlder,
} from "./haruhi-flagship.js";

export const KOIZUMI_BARRIER_DISABLE_SECONDS = 5;

const HARUHI_BARRIER_CONTACT_TOLERANCE = 5;
const ENTRY_EPSILON = 0.35;
const RECOVERY_EFFECT_SECONDS = 0.9;

export function createKoizumiBarrierState() {
  return {
    disabledAt: null,
    disabledUntil: 0,
  };
}

export function hasKoizumiBarrier(team) {
  return Boolean(
    team?.mainCharacterId?.() === "koizumi"
      && team.ships?.main?.alive,
  );
}

export function koizumiBarrierGeometry(team) {
  if (!hasKoizumiBarrier(team)) {
    return null;
  }
  const main = team.ships.main;
  const now = team.match.elapsed;
  const disabledRemaining = Math.max(0, Number(team.koizumiBarrier?.disabledUntil || 0) - now);
  const disabledAt = team.koizumiBarrier?.disabledAt;
  const recoveryAge = disabledRemaining > 0 || !Number.isFinite(disabledAt)
    ? 0
    // 重组动画结束后固定为上限，避免这个仅供显示的值永久逐帧变化，
    // 令多人差量包持续携带无意义的护盾状态更新。
    : clamp(
      now - Number(team.koizumiBarrier.disabledUntil || 0),
      0,
      RECOVERY_EFFECT_SECONDS,
    );
  return {
    x: main.x,
    y: main.y,
    radius: Math.max(1, main.effectiveVision()),
    active: disabledRemaining <= 0,
    disabledRemaining,
    recoveryProgress: disabledRemaining > 0
      ? clamp(1 - disabledRemaining / KOIZUMI_BARRIER_DISABLE_SECONDS, 0, 1)
      : 1,
    recoveryAge,
  };
}

export function isKoizumiBarrierActive(team) {
  return Boolean(koizumiBarrierGeometry(team)?.active);
}

function segmentCircleEntry(startX, startY, endX, endY, centerX, centerY, radius) {
  const relativeX = startX - centerX;
  const relativeY = startY - centerY;
  const safeRadius = Math.max(0, Number(radius) || 0);
  const startDistance = Math.hypot(relativeX, relativeY);
  if (startDistance <= safeRadius + ENTRY_EPSILON) {
    return null;
  }

  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const a = deltaX * deltaX + deltaY * deltaY;
  if (a < 1e-9) {
    return null;
  }
  const b = 2 * (relativeX * deltaX + relativeY * deltaY);
  const c = relativeX * relativeX + relativeY * relativeY - safeRadius * safeRadius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return null;
  }
  const root = Math.sqrt(discriminant);
  const first = (-b - root) / (2 * a);
  const second = (-b + root) / (2 * a);
  const t = first >= 0 && first <= 1
    ? first
    : second >= 0 && second <= 1
      ? second
      : null;
  return t;
}

function fixedCircleImpact(startX, startY, endX, endY, geometry, extraRadius = 0) {
  const t = segmentCircleEntry(
    startX,
    startY,
    endX,
    endY,
    geometry.x,
    geometry.y,
    geometry.radius + Math.max(0, Number(extraRadius) || 0),
  );
  if (t === null) {
    return null;
  }
  const crossingX = startX + (endX - startX) * t;
  const crossingY = startY + (endY - startY) * t;
  const radialX = crossingX - geometry.x;
  const radialY = crossingY - geometry.y;
  const radialLength = Math.max(1e-6, Math.hypot(radialX, radialY));
  const normalX = radialX / radialLength;
  const normalY = radialY / radialLength;
  return {
    x: geometry.x + normalX * geometry.radius,
    y: geometry.y + normalY * geometry.radius,
    centerX: geometry.x,
    centerY: geometry.y,
    radius: geometry.radius,
    angle: Math.atan2(normalY, normalX),
    normalX,
    normalY,
    t,
  };
}

function movingCircleImpact(source, main, geometry, { bow = false, extraRadius = 0 } = {}) {
  const sourcePreviousX = Number.isFinite(source.previousX) ? source.previousX : source.x;
  const sourcePreviousY = Number.isFinite(source.previousY) ? source.previousY : source.y;
  const sourcePreviousAngle = Number.isFinite(source.previousAngle) ? source.previousAngle : source.angle;
  const mainPreviousX = Number.isFinite(main.previousX) ? main.previousX : main.x;
  const mainPreviousY = Number.isFinite(main.previousY) ? main.previousY : main.y;

  const previousForwardX = Math.cos(sourcePreviousAngle);
  const previousForwardY = Math.sin(sourcePreviousAngle);
  const currentForwardX = Math.cos(source.angle);
  const currentForwardY = Math.sin(source.angle);
  const startX = sourcePreviousX + (bow ? previousForwardX * source.radius : 0);
  const startY = sourcePreviousY + (bow ? previousForwardY * source.radius : 0);
  const endX = source.x + (bow ? currentForwardX * source.radius : 0);
  const endY = source.y + (bow ? currentForwardY * source.radius : 0);

  // 把移动的护盾圆心转换到相对坐标系，避免旗舰移动时漏掉高速穿越。
  const relativeStartX = startX - mainPreviousX;
  const relativeStartY = startY - mainPreviousY;
  const relativeEndX = endX - main.x;
  const relativeEndY = endY - main.y;
  const collisionRadius = geometry.radius + Math.max(0, Number(extraRadius) || 0);
  const t = segmentCircleEntry(
    relativeStartX,
    relativeStartY,
    relativeEndX,
    relativeEndY,
    0,
    0,
    collisionRadius,
  );
  if (t === null) {
    return null;
  }

  const centerX = mainPreviousX + (main.x - mainPreviousX) * t;
  const centerY = mainPreviousY + (main.y - mainPreviousY) * t;
  const relativeX = relativeStartX + (relativeEndX - relativeStartX) * t;
  const relativeY = relativeStartY + (relativeEndY - relativeStartY) * t;
  const radialLength = Math.max(1e-6, Math.hypot(relativeX, relativeY));
  const normalX = relativeX / radialLength;
  const normalY = relativeY / radialLength;
  return {
    x: centerX + normalX * geometry.radius,
    y: centerY + normalY * geometry.radius,
    centerX,
    centerY,
    radius: geometry.radius,
    angle: Math.atan2(normalY, normalX),
    normalX,
    normalY,
    t,
  };
}

export function koizumiBarrierProjectileImpact(
  projectile,
  dt,
  defendingTeam,
  preparedGeometry = undefined,
) {
  // 炮弹风暴时同一队的护盾几何完全相同，允许调用方每逻辑帧只计算一次。
  const geometry = preparedGeometry === undefined
    ? koizumiBarrierGeometry(defendingTeam)
    : preparedGeometry;
  if (
    !projectile?.alive
    || !geometry?.active
    || !hasKoizumiBarrier(defendingTeam)
    || projectile.team === defendingTeam
  ) {
    return null;
  }
  const deltaX = projectile.targetX - projectile.x;
  const deltaY = projectile.targetY - projectile.y;
  const remaining = Math.hypot(deltaX, deltaY);
  if (remaining < 1e-6) {
    return null;
  }
  const step = Math.min(
    remaining,
    Math.max(0, Number(projectile.speed) || 0) * Math.max(0, Number(dt) || 0),
  );
  const endX = projectile.x + (deltaX / remaining) * step;
  const endY = projectile.y + (deltaY / remaining) * step;
  return fixedCircleImpact(
    projectile.x,
    projectile.y,
    endX,
    endY,
    geometry,
    projectile.radius || 0,
  );
}

export function koizumiBarrierBeamImpact(beam, defendingTeam) {
  const geometry = koizumiBarrierGeometry(defendingTeam);
  if (!beam || !geometry?.active) {
    return null;
  }
  return fixedCircleImpact(
    beam.x1,
    beam.y1,
    beam.x2,
    beam.y2,
    geometry,
  );
}

function haruhiCanRamBarrier(source, attackerTeam, defendingMain, geometry) {
  if (source !== attackerTeam.ships.main || !haruhiOtherworlderReady(attackerTeam)) {
    return null;
  }
  if (!haruhiRamApproachEligible(source, defendingMain.x, defendingMain.y)) {
    return null;
  }
  return movingCircleImpact(source, defendingMain, geometry, {
    bow: true,
    extraRadius: HARUHI_BARRIER_CONTACT_TOLERANCE,
  });
}

function ramBarrierImpact(source, attackerTeam, defendingMain, geometry) {
  if (isKoizumiOrbActive(source)) {
    return {
      impact: movingCircleImpact(source, defendingMain, geometry, {
        extraRadius: source.radius,
      }),
      ramKind: "koizumi_orb",
    };
  }
  if (source.hasEffect?.("bladeQueenUntil")) {
    return {
      impact: movingCircleImpact(source, defendingMain, geometry, {
        extraRadius: source.radius,
      }),
      ramKind: "blade_queen",
    };
  }
  return {
    impact: haruhiCanRamBarrier(source, attackerTeam, defendingMain, geometry),
    ramKind: "haruhi_otherworlder",
  };
}

export function disruptKoizumiBarrier(team, impact, { sourceSeat = null, ramKind = null } = {}) {
  const geometry = koizumiBarrierGeometry(team);
  if (!geometry?.active || !impact) {
    return false;
  }
  const now = team.match.elapsed;
  team.koizumiBarrier.disabledAt = now;
  team.koizumiBarrier.disabledUntil = now + KOIZUMI_BARRIER_DISABLE_SECONDS;
  team.match.spawnKoizumiBarrierImpact({
    ...impact,
    teamSeat: team.seat,
    sourceSeat,
    kind: "ram",
    ramKind,
  });
  team.match.spawnFloatingTextKey(
    impact.x + impact.normalX * 10,
    impact.y + impact.normalY * 10,
    "能量圈失效",
    {},
    "#ff7890",
  );
  return true;
}

export function resolveKoizumiBarrierRamContacts(match) {
  const pairs = [[match.teamA, match.teamB], [match.teamB, match.teamA]];
  for (const [attackerTeam, defendingTeam] of pairs) {
    const geometry = koizumiBarrierGeometry(defendingTeam);
    const defendingMain = defendingTeam.ships.main;
    if (!geometry?.active || !defendingMain?.alive) {
      continue;
    }
    for (const source of attackerTeam.getAllShips()) {
      if (!source?.alive) {
        continue;
      }
      const { impact, ramKind } = ramBarrierImpact(
        source,
        attackerTeam,
        defendingMain,
        geometry,
      );
      if (!impact) {
        continue;
      }
      if (ramKind === "haruhi_otherworlder" && !triggerHaruhiOtherworlder(attackerTeam)) {
        continue;
      }
      if (disruptKoizumiBarrier(defendingTeam, impact, {
        sourceSeat: attackerTeam.seat,
        ramKind,
      })) {
        break;
      }
    }
  }
}

export function serializeKoizumiBarrier(team) {
  const geometry = koizumiBarrierGeometry(team);
  return geometry ? { ...geometry } : null;
}
