import { clamp, distance } from "./math.js";

const HUNT_TRACK_ADVANCE = 210;
const HUNT_BREACH_ADVANCE = 270;
const HUNT_CONTAIN_ADVANCE = 125;
const HUNT_SCREEN_WIDTH = 118;

function livingFleet(team) {
  return team.getAllShips().filter((ship) => ship?.alive && !ship.isAuxiliary);
}

function fleetCenter(ships, fallback) {
  if (ships.length === 0) {
    return { x: fallback.x, y: fallback.y };
  }
  return {
    x: ships.reduce((sum, ship) => sum + ship.x, 0) / ships.length,
    y: ships.reduce((sum, ship) => sum + ship.y, 0) / ships.length,
  };
}

function normalizedDirection(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  return {
    x: dx / length,
    y: dy / length,
    distance: length,
  };
}

function clampPoint(match, point, padding) {
  return {
    ...point,
    x: match.clampX(point.x, padding),
    y: match.clampY(point.y, padding),
  };
}

function visibleScreenContact(contacts, center, target, targetId) {
  const direction = normalizedDirection(center, target);
  let best = null;
  let bestScore = Infinity;
  for (const contact of contacts || []) {
    if (
      !contact?.visible
      || contact.kind !== "ship"
      || contact.id === targetId
    ) {
      continue;
    }
    const relX = contact.x - center.x;
    const relY = contact.y - center.y;
    const forward = relX * direction.x + relY * direction.y;
    if (forward < 45 || forward > direction.distance - 45) {
      continue;
    }
    const lateral = Math.abs(relX * -direction.y + relY * direction.x);
    if (lateral > 260) {
      continue;
    }
    const score = forward + lateral * 0.42;
    if (score < bestScore) {
      bestScore = score;
      best = contact;
    }
  }
  return best;
}

function targetForHunt(team, enemy) {
  if (!team.hasShamisenFlagship?.()) {
    return null;
  }
  const targetId = team.shamisenHunt?.targetId;
  return enemy.getAllShips().find((ship) => ship?.alive && ship.id === targetId) || null;
}

function ownHuntedShip(team, enemy) {
  if (!enemy.hasShamisenFlagship?.()) {
    return null;
  }
  const targetId = enemy.shamisenHunt?.targetId;
  return team.getAllShips().find((ship) => ship?.alive && ship.id === targetId) || null;
}

/**
 * 三味线“猫爪印记”的 AI 战术状态只消费三类信息：
 * 1. 进攻方本就能持续看到的猎杀标记位置；
 * 2. 正常视野产生的敌方接触；
 * 3. 己方舰船“正在被猎杀”的状态，用于安排护卫与撤游。
 * 标记不会在这里转化为真实视野，也不会暴露角色、血量或朝向。
 */
export function buildShamisenHuntTactics({
  team,
  enemy,
  main,
  focus,
  knownContacts = [],
  localAdvantage = 1,
}) {
  const ships = livingFleet(team);
  const center = fleetCenter(ships, main);
  const markedEnemy = targetForHunt(team, enemy);
  const huntedShip = ownHuntedShip(team, enemy);

  let attack = null;
  if (markedEnemy) {
    const targetVisible = team.visibleEnemyIds.has(markedEnemy.id);
    const distances = ships
      .map((ship) => ({ ship, distance: distance(ship.x, ship.y, markedEnemy.x, markedEnemy.y) }))
      .sort((left, right) => left.distance - right.distance);
    const leadGap = distances.length > 1
      ? Math.max(0, distances[1].distance - distances[0].distance)
      : 0;
    const spread = ships.reduce(
      (max, ship) => Math.max(max, distance(ship.x, ship.y, center.x, center.y)),
      0,
    );
    const overcommitRisk = leadGap > 155
      || spread > 255
      || (targetVisible && localAdvantage < 0.76);
    const blocker = visibleScreenContact(
      knownContacts,
      center,
      markedEnemy,
      markedEnemy.id,
    );
    attack = {
      active: true,
      targetId: markedEnemy.id,
      targetVisible,
      isFocus: focus?.id === markedEnemy.id,
      phase: overcommitRisk ? "contain" : targetVisible ? "breach" : "track",
      overcommitRisk,
      leadShipKey: distances[0]?.ship?.key || null,
      leadGap,
      spread,
      blockerId: blocker?.id || null,
      blocker,
      target: {
        id: markedEnemy.id,
        x: markedEnemy.x,
        y: markedEnemy.y,
      },
      fleetCenter: center,
    };
  }

  const defense = huntedShip
    ? {
        active: true,
        huntedShipKey: huntedShip.key,
        huntedShipId: huntedShip.id,
        huntedIsMain: huntedShip.key === "main",
        huntedHpRatio: clamp(huntedShip.hp / Math.max(huntedShip.maxHp, 1), 0, 1),
      }
    : null;

  return { attack, defense };
}

