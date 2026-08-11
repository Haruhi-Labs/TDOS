import { CHARACTER_DEFS, skillMetaForCharacter } from "./characters.js";
import { haruhiOtherworlderReady } from "./haruhi-flagship.js";
import { koizumiBarrierGeometry } from "./koizumi-barrier.js";
import { clamp, distance } from "./math.js";

export const KOIZUMI_BARRIER_INTEL_MAX_AGE = 8;

const BREAKER_PRIORITY = Object.freeze({
  koizumi_orb: 3,
  blade_queen: 2,
  haruhi_otherworlder: 1,
});

function remaining(until, now) {
  return Math.max(0, Number(until || 0) - now);
}

// 只把玩家同样能从可见舰船上判断出的技能状态写进接触快照；雷达接触不会调用这里，
// 因而角色战术层不会借服务端对象越过战争迷雾读取隐藏技能。
export function snapshotVisibleCharacterTactics(entity, now) {
  const orb = entity?.koizumiOrb;
  const barrier = entity?.slotKey === "main" && entity.characterId === "koizumi"
    ? koizumiBarrierGeometry(entity.team)
    : null;
  return {
    bladeQueenRemaining: remaining(entity?.effects?.bladeQueenUntil, now),
    catPawRemaining: remaining(entity?.effects?.catPawUntil, now),
    koizumiOrbRemaining: orb
      ? orb.phase === "active"
        ? remaining(orb.activeUntil, now)
        : 3
      : 0,
    haruhiImpactReady: Boolean(
      entity?.slotKey === "main"
      && entity.characterId === "haruhi"
      && haruhiOtherworlderReady(entity.team),
    ),
    haruhiSupportCount: entity?.slotKey === "main" && entity.characterId === "haruhi"
      ? Number(entity.team?.haruhiFlagship?.supporters?.size || 0)
      : 0,
    haruhiBoostActive: Boolean(
      entity?.slotKey === "main"
      && entity.characterId === "haruhi"
      && Number(entity.team?.effects?.haruhiBoostUntil || 0) > now,
    ),
    future1096Form: entity?.slotKey === "main" && entity.characterId === "future1096"
      ? entity.team?.future1096Form || null
      : null,
    koizumiBarrierActive: Boolean(barrier?.active),
    koizumiBarrierRadius: barrier?.radius || 0,
    koizumiBarrierDisabledRemaining: barrier?.disabledRemaining || 0,
  };
}

export function contactCharacterTactics(contact, now) {
  if (!contact) {
    return {
      breakerKind: null,
      bladeQueenActive: false,
      catPawActive: false,
      koizumiOrbActive: false,
      haruhiImpactReady: false,
    };
  }
  const age = Math.max(0, now - Number(contact.seenAt || now));
  const bladeQueenActive = Number(contact.bladeQueenRemaining || 0) > age;
  const koizumiOrbActive = Number(contact.koizumiOrbRemaining || 0) > age;
  const haruhiImpactReady = Boolean(contact.haruhiImpactReady && age <= 2.5);
  return {
    breakerKind: koizumiOrbActive
      ? "koizumi_orb"
      : bladeQueenActive
        ? "blade_queen"
        : haruhiImpactReady
          ? "haruhi_otherworlder"
          : null,
    bladeQueenActive,
    catPawActive: Number(contact.catPawRemaining || 0) > age,
    koizumiOrbActive,
    haruhiImpactReady,
  };
}

export function characterTargetPriorityBonus(contact, now) {
  if (!contact || contact.kind !== "ship") {
    return 0;
  }
  const tactics = contactCharacterTactics(contact, now);
  let value = tactics.breakerKind ? 1.25 : 0;
  if (tactics.catPawActive) value += 0.28;
  if (contact.slotKey === "main") {
    if (contact.characterId === "yuki") value += 0.32;
    if (contact.characterId === "haruhi") {
      value += 0.3
        + Math.min(0.32, Number(contact.haruhiSupportCount || 0) * 0.08)
        + (contact.haruhiBoostActive ? 0.18 : 0);
    }
    if (contact.characterId === "future1096") {
      value += contact.future1096Form === "A"
        ? 0.48
        : contact.future1096Form === "B"
          ? -0.14
          : 0.18;
    }
    if (contact.characterId === "kyon") value += 0.12;
    if (contact.characterId === "koizumi") value += 0.38;
  }
  return value;
}

