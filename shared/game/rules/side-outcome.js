// 纯阵营终局求值与结果契约校验：仅消费普通只读事实，不访问实体、时钟或终局写权限。
import { freezePlainData } from "../../data/plain-data.js";

export const OUTCOME_SHAPES = Object.freeze({
  LEGACY_SEAT: "legacy-seat",
  SIDE_RESULT: "side-result",
});

export const SIDE_OUTCOME_TYPES = Object.freeze({
  WIN: "win",
  DRAW: "draw",
});

export const LEGACY_STATE_SCHEMA = "legacy-v1";
export const MULTI_FLEET_STATE_SCHEMA = "multi-fleet-v1";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateReason(reason) {
  if (reason !== undefined && (typeof reason !== "string" || reason.trim().length === 0)) {
    throw new TypeError("终局原因必须是非空字符串");
  }
}

function indexFleetFacts(fleets) {
  if (!Array.isArray(fleets) || fleets.length === 0) {
    throw new TypeError("终局事实 fleets 必须是非空数组");
  }
  const seatSet = new Set();
  const sideOrder = [];
  const sideSeats = new Map();
  const sideAlive = new Map();

  for (let index = 0; index < fleets.length; index += 1) {
    const entry = fleets[index];
    if (!isPlainObject(entry)) {
      throw new TypeError(`终局事实 fleets[${index}] 必须是普通对象`);
    }
    const { seat, sideId, alive } = entry;
    if (typeof seat !== "string" || seat.length === 0) {
      throw new TypeError(`终局事实 fleets[${index}] 缺少有效 seat`);
    }
    if (typeof sideId !== "string" || sideId.length === 0) {
      throw new TypeError(`终局事实 fleets[${index}] 缺少有效 sideId`);
    }
    if (typeof alive !== "boolean") {
      throw new TypeError(`终局事实 fleets[${index}] 的 alive 必须是布尔值`);
    }
    if (seatSet.has(seat)) {
      throw new Error(`终局事实存在重复席位：${seat}`);
    }
    seatSet.add(seat);
    if (!sideSeats.has(sideId)) {
      sideOrder.push(sideId);
      sideSeats.set(sideId, []);
      sideAlive.set(sideId, false);
    }
    sideSeats.get(sideId).push(seat);
    if (alive) {
      sideAlive.set(sideId, true);
    }
  }

  return { seatSet, sideOrder, sideSeats, sideAlive };
}

/**
 * 构造单次采样的冻结终局事实：当且仅当拓扑恰为旧 A/B 时复用同次采样额外提供 aAlive/bAlive。
 */
export function buildVictoryFacts({ elapsed, fleets, legacyAb = false }) {
  if (typeof elapsed !== "number" || !Number.isFinite(elapsed) || elapsed < 0) {
    throw new TypeError("终局事实 elapsed 必须是非负有限数值");
  }
  indexFleetFacts(fleets);
  const frozenFleets = Object.freeze(
    fleets.map((entry) => Object.freeze({
      seat: entry.seat,
      sideId: entry.sideId,
      alive: entry.alive,
    })),
  );
  if (!legacyAb) {
    return Object.freeze({ elapsed, fleets: frozenFleets });
  }
  if (frozenFleets.length !== 2 || frozenFleets[0].seat !== "A" || frozenFleets[1].seat !== "B") {
    throw new Error("仅旧 A/B 双舰队拓扑允许附带 aAlive 与 bAlive");
  }
  return Object.freeze({
    elapsed,
    aAlive: frozenFleets[0].alive,
    bAlive: frozenFleets[1].alive,
    fleets: frozenFleets,
  });
}

/**
 * 纯阵营歼灭求值：按 sideId 对同阵营各舰队存活状态取逻辑“或”。
 * 存活阵营数 > 1 返回 null（继续）；= 1 返回胜利（winnerSeats 含胜方全部参与席位）；= 0 返回平局。
 */
export function evaluateSideEliminationOutcome(facts) {
  if (!isPlainObject(facts)) {
    throw new TypeError("终局求值事实必须是普通对象");
  }
  const { sideOrder, sideSeats, sideAlive } = indexFleetFacts(facts.fleets);
  if (sideOrder.length < 2) {
    throw new Error("阵营终局求值至少需要两个敌对阵营");
  }

  const aliveSides = sideOrder.filter((sideId) => sideAlive.get(sideId));
  if (aliveSides.length > 1) {
    return null;
  }
  if (aliveSides.length === 1) {
    const winnerSideId = aliveSides[0];
    return Object.freeze({
      type: SIDE_OUTCOME_TYPES.WIN,
      winnerSideId,
      winnerSeats: Object.freeze([...sideSeats.get(winnerSideId)]),
    });
  }
  return Object.freeze({
    type: SIDE_OUTCOME_TYPES.DRAW,
    winnerSideId: null,
    winnerSeats: Object.freeze([]),
  });
}

/**
 * 按模式声明的结果形态校验候选终局，返回待运行时原子提交的冻结终局记录。
 */
