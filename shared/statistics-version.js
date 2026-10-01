import { normalizeGameVersion, UNVERSIONED_GAME_VERSION } from "./game-version.js";

export const LEGACY_STATISTICS_VERSION = "v0.3-and-earlier";

// 只改变统计分组，保留日志中的原始游戏版本和构建来源。
export function statisticsVersionGroup(value) {
  const version = normalizeGameVersion(value);
  if (version === UNVERSIONED_GAME_VERSION) return LEGACY_STATISTICS_VERSION;
  const [major, minor, patch = 0] = version.slice(1).split(".").map(Number);
  return major === 0 && (minor < 3 || (minor === 3 && patch === 0))
    ? LEGACY_STATISTICS_VERSION : version;
}

export function isStatisticsVersion(value) {
  return value === LEGACY_STATISTICS_VERSION || value === normalizeGameVersion(value);
}
