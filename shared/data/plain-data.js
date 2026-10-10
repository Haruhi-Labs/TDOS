// 仅供已投影的普通数据使用；不接受实体、Map、Set 或循环对象。
export function copyPlainData(value) {
  if (Array.isArray(value)) return value.map(copyPlainData);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyPlainData(item)]));
  }
  return value;
}

// 差量快照会结构共享已冻结节点；跳过它们避免重复遍历历史数据。
export function freezePlainData(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) freezePlainData(item);
  return Object.freeze(value);
}
