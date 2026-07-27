import { createSeededRng } from "./seeded-rng.js";
import { positionClearOfObstacles } from "./territory-obstacles.js";

export const FORBIDDEN_SCOUT_SKILL_TERMS = Object.freeze([
  "scan",
  "radar",
  "reveal",
  "vision",
  "track",
  "scout",
  "侦察",
  "扫描",
  "雷达",
  "视野",
]);

export const ALLOWED_TACTICAL_SKILLS = Object.freeze([
  Object.freeze({
    id: "all_fleet_shield",
    name: "全舰护盾",
    type: "active",
    targetType: "none",
    duration: 8,
    description: "己方所有存活基础舰船获得最大舰体12%的临时护盾。",
  }),
  Object.freeze({
    id: "propulsion_overload",
    name: "推进过载",
    type: "active",
    targetType: "none",
    duration: 8,
    description: "己方所有存活舰船航速和转向短时提升。",
  }),
  Object.freeze({
    id: "firepower_overload",
    name: "火力过载",
    type: "active",
    targetType: "none",
    duration: 7,
    description: "己方所有存活舰船伤害提高，能量消耗提高。",
  }),
  Object.freeze({
    id: "short_warp",
    name: "短程跃迁",
    type: "active",
    targetType: "point",
    duration: 0,
    maxDistance: 260,
    description: "选择己方一支存活编队整体跃迁到指定位置。",
  }),
  Object.freeze({
    id: "gravity_field",
    name: "引力场",
    type: "active",
    targetType: "point",
    duration: 9,
    radius: 170,
    description: "指定位置生成减速场，区域内双方移动受限。",
  }),
  Object.freeze({
    id: "repair_drones",
    name: "紧急维修无人机",
    type: "active",
    targetType: "fleet",
    duration: 8,
    description: "选择己方一支存活编队，在持续时间内恢复舰体。",
  }),
]);

const SKILL_WARNING_SECONDS = 8;
const SKILL_INTERVAL_JITTER = 0.2;
const DEFAULT_SKILL_SPAWN_INTERVAL = 75;
const MAX_SKILL_PICKUPS = 2;
const SKILL_PICKUP_RADIUS = 30;
const SKILL_MODIFIER_SOURCE = "territory-skills";

const SKILL_ENVIRONMENT_MODIFIERS = Object.freeze({
  propulsion_overload: Object.freeze({
    speedMultiplier: 1.22,
    accelerationMultiplier: 1.18,
    turnMultiplier: 1.16,
  }),
  firepower_overload: Object.freeze({
    damageMultiplier: 1.28,
    moveEnergyDrainMultiplier: 1.3,
  }),
  gravity_field: Object.freeze({
    speedMultiplier: 0.68,
    accelerationMultiplier: 0.72,
    turnMultiplier: 0.78,
  }),
});

const SKILL_BY_ID = new Map(ALLOWED_TACTICAL_SKILLS.map((skill) => [skill.id, skill]));

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

function inWorld(point, simulation) {
  const size = Number(simulation?.worldSize) || 1440;
  return Number(point?.x) >= 0 && Number(point?.y) >= 0 && point.x <= size && point.y <= size;
}

function nextSkillInterval(rng, parameters) {
  const configured = Number(parameters?.skillSpawnInterval);
  const base = Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_SKILL_SPAWN_INTERVAL;
  return base * (1 - SKILL_INTERVAL_JITTER + rng.next() * SKILL_INTERVAL_JITTER * 2);
}

function skillRuntime(modeState, parameters = {}) {
  if (!modeState.skillRuntime) {
    const seed = createSeededRng(modeState.seed || 0).fork("skill");
    modeState.skillRuntime = {
      seed: seed.seed,
      nextSkillAt: nextSkillInterval(seed, parameters),
      warned: false,
      reservation: null,
      spawnSequence: 0,
      nodeSequence: 0,
      bagSequence: 0,
      bag: [],
    };
  }
  if (!("reservation" in modeState.skillRuntime)) {
    modeState.skillRuntime.reservation = null;
  }
  return modeState.skillRuntime;
}

