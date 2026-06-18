// ═══════════════════════════════════════════════════════════════
// 统一玩家档案（Player Profile）
// 单一事实来源：昵称 + 出战编队 + 阵营，全部模式共享。
// 取代此前割裂的三套存储：
//   - 单机   haruhi-player-loadout-v2
//   - 在线   haruhi-online-loadout-v2（+ 昵称 cookie）
//   - 调试   按 A/B 座位各存一份
// 首次读取时会自动从旧存储迁移，保证老玩家数据不丢。
// 本模块不操作具体 DOM，只负责读写与归一化，可被任意前端模块复用。
// ═══════════════════════════════════════════════════════════════

import {
  DEFAULT_TEAM_LOADOUT,
  cloneLoadout,
  normalizeLoadout,
} from "../shared/game-core.js";

const PROFILE_KEY = "haruhi-profile-v1";

// 旧版存储键，仅用于一次性迁移
const LEGACY_SOLO_LOADOUT_KEY = "haruhi-player-loadout-v2";
const LEGACY_ONLINE_LOADOUT_KEY = "haruhi-online-loadout-v2";
const LEGACY_NICKNAME_COOKIE = "haruhi_online_nickname";

export const FACTIONS = ["blue", "red"];
const NICKNAME_MAX = 16;

function hasStorage() {
  return typeof window !== "undefined" && !!window.localStorage;
}

function safeParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function readLegacyCookie(key) {
  if (typeof document === "undefined" || !document.cookie) return "";
  const target = `${key}=`;
  for (const item of document.cookie.split(";")) {
    const token = item.trim();
    if (token.startsWith(target)) {
      try {
        return decodeURIComponent(token.slice(target.length));
      } catch (_error) {
        return "";
      }
    }
  }
  return "";
}

export function sanitizeNickname(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NICKNAME_MAX);
}

export function sanitizeFaction(faction) {
  return FACTIONS.includes(faction) ? faction : "blue";
}

function defaultProfile() {
  return {
    nickname: "",
    loadout: cloneLoadout(DEFAULT_TEAM_LOADOUT),
    faction: "blue",
  };
}

// 把任意输入归一化为合法 profile
function normalizeProfile(raw) {
  const base = defaultProfile();
  if (!raw || typeof raw !== "object") return base;
  return {
    nickname: sanitizeNickname(raw.nickname),
    loadout: normalizeLoadout(raw.loadout || {}, DEFAULT_TEAM_LOADOUT),
    faction: sanitizeFaction(raw.faction),
  };
}

// 从旧版割裂存储拼出一份初始 profile（仅在没有新键时调用一次）
function migrateFromLegacy() {
  const profile = defaultProfile();
  if (!hasStorage()) return profile;

  // 编队：优先单机存档，其次在线存档
  const soloRaw = safeParse(window.localStorage.getItem(LEGACY_SOLO_LOADOUT_KEY));
  const onlineRaw = safeParse(window.localStorage.getItem(LEGACY_ONLINE_LOADOUT_KEY));
  if (soloRaw) {
    profile.loadout = normalizeLoadout(soloRaw, DEFAULT_TEAM_LOADOUT);
  } else if (onlineRaw) {
    profile.loadout = normalizeLoadout(onlineRaw, DEFAULT_TEAM_LOADOUT);
  }

  // 昵称：来自在线 cookie
  profile.nickname = sanitizeNickname(readLegacyCookie(LEGACY_NICKNAME_COOKIE));

  return profile;
}

let cache = null;

function persist() {
  if (!hasStorage() || !cache) return;
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(cache));
  } catch (_error) {
    // 忽略存储失败（隐私模式等）
  }
}

function ensureLoaded() {
  if (cache) return cache;
  if (!hasStorage()) {
    cache = defaultProfile();
    return cache;
  }
  const existing = safeParse(window.localStorage.getItem(PROFILE_KEY));
  if (existing) {
    cache = normalizeProfile(existing);
  } else {
    cache = migrateFromLegacy();
    persist(); // 落盘新键，之后不再触发迁移
  }
  return cache;
}

// ── 公开 API ──

export function getProfile() {
  const p = ensureLoaded();
  return {
    nickname: p.nickname,
    loadout: cloneLoadout(p.loadout),
    faction: p.faction,
  };
}

export function saveProfile(patch = {}) {
  const p = ensureLoaded();
  if ("nickname" in patch) p.nickname = sanitizeNickname(patch.nickname);
  if ("loadout" in patch) p.loadout = normalizeLoadout(patch.loadout || {}, DEFAULT_TEAM_LOADOUT);
  if ("faction" in patch) p.faction = sanitizeFaction(patch.faction);
  persist();
  return getProfile();
}

export function getLoadout() {
  return cloneLoadout(ensureLoaded().loadout);
}

export function setLoadout(loadout) {
  saveProfile({ loadout });
  return getLoadout();
}

export function getNickname() {
  return ensureLoaded().nickname;
}

export function setNickname(name) {
  saveProfile({ nickname: name });
  return getNickname();
}

export function getFaction() {
  return ensureLoaded().faction;
}

export function setFaction(faction) {
  saveProfile({ faction });
  return getFaction();
}

// ── 单人 AI 难度(独立存储,默认普通)──
const DIFFICULTY_KEY = "haruhi-ai-difficulty-v1";
export const AI_DIFFICULTIES = ["easy", "normal", "hard", "master"];
const DEFAULT_DIFFICULTY = "normal";

export function getDifficulty() {
  if (!hasStorage()) return DEFAULT_DIFFICULTY;
  const v = window.localStorage.getItem(DIFFICULTY_KEY);
  return AI_DIFFICULTIES.includes(v) ? v : DEFAULT_DIFFICULTY;
}

export function setDifficulty(level) {
  if (!hasStorage() || !AI_DIFFICULTIES.includes(level)) return getDifficulty();
  window.localStorage.setItem(DIFFICULTY_KEY, level);
  return level;
}

// ── 新手引导教程:是否已看过(首次进战场自动触发的判据)──
const TUTORIAL_SEEN_KEY = "haruhi-tutorial-seen-v1";

export function getTutorialSeen() {
  if (!hasStorage()) return true; // 无存储则当作已看过,不打扰
  return window.localStorage.getItem(TUTORIAL_SEEN_KEY) === "1";
}

export function setTutorialSeen(seen = true) {
  if (!hasStorage()) return;
  if (seen) {
    window.localStorage.setItem(TUTORIAL_SEEN_KEY, "1");
  } else {
    window.localStorage.removeItem(TUTORIAL_SEEN_KEY);
  }
}
