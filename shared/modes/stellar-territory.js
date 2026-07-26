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
    key: "controlPointCount",
    label: "控制区数量",
    type: "select",
    default: 3,
    options: [1, 3],
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
    key: "resourceSpawnInterval",
    label: "资源生成间隔",
    type: "number",
    min: 10,
    max: 60,
    step: 1,
    default: 26,
  },
  {
    key: "skillSpawnInterval",
    label: "技能生成间隔",
    type: "number",
    min: 25,
    max: 120,
    step: 5,
    default: 55,
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
    default: "three-lane-v1",
    options: [{ value: "three-lane-v1", label: "三路争夺" }],
  },
]);

export const STELLAR_TERRITORY_DEFAULT_PARAMETERS = Object.freeze({
  initialTickets: 120,
  controlPointCount: 3,
  captureSeconds: 6,
  resourceSpawnInterval: 26,
  skillSpawnInterval: 55,
  respawnEnabled: true,
  mapTemplate: "three-lane-v1",
});

function normalizeSeed(randomSeed) {
  const seed = Number(randomSeed);
  return Number.isFinite(seed) ? seed : 0;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
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

export const stellarTerritoryMode = {
  id: "stellar-territory",
  name: "星域争夺战",
  description: "资源、控制区、战术技能与复活驱动的星域争夺 Prototype 骨架。",
  status: MODE_STATUS.EXPERIMENTAL,
  version: 1,
  parameterSchema: STELLAR_TERRITORY_PARAMETER_SCHEMA,
  defaultParameters: STELLAR_TERRITORY_DEFAULT_PARAMETERS,

  createInitialModeState({ parameters = {}, randomSeed = null, fleetLayout = null } = {}) {
    const initialTickets = Number(parameters.initialTickets) || STELLAR_TERRITORY_DEFAULT_PARAMETERS.initialTickets;
    const seed = normalizeSeed(randomSeed);
    return {
      version: 1,
      seed,
      phase: "opening",
      elapsed: 0,
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
        teamSize: teamSizeFromFleetLayout(fleetLayout),
      }),
      pickups: [],
      skillPickups: [],
      activeSkillEffects: [],
      respawnQueue: [],
      shipHistory: {},
      spawnTimers: {
        nextResourceAt: 0,
        nextSkillAt: 0,
      },
      ticketTimers: {
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

  beforeSimulationStep({ modeState, simulation }) {
    const terrain = updateTerritoryTerrainModifiers({ modeState, simulation });
    applyTerritorySkillEnvironmentModifiers({ modeState: terrain.modeState, simulation });
    return terrain;
  },

  updateModeState({ modeState, parameters, dt, simulation }) {
    let next = modeState ? cloneJson(modeState) : this.createInitialModeState({ parameters });
    const control = updateTerritoryControl({
      modeState: next,
      simulation,
      dt,
      parameters,
    });
    next = control.modeState;
    const tickets = updateTerritoryTickets({ modeState: next, dt });
    next = tickets.modeState;
    const lifecycle = updateTerritoryResourceLifecycle({
      modeState: next,
      dt,
      simulation,
      parameters,
    });
    next = lifecycle.modeState;
    const collected = collectTerritoryPickups({ modeState: next, simulation });
    next = collected.modeState;
    const skillLifecycle = updateTerritorySkillLifecycle({
      modeState: next,
      dt,
      simulation,
      parameters,
    });
    next = skillLifecycle.modeState;
    const skillEffects = updateTerritorySkillEffects({
      modeState: next,
      simulation,
      dt,
    });
    next = skillEffects.modeState;
    const skillCollect = collectTerritorySkillPickups({ modeState: next, simulation });
    next = skillCollect.modeState;
    const queuedRespawns = parameters?.respawnEnabled === false
      ? { modeState: next, events: [] }
      : queueTerritoryRespawns({ modeState: next, simulation });
    next = queuedRespawns.modeState;
    const respawns = parameters?.respawnEnabled === false
      ? { modeState: next, events: [] }
      : updateTerritoryRespawns({ modeState: next, simulation, dt });
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
    applyRespawnProtectionRules({ simulation, action, seat });
    if (type === "use_tactical_skill") {
      const result = useTerritoryTacticalSkill({ modeState, simulation, seat, action });
      return {
        handled: true,
        accepted: result.accepted,
        modeState: result.modeState,
        events: result.events,
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

  buildAiAction({ seat, modeState, simulation }) {
    return chooseTerritoryAiAction({ seat, modeState, simulation });
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
    };
  },

  getPresentationState({ modeState, parameters }) {
    const state = modeState || this.createInitialModeState({ parameters });
    return {
      seed: state.seed,
      phase: state.phase,
      elapsed: state.elapsed,
      alliances: cloneJson(state.alliances),
      map: cloneJson(state.map),
      pickups: cloneJson(state.pickups),
      skillPickups: cloneJson(state.skillPickups),
      activeSkillEffects: cloneJson(state.activeSkillEffects),
      respawnQueue: cloneJson(state.respawnQueue),
    };
  },

  serializeModeState(modeState) {
    return cloneJson(modeState || this.createInitialModeState());
  },
};