function makeSkillBag(runtime) {
  const rng = createSeededRng(runtime.seed).fork(`skill-bag:${runtime.bagSequence || 0}`);
  runtime.bagSequence = (runtime.bagSequence || 0) + 1;
  return rng.shuffle(ALLOWED_TACTICAL_SKILLS.map((skill) => skill.id));
}

function drawSkillId(runtime) {
  if (!runtime.bag?.length) runtime.bag = makeSkillBag(runtime);
  return runtime.bag.shift();
}

function occupiedSkillNodeIds(modeState, runtime, ignoreReservation = false) {
  const occupied = new Set((modeState.skillPickups || []).map((pickup) => pickup.nodeId));
  if (!ignoreReservation && runtime?.reservation?.nodeId) {
    occupied.add(runtime.reservation.nodeId);
  }
  return occupied;
}

function skillPositionClear(modeState, position, radius = SKILL_PICKUP_RADIUS) {
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

function chooseSkillNode(modeState, runtime, nodeId = null, ignoreReservation = false) {
  const nodes = modeState.map?.skillSpawnNodes || [];
  const occupied = occupiedSkillNodeIds(modeState, runtime, ignoreReservation);
  if (nodeId) {
    const node = occupied.has(nodeId) ? null : nodes.find((candidate) => candidate.id === nodeId) || null;
    return node && skillPositionClear(modeState, node.center, node.radius || SKILL_PICKUP_RADIUS) ? node : null;
  }
  if (!nodes.length) return null;
  const rng = createSeededRng(runtime.seed).fork(`skill-node:${runtime.nodeSequence || 0}`);
  runtime.nodeSequence = (runtime.nodeSequence || 0) + 1;
  return rng.shuffle(nodes).find((node) => (
    !occupied.has(node.id)
    && skillPositionClear(modeState, node.center, node.radius || SKILL_PICKUP_RADIUS)
  )) || null;
}

function skillEvent(type, pickup, extra = {}) {
  return {
    type,
    position: pickup?.position ? { ...pickup.position } : null,
    payload: {
      pickupId: pickup?.id || null,
      skillId: pickup?.skillId || null,
      nodeId: pickup?.nodeId || null,
      laneId: pickup?.laneId || null,
      regionId: pickup?.regionId || null,
      ...extra,
    },
  };
}

export function spawnTerritorySkillPickup({
  modeState,
  skillId = null,
  nodeId = null,
  reservation = null,
  parameters = {},
} = {}) {
  const next = cloneJson(modeState);
  const runtime = skillRuntime(next, parameters);
  const activeCount = (next.skillPickups || []).length;
  if (reservation ? activeCount >= MAX_SKILL_PICKUPS : activeCount + (runtime.reservation ? 1 : 0) >= MAX_SKILL_PICKUPS) {
    return { modeState: next, pickups: [], events: [] };
  }
  const reservedNodeId = reservation?.nodeId || null;
  const node = reservedNodeId
    ? chooseSkillNode(next, runtime, reservedNodeId, true)
    : chooseSkillNode(next, runtime, nodeId);
  if (!node) return { modeState: next, pickups: [], events: [] };
  const position = reservation?.position ? { ...reservation.position } : { ...node.center };
  if (!skillPositionClear(next, position, SKILL_PICKUP_RADIUS)) {
    return { modeState: next, pickups: [], events: [] };
  }
  const requestedSkillId = reservation?.skillId || skillId;
  const safeSkillId = SKILL_BY_ID.has(requestedSkillId) ? requestedSkillId : drawSkillId(runtime);
  runtime.spawnSequence += 1;
  const pickup = {
    id: `skill-${runtime.spawnSequence}`,
    skillId: safeSkillId,
    nodeId: node.id,
    laneId: node.laneId || null,
    regionId: node.regionId || null,
    position,
    radius: SKILL_PICKUP_RADIUS,
    spawnedAt: Number.isFinite(Number(reservation?.spawnAt))
      ? Number(reservation.spawnAt)
      : Number(next.elapsed) || 0,
  };
  next.skillPickups = [...(next.skillPickups || []), pickup];
  return { modeState: next, pickups: [pickup], events: [skillEvent("skill_spawned", pickup)] };
}

function createSkillReservation(modeState, runtime, spawnAt) {
  if ((modeState.skillPickups || []).length >= MAX_SKILL_PICKUPS) return null;
  const node = chooseSkillNode(modeState, runtime);
  if (!node) return null;
  return {
    skillId: drawSkillId(runtime),
    nodeId: node.id,
    laneId: node.laneId || null,
    regionId: node.regionId || null,
    position: { ...node.center },
    spawnAt,
  };
}

function scheduleNextSkill(runtime, now, parameters) {
  const rng = createSeededRng(runtime.seed).fork(`skill-interval:${runtime.spawnSequence}:${now}`);
  runtime.nextSkillAt = now + nextSkillInterval(rng, parameters);
  runtime.warned = false;
  runtime.reservation = null;
}

export function updateTerritorySkillLifecycle({
  modeState,
  dt,
  now = null,
  simulation = null,
  parameters = {},
  mutate = false,
} = {}) {
  const next = mutate ? modeState : cloneJson(modeState);
  let runtime = skillRuntime(next, parameters);
  const events = [];
  const currentTime = Number.isFinite(Number(now)) ? Number(now) : Number(next.elapsed) || 0;
  if (!runtime.reservation && currentTime + SKILL_WARNING_SECONDS >= runtime.nextSkillAt) {
    const spawnAt = runtime.nextSkillAt <= currentTime + 1e-9
      ? currentTime + SKILL_WARNING_SECONDS
      : runtime.nextSkillAt;
    const reservation = createSkillReservation(next, runtime, spawnAt);
    if (reservation) {
      runtime.nextSkillAt = reservation.spawnAt;
      runtime.reservation = reservation;
      runtime.warned = true;
      events.push(skillEvent("skill_warning", reservation, { spawnAt: reservation.spawnAt }));
    }
  }
  const reservation = runtime.reservation;
  if (reservation && currentTime + 1e-9 >= reservation.spawnAt) {
    const spawned = spawnTerritorySkillPickup({ modeState: next, reservation, parameters, simulation });
    if (spawned.pickups.length > 0) {
      next.skillPickups = spawned.modeState.skillPickups;
      next.skillRuntime = spawned.modeState.skillRuntime;
      runtime = next.skillRuntime;
      events.push(...spawned.events);
      scheduleNextSkill(runtime, currentTime, parameters);
    } else scheduleNextSkill(runtime, currentTime, parameters);
  }
  next.spawnTimers = {
    ...(next.spawnTimers || {}),
    nextSkillAt: runtime.nextSkillAt,
  };
  return { modeState: next, events };
}

function skillContactCandidates(pickup, simulation) {
  const out = [];
  for (const seat of simulation?.fleetSeats || ["A", "B"]) {
    const fleet = simulation?.fleetBySeat?.(seat);
    for (const ship of Object.values(fleet?.ships || {})) {
      if (!ship?.alive) continue;
      const d = distance(pickup.position, ship);
      if (d <= (pickup.radius || SKILL_PICKUP_RADIUS) + (ship.radius || 0)) {
        out.push({ seat, shipKey: ship.key, shipId: ship.id, distance: d });
      }
    }
  }
  return out.sort((a, b) => a.distance - b.distance || String(a.shipId).localeCompare(String(b.shipId)));
}

export function collectTerritorySkillPickups({ modeState, simulation, mutate = false } = {}) {
  const next = mutate ? modeState : cloneJson(modeState);
  const events = [];
  const remaining = [];
  for (const pickup of next.skillPickups || []) {
    const winner = skillContactCandidates(pickup, simulation)[0];
    if (!winner) {
      remaining.push(pickup);
      continue;
    }
    const allianceId = allianceIdForSeat(winner.seat);
    const previous = next.alliances?.[allianceId]?.skillSlot || null;
    next.alliances[allianceId].skillSlot = {
      skillId: pickup.skillId,
      acquiredAt: Number(next.elapsed) || 0,
      pickupId: pickup.id,
    };
    if (previous) {
      events.push(skillEvent("skill_replaced", pickup, { allianceId, previousSkillId: previous.skillId }));
    }
    events.push({
      ...skillEvent("skill_collected", pickup),
      allianceId,
      seat: winner.seat,
      payload: {
        pickupId: pickup.id,
        skillId: pickup.skillId,
        nodeId: pickup.nodeId,
        laneId: pickup.laneId || null,
        regionId: pickup.regionId || null,
        shipKey: winner.shipKey,
      },
    });
  }
  next.skillPickups = remaining;
  return { modeState: next, events };
}

function ownFleetForAction(simulation, seat, action) {
  const targetSeat = action.targetSeat || seat;
  if (allianceIdForSeat(targetSeat) !== allianceIdForSeat(seat)) return null;
  return simulation?.fleetBySeat?.(targetSeat) || null;
}

function livingBasicShips(fleet) {
  return Object.values(fleet?.ships || {}).filter((ship) => ship?.alive);
}

function livingFleetAnchor(fleet) {
  const main = fleet?.shipByKey?.("main");
  return main?.alive ? main : livingBasicShips(fleet)[0] || null;
}

function warpLandingWithinBounds(position, radius, modeState, simulation) {
  const bounds = modeState?.map?.safeBounds;
  if (bounds) {
    return position.x - radius >= bounds.x
      && position.y - radius >= bounds.y
      && position.x + radius <= bounds.x + bounds.width
      && position.y + radius <= bounds.y + bounds.height;
  }
  const size = Number(simulation?.worldSize) || 1440;
  return position.x - radius >= 0
    && position.y - radius >= 0
    && position.x + radius <= size
    && position.y + radius <= size;
}

function shortWarpLandingPlan(modeState, simulation, fleet, point) {
  const ships = livingBasicShips(fleet);
  const anchor = livingFleetAnchor(fleet);
  if (!anchor || ships.length === 0) return null;
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const landings = ships.map((ship) => ({
    ship,
    position: { x: ship.x + dx, y: ship.y + dy },
    radius: Math.max(0, Number(ship.radius) || 0),
  }));

  for (const landing of landings) {
    if (!warpLandingWithinBounds(landing.position, landing.radius, modeState, simulation)) return null;
    if (simulation?.canOccupyEnvironment?.(landing.position, landing.radius, {
      entity: landing.ship,
      kind: "short_warp",
    }) === false) return null;
  }
  for (let firstIndex = 0; firstIndex < landings.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < landings.length; secondIndex += 1) {
      const first = landings[firstIndex];
      const second = landings[secondIndex];
      const currentDistance = distance(first.ship, second.ship);
      const minimumDistance = Math.min(currentDistance, first.radius + second.radius);
      if (distance(first.position, second.position) + 1e-9 < minimumDistance) return null;
    }
  }

  const movingShips = new Set(ships);
  for (const seat of simulation?.fleetSeats || ["A", "B"]) {
    const otherFleet = simulation?.fleetBySeat?.(seat);
    for (const other of otherFleet?.getAllShips?.() || Object.values(otherFleet?.ships || {})) {
      if (!other?.alive || movingShips.has(other)) continue;
      const otherRadius = Math.max(0, Number(other.radius) || 0);
      if (landings.some((landing) => distance(landing.position, other) < landing.radius + otherRadius)) return null;
    }
  }

  return landings;
}

