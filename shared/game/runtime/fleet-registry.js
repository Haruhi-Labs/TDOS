// 私有舰队注册表与注册席位调度原语：集中实体查表、归属验证、敌对配对、开关板与固定帧序编排。
// 注册表仅在共享运行时装配层内部持有真实 Team，网络和表现层仍消费只读投影。
import { createTeamRelations } from "../rules/team-relations.js";
import { applyMatchAction } from "./action-dispatcher.js";

const EMPTY_TEAMS = Object.freeze([]);

export const BATTLE_UPDATE_PHASES = Object.freeze([
  "beforeAi",
  "ai",
  "teamUpdate",
  "afterTeams",
  "hullCollisions",
  "afterHull",
  "scoutClashes",
  "beforeVisibility",
  "visibility",
  "beforeBeams",
  "chargedBeams",
  "combat",
  "projectiles",
  "visualEffects",
  "afterVisuals",
  "checkVictory",
]);

function normalizeSeatOrderList(seatOrder) {
  if (!Array.isArray(seatOrder) || seatOrder.length === 0) {
    throw new TypeError("已注册席位列表必须是非空数组");
  }
  const seen = new Set();
  const ordered = [];
  for (const seat of seatOrder) {
    if (typeof seat !== "string" || seat.length === 0) {
      throw new TypeError("已注册席位必须是非空字符串");
    }
    if (seen.has(seat)) {
      throw new Error(`已注册席位列表存在重复席位：${seat}`);
    }
    seen.add(seat);
    ordered.push(seat);
  }
  return ordered;
}

export function createFleetRegistry(topology, teams) {
  const relations = createTeamRelations(topology);
  if (!Array.isArray(teams)) {
    throw new TypeError("注册舰队列表必须是数组");
  }

  // 使用私有 Map 存储席位到舰队实例的映射，避免对象原型键穿透。
  const teamsBySeat = new Map();
  for (let index = 0; index < teams.length; index += 1) {
    const team = teams[index];
    if (!team || typeof team !== "object") {
      throw new TypeError(`注册舰队列表第 ${index} 项必须是对象`);
    }
    const { seat, sideId } = team;
    if (typeof seat !== "string" || !relations.hasSeat(seat)) {
      throw new Error(`舰队席位 ${String(seat)} 未在拓扑中注册`);
    }
    if (teamsBySeat.has(seat)) {
      throw new Error(`舰队注册表存在重复席位：${seat}`);
    }
    const expectedSide = relations.sideOfSeat(seat);
    if (sideId !== expectedSide) {
      throw new Error(`席位 ${seat} 的阵营 sideId（${String(sideId)}）与拓扑声明（${expectedSide}）不一致`);
    }
    teamsBySeat.set(seat, team);
  }

  for (const seat of relations.seatOrder) {
    if (!teamsBySeat.has(seat)) {
      throw new Error(`舰队注册表缺少拓扑声明的席位：${seat}`);
    }
  }

  const orderedTeams = Object.freeze(relations.seatOrder.map((seat) => teamsBySeat.get(seat)));
  const alliedTeamsBySeat = new Map();
  const enemyTeamsBySeat = new Map();
  for (const seat of relations.seatOrder) {
    alliedTeamsBySeat.set(
      seat,
      Object.freeze(relations.alliedSeatsOf(seat).map((allySeat) => teamsBySeat.get(allySeat))),
    );
    enemyTeamsBySeat.set(
      seat,
      Object.freeze(relations.enemySeatsOf(seat).map((enemySeat) => teamsBySeat.get(enemySeat))),
    );
  }

  const orderedPairs = [];
  for (const leftSeat of relations.seatOrder) {
    const leftTeam = teamsBySeat.get(leftSeat);
    for (const rightSeat of relations.enemySeatsOf(leftSeat)) {
      orderedPairs.push(Object.freeze([leftTeam, teamsBySeat.get(rightSeat)]));
    }
  }
  const frozenHostilePairs = Object.freeze(orderedPairs);

  const unorderedPairs = [];
  for (let i = 0; i < relations.seatOrder.length; i += 1) {
    const leftSeat = relations.seatOrder[i];
    const leftTeam = teamsBySeat.get(leftSeat);
    for (let j = i + 1; j < relations.seatOrder.length; j += 1) {
      const rightSeat = relations.seatOrder[j];
      if (relations.areEnemies(leftSeat, rightSeat)) {
        unorderedPairs.push(Object.freeze([leftTeam, teamsBySeat.get(rightSeat)]));
      }
    }
  }
  const frozenHostileUnorderedPairs = Object.freeze(unorderedPairs);

  function hasSeat(seat) {
    return typeof seat === "string" && teamsBySeat.has(seat);
  }

  function teamBySeat(seat) {
    return typeof seat === "string" && teamsBySeat.has(seat) ? teamsBySeat.get(seat) : null;
  }

  function allTeams() {
    return orderedTeams;
  }

  function alliedTeamsOf(seat) {
    if (typeof seat !== "string") return EMPTY_TEAMS;
    return alliedTeamsBySeat.get(seat) || EMPTY_TEAMS;
  }

  function enemyTeamsOf(seat) {
    if (typeof seat !== "string") return EMPTY_TEAMS;
    return enemyTeamsBySeat.get(seat) || EMPTY_TEAMS;
  }

  function hostilePairs() {
    return frozenHostilePairs;
  }

  function hostileUnorderedPairs() {
    return frozenHostileUnorderedPairs;
  }

  // 双舰队兼容入口：仅限精确双舰队且唯一敌对拓扑；未知席位或多敌方必须明确拒绝。
  function enemyTeamBySeat(seat) {
    if (!hasSeat(seat)) {
      throw new Error(`未知席位 ${String(seat)}，无法查询敌对舰队`);
    }
    const enemies = enemyTeamsBySeat.get(seat);
    if (orderedTeams.length !== 2 || enemies.length !== 1) {
      throw new Error(
        `双舰队兼容接口 enemyTeamBySeat 不适用于当前拓扑（席位 ${seat}，总舰队数 ${orderedTeams.length}，敌对舰队数 ${enemies.length}）`,
      );
    }
    return enemies[0];
  }

  return Object.freeze({
    seatOrder: relations.seatOrder,
    relations,
    hasSeat,
    teamBySeat,
    allTeams,
    alliedTeamsOf,
    enemyTeamsOf,
    hostilePairs,
    hostileUnorderedPairs,
    enemyTeamBySeat,
  });
}

