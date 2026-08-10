import { CHARACTER_DEFS } from "../shared/game-core.js";
import { CHARACTER_TEXT, MESSAGES } from "./i18n/catalog.js";

const STORAGE_KEY = "haruhi-locale-v1";

export const SUPPORTED_LOCALES = Object.freeze({
  zh: { code: "zh", label: "中文", nativeName: "中文", htmlLang: "zh-CN", timeLocale: "zh-CN" },
  ja: { code: "ja", label: "日本語", nativeName: "日本語", htmlLang: "ja-JP", timeLocale: "ja-JP" },
  en: { code: "en", label: "English", nativeName: "English", htmlLang: "en", timeLocale: "en-US" },
});

let currentLocale = null;

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function normalizeLocale(locale) {
  const raw = String(locale || "").toLowerCase();
  if (raw.startsWith("ja")) return "ja";
  if (raw.startsWith("en")) return "en";
  if (raw.startsWith("zh")) return "zh";
  return null;
}

function detectLocale() {
  if (typeof navigator !== "undefined") {
    const langs = Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : [navigator.language];
    for (const lang of langs) {
      const normalized = normalizeLocale(lang);
      if (normalized) return normalized;
    }
  }
  return "zh";
}

function readStoredLocale() {
  if (!canUseStorage()) return null;
  try {
    return normalizeLocale(window.localStorage.getItem(STORAGE_KEY));
  } catch (_error) {
    return null;
  }
}

function writeStoredLocale(locale) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch (_error) {
    // 忽略存储失败。
  }
}

function interpolate(template, args = {}) {
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    if (!(key in args)) return match;
    return String(args[key]);
  });
}

export function getLocale() {
  if (!currentLocale) {
    currentLocale = readStoredLocale() || detectLocale();
  }
  return currentLocale;
}

export function getLocaleInfo(locale = getLocale()) {
  return SUPPORTED_LOCALES[locale] || SUPPORTED_LOCALES.zh;
}

export function t(source, args = {}) {
  const locale = getLocale();
  return interpolate((MESSAGES[locale] && MESSAGES[locale][source]) || source, args);
}

export function formatSeconds(value, digits = 1) {
  const num = Number(value) || 0;
  return t("{value}秒", { value: num.toFixed(digits) });
}

export function formatClockTime(date = new Date()) {
  return date.toLocaleTimeString(getLocaleInfo().timeLocale, { hour12: false });
}

export function characterText(characterId, field = "name") {
  const locale = getLocale();
  const localized = CHARACTER_TEXT[locale]?.[characterId] || CHARACTER_TEXT.zh[characterId];
  if (!localized) return "";
  return localized[field] || CHARACTER_TEXT.zh[characterId]?.[field] || "";
}

export function skillText(characterId, mode = "flagship", field = "name") {
  const locale = getLocale();
  const localized = CHARACTER_TEXT[locale]?.[characterId] || CHARACTER_TEXT.zh[characterId];
  const zh = CHARACTER_TEXT.zh[characterId];
  const key = mode === "sub" ? "subSkill" : "flagshipSkill";
  return localized?.[key]?.[field] || zh?.[key]?.[field] || "";
}

export function applyCoreLocale(locale = getLocale()) {
  const pack = CHARACTER_TEXT[locale] || CHARACTER_TEXT.zh;
  for (const [id, text] of Object.entries(pack)) {
    const def = CHARACTER_DEFS[id];
    if (!def) continue;
    def.name = text.name;
    def.shortName = text.shortName;
    def.title = text.title;
    def.flavor = text.flavor;
    if (def.flagshipSkill && text.flagshipSkill) {
      def.flagshipSkill.name = text.flagshipSkill.name;
      def.flagshipSkill.description = text.flagshipSkill.description;
    }
    if (def.subSkill && text.subSkill) {
      def.subSkill.name = text.subSkill.name;
      def.subSkill.description = text.subSkill.description;
    }
  }
}

export function slotLabel(slotKey, style = "long") {
  const map = {
    main: { long: t("主舰"), short: t("主舰"), tiny: t("主") },
    sub1: { long: t("副舰一"), short: t("副一"), tiny: t("一") },
    sub2: { long: t("副舰二"), short: t("副二"), tiny: t("二") },
    wingman: { long: t("僚机"), short: t("僚机"), tiny: t("僚机") },
    scout: { long: t("侦察机"), short: t("侦察机"), tiny: t("侦察机") },
  };
  return map[slotKey]?.[style] || map[slotKey]?.long || slotKey || t("舰船");
}

export function splitLabel(level) {
  if (level <= 0) return t("编队");
  return level === 1 ? t("一级分离") : t("二级分离");
}

export function seatLabel(seat) {
  return seat === "A" ? t("A队") : t("B队");
}

export function fleetSideLabel(seat) {
  return seat === "A" ? t("左翼舰队") : t("右翼舰队");
}