function validateTarget(skill, modeState, simulation, seat, action) {
  if (!skill) return { ok: false, reason: "missing_skill" };
  if (skill.targetType === "none") return { ok: true };
  if (skill.targetType === "point") {
    const point = { x: Number(action.targetX), y: Number(action.targetY) };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !inWorld(point, simulation)) {
      return { ok: false, reason: "invalid_point" };
    }
    if (skill.id === "short_warp") {
      const fleet = ownFleetForAction(simulation, seat, action);
      const main = livingFleetAnchor(fleet);
      if (!main) return { ok: false, reason: "target_fleet_dead" };
      if (distance(main, point) > (skill.maxDistance || 260)) return { ok: false, reason: "range" };
      const landingPlan = shortWarpLandingPlan(modeState, simulation, fleet, point);
      if (!landingPlan) return { ok: false, reason: "blocked" };
      return { ok: true, landingPlan };
    }
    return { ok: true };
  }
  if (skill.targetType === "fleet") {
    const fleet = ownFleetForAction(simulation, seat, action);
    if (!fleet || livingBasicShips(fleet).length === 0) return { ok: false, reason: "invalid_fleet" };
    return { ok: true };
  }
  return { ok: false, reason: "unsupported_target" };
}

function addEffect(next, skill, seat, action, payload = {}) {
  const now = Number(next.elapsed) || 0;
  if (!skill.duration) return null;
  const effect = {
    id: `skill-effect-${(next.skillEffectSequence || 0) + 1}`,
    skillId: skill.id,
    allianceId: allianceIdForSeat(seat),
    seat,
    targetSeat: action.targetSeat || null,
    position: Number.isFinite(Number(action.targetX)) ? { x: Number(action.targetX), y: Number(action.targetY) } : null,
    startedAt: now,
    duration: skill.duration,
    endsAt: now + skill.duration,
    payload,
  };
  next.skillEffectSequence = (next.skillEffectSequence || 0) + 1;
  next.activeSkillEffects = [...(next.activeSkillEffects || []), effect];
  return effect;
}

