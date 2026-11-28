import { DEFAULT_WORLD_SIZE } from "../foundation/constants.js";
import {
  assertSupportedAiSeatsForTopology,
  normalizeAiSeats,
} from "../model/model-support.js";
import {
  defaultLegacySpawns,
  normalizeMatchTopology,
  validateMultiFleetSpawns,
} from "./match-topology.js";
import { createTeamRelations } from "../rules/team-relations.js";
import {
  LEGACY_STATE_SCHEMA,
  MULTI_FLEET_STATE_SCHEMA,
  OUTCOME_SHAPES,
  evaluateSideEliminationOutcome,
} from "../rules/side-outcome.js";
import { freezePlainData } from "../../data/plain-data.js";

// 旧模式存活资格：沿用原有舰船胜负口径，排除航空单位与伴随舰。
function isLegacyFleetAlive(team) {
  return Boolean(team.hasLivingShips());
}

// 多舰队新模式“所有舰机”存活资格：主副舰、额外舰（含当前归属本舰队的伴随舰）、侦察机、僚机任一存活即存活；
// 弹体、光束与表现效果不计入；自然到期、回收或母舰死亡退场后实体 alive 为 false 即失去资格。
export function hasLivingFleetUnits(team) {
  if (team.getAllShips().some((ship) => ship.alive)) return true;
  if (team.scouts.some((scout) => scout.alive)) return true;
  if (team.wingmen.some((wingman) => wingman.alive)) return true;
  return false;
}

// 这是战斗规则配置，不是房间生命周期或客户端页面模式。
// 新胜负条件在这里选择纯求值器，不能取得终局字段的写权限。
const standard = Object.freeze({
  initialize() {},
  evaluateOutcome({ aAlive, bAlive }) {
    return aAlive && bAlive ? null : { winnerSeat: aAlive ? "A" : bAlive ? "B" : null };
  },
});

const tutorial = Object.freeze({
  evaluateOutcome: standard.evaluateOutcome,
  initialize({ worldSize, setTrainingDamageFloor, configureTrainingFleet, setCombatEnabled, setAiEnabled }) {
    setTrainingDamageFloor("A", 0.25);
    setCombatEnabled("A", false);
    setCombatEnabled("B", false);
    setAiEnabled("B", false);

    const trainingStats = {
      hp: 400,
      energy: 80,
      speed: 20,
      turnRate: 0.4,
      accel: 0.8,
      energyRegen: 4,
      moveDrain: 3,
      vision: 50,
      range: 100,
      damage: 5,
      fireRate: 0.08,
    };
    const positions = {
      main: { x: worldSize * 0.67, y: worldSize * 0.28 },
      sub1: { x: worldSize * 0.69, y: worldSize * 0.3 },
      sub2: { x: worldSize * 0.69, y: worldSize * 0.26 },
    };
    configureTrainingFleet("B", trainingStats, positions);
  },
});

const teamElimination = Object.freeze({
  initialize() {},
  evaluateOutcome: evaluateSideEliminationOutcome,
});

const ffaElimination = Object.freeze({
  initialize() {},
  evaluateOutcome: evaluateSideEliminationOutcome,
});

const modes = Object.freeze({
  standard,
  tutorial,
  team_elimination: teamElimination,
  ffa_elimination: ffaElimination,
});

