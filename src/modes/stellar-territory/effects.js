function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function occupantCount(point) {
  return (point?.occupants?.A?.length || 0) + (point?.occupants?.B?.length || 0);
}

function ticketImpactFromEvents(events, allianceId) {
  let amount = 0;
  let reason = null;
  for (const event of events || []) {
    if (event?.allianceId !== allianceId) continue;
    if (event.type === "ticket_drained") {
      amount += Math.max(0, Number(event.payload?.amount) || 0);
      reason = event.payload?.reason === "control_deficit" ? "控制区劣势" : "战争点数减少";
    } else if (event.type === "respawn_queued") {
      const ticketCost = Math.max(0, Number(event.payload?.ticketCost) || 0);
      if (ticketCost > 0) {
        amount += ticketCost;
        reason = "舰船被击毁";
      }
    } else if (event.type === "fleet_wiped_ticket_penalty") {
      amount += Math.max(0, Number(event.payload?.amount) || 0);
      reason = "编队全灭";
    }
  }
  return amount > 0 ? { amount, reason } : null;
}

function freshEvents(previous, events) {
  const seen = new Set(previous?.seenEventIds || []);
  const fresh = [];
  for (const event of events || []) {
    const id = event?.id == null ? null : String(event.id);
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    fresh.push(event);
  }
  return { fresh, seenEventIds: Array.from(seen).slice(-256) };
}

const NAVIGATION_FEEDBACK_DURATION = 3;
const NAVIGATION_FEEDBACK_LIMIT = 16;
const NAVIGATION_FEEDBACK_KINDS = Object.freeze({
  invalid_route_target: "invalid",
  navigation_replanned: "replanned",
  navigation_stuck: "stuck",
  obstacle_collision: "collision",
});

function finitePosition(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function advanceNavigationFeedback(previous, events, delta, time, isNavigationFeedbackVisible) {
  const feedback = (previous?.navigationFeedback || [])
    .map((item) => ({
      ...item,
      strength: Math.max(0, Number(item.strength || 0) - delta / NAVIGATION_FEEDBACK_DURATION),
    }))
    .filter((item) => item.strength > 0);

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const kind = NAVIGATION_FEEDBACK_KINDS[event?.type];
    const position = finitePosition(event?.position || event?.payload?.target);
    if (!kind || !position) continue;
    const item = {
      id: String(event.id ?? `navigation-${time}-${index}`),
      kind,
      position,
      seat: event?.seat == null ? null : String(event.seat),
      shipKey: event?.payload?.shipKey == null ? null : String(event.payload.shipKey),
      entityId: event?.payload?.entityId == null ? null : String(event.payload.entityId),
      strength: 1,
    };
    if (typeof isNavigationFeedbackVisible === "function" && !isNavigationFeedbackVisible(item)) continue;
    feedback.push(item);
  }

  return feedback.slice(-NAVIGATION_FEEDBACK_LIMIT);
}

function advanceRespawnEffects(previous, presentationState, events, delta) {
  const respawns = {};
  for (const [key, prior] of Object.entries(previous?.respawns || {})) {
    const materialize = Math.max(0, Number(prior.materialize || 0) - delta / 0.8);
    const shockwave = Math.max(0, Number(prior.shockwave || 0) - delta / 1.05);
    if (materialize > 0 || shockwave > 0) {
      respawns[key] = {
        ...prior,
        phase: materialize > 0 ? "materialize" : "shockwave",
        preheat: 0,
        materialize,
        shockwave,
      };
    }
  }
  for (const item of presentationState?.respawnQueue || []) {
    const remaining = Math.max(0, Number(item.remaining) || 0);
    if (remaining > 3 || !item.spawnPosition) continue;
    const key = `${item.seat}:${item.shipKey}`;
    respawns[key] = {
      ...(respawns[key] || {}),
      seat: item.seat,
      shipKey: item.shipKey,
      phase: "preheat",
      position: { ...item.spawnPosition },
      preheat: clamp01(1 - remaining / 3),
      materialize: 0,
      shockwave: 0,
    };
  }
  for (const event of events) {
    if (event?.type !== "ship_respawned" || !event.position) continue;
    const key = `${event.seat}:${event.payload?.shipKey || "main"}`;
    respawns[key] = {
      seat: event.seat,
      shipKey: event.payload?.shipKey || "main",
      phase: "materialize",
      position: { ...event.position },
      preheat: 0,
      materialize: 1,
      shockwave: 1,
    };
  }
  return respawns;
}

