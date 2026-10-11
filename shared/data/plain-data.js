// 仅供已投影的普通数据使用；不接受实体、Map、Set 或循环对象。
export function copyPlainData(value) {
  if (Array.isArray(value)) return value.map(copyPlainData);
  if (value && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value)) {
      const item = copyPlainData(value[key]);
      // 协议数据中的同名键仍是普通数据，不得触发原型 setter。
      if (key === "__proto__") {
        Object.defineProperty(result, key, { value: item, enumerable: true, writable: true, configurable: true });
      } else result[key] = item;
    }
    return result;
  }
  return value;
}

// 差量快照会结构共享已冻结节点；跳过它们避免重复遍历历史数据。
export function freezePlainData(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) {
    const item = value[key];
    if (item && typeof item === "object") freezePlainData(item);
  }
  return Object.freeze(value);
}