export function knownKoizumiBarrier(contact, now) {
  if (
    !contact
    || contact.kind !== "ship"
    || contact.slotKey !== "main"
    || contact.characterId !== "koizumi"
  ) {
    return null;
  }
  const age = Math.max(0, now - Number(contact.seenAt || now));
  if (age > KOIZUMI_BARRIER_INTEL_MAX_AGE) {
    return null;
  }
  const observedDisabled = Math.max(
    0,
    Number(contact.koizumiBarrierDisabledRemaining || 0) - age,
  );
  return {
    known: true,
    active: Boolean(contact.koizumiBarrierActive) || observedDisabled <= 0,
    disabledRemaining: observedDisabled,
    radius: Math.max(
      1,
      Number(contact.koizumiBarrierRadius)
        || CHARACTER_DEFS.koizumi.stats.vision,
    ),
    x: contact.x,
    y: contact.y,
    age,
    confidence: clamp(Number(contact.confidence) || 1, 0.2, 1),
  };
}

export function ownKoizumiBarrier(team) {
  const barrier = koizumiBarrierGeometry(team);
  if (!barrier) {
    return null;
  }
  return {
    ...barrier,
    known: true,
  };
}

export function barrierBreakerForShip(team, ship, { allowReady = true } = {}) {
  if (!team || !ship?.alive || ship.isAttached?.()) {
    return null;
  }
  if (
    ship === team.ships.main
    && ship.characterId === "haruhi"
    && haruhiOtherworlderReady(team)
  ) {
    return {
      ship,
      kind: "haruhi_otherworlder",
      active: true,
      ready: true,
      priority: BREAKER_PRIORITY.haruhi_otherworlder,
    };
  }
  if (ship.characterId !== "koizumi" && ship.characterId !== "asakura") {
    return null;
  }

  const kind = ship.characterId === "koizumi" ? "koizumi_orb" : "blade_queen";
  const active = ship.characterId === "koizumi"
    ? ship.koizumiOrb?.phase === "active"
    : Boolean(ship.hasEffect?.("bladeQueenUntil"));
  const meta = skillMetaForCharacter(ship.characterId, "sub");
  const ready = active || Boolean(
    allowReady
    && ship.canControl?.()
    && !ship.isSilenced?.()
    && Number(team.cooldowns?.[ship.key] || 0) <= 0
    && Number(ship.energy || 0) >= Number(meta?.cost || 0),
  );
  if (!ready) {
    return null;
  }
  return {
    ship,
    kind,
    active,
    ready,
    priority: BREAKER_PRIORITY[kind],
  };
}

export function chooseKoizumiBarrierBreaker(team, { activeOnly = false } = {}) {
  const candidates = team.getAllShips()
    .map((ship) => barrierBreakerForShip(team, ship, { allowReady: !activeOnly }))
    .filter((item) => item && (!activeOnly || item.active));
  candidates.sort((left, right) => (
    Number(right.active) - Number(left.active)
    || right.priority - left.priority
    || Number(right.ship.energy || 0) - Number(left.ship.energy || 0)
  ));
  return candidates[0] || null;
}

export function incomingKoizumiBarrierBreaker(contacts, main, barrier, now) {
  if (!main || !barrier?.active) {
    return null;
  }
  let best = null;
  let bestScore = -Infinity;
  for (const contact of contacts || []) {
    const tactics = contactCharacterTactics(contact, now);
    if (!tactics.breakerKind) {
      continue;
    }
    const dist = distance(main.x, main.y, contact.x, contact.y);
    if (dist > barrier.radius + 260) {
      continue;
    }
    const closingSpeed = Math.max(0, Number(contact.speed) || 0);
    const score = (barrier.radius + 260 - dist) / 180
      + closingSpeed / 120
      + BREAKER_PRIORITY[tactics.breakerKind] * 0.18;
    if (score > bestScore) {
      bestScore = score;
      best = {
        contact,
        kind: tactics.breakerKind,
        distance: dist,
        score,
      };
    }
  }
  return best;
}

export function barrierBlocksRangedAttack(barrier, ship, margin = 0) {
  return Boolean(
    barrier?.active
    && ship?.alive
    && distance(ship.x, ship.y, barrier.x, barrier.y)
      > barrier.radius + Math.max(0, Number(ship.radius) || 0) + margin,
  );
}

