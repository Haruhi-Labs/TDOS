function allianceIdForSeat(seat) {
  return String(seat || "A").toUpperCase().startsWith("B") ? "B" : "A";
}

function enemyAllianceId(allianceId) {
  return allianceId === "A" ? "B" : "A";
}

function distance(a, b) {
  const dx = Number(a?.x || 0) - Number(b?.x || 0);
  const dy = Number(a?.y || 0) - Number(b?.y || 0);
  return Math.hypot(dx, dy);
}

function fleetHullRatio(fleet) {
  const ships = fleet?.getAllShips?.() || [];
  const max = ships.reduce((sum, ship) => sum + (Number(ship.maxHp) || 0), 0);
  const hp = ships.reduce((sum, ship) => sum + (ship?.alive ? Number(ship.hp) || 0 : 0), 0);
  return max > 0 ? hp / max : 0;
}

function mainShip(simulation, seat) {
  const fleet = simulation?.fleetBySeat?.(seat);
  const main = fleet?.shipByKey?.("main");
  if (main?.alive) return main;
  const living = (fleet?.getAllShips?.() || []).filter((ship) => ship?.alive);
  return living.find((ship) => ship?.canControl?.()) || living[0] || null;
}

function safeAreaTarget(modeState, simulation, allianceId) {
  const area = (modeState?.map?.spawnAreas || []).find((item) => item.allianceId === allianceId);
  if (area?.center) return { ...area.center };
  const size = Number(simulation?.worldSize) || 1440;
  return {
    x: allianceId === "A" ? size * 0.24 : size * 0.76,
    y: size * 0.5,
  };
}

function routeAction(ship, target, reason, score, navigationKey) {
  if (!ship || !target) return null;
  return {
    type: "set_route",
    shipKey: ship.key || "main",
    endX: Number(target.x),
    endY: Number(target.y),
    throttle: reason === "retreat" ? 1.18 : 1.05,
    reason,
    objectiveScore: score,
    navigationKey: String(navigationKey || ""),
  };
}

function enemyShips(simulation, seat) {
  const own = mainShip(simulation, seat);
  const enemies = simulation?.fleetsForAlliance?.(enemyAllianceId(allianceIdForSeat(seat))) || [];
  const ships = enemies.flatMap((fleet) => fleet.getAllShips?.() || []).filter((ship) => ship?.alive);
  return ships.sort((a, b) => distance(own, a) - distance(own, b));
}

function nearestEnemyShip(simulation, seat) {
  return enemyShips(simulation, seat)[0] || null;
}

function scoreDistance(ship, target, nearScale = 720) {
  if (!ship || !target) return 0;
  return Math.max(0, nearScale - distance(ship, target)) / Math.max(1, nearScale);
}

function objectiveTargetId(objective, allianceId) {
  const target = objective?.target;
  if (objective?.type === "retreat") return `spawn-${allianceId}`;
  return String(target?.id || target?.nodeId || "unknown");
}

function objectiveCapacity(objective, allianceId) {
  if (objective?.type === "collect_resource" || objective?.type === "collect_skill") return 1;
  if (objective?.type === "defend_control_point") return 1;
  if (objective?.type === "capture_control_point") {
    return objective.target?.ownerAllianceId && objective.target.ownerAllianceId !== allianceId ? 2 : 1;
  }
  if (objective?.type === "attack_enemy") return 2;
  return Number.POSITIVE_INFINITY;
}

function objectiveKey(objective, allianceId) {
  return `${objective?.type || "unknown"}:${objectiveTargetId(objective, allianceId)}`;
}

function allianceCoordinator(modeState, allianceId) {
  if (!modeState || typeof modeState !== "object") return null;
  modeState.aiCoordinator = modeState.aiCoordinator || {};
  modeState.aiCoordinator[allianceId] = modeState.aiCoordinator[allianceId] || { assignments: {} };
  modeState.aiCoordinator[allianceId].assignments = modeState.aiCoordinator[allianceId].assignments || {};
  return modeState.aiCoordinator[allianceId];
}

