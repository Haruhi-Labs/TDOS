// 共享房间玩法格式契约：统一 formatId、人数与阵营容量、支持能力及公开元数据，不承载战斗伤害规则。
import { RULESET_VERSION } from "./ruleset-version.js";

export const LEGACY_STATE_SCHEMA = "legacy-v1";
export const MULTI_FLEET_STATE_SCHEMA = "multi-fleet-v1";

export const SUPPORTED_STATE_SCHEMAS = Object.freeze([
  LEGACY_STATE_SCHEMA,
  MULTI_FLEET_STATE_SCHEMA,
]);

export const ROOM_FORMAT_IDS = Object.freeze([
  "duel",
  "2v2",
  "3v3",
  "ffa",
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);
  }
  return value;
}

export const ROOM_FORMATS = deepFreeze({
  duel: {
    formatId: "duel",
    battleMode: "standard",
    stateSchema: LEGACY_STATE_SCHEMA,
    capacity: 2,
    minPlayers: 2,
    maxPlayers: 2,
    sides: ["side1", "side2"],
    sideCapacity: 1,
    seats: ["A", "B"],
    seatSideMap: {
      A: "side1",
      B: "side2",
    },
    allowSideSwitch: false,
    allowDuplicateCharactersInSide: true,
    supportsAi: true,
    supportsTournament: true,
    autoStartOnFull: true,
    requiresReady: false,
    requiresExplicitCapability: false,
    label: "1v1 对决",
  },
  "2v2": {
    formatId: "2v2",
    battleMode: "team_elimination",
    stateSchema: MULTI_FLEET_STATE_SCHEMA,
    capacity: 4,
    minPlayers: 4,
    maxPlayers: 4,
    sides: ["side1", "side2"],
    sideCapacity: 2,
    seats: ["P1", "P2", "P3", "P4"],
    seatSideMap: {
      P1: "side1",
      P2: "side1",
      P3: "side2",
      P4: "side2",
    },
    allowSideSwitch: true,
    allowDuplicateCharactersInSide: true,
    supportsAi: false,
    supportsTournament: true,
    autoStartOnFull: false,
    requiresReady: true,
    requiresExplicitCapability: true,
    label: "2v2 组队战",
  },
  "3v3": {
    formatId: "3v3",
    battleMode: "team_elimination",
    stateSchema: MULTI_FLEET_STATE_SCHEMA,
    capacity: 6,
    minPlayers: 6,
    maxPlayers: 6,
    sides: ["side1", "side2"],
    sideCapacity: 3,
    seats: ["P1", "P2", "P3", "P4", "P5", "P6"],
    seatSideMap: {
      P1: "side1",
      P2: "side1",
      P3: "side1",
      P4: "side2",
      P5: "side2",
      P6: "side2",
    },
    allowSideSwitch: true,
    allowDuplicateCharactersInSide: true,
    supportsAi: false,
    supportsTournament: true,
    autoStartOnFull: false,
    requiresReady: true,
    requiresExplicitCapability: true,
    label: "3v3 组队战",
  },
  ffa: {
    formatId: "ffa",
    battleMode: "ffa_elimination",
    stateSchema: MULTI_FLEET_STATE_SCHEMA,
    capacity: 6,
    minPlayers: 3,
    maxPlayers: 6,
    sides: ["side1", "side2", "side3", "side4", "side5", "side6"],
    sideCapacity: 1,
    seats: ["P1", "P2", "P3", "P4", "P5", "P6"],
    seatSideMap: {
      P1: "side1",
      P2: "side2",
      P3: "side3",
      P4: "side4",
      P5: "side5",
      P6: "side6",
    },
    allowSideSwitch: false,
    allowDuplicateCharactersInSide: true,
    supportsAi: false,
    supportsTournament: true,
    autoStartOnFull: false,
    requiresReady: true,
    requiresExplicitCapability: true,
    label: "多人混战",
  },
});

export function isSupportedRoomFormat(formatId) {
  return typeof formatId === "string" && Object.hasOwn(ROOM_FORMATS, formatId);
}

export function getRoomFormat(formatId = "duel") {
  if (!isSupportedRoomFormat(formatId)) {
    return null;
  }
  return ROOM_FORMATS[formatId];
}

/**
 * 解析客户端请求中的 formatId：缺省时兼容旧 duel；显式传入未知值时返回 null，禁止静默回退。
 */
export function resolveRequestedRoomFormat(requestedFormatId) {
  if (requestedFormatId === undefined || requestedFormatId === null || requestedFormatId === "") {
    return ROOM_FORMATS.duel;
  }
  return getRoomFormat(requestedFormatId);
}

export function seatsForSide(formatId, sideId) {
  const format = getRoomFormat(formatId);
  if (!format || typeof sideId !== "string" || !format.sides.includes(sideId)) {
    return Object.freeze([]);
  }
  return Object.freeze(format.seats.filter((seat) => format.seatSideMap[seat] === sideId));
}

export function sideForSeatInFormat(formatId, seat) {
  const format = getRoomFormat(formatId);
  if (!format || typeof seat !== "string" || !Object.hasOwn(format.seatSideMap, seat)) {
    return null;
  }
  return format.seatSideMap[seat];
}

/**
 * 校验客户端声明是否满足目标房间格式所需的规则版本、状态 schema 与格式能力。
 * 传输协议的 delta/ACK 版本与战斗状态 schema 独立校验。
 */
export function evaluateRoomFormatCapability(formatId, clientCapabilities = {}) {
  const format = getRoomFormat(formatId);
  if (!format) {
    return {
      ok: false,
      code: "unsupported_room_format",
      message: "不支持的房间玩法格式",
    };
  }
  if (!format.requiresExplicitCapability) {
    return { ok: true, code: "ok", message: "" };
  }

  const rulesetVersion = String(clientCapabilities.rulesetVersion || "").trim();
  if (rulesetVersion !== RULESET_VERSION) {
    return {
      ok: false,
      code: "multi_fleet_ruleset_required",
      message: "多人玩法格式需要声明当前规则版本",
    };
  }

  const schemas = clientCapabilities.stateSchemas instanceof Set
    ? clientCapabilities.stateSchemas
    : new Set(Array.isArray(clientCapabilities.stateSchemas) ? clientCapabilities.stateSchemas : []);
  const formats = clientCapabilities.roomFormats instanceof Set
    ? clientCapabilities.roomFormats
    : new Set(Array.isArray(clientCapabilities.roomFormats) ? clientCapabilities.roomFormats : []);

  if (!schemas.has(format.stateSchema) || !formats.has(format.formatId)) {
    return {
      ok: false,
      code: "multi_fleet_client_unsupported",
      message: "客户端不支持该多人玩法格式，请刷新页面",
    };
  }

  return { ok: true, code: "ok", message: "" };
}
