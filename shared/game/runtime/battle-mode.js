import { DEFAULT_WORLD_SIZE } from "../foundation/constants.js";
import {
  assertSupportedAiSeatsForTopology,
  normalizeAiSeats,
} from "../model/model-support.js";
import { defaultLegacySpawns, normalizeMatchTopology } from "./match-topology.js";
import { createTeamRelations } from "../rules/team-relations.js";

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

const modes = Object.freeze({ standard, tutorial });

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

  // 当前已注册的旧模式仅支持 A/B 双舰队对立拓扑；未支持的多席或非 A/B 拓扑在此明确拒绝，避免回退 B。
  const isSupportedLegacyAb = topology.seatOrder.length === 2
    && topology.seatOrder[0] === "A"
    && topology.seatOrder[1] === "B"
    && relations.areEnemies("A", "B");
  if (!isSupportedLegacyAb) {
    throw new Error(`战斗模式 ${battleMode} 当前仅支持 A/B 双舰队对立拓扑`);
  }

  const [fleetA, fleetB] = topology.fleets;
  if (hasExplicitFleets) {
    const worldSize = typeof options.worldSize === "number" && Number.isFinite(options.worldSize) && options.worldSize > 0
      ? options.worldSize
      : DEFAULT_WORLD_SIZE;
    const legacySpawns = defaultLegacySpawns(worldSize);
    const matchesSpawn = (actual, expected) =>
      actual.x === expected.x && actual.y === expected.y && actual.facing === expected.facing;
    if (!matchesSpawn(fleetA.spawn, legacySpawns.A) || !matchesSpawn(fleetB.spawn, legacySpawns.B)) {
      throw new Error(`战斗模式 ${battleMode} 当前暂不支持自定义出生坐标`);
    }
  }
  return {
    mode, battleMode, aiSeats, tutorialMode: battleMode === "tutorial",
    rules: modes[battleMode],
    topology,
    teamNames: {
      A: fleetA.name,
      B: fleetB.name,
    },
    teamLoadouts: {
      A: { ...fleetA.loadout },
      B: { ...fleetB.loadout },
    },
  };
}