function applyImmediateSkillEffect(skill, next, simulation, seat, action, validation = {}) {
  const allianceId = allianceIdForSeat(seat);
  const alliedFleets = simulation?.fleetsForAlliance?.(allianceId) || [];
  if (skill.id === "all_fleet_shield") {
    for (const fleet of alliedFleets) {
      for (const ship of livingBasicShips(fleet)) {
        ship.territoryShield = Math.max(Number(ship.territoryShield || 0), ship.maxHp * 0.12);
      }
    }
    return addEffect(next, skill, seat, action);
  }
  if (skill.id === "gravity_field") {
    return addEffect(next, skill, seat, action, { radius: skill.radius || 170 });
  }
  if (skill.id === "propulsion_overload" || skill.id === "firepower_overload") {
    return addEffect(next, skill, seat, action);
  }
  if (skill.id === "repair_drones") {
    return addEffect(next, skill, seat, action, { healedRatio: 0 });
  }
  if (skill.id === "short_warp") {
    for (const landing of validation.landingPlan || []) {
      const { ship, position } = landing;
      ship.x = position.x;
      ship.y = position.y;
      ship.command.x = ship.x;
      ship.command.y = ship.y;
      ship.route = null;
    }
    return null;
  }
  return null;
}

export function useTerritoryTacticalSkill({ modeState, simulation, seat, action } = {}) {
  const allianceId = allianceIdForSeat(seat);
  const slot = modeState?.alliances?.[allianceId]?.skillSlot;
  const skill = SKILL_BY_ID.get(slot?.skillId);
  const validation = validateTarget(skill, modeState, simulation, seat, action || {});
  if (!slot || !skill || !validation.ok) {
    return { accepted: false, modeState, events: [], reason: validation.reason || "no_skill" };
  }
  const next = cloneJson(modeState);
  next.alliances[allianceId].skillSlot = null;
  const effect = applyImmediateSkillEffect(skill, next, simulation, seat, action || {}, validation);
  return {
    accepted: true,
    modeState: next,
    events: [
      {
        type: "skill_used",
        position: effect?.position || (Number.isFinite(Number(action?.targetX)) ? { x: Number(action.targetX), y: Number(action.targetY) } : null),
        allianceId,
        seat,
        payload: {
          skillId: skill.id,
          targetType: skill.targetType,
          targetSeat: action?.targetSeat || null,
          effectId: effect?.id || null,
        },
      },
    ],
  };
}

