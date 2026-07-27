import { clamp } from "../game-core.js";
import { createSeededRng } from "./seeded-rng.js";
import { positionClearOfObstacles } from "./territory-obstacles.js";

export const RESOURCE_PICKUP_TYPES = Object.freeze([
  "repair",
  "energy",
  "fleet_supply",
  "respawn_accelerator",
]);

const RESOURCE_WARNING_SECONDS = 6;
const RESOURCE_INTERVAL_JITTER = 0.15;
const DEFAULT_COMMON_RESOURCE_SPAWN_SECONDS = 52;
const DEFAULT_RARE_RESOURCE_SPAWN_SECONDS = 120;
const PICKUP_RADIUS = 28;

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

function resourceIntervalBase(parameters, rarity) {
  const key = rarity === "rare" ? "rareResourceSpawnSeconds" : "commonResourceSpawnSeconds";
  const fallback = rarity === "rare"
    ? DEFAULT_RARE_RESOURCE_SPAWN_SECONDS
    : DEFAULT_COMMON_RESOURCE_SPAWN_SECONDS;
  const configured = Number(parameters?.[key]);
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

function nextInterval(rng, rarity, parameters) {
  const base = resourceIntervalBase(parameters, rarity);
  return base * (1 - RESOURCE_INTERVAL_JITTER + rng.next() * RESOURCE_INTERVAL_JITTER * 2);
}

function pickupPositionBlockedByShip(node, simulation) {
  if (!simulation || !node?.center) return false;
  const seats = Array.isArray(simulation.fleetSeats) ? simulation.fleetSeats : ["A", "B"];
  for (const seat of seats) {
    const fleet = simulation.fleetBySeat?.(seat);
    for (const ship of fleet?.getAllShips?.() || []) {
      if (!ship?.alive) continue;
      if (distance(node.center, ship) <= (node.radius || PICKUP_RADIUS) + (ship.radius || 0) + 12) {
        return true;
      }
    }
  }
  return false;
}

function pickupPositionClear(modeState, position, radius = PICKUP_RADIUS) {
  const bounds = modeState?.map?.safeBounds;
  const safeRadius = Math.max(0, Number(radius) || 0);
  const insideBounds = !bounds || (
    Number.isFinite(position?.x)
    && Number.isFinite(position?.y)
    && position.x - safeRadius >= bounds.x
    && position.y - safeRadius >= bounds.y
    && position.x + safeRadius <= bounds.x + bounds.width
    && position.y + safeRadius <= bounds.y + bounds.height
  );
  return insideBounds && positionClearOfObstacles(position, safeRadius, modeState?.map?.obstacleRegions || []);
}

function ensureResourceRuntime(modeState, parameters = {}) {
  if (!modeState.resourceRuntime) {
    modeState.resourceRuntime = createTerritoryResourceRuntime({ seed: modeState.seed || 0, parameters });
  }
  if (!modeState.resourceRuntime.reservations) {
    modeState.resourceRuntime.reservations = { common: null, rare: null };
  }
  return modeState.resourceRuntime;
}

function makeBag(runtime) {
  const rng = createSeededRng(runtime.seed).fork(`resource-bag:${runtime.bagSequence || 0}`);
  runtime.bagSequence = (runtime.bagSequence || 0) + 1;
  return rng.shuffle(RESOURCE_PICKUP_TYPES);
}

function drawResourceType(runtime) {
  if (!Array.isArray(runtime.bag) || runtime.bag.length === 0) {
    runtime.bag = makeBag(runtime);
  }
  let type = runtime.bag.shift();
  const recent = runtime.recentTypes || [];
  if (recent.length >= 2 && recent[recent.length - 1] === type && recent[recent.length - 2] === type) {
    const replacementIndex = runtime.bag.findIndex((candidate) => candidate !== type);
    if (replacementIndex >= 0) {
      const replacement = runtime.bag.splice(replacementIndex, 1)[0];
      runtime.bag.push(type);
      type = replacement;
    } else {
      type = RESOURCE_PICKUP_TYPES.find((candidate) => candidate !== type) || type;
    }
  }
  runtime.recentTypes = [...recent.slice(-1), type];
  return type;
}

function activeNodeIds(modeState, runtime) {
  const occupied = new Set((modeState.pickups || []).map((pickup) => pickup.nodeId));
  for (const reservation of Object.values(runtime?.reservations || {})) {
    if (reservation?.nodeId) occupied.add(reservation.nodeId);
  }
  return occupied;
}

function chooseNode(modeState, runtime, rarity, simulation) {
  const nodes = (modeState.map?.resourceSpawnNodes || []).filter((node) => node.rarity === rarity);
  if (!nodes.length) return null;
  const occupied = activeNodeIds(modeState, runtime);
  const rng = createSeededRng(runtime.seed).fork(`resource-node:${runtime.nodeSequence || 0}:${rarity}`);
  runtime.nodeSequence = (runtime.nodeSequence || 0) + 1;
  const candidates = rng
    .shuffle(nodes)
    .filter((node) => !occupied.has(node.id))
    .filter((node) => pickupPositionClear(modeState, node.center, node.radius || PICKUP_RADIUS))
    .filter((node) => !pickupPositionBlockedByShip(node, simulation));
  return candidates[0] || null;
}

function makeEvent(type, pickup, extra = {}) {
  return {
    type,
    position: pickup?.position ? { ...pickup.position } : null,
    payload: {
      pickupId: pickup?.id || null,
      resourceType: pickup?.resourceType || null,
      rarity: pickup?.rarity || null,
      nodeId: pickup?.nodeId || null,
      laneId: pickup?.laneId || null,
      regionId: pickup?.regionId || null,
      ...extra,
    },
  };
}

export function createTerritoryResourceRuntime({ seed = 0, parameters = {} } = {}) {
  const baseRng = createSeededRng(seed).fork("resource");
  const commonRng = baseRng.fork("common-interval");
  const rareRng = baseRng.fork("rare-interval");
  return {
    seed: baseRng.seed,
    bag: makeBag({ seed: baseRng.seed, bagSequence: 0 }),
    bagSequence: 1,
    nodeSequence: 0,
    spawnSequence: 0,
    recentTypes: [],
    nextCommonAt: nextInterval(commonRng, "common", parameters),
    nextRareAt: nextInterval(rareRng, "rare", parameters),
    warned: {
      common: false,
      rare: false,
    },
    reservations: {
      common: null,
      rare: null,
    },
  };
}

export function spawnTerritoryResource({
  modeState,
  rarity = "common",
  simulation = null,
  resourceType = null,
  reservation = null,
  parameters = {},
} = {}) {
  const next = cloneJson(modeState);
  const runtime = ensureResourceRuntime(next, parameters);
  const reservedNodeId = reservation?.nodeId || null;
  const node = reservedNodeId
    ? (next.map?.resourceSpawnNodes || []).find((candidate) => candidate.id === reservedNodeId && candidate.rarity === rarity)
    : chooseNode(next, runtime, rarity, simulation);
  if (node && reservedNodeId && (next.pickups || []).some((pickup) => pickup.nodeId === reservedNodeId)) {
    return { modeState: next, pickups: [], events: [] };
  }
  if (!node) {
    return { modeState: next, pickups: [], events: [] };
  }
  const position = reservation?.position ? { ...reservation.position } : { ...node.center };
  if (!pickupPositionClear(next, position, PICKUP_RADIUS)) {
    return { modeState: next, pickups: [], events: [] };
  }
  const requestedType = reservation?.resourceType || resourceType;
  const type = RESOURCE_PICKUP_TYPES.includes(requestedType) ? requestedType : drawResourceType(runtime);
  runtime.spawnSequence += 1;
  const pickup = {
    id: `resource-${runtime.spawnSequence}`,
    resourceType: type,
    rarity,
    nodeId: node.id,
    laneId: node.laneId || null,
    regionId: node.regionId || null,
    position,
    radius: PICKUP_RADIUS,
    spawnedAt: Number.isFinite(Number(reservation?.spawnAt))
      ? Number(reservation.spawnAt)
      : Number(next.elapsed) || 0,
  };
  next.pickups = [...(next.pickups || []), pickup];
  return {
    modeState: next,
    pickups: [pickup],
    events: [makeEvent("resource_spawned", pickup)],
  };
}

function createReservation(modeState, runtime, rarity, simulation, spawnAt) {
  const node = chooseNode(modeState, runtime, rarity, simulation);
  if (!node) return null;
  return {
    rarity,
    resourceType: drawResourceType(runtime),
    nodeId: node.id,
    laneId: node.laneId || null,
    regionId: node.regionId || null,
    position: { ...node.center },
    spawnAt,
  };
}

function scheduleNext(runtime, now, rarity, parameters) {
  const rng = createSeededRng(runtime.seed).fork(`${rarity}-interval:${runtime.spawnSequence}:${now}`);
  const key = rarity === "rare" ? "nextRareAt" : "nextCommonAt";
  runtime[key] = now + nextInterval(rng, rarity, parameters);
  runtime.warned[rarity] = false;
  runtime.reservations[rarity] = null;
}

export function updateTerritoryResourceLifecycle({
  modeState,
  dt,
  now = null,
  simulation = null,
  parameters = {},
  mutate = false,
} = {}) {
  const next = mutate ? modeState : cloneJson(modeState);
  let runtime = ensureResourceRuntime(next, parameters);
  const events = [];
  const currentTime = Number.isFinite(Number(now)) ? Number(now) : Number(next.elapsed) || 0;

  for (const rarity of ["common", "rare"]) {
    const key = rarity === "rare" ? "nextRareAt" : "nextCommonAt";
    if (!runtime.reservations[rarity] && currentTime + RESOURCE_WARNING_SECONDS >= runtime[key]) {
      const spawnAt = runtime[key] <= currentTime + 1e-9
        ? currentTime + RESOURCE_WARNING_SECONDS
        : runtime[key];
      const reservation = createReservation(next, runtime, rarity, simulation, spawnAt);
      if (reservation) {
        runtime[key] = reservation.spawnAt;
        runtime.reservations[rarity] = reservation;
        runtime.warned[rarity] = true;
        events.push(makeEvent("resource_warning", reservation, { spawnAt: reservation.spawnAt }));
      }
    }
    const reservation = runtime.reservations[rarity];
    if (reservation && currentTime + 1e-9 >= reservation.spawnAt) {
      const result = spawnTerritoryResource({ modeState: next, rarity, simulation, reservation, parameters });
      if (result.pickups.length > 0) {
        next.pickups = result.modeState.pickups;
        next.resourceRuntime = result.modeState.resourceRuntime;
        runtime = next.resourceRuntime;
        events.push(...result.events);
        scheduleNext(runtime, currentTime, rarity, parameters);
      } else scheduleNext(runtime, currentTime, rarity, parameters);
    }
  }

  next.spawnTimers = {
    ...(next.spawnTimers || {}),
    nextResourceAt: Math.min(runtime.nextCommonAt, runtime.nextRareAt),
  };

  return { modeState: next, events };
}

function applyHull(ship, ratio) {
  const capacity = Number(ship?.maxHp) || 0;
  if (!ship?.alive || capacity <= 0) return { amount: 0, capacity: 0 };
  const before = Number(ship.hp) || 0;
  ship.hp = Math.min(capacity, before + capacity * ratio);
  return { amount: Math.max(0, ship.hp - before), capacity };
}

function applyEnergy(ship, ratio) {
  const capacity = Number(ship?.maxEnergy) || 0;
  if (!ship?.alive || capacity <= 0) return { amount: 0, capacity: 0 };
  const before = Number(ship.energy) || 0;
  ship.energy = Math.min(capacity, before + capacity * ratio);
  return { amount: Math.max(0, ship.energy - before), capacity };
}

function appliedRatio(amount, capacity) {
  if (!(capacity > 0)) return 0;
  return Math.round((amount / capacity) * 1e6) / 1e6;
}

export function applyTerritoryResourcePickup({
  pickup,
  simulation,
  seat,
  shipKey,
  modeState,
  mutate = false,
} = {}) {
  if (!pickup || !RESOURCE_PICKUP_TYPES.includes(pickup.resourceType)) {
    return { accepted: false, modeState, events: [] };
  }
  const fleet = simulation?.fleetBySeat?.(seat);
  const ship = fleet?.shipByKey?.(shipKey);
  if (!fleet || !ship || !ship.alive || ship.isAuxiliary) {
    return { accepted: false, modeState, events: [] };
  }

  const next = mutate ? modeState : cloneJson(modeState);
  const feedback = {};
  if (pickup.resourceType === "repair") {
    const recovery = applyHull(ship, 0.18);
    feedback.hullRatio = appliedRatio(recovery.amount, recovery.capacity);
  } else if (pickup.resourceType === "energy") {
    const recovery = applyEnergy(ship, 0.35);
    feedback.energyRatio = appliedRatio(recovery.amount, recovery.capacity);
  } else if (pickup.resourceType === "fleet_supply") {
    let hullAmount = 0;
    let hullCapacity = 0;
    let energyAmount = 0;
    let energyCapacity = 0;
    for (const member of Object.values(fleet.ships || {})) {
      const hullRecovery = applyHull(member, 0.08);
      const energyRecovery = applyEnergy(member, 0.15);
      hullAmount += hullRecovery.amount;
      hullCapacity += hullRecovery.capacity;
      energyAmount += energyRecovery.amount;
      energyCapacity += energyRecovery.capacity;
    }
    feedback.hullRatio = appliedRatio(hullAmount, hullCapacity);
    feedback.energyRatio = appliedRatio(energyAmount, energyCapacity);
    feedback.fleetWide = true;
  } else if (pickup.resourceType === "respawn_accelerator") {
    const allianceId = allianceIdForSeat(seat);
    let respawnSeconds = 0;
    next.respawnQueue = (next.respawnQueue || []).map((item) => {
      if (allianceIdForSeat(item.seat) !== allianceId) return item;
      const before = Math.max(0, Number(item.remaining || 0));
      const remaining = before <= 2 ? before : Math.max(2, before - 4);
      respawnSeconds += Math.max(0, before - remaining);
      return { ...item, remaining };
    });
    feedback.respawnSeconds = respawnSeconds;
  }

  return {
    accepted: true,
    modeState: next,
    events: [
      {
        type: "resource_collected",
        position: pickup.position ? { ...pickup.position } : null,
        allianceId: allianceIdForSeat(seat),
        seat,
        payload: {
          pickupId: pickup.id,
          resourceType: pickup.resourceType,
          nodeId: pickup.nodeId || null,
          laneId: pickup.laneId || null,
          regionId: pickup.regionId || null,
          shipKey,
          ...feedback,
        },
      },
    ],
  };
}

function contactCandidates(pickup, simulation) {
  const out = [];
  if (!simulation || !pickup?.position) return out;
  for (const seat of simulation.fleetSeats || ["A", "B"]) {
    const fleet = simulation.fleetBySeat?.(seat);
    for (const ship of fleet?.getAllShips?.() || []) {
      if (!ship?.alive || ship.isAuxiliary) continue;
      const d = distance(pickup.position, ship);
      if (d <= (pickup.radius || PICKUP_RADIUS) + (ship.radius || 0)) {
        out.push({ seat, shipKey: ship.key || ship.slotKey, shipId: ship.id, distance: d });
      }
    }
  }
  return out.sort((a, b) => a.distance - b.distance || String(a.shipId).localeCompare(String(b.shipId)));
}

export function collectTerritoryPickups({ modeState, simulation, mutate = false } = {}) {
  let next = mutate ? modeState : cloneJson(modeState);
  const events = [];
  const remaining = [];
  for (const pickup of next.pickups || []) {
    const winner = contactCandidates(pickup, simulation)[0];
    if (!winner) {
      remaining.push(pickup);
      continue;
    }
    const result = applyTerritoryResourcePickup({
      pickup,
      simulation,
      seat: winner.seat,
      shipKey: winner.shipKey,
      modeState: next,
      mutate: true,
    });
    if (!result.accepted) {
      remaining.push(pickup);
      continue;
    }
    next = result.modeState;
    events.push(...result.events);
  }
  next.pickups = remaining;
  return { modeState: next, events };
}
