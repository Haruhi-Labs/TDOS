import { MODE_STATUS, createEmptyOutcome } from "./mode-definition.js";
import { generateTerritoryMap } from "../gameplay/territory-map.js";
import {
  collectTerritoryPickups,
  spawnTerritoryResource,
  updateTerritoryResourceLifecycle,
} from "../gameplay/territory-pickups.js";
import {
  updateTerritoryControl,
  updateTerritoryTickets,
} from "../gameplay/territory-control.js";
import { updateTerritoryTerrainModifiers } from "../gameplay/territory-terrain.js";
import {
  applyTerritorySkillEnvironmentModifiers,
  collectTerritorySkillPickups,
  spawnTerritorySkillPickup,
  updateTerritorySkillEffects,
  updateTerritorySkillLifecycle,
  useTerritoryTacticalSkill,
} from "../gameplay/territory-skills.js";
import {
  applyRespawnProtectionRules,
  queueTerritoryRespawns,
  updateTerritoryRespawns,
} from "../gameplay/territory-respawn.js";
import { chooseTerritoryAiAction } from "../gameplay/territory-ai.js";
import { getTerritoryInitialDeployments } from "../gameplay/territory-spawns.js";
import {
  firstObstacleHit,
  positionClearOfObstacles,
  resolveMovementAgainstObstacles,
} from "../gameplay/territory-obstacles.js";

export const STELLAR_TERRITORY_PARAMETER_SCHEMA = Object.freeze([
  {
    key: "initialTickets",
    label: "初始战争点数",
    type: "number",
    min: 30,
    max: 300,
    step: 10,
    default: 120,
  },
  {
    key: "captureSeconds",
    label: "基础占领时间",
    type: "number",
    min: 2,
    max: 15,
    step: 1,
    default: 6,
  },
  {
    key: "commonResourceSpawnSeconds",
    label: "普通资源生成间隔",
    type: "number",
    min: 30,
    max: 120,
    step: 1,
    default: 52,
  },
  {
    key: "rareResourceSpawnSeconds",
    label: "稀有资源生成间隔",
    type: "number",
    min: 60,
    max: 240,
    step: 5,
    default: 120,
  },
  {
    key: "skillSpawnInterval",
    label: "技能生成间隔",
    type: "number",
    min: 25,
    max: 120,
    step: 5,
    default: 75,
  },
  {
    key: "respawnEnabled",
    label: "启用复活",
    type: "boolean",
    default: true,
  },
  {
    key: "mapTemplate",
    label: "地图模板",
    type: "select",
    default: "three-lane-v2",
    options: [{ value: "three-lane-v2", label: "三路争夺 V2" }],
  },
]);

export const STELLAR_TERRITORY_DEFAULT_PARAMETERS = Object.freeze({
  initialTickets: 120,
  captureSeconds: 6,
  commonResourceSpawnSeconds: 52,
  rareResourceSpawnSeconds: 120,
  skillSpawnInterval: 75,
  respawnEnabled: true,
  mapTemplate: "three-lane-v2",
});