const modeContracts = Object.freeze({
  standard: Object.freeze({
    outcomeShape: OUTCOME_SHAPES.LEGACY_SEAT,
    stateSchema: LEGACY_STATE_SCHEMA,
    isFleetAlive: isLegacyFleetAlive,
    supportedFormats: Object.freeze(["duel"]),
    supportsAi: true,
  }),
  tutorial: Object.freeze({
    outcomeShape: OUTCOME_SHAPES.LEGACY_SEAT,
    stateSchema: LEGACY_STATE_SCHEMA,
    isFleetAlive: isLegacyFleetAlive,
    supportedFormats: Object.freeze(["tutorial"]),
    supportsAi: true,
  }),
  team_elimination: Object.freeze({
    outcomeShape: OUTCOME_SHAPES.SIDE_RESULT,
    stateSchema: MULTI_FLEET_STATE_SCHEMA,
    isFleetAlive: hasLivingFleetUnits,
    supportedFormats: Object.freeze(["2v2", "3v3"]),
    supportsAi: false,
  }),
  ffa_elimination: Object.freeze({
    outcomeShape: OUTCOME_SHAPES.SIDE_RESULT,
    stateSchema: MULTI_FLEET_STATE_SCHEMA,
    isFleetAlive: hasLivingFleetUnits,
    supportedFormats: Object.freeze(["ffa"]),
    supportsAi: false,
  }),
});

export const BATTLE_MODE_CAPABILITIES = freezePlainData({
  standard: {
    outcomeShape: OUTCOME_SHAPES.LEGACY_SEAT,
    stateSchema: LEGACY_STATE_SCHEMA,
    supportedFormats: ["duel"],
    minFleets: 2,
    maxFleets: 2,
    supportsAi: true,
  },
  tutorial: {
    outcomeShape: OUTCOME_SHAPES.LEGACY_SEAT,
    stateSchema: LEGACY_STATE_SCHEMA,
    supportedFormats: ["tutorial"],
    minFleets: 2,
    maxFleets: 2,
    supportsAi: true,
  },
  team_elimination: {
    outcomeShape: OUTCOME_SHAPES.SIDE_RESULT,
    stateSchema: MULTI_FLEET_STATE_SCHEMA,
    supportedFormats: ["2v2", "3v3"],
    minFleets: 4,
    maxFleets: 6,
    supportsAi: false,
  },
  ffa_elimination: {
    outcomeShape: OUTCOME_SHAPES.SIDE_RESULT,
    stateSchema: MULTI_FLEET_STATE_SCHEMA,
    supportedFormats: ["ffa"],
    minFleets: 3,
    maxFleets: 6,
    supportsAi: false,
  },
});

function groupSeatsBySide(topology) {
  const sideGroups = new Map();
  for (const fleet of topology.fleets) {
    if (!sideGroups.has(fleet.sideId)) {
      sideGroups.set(fleet.sideId, []);
    }
    sideGroups.get(fleet.sideId).push(fleet.seat);
  }
  return sideGroups;
}

function resolveWorldSizeValue(options) {
  return typeof options.worldSize === "number" && Number.isFinite(options.worldSize) && options.worldSize > 0
    ? options.worldSize
    : DEFAULT_WORLD_SIZE;
}

