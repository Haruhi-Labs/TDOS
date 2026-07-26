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
  return fleet?.shipByKey?.("main") || fleet?.getAllShips?.().find((ship) => ship?.alive) || null;
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

function routeAction(ship, target, reason, score) {
  if (!ship || !target) return null;
  return {
    type: "set_route",
    shipKey: "main",
    endX: Number(target.x),
    endY: Number(target.y),
    throttle: reason === "retreat" ? 1.18 : 1.05,
    reason,
    objectiveScore: score,
  };
}

function nearestEnemyShip(simulation, seat) {
  const own = mainShip(simulation, seat);
  const enemies = simulation?.fleetsForAlliance?.(enemyAllianceId(allianceIdForSeat(seat))) || [];
  const ships = enemies.flatMap((fleet) => fleet.getAllShips?.() || []).filter((ship) => ship?.alive);
  return ships.sort((a, b) => distance(own, a) - distance(own, b))[0] || null;
}

function scoreDistance(ship, target, nearScale = 720) {
  if (!ship || !target) return 0;
  return Math.max(0, nearScale - distance(ship, target)) / Math.max(1, nearScale);
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
  const enemy = nearestEnemyShip(simulation, seat);
  if (enemy) objectives.push({ type: "attack_enemy", target: enemy });
  return objectives;
}

export function chooseTerritoryAiAction({ seat, simulation, modeState } = {}) {
  const skillAction = tacticalSkillAction({ seat, simulation, modeState });
  if (skillAction) return skillAction;
  const ship = mainShip(simulation, seat);
  if (!ship?.alive) return null;
  const scored = candidateObjectives({ seat, simulation, modeState })
    .map((objective) => ({
      objective,
      score: scoreTerritoryObjective({ objective, seat, simulation, modeState }),
    }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score <= 0) return null;
  const target = best.objective.target?.center || best.objective.target?.position || best.objective.target;
  return routeAction(ship, target, best.objective.type === "retreat" ? "retreat" : best.objective.type, best.score);
}