// 按注册席位生成不可变开关板：历史快照冻结隔离，未注册席位静默无副作用，执行前即时读取。
export function createSeatSwitchBoard(seatOrder, defaultValue = true) {
  const orderedSeats = normalizeSeatOrderList(seatOrder);
  const initialValue = Boolean(defaultValue);
  const values = new Map(orderedSeats.map((seat) => [seat, initialValue]));

  function buildSnapshot() {
    const record = {};
    for (const seat of orderedSeats) {
      record[seat] = values.get(seat);
    }
    return Object.freeze(record);
  }

  let currentSnapshot = buildSnapshot();

  return Object.freeze({
    get snapshot() {
      return currentSnapshot;
    },
    isEnabled(seat) {
      return typeof seat === "string" && values.has(seat) ? values.get(seat) : false;
    },
    set(seat, enabled) {
      if (typeof seat !== "string" || !values.has(seat)) return false;
      const next = Boolean(enabled);
      if (values.get(seat) === next) return false;
      values.set(seat, next);
      currentSnapshot = buildSnapshot();
      return true;
    },
  });
}

// 按注册席位派生 AI 随机流（ai:${seat}）；fork 仅按标签混合种子、不消费父流。
export function createSeatAiRngMap(rootRng, seatOrder) {
  if (!rootRng || typeof rootRng.fork !== "function") {
    throw new TypeError("根随机源必须提供 fork 方法");
  }
  const orderedSeats = normalizeSeatOrderList(seatOrder);
  const record = {};
  for (const seat of orderedSeats) {
    record[seat] = rootRng.fork(`ai:${seat}`);
  }
  return Object.freeze(record);
}

// 动作路由：先通过注册表查到唯一合法 Team，再委托给既有动作分发器；未知席位拒绝且无副作用。
export function dispatchSeatAction(registry, seat, action, applyAction = applyMatchAction) {
  const team = registry.teamBySeat(seat);
  if (!team) return false;
  return Boolean(applyAction(team, action));
}

// 固定帧阶段编排：每阶段先按注册顺序遍历全部舰队，再进入下一阶段；开关在每席执行前即时读取。
export function runBattleUpdatePhases(port, dt) {
  const teams = port.allTeams();
  port.beforeAi?.(dt);

  for (const team of teams) {
    if (port.isAiEnabled(team.seat)) {
      port.runAi(team.seat, dt);
    }
  }

  for (const team of teams) {
    port.updateTeam(team, dt);
  }
  port.afterTeams?.(dt);

  port.resolveShipCollisions?.();
  port.afterHull?.(dt);

  port.resolveScoutClashes?.();
  port.beforeVisibility?.(dt);

  for (const team of teams) {
    port.computeVisibility(team);
  }
  port.beforeBeams?.(dt);

  for (const team of teams) {
    port.resolveChargedBeams(team);
  }

  for (const team of teams) {
    if (port.isCombatEnabled(team.seat)) {
      port.stepCombat(team);
    }
  }

  port.updateProjectiles?.(dt);
  port.updateVisualEffects?.(dt);
  port.afterVisuals?.(dt);
  port.checkVictory?.();
}