function updateRepairDrone(effect, simulation, dt) {
  const fleet = simulation?.fleetBySeat?.(effect.targetSeat);
  const ships = livingBasicShips(fleet);
  const ratio = 0.15 * (Math.max(0, Number(dt) || 0) / Math.max(0.1, effect.duration || 8));
  for (const ship of ships) {
    ship.hp = Math.min(ship.maxHp, ship.hp + ship.maxHp * ratio);
  }
}

function composeEnvironmentModifier(a, b) {
  return {
    speedMultiplier: (a.speedMultiplier || 1) * (b.speedMultiplier || 1),
    accelerationMultiplier: (a.accelerationMultiplier || 1) * (b.accelerationMultiplier || 1),
    turnMultiplier: (a.turnMultiplier || 1) * (b.turnMultiplier || 1),
    damageMultiplier: (a.damageMultiplier || 1) * (b.damageMultiplier || 1),
    moveEnergyDrainMultiplier: (a.moveEnergyDrainMultiplier || 1) * (b.moveEnergyDrainMultiplier || 1),
  };
}

function modifierAppliesToShip(effect, seat, ship) {
  if (!ship?.alive) return false;
  if (effect.skillId === "propulsion_overload" || effect.skillId === "firepower_overload") {
    return allianceIdForSeat(seat) === effect.allianceId;
  }
  if (effect.skillId === "gravity_field") {
    return effect.position && distance(effect.position, ship) <= Number(effect.payload?.radius || 170);
  }
  return false;
}