function openingRoleBonus({ objective, seat, modeState } = {}) {
  if (Number(modeState?.elapsed || 0) > 6 || !String(seat || "").toUpperCase().endsWith("3")) return 0;
  if (objective?.type === "collect_resource" || objective?.type === "collect_skill") return 90;
  if (objective?.type === "attack_enemy") return 80;
  if (objective?.type === "defend_control_point") return 45;
  return 0;
}

export function scoreTerritoryObjective({ objective, seat, simulation, modeState } = {}) {
  const allianceId = allianceIdForSeat(seat);
  const ship = mainShip(simulation, seat);
  if (!objective || !ship?.alive) return 0;
  const target = objective.target || null;
  const near = scoreDistance(ship, target?.center || target);
  if (objective.type === "retreat") {
    const hull = fleetHullRatio(simulation?.fleetBySeat?.(seat));
    return hull < 0.35 ? 140 - hull * 140 : 0;
  }
  if (objective.type === "collect_resource") {
    return 118 + near * 34 + (target?.rarity === "rare" ? 22 : 0);
  }
  if (objective.type === "collect_skill") {
    return 108 + near * 30;
  }
  if (objective.type === "capture_control_point") {
    const owner = target?.ownerAllianceId || null;
    const ownerBonus = owner === enemyAllianceId(allianceId) ? 46 : owner == null ? 24 : -20;
    const ticketPressure = Number(modeState?.alliances?.[allianceId]?.tickets || 0) < Number(modeState?.alliances?.[enemyAllianceId(allianceId)]?.tickets || 0) ? 16 : 0;
    return 54 + ownerBonus + near * 24 + ticketPressure;
  }
  if (objective.type === "defend_control_point") {
    if (target?.ownerAllianceId !== allianceId) return 26 + near * 10;
    return 62 + near * 20;
  }
  if (objective.type === "attack_enemy") {
    return 48 + near * 30;
  }
  return 0;
}

function tacticalSkillAction({ seat, simulation, modeState }) {
  const allianceId = allianceIdForSeat(seat);
  const slot = modeState?.alliances?.[allianceId]?.skillSlot;
  if (!slot?.skillId) return null;
  const fleet = simulation?.fleetBySeat?.(seat);
  const hull = fleetHullRatio(fleet);
  if (slot.skillId === "repair_drones" && hull < 0.72) {
    return {
      type: "use_tactical_skill",
      targetType: "fleet",
      targetSeat: seat,
      reason: "use_repair_drones",
    };
  }
  if (slot.skillId === "all_fleet_shield" && hull < 0.58) {
    return {
      type: "use_tactical_skill",
      targetType: "none",
      reason: "use_all_fleet_shield",
    };
  }
  if (slot.skillId === "propulsion_overload" && hull > 0.38) {
    return {
      type: "use_tactical_skill",
      targetType: "none",
      reason: "use_propulsion_overload",
    };
  }
  if (slot.skillId === "firepower_overload" && hull > 0.45) {
    return {
      type: "use_tactical_skill",
      targetType: "none",
      reason: "use_firepower_overload",
    };
  }
  const enemy = nearestEnemyShip(simulation, seat);
  if (slot.skillId === "gravity_field" && enemy) {
    return {
      type: "use_tactical_skill",
      targetType: "point",
      targetX: enemy.x,
      targetY: enemy.y,
      reason: "use_gravity_field",
    };
  }
  const own = mainShip(simulation, seat);
  if (slot.skillId === "short_warp" && own && hull < 0.5) {
    const safe = safeAreaTarget(modeState, simulation, allianceId);
    const dx = safe.x - own.x;
    const dy = safe.y - own.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const hop = Math.min(220, len);
    return {
      type: "use_tactical_skill",
      targetType: "point",
      targetSeat: seat,
      targetX: own.x + (dx / len) * hop,
      targetY: own.y + (dy / len) * hop,
      reason: "use_short_warp",
    };
  }
  return null;
}