function validateAndResolveFormat(battleMode, options, topology, relations, hasExplicitFleets) {
  const worldSize = resolveWorldSizeValue(options);
  const requestedFormatId = options.formatId;

  if (battleMode === "standard" || battleMode === "tutorial") {
    const defaultFormatId = battleMode === "tutorial" ? "tutorial" : "duel";
    if (requestedFormatId !== undefined && requestedFormatId !== defaultFormatId) {
      throw new Error(`战斗模式 ${battleMode} 不支持玩法格式 ${String(requestedFormatId)}`);
    }
    const isSupportedLegacyAb = topology.seatOrder.length === 2
      && topology.seatOrder[0] === "A"
      && topology.seatOrder[1] === "B"
      && relations.areEnemies("A", "B");
    if (!isSupportedLegacyAb) {
      throw new Error(`战斗模式 ${battleMode} 当前仅支持 A/B 双舰队对立拓扑`);
    }
    if (hasExplicitFleets) {
      const [fleetA, fleetB] = topology.fleets;
      const legacySpawns = defaultLegacySpawns(worldSize);
      const matchesSpawn = (actual, expected) =>
        actual.x === expected.x && actual.y === expected.y && actual.facing === expected.facing;
      if (!matchesSpawn(fleetA.spawn, legacySpawns.A) || !matchesSpawn(fleetB.spawn, legacySpawns.B)) {
        throw new Error(`战斗模式 ${battleMode} 当前暂不支持自定义出生坐标`);
      }
    }
    return defaultFormatId;
  }

  if (!hasExplicitFleets) {
    throw new Error(`战斗模式 ${battleMode} 必须显式提供多舰队 fleets 拓扑配置`);
  }

  const sideGroups = groupSeatsBySide(topology);

  if (battleMode === "team_elimination") {
    if (sideGroups.size !== 2) {
      throw new Error(`组队歼灭模式必须恰好包含两个阵营，当前为 ${sideGroups.size} 个阵营`);
    }
    const sizes = [...sideGroups.values()].map((seats) => seats.length);
    const validTeamSize = sizes[0] === sizes[1] && (sizes[0] === 2 || sizes[0] === 3);
    if (!validTeamSize) {
      throw new Error(`组队歼灭模式仅支持 2v2 或 3v3 对称阵营，当前各阵营人数为 ${sizes.join("v")}`);
    }
    const derivedFormatId = sizes[0] === 2 ? "2v2" : "3v3";
    if (requestedFormatId !== undefined && requestedFormatId !== derivedFormatId) {
      throw new Error(`组队歼灭模式配置与声明格式冲突：拓扑为 ${derivedFormatId}，但传入 formatId=${String(requestedFormatId)}`);
    }
    validateMultiFleetSpawns(topology.fleets, worldSize);
    return derivedFormatId;
  }

  if (battleMode === "ffa_elimination") {
    const count = topology.fleets.length;
    if (count < 3 || count > 6) {
      throw new Error(`混战歼灭模式仅支持 3 至 6 支舰队，当前为 ${count} 支`);
    }
    if (sideGroups.size !== count) {
      throw new Error("混战歼灭模式要求每支舰队隶属独立阵营，禁止共享 sideId");
    }
    if (requestedFormatId !== undefined && requestedFormatId !== "ffa") {
      throw new Error(`混战歼灭模式仅支持 formatId=ffa，收到：${String(requestedFormatId)}`);
    }
    validateMultiFleetSpawns(topology.fleets, worldSize);
    return "ffa";
  }

  throw new Error(`未知战斗模式：${battleMode}`);
}

// 保留现有 options 协议；AI 席位、战斗规则、房间类型是不同维度。
export function resolveBattleMode(options = {}) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("战斗模式配置必须是普通对象");
  }
  const mode = options.mode || "pvp";
  const battleMode = options.battleMode ?? (options.tutorialMode ? "tutorial" : "standard");
  if (!Object.hasOwn(modes, battleMode)) throw new Error(`未知战斗模式：${battleMode}`);

  const topology = normalizeMatchTopology(options);
  const relations = createTeamRelations(topology);
  const hasExplicitFleets = Object.hasOwn(options, "fleets") && options.fleets !== undefined;
  const aiSeats = normalizeAiSeats(mode, options.aiSeats, topology.seatOrder, {
    legacyNormalize: !hasExplicitFleets,
  });
  assertSupportedAiSeatsForTopology(topology, aiSeats);

  const formatId = validateAndResolveFormat(battleMode, options, topology, relations, hasExplicitFleets);
  const contract = modeContracts[battleMode];

  const teamNames = Object.fromEntries(topology.fleets.map((fleet) => [fleet.seat, fleet.name]));
  const teamLoadouts = Object.fromEntries(topology.fleets.map((fleet) => [fleet.seat, { ...fleet.loadout }]));

  return {
    mode,
    battleMode,
    formatId,
    aiSeats,
    tutorialMode: battleMode === "tutorial",
    rules: modes[battleMode],
    outcomeShape: contract.outcomeShape,
    stateSchema: contract.stateSchema,
    isFleetAlive: contract.isFleetAlive,
    topology,
    teamNames,
    teamLoadouts,
  };
}