export function characterName(characterId, fallback = "") {
  return characterText(characterId, "name") || fallback || characterId || "";
}

export function characterShortName(characterId, fallback = "") {
  return characterText(characterId, "shortName") || fallback || characterId || "";
}

export function shipDisplayName(ship, style = "long") {
  if (!ship) return t("无");
  const role = slotLabel(ship.slotKey || ship.key, style === "short" ? "short" : "long");
  const name = characterName(ship.characterId, ship.characterName);
  return name ? `${role}·${name}` : role;
}

export function shipCharacterName(ship) {
  if (!ship) return t("无");
  return characterName(ship.characterId, ship.characterName);
}

export function localizeFloatingText(label) {
  if (!label) return "";
  if (label.textKey) {
    return t(label.textKey, label.textArgs || {});
  }
  return translateServerText(label.text || "");
}

export function translateServerText(text, code = "") {
  if (code === "match_ended_left_win") {
    return t("对局结束，{seat}获胜，已返回大厅", { seat: fleetSideLabel("A") });
  }
  if (code === "match_ended_right_win") {
    return t("对局结束，{seat}获胜，已返回大厅", { seat: fleetSideLabel("B") });
  }
  const codeText = {
    room_closed: "房间已关闭",
    opponent_left: "对手离开房间",
    opponent_disconnected: "对手断开连接，房间已解散",
    already_in_room: "你已经在房间中",
    room_not_found: "房间不存在",
    room_not_joinable: "该房间不接受玩家加入",
    room_not_spectatable: "该房间不接受观战",
    room_not_waiting: "房间不在等待状态",
    room_not_running: "房间不在对战状态",
    room_full: "房间已满或不可加入",
    invalid_message_format: "消息格式错误",
    unknown_message_type: "未知消息类型",
    match_ended_draw: "对局结束，已返回大厅",
  };
  if (codeText[code]) {
    return t(codeText[code]);
  }
  const raw = String(text || "");
  if (!raw) return raw;
  const simple = {
    "房间已关闭": t("房间已关闭"),
    "对手离开房间": t("对手离开房间"),
    "对手断开连接，房间已解散": t("对手断开连接，房间已解散"),
    "你已经在房间中": t("你已经在房间中"),
    "房间不存在": t("房间不存在"),
    "该房间不接受玩家加入": t("该房间不接受玩家加入"),
    "该房间不接受观战": t("该房间不接受观战"),
    "房间不在等待状态": t("房间不在等待状态"),
    "房间不在对战状态": t("房间不在对战状态"),
    "房间已满或不可加入": t("房间已满或不可加入"),
    "消息格式错误": t("消息格式错误"),
    "未知消息类型": t("未知消息类型"),
    "空位": t("空位"),
    "统合思念体AI": t("统合思念体AI"),
  };
  if (simple[raw]) return simple[raw];
  const ended = raw.match(/^对局结束，(.+)获胜，已返回大厅$/);
  if (ended) {
    const seat = ended[1] === "左翼舰队" ? fleetSideLabel("A") : ended[1] === "右翼舰队" ? fleetSideLabel("B") : ended[1];
    return t("对局结束，{seat}获胜，已返回大厅", { seat });
  }
  if (raw === "对局结束，已返回大厅") {
    return t("对局结束，已返回大厅");
  }
  return raw;
}

export function languageSelectorHTML(className = "language-select") {
  const locale = getLocale();
  const options = Object.values(SUPPORTED_LOCALES)
    .map((info) => `<option value="${info.code}"${info.code === locale ? " selected" : ""}>${info.nativeName}</option>`)
    .join("");
  return `
    <label class="${className}">
      <span>${t("语言")}</span>
      <select data-language-select aria-label="${t("语言")}">${options}</select>
    </label>
  `;
}

export function bindLanguageSelector(root = document) {
  const selects = Array.from(root.querySelectorAll("[data-language-select]"));
  for (const select of selects) {
    select.value = getLocale();
    select.addEventListener("change", () => {
      setLocale(select.value);
    });
  }
}

function applyDocumentLocale() {
  const info = getLocaleInfo();
  if (typeof document === "undefined") return;
  document.documentElement.lang = info.htmlLang;
  document.title = t("射手座之日");
  const boot = document.querySelector(".boot-splash");
  if (boot) boot.textContent = t("载入中…");
}

export function setLocale(locale, options = {}) {
  const next = normalizeLocale(locale) || "zh";
  if (next === currentLocale && !options.force) return next;
  currentLocale = next;
  writeStoredLocale(next);
  applyCoreLocale(next);
  applyDocumentLocale();
  if (typeof window !== "undefined" && options.notify !== false) {
    window.dispatchEvent(new CustomEvent("haruhi:locale-change", { detail: { locale: next } }));
  }
  return next;
}

export function initI18n() {
  currentLocale = readStoredLocale() || detectLocale();
  applyCoreLocale(currentLocale);
  applyDocumentLocale();
  return currentLocale;
}
