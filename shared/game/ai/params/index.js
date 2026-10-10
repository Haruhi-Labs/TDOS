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