function clearExpiredShield(effect, simulation) {
  if (effect.skillId !== "all_fleet_shield") return;
  const fleets = simulation?.fleetsForAlliance?.(effect.allianceId) || [];
  for (const fleet of fleets) {
    for (const ship of livingBasicShips(fleet)) {
      ship.territoryShield = 0;
    }
  }
}

export function applyTerritorySkillEnvironmentModifiers({ modeState, simulation } = {}) {
  simulation?.clearEnvironmentModifiers?.(SKILL_MODIFIER_SOURCE);
  const effects = Array.isArray(modeState?.activeSkillEffects) ? modeState.activeSkillEffects : [];
  if (!effects.length || !simulation) return false;
  for (const seat of simulation.fleetSeats || ["A", "B"]) {
    const fleet = simulation.fleetBySeat?.(seat);
    for (const ship of fleet?.getAllShips?.() || []) {
      let modifier = null;
      for (const effect of effects) {
        const effectModifier = SKILL_ENVIRONMENT_MODIFIERS[effect.skillId];
        if (!effectModifier || !modifierAppliesToShip(effect, seat, ship)) continue;
        modifier = composeEnvironmentModifier(modifier || {}, effectModifier);
      }
      if (modifier) {
        simulation.setEnvironmentModifier?.(seat, ship.key, modifier, SKILL_MODIFIER_SOURCE);
      }
    }
  }
  return true;
}

export function updateTerritorySkillEffects({ modeState, simulation, dt, now = null, mutate = false } = {}) {
  const next = mutate ? modeState : cloneJson(modeState);
  const currentTime = Number.isFinite(Number(now)) ? Number(now) : Number(next.elapsed) || 0;
  const events = [];
  const remaining = [];
  const expired = [];
  for (const effect of next.activeSkillEffects || []) {
    if (effect.skillId === "repair_drones") {
      updateRepairDrone(effect, simulation, dt);
    }
    if (currentTime + 1e-9 >= Number(effect.endsAt)) {
      expired.push(effect);
      events.push({
        type: "skill_effect_ended",
        position: effect.position || null,
        allianceId: effect.allianceId || null,
        seat: effect.seat || null,
        payload: { effectId: effect.id, skillId: effect.skillId },
      });
    } else {
      remaining.push(effect);
    }
  }
  next.activeSkillEffects = remaining;
  for (const effect of expired) {
    const hasActiveAllianceShield = effect.skillId === "all_fleet_shield" && remaining.some((activeEffect) => (
      activeEffect.skillId === "all_fleet_shield" && activeEffect.allianceId === effect.allianceId
    ));
    if (!hasActiveAllianceShield) {
      clearExpiredShield(effect, simulation);
    }
  }
  applyTerritorySkillEnvironmentModifiers({ modeState: next, simulation });
  return { modeState: next, events };
}
