import { clamp } from "./math.js";

const YUKI_SCOUT_MODE_CONFIG = Object.freeze({
  intercept: Object.freeze({ desiredActive: 5, maxActive: 7, cadence: [2.6, 3.05], patrolRadius: 78, commitment: 5.5 }),
  concentrate: Object.freeze({ desiredActive: 5, maxActive: 7, cadence: [2.65, 3.15], patrolRadius: 92, commitment: 6.5 }),
  harass: Object.freeze({ desiredActive: 4, maxActive: 6, cadence: [2.8, 3.45], patrolRadius: 126, commitment: 5 }),
  screen: Object.freeze({ desiredActive: 4, maxActive: 6, cadence: [3.05, 3.8], patrolRadius: 150, commitment: 4.5 }),
});

export function createScoutDoctrineState() {
  return {
    mode: "screen",
    primaryZoneId: null,
    committedUntil: 0,
    screenCursor: 0,
    deployments: 0,
    nextRetaskAt: 0,
    lastPlan: null,
  };
}

function zoneById(zones, zoneId) {
  return zones.find((zone) => zone.id === Number(zoneId)) || zones[4] || zones[0];
}

function zoneForPoint(zones, x, y) {
  return zones.find((zone) => (
    x >= zone.x
    && x <= zone.x + zone.width
    && y >= zone.y
    && y <= zone.y + zone.height
  )) || zones[4] || zones[0];
}

function zoneCenter(zone) {
  return {
    x: zone.x + zone.width * 0.5,
    y: zone.y + zone.height * 0.5,
  };
}