function candidateObjectives({ seat, simulation, modeState }) {
  const allianceId = allianceIdForSeat(seat);
  const objectives = [];
  objectives.push({
    type: "retreat",
    target: safeAreaTarget(modeState, simulation, allianceId),
  });
  for (const pickup of modeState?.pickups || []) {
    objectives.push({ type: "collect_resource", target: pickup });
  }
  for (const pickup of modeState?.skillPickups || []) {
    objectives.push({ type: "collect_skill", target: pickup });
  }
  for (const point of modeState?.map?.controlPoints || []) {
    objectives.push({
      type: point.ownerAllianceId === allianceId ? "defend_control_point" : "capture_control_point",
      target: point,
    });
  }
  for (const enemy of enemyShips(simulation, seat)) {
    objectives.push({ type: "attack_enemy", target: enemy });
  }
  return objectives;
}

export function chooseTerritoryAiAction({ seat, simulation, modeState, allowTacticalSkills = true } = {}) {
  const allianceId = allianceIdForSeat(seat);
  const coordinator = allianceCoordinator(modeState, allianceId);
  const ship = mainShip(simulation, seat);
  if (!ship?.alive) {
    if (coordinator?.assignments) delete coordinator.assignments[seat];
    return null;
  }
  const skillAction = allowTacticalSkills ? tacticalSkillAction({ seat, simulation, modeState }) : null;
  if (skillAction) return skillAction;
  const otherAssignments = Object.entries(coordinator?.assignments || {})
    .filter(([assignedSeat]) => assignedSeat !== seat)
    .map(([, assignment]) => assignment);
  const candidates = candidateObjectives({ seat, simulation, modeState })
    .map((objective) => ({
      objective,
      score: scoreTerritoryObjective({ objective, seat, simulation, modeState })
        + openingRoleBonus({ objective, seat, modeState }),
      targetId: objectiveTargetId(objective, allianceId),
      objectiveKey: objectiveKey(objective, allianceId),
    }));
  const now = Number(modeState?.elapsed || 0);
  const currentAssignment = coordinator?.assignments?.[seat] || null;
  const hasCapacity = (candidate) => {
    const reserved = otherAssignments.filter((assignment) => assignment.objectiveKey === candidate.objectiveKey).length;
    return reserved < objectiveCapacity(candidate.objective, allianceId);
  };
  const lockedCandidate = currentAssignment && Number(currentAssignment.lockUntil || 0) > now
    ? candidates.find((candidate) => (
        candidate.objectiveKey === currentAssignment.objectiveKey
        && candidate.score > 0
        && hasCapacity(candidate)
      ))
    : null;
  const emergencyCandidate = candidates.find((candidate) => candidate.objective.type === "retreat" && candidate.score > 0) || null;
  const available = candidates
    .filter(hasCapacity)
    .sort((a, b) => b.score - a.score);
  const continuingLocked = !emergencyCandidate && lockedCandidate;
  const best = emergencyCandidate || continuingLocked || available[0];
  if (!best || best.score <= 0) {
    if (coordinator?.assignments) delete coordinator.assignments[seat];
    return null;
  }
  if (coordinator) {
    coordinator.assignments[seat] = {
      objectiveType: best.objective.type,
      targetId: best.targetId,
      objectiveKey: best.objectiveKey,
      score: best.score,
      lockUntil: continuingLocked ? currentAssignment.lockUntil : now + 4,
    };
  }
  const target = best.objective.target?.center || best.objective.target?.position || best.objective.target;
  return routeAction(
    ship,
    target,
    best.objective.type === "retreat" ? "retreat" : best.objective.type,
    best.score,
    best.objectiveKey,
  );
}