function normalizeSeed(randomSeed) {
  const seed = Number(randomSeed);
  return Number.isFinite(seed) ? seed : 0;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildAiDiagnostics(state) {
  const rows = {};
  const now = Number(state?.elapsed || 0);
  for (const allianceId of ["A", "B"]) {
    const assignments = state?.aiCoordinator?.[allianceId]?.assignments || {};
    for (const [seat, assignment] of Object.entries(assignments).sort(([left], [right]) => left.localeCompare(right))) {
      const score = Number(assignment?.score || 0).toFixed(1);
      const lockRemaining = Math.max(0, Number(assignment?.lockUntil || 0) - now).toFixed(1);
      rows[`AI任务 ${seat}`] = `${assignment?.objectiveType || "-"} · ${assignment?.targetId || "-"} · 分数 ${score} · 锁定 ${lockRemaining}秒`;
    }
  }
  return rows;
}

function allianceIdForSeat(seat) {
  return String(seat || "A").toUpperCase().startsWith("B") ? "B" : "A";
}

function createEmptyMap(parameters = {}) {
  return {
    templateId: parameters.mapTemplate || STELLAR_TERRITORY_DEFAULT_PARAMETERS.mapTemplate,
    spawnAreas: [],
    controlPoints: [],
    terrainRegions: [],
    resourceSpawnNodes: [],
    skillSpawnNodes: [],
  };
}

function teamSizeFromFleetLayout(fleetLayout) {
  const a = Array.isArray(fleetLayout?.alliances?.A) ? fleetLayout.alliances.A.length : 1;
  const b = Array.isArray(fleetLayout?.alliances?.B) ? fleetLayout.alliances.B.length : 1;
  return Math.max(1, a, b);
}

function applyInitialDeployments(simulation, deployments) {
  for (const [seat, ships] of Object.entries(deployments || {})) {
    const fleet = simulation?.fleetBySeat?.(seat);
    if (!fleet) continue;
    for (const [shipKey, deployment] of Object.entries(ships || {})) {
      const ship = fleet.shipByKey?.(shipKey);
      if (!ship || !deployment) continue;
      ship.x = deployment.x;
      ship.y = deployment.y;
      ship.angle = deployment.angle;
      ship.command = { x: deployment.x, y: deployment.y };
      ship.route = null;
      ship.speed = 0;
    }
  }
}

export const stellarTerritoryMode = {
  id: "stellar-territory",
  name: "星域争夺战",
  description: "资源、控制区、战术技能与复活驱动的星域争夺 Prototype 骨架。",
  status: MODE_STATUS.EXPERIMENTAL,
  version: 1,
  worldSize: 2160,
  supportedWorldSizes: Object.freeze([2160]),
  parameterSchema: STELLAR_TERRITORY_PARAMETER_SCHEMA,
  defaultParameters: STELLAR_TERRITORY_DEFAULT_PARAMETERS,

  createInitialModeState({ parameters = {}, randomSeed = null, fleetLayout = null, worldSize = null } = {}) {
    const initialTickets = Number(parameters.initialTickets) || STELLAR_TERRITORY_DEFAULT_PARAMETERS.initialTickets;
    const seed = normalizeSeed(randomSeed);
    return {
      version: 2,
      seed,
      phase: "opening",
      elapsed: 0,
      initialTickets,
      alliances: {
        A: {
          tickets: initialTickets,
          skillSlot: null,
        },
        B: {
          tickets: initialTickets,
          skillSlot: null,
        },
      },
      map: generateTerritoryMap({
        seed,
        templateId: parameters.mapTemplate || STELLAR_TERRITORY_DEFAULT_PARAMETERS.mapTemplate,
        worldSize,
        teamSize: teamSizeFromFleetLayout(fleetLayout),
      }),
      pickups: [],
      skillPickups: [],
      activeSkillEffects: [],
      respawnQueue: [],
      shipHistory: {},
      fleetWipeState: {},
      aiCoordinator: {
        A: { assignments: {} },
        B: { assignments: {} },
      },
      spawnTimers: {
        nextResourceAt: 0,
        nextSkillAt: 0,
      },
      ticketTimers: {
        A: 0,
        B: 0,
      },
      ticketDrainRates: {
        A: 0,
        B: 0,
      },
      terrainMemory: {},
      resourceRuntime: null,
      skillRuntime: null,
      skillEffectSequence: 0,
      eventSequence: 0,
      result: null,
    };
  },

  prepareSimulation({ simulation, modeState, fleetLayout }) {
    const obstacles = modeState?.map?.obstacleRegions || [];
    simulation?.setEnvironmentCollisionProvider?.({
      resolveMovement: ({ entity, previousPosition, nextPosition }) => resolveMovementAgainstObstacles({
        previousPosition,
        nextPosition,
        radius: Number(entity?.radius) || 0,
        obstacles,
      }),
      traceSegment: ({ start, end, radius = 0 }) => firstObstacleHit(start, end, obstacles, radius),
      canOccupy: ({ position, radius = 0 }) => positionClearOfObstacles(position, radius, obstacles),
    });
    const deployments = getTerritoryInitialDeployments({ modeState, simulation, fleetLayout });
    applyInitialDeployments(simulation, deployments);
    return { modeState };
  },

  beforeSimulationStep({ modeState, simulation }) {
    const terrain = updateTerritoryTerrainModifiers({ modeState, simulation, mutate: true });
    applyTerritorySkillEnvironmentModifiers({ modeState: terrain.modeState, simulation });
    return terrain;
  },

  updateModeState({ modeState, parameters, dt, simulation }) {
    let next = modeState ? cloneJson(modeState) : this.createInitialModeState({ parameters });
    const now = Number(next.elapsed || 0) + Math.max(0, Number(dt) || 0);
    next.elapsed = now;
    const control = updateTerritoryControl({
      modeState: next,
      simulation,
      dt,
      parameters,
      mutate: true,
    });
    next = control.modeState;
    const tickets = updateTerritoryTickets({ modeState: next, dt, mutate: true });
    next = tickets.modeState;
    const lifecycle = updateTerritoryResourceLifecycle({
      modeState: next,
      dt,
      now,
      simulation,
      parameters,
      mutate: true,
    });
    next = lifecycle.modeState;
    const collected = collectTerritoryPickups({ modeState: next, simulation, mutate: true });
    next = collected.modeState;
    const skillLifecycle = updateTerritorySkillLifecycle({
      modeState: next,
      dt,
      now,
      simulation,
      parameters,
      mutate: true,
    });
    next = skillLifecycle.modeState;
    const skillEffects = updateTerritorySkillEffects({
      modeState: next,
      simulation,
      dt,
      now,
      mutate: true,
    });
    next = skillEffects.modeState;
    const skillCollect = collectTerritorySkillPickups({ modeState: next, simulation, mutate: true });
    next = skillCollect.modeState;
    const queuedRespawns = parameters?.respawnEnabled === false
      ? { modeState: next, events: [] }
      : queueTerritoryRespawns({ modeState: next, simulation, mutate: true });
    next = queuedRespawns.modeState;
    const respawns = parameters?.respawnEnabled === false
      ? { modeState: next, events: [] }
      : updateTerritoryRespawns({ modeState: next, simulation, dt, mutate: true });
    next = respawns.modeState;
    if (next.phase === "opening" && next.elapsed > 0) {
      next.phase = "running";
    }
    return {
      ...next,
      events: [
        ...control.events,
        ...tickets.events,
        ...lifecycle.events,
        ...collected.events,
        ...skillLifecycle.events,
        ...skillEffects.events,
        ...skillCollect.events,
        ...queuedRespawns.events,
        ...respawns.events,
      ],
    };
  },

  handleAction({ action, seat, modeState, simulation }) {
    const type = action?.type;
    if (type === "use_tactical_skill") {
      const result = useTerritoryTacticalSkill({ modeState, simulation, seat, action });
      if (result.accepted) applyRespawnProtectionRules({ simulation, action, seat });
      return {
        handled: true,
        accepted: result.accepted,
        modeState: result.modeState,
        events: result.events,
      };
    }
    if (type === "cast_flagship_skill" || type === "cast_sub_skill") {
      const accepted = simulation?.applyActionForSeat?.(seat, action) === true;
      if (accepted) applyRespawnProtectionRules({ simulation, action, seat });
      return {
        handled: true,
        accepted,
        modeState,
        events: [],
      };
    }
    if (type === "debug_spawn_resource") {
      const result = spawnTerritoryResource({
        modeState,
        rarity: action.rarity === "rare" ? "rare" : "common",
        simulation,
        resourceType: action.resourceType,
      });
      return {
        handled: true,
        accepted: result.pickups.length > 0,
        modeState: result.modeState,
        events: result.events,
      };
    }
    if (type === "debug_clear_resources") {
      return {
        handled: true,
        accepted: true,
        modeState: { ...cloneJson(modeState), pickups: [] },
        events: [{ type: "resource_cleared", payload: {} }],
      };
    }
    if (type === "debug_spawn_skill") {
      const result = spawnTerritorySkillPickup({
        modeState,
        skillId: action.skillId,
        nodeId: action.nodeId,
      });
      return {
        handled: true,
        accepted: result.pickups.length > 0,
        modeState: result.modeState,
        events: result.events,
      };
    }
    return { handled: false };
  },

  buildAiAction({ seat, modeState, simulation, runtime }) {
    const allianceId = allianceIdForSeat(seat);
    const allianceLayout = runtime?.getFleetLayout?.()?.alliances?.[allianceId] || [];
    const allianceHasHuman = allianceLayout.some((entry) => entry?.control === "human");
    return chooseTerritoryAiAction({
      seat,
      modeState,
      simulation,
      allowTacticalSkills: !allianceHasHuman,
    });
  },

  resolveOutcome({ modeState }) {
    if (modeState?.result) return modeState.result;
    return createEmptyOutcome();
  },

  buildDiagnostics({ modeState, parameters }) {
    const state = modeState || this.createInitialModeState({ parameters });
    return {
      随机种子: state.seed,
      地图模板: state.map?.templateId || parameters?.mapTemplate || "-",
      A战争点数: Number(state.alliances?.A?.tickets) || 0,
      B战争点数: Number(state.alliances?.B?.tickets) || 0,
      控制区数量: state.map?.controlPoints?.length || 0,
      现有资源数量: state.pickups?.length || 0,
      现有技能数量: state.skillPickups?.length || 0,
      A技能槽: state.alliances?.A?.skillSlot?.skillId || "-",
      B技能槽: state.alliances?.B?.skillSlot?.skillId || "-",
      控制区归属: (state.map?.controlPoints || []).map((point) => `${point.id}:${point.ownerAllianceId || "-"}`).join(" "),
      占领进度: (state.map?.controlPoints || []).map((point) => `${point.id}:${Math.round((point.captureProgress || 0) * 100)}%`).join(" "),
      下一次资源生成: Number(state.spawnTimers?.nextResourceAt || 0).toFixed(1),
      下一次技能生成: Number(state.spawnTimers?.nextSkillAt || 0).toFixed(1),
      活动技能效果: state.activeSkillEffects?.length || 0,
      复活队列: state.respawnQueue?.length || 0,
      地形内舰船数量: Object.keys(state.terrainMemory || {}).length,
      模式阶段: state.phase || "-",
      ...buildAiDiagnostics(state),
    };
  },

  getPresentationState({ modeState, parameters }) {
    const state = modeState || this.createInitialModeState({ parameters });
    return {
      seed: state.seed,
      phase: state.phase,
      elapsed: state.elapsed,
      initialTickets: Number(state.initialTickets) || Number(parameters?.initialTickets) || STELLAR_TERRITORY_DEFAULT_PARAMETERS.initialTickets,
      alliances: cloneJson(state.alliances),
      ticketDrainRates: cloneJson(state.ticketDrainRates || { A: 0, B: 0 }),
      map: cloneJson(state.map),
      pickups: cloneJson(state.pickups),
      skillPickups: cloneJson(state.skillPickups),
      activeSkillEffects: cloneJson(state.activeSkillEffects),
      respawnQueue: cloneJson(state.respawnQueue),
      result: cloneJson(state.result),
    };
  },

  serializeModeState(modeState) {
    return cloneJson(modeState || this.createInitialModeState());
  },
};
