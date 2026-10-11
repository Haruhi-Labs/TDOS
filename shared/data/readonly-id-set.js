// 保存标识符集合的独立只读视图；冻结 Set 本身不能禁止 add/delete/clear。
export function readonlyIdSet(values) {
  const ids = new Set(values);
  const view = {
    get size() { return ids.size; },
    has: (id) => ids.has(id),
    values: () => ids.values(),
    keys: () => ids.keys(),
    entries: () => ids.entries(),
    [Symbol.iterator]: () => ids.values(),
    forEach: (callback, thisArg) => ids.forEach((id) => callback.call(thisArg, id, id, view)),
  };
  return Object.freeze(view);
}
