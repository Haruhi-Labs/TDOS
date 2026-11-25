// 纯阵营关系查询：仅消费已校验的普通拓扑数据，不持有实体、时钟、连接或统计状态。
export const TOPOLOGY_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

const EMPTY_SEATS = Object.freeze([]);

export function isValidTopologyId(value) {
  return typeof value === "string" && TOPOLOGY_ID_PATTERN.test(value);
}

export function createTeamRelations(topology) {
  if (!topology || typeof topology !== "object" || Array.isArray(topology)) {
    throw new TypeError("拓扑配置必须是普通对象");
  }
  if (!Array.isArray(topology.fleets) || topology.fleets.length === 0) {
    throw new Error("拓扑配置必须包含非空 fleets 数组");
  }

  // 使用私有 Map 存储席位到阵营的映射，避免对象原型键穿透。
  const sideBySeat = new Map();
  const seatOrderList = [];

  for (const fleet of topology.fleets) {
    if (!fleet || typeof fleet !== "object" || Array.isArray(fleet)) {
      throw new TypeError("舰队描述必须是普通对象");
    }
    const { seat, sideId } = fleet;
    if (!isValidTopologyId(seat)) {
      throw new Error(`非法席位标识：${String(seat)}`);
    }
    if (!isValidTopologyId(sideId)) {
      throw new Error(`席位 ${seat} 缺少或包含非法阵营标识：${String(sideId)}`);
    }
    if (sideBySeat.has(seat)) {
      throw new Error(`重复的席位标识：${seat}`);
    }
    sideBySeat.set(seat, sideId);
    seatOrderList.push(seat);
  }

  if (topology.seatOrder !== undefined) {
    if (
      !Array.isArray(topology.seatOrder)
      || topology.seatOrder.length !== seatOrderList.length
      || topology.seatOrder.some((seat, index) => seat !== seatOrderList[index])
    ) {
      throw new Error("拓扑配置中的 seatOrder 与 fleets 顺序不一致");
    }
  }

  const seatOrder = Object.freeze(seatOrderList);
  const alliedSeatsBySeat = new Map();
  const enemySeatsBySeat = new Map();

  for (const seat of seatOrder) {
    const ownSide = sideBySeat.get(seat);
    const allies = [];
    const enemies = [];
    for (const candidate of seatOrder) {
      if (candidate === seat) continue;
      if (sideBySeat.get(candidate) === ownSide) {
        allies.push(candidate);
      } else {
        enemies.push(candidate);
      }
    }
    alliedSeatsBySeat.set(seat, Object.freeze(allies));
    enemySeatsBySeat.set(seat, Object.freeze(enemies));
  }

  function hasSeat(seat) {
    return typeof seat === "string" && sideBySeat.has(seat);
  }

  function sideOfSeat(seat) {
    if (typeof seat !== "string") return null;
    return sideBySeat.has(seat) ? sideBySeat.get(seat) : null;
  }

  function areAllies(leftSeat, rightSeat) {
    const leftSide = sideOfSeat(leftSeat);
    if (leftSide === null) return false;
    const rightSide = sideOfSeat(rightSeat);
    if (rightSide === null) return false;
    return leftSide === rightSide;
  }

  function areEnemies(leftSeat, rightSeat) {
    const leftSide = sideOfSeat(leftSeat);
    if (leftSide === null) return false;
    const rightSide = sideOfSeat(rightSeat);
    if (rightSide === null) return false;
    return leftSide !== rightSide;
  }

  function alliedSeatsOf(seat) {
    if (typeof seat !== "string") return EMPTY_SEATS;
    return alliedSeatsBySeat.get(seat) || EMPTY_SEATS;
  }

  function enemySeatsOf(seat) {
    if (typeof seat !== "string") return EMPTY_SEATS;
    return enemySeatsBySeat.get(seat) || EMPTY_SEATS;
  }

  return Object.freeze({
    seatOrder,
    hasSeat,
    sideOfSeat,
    areAllies,
    areEnemies,
    alliedSeatsOf,
    enemySeatsOf,
  });
}
