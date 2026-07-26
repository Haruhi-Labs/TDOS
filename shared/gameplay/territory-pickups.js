import { clamp } from "../game-core.js";
import { createSeededRng } from "./seeded-rng.js";

export const RESOURCE_PICKUP_TYPES = Object.freeze([
  "repair",
  "energy",
  "fleet_supply",
  "respawn_accelerator",
]);

const RESOURCE_LIFETIME_SECONDS = 30;
const RESOURCE_WARNING_SECONDS = 6;
const COMMON_RESOURCE_INTERVAL = Object.freeze({ min: 22, max: 32 });
const RARE_RESOURCE_INTERVAL = Object.freeze({ min: 60, max: 90 });
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

function nextInterval(rng, rarity) {
  const range = rarity === "rare" ? RARE_RESOURCE_INTERVAL : COMMON_RESOURCE_INTERVAL;
  return rng.nextInt(range.min, range.max);
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

function ensureResourceRuntime(modeState) {
  if (!modeState.resourceRuntime) {
    modeState.resourceRuntime = createTerritoryResourceRuntime({ seed: modeState.seed || 0 });
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

function activeNodeIds(modeState) {
  return new Set((modeState.pickups || []).map((pickup) => pickup.nodeId));
}

function chooseNode(modeState, runtime, rarity, simulation) {
  const nodes = (modeState.map?.resourceSpawnNodes || []).filter((node) => node.rarity === rarity);
  if (!nodes.length) return null;
  const occupied = activeNodeIds(modeState);
  const rng = createSeededRng(runtime.seed).fork(`resource-node:${runtime.nodeSequence || 0}:${rarity}`);
  runtime.nodeSequence = (runtime.nodeSequence || 0) + 1;
  const candidates = rng
    .shuffle(nodes)
    .filter((node) => !occupied.has(node.id))
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
      ...extra,
    },
  };
}

export function createTerritoryResourceRuntime({ seed = 0 } = {}) {
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
    nextCommonAt: nextInterval(commonRng, "common"),
    nextRareAt: nextInterval(rareRng, "rare"),
    warned: {
      common: false,
      rare: false,
    },
  };
}

export function spawnTerritoryResource({ modeState, rarity = "common", simulation = null, resourceType = null } = {}) {
  const next = cloneJson(modeState);
  const runtime = ensureResourceRuntime(next);
  const node = chooseNode(next, runtime, rarity, simulation);
  if (!node) {
    return { modeState: next, pickups: [], events: [] };
  }
  const type = RESOURCE_PICKUP_TYPES.includes(resourceType) ? resourceType : drawResourceType(runtime);
  runtime.spawnSequence += 1;
  const pickup = {
    id: `resource-${runtime.spawnSequence}`,
    resourceType: type,
    rarity,
    nodeId: node.id,
    position: { ...node.center },
    radius: PICKUP_RADIUS,
    spawnedAt: Number(next.elapsed) || 0,
    expiresAt: (Number(next.elapsed) || 0) + RESOURCE_LIFETIME_SECONDS,
  };
  next.pickups = [...(next.pickups || []), pickup];
  return {
    modeState: next,
    pickups: [pickup],
    events: [makeEvent("resource_spawned", pickup)],
  };
}

function scheduleNext(runtime, now, rarity) {
  const rng = createSeededRng(runtime.seed).fork(`${rarity}-interval:${runtime.spawnSequence}:${now}`);
  const key = rarity === "rare" ? "nextRareAt" : "nextCommonAt";
  runtime[key] = now + nextInterval(rng, rarity);
  runtime.warned[rarity] = false;
}

export function updateTerritoryResourceLifecycle({
  modeState,
  dt,
  simulation = null,
  parameters = {},
} = {}) {
  const next = cloneJson(modeState);
  next.elapsed = Number(next.elapsed || 0) + Math.max(0, Number(dt) || 0);
  const runtime = ensureResourceRuntime(next);
  const events = [];
  const now = Number(next.elapsed) || 0;

  const surviving = [];
  for (const pickup of next.pickups || []) {
    if (now >= Number(pickup.expiresAt)) {
      events.push(makeEvent("resource_expired", pickup));
    } else {
      surviving.push(pickup);
    }
  }
  next.pickups = surviving;

  for (const rarity of ["common", "rare"]) {
    const key = rarity === "rare" ? "nextRareAt" : "nextCommonAt";
    if (!runtime.warned[rarity] && now + RESOURCE_WARNING_SECONDS >= runtime[key]) {
      const preview = { rarity, position: null, resourceType: null, id: null, nodeId: null };
      events.push(makeEvent("resource_warning", preview, { spawnAt: runtime[key] }));
      runtime.warned[rarity] = true;
    }
    if (now + 1e-9 >= runtime[key]) {
      const result = spawnTerritoryResource({ modeState: next, rarity, simulation });
      next.pickups = result.modeState.pickups;
      next.resourceRuntime = result.modeState.resourceRuntime;
      events.push(...result.events);
      scheduleNext(next.resourceRuntime, now, rarity);
    }
  }

  if (parameters?.resourceSpawnInterval) {
    next.spawnTimers = {
      ...(next.spawnTimers || {}),
      nextResourceAt: Math.min(runtime.nextCommonAt, runtime.nextRareAt),
    };
  }

  return { modeState: next, events };
}

function applyHull(ship, ratio) {
  if (!ship?.alive) return;
  ship.hp = Math.min(ship.maxHp, ship.hp + ship.maxHp * ratio);
}

function applyEnergy(ship, ratio) {
  if (!ship?.alive) return;
  ship.energy = Math.min(ship.maxEnergy, ship.energy + ship.maxEnergy * ratio);
}

export function applyTerritoryResourcePickup({
  pickup,
  simulation,
  seat,
  shipKey,
  modeState,
} = {}) {
  if (!pickup || !RESOURCE_PICKUP_TYPES.includes(pickup.resourceType)) {
    return { accepted: false, modeState, events: [] };
  }
  const fleet = simulation?.fleetBySeat?.(seat);
  const ship = fleet?.shipByKey?.(shipKey);
  if (!fleet || !ship || !ship.alive || ship.isAuxiliary) {
    return { accepted: false, modeState, events: [] };
  }

  const next = cloneJson(modeState);
  if (pickup.resourceType === "repair") {
    applyHull(ship, 0.18);
  } else if (pickup.resourceType === "energy") {
    applyEnergy(ship, 0.35);
  } else if (pickup.resourceType === "fleet_supply") {
    for (const member of Object.values(fleet.ships || {})) {
      applyHull(member, 0.08);
      applyEnergy(member, 0.15);
    }
  } else if (pickup.resourceType === "respawn_accelerator") {
    const allianceId = allianceIdForSeat(seat);
    next.respawnQueue = (next.respawnQueue || []).map((item) => {
      if (allianceIdForSeat(item.seat) !== allianceId) return item;
      return { ...item, remaining: Math.max(2, Number(item.remaining || 0) - 4) };
    });
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
          shipKey,
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

export function collectTerritoryPickups({ modeState, simulation } = {}) {
  let next = cloneJson(modeState);
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
