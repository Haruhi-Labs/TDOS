const PATCH_OBJECT = 0;
const PATCH_ARRAY = 1;
const PATCH_REPLACE = 2;
const PATCH_DELETE = 3;
const PATCH_KEYED_ARRAY = 4;
const NO_CHANGE = Symbol("network-patch-no-change");
const DEFAULT_NETWORK_DECIMALS = 3;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * 将仅用于表现的网络状态限制到毫单位精度。权威模拟仍保留完整双精度，
 * 这里只减少 JSON 中不断变化且难以压缩的浮点尾数。
 */
export function quantizeNetworkState(value, decimals = DEFAULT_NETWORK_DECIMALS) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Number.isInteger(value)) {
      return value;
    }
    const safeDecimals = Math.max(0, Math.min(6, Number(decimals) || 0));
    const scale = 10 ** safeDecimals;
    const rounded = Math.round(value * scale) / scale;
    return rounded === 0 ? 0 : rounded;
  }
  if (Array.isArray(value)) {
    return value.map((item) => quantizeNetworkState(item, decimals));
  }
  if (isObject(value)) {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = quantizeNetworkState(item, decimals);
    }
    return result;
  }
  return value;
}

function entityId(value) {
  if (!isObject(value)) {
    return null;
  }
  const id = value.id;
  return typeof id === "string" || (typeof id === "number" && Number.isFinite(id)) ? id : null;
}

function entityIdKey(id) {
  return typeof id === "number" ? `n:${id}` : `s:${id}`;
}

function keyedArrayInfo(values) {
  if (!Array.isArray(values)) {
    return null;
  }
  const ids = [];
  const keys = new Set();
  for (const value of values) {
    const id = entityId(value);
    if (id === null) {
      return null;
    }
    const key = entityIdKey(id);
    if (keys.has(key)) {
      return null;
    }
    keys.add(key);
    ids.push(id);
  }
  return { ids, keys };
}

function createKeyedArrayPatch(previous, next, previousInfo, nextInfo) {
  const previousById = new Map();
  for (const value of previous) {
    previousById.set(entityIdKey(entityId(value)), value);
  }

  const changes = {};
  let changed = previous.length !== next.length;
  for (let index = 0; index < next.length; index += 1) {
    const id = nextInfo.ids[index];
    const key = entityIdKey(id);
    if (!changed && !Object.is(previousInfo.ids[index], id)) {
      changed = true;
    }
    const oldValue = previousById.get(key);
    const childPatch = oldValue === undefined
      ? [PATCH_REPLACE, next[index]]
      : createPatchInternal(oldValue, next[index]);
    if (childPatch !== NO_CHANGE) {
      changes[key] = childPatch;
      changed = true;
    }
  }

  return changed ? [PATCH_KEYED_ARRAY, nextInfo.ids, changes] : NO_CHANGE;
}

function createArrayPatch(previous, next) {
  const previousInfo = keyedArrayInfo(previous);
  const nextInfo = keyedArrayInfo(next);
  if (nextInfo && (previousInfo || previous.length === 0)) {
    return createKeyedArrayPatch(
      previous,
      next,
      previousInfo || { ids: [], keys: new Set() },
      nextInfo,
    );
  }

  const changes = {};
  let changed = previous.length !== next.length;
  for (let index = 0; index < next.length; index += 1) {
    const childPatch = index >= previous.length
      ? [PATCH_REPLACE, next[index]]
      : createPatchInternal(previous[index], next[index]);
    if (childPatch !== NO_CHANGE) {
      changes[index] = childPatch;
      changed = true;
    }
  }
  return changed ? [PATCH_ARRAY, next.length, changes] : NO_CHANGE;
}

function createObjectPatch(previous, next) {
  const changes = {};
  let changed = false;
  for (const key of Object.keys(next)) {
    const childPatch = hasOwn(previous, key)
      ? createPatchInternal(previous[key], next[key])
      : [PATCH_REPLACE, next[key]];
    if (childPatch !== NO_CHANGE) {
      changes[key] = childPatch;
      changed = true;
    }
  }
  for (const key of Object.keys(previous)) {
    if (!hasOwn(next, key)) {
      changes[key] = [PATCH_DELETE];
      changed = true;
    }
  }
  return changed ? [PATCH_OBJECT, changes] : NO_CHANGE;
}

function createPatchInternal(previous, next) {
  if (Object.is(previous, next)) {
    return NO_CHANGE;
  }
  if (Array.isArray(previous) && Array.isArray(next)) {
    return createArrayPatch(previous, next);
  }
  if (isObject(previous) && isObject(next)) {
    return createObjectPatch(previous, next);
  }
  return [PATCH_REPLACE, next];
}

/**
 * 生成可 JSON 序列化的结构差量。返回 null 表示状态完全未变化。
 */
export function createStatePatch(previous, next) {
  const patch = createPatchInternal(previous, next);
  return patch === NO_CHANGE ? null : patch;
}

function applyPatchInternal(previous, patch) {
  if (!Array.isArray(patch) || !Number.isInteger(patch[0])) {
    throw new Error("网络状态差量格式错误");
  }

  const type = patch[0];
  if (type === PATCH_REPLACE) {
    return patch[1];
  }
  if (type === PATCH_DELETE) {
    return undefined;
  }
  if (type === PATCH_OBJECT) {
    const changes = isObject(patch[1]) ? patch[1] : {};
    const result = isObject(previous) ? { ...previous } : {};
    for (const [key, childPatch] of Object.entries(changes)) {
      if (Array.isArray(childPatch) && childPatch[0] === PATCH_DELETE) {
        delete result[key];
      } else {
        result[key] = applyPatchInternal(result[key], childPatch);
      }
    }
    return result;
  }
  if (type === PATCH_ARRAY) {
    const length = Math.max(0, Number(patch[1]) || 0);
    const changes = isObject(patch[2]) ? patch[2] : {};
    const result = Array.isArray(previous) ? previous.slice(0, length) : [];
    result.length = length;
    for (const [indexRaw, childPatch] of Object.entries(changes)) {
      const index = Number(indexRaw);
      if (!Number.isInteger(index) || index < 0 || index >= length) {
        throw new Error("网络状态差量数组下标越界");
      }
      result[index] = applyPatchInternal(result[index], childPatch);
    }
    return result;
  }
  if (type === PATCH_KEYED_ARRAY) {
    const order = Array.isArray(patch[1]) ? patch[1] : [];
    const changes = isObject(patch[2]) ? patch[2] : {};
    const previousById = new Map();
    if (Array.isArray(previous)) {
      for (const value of previous) {
        const id = entityId(value);
        if (id !== null) {
          previousById.set(entityIdKey(id), value);
        }
      }
    }
    return order.map((id) => {
      const key = entityIdKey(id);
      const oldValue = previousById.get(key);
      if (hasOwn(changes, key)) {
        return applyPatchInternal(oldValue, changes[key]);
      }
      if (oldValue === undefined) {
        throw new Error("网络状态差量缺少新增实体");
      }
      return oldValue;
    });
  }

  throw new Error("网络状态差量类型未知");
}

/**
 * 将结构差量应用到上一帧。未变化的分支会复用旧对象，降低浏览器分配和 GC 压力。
 */
export function applyStatePatch(previous, patch) {
  return patch === null ? previous : applyPatchInternal(previous, patch);
}
