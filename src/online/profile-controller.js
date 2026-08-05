import {
  CHARACTER_DEFS,
  CHARACTER_ORDER,
  DEFAULT_TEAM_LOADOUT,
  normalizeLoadout,
} from "../../shared/game-core.js";
import {
  getLoadout,
  getNickname as getProfileNickname,
  setLoadout,
  setNickname as setProfileNickname,
} from "../profile.js";
import { slotLabel as localizedSlotLabel, t } from "../i18n.js";

const NICKNAME_COOKIE_KEY = "haruhi_online_nickname";
const NICKNAME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function sanitizeNickname(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16);
}

function readCookie(key) {
  const target = `${key}=`;
  const list = document.cookie ? document.cookie.split(";") : [];
  for (const item of list) {
    const token = item.trim();
    if (token.startsWith(target)) {
      return decodeURIComponent(token.slice(target.length));
    }
  }
  return "";
}

function writeCookie(key, value, maxAgeSeconds) {
  const secureFlag = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${key}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax${secureFlag}`;
}

export function readStoredLoadout() {
  return getLoadout();
}

export function storeLoadout(loadout) {
  setLoadout(loadout);
}

export function createOnlineProfileController({ ui, getPlayerLoadout }) {
  function roleSummaryLine(slotKey, characterId) {
    const def = CHARACTER_DEFS[characterId];
    const stat = def.stats;
    return `${localizedSlotLabel(slotKey)} ${def.shortName} | ${t("舰体")}${stat.hp} | ${t("能量")}${stat.energy} | ${t("航速")}${stat.speed} | ${t("机动")}${stat.turnRate.toFixed(2)}`;
  }

  function renderLoadoutPreview(loadout) {
    if (!ui.onlineLoadoutPreview) return;
    ui.onlineLoadoutPreview.innerHTML = "";
    for (const slotKey of ["main", "sub1", "sub2"]) {
      const row = document.createElement("div");
      row.textContent = roleSummaryLine(slotKey, loadout[slotKey]);
      ui.onlineLoadoutPreview.append(row);
    }
  }

  function updateShipSwitchLabels(loadout) {
    const labelMap = {
      main: `${localizedSlotLabel("main", "short")} ${CHARACTER_DEFS[loadout.main].shortName}`,
      sub1: `${localizedSlotLabel("sub1", "short")} ${CHARACTER_DEFS[loadout.sub1].shortName}`,
      sub2: `${localizedSlotLabel("sub2", "short")} ${CHARACTER_DEFS[loadout.sub2].shortName}`,
    };
    for (const button of ui.shipSwitchButtons) {
      button.textContent = labelMap[button.dataset.ship] || button.textContent;
    }
  }

  function syncLoadoutControls(loadout) {
    if (ui.onlineMainRole) ui.onlineMainRole.value = loadout.main;
    if (ui.onlineSub1Role) ui.onlineSub1Role.value = loadout.sub1;
    if (ui.onlineSub2Role) ui.onlineSub2Role.value = loadout.sub2;
    renderLoadoutPreview(loadout);
    updateShipSwitchLabels(loadout);
  }

  function populateLoadoutControls() {
    for (const select of [ui.onlineMainRole, ui.onlineSub1Role, ui.onlineSub2Role]) {
      if (!select) continue;
      select.innerHTML = "";
      for (const characterId of CHARACTER_ORDER) {
        const def = CHARACTER_DEFS[characterId];
        const option = document.createElement("option");
        option.value = characterId;
        option.textContent = `${def.shortName} · ${def.title}`;
        select.append(option);
      }
    }
    syncLoadoutControls(getPlayerLoadout());
  }

  function readLoadoutFromControls() {
    const current = getPlayerLoadout();
    return normalizeLoadout(
      {
        main: ui.onlineMainRole ? ui.onlineMainRole.value : current.main,
        sub1: ui.onlineSub1Role ? ui.onlineSub1Role.value : current.sub1,
        sub2: ui.onlineSub2Role ? ui.onlineSub2Role.value : current.sub2,
      },
      DEFAULT_TEAM_LOADOUT,
    );
  }

  function updateNicknameDisplay(name) {
    if (ui.onlineNicknameValue) {
      ui.onlineNicknameValue.textContent = t("昵称：{name}", { name: name || "-" });
    }
  }

  function setNickname(name, options = {}) {
    const { persist = true } = options;
    const safeName = sanitizeNickname(name);
    if (ui.playerNameInput) ui.playerNameInput.value = safeName;
    updateNicknameDisplay(safeName);
    if (persist && safeName) {
      setProfileNickname(safeName);
      writeCookie(NICKNAME_COOKIE_KEY, safeName, NICKNAME_COOKIE_MAX_AGE);
    }
    return safeName;
  }

  function initializeNickname() {
    const savedName = sanitizeNickname(getProfileNickname() || readCookie(NICKNAME_COOKIE_KEY));
    const fallbackName = t("玩家{num}", { num: Math.floor(Math.random() * 900 + 100) });
    return setNickname(savedName || fallbackName, { persist: true });
  }

  return {
    initializeNickname,
    populateLoadoutControls,
    readLoadoutFromControls,
    setNickname,
    syncLoadoutControls,
    updateShipSwitchLabels,
  };
}
