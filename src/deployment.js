// 测试构建关闭身份链路，并使用独立存储命名空间。
export const IS_TEST_BUILD = import.meta.env?.VITE_DEPLOY_CHANNEL === "staging"
  || import.meta.env?.BASE_URL === "/test-game/";
export function gameStorageKey(key) { return IS_TEST_BUILD ? `test-game:${key}` : key; }
