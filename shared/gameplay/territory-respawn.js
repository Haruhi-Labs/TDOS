import { territorySpawnDeployment } from "./territory-spawns.js";

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
  return Math.max(0, current - after);
}

function updateRespawnProtection({ modeState, simulation } = {}) {
  const events = [];
  const now = Number(simulation?.elapsed) || 0;
  for (const seat of simulation?.fleetSeats || []) {
    const allianceId = allianceIdForSeat(seat);
    const spawn = (modeState?.map?.spawnAreas || []).find((area) => area.allianceId === allianceId);
    const fleet = simulation?.fleetBySeat?.(seat);
    for (const shipKey of ["main", "sub1", "sub2"]) {
      const ship = fleet?.shipByKey?.(shipKey);
      const deadline = Number(ship?.spawnProtectionUntil) || 0;
      if (!ship?.alive || deadline <= 0) continue;
      let reason = null;
      if (deadline <= now) {
        reason = "timeout";
      } else if (spawn?.center && Number(spawn.radius) > 0) {
        const distance = Math.hypot(ship.x - spawn.center.x, ship.y - spawn.center.y);
        if (distance > Number(spawn.radius)) reason = "left_spawn";
      }
      if (!reason) continue;
      ship.spawnProtectionUntil = 0;
      events.push({
        type: "respawn_protection_ended",
        position: { x: ship.x, y: ship.y },
        allianceId,
        seat,
        payload: { shipKey, reason },
      });
    }
  }
  return events;
}

export function queueTerritoryRespawns({ modeState, simulation, mutate = false } = {}) {
  const next = mutate ? modeState : cloneJson(modeState);
  const events = [];
  next.respawnQueue = next.respawnQueue || [];
  next.shipHistory = next.shipHistory || {};
  next.deathLedger = next.deathLedger || {};
  next.fleetWipeState = next.fleetWipeState || {};
  const queued = new Set(next.respawnQueue.map((item) => queueKey(item.seat, item.shipKey)));

  for (const seat of simulation?.fleetSeats || ["A", "B"]) {
    const fleet = simulation?.fleetBySeat?.(seat);
    const allianceId = allianceIdForSeat(seat);
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
      const spawn = territorySpawnDeployment({ modeState: next, seat, shipKey });
      next.respawnQueue.push({
        seat,
        shipKey,
        allianceId,
        deathLedgerKey: ledgerKey,
        spawnPosition: spawn ? { x: spawn.x, y: spawn.y } : null,
        remaining,
        total: remaining,
        deathCount: history.deaths,
      });
      queued.add(key);
      const ticketCost = deductTickets(next, allianceId, DEATH_TICKET_COST[shipKey] || 0);
      events.push({
        type: "respawn_queued",
        position: { x: ship.x, y: ship.y },
        allianceId,
        seat,
        payload: { shipKey, remaining, ticketCost },
      });
    }
    const allBasicShipsDead = ["main", "sub1", "sub2"].every((shipKey) => {
      const ship = fleet?.shipByKey?.(shipKey);
      return ship && !ship.alive;
    });
    if (allBasicShipsDead && !next.fleetWipeState[seat]) {
      const amount = deductTickets(next, allianceId, 3);
      events.push({
        type: "fleet_wiped_ticket_penalty",
        allianceId,
        seat,
        payload: { amount },
      });
    }
    next.fleetWipeState[seat] = allBasicShipsDead;
  }

  return { modeState: next, events };
}

export function updateTerritoryRespawns({ modeState, simulation, dt, mutate = false } = {}) {
  const next = mutate ? modeState : cloneJson(modeState);
  const events = [];
  const remaining = [];
  for (const item of next.respawnQueue || []) {
    const updated = { ...item, remaining: Math.max(0, Number(item.remaining || 0) - Math.max(0, Number(dt) || 0)) };
    if (updated.remaining > 1e-9) {
      remaining.push(updated);
      continue;
    }
    const spawn = updated.spawnPosition || territorySpawnDeployment({
      modeState: next,
      seat: updated.seat,
      shipKey: updated.shipKey,
    });
    const ok = simulation?.respawnShipForSeat?.(updated.seat, updated.shipKey, {
      x: spawn?.x,
      y: spawn?.y,
      hpRatio: 1,
      energyRatio: 0.5,
      protectionSeconds: 3,
    });
    if (ok) {
      const ledgerKey = updated.deathLedgerKey || deathKey(
        updated.seat,
        updated.shipKey,
        simulation?.fleetBySeat?.(updated.seat)?.shipByKey?.(updated.shipKey),
      );
      if (next.deathLedger) delete next.deathLedger[ledgerKey];
      if (next.fleetWipeState) next.fleetWipeState[updated.seat] = false;
      events.push({
        type: "ship_respawned",
        position: spawn ? { x: spawn.x, y: spawn.y } : null,
        allianceId: updated.allianceId,
        seat: updated.seat,
        payload: { shipKey: updated.shipKey },
      });
    } else {
      remaining.push(updated);
    }
  }
  next.respawnQueue = remaining;
  events.push(...updateRespawnProtection({ modeState: next, simulation }));
  return { modeState: next, events };
}

export function applyRespawnProtectionRules({ simulation, action, seat } = {}) {
  if (!action || !seat) return false;
  const activeTypes = new Set(["cast_flagship_skill", "cast_sub_skill", "use_tactical_skill"]);
  if (!activeTypes.has(action.type)) return false;
  const fleet = simulation?.fleetBySeat?.(seat);
  if (action.type === "use_tactical_skill") {
    let cleared = false;
    for (const ship of fleet?.getAllShips?.() || []) {
      if (!ship?.alive || !ship.spawnProtectionUntil) continue;
      ship.spawnProtectionUntil = 0;
      cleared = true;
    }
    return cleared;
  }
  const shipKey = action.shipKey || "main";
  const ship = fleet?.shipByKey?.(shipKey);
  if (!ship || !ship.spawnProtectionUntil) return false;
  ship.spawnProtectionUntil = 0;
  return true;
}
