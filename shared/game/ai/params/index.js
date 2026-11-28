// AI 参数的解析入口：默认参数 ← 难度覆盖层 ← 具名预设 ← 调用方覆盖。
// 参数是可 JSON 序列化的纯数据；解析结果深冻结，决策代码只读取、不修改。
import { DEFAULT_AI_PARAMS } from "./default.js";
import { AI_DIFFICULTY_OVERLAYS, normalizeAiDifficulty } from "./difficulty.js";
import { AI_PARAM_PRESETS } from "./presets.js";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
  return value;
}

// 覆盖层只能改写默认参数里已有的键，且类型必须一致；拼错键名或写错类型直接报错，
// 避免静默沿用默认值。
function applyOverlay(target, overlay, path) {
  if (!isPlainObject(overlay)) {
    throw new TypeError(`AI 参数覆盖层 ${path || "(根)"} 必须是对象`);
  }
  for (const [key, value] of Object.entries(overlay)) {
    const where = path ? `${path}.${key}` : key;
    if (!Object.hasOwn(target, key)) {
      throw new RangeError(`未知的 AI 参数：${where}`);
    }
    const current = target[key];
    if (isPlainObject(current)) {
      applyOverlay(current, value, where);
    } else if (Array.isArray(current)) {
      if (!Array.isArray(value) || value.length !== current.length
        || value.some((item, index) => typeof item !== typeof current[index] || (typeof item === "number" && !Number.isFinite(item)))) {
        throw new TypeError(`AI 参数 ${where} 必须是长度为 ${current.length} 的同类型数组`);
      }
      target[key] = [...value];
    } else if (typeof value !== typeof current || (typeof value === "number" && !Number.isFinite(value))) {
      throw new TypeError(`AI 参数 ${where} 的类型应为 ${typeof current}`);
    } else {
      target[key] = value;
    }
  }
}

const ALLOWED_SEAT_PARAM_KEYS = new Set(["difficulty", "preset", "overrides"]);

function normalizeRegisteredSeatSet(registeredSeats) {
  if (!registeredSeats || typeof registeredSeats[Symbol.iterator] !== "function" || typeof registeredSeats === "string") {
    throw new TypeError("已注册席位集合必须是可迭代对象");
  }
  const set = new Set();
  for (const seat of registeredSeats) {
    if (typeof seat !== "string" || seat.length === 0) {
      throw new TypeError("已注册席位必须是非空字符串");
    }
    set.add(seat);
  }
  if (set.size === 0) {
    throw new RangeError("已注册席位集合不能为空");
  }
  return set;
}

// 按本局注册席位校验 aiParams 映射，拒绝未注册席位键、未知字段或缺失必选本席配置。
export function validateAiParamsForSeats(aiParams, registeredSeats, { requiredSeats = [] } = {}) {
  const registeredSet = normalizeRegisteredSeatSet(registeredSeats);
  if (aiParams !== undefined && aiParams !== null) {
    if (!isPlainObject(aiParams)) {
      throw new TypeError("aiParams 必须是按席位索引的普通对象");
    }
    for (const [seat, entry] of Object.entries(aiParams)) {
      if (!registeredSet.has(seat)) {
        throw new RangeError(`AI 参数包含未注册席位：${seat}`);
      }
      if (entry === undefined || entry === null) continue;
      if (!isPlainObject(entry)) {
        throw new TypeError(`席位 ${seat} 的 AI 参数配置必须是普通对象`);
      }
      for (const key of Object.keys(entry)) {
        if (!ALLOWED_SEAT_PARAM_KEYS.has(key)) {
          throw new RangeError(`席位 ${seat} 的 AI 参数包含未知字段：${key}`);
        }
      }
    }
  }

  for (const seat of requiredSeats) {
    if (typeof seat !== "string" || !registeredSet.has(seat)) {
      throw new RangeError(`必选 AI 参数席位未注册：${String(seat)}`);
    }
    if (!aiParams || !Object.hasOwn(aiParams, seat) || !isPlainObject(aiParams[seat])) {
      throw new Error(`缺少席位 ${seat} 的 AI 参数配置`);
    }
  }
}

export function resolveSeatAiParams(seat, {
  registeredSeats,
  difficulty = "master",
  aiParams = null,
  legacyAiSeats = [],
  requireSeatEntry = false,
} = {}) {
  if (typeof seat !== "string" || seat.length === 0) {
    throw new TypeError("解析席位 AI 参数时 seat 必须是非空字符串");
  }
  if (registeredSeats !== undefined) {
    const registeredSet = normalizeRegisteredSeatSet(registeredSeats);
    if (!registeredSet.has(seat)) {
      throw new RangeError(`非法 AI 席位：${seat} 不在已注册席位集合中`);
    }
    validateAiParamsForSeats(aiParams, registeredSet, { requiredSeats: requireSeatEntry ? [seat] : [] });
  } else if (requireSeatEntry && (!aiParams || !Object.hasOwn(aiParams, seat) || !isPlainObject(aiParams[seat]))) {
    throw new Error(`缺少席位 ${seat} 的 AI 参数配置`);
  }

  const entry = aiParams && Object.hasOwn(aiParams, seat) && isPlainObject(aiParams[seat])
    ? aiParams[seat]
    : {};
  const isLegacy = Array.isArray(legacyAiSeats) && legacyAiSeats.includes(seat);
  return resolveAiParams({
    difficulty: entry.difficulty ?? difficulty,
    preset: isLegacy ? "legacy" : (entry.preset ?? null),
    overrides: entry.overrides ?? null,
  });
}

export function resolveAiParams({ difficulty = "master", preset = null, overrides = null } = {}) {
  const params = clone(DEFAULT_AI_PARAMS);
  applyOverlay(params, AI_DIFFICULTY_OVERLAYS[normalizeAiDifficulty(difficulty)], "");
  if (preset !== null && preset !== undefined) {
    if (!Object.hasOwn(AI_PARAM_PRESETS, preset)) {
      throw new RangeError(`未知的 AI 参数预设：${preset}`);
    }
    applyOverlay(params, AI_PARAM_PRESETS[preset], "");
  }
  if (overrides !== null && overrides !== undefined) {
    applyOverlay(params, overrides, "");
  }
  return deepFreeze(params);
}

export { DEFAULT_AI_PARAMS } from "./default.js";
export { AI_DIFFICULTY_OVERLAYS, AI_HANDICAPS, aiHandicapFor, normalizeAiDifficulty } from "./difficulty.js";
export { AI_PARAM_PRESETS } from "./presets.js";