function snapshotShips(snapshot) {
  const ships = new Map();
  const fleets = snapshot?.fleets || snapshot?.teams || {};
  for (const fleet of Object.values(fleets)) {
    for (const ship of Object.values(fleet?.ships || {})) {
      if (ship?.id) ships.set(ship.id, ship);
    }
  }
  return ships;
}

function advanceProtectionEffects(previous, snapshot, delta) {
  const protections = {};
  const currentShips = snapshotShips(snapshot);
  const keys = new Set([...Object.keys(previous?.protections || {}), ...currentShips.keys()]);
  for (const shipId of keys) {
    const prior = previous?.protections?.[shipId] || null;
    const ship = currentShips.get(shipId) || null;
    const remaining = Math.max(0, Number(ship?.spawnProtectionRemaining) || 0);
    if (remaining > 0 && ship?.alive !== false) {
      protections[shipId] = {
        position: { x: ship.x, y: ship.y },
        radius: Number(ship.radius) || 18,
        remaining,
        shield: 1,
        breakStrength: Math.max(0, Number(prior?.breakStrength || 0) - delta / 0.65),
      };
      continue;
    }
    const breakStrength = prior?.shield > 0
      ? 1
      : Math.max(0, Number(prior?.breakStrength || 0) - delta / 0.65);
    if (breakStrength > 0) {
      protections[shipId] = {
        position: ship ? { x: ship.x, y: ship.y } : prior.position,
        radius: Number(ship?.radius) || Number(prior.radius) || 18,
        remaining: 0,
        shield: 0,
        breakStrength,
      };
    }
  }
  return protections;
}

function snapshotShipForSeat(snapshot, seat, shipKey) {
  const fleets = snapshot?.fleets || snapshot?.teams || {};
  return fleets?.[seat]?.ships?.[shipKey] || null;
}

function snapshotFleetAnchor(snapshot, seat) {
  const fleets = snapshot?.fleets || snapshot?.teams || {};
  const ships = fleets?.[seat]?.ships || {};
  const main = ships.main;
  if (main?.alive !== false) return main || null;
  return Object.values(ships).find((ship) => ship?.alive !== false) || null;
}

const ALLIANCE_WIDE_ACTIVE_SKILLS = new Set([
  "all_fleet_shield",
  "propulsion_overload",
  "firepower_overload",
]);

function snapshotAllianceFleetSeats(snapshot, allianceId) {
  const fleets = snapshot?.fleets || snapshot?.teams || {};
  const declared = snapshot?.alliances?.[allianceId]?.fleetSeats;
  const candidates = Array.isArray(declared) && declared.length > 0
    ? declared
    : Object.keys(fleets).filter((seat) => String(seat).toUpperCase().startsWith(String(allianceId || "").toUpperCase()));
  return candidates.filter((seat) => snapshotFleetAnchor(snapshot, seat));
}