export function clampPointToAnchorRadius(point, anchor, maximumRadius) {
  if (!point || !anchor || !Number.isFinite(maximumRadius) || maximumRadius <= 0) {
    return point;
  }
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const length = Math.hypot(dx, dy);
  if (length <= maximumRadius || length < 1e-6) {
    return point;
  }
  const scale = maximumRadius / length;
  return {
    ...point,
    x: anchor.x + dx * scale,
    y: anchor.y + dy * scale,
  };
}

export function predictCharacterSkillAim(contact, seconds, worldSize, padding = 0) {
  if (!contact) {
    return null;
  }
  const lead = clamp(Number(seconds) || 0, 0, 1.8)
    * clamp(Number(contact.confidence) || 1, 0.25, 1);
  const speed = Math.max(0, Number(contact.speed) || 0);
  return {
    x: clamp(contact.x + Math.cos(Number(contact.angle) || 0) * speed * lead, padding, worldSize - padding),
    y: clamp(contact.y + Math.sin(Number(contact.angle) || 0) * speed * lead, padding, worldSize - padding),
  };
}

function infiltrationScore(ship) {
  const hpRatio = clamp(Number(ship.hp || 0) / Math.max(1, Number(ship.maxHp || 1)), 0, 1);
  const energyRatio = clamp(Number(ship.energy || 0) / Math.max(1, Number(ship.maxEnergy || 1)), 0, 1);
  return hpRatio * 0.7 + energyRatio * 0.3 + Number(ship.baseSpeed?.() || 0) / 80;
}

export function buildKoizumiBarrierTactics({
  team,
  enemyMainContact,
  main,
  detachedShips,
  enemyContacts,
  now,
  legacy = false,
  advanced = false,
  mainHull = 1,
  localAdvantage = 1,
  killWindow = false,
}) {
  const own = legacy ? null : ownKoizumiBarrier(team);
  const enemy = legacy ? null : knownKoizumiBarrier(enemyMainContact, now);
  const breaker = advanced && enemy?.active
    ? chooseKoizumiBarrierBreaker(team)
    : null;
  const possibleInfiltrators = advanced && enemy?.active && !breaker
    ? (detachedShips || [])
        .filter((ship) => Number(ship.hp || 0) / Math.max(1, Number(ship.maxHp || 1)) > 0.48)
        .sort((left, right) => infiltrationScore(right) - infiltrationScore(left))
    : [];
  const infiltratorKey = possibleInfiltrators[0]?.key || (
    advanced
    && enemy?.active
    && !breaker
    && mainHull > 0.55
    && (localAdvantage > 1.05 || killWindow)
      ? "main"
      : null
  );
  const incoming = advanced && own?.active
    ? incomingKoizumiBarrierBreaker(enemyContacts, main, own, now)
    : null;
  return {
    own,
    enemy,
    breachShipKey: breaker?.ship?.key || null,
    breachKind: breaker?.kind || null,
    breachActive: Boolean(breaker?.active),
    infiltratorKey,
    incoming,
  };
}

export function koizumiBarrierRoleDirective(ship, role, enemyEstimate, barrier, laneSign = 1) {
  if (!ship || !enemyEstimate || !["breach", "infiltrate"].includes(role)) {
    return null;
  }
  const centerX = barrier?.x ?? enemyEstimate.x;
  const centerY = barrier?.y ?? enemyEstimate.y;
  if (role === "breach") {
    return {
      target: {
        x: centerX,
        y: centerY,
        intentAngle: Math.atan2(centerY - ship.y, centerX - ship.x),
        preferredRange: 0,
      },
      throttle: { min: 1.12, max: 1.2 },
      role,
    };
  }

  const enemySideX = -Math.sin(Number(enemyEstimate.angle) || 0);
  const enemySideY = Math.cos(Number(enemyEstimate.angle) || 0);
  const fromCenterX = ship.x - centerX;
  const fromCenterY = ship.y - centerY;
  const fromCenterLength = Math.max(1, Math.hypot(fromCenterX, fromCenterY));
  const inwardRadius = Math.max(36, Number(barrier?.radius || 160) * 0.48);
  const targetX = centerX + (fromCenterX / fromCenterLength) * inwardRadius + enemySideX * laneSign * 24;
  const targetY = centerY + (fromCenterY / fromCenterLength) * inwardRadius + enemySideY * laneSign * 24;
  return {
    target: {
      x: targetX,
      y: targetY,
      intentAngle: Math.atan2(centerY - targetY, centerX - targetX) - laneSign * Math.PI * 0.5,
      preferredRange: inwardRadius,
    },
    throttle: { min: 1.04, max: 1.18 },
    role,
  };
}