export function shamisenHuntNeedsSplit(tactics, level, elapsed) {
  if (!tactics || elapsed < (level === 1 ? 3.8 : 7.2)) {
    return false;
  }
  // 进攻时至少需要一艘前探舰与主火力相互掩护；防守时则必须把被猎杀舰
  // 从附着编队中释放出来，才能真正把它放到战线外游走。
  if (tactics.attack?.active) {
    return level === 1 || (level === 2 && elapsed >= 10.5);
  }
  if (tactics.defense?.active) {
    if (tactics.defense.huntedIsMain) {
      return true;
    }
    return level === 1
      || (level === 2 && tactics.defense.huntedShipKey === "sub2")
      || (level === 2 && elapsed >= 11.5);
  }
  return false;
}

function advanceToward(center, objective, amount) {
  const direction = normalizedDirection(center, objective);
  const travel = Math.min(direction.distance, amount);
  return {
    x: center.x + direction.x * travel,
    y: center.y + direction.y * travel,
    direction,
  };
}

function attackFormationPlan({ tactics, team, main, now, padding }) {
  const attack = tactics?.attack;
  if (!attack?.active || !attack.isFocus) {
    return null;
  }
  const objective = attack.blocker || attack.target;
  const center = attack.fleetCenter;
  const objectiveDirection = normalizedDirection(center, objective);
  const side = { x: -objectiveDirection.y, y: objectiveDirection.x };
  const standOff = attack.blocker
    ? clamp(main.effectiveVision() * 0.82, 112, 175)
    : attack.targetVisible
      ? clamp(main.effectiveVision() * 0.66, 88, 142)
      : clamp(main.effectiveVision() * 0.78, 108, 168);
  const desiredCenter = {
    x: objective.x - objectiveDirection.x * standOff,
    y: objective.y - objectiveDirection.y * standOff,
  };
  const advanceLimit = attack.overcommitRisk
    ? HUNT_CONTAIN_ADVANCE
    : attack.targetVisible
      ? HUNT_BREACH_ADVANCE
      : HUNT_TRACK_ADVANCE;
  const staged = advanceToward(center, desiredCenter, advanceLimit);
  const pulse = Math.sin(now * 0.52 + attack.targetId * 0.017);
  const leadKey = attack.leadShipKey === "main"
    ? ["sub1", "sub2"].find((key) => team.ships[key]?.alive && !team.ships[key].isAttached()) || "main"
    : attack.leadShipKey;
  const forwardLead = attack.overcommitRisk ? -35 : attack.targetVisible ? 74 : 96;

  const plan = {
    kind: "attack",
    phase: attack.phase,
    targetId: attack.targetId,
    blockerId: attack.blockerId,
    leadKey,
    points: {},
    roles: {},
    throttles: {},
  };
  for (const ship of livingFleet(team)) {
    const isLead = ship.key === leadKey;
    const laneSign = ship.key === "sub1" ? -1 : ship.key === "sub2" ? 1 : 0;
    const forward = isLead ? forwardLead : ship.key === "main" ? 0 : 20;
    const lateral = laneSign * HUNT_SCREEN_WIDTH + (ship.key === "main" ? pulse * 28 : 0);
    plan.points[ship.key] = clampPoint(team.match, {
      x: staged.x + staged.direction.x * forward + side.x * lateral,
      y: staged.y + staged.direction.y * forward + side.y * lateral,
      intentAngle: Math.atan2(objective.y - staged.y, objective.x - staged.x),
      preferredRange: standOff,
    }, padding);
    plan.roles[ship.key] = isLead ? "hunt-scout" : attack.overcommitRisk ? "hunt-contain" : "hunt-breach";
    plan.throttles[ship.key] = attack.overcommitRisk
      ? { min: 0.84, max: 1.02 }
      : isLead
        ? { min: 1.04, max: 1.18 }
        : { min: 0.96, max: 1.12 };
  }
  return plan;
}