function formatRecoveryValue(value) {
  const amount = Math.max(0, Number(value) || 0);
  if (amount > 0 && amount < 0.05) return "<0.1";
  const rounded = Math.round((amount + Number.EPSILON) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function resourceFeedbackLabels(payload = {}) {
  const labels = [];
  const prefix = payload.fleetWide ? "全队 " : "";
  const hullRatio = Number(payload.hullRatio);
  const energyRatio = Number(payload.energyRatio);
  const respawnSeconds = Number(payload.respawnSeconds);
  if (Number.isFinite(hullRatio) && hullRatio > 0) {
    labels.push(`${prefix}耐久 +${formatRecoveryValue(hullRatio * 100)}%`);
  }
  if (Number.isFinite(energyRatio) && energyRatio > 0) {
    labels.push(`${prefix}能量 +${formatRecoveryValue(energyRatio * 100)}%`);
  }
  if (Number.isFinite(respawnSeconds) && respawnSeconds > 0) {
    labels.push(`复活 -${formatRecoveryValue(respawnSeconds)}秒`);
  }
  return labels;
}

function advanceResourceEffects(previous, presentationState, snapshot, events, delta) {
  const resources = previous?.resources || {};
  const elapsed = Number(presentationState?.elapsed);
  const hasElapsed = Number.isFinite(elapsed);
  const warnings = {};
  const spawns = {};
  const collections = {};

  for (const [key, prior] of Object.entries(resources.warnings || {})) {
    const spawnAt = Number(prior.spawnAt);
    const remaining = hasElapsed && Number.isFinite(spawnAt)
      ? Math.max(0, spawnAt - elapsed)
      : Math.max(0, Number(prior.remaining || 0) - delta);
    warnings[key] = { ...prior, remaining };
  }
  for (const [key, prior] of Object.entries(resources.spawns || {})) {
    const strength = Math.max(0, Number(prior.strength || 0) - delta / 0.9);
    if (strength > 0) spawns[key] = { ...prior, strength };
  }
  for (const [key, prior] of Object.entries(resources.collections || {})) {
    const strength = Math.max(0, Number(prior.strength || 0) - delta / 1.15);
    if (strength <= 0) continue;
    const ship = snapshotShipForSeat(snapshot, prior.seat, prior.shipKey);
    collections[key] = {
      ...prior,
      targetPosition: ship ? { x: ship.x, y: ship.y } : prior.targetPosition,
      strength,
    };
  }

  for (const event of events) {
    const payload = event?.payload || {};
    if (event?.type === "resource_warning" && event.position) {
      const key = String(payload.nodeId || event.id || "resource-warning");
      const spawnAt = Number(payload.spawnAt);
      const remaining = hasElapsed && Number.isFinite(spawnAt)
        ? Math.max(0, spawnAt - elapsed)
        : 0;
      warnings[key] = {
        position: { ...event.position },
        resourceType: payload.resourceType || null,
        rarity: payload.rarity || null,
        nodeId: payload.nodeId || null,
        spawnAt: Number.isFinite(spawnAt) ? spawnAt : null,
        duration: remaining,
        remaining,
      };
    } else if (event?.type === "resource_spawned" && event.position) {
      const key = String(payload.pickupId || event.id || "resource-spawn");
      if (payload.nodeId) delete warnings[String(payload.nodeId)];
      spawns[key] = {
        position: { ...event.position },
        resourceType: payload.resourceType || null,
        rarity: payload.rarity || null,
        strength: 1,
      };
    } else if (event?.type === "resource_collected" && event.position) {
      const key = String(event.id || payload.pickupId || "resource-collection");
      if (payload.pickupId) delete spawns[String(payload.pickupId)];
      const ship = snapshotShipForSeat(snapshot, event.seat, payload.shipKey);
      collections[key] = {
        position: { ...event.position },
        targetPosition: ship ? { x: ship.x, y: ship.y } : { ...event.position },
        allianceId: event.allianceId || null,
        seat: event.seat || null,
        shipKey: payload.shipKey || null,
        resourceType: payload.resourceType || null,
        labels: resourceFeedbackLabels(payload),
        strength: 1,
      };
    }
  }

  return { warnings, spawns, collections };
}

function advanceSkillEffects(previous, presentationState, snapshot, events, delta) {
  const skills = previous?.skills || {};
  const elapsed = Number(presentationState?.elapsed);
  const hasElapsed = Number.isFinite(elapsed);
  const warnings = {};
  const spawns = {};
  const collections = {};
  const uses = {};
  const active = {};
  const endings = {};

  for (const [key, prior] of Object.entries(skills.warnings || {})) {
    const spawnAt = Number(prior.spawnAt);
    const remaining = hasElapsed && Number.isFinite(spawnAt)
      ? Math.max(0, spawnAt - elapsed)
      : Math.max(0, Number(prior.remaining || 0) - delta);
    warnings[key] = { ...prior, remaining };
  }
  for (const [key, prior] of Object.entries(skills.spawns || {})) {
    const strength = Math.max(0, Number(prior.strength || 0) - delta / 0.9);
    if (strength > 0) spawns[key] = { ...prior, strength };
  }
  for (const [key, prior] of Object.entries(skills.collections || {})) {
    const strength = Math.max(0, Number(prior.strength || 0) - delta / 1.05);
    if (strength <= 0) continue;
    const ship = snapshotShipForSeat(snapshot, prior.seat, prior.shipKey);
    collections[key] = {
      ...prior,
      targetPosition: ship ? { x: ship.x, y: ship.y } : prior.targetPosition,
      strength,
    };
  }
  for (const [key, prior] of Object.entries(skills.uses || {})) {
    const strength = Math.max(0, Number(prior.strength || 0) - delta / 0.85);
    if (strength > 0) uses[key] = { ...prior, strength };
  }
  for (const [key, prior] of Object.entries(skills.endings || {})) {
    const strength = Math.max(0, Number(prior.strength || 0) - delta / 1.0);
    if (strength > 0) endings[key] = { ...prior, strength };
  }

  for (const effect of presentationState?.activeSkillEffects || []) {
    const baseKey = String(effect.id || `${effect.skillId}:${effect.seat || "unknown"}`);
    const fleetSeats = !effect.position
      && !effect.targetSeat
      && ALLIANCE_WIDE_ACTIVE_SKILLS.has(effect.skillId)
      ? snapshotAllianceFleetSeats(snapshot, effect.allianceId)
      : [effect.targetSeat || effect.seat].filter(Boolean);
    const visualTargets = effect.position
      ? [{ key: baseKey, seat: null, position: { ...effect.position } }]
      : fleetSeats.map((seat) => {
          const anchor = snapshotFleetAnchor(snapshot, seat);
          return {
            key: fleetSeats.length > 1 ? `${baseKey}:${seat}` : baseKey,
            seat,
            position: anchor ? { x: anchor.x, y: anchor.y } : null,
          };
        });

    for (const target of visualTargets) {
      const prior = skills.active?.[target.key] || null;
      const endsAt = Number(effect.endsAt);
      const remaining = hasElapsed && Number.isFinite(endsAt)
        ? Math.max(0, endsAt - elapsed)
        : Math.max(0, Number(prior?.remaining ?? effect.duration) - delta);
      active[target.key] = {
        effectId: effect.id || null,
        skillId: effect.skillId || null,
        allianceId: effect.allianceId || null,
        seat: effect.seat || null,
        targetSeat: target.seat || effect.targetSeat || null,
        position: target.position || prior?.position || null,
        radius: Number(effect.payload?.radius) || null,
        duration: Math.max(0, Number(effect.duration) || 0),
        remaining,
      };
    }
  }

  for (const event of events) {
    const payload = event?.payload || {};
    if (event?.type === "skill_warning" && event.position) {
      const key = String(payload.nodeId || event.id || "skill-warning");
      const spawnAt = Number(payload.spawnAt);
      const remaining = hasElapsed && Number.isFinite(spawnAt)
        ? Math.max(0, spawnAt - elapsed)
        : 0;
      warnings[key] = {
        position: { ...event.position },
        skillId: payload.skillId || null,
        nodeId: payload.nodeId || null,
        spawnAt: Number.isFinite(spawnAt) ? spawnAt : null,
        duration: remaining,
        remaining,
      };
    } else if (event?.type === "skill_spawned" && event.position) {
      const key = String(payload.pickupId || event.id || "skill-spawn");
      if (payload.nodeId) delete warnings[String(payload.nodeId)];
      spawns[key] = {
        position: { ...event.position },
        skillId: payload.skillId || null,
        strength: 1,
      };
    } else if (event?.type === "skill_collected" && event.position) {
      const key = String(event.id || payload.pickupId || "skill-collection");
      if (payload.pickupId) delete spawns[String(payload.pickupId)];
      const ship = snapshotShipForSeat(snapshot, event.seat, payload.shipKey);
      collections[key] = {
        position: { ...event.position },
        targetPosition: ship ? { x: ship.x, y: ship.y } : { ...event.position },
        allianceId: event.allianceId || null,
        seat: event.seat || null,
        shipKey: payload.shipKey || null,
        skillId: payload.skillId || null,
        strength: 1,
      };
    } else if (event?.type === "skill_used") {
      const key = String(event.id || payload.effectId || "skill-use");
      const anchor = snapshotFleetAnchor(snapshot, payload.targetSeat || event.seat);
      uses[key] = {
        position: event.position
          ? { ...event.position }
          : anchor
            ? { x: anchor.x, y: anchor.y }
            : null,
        allianceId: event.allianceId || null,
        seat: event.seat || null,
        targetSeat: payload.targetSeat || null,
        skillId: payload.skillId || null,
        effectId: payload.effectId || null,
        strength: 1,
      };
    } else if (event?.type === "skill_effect_ended") {
      const baseKey = String(event.id || payload.effectId || "skill-ending");
      const priorActives = Object.values(skills.active || {}).filter((entry) => (
        String(entry?.effectId || "") === String(payload.effectId || "")
      ));
      const anchor = snapshotFleetAnchor(snapshot, event.seat);
      const targets = event.position
        ? [{ position: { ...event.position }, radius: priorActives[0]?.radius || null, targetSeat: null }]
        : priorActives.length > 0
          ? priorActives.map((entry) => ({
              position: entry.position ? { ...entry.position } : null,
              radius: entry.radius || null,
              targetSeat: entry.targetSeat || null,
            }))
          : [{
              position: anchor ? { x: anchor.x, y: anchor.y } : null,
              radius: null,
              targetSeat: event.seat || null,
            }];
      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        const key = targets.length > 1 ? `${baseKey}:${target.targetSeat || index}` : baseKey;
        endings[key] = {
          position: target.position,
          allianceId: event.allianceId || null,
          seat: event.seat || null,
          targetSeat: target.targetSeat,
          skillId: payload.skillId || null,
          effectId: payload.effectId || null,
          radius: target.radius,
          strength: 1,
        };
      }
    }
  }

  return { warnings, spawns, collections, uses, active, endings };
}

export function buildControlPointVisualState(point = {}) {
  const ownerAllianceId = point.ownerAllianceId || null;
  const capturingAllianceId = point.capturingAllianceId || null;
  const contested = Boolean(point.contested);
  const storedProgress = clamp01(point.captureProgress);
  const captureProgress = ownerAllianceId && capturingAllianceId && ownerAllianceId !== capturingAllianceId
    ? 1 - storedProgress
    : storedProgress;
  const status = contested
    ? "争夺中"
    : capturingAllianceId
      ? `${capturingAllianceId} 占领中 ${Math.round(captureProgress * 100)}%`
      : ownerAllianceId
        ? `${ownerAllianceId} 已占领`
        : "中立";

  return {
    ownerAllianceId,
    capturingAllianceId,
    contested,
    captureProgress,
    status,
    statusFontSize: 20,
  };
}

export function advanceTerritoryPresentationEffects(previous, {
  dt = 0,
  presentationState = null,
  snapshot = null,
  events = [],
  reset = false,
  isNavigationFeedbackVisible,
} = {}) {
  if (reset) previous = null;
  const delta = Math.max(0, Number(dt) || 0);
  const time = Math.max(0, Number(previous?.time) || 0) + delta;
  const eventBatch = freshEvents(previous, events);
  const currentEvents = eventBatch.fresh;
  const controls = {};
  const ownerEvents = new Map(
    currentEvents
      .filter((event) => event?.type === "control_point_owner_changed" && event?.payload?.controlPointId)
      .map((event) => [event.payload.controlPointId, event]),
  );
  const contestedEvents = new Map(
    currentEvents
      .filter((event) => event?.type === "control_point_contested" && event?.payload?.controlPointId)
      .map((event) => [event.payload.controlPointId, event]),
  );

  for (const point of presentationState?.map?.controlPoints || []) {
    const prior = previous?.controls?.[point.id] || null;
    const count = occupantCount(point);
    const ownerEvent = ownerEvents.get(point.id);
    const contestedEvent = contestedEvents.get(point.id);
    const entryStrength = count > 0 && (!prior || prior.occupantCount <= 0)
      ? 1
      : Math.max(0, Number(prior?.entryStrength || 0) - delta / 0.55);
    const captureImpact = ownerEvent?.payload?.ownerAllianceId
      ? 1
      : Math.max(0, Number(prior?.captureImpact || 0) - delta / 0.9);
    const lostOwner = ownerEvent?.payload?.previousOwnerAllianceId && !ownerEvent?.payload?.ownerAllianceId
      ? ownerEvent.payload.previousOwnerAllianceId
      : null;
    const lossFade = lostOwner
      ? 1
      : Math.max(0, Number(prior?.lossFade || 0) - delta / 1.1);
    const contestImpact = contestedEvent
      ? 1
      : Math.max(0, Number(prior?.contestImpact || 0) - delta / 0.8);

    controls[point.id] = {
      occupantCount: count,
      entryStrength,
      captureImpact,
      lossFade,
      contestImpact,
      previousOwnerAllianceId: lostOwner || (lossFade > 0 ? prior?.previousOwnerAllianceId || null : null),
    };
  }

  const tickets = {};
  for (const allianceId of ["A", "B"]) {
    const prior = previous?.tickets?.[allianceId] || null;
    const impact = ticketImpactFromEvents(currentEvents, allianceId);
    const strength = impact
      ? 1
      : Math.max(0, Number(prior?.strength || 0) - delta / 1.15);
    tickets[allianceId] = {
      amount: impact?.amount ?? (strength > 0 ? Number(prior?.amount) || 0 : 0),
      reason: impact?.reason ?? (strength > 0 ? prior?.reason || null : null),
      strength,
    };
  }

  const terrain = {};
  const terrainEntryEvents = new Map(
    currentEvents
      .filter((event) => event?.type === "terrain_entered" && event?.payload?.terrainId)
      .map((event) => [event.payload.terrainId, event]),
  );
  for (const region of presentationState?.map?.terrainRegions || []) {
    const prior = previous?.terrain?.[region.id] || null;
    const entry = terrainEntryEvents.get(region.id);
    const disturbanceStrength = entry
      ? 1
      : Math.max(0, Number(prior?.disturbanceStrength || 0) - delta / 1.4);
    terrain[region.id] = {
      disturbanceStrength,
      disturbancePosition: entry?.position
        ? { ...entry.position }
        : disturbanceStrength > 0
          ? prior?.disturbancePosition || null
          : null,
    };
  }

  const respawns = advanceRespawnEffects(previous, presentationState, currentEvents, delta);
  const protections = advanceProtectionEffects(previous, snapshot, delta);
  const resources = advanceResourceEffects(previous, presentationState, snapshot, currentEvents, delta);
  const skills = advanceSkillEffects(previous, presentationState, snapshot, currentEvents, delta);
  const navigationFeedback = advanceNavigationFeedback(
    previous,
    currentEvents,
    delta,
    time,
    isNavigationFeedbackVisible,
  );
  return {
    time,
    controls,
    tickets,
    terrain,
    respawns,
    protections,
    resources,
    skills,
    navigationFeedback,
    seenEventIds: eventBatch.seenEventIds,
  };
}