export function applyKoizumiBarrierMainStrategy({
  main,
  enemyEstimate,
  target,
  tactics,
  match,
  padding,
  flankSign = 1,
}) {
  if (!main || !enemyEstimate || !target || !tactics || !match) {
    return target;
  }
  const own = tactics.own;
  const enemy = tactics.enemy;
  const incoming = tactics.incoming;

  if (incoming?.contact && own?.active) {
    const threat = incoming.contact;
    const awayX = main.x - threat.x;
    const awayY = main.y - threat.y;
    const awayLength = Math.max(1, Math.hypot(awayX, awayY));
    const normalX = awayX / awayLength;
    const normalY = awayY / awayLength;
    return {
      ...target,
      x: match.clampX(main.x + normalX * 150 - normalY * flankSign * 145, padding),
      y: match.clampY(main.y + normalY * 150 + normalX * flankSign * 145, padding),
      intentAngle: Math.atan2(enemyEstimate.y - main.y, enemyEstimate.x - main.x),
      preferredRange: own.radius + 80,
    };
  }

  if (own && !own.active) {
    const awayX = main.x - enemyEstimate.x;
    const awayY = main.y - enemyEstimate.y;
    const awayLength = Math.max(1, Math.hypot(awayX, awayY));
    return {
      ...target,
      x: match.clampX(main.x + (awayX / awayLength) * 230, padding),
      y: match.clampY(main.y + (awayY / awayLength) * 230, padding),
      preferredRange: Math.max(main.effectiveRange() * 0.72, own.radius + 110),
    };
  }

  if (enemy?.active && tactics.breachShipKey === "main") {
    return {
      ...target,
      x: match.clampX(enemy.x, padding),
      y: match.clampY(enemy.y, padding),
      intentAngle: Math.atan2(enemy.y - main.y, enemy.x - main.x),
      preferredRange: 0,
    };
  }

  if (enemy?.active && tactics.infiltratorKey === "main") {
    const fromCenterX = main.x - enemy.x;
    const fromCenterY = main.y - enemy.y;
    const fromCenterLength = Math.max(1, Math.hypot(fromCenterX, fromCenterY));
    const inwardRadius = Math.max(38, enemy.radius * 0.48);
    return {
      ...target,
      x: match.clampX(enemy.x + (fromCenterX / fromCenterLength) * inwardRadius, padding),
      y: match.clampY(enemy.y + (fromCenterY / fromCenterLength) * inwardRadius, padding),
      intentAngle: Math.atan2(enemy.y - main.y, enemy.x - main.x) - flankSign * Math.PI * 0.5,
      preferredRange: inwardRadius,
    };
  }

  if (!own?.active) {
    return target;
  }
  const dx = target.x - enemyEstimate.x;
  const dy = target.y - enemyEstimate.y;
  const currentRange = Math.hypot(dx, dy);
  const minimumRange = Math.max(own.radius + 38, main.radius + 90);
  const maximumRange = Math.max(minimumRange, main.effectiveRange() * 0.86);
  const desiredRange = clamp(currentRange, minimumRange, maximumRange);
  const fallbackX = main.x - enemyEstimate.x;
  const fallbackY = main.y - enemyEstimate.y;
  const fallbackLength = Math.max(1, Math.hypot(fallbackX, fallbackY));
  const normalX = currentRange > 1 ? dx / currentRange : fallbackX / fallbackLength;
  const normalY = currentRange > 1 ? dy / currentRange : fallbackY / fallbackLength;
  return {
    ...target,
    x: match.clampX(enemyEstimate.x + normalX * desiredRange, padding),
    y: match.clampY(enemyEstimate.y + normalY * desiredRange, padding),
    preferredRange: desiredRange,
  };
}

export function keepDirectiveInsideKoizumiBarrier(directive, ship, mainTarget, tactics, role) {
  const barrier = tactics?.own;
  if (
    !directive?.target
    || !barrier
    || ["breach", "infiltrate", "escape"].includes(role)
  ) {
    return directive;
  }
  const interiorRadius = barrier.active
    ? Math.max(42, barrier.radius - Math.max(18, ship.radius + 12))
    : Math.min(96, barrier.radius * 0.58);
  return {
    ...directive,
    target: clampPointToAnchorRadius(directive.target, mainTarget, interiorRadius),
  };
}