export function validateModeOutcome(result, { outcomeShape, fleets }) {
  if (!isPlainObject(result)) {
    throw new TypeError("终局候选结果必须是普通对象");
  }
  validateReason(result.reason);
  const { seatSet, sideSeats } = indexFleetFacts(fleets);

  if (outcomeShape === OUTCOME_SHAPES.LEGACY_SEAT) {
    if (!Object.hasOwn(result, "winnerSeat")) {
      throw new TypeError("旧模式终局候选结果缺少 winnerSeat 字段");
    }
    if (result.winnerSeat !== null && (typeof result.winnerSeat !== "string" || !seatSet.has(result.winnerSeat))) {
      throw new Error(`非法旧模式胜者席位：${String(result.winnerSeat)}`);
    }
    return Object.freeze({
      phase: "finished",
      winnerSeat: result.winnerSeat,
      outcome: null,
      ...(result.reason ? { endReason: result.reason } : {}),
    });
  }

  if (outcomeShape === OUTCOME_SHAPES.SIDE_RESULT) {
    const { type, winnerSideId, winnerSeats, reason } = result;
    if (type !== SIDE_OUTCOME_TYPES.WIN && type !== SIDE_OUTCOME_TYPES.DRAW) {
      throw new TypeError(`非法阵营终局类型：${String(type)}`);
    }
    if (!Array.isArray(winnerSeats)) {
      throw new TypeError("阵营终局结果中的 winnerSeats 必须是数组");
    }

    if (type === SIDE_OUTCOME_TYPES.DRAW) {
      if (winnerSideId !== null) {
        throw new Error("平局结果的 winnerSideId 必须为 null");
      }
      if (winnerSeats.length !== 0) {
        throw new Error("平局结果的 winnerSeats 必须为空数组");
      }
      const outcome = freezePlainData({
        type: SIDE_OUTCOME_TYPES.DRAW,
        winnerSideId: null,
        winnerSeats: [],
        ...(reason ? { reason } : {}),
      });
      return Object.freeze({
        phase: "finished",
        winnerSeat: null,
        outcome,
        ...(reason ? { endReason: reason } : {}),
      });
    }

    if (typeof winnerSideId !== "string" || !sideSeats.has(winnerSideId)) {
      throw new Error(`胜利结果的 winnerSideId 不属于本局已注册阵营：${String(winnerSideId)}`);
    }
    const expectedSeats = sideSeats.get(winnerSideId);
    if (
      winnerSeats.length !== expectedSeats.length
      || expectedSeats.some((seat, index) => winnerSeats[index] !== seat)
    ) {
      throw new Error(`胜利结果的 winnerSeats 必须按顺序包含阵营 ${winnerSideId} 的全部参与席位`);
    }
    const outcome = freezePlainData({
      type: SIDE_OUTCOME_TYPES.WIN,
      winnerSideId,
      winnerSeats: [...expectedSeats],
      ...(reason ? { reason } : {}),
    });
    return Object.freeze({
      phase: "finished",
      winnerSeat: null,
      outcome,
      ...(reason ? { endReason: reason } : {}),
    });
  }

  throw new Error(`未知终局结果形态声明：${String(outcomeShape)}`);
}

/**
 * 根据已提交的阵营终局结果推导单名参与者的个人胜负（获胜阵营中已淘汰队友仍记为胜利）。
 */
export function participantOutcomeForSeat(outcome, seat, sideId) {
  if (!outcome) return null;
  if (outcome.type === SIDE_OUTCOME_TYPES.DRAW) return "draw";
  if (outcome.type === SIDE_OUTCOME_TYPES.WIN) {
    return outcome.winnerSideId === sideId && Array.isArray(outcome.winnerSeats) && outcome.winnerSeats.includes(seat)
      ? "win"
      : "loss";
  }
  return null;
}

/**
 * 校验外部或持久化读模型中的阵营终局对象与参与者列表是否自洽。
 */
export function normalizeSideOutcomeForParticipants(outcome, participants) {
  if (!isPlainObject(outcome)) return null;
  if (!Array.isArray(participants) || participants.length === 0) return null;
  const { type, winnerSideId, winnerSeats, reason } = outcome;
  if (type !== SIDE_OUTCOME_TYPES.WIN && type !== SIDE_OUTCOME_TYPES.DRAW) return null;
  if (!Array.isArray(winnerSeats)) return null;
  if (reason !== undefined && (typeof reason !== "string" || reason.trim().length === 0)) return null;

  const sideSeats = new Map();
  for (const participant of participants) {
    if (!participant || typeof participant.seat !== "string" || typeof participant.sideId !== "string") {
      return null;
    }
    if (!sideSeats.has(participant.sideId)) {
      sideSeats.set(participant.sideId, []);
    }
    sideSeats.get(participant.sideId).push(participant.seat);
  }

  if (type === SIDE_OUTCOME_TYPES.DRAW) {
    if (winnerSideId !== null || winnerSeats.length !== 0) return null;
    return {
      type: SIDE_OUTCOME_TYPES.DRAW,
      winnerSideId: null,
      winnerSeats: [],
      ...(reason ? { reason: reason.trim().slice(0, 80) } : {}),
    };
  }

  if (typeof winnerSideId !== "string" || !sideSeats.has(winnerSideId)) return null;
  const expectedSeats = sideSeats.get(winnerSideId);
  if (
    winnerSeats.length !== expectedSeats.length
    || expectedSeats.some((seat, index) => winnerSeats[index] !== seat)
  ) {
    return null;
  }
  return {
    type: SIDE_OUTCOME_TYPES.WIN,
    winnerSideId,
    winnerSeats: [...expectedSeats],
    ...(reason ? { reason: reason.trim().slice(0, 80) } : {}),
  };
}
