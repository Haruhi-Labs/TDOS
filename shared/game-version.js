import release from "./release.json" with { type: "json" };

// 公开版本由正式发版改变；热更新只改变部署构建标识。
export const GAME_VERSION = release.version;
export const PUBLISHED_GAME_VERSIONS = Object.freeze([GAME_VERSION, ...(release.previousVersions || [])]);
export const GAME_VERSION_LABELS = Object.freeze(release.labels);
export const UNVERSIONED_GAME_VERSION = "unversioned";
export function normalizeGameVersion(value) {
  return typeof value === "string" && /^v\d+\.\d+(?:\.\d+)?$/.test(value) && value.length <= 40
    ? value : UNVERSIONED_GAME_VERSION;
}
