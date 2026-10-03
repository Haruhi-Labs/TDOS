import { clamp } from "./math.js";
import { bunnyHaruhiSupportSource } from "./bunny-haruhi-support.js";
import { supportOtherworlderReady, triggerSupportOtherworlder } from "./haruhi-support.js";
import { isKoizumiOrbActive } from "./koizumi-orb.js";
import {
  haruhiOtherworlderAuraForwardReach,
  haruhiRamApproachEligible,
} from "./collision-system.js";
import {
  haruhiOtherworlderReady,
  triggerHaruhiOtherworlder,
} from "./haruhi-flagship.js";

export const KOIZUMI_BARRIER_DISABLE_SECONDS = 5;
export const KOIZUMI_BARRIER_MAX_HITS = 15;

const HARUHI_BARRIER_CONTACT_TOLERANCE = 5;
const ENTRY_EPSILON = 0.35;
const RECOVERY_EFFECT_SECONDS = 0.9;

export function createKoizumiBarrierState() {
  return {
    remainingHits: KOIZUMI_BARRIER_MAX_HITS,
    disabledAt: null,
    disabledUntil: 0,
    repairedAt: null,
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
  const remainingHits = team.koizumiBarrier.remainingHits;
  const active = remainingHits > 0;
  const disabledRemaining = active ? 0 : Math.max(0, team.koizumiBarrier.disabledUntil - now);
  const repairedAt = team.koizumiBarrier.repairedAt;
  const recoveryAge = !active || !Number.isFinite(repairedAt)
    ? 0
    // 重组动画结束后固定为上限，避免这个仅供显示的值永久逐帧变化，
    // 令多人差量包持续携带无意义的护盾状态更新。
    : clamp(
      now - repairedAt,
      0,
      RECOVERY_EFFECT_SECONDS,
    );
  return {
    x: main.x,
    y: main.y,
    radius: Math.max(1, main.effectiveVision()),
    active,
    remainingHits,
    maxHits: KOIZUMI_BARRIER_MAX_HITS,
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

// 只在权威逻辑推进中修复；查询几何或序列化快照不得改变剩余次数。
export function updateKoizumiBarrierRecovery(team) {
  if (!hasKoizumiBarrier(team) || team.koizumiBarrier.remainingHits > 0) return;
  if (team.match.elapsed + 1e-9 < team.koizumiBarrier.disabledUntil) return;
  team.koizumiBarrier.remainingHits = KOIZUMI_BARRIER_MAX_HITS;
  team.koizumiBarrier.repairedAt = team.match.elapsed;
}

function projectileStepEnd(projectile, dt) {
  const dx = projectile.targetX - projectile.x;
  const dy = projectile.targetY - projectile.y;
  const remaining = Math.hypot(dx, dy);
  const step = remaining < 1 ? remaining
    : Math.min(remaining, Math.max(0, Number(projectile.speed) || 0) * Math.max(0, Number(dt) || 0));
  return remaining < 1e-6 ? { x: projectile.x, y: projectile.y } : {
    x: projectile.x + dx / remaining * step,
    y: projectile.y + dy / remaining * step,
  };
}

export function trackKoizumiBarrierProjectileCrossing(projectile, dt, team, geometry) {
  if (!projectile?.alive || projectile.team === team || !geometry || team.koizumiBarrier.remainingHits > 0) return;
  const end = projectileStepEnd(projectile, dt);
  const main = team.ships.main;
  const startX = projectile.x - (Number.isFinite(main.previousX) ? main.previousX : main.x);
  const startY = projectile.y - (Number.isFinite(main.previousY) ? main.previousY : main.y);
  const endX = end.x - main.x;
  const endY = end.y - main.y;
  const radius = geometry.radius + Math.max(0, Number(projectile.radius) || 0);
  // 破盾后原边界仍参与检测；敌弹从内向外、外向内或一帧贯穿整个圆都重新计时。
  // 相对坐标同时覆盖旗舰移动导致的边界穿越，圈内飞行本身不重置计时。
  if (segmentCircleCrossing(startX, startY, endX, endY, radius)) {
    team.koizumiBarrier.disabledUntil = team.match.elapsed + KOIZUMI_BARRIER_DISABLE_SECONDS;
  }
}

function segmentCircleCrossing(startX, startY, endX, endY, radius) {
  const dx = endX - startX;
  const dy = endY - startY;
  const a = dx * dx + dy * dy;
  if (a < 1e-9) return false;
  const b = 2 * (startX * dx + startY * dy);
  const c = startX * startX + startY * startY - radius * radius;
  const discriminant = b * b - 4 * a * c;
  // 相切只接触边界，不穿越；静默检测不沿用拦截的入圈容差，避免低速弹漏计。
  if (discriminant <= 0) return false;
  const root = Math.sqrt(discriminant);
  const first = (-b - root) / (2 * a);
  const second = (-b + root) / (2 * a);
  return (first >= 0 && first <= 1) || (second >= 0 && second <= 1);
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

function movingCircleImpact(source, main, geometry, { bow = false, bowOffset = null, extraRadius = 0 } = {}) {
  const sourcePreviousX = Number.isFinite(source.previousX) ? source.previousX : source.x;
  const sourcePreviousY = Number.isFinite(source.previousY) ? source.previousY : source.y;
  const sourcePreviousAngle = Number.isFinite(source.previousAngle) ? source.previousAngle : source.angle;
  const mainPreviousX = Number.isFinite(main.previousX) ? main.previousX : main.x;
  const mainPreviousY = Number.isFinite(main.previousY) ? main.previousY : main.y;

  const previousForwardX = Math.cos(sourcePreviousAngle);
  const previousForwardY = Math.sin(sourcePreviousAngle);
  const currentForwardX = Math.cos(source.angle);
  const currentForwardY = Math.sin(source.angle);
  const safeBowOffset = bow
    ? Math.max(0, Number.isFinite(bowOffset) ? bowOffset : source.radius)
    : 0;
  const startX = sourcePreviousX + previousForwardX * safeBowOffset;
  const startY = sourcePreviousY + previousForwardY * safeBowOffset;
  const endX = source.x + currentForwardX * safeBowOffset;
  const endY = source.y + currentForwardY * safeBowOffset;

  // 把移动的护盾圆心转换到相对坐标系，避免旗舰移动时漏掉高速穿越。
  const relativeStartX = startX - mainPreviousX;
  const relativeStartY = startY - mainPreviousY;
  const relativeEndX = endX - main.x;
  const relativeEndY = endY - main.y;
  const collisionRadius = geometry.radius + Math.max(0, Number(extraRadius) || 0);
  let t = segmentCircleEntry(
    relativeStartX,
    relativeStartY,
    relativeEndX,
    relativeEndY,
    0,
    0,
    collisionRadius,
  );
  if (
    t === null
    && bow
    && Math.hypot(source.x - main.x, source.y - main.y) > geometry.radius
    && Math.hypot(relativeEndX, relativeEndY) <= collisionRadius
  ) {
    // 新解锁或高速转向时，扩大后的舰首气场可能在单帧开始前就已覆盖屏障。
    // 仅允许舰体圆心仍在圈外时补记接触，避免圈内春日转向后从内部反向破盾。
    t = 1;
  }
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
    || !geometry
    || !hasKoizumiBarrier(defendingTeam)
    || defendingTeam.koizumiBarrier.remainingHits <= 0
    || projectile.team === defendingTeam
  ) {
    return null;
  }
  const end = projectileStepEnd(projectile, dt);
  return fixedCircleImpact(
    projectile.x,
    projectile.y,
    end.x,
    end.y,
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
  const bunny = source.bunnyHaruhi ? bunnyHaruhiSupportSource(source, !attackerTeam.areSkillsDisabled()) : null;
  const ready = bunny ? supportOtherworlderReady(bunny, attackerTeam.match.elapsed)
    : source === attackerTeam.ships.main && haruhiOtherworlderReady(attackerTeam);
  if (!ready) {
    return null;
  }
  if (!haruhiRamApproachEligible(source, defendingMain.x, defendingMain.y)) {
    return null;
  }
  return movingCircleImpact(source, defendingMain, geometry, {
    bow: true,
    bowOffset: haruhiOtherworlderAuraForwardReach(source),
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

function breakKoizumiBarrier(team, impact, { sourceSeat = null, ramKind = null, kind = "break" } = {}) {
  const now = team.match.elapsed;
  team.koizumiBarrier.remainingHits = 0;
  team.koizumiBarrier.disabledAt = now;
  team.koizumiBarrier.disabledUntil = now + KOIZUMI_BARRIER_DISABLE_SECONDS;
  team.match.spawnKoizumiBarrierImpact({
    ...impact,
    teamSeat: team.seat,
    sourceSeat,
    kind,
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

export function consumeKoizumiBarrierHit(team, impact, sourceSeat) {
  if (!hasKoizumiBarrier(team) || team.koizumiBarrier.remainingHits <= 0 || !impact) return false;
  if (team.koizumiBarrier.remainingHits === 1) breakKoizumiBarrier(team, impact, { sourceSeat });
  else team.koizumiBarrier.remainingHits -= 1;
  return true;
}

export function disruptKoizumiBarrier(team, impact, { sourceSeat = null, ramKind = null } = {}) {
  if (!koizumiBarrierGeometry(team)?.active || !impact) return false;
  return breakKoizumiBarrier(team, impact, { sourceSeat, ramKind, kind: "ram" });
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
      if (ramKind === "haruhi_otherworlder") {
        const consumed = source.bunnyHaruhi
          ? triggerSupportOtherworlder(bunnyHaruhiSupportSource(source, !attackerTeam.areSkillsDisabled()), match.elapsed)
          : triggerHaruhiOtherworlder(attackerTeam);
        if (!consumed) continue;
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
