const RESPAWN_SECONDS = Object.freeze({
  main: 24,
  sub1: 16,
  sub2: 16,
});

const DEATH_TICKET_COST = Object.freeze({
  main: 5,
  sub1: 2,
  sub2: 2,
});

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function allianceIdForSeat(seat) {
  return String(seat || "A").toUpperCase().startsWith("B") ? "B" : "A";
}

function spawnAreaForSeat(modeState, seat) {
  const allianceId = allianceIdForSeat(seat);
  return (modeState.map?.spawnAreas || []).find((area) => area.allianceId === allianceId) || null;
}

function queueKey(seat, shipKey) {
  return `${String(seat || "").toUpperCase()}:${String(shipKey || "")}`;
}

function deathKey(seat, shipKey, ship) {
  return `${queueKey(seat, shipKey)}:${ship?.id || "ship"}`;
}

function deathDelay(shipKey, history) {
  const base = RESPAWN_SECONDS[shipKey] || 16;
  const count = Number(history?.deaths || 0);
  return base + Math.min(9, Math.max(0, count - 1) * 3);
}

function deductTickets(next, allianceId, amount) {
  const current = Number(next.alliances?.[allianceId]?.tickets || 0);
  const after = Math.max(0, current - amount);
  next.alliances[allianceId].tickets = after;
  if (after <= 0 && !next.result?.finished) {
    const winnerAllianceId = allianceId === "A" ? "B" : "A";
    next.result = {
      finished: true,
      winnerAllianceId,
      winnerSeat: null,
      reason: "tickets_depleted",
      label: `${winnerAllianceId} 阵营战争点数获胜`,
    };
  }
}

export function queueTerritoryRespawns({ modeState, simulation } = {}) {
  const next = cloneJson(modeState);
  const events = [];
  next.respawnQueue = next.respawnQueue || [];
  next.shipHistory = next.shipHistory || {};
  next.deathLedger = next.deathLedger || {};
  const queued = new Set(next.respawnQueue.map((item) => queueKey(item.seat, item.shipKey)));

  for (const seat of simulation?.fleetSeats || ["A", "B"]) {
    const fleet = simulation?.fleetBySeat?.(seat);
    const allianceId = allianceIdForSeat(seat);
    let newlyDeadBasic = 0;
    for (const shipKey of ["main", "sub1", "sub2"]) {
      const ship = fleet?.shipByKey?.(shipKey);
      if (!ship || ship.alive) continue;
      const key = queueKey(seat, shipKey);
      const ledgerKey = deathKey(seat, shipKey, ship);
      if (queued.has(key) || next.deathLedger[ledgerKey]) continue;
      const history = next.shipHistory[key] || { deaths: 0 };
      history.deaths += 1;
      next.shipHistory[key] = history;
      next.deathLedger[ledgerKey] = true;
      const remaining = deathDelay(shipKey, history);
      next.respawnQueue.push({
        seat,
        shipKey,
        allianceId,
        remaining,
        total: remaining,
        deathCount: history.deaths,
      });
      queued.add(key);
      newlyDeadBasic += 1;
      deductTickets(next, allianceId, DEATH_TICKET_COST[shipKey] || 0);
      events.push({
        type: "respawn_queued",
        position: { x: ship.x, y: ship.y },
        allianceId,
        seat,
        payload: { shipKey, remaining, ticketCost: DEATH_TICKET_COST[shipKey] || 0 },
      });
    }
    if (newlyDeadBasic >= 3) {
      deductTickets(next, allianceId, 3);
      events.push({
        type: "fleet_wiped_ticket_penalty",
        allianceId,
        seat,
        payload: { amount: 3 },
      });
    }
  }

  return { modeState: next, events };
}

export function updateTerritoryRespawns({ modeState, simulation, dt } = {}) {
  const next = cloneJson(modeState);
  const events = [];
  const remaining = [];
  for (const item of next.respawnQueue || []) {
    const updated = { ...item, remaining: Math.max(0, Number(item.remaining || 0) - Math.max(0, Number(dt) || 0)) };
    if (updated.remaining > 1e-9) {
      remaining.push(updated);
      continue;
    }
    const spawn = spawnAreaForSeat(next, updated.seat);
    const ok = simulation?.respawnShipForSeat?.(updated.seat, updated.shipKey, {
      x: spawn?.center?.x,
      y: spawn?.center?.y,
      hpRatio: 1,
      energyRatio: 0.5,
      protectionSeconds: 3,
    });
    if (ok) {
      events.push({
        type: "ship_respawned",
        position: spawn?.center ? { ...spawn.center } : null,
        allianceId: updated.allianceId,
        seat: updated.seat,
        payload: { shipKey: updated.shipKey },
      });
    } else {
      remaining.push(updated);
    }
  }
  next.respawnQueue = remaining;
  return { modeState: next, events };
}

export function applyRespawnProtectionRules({ simulation, action, seat } = {}) {
  if (!action || !seat) return false;
  const activeTypes = new Set(["set_route", "cast_flagship_skill", "cast_sub_skill", "use_tactical_skill", "emergency_brake"]);
  if (!activeTypes.has(action.type)) return false;
  const fleet = simulation?.fleetBySeat?.(seat);
  const shipKey = action.shipKey || "main";
  const ship = fleet?.shipByKey?.(shipKey);
  if (!ship || !ship.spawnProtectionUntil) return false;
  ship.spawnProtectionUntil = 0;
  return true;
}