function defenseFormationPlan({ tactics, team, focus, now, padding }) {
  const defense = tactics?.defense;
  const hunted = defense?.active ? team.ships[defense.huntedShipKey] : null;
  if (!hunted?.alive || !focus) {
    return null;
  }
  const main = team.ships.main;
  const center = fleetCenter(livingFleet(team), main);
  const towardEnemy = normalizedDirection(center, focus);
  const side = { x: -towardEnemy.y, y: towardEnemy.x };
  const orbit = Math.sin(now * 0.46 + hunted.id * 0.021);
  const backDistance = clamp(176 + (1 - defense.huntedHpRatio) * 82, 176, 258);
  const lateralTravel = 112 + (1 - defense.huntedHpRatio) * 48;
  const screenCenter = defense.huntedIsMain
    ? {
        x: main.x + towardEnemy.x * 168,
        y: main.y + towardEnemy.y * 168,
      }
    : {
        x: main.x + towardEnemy.x * 42,
        y: main.y + towardEnemy.y * 42,
      };
  const huntedAnchor = defense.huntedIsMain ? center : main;
  const huntedPoint = {
    x: huntedAnchor.x - towardEnemy.x * backDistance + side.x * orbit * lateralTravel,
    y: huntedAnchor.y - towardEnemy.y * backDistance + side.y * orbit * lateralTravel,
    intentAngle: Math.atan2(focus.y - hunted.y, focus.x - hunted.x),
    preferredRange: clamp(main.effectiveRange() * 1.08, 230, 430),
  };

  const plan = {
    kind: "defense",
    phase: "screen",
    targetId: defense.huntedShipId,
    blockerId: null,
    leadKey: null,
    points: {},
    roles: {},
    throttles: {},
  };
  for (const ship of livingFleet(team)) {
    if (ship.key === hunted.key) {
      plan.points[ship.key] = clampPoint(team.match, huntedPoint, padding);
      plan.roles[ship.key] = "hunt-evade";
      plan.throttles[ship.key] = { min: 1.04, max: 1.18 };
      continue;
    }
    const laneSign = ship.key === "sub1" ? -1 : ship.key === "sub2" ? 1 : 0;
    const lateral = laneSign * 104;
    const forward = ship.key === "main" ? 0 : 58;
    plan.points[ship.key] = clampPoint(team.match, {
      x: screenCenter.x + towardEnemy.x * forward + side.x * lateral,
      y: screenCenter.y + towardEnemy.y * forward + side.y * lateral,
      intentAngle: Math.atan2(focus.y - screenCenter.y, focus.x - screenCenter.x),
      preferredRange: clamp(ship.effectiveRange() * 0.86, 170, 340),
    }, padding);
    plan.roles[ship.key] = "hunt-screen";
    plan.throttles[ship.key] = { min: 0.94, max: 1.1 };
  }
  return plan;
}

export function planShamisenHuntFormation({
  tactics,
  team,
  main,
  focus,
  now,
  padding,
}) {
  return defenseFormationPlan({ tactics, team, focus, now, padding })
    || attackFormationPlan({ tactics, team, main, now, padding });
}
