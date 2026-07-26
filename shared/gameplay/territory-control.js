function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function distance(a, b) {
  const dx = Number(a?.x || 0) - Number(b?.x || 0);
  const dy = Number(a?.y || 0) - Number(b?.y || 0);
  return Math.hypot(dx, dy);
}

function allianceIdForSeat(seat) {
  return String(seat || "A").toUpperCase().startsWith("B") ? "B" : "A";
}

function emptyOccupants() {
  return { A: [], B: [] };
}

function livingBasicShipsInPoint(simulation, point) {
  const occupants = emptyOccupants();
  if (!simulation || !point?.center) return occupants;
  for (const seat of simulation.fleetSeats || ["A", "B"]) {
    const fleet = simulation.fleetBySeat?.(seat);
    const allianceId = allianceIdForSeat(seat);
    for (const ship of Object.values(fleet?.ships || {})) {
      if (!ship?.alive) continue;
      if (distance(point.center, ship) <= (point.radius || 0) + (ship.radius || 0)) {
        occupants[allianceId].push({ seat, shipKey: ship.key || ship.slotKey, shipId: ship.id });
      }
    }
  }
  return occupants;
}

function dominantOccupantAlliance(occupants) {
  const a = occupants.A.length;
  const b = occupants.B.length;
  if (a > 0 && b > 0) return { allianceId: null, contested: true };
  if (a > 0) return { allianceId: "A", contested: false };
  if (b > 0) return { allianceId: "B", contested: false };
  return { allianceId: null, contested: false };
}

function updatePoint(point, occupants, dt, captureSeconds) {
  const next = {
    ...point,
    occupants,
  };
  const presence = dominantOccupantAlliance(occupants);
  next.contested = presence.contested;
  if (presence.contested || !presence.allianceId) {
    next.capturingAllianceId = null;
    return next;
  }

  const delta = Math.max(0, Number(dt) || 0) / Math.max(0.1, Number(captureSeconds) || 6);
  const allianceId = presence.allianceId;

  if (next.ownerAllianceId === allianceId) {
    next.capturingAllianceId = null;
    next.captureProgress = 1;
    return next;
  }

  next.capturingAllianceId = allianceId;

  if (next.ownerAllianceId && next.ownerAllianceId !== allianceId) {
    next.captureProgress = Math.max(0, Number(next.captureProgress || 0) - delta);
    if (next.captureProgress <= 0) {
      next.ownerAllianceId = null;
      next.captureProgress = 0;
    }
    return next;
  }

  next.captureProgress = Math.min(1, Number(next.captureProgress || 0) + delta);
  if (next.captureProgress + 1e-9 >= 1) {
    next.ownerAllianceId = allianceId;
    next.capturingAllianceId = null;
    next.captureProgress = 1;
  }
  return next;
}

export function updateTerritoryControl({ modeState, simulation, dt, parameters = {} } = {}) {
  const next = cloneJson(modeState);
  const captureSeconds = Number(parameters.captureSeconds) || 6;
  const events = [];
  next.map = {
    ...(next.map || {}),
    controlPoints: (next.map?.controlPoints || []).map((point) => {
      const beforeOwner = point.ownerAllianceId || null;
      const occupants = livingBasicShipsInPoint(simulation, point);
      const updated = updatePoint(point, occupants, dt, captureSeconds);
      if ((updated.ownerAllianceId || null) !== beforeOwner) {
        events.push({
          type: "control_point_owner_changed",
          position: { ...updated.center },
          allianceId: updated.ownerAllianceId || null,
          payload: {
            controlPointId: updated.id,
            previousOwnerAllianceId: beforeOwner,
            ownerAllianceId: updated.ownerAllianceId || null,
          },
        });
      }
      return updated;
    }),
  };
  return { modeState: next, events };
}

function countOwned(controlPoints, allianceId) {
  return controlPoints.filter((point) => point.ownerAllianceId === allianceId).length;
}

function drainInfo(controlPoints) {
  const a = countOwned(controlPoints, "A");
  const b = countOwned(controlPoints, "B");
  if (a === b) return null;
  const loser = a > b ? "B" : "A";
  const lead = Math.abs(a - b);
  const interval = lead >= 3 ? 2.5 : 4;
  return { loser, interval };
}

export function updateTerritoryTickets({ modeState, dt } = {}) {
  const next = cloneJson(modeState);
  const events = [];
  const controlPoints = next.map?.controlPoints || [];
  const info = drainInfo(controlPoints);
  next.ticketTimers = next.ticketTimers || { A: 0, B: 0 };
  if (!info || next.result?.finished) {
    return { modeState: next, events };
  }

  const loser = info.loser;
  next.ticketTimers[loser] = Number(next.ticketTimers[loser] || 0) + Math.max(0, Number(dt) || 0);
  while (next.ticketTimers[loser] + 1e-9 >= info.interval && !next.result?.finished) {
    next.ticketTimers[loser] -= info.interval;
    const current = Number(next.alliances?.[loser]?.tickets || 0);
    const after = Math.max(0, current - 1);
    next.alliances[loser].tickets = after;
    events.push({
      type: "ticket_drained",
      allianceId: loser,
      payload: {
        amount: 1,
        remainingTickets: after,
        reason: "control_deficit",
      },
    });
    if (after <= 0) {
      const winnerAllianceId = loser === "A" ? "B" : "A";
      next.result = {
        finished: true,
        winnerAllianceId,
        winnerSeat: null,
        reason: "tickets_depleted",
        label: `${winnerAllianceId} 阵营战争点数获胜`,
      };
    }
  }

  return { modeState: next, events };
}