function zoneGridDistance(a, b) {
  if (!a || !b) return Infinity;
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

function activeScoutCounts(activeScouts) {
  const counts = new Map();
  for (const scout of activeScouts) {
    const zoneId = Number(scout.zoneId || scout.zone?.id);
    if (!Number.isFinite(zoneId)) continue;
    counts.set(zoneId, (counts.get(zoneId) || 0) + 1);
  }
  return counts;
}

function normalizeBeliefWeights(beliefZoneWeights, zones) {
  const source = beliefZoneWeights instanceof Map
    ? beliefZoneWeights
    : new Map(Object.entries(beliefZoneWeights || {}).map(([key, value]) => [Number(key), Number(value) || 0]));
  let max = 0;
  for (const zone of zones) max = Math.max(max, Number(source.get(zone.id)) || 0);
  return new Map(zones.map((zone) => [zone.id, max > 0 ? (Number(source.get(zone.id)) || 0) / max : 0]));
}

function projectedFocusPoint(focus, worldSize) {
  if (!focus || !Number.isFinite(focus.x) || !Number.isFinite(focus.y)) {
    return null;
  }
  const confidence = clamp(Number(focus.confidence) || 0.2, 0.12, 1);
  const leadSeconds = focus.visible ? 1.65 : focus.source === "radar" ? 2.15 : 2.75;
  const speed = clamp(Number(focus.speed) || 0, 0, 52);
  const travel = speed * leadSeconds * (0.48 + confidence * 0.52);
  const padding = clamp(worldSize * 0.055, 54, 92);
  return {
    x: clamp(focus.x + Math.cos(Number(focus.angle) || 0) * travel, padding, worldSize - padding),
    y: clamp(focus.y + Math.sin(Number(focus.angle) || 0) * travel, padding, worldSize - padding),
  };
}

function clampPointToZone(point, zone, margin = 22) {
  return {
    x: clamp(point.x, zone.x + margin, zone.x + zone.width - margin),
    y: clamp(point.y, zone.y + margin, zone.y + zone.height - margin),
  };
}

function neighborZoneIds(zones, zoneId) {
  const origin = zoneById(zones, zoneId);
  return zones
    .filter((zone) => zoneGridDistance(origin, zone) === 1)
    .map((zone) => zone.id);
}

function contactZoneScores(contacts, zones, now) {
  const scores = new Map(zones.map((zone) => [zone.id, 0]));
  for (const contact of contacts) {
    if (!contact || contact.kind !== "ship" || !Number.isFinite(contact.x) || !Number.isFinite(contact.y)) continue;
    const zone = zoneForPoint(zones, contact.x, contact.y);
    const age = Math.max(0, Number(contact.age) || now - (Number(contact.seenAt) || now));
    const freshness = clamp(1 - age / 12, 0.12, 1);
    const sourceWeight = contact.visible ? 1.8 : contact.source === "radar" ? 1.25 : 0.82;
    const confidence = clamp(Number(contact.confidence) || (contact.visible ? 1 : 0.32), 0.14, 1);
    scores.set(zone.id, (scores.get(zone.id) || 0) + sourceWeight * confidence * freshness);
  }
  return scores;
}

function rankCandidateZones({
  candidates,
  zones,
  activeCounts,
  beliefWeights,
  contactScores,
  focusZoneId,
  preferredZoneId,
  cursor = 0,
  activePenalty = 1.4,
}) {
  const unique = [...new Set(candidates.filter((zoneId) => Number.isFinite(Number(zoneId))).map(Number))];
  return unique
    .map((zoneId, index) => {
      const zone = zoneById(zones, zoneId);
      const focusZone = zoneById(zones, focusZoneId);
      const score = (beliefWeights.get(zoneId) || 0) * 1.35
        + (contactScores.get(zoneId) || 0) * 1.15
        + (zoneId === preferredZoneId ? 1.05 : 0)
        + (zoneId === focusZoneId ? 0.46 : 0)
        + (focusZone && zone.row === focusZone.row ? 0.18 : 0)
        - (activeCounts.get(zoneId) || 0) * activePenalty
        - ((index - cursor + unique.length) % Math.max(1, unique.length)) * 0.025;
      return { zoneId, score };
    })
    .sort((a, b) => b.score - a.score || a.zoneId - b.zoneId);
}

function selectMode(focus, context) {
  const closeThreat = Boolean(
    context?.maxShipThreat > 1.02
    || (context?.defensivePressure && context?.dist < (context?.rangeRef || 500) * 1.25),
  );
  if (closeThreat && focus && focus.source !== "spawn") return "intercept";
  if (focus?.visible || (context?.intelSolid && (focus?.confidence ?? 1) >= 0.38)) return "concentrate";
  if (context?.trackableIntel || focus?.source === "radar" || (focus?.source !== "spawn" && focus?.age <= 9)) return "harass";
  return "screen";
}

export function scoutMissionPoint(plan, zones, zoneId = plan.zoneId, index = 0) {
  const zone = zoneById(zones, zoneId);
  let base = zoneCenter(zone);
  if (zoneId === plan.primaryZoneId && plan.focusPoint) {
    base = clampPointToZone(plan.focusPoint, zone, 28);
  } else if (plan.mode === "screen") {
    base.x += plan.forwardSign * zone.width * 0.16;
  }
  const radius = plan.mode === "concentrate" || plan.mode === "intercept" ? 48 : plan.mode === "harass" ? 72 : 96;
  const angle = (plan.deploymentIndex + index) * 2.399963 + zoneId * 0.61;
  return clampPointToZone({
    x: base.x + Math.cos(angle) * radius,
    y: base.y + Math.sin(angle) * radius,
  }, zone, 24);
}

export function planYukiScoutDeployment({
  state,
  zones,
  worldSize,
  ownMain,
  forwardSign,
  focus,
  contacts = [],
  beliefZoneWeights = new Map(),
  activeScouts = [],
  context = {},
  now = 0,
  probeZoneId = null,
}) {
  const mode = selectMode(focus, context);
  const config = YUKI_SCOUT_MODE_CONFIG[mode];
  const activeCounts = activeScoutCounts(activeScouts);
  const beliefWeights = normalizeBeliefWeights(beliefZoneWeights, zones);
  const contactScores = contactZoneScores(contacts, zones, now);
  const ownZone = zoneForPoint(zones, ownMain.x, ownMain.y);
  const focusZone = focus ? zoneForPoint(zones, focus.x, focus.y) : null;
  const projectedPoint = projectedFocusPoint(focus, worldSize);
  const projectedZone = projectedPoint ? zoneForPoint(zones, projectedPoint.x, projectedPoint.y) : null;
  const predictedZoneId = Number(probeZoneId) || projectedZone?.id || focusZone?.id || null;
  const forwardCol = clamp(ownZone.col + forwardSign, 0, 2);
  const frontlineZoneIds = zones.filter((zone) => zone.col === forwardCol).map((zone) => zone.id);

  let candidatePrimary = predictedZoneId || focusZone?.id || frontlineZoneIds[1] || 5;
  if (mode === "intercept" || (mode === "concentrate" && context?.combatUrgency > 0.72)) {
    candidatePrimary = focusZone?.id || candidatePrimary;
  }
  const previousPrimary = zoneById(zones, state.primaryZoneId);
  const candidatePrimaryZone = zoneById(zones, candidatePrimary);
  const retainCommitment = state.mode === mode
    && state.primaryZoneId
    && state.committedUntil > now
    && zoneGridDistance(previousPrimary, candidatePrimaryZone) <= 1
    && !(focus?.visible && zoneGridDistance(previousPrimary, focusZone) > 1);
  const primaryZoneId = retainCommitment ? state.primaryZoneId : candidatePrimary;
  const adjacent = neighborZoneIds(zones, primaryZoneId);
  let coverageZoneIds = [primaryZoneId, ...adjacent];
  let zoneId = primaryZoneId;

  if (mode === "screen") {
    const beliefLeader = [...beliefWeights.entries()].sort((a, b) => b[1] - a[1])[0];
    const candidates = [...frontlineZoneIds];
    const ranked = rankCandidateZones({
      candidates,
      zones,
      activeCounts,
      beliefWeights,
      contactScores,
      focusZoneId: focusZone?.id,
      preferredZoneId: beliefLeader?.[0],
      cursor: state.screenCursor,
      activePenalty: 2.15,
    });
    coverageZoneIds = ranked.map((item) => item.zoneId);
    zoneId = coverageZoneIds[0] || primaryZoneId;
  } else if (mode === "harass") {
    const candidates = [predictedZoneId, focusZone?.id, ...adjacent, ...frontlineZoneIds];
    const ranked = rankCandidateZones({
      candidates,
      zones,
      activeCounts,
      beliefWeights,
      contactScores,
      focusZoneId: focusZone?.id,
      preferredZoneId: predictedZoneId,
      cursor: state.screenCursor,
      activePenalty: 1.55,
    });
    coverageZoneIds = ranked.map((item) => item.zoneId);
    zoneId = coverageZoneIds[0] || primaryZoneId;
  } else {
    const primaryCount = activeCounts.get(primaryZoneId) || 0;
    const rankedSupport = rankCandidateZones({
      candidates: [predictedZoneId, ...adjacent],
      zones,
      activeCounts,
      beliefWeights,
      contactScores,
      focusZoneId: focusZone?.id,
      preferredZoneId: predictedZoneId,
      activePenalty: 0.72,
    }).map((item) => item.zoneId).filter((id) => id !== primaryZoneId);
    coverageZoneIds = [primaryZoneId, ...rankedSupport];
    const sendSupport = primaryCount >= 3 && state.deployments % 4 === 3;
    zoneId = sendSupport ? rankedSupport[0] || primaryZoneId : primaryZoneId;
  }

  const plan = {
    mode,
    mission: mode === "screen" ? "frontline-screen" : mode === "harass" ? "forward-harass" : "battlefield",
    zoneId,
    primaryZoneId,
    predictedZoneId,
    frontlineZoneIds,
    coverageZoneIds,
    focusPoint: projectedPoint || (focus ? { x: focus.x, y: focus.y } : null),
    forwardSign,
    desiredActive: config.desiredActive,
    maxActive: config.maxActive,
    cadenceMin: config.cadence[0],
    cadenceMax: config.cadence[1],
    patrolRadius: config.patrolRadius,
    commitment: config.commitment,
    deploymentIndex: state.deployments,
  };
  plan.seekPoint = scoutMissionPoint(plan, zones, zoneId);
  return plan;
}

export function recordScoutDeployment(state, plan, now) {
  const primaryChanged = state.primaryZoneId !== plan.primaryZoneId || state.mode !== plan.mode;
  state.mode = plan.mode;
  state.primaryZoneId = plan.primaryZoneId;
  if (primaryChanged || state.committedUntil <= now) {
    state.committedUntil = now + plan.commitment;
  }
  state.screenCursor = (state.screenCursor + 1) % Math.max(1, plan.coverageZoneIds.length);
  state.deployments += 1;
  state.lastPlan = {
    mode: plan.mode,
    mission: plan.mission,
    zoneId: plan.zoneId,
    primaryZoneId: plan.primaryZoneId,
    predictedZoneId: plan.predictedZoneId,
    coverageZoneIds: [...plan.coverageZoneIds],
    at: now,
  };
}

export function buildScoutRetaskOrders(plan, activeScouts, maxOrders = 2) {
  const desired = new Map();
  if (plan.mode === "concentrate" || plan.mode === "intercept") {
    desired.set(plan.primaryZoneId, 3);
    const supportZone = plan.coverageZoneIds.find((zoneId) => zoneId !== plan.primaryZoneId);
    if (supportZone) desired.set(supportZone, 1);
  } else if (plan.mode === "harass") {
    for (const [index, zoneId] of plan.coverageZoneIds.slice(0, 3).entries()) {
      desired.set(zoneId, index === 0 ? 2 : 1);
    }
  } else {
    for (const zoneId of plan.coverageZoneIds.slice(0, 3)) desired.set(zoneId, 1);
  }

  const eligible = activeScouts.filter((scout) => scout.life > 6);
  const counts = activeScoutCounts(eligible);
  const deficits = [];
  for (const [zoneId, targetCount] of desired) {
    for (let count = counts.get(zoneId) || 0; count < targetCount; count += 1) deficits.push(zoneId);
  }

  const orders = [];
  const used = new Set();
  for (const targetZoneId of deficits) {
    const source = eligible
      .filter((scout) => !used.has(scout.id) && Number(scout.zoneId || scout.zone?.id) !== targetZoneId)
      .sort((a, b) => {
        const aZone = Number(a.zoneId || a.zone?.id);
        const bZone = Number(b.zoneId || b.zone?.id);
        const aSurplus = (counts.get(aZone) || 0) - (desired.get(aZone) || 0);
        const bSurplus = (counts.get(bZone) || 0) - (desired.get(bZone) || 0);
        return bSurplus - aSurplus || b.life - a.life;
      })[0];
    if (!source) break;
    const sourceZoneId = Number(source.zoneId || source.zone?.id);
    const sourceSurplus = (counts.get(sourceZoneId) || 0) - (desired.get(sourceZoneId) || 0);
    if (sourceSurplus <= 0 && plan.mode === "screen") continue;
    used.add(source.id);
    counts.set(sourceZoneId, Math.max(0, (counts.get(sourceZoneId) || 0) - 1));
    counts.set(targetZoneId, (counts.get(targetZoneId) || 0) + 1);
    orders.push({ scoutId: source.id, zoneId: targetZoneId, mission: plan.mission });
    if (orders.length >= maxOrders) break;
  }
  return orders;
}
