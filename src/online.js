import {
  CHARACTER_ORDER,
  CHARACTER_DEFS,
  DEFAULT_TEAM_LOADOUT,
  DEFAULT_WORLD_SIZE,
  EMERGENCY_BRAKE_COST,
  SCOUT_LAUNCH_COST,
  cloneLoadout,
  normalizeLoadout,
  skillMetaForCharacter,
} from "../shared/game-core.js";

import {
  getLoadout,
  setLoadout,
  getFaction,
  getNickname as getProfileNickname,
  setNickname as setProfileNickname,
} from "./profile.js";

// 联机选角与单机共用同一套「翻书选角」覆盖层;立绘绘制与单机同源
import { createCharacterSelect, drawInGamePortrait } from "./character-select.js";
import { startStarfield } from "./starfield.js";
import { showConfirm } from "./confirm-dialog.js";
import { mountRouteFluidBackdrop } from "./effects/fluid-reveal/routeBackdrop.js";
import {
  createShipDestructionEffects,
  resetShipDestructionEffects,
} from "./ship-destruction-effects.js";
import {
  CAMERA_ZOOM_MIN,
  CAMERA_ZOOM_MAX,
  createBattleCamera,
  prefersMobileBattleMode,
} from "./battle/camera.js";
import { routeHandleAtPoint, shipAtPoint, zoneFromPoint } from "./battle/input.js";
import {
  currentFlagshipMeta,
  currentSubMeta,
  energyPercentForShip,
  renderFleetRoster,
  syncMobileHud,
  updateSkillButtons,
} from "./battle/hud.js";
import { battleViewTemplate } from "./battle/template.js";
import {
  drawBackground,
  drawBattleCountdown,
  drawBattleWorld,
  drawMinimap,
  drawNoDataHint,
} from "./battle/render.js";
import {
  characterShortName,
  formatClockTime,
  shipCharacterName,
  shipDisplayName,
  slotLabel as localizedSlotLabel,
  splitLabel as localizedSplitLabel,
  t,
  translateServerText,
  fleetSideLabel,
} from "./i18n.js";

// 可挂载模块状态：每次 mount 重新初始化（同一时刻只挂载一个模式）
let canvas, ctx, ui, app;
let ac = null; // AbortController：统一移除 window 级监听
let rafId = 0; // 渲染循环句柄
let running = false; // 渲染循环开关
let charSelect = null; // 选角覆盖层（与单机一致），卸载时移除
let camera = null; // 共享战场相机（src/battle/camera.js），mount 时创建
let routeFluidBackdrop = null;
let routeFluidMode = "";
let lobbyStarfieldAc = null;

function addWin(type, handler) {
  window.addEventListener(type, handler, ac ? { signal: ac.signal } : undefined);
}

function cacheDom() {
  canvas = document.getElementById("gameCanvas");
  ctx = canvas.getContext("2d");
  ui = {
  serverTargetValue: document.getElementById("serverTargetValue"),
  connectBtn: document.getElementById("connectBtn"),
  disconnectBtn: document.getElementById("disconnectBtn"),
  connectionValue: document.getElementById("connectionValue"),
  pingValue: document.getElementById("pingValue"),
  jitterValue: document.getElementById("jitterValue"),
  interpValue: document.getElementById("interpValue"),
  playerNameInput: document.getElementById("playerNameInput"),
  applyNameBtn: document.getElementById("applyNameBtn"),
  createPublicBtn: document.getElementById("createPublicBtn"),
  createPrivateBtn: document.getElementById("createPrivateBtn"),
  create2v2Btn: document.getElementById("create2v2Btn"),
  createAiRoomBtn: document.getElementById("createAiRoomBtn"),
  joinCodeInput: document.getElementById("joinCodeInput"),
  joinCodeBtn: document.getElementById("joinCodeBtn"),
  refreshRoomsBtn: document.getElementById("refreshRoomsBtn"),
  roomList: document.getElementById("roomList"),
  roomSummary: document.getElementById("roomSummary"),
  leaveRoomBtn: document.getElementById("leaveRoomBtn"),
  readyRoomBtn: document.getElementById("readyRoomBtn"),
  battleControls: document.getElementById("battleControls"),
  seatValue: document.getElementById("seatValue"),
  hullValue: document.getElementById("hullValue"),
  energyValue: document.getElementById("energyValue"),
  splitValue: document.getElementById("splitValue"),
  zoneValue: document.getElementById("zoneValue"),
  selectedValue: document.getElementById("onlineSelectedValue"),
  shipSelect: document.getElementById("onlineShipSelect"),
  shipSwitchButtons: Array.from(document.querySelectorAll("#shipQuickSwitch .ship-switch-btn")),
  powerSlider: document.getElementById("powerSlider"),
  powerValue: document.getElementById("powerValue"),
  zoomOutBtn: document.getElementById("zoomOutBtn"),
  zoomInBtn: document.getElementById("zoomInBtn"),
  zoomValue: document.getElementById("zoomValue"),
  splitOneBtn: document.getElementById("splitOneBtn"),
  splitTwoBtn: document.getElementById("splitTwoBtn"),
  scoutBtn: document.getElementById("scoutBtn"),
  autoScoutBtn: document.getElementById("autoScoutBtn"),
  brakeBtn: document.getElementById("brakeBtn"),
  flagshipBtn: document.getElementById("flagshipBtn"),
  subSkillBtn: document.getElementById("subSkillBtn"),
  onlineMainRole: document.getElementById("onlineMainRole"),
  onlineSub1Role: document.getElementById("onlineSub1Role"),
  onlineSub2Role: document.getElementById("onlineSub2Role"),
  onlineLoadoutPreview: document.getElementById("onlineLoadoutPreview"),
  applyLoadoutOnlineBtn: document.getElementById("applyLoadoutOnlineBtn"),
  openFleetSelectBtn: document.getElementById("openFleetSelectBtn"),
  onlineNicknameValue: document.getElementById("onlineNicknameValue"),
  onlineLog: document.getElementById("onlineLog"),
  teamCommPanel: document.getElementById("teamCommPanel"),
  teamCommButtons: Array.from(document.querySelectorAll("#teamCommButtons [data-comm-type]")),
  teamCommFeed: document.getElementById("teamCommFeed"),
  mobileTeamCommPanel: document.getElementById("mobileTeamCommPanel"),
  mobileTeamCommButtons: Array.from(document.querySelectorAll("#mobileTeamCommButtons [data-comm-type]")),
  mobileTeamCommFeed: document.getElementById("mobileTeamCommFeed"),
  fleetRows: Array.from(document.querySelectorAll("#fleetRoster .fleet-row")).map((row) => ({
    row,
    key: row.dataset.ship,
    name: row.querySelector(".fleet-name"),
    state: row.querySelector(".fleet-state"),
    hullFill: row.querySelector(".fleet-fill-hull"),
    hullPct: row.querySelector(".fleet-pct-hull"),
    enFill: row.querySelector(".fleet-fill-energy"),
    enPct: row.querySelector(".fleet-pct-energy"),
  })),
  overlay: document.getElementById("overlay"),
  overlayTitle: document.getElementById("overlayTitle"),
  overlayActionBtn: document.getElementById("overlayActionBtn"),
  lobbyView: document.getElementById("lobbyView"),
  battleView: document.getElementById("battleView"),
  mobileBattleHud: document.getElementById("mobileBattleHud"),
  mobileBattleSummary: document.getElementById("mobileBattleSummary"),
  mobileBattleHint: document.getElementById("mobileBattleHint"),
  mobileCenterBtn: document.getElementById("mobileCenterBtn"),
  mobileZoomOutBtn: document.getElementById("mobileZoomOutBtn"),
  mobileZoomInBtn: document.getElementById("mobileZoomInBtn"),
  mobileShipButtons: Array.from(document.querySelectorAll("#mobileShipSwitch .mobile-ship-btn")),
  mobileSplitOneBtn: document.getElementById("mobileSplitOneBtn"),
  mobileSplitTwoBtn: document.getElementById("mobileSplitTwoBtn"),
  mobileScoutBtn: document.getElementById("mobileScoutBtn"),
  mobileAutoScoutBtn: document.getElementById("mobileAutoScoutBtn"),
  mobileBrakeBtn: document.getElementById("mobileBrakeBtn"),
  mobileFlagshipBtn: document.getElementById("mobileFlagshipBtn"),
  mobileSubSkillBtn: document.getElementById("mobileSubSkillBtn"),
  mobileThrottleButtons: Array.from(document.querySelectorAll("#mobileBattleHud .mobile-throttle-btn")),
  };
  // 「选中」字段已从对战面板移除（信息与切舰按钮/滑块重复）；占位对象吞掉文本写入
  if (!ui.selectedValue) ui.selectedValue = {};
}

const TAU = Math.PI * 2;
// 逻辑世界尺寸:与单人/服务端共用 DEFAULT_WORLD_SIZE(权威=单人的 1440),三端不一致会导致
// 客户端视野只覆盖世界一角或地图被裁。坐标运算都在此空间,与画布物理像素解耦;
// backing store 按设备像素铺满显示区,渲染时整体放大保清晰。
const LOGICAL = DEFAULT_WORLD_SIZE;
const DEFAULT_INTERP_MS = 120;
const MIN_INTERP_MS = 75;
const MAX_INTERP_MS = 280;
const MAX_EXTRAPOLATE_MS = 180;
const SNAPSHOT_HISTORY_SECONDS = 6;
const PING_INTERVAL_MS = 1000;
const DRAG_SEND_INTERVAL_MS = 75;
const REMOTE_WS_PORT = 21246;
const ROUTE_OVERRIDE_MIN_HOLD_MS = 180;
const ROUTE_OVERRIDE_MAX_HOLD_MS = 1200;
const ROUTE_MATCH_P2_EPSILON = 30;
const ROUTE_MATCH_P1_EPSILON = 42;
const NICKNAME_COOKIE_KEY = "haruhi_online_nickname";
const NICKNAME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const ONLINE_LOADOUT_STORAGE_KEY = "haruhi-online-loadout-v2";
const ONLINE_RECONNECT_STORAGE_KEY = "haruhi-online-reconnect-v1";
const ONLINE_RECONNECT_TICKET_TTL_MS = 45_000;
const TEAM_COMM_POINT_TYPES = Object.freeze(["attack", "support", "danger", "retreat"]);
const TEAM_COMM_LABELS = Object.freeze({
  attack: "集火",
  support: "支援",
  danger: "危险",
  retreat: "撤退",
  ack: "收到",
  emoji: "漂亮",
});

function initApp() {
  app = {
  ws: null,
  connected: false,
  playerId: null,
  room: null,
  seat: null,
  allianceId: null,
  ready: false,
  spectating: false,
  fleetDefeated: false,
  canControlFleet: true,
  seq: 0,
  ackSeq: 0,
  selectedShipKey: "main",
  selectedZoneId: 5,
  throttle: 1,
  pingMs: 0,
  jitterMs: 0,
  interpDelayMs: DEFAULT_INTERP_MS,
  pingTimer: null,
  pingSeq: 0,
  pendingPings: new Map(),
  rttVarianceMs: 0,
  bestClockRttMs: Infinity,
  clockOffsetMs: 0,
  clockReady: false,
  serverTickRate: 30,
  serverSnapshotRate: 20,
  snapshotIntervalMs: 1000 / 20,
  snapshots: [],
  latestSnapshot: null,
  lastSnapshotTick: 0,
  lastSnapshotSeq: 0,
  lastSnapshotArriveAtMs: 0,
  snapshotArrivalMs: 0,
  snapshotArrivalJitterMs: 0,
  snapshotLossRatio: 0,
  snapshotReorderRatio: 0,
  smoothEntities: new Map(),
  lastRenderMs: 0,
  routeOverrides: new Map(),
  teamComms: [],
  reconnectTicket: null,
  drag: null,
  suppressClick: false,
  lastRenderState: null,
  lastMatchPhase: null,
  pendingSubSkillAim: null,
  destructionEffects: createShipDestructionEffects(),
  lastWinnerSeat: null,
  gameOverLogged: false,
  connectAttemptId: 0,
  playerLoadout: readStoredLoadout(),
  pointer: { x: LOGICAL * 0.5, y: LOGICAL * 0.5 },
  throttleSendTimer: null,
  mobileMode: false,
  stars: Array.from({ length: 260 }, () => ({
    x: Math.random() * LOGICAL,
    y: Math.random() * LOGICAL,
    r: Math.random() * 1.6 + 0.4,
    p: Math.random() * TAU,
  })),
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpNumber(a, b, t, fallback = 0) {
  const av = Number(a);
  const bv = Number(b);
  if (Number.isFinite(av) && Number.isFinite(bv)) {
    return lerp(av, bv, t);
  }
  if (Number.isFinite(bv)) {
    return bv;
  }
  if (Number.isFinite(av)) {
    return av;
  }
  return fallback;
}

function distance(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

function shortestAngleDelta(from, to) {
  let delta = (to - from + Math.PI) % TAU;
  if (delta < 0) {
    delta += TAU;
  }
  return delta - Math.PI;
}

function clampToMapX(x, padding = 0) {
  return clamp(x, padding, LOGICAL - padding);
}

function clampToMapY(y, padding = 0) {
  return clamp(y, padding, LOGICAL - padding);
}

function nowSecond() {
  return performance.now() / 1000;
}

function nowMs() {
  return Date.now();
}

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
    if (!token.startsWith(target)) {
      continue;
    }
    return decodeURIComponent(token.slice(target.length));
  }
  return "";
}

function writeCookie(key, value, maxAgeSeconds) {
  const secureFlag = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${key}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax${secureFlag}`;
}

// 编队读写统一走玩家档案（src/profile.js），与单机/调试模式共享同一份身份数据
function readStoredLoadout() {
  return getLoadout();
}

function storeLoadout(loadout) {
  setLoadout(loadout);
}

function normalizeReconnectTicket(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const roomId = String(value.roomId || "").trim();
  const seat = String(value.seat || "").trim().toUpperCase();
  const reconnectToken = String(value.reconnectToken || "").trim();
  const expiresAt = Number(value.expiresAt) || 0;
  if (!roomId || !seat || !reconnectToken) {
    return null;
  }
  if (expiresAt && expiresAt <= nowMs()) {
    return null;
  }
  return {
    roomId,
    seat,
    reconnectToken,
    expiresAt,
  };
}

function readReconnectTicket() {
  try {
    const raw = window.sessionStorage ? window.sessionStorage.getItem(ONLINE_RECONNECT_STORAGE_KEY) : "";
    if (!raw) {
      return null;
    }
    const ticket = normalizeReconnectTicket(JSON.parse(raw));
    if (!ticket) {
      clearReconnectTicket();
    }
    return ticket;
  } catch (_error) {
    clearReconnectTicket();
    return null;
  }
}

function clearReconnectTicket() {
  app.reconnectTicket = null;
  try {
    if (window.sessionStorage) {
      window.sessionStorage.removeItem(ONLINE_RECONNECT_STORAGE_KEY);
    }
  } catch (_error) {
    // Storage can be unavailable in private contexts.
  }
}

function persistReconnectTicket(message) {
  const room = message && message.room ? message.room : null;
  const self = message && message.self ? message.self : null;
  if (!room || room.mode !== "pvp2v2" || room.status === "finished" || !self || self.spectating || !self.seat || !self.reconnectToken) {
    if (room && (room.mode !== "pvp2v2" || room.status === "finished")) {
      clearReconnectTicket();
    }
    return null;
  }
  const ticket = {
    roomId: String(room.roomId || ""),
    seat: String(self.seat || "").toUpperCase(),
    reconnectToken: String(self.reconnectToken || ""),
    expiresAt: nowMs() + ONLINE_RECONNECT_TICKET_TTL_MS,
  };
  const normalized = normalizeReconnectTicket(ticket);
  if (!normalized) {
    return null;
  }
  app.reconnectTicket = normalized;
  try {
    if (window.sessionStorage) {
      window.sessionStorage.setItem(ONLINE_RECONNECT_STORAGE_KEY, JSON.stringify(normalized));
    }
  } catch (_error) {
    // Storage failure should not break the live match.
  }
  return normalized;
}

function tryResumePlayer() {
  const ticket = readReconnectTicket();
  if (!ticket) {
    return false;
  }
  return socketSend({
    type: "resume_player",
    roomId: ticket.roomId,
    seat: ticket.seat,
    reconnectToken: ticket.reconnectToken,
  });
}

function syncProfileAfterConnect() {
  const name = setNickname(ui.playerNameInput ? ui.playerNameInput.value : "", { persist: true });
  if (name) {
    socketSend({ type: "set_name", name });
  }
  socketSend({ type: "set_loadout", loadout: app.playerLoadout });
  socketSend({ type: "list_rooms" });
}

function roleSlotLabel(slotKey) {
  return localizedSlotLabel(slotKey);
}

function roleSummaryLine(slotKey, characterId) {
  const def = CHARACTER_DEFS[characterId];
  const stat = def.stats;
  return `${roleSlotLabel(slotKey)} ${def.shortName} | ${t("舰体")}${stat.hp} | ${t("能量")}${stat.energy} | ${t("航速")}${stat.speed} | ${t("机动")}${stat.turnRate.toFixed(2)}`;
}

function renderLoadoutPreview(loadout) {
  if (!ui.onlineLoadoutPreview) {
    return;
  }
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
  if (ui.onlineMainRole) {
    ui.onlineMainRole.value = loadout.main;
  }
  if (ui.onlineSub1Role) {
    ui.onlineSub1Role.value = loadout.sub1;
  }
  if (ui.onlineSub2Role) {
    ui.onlineSub2Role.value = loadout.sub2;
  }
  renderLoadoutPreview(loadout);
  updateShipSwitchLabels(loadout);
}

function populateLoadoutControls() {
  for (const select of [ui.onlineMainRole, ui.onlineSub1Role, ui.onlineSub2Role]) {
    if (!select) {
      continue;
    }
    select.innerHTML = "";
    for (const characterId of CHARACTER_ORDER) {
      const def = CHARACTER_DEFS[characterId];
      const option = document.createElement("option");
      option.value = characterId;
      option.textContent = `${def.shortName} · ${def.title}`;
      select.append(option);
    }
  }
  syncLoadoutControls(app.playerLoadout);
}

function readLoadoutFromControls() {
  return normalizeLoadout(
    {
      main: ui.onlineMainRole ? ui.onlineMainRole.value : app.playerLoadout.main,
      sub1: ui.onlineSub1Role ? ui.onlineSub1Role.value : app.playerLoadout.sub1,
      sub2: ui.onlineSub2Role ? ui.onlineSub2Role.value : app.playerLoadout.sub2,
    },
    DEFAULT_TEAM_LOADOUT,
  );
}

function updateNicknameDisplay(name) {
  if (!ui.onlineNicknameValue) {
    return;
  }
  ui.onlineNicknameValue.textContent = t("昵称：{name}", { name: name || "-" });
}

function setNickname(name, options = {}) {
  const { persist = true } = options;
  const safeName = sanitizeNickname(name);
  if (ui.playerNameInput) {
    ui.playerNameInput.value = safeName;
  }
  updateNicknameDisplay(safeName);
  if (persist && safeName) {
    setProfileNickname(safeName); // 写入统一档案，主菜单与其他模式同步
    writeCookie(NICKNAME_COOKIE_KEY, safeName, NICKNAME_COOKIE_MAX_AGE); // 兼容旧版
  }
  return safeName;
}

function log(message) {
  // 日志面板已被「全队舰况」取代；保留函数让各处事件调用安全空转
  if (!ui.onlineLog) {
    return;
  }
  const row = document.createElement("div");
  const time = formatClockTime();
  row.textContent = `[${time}] ${message}`;
  ui.onlineLog.prepend(row);
  while (ui.onlineLog.children.length > 40) {
    ui.onlineLog.removeChild(ui.onlineLog.lastChild);
  }
}

function updateConnectionUi() {
  ui.connectionValue.textContent = app.connected ? t("已连接") : t("未连接");
  ui.pingValue.textContent = app.connected ? `${Math.round(app.pingMs)}ms` : "-";
  ui.jitterValue.textContent = app.connected ? `${Math.round(app.jitterMs)}ms` : "-";
  ui.interpValue.textContent = app.connected ? `${Math.round(app.interpDelayMs)}ms` : "-";

  ui.connectBtn.disabled = app.connected;
  ui.disconnectBtn.disabled = !app.connected;
}

function setBattleControlsEnabled(enabled) {
  ui.battleControls.classList.toggle("disabled-panel", !enabled);
  for (const element of ui.battleControls.querySelectorAll("button, select, input")) {
    element.disabled = !enabled;
  }
  if (ui.mobileBattleHud) {
    ui.mobileBattleHud.hidden = !app.mobileMode || !enabled;
  }
}

function updateReadyRoomButton() {
  if (!ui.readyRoomBtn) {
    return;
  }
  const visible = Boolean(isTwoVsTwoRoom() && app.room.status === "waiting" && app.seat && !app.spectating);
  ui.readyRoomBtn.hidden = !visible;
  ui.readyRoomBtn.disabled = !visible || !app.connected;
  ui.readyRoomBtn.textContent = app.ready ? t("取消准备") : t("准备");
}

// 大厅页与战斗页二选一全屏切换（visible=true 显示独立大厅页，false 显示战斗页）
function setRoomHudVisible(visible) {
  if (ui.lobbyView) ui.lobbyView.hidden = !visible;
  if (ui.battleView) ui.battleView.hidden = visible;
  syncOnlineFluidBackdrop(visible);
}

function destroyOnlineFluidBackdrop() {
  routeFluidBackdrop?.destroy();
  routeFluidBackdrop = null;
  routeFluidMode = "";
}

function syncOnlineFluidBackdrop(showLobby) {
  const nextMode = showLobby ? "lobby" : "battle";
  if (routeFluidBackdrop && routeFluidMode === nextMode) return;

  destroyOnlineFluidBackdrop();
  if (showLobby && ui.lobbyView) {
    routeFluidBackdrop = mountRouteFluidBackdrop(ui.lobbyView, {
      logLabel: "Online lobby fluid backdrop",
      onReady: () => lobbyStarfieldAc?.abort(),
    });
    routeFluidMode = nextMode;
  } else if (!showLobby && ui.battleView) {
    routeFluidBackdrop = mountRouteFluidBackdrop(ui.battleView, {
      cursorRing: false,
      logLabel: "Online battle fluid backdrop",
    });
    routeFluidMode = nextMode;
  }
}

function localizedServerName(name, isBot = false) {
  const raw = String(name || "").trim();
  if (!raw || isBot || raw === "空位" || raw === "统合思念体AI") {
    return translateServerText(raw || "空位");
  }
  return raw;
}

function socketSend(payload) {
  if (!app.ws || app.ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  app.ws.send(JSON.stringify(payload));
  return true;
}

function isSpectatorMode() {
  return Boolean(app && app.spectating);
}

function teamHasAliveShips(team) {
  if (!team || !team.ships) {
    return false;
  }
  return Object.values(team.ships).some((ship) => ship && ship.alive);
}

function defeatedObservationTeam(state) {
  const ownTeam = teamBySeat(state, app.seat);
  if (!app.fleetDefeated || !isTwoVsTwoState(state)) {
    return ownTeam;
  }
  const allianceId = app.allianceId || allianceIdForSeatClient(app.seat);
  return fleetEntriesForAlliance(state, allianceId).find((team) => team && team.seat !== app.seat && teamHasAliveShips(team))
    || fleetEntriesForAlliance(state, allianceId).find((team) => team && teamHasAliveShips(team))
    || ownTeam;
}

function applyViewerControlState(state) {
  if (isTwoVsTwoState(state) && state.viewer && app.seat && !app.spectating) {
    app.fleetDefeated = Boolean(state.viewer.fleetDefeated);
    app.canControlFleet = state.viewer.canControlFleet !== false && !app.fleetDefeated;
  } else {
    app.fleetDefeated = false;
    app.canControlFleet = true;
  }
  setBattleControlsEnabled(Boolean(app.room && app.room.status === "running" && !app.spectating && app.canControlFleet));
}

function isTwoVsTwoRoom(room = app ? app.room : null) {
  return Boolean(room && room.mode === "pvp2v2");
}

function isTwoVsTwoState(state) {
  return Boolean(state && state.fleets);
}

function allianceIdForSeatClient(seat) {
  return String(seat || "").startsWith("B") ? "B" : "A";
}

function enemyAllianceIdClient(allianceId) {
  return allianceId === "A" ? "B" : "A";
}

function roomModeLabel(mode) {
  if (mode === "ai") {
    return t("AI 训练");
  }
  if (mode === "pvp2v2") {
    return t("2v2 对战");
  }
  return t("玩家对战");
}

function roomTitleLabel(mode) {
  if (mode === "ai") {
    return t("AI房");
  }
  if (mode === "pvp2v2") {
    return t("2v2 对战房");
  }
  return t("玩家对战房");
}

function seatLabelForRoomSeat(seat) {
  if (seat === "A") {
    return t("A位");
  }
  if (seat === "B") {
    return t("B位");
  }
  if (seat === "A1" || seat === "A2" || seat === "B1" || seat === "B2") {
    return `${seat} / ${t("阵营 {alliance}", { alliance: allianceIdForSeatClient(seat) })}`;
  }
  return seat || "-";
}

function canControlBattle() {
  return Boolean(app && app.connected && app.room && app.room.status === "running" && app.seat && !app.spectating);
}

function validShipKey(shipKey) {
  return shipKey === "main" || shipKey === "sub1" || shipKey === "sub2" ? shipKey : "main";
}

function selectedShipKeyForSeat(state, seat) {
  const selectedShips = state && state.selectedShips ? state.selectedShips : null;
  return validShipKey(selectedShips && selectedShips[seat] ? selectedShips[seat] : "main");
}

function fleetEntriesForAlliance(state, allianceId) {
  if (!state) {
    return [];
  }
  if (isTwoVsTwoState(state)) {
    return Object.values(state.fleets || {}).filter((fleet) => {
      if (!fleet) {
        return false;
      }
      return (fleet.allianceId || allianceIdForSeatClient(fleet.seat)) === allianceId;
    });
  }
  if (!state.teams) {
    return [];
  }
  if (allianceId === "A") {
    return state.teams.A ? [state.teams.A] : [];
  }
  if (allianceId === "B") {
    return state.teams.B ? [state.teams.B] : [];
  }
  return [];
}

function visibleEnemyIdSetForTeams(teams) {
  const ids = new Set();
  for (const team of teams || []) {
    for (const id of team?.visibleEnemyIds || []) {
      ids.add(id);
    }
  }
  return ids;
}

function teamCommLabel(commType) {
  return TEAM_COMM_LABELS[commType] || commType || t("标记");
}

function teamCommNeedsPointClient(commType) {
  return TEAM_COMM_POINT_TYPES.includes(commType);
}

function pruneTeamComms(now = nowMs()) {
  app.teamComms = (app.teamComms || []).filter((event) => Number(event.expiresAt || 0) > now);
  if (app.teamComms.length > 24) {
    app.teamComms.splice(0, app.teamComms.length - 24);
  }
}

function activeTeamComms() {
  pruneTeamComms();
  return app.teamComms;
}

function renderTeamCommFeedInto(feed) {
  if (!feed) {
    return;
  }
  pruneTeamComms();
  feed.innerHTML = "";
  const recent = [...app.teamComms].slice(-5).reverse();
  if (recent.length === 0) {
    const empty = document.createElement("div");
    empty.className = "team-comm-empty";
    empty.textContent = t("暂无队内消息");
    feed.append(empty);
    return;
  }
  for (const event of recent) {
    const row = document.createElement("div");
    row.className = `team-comm-row team-comm-${event.commType || "mark"}`;
    const anchorText = event.anchor
      ? ` · ${Math.round(event.anchor.x)},${Math.round(event.anchor.y)}`
      : "";
    row.textContent = `${event.senderSeat || "-"} ${teamCommLabel(event.commType)}${anchorText}`;
    feed.append(row);
  }
}

function renderTeamCommFeed() {
  renderTeamCommFeedInto(ui.teamCommFeed);
  renderTeamCommFeedInto(ui.mobileTeamCommFeed);
}

function updateTeamCommUi() {
  if (!ui.teamCommPanel && !ui.mobileTeamCommPanel) {
    return;
  }
  const visible = Boolean(isTwoVsTwoRoom() && app.seat && !app.spectating);
  const enabled = Boolean(visible && app.connected && app.room && app.room.status !== "finished");
  if (ui.teamCommPanel) {
    ui.teamCommPanel.hidden = !visible;
  }
  if (ui.mobileTeamCommPanel) {
    ui.mobileTeamCommPanel.hidden = !visible;
  }
  for (const button of [...(ui.teamCommButtons || []), ...(ui.mobileTeamCommButtons || [])]) {
    button.disabled = !enabled;
  }
  renderTeamCommFeed();
}

function sendSelectedShipUpdate() {
  if (!canControlBattle()) {
    return;
  }
  socketSend({
    type: "select_ship",
    shipKey: app.selectedShipKey,
  });
}

function bindPressButton(button, handler) {
  if (!button) {
    return;
  }
  // 指针按下即响应;紧随其后的合成 click 用「标志位」可靠吞掉——触摸设备上该 click 可能延迟到达
  // (尤其按住略久),不能只靠时间窗,否则 handler 会被触发两次。对「瞄准/原地释放」这类切换技尤其致命:
  // 一次点按会先进瞄准态又立刻原地释放(如古泉闪现在移动端无法正常瞄准即源于此)。
  let swallowClick = false;
  let swallowTimer = 0;
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || button.disabled) {
      return;
    }
    swallowClick = true;
    clearTimeout(swallowTimer);
    swallowTimer = setTimeout(() => { swallowClick = false; }, 700); // 兜底:合成 click 始终没来也不永久吞
    event.preventDefault();
    handler();
  });
  button.addEventListener("click", (event) => {
    if (swallowClick) {
      swallowClick = false;
      clearTimeout(swallowTimer);
      event.preventDefault();
      return;
    }
    if (button.disabled) {
      return;
    }
    handler(); // 无前置 pointerdown 的原生 click(如键盘 Enter/Space 激活按钮)
  });
}

function defaultServerUrl() {
  const urls = buildServerUrlCandidates();
  return urls[0] || "";
}

function isLocalHostname(hostname) {
  if (!hostname) {
    return false;
  }
  const host = String(hostname).toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
    return true;
  }
  if (host.startsWith("10.") || host.startsWith("192.168.") || host.endsWith(".local")) {
    return true;
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) {
    return true;
  }
  return false;
}

function buildServerUrlCandidates() {
  const params = new URLSearchParams(window.location.search);
  const forced = String(params.get("ws") || "").trim();
  if (forced) {
    return [forced];
  }

  const pageProtocol = window.location.protocol === "https:" ? "wss" : "ws";
  const pageHost = window.location.host || "";
  const pageHostname = window.location.hostname || "";
  const localHost = isLocalHostname(pageHostname);
  const directProtocol = localHost ? "ws" : pageProtocol;
  const list = [];

  if (pageHost) {
    // 同源 WS：跟随部署 base（线上 /test-game/ → /test-game/ws/；dev / → /ws/）
    list.push(`${pageProtocol}://${pageHost}${import.meta.env.BASE_URL}ws/`);
  }
  if (pageHostname) {
    list.push(`${directProtocol}://${pageHostname}:${REMOTE_WS_PORT}/`);
  } else {
    list.push(`ws://127.0.0.1:${REMOTE_WS_PORT}/`);
  }
  if (localHost) {
    if (pageHostname !== "127.0.0.1") {
      list.push(`ws://127.0.0.1:${REMOTE_WS_PORT}/`);
    }
    if (pageHostname !== "localhost") {
      list.push(`ws://localhost:${REMOTE_WS_PORT}/`);
    }
  }

  const dedup = [];
  for (const url of list) {
    if (!url || dedup.includes(url)) {
      continue;
    }
    dedup.push(url);
  }
  return dedup;
}

function resetConnectionSyncState() {
  app.pingMs = 0;
  app.jitterMs = 0;
  app.interpDelayMs = DEFAULT_INTERP_MS;
  app.pingSeq = 0;
  app.pendingPings.clear();
  app.rttVarianceMs = 0;
  app.bestClockRttMs = Infinity;
  app.clockOffsetMs = 0;
  app.clockReady = false;
  app.serverTickRate = 30;
  app.serverSnapshotRate = 20;
  app.snapshotIntervalMs = 1000 / app.serverSnapshotRate;
}

function sendPingProbe() {
  if (!app.connected) {
    return;
  }
  app.pingSeq += 1;
  const pingId = app.pingSeq;
  const clientTime = nowMs();
  app.pendingPings.set(pingId, clientTime);
  if (app.pendingPings.size > 40) {
    const oldestKey = app.pendingPings.keys().next().value;
    if (oldestKey !== undefined) {
      app.pendingPings.delete(oldestKey);
    }
  }
  socketSend({
    type: "ping",
    pingId,
    clientTime,
  });
}

function startPingLoop() {
  stopPingLoop();
  sendPingProbe();
  app.pingTimer = window.setInterval(sendPingProbe, PING_INTERVAL_MS);
}

function stopPingLoop() {
  if (app.pingTimer) {
    clearInterval(app.pingTimer);
    app.pingTimer = null;
  }
  app.pendingPings.clear();
}

function clearMatchRuntime() {
  app.snapshots = [];
  app.latestSnapshot = null;
  app.lastSnapshotTick = 0;
  app.lastSnapshotSeq = 0;
  app.lastSnapshotArriveAtMs = 0;
  app.snapshotArrivalMs = 0;
  app.snapshotArrivalJitterMs = 0;
  app.snapshotLossRatio = 0;
  app.snapshotReorderRatio = 0;
  app.smoothEntities.clear();
  app.lastRenderMs = 0;
  app.routeOverrides.clear();
  app.teamComms = [];
  app.fleetDefeated = false;
  app.canControlFleet = true;
  app.drag = null;
  app.lastRenderState = null;
  app.lastMatchPhase = null;
  camera.reset();
  app.ackSeq = 0;
  app.pendingSubSkillAim = null;
  resetShipDestructionEffects(app.destructionEffects);
  renderTeamCommFeed();
  app.lastWinnerSeat = null;
  app.gameOverLogged = false;
  if (app.throttleSendTimer) {
    clearTimeout(app.throttleSendTimer);
    app.throttleSendTimer = null;
  }
}

function closeOverlay() {
  ui.overlay.classList.add("hidden");
  ui.overlayTitle.textContent = "";
  app.gameOverLogged = false;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[ch]);
}

function resultPlayerId(row) {
  if (!row) {
    return "-";
  }
  if (row.isBot) {
    return "AI";
  }
  const raw = String(row.playerId || "").trim();
  return raw ? raw.slice(0, 8) : "-";
}

function resultWinnerText(winnerSeat) {
  return winnerSeat ? fleetSideLabel(winnerSeat) : t("平局");
}

// 一侧阵容(主舰高亮 + 两副舰):头像取阵营立绘;在线 own=蓝队、enemy=红队,与战场着色一致
function onlineResultSideHTML(loadout, faction, sideLabel, sideClass, sideId = "") {
  const base = import.meta.env.BASE_URL;
  const safe = normalizeLoadout(loadout, DEFAULT_TEAM_LOADOUT);
  const cards = ["main", "sub1", "sub2"]
    .map((slot, i) => {
      const id = safe[slot];
      const src = `${base}assets/portraits/${faction}/${id}.webp`;
      const role = localizedSlotLabel(slot, "short");
      const name = characterShortName(id, CHARACTER_DEFS[id] ? CHARACTER_DEFS[id].shortName : id);
      return (
        `<div class="rl-card${slot === "main" ? " rl-main" : ""}" style="--i:${i}">` +
        `<span class="rl-portrait"><img src="${src}" alt="" loading="lazy" draggable="false"></span>` +
        `<span class="rl-role">${escapeHtml(role)}</span>` +
        `<span class="rl-name">${escapeHtml(name)}</span>` +
        `</div>`
      );
    })
    .join("");
  return (
    `<div class="result-side ${sideClass}">` +
    `<div class="result-side-label">${escapeHtml(sideLabel)}</div>` +
    `<div class="result-side-id">${t("ID：{id}", { id: escapeHtml(sideId || "-") })}</div>` +
    `<div class="rl-cards">${cards}</div>` +
    `</div>`
  );
}

// 胜负结算:皮面富卡片(标题 + 双方阵容 VS),与单人同款;磨砂层只作卡片背景,不再裸罩地图/面板。
// 每条 finished 房态消息都会调用,故首次渲染后用 gameOverLogged 锁住,避免反复重建与重放入场动画。
function showMatchResultOverlay(winnerSeat) {
  app.lastWinnerSeat = winnerSeat || null;
  ui.overlay.classList.remove("hidden");
  if (app.gameOverLogged) {
    return;
  }
  app.gameOverLogged = true;

  const card = document.getElementById("resultCard");
  const eyebrowEl = document.getElementById("resultEyebrow");
  const subEl = document.getElementById("resultSub");
  const metaEl = document.getElementById("resultDiff");
  const versusEl = document.getElementById("resultVersus");

  let cls, eyebrow, title, sub, logLine;
  if (app.spectating) {
    const winnerName = winnerSeat ? fleetSideLabel(winnerSeat) : "";
    cls = "result-draw";
    eyebrow = "SPECTATE";
    title = winnerName ? t("{seat}获胜", { seat: winnerName }) : t("战斗结束");
    sub = t("观战结束");
    logLine = winnerName ? t("战斗结束：{seat}获胜", { seat: winnerName }) : t("战斗结束：平局");
  } else if (winnerSeat && winnerSeat === app.seat) {
    cls = "result-win"; eyebrow = "VICTORY"; title = t("胜利"); sub = t("敌方舰队已被击溃");
    logLine = t("战斗结束：我方舰队获胜");
  } else if (winnerSeat) {
    cls = "result-lose"; eyebrow = "DEFEAT"; title = t("失败"); sub = t("我方舰队被歼灭");
    logLine = t("战斗结束：我方舰队战败");
  } else {
    cls = "result-draw"; eyebrow = "STALEMATE"; title = t("战斗结束"); sub = t("双方同归于尽");
    logLine = t("战斗结束：平局");
  }

  if (card) {
    card.classList.remove("result-win", "result-lose", "result-draw");
    card.classList.add(cls);
  }
  if (eyebrowEl) eyebrowEl.textContent = eyebrow;
  ui.overlayTitle.textContent = title;
  if (subEl) subEl.textContent = sub;
  if (metaEl) {
    const roomId = app.room ? app.room.roomId : "-";
    const winnerText = resultWinnerText(winnerSeat);
    metaEl.innerHTML =
      `<span class="result-diff-label">${t("房间ID")}</span>` +
      `<span class="result-diff-val rd-normal">${escapeHtml(roomId)}</span>` +
      `<span class="result-diff-label">${t("胜利方")}</span>` +
      `<span class="result-diff-val ${winnerSeat ? "rd-normal" : "rd-hard"}">${escapeHtml(winnerText)}</span>`;
  }

  // 双方阵容固定按 A/B 展示，保证对战双方与观战者看到同一张结算卡。
  if (versusEl) {
    const players = (app.room && app.room.players) || [];
    const rowA = players.find((p) => p.seat === "A");
    const rowB = players.find((p) => p.seat === "B");
    const loadoutA = (rowA && rowA.loadout) || app.playerLoadout;
    const loadoutB = rowB && rowB.loadout;
    const nameA = (rowA && localizedServerName(rowA.name, rowA.isBot)) || fleetSideLabel("A");
    const nameB = (rowB && localizedServerName(rowB.name, rowB.isBot)) || fleetSideLabel("B");
    versusEl.innerHTML =
      onlineResultSideHTML(loadoutA, "blue", nameA, "result-side-player", resultPlayerId(rowA)) +
      `<div class="result-vs"><span>VS</span></div>` +
      onlineResultSideHTML(loadoutB, "red", nameB, "result-side-enemy", resultPlayerId(rowB));
  }

  // 重新触发入场动画
  if (card) {
    card.classList.remove("result-in");
    void card.offsetWidth;
    card.classList.add("result-in");
  }

  log(logLine);
}

function connectServer() {
  const candidates = buildServerUrlCandidates();
  if (candidates.length === 0) {
    log(t("服务器地址不能为空"));
    return;
  }
  ui.serverTargetValue.textContent = candidates[0];

  app.connectAttemptId += 1;
  const currentAttemptId = app.connectAttemptId;
  if (app.ws) {
    try {
      app.ws.close();
    } catch (_error) {
      // 忽略关闭错误
    }
  }

  resetConnectionSyncState();
  clearMatchRuntime();
  updateConnectionUi();

  const tryConnect = (index) => {
    if (currentAttemptId !== app.connectAttemptId) {
      return;
    }
    if (index >= candidates.length) {
      log(t("无法连接服务器：请确认本地 21246 或远程反向代理是否可用"));
      return;
    }

    const url = candidates[index];
    ui.serverTargetValue.textContent = url;

    let opened = false;
    const ws = new WebSocket(url);
    app.ws = ws;

    ws.addEventListener("open", () => {
      if (currentAttemptId !== app.connectAttemptId || app.ws !== ws) {
        return;
      }
      opened = true;
      app.connected = true;
      updateConnectionUi();
      log(t("已连接服务器：{url}", { url }));

      startPingLoop();
    });

    ws.addEventListener("close", () => {
      if (currentAttemptId !== app.connectAttemptId || app.ws !== ws) {
        return;
      }
      if (!opened && index < candidates.length - 1) {
        log(t("连接失败，尝试备用地址：{url}", { url: candidates[index + 1] }));
        tryConnect(index + 1);
        return;
      }

      app.connected = false;
      app.playerId = null;
      app.room = null;
      app.seat = null;
      app.allianceId = null;
      app.ready = false;
      app.spectating = false;
      updateRoomSummary();
      setBattleControlsEnabled(false);
      setRoomHudVisible(true);
      stopPingLoop();
      clearMatchRuntime();
      resetConnectionSyncState();
      closeOverlay();
      updateConnectionUi();
      log(t("连接已断开"));
    });

    ws.addEventListener("error", () => {
      if (currentAttemptId !== app.connectAttemptId || app.ws !== ws) {
        return;
      }
      if (opened) {
        log(t("连接异常，请检查服务器状态"));
      }
    });

    ws.addEventListener("message", (event) => {
      if (currentAttemptId !== app.connectAttemptId || app.ws !== ws) {
        return;
      }
      handleServerMessage(String(event.data || ""));
    });
  };

  tryConnect(0);
}

function disconnectServer() {
  app.connectAttemptId += 1;
  clearReconnectTicket();
  if (!app.ws) {
    return;
  }
  app.ws.close();
}

function updateRoomSummary() {
  if (!app.room) {
    ui.roomSummary.textContent = t("未进入房间");
    ui.leaveRoomBtn.disabled = true;
    app.ready = false;
    app.allianceId = null;
    updateReadyRoomButton();
    updateTeamCommUi();
    return;
  }

  const rows = [];
  rows.push(t("房间ID：{id}", { id: app.room.roomId }));
  rows.push(t("类型：{type}", { type: roomModeLabel(app.room.mode) }));
  rows.push(t("可见性：{visibility}", { visibility: app.room.visibility === "private" ? t("私人") : t("公开") }));
  if (app.room.visibility === "private" && app.room.code) {
    rows.push(t("房间号：{code}", { code: app.room.code }));
  }
  rows.push(t("状态：{status}", { status: roomStatusText(app.room.status) }));
  if (Number(app.room.spectatorCount) > 0 || app.spectating) {
    rows.push(t("观战：{count}", { count: Number(app.room.spectatorCount) || 0 }));
  }
  for (const playerRow of app.room.players || []) {
    const seatText = seatLabelForRoomSeat(playerRow.seat);
    const suffix = playerRow.isBot ? t("（AI）") : playerRow.disconnected ? t("（断线）") : "";
    const readyText = isTwoVsTwoRoom()
      ? playerRow.ready
        ? ` | ${t("已准备")}`
        : ` | ${t("未准备")}`
      : "";
    const displayName = localizedServerName(playerRow.name, playerRow.isBot);
    const loadoutText = playerRow.loadout
      ? ` | ${CHARACTER_DEFS[playerRow.loadout.main].shortName}/${CHARACTER_DEFS[playerRow.loadout.sub1].shortName}/${CHARACTER_DEFS[playerRow.loadout.sub2].shortName}`
      : "";
    rows.push(t("{seat}：{name}{suffix}{ready}{loadout}", { seat: seatText, name: displayName, suffix, ready: readyText, loadout: loadoutText }));
  }

  ui.roomSummary.textContent = rows.join("\n");
  ui.leaveRoomBtn.disabled = false;
  updateReadyRoomButton();
}

function roomStatusText(status) {
  if (status === "waiting") {
    return t("等待玩家");
  }
  if (status === "running") {
    return t("对战中");
  }
  if (status === "countdown") {
    return t("即将开战");
  }
  if (status === "finished") {
    return t("已结束");
  }
  return t("未知");
}

function updateInterpolationDelay() {
  const baseBufferMs = Math.max(MIN_INTERP_MS, app.snapshotIntervalMs * 1.35);
  const latencyBudget = app.pingMs * 0.22;
  const jitterBudget = Math.max(app.rttVarianceMs, app.snapshotArrivalJitterMs, app.jitterMs) * 1.6;
  const lossBudget = app.snapshotLossRatio * app.snapshotIntervalMs * 1.6;
  const reorderBudget = app.snapshotReorderRatio * app.snapshotIntervalMs * 1.1;
  const target = baseBufferMs + latencyBudget + jitterBudget + lossBudget + reorderBudget + 20;
  const minDelay = Math.max(MIN_INTERP_MS, app.snapshotIntervalMs * 1.05);
  const maxDelay = Math.max(MAX_INTERP_MS, app.snapshotIntervalMs * 4.5);
  app.interpDelayMs = clamp(lerp(app.interpDelayMs, target, 0.28), minDelay, maxDelay);
  updateConnectionUi();
}

function handlePong(message) {
  const recvClientMs = nowMs();
  const pingId = Number(message.pingId);
  const fallbackSentMs = Number(message.clientTime) || 0;
  let sentClientMs = fallbackSentMs;
  if (Number.isInteger(pingId) && app.pendingPings.has(pingId)) {
    sentClientMs = app.pendingPings.get(pingId);
    app.pendingPings.delete(pingId);
  }
  if (!sentClientMs) {
    return;
  }
  const rtt = recvClientMs - sentClientMs;
  if (!Number.isFinite(rtt) || rtt <= 0 || rtt > 5000) {
    return;
  }

  if (!Number.isFinite(app.pingMs) || app.pingMs <= 0) {
    app.pingMs = rtt;
  } else {
    app.rttVarianceMs = lerp(app.rttVarianceMs, Math.abs(rtt - app.pingMs), 0.22);
    app.pingMs = lerp(app.pingMs, rtt, 0.28);
  }

  const serverRecvMs = Number(message.serverRecvTime);
  const serverSendMs = Number(message.serverSendTime);
  const serverTimeMs = Number(message.serverTime);
  let offsetSample = null;
  if (Number.isFinite(serverRecvMs) && Number.isFinite(serverSendMs)) {
    offsetSample = ((serverRecvMs - sentClientMs) + (serverSendMs - recvClientMs)) * 0.5;
  } else if (Number.isFinite(serverTimeMs)) {
    offsetSample = serverTimeMs + rtt * 0.5 - recvClientMs;
  }

  if (Number.isFinite(offsetSample)) {
    app.bestClockRttMs = Math.min(app.bestClockRttMs + 0.2, rtt);
    if (!app.clockReady) {
      app.clockOffsetMs = offsetSample;
      app.clockReady = true;
    } else {
      const tightSample = rtt <= app.bestClockRttMs + 8;
      const alpha = tightSample ? 0.2 : 0.06;
      app.clockOffsetMs = lerp(app.clockOffsetMs, offsetSample, alpha);
    }
  }

  app.jitterMs = lerp(app.jitterMs, Math.max(app.rttVarianceMs, app.snapshotArrivalJitterMs), 0.18);
  updateInterpolationDelay();
}

function handleConnected(message) {
  app.playerId = message.playerId || null;
  const build = String(message.build || "").trim();
  if (build) {
    log(t("服务器版本：{build}", { build }));
  } else {
    log(t("服务器版本信息缺失，可能仍在运行旧版服务端"));
  }
  const tickRate = Number(message.tickRate);
  const snapshotRate = Number(message.snapshotRate);
  const snapshotIntervalMs = Number(message.snapshotIntervalMs);
  if (Number.isFinite(tickRate) && tickRate >= 5) {
    app.serverTickRate = tickRate;
  }
  if (Number.isFinite(snapshotRate) && snapshotRate >= 2) {
    app.serverSnapshotRate = snapshotRate;
    app.snapshotIntervalMs = 1000 / app.serverSnapshotRate;
  } else if (Number.isFinite(snapshotIntervalMs) && snapshotIntervalMs >= 15) {
    app.snapshotIntervalMs = snapshotIntervalMs;
  }

  const serverTime = Number(message.serverTime);
  if (Number.isFinite(serverTime)) {
    app.clockOffsetMs = serverTime - nowMs();
    app.clockReady = true;
  }
  updateInterpolationDelay();

  if (!tryResumePlayer()) {
    syncProfileAfterConnect();
  } else {
    socketSend({ type: "list_rooms" });
  }
}

function renderLobbyRooms(rooms) {
  ui.roomList.innerHTML = "";

  if (!rooms || rooms.length === 0) {
    const empty = document.createElement("div");
    empty.className = "room-item room-item-empty";
    empty.textContent = t("当前没有公开房，可先创建一个。");
    ui.roomList.append(empty);
    return;
  }

  for (const room of rooms) {
    const item = document.createElement("div");
    item.className = "room-item";

    const title = document.createElement("div");
    title.className = "room-item-title";
    title.textContent = `${roomTitleLabel(room.mode)} · ${room.roomId}`;

    const meta = document.createElement("div");
    meta.className = "room-item-meta";
    meta.textContent =
      t("房主：{host} | 人数：{count}/{capacity} | 状态：{status}", {
      host: room.hostName === "未知" ? t("未知") : room.hostName,
      count: room.count,
      capacity: room.capacity,
      status: roomStatusText(room.status),
      }) + ` | ${t("观战：{count}", { count: Number(room.spectatorCount) || 0 })}`;

    const joinBtn = document.createElement("button");
    joinBtn.textContent = t("加入");
    joinBtn.disabled = !app.connected || Boolean(app.room) || room.status !== "waiting" || room.count >= room.capacity;
    joinBtn.addEventListener("click", () => {
      syncLoadoutToServer(false);
      socketSend({ type: "join_room", roomId: room.roomId });
    });

    const spectateBtn = document.createElement("button");
    spectateBtn.textContent = t("观战");
    spectateBtn.disabled = !app.connected || Boolean(app.room) || room.status !== "running" || room.mode === "pvp2v2";
    spectateBtn.addEventListener("click", () => {
      socketSend({ type: "spectate_room", roomId: room.roomId });
    });

    const actions = document.createElement("div");
    actions.className = "room-item-actions";
    actions.append(joinBtn, spectateBtn);

    item.append(title, meta, actions);
    ui.roomList.append(item);
  }
}

function applyRoomState(message) {
  const previousRoomId = app.room ? app.room.roomId : null;
  const previousSpectating = app.spectating;
  app.room = message.room || null;
  app.spectating = Boolean(message.self && message.self.spectating);
  app.seat = app.spectating ? null : message.self ? message.self.seat : null;
  app.allianceId = app.seat ? message.self?.allianceId || allianceIdForSeatClient(app.seat) : null;
  app.ready = Boolean(message.self && message.self.ready);
  if (app.room && app.seat && !message.self?.ready) {
    const ownRow = (app.room.players || []).find((row) => row && row.seat === app.seat);
    app.ready = Boolean(ownRow && ownRow.ready);
  }
  if (app.room && (app.room.roomId !== previousRoomId || app.spectating !== previousSpectating)) {
    clearMatchRuntime();
  }
  if (message.self && message.self.loadout) {
    app.playerLoadout = normalizeLoadout(message.self.loadout, DEFAULT_TEAM_LOADOUT);
    syncLoadoutControls(app.playerLoadout);
  }
  persistReconnectTicket(message);

  updateRoomSummary();

  const roomStatus = app.room ? app.room.status : null;
  const isCountdown = roomStatus === "countdown";
  const canBattle = roomStatus === "running";
  const isFinished = roomStatus === "finished";
  const showBattleView = isCountdown || canBattle || isFinished;
  setBattleControlsEnabled(Boolean(canBattle && !app.spectating && app.canControlFleet));
  updateReadyRoomButton();
  updateTeamCommUi();
  setRoomHudVisible(!showBattleView);
  syncResponsiveMode();
  // 战斗页刚由 hidden 显示时,首次测量可能拿到 0 宽 → 下一帧布局就绪后再校准画布清晰度
  if (showBattleView) requestAnimationFrame(() => camera.resizeCanvas());
  updateShipSwitchLabels(app.playerLoadout);
  const loadoutLocked = Boolean(app.room && (app.room.status === "countdown" || app.room.status === "running"));
  for (const element of [ui.onlineMainRole, ui.onlineSub1Role, ui.onlineSub2Role, ui.applyLoadoutOnlineBtn]) {
    if (element) {
      element.disabled = loadoutLocked;
    }
  }

  if (app.seat === "A") {
    ui.seatValue.textContent = t("A位（左翼舰队）");
  } else if (app.seat === "B") {
    ui.seatValue.textContent = t("B位（右翼舰队）");
  } else if (app.seat && isTwoVsTwoRoom()) {
    ui.seatValue.textContent = `${seatLabelForRoomSeat(app.seat)}`;
  } else if (app.spectating) {
    ui.seatValue.textContent = t("观战");
  } else {
    ui.seatValue.textContent = "-";
  }

  if (isFinished) {
    if (app.room && app.room.winnerSeat) {
      app.lastWinnerSeat = app.room.winnerSeat;
    }
    const latestWinner = app.latestSnapshot && app.latestSnapshot.state ? app.latestSnapshot.state.winnerSeat : null;
    showMatchResultOverlay(latestWinner || app.lastWinnerSeat || (app.room ? app.room.winnerSeat : null) || null);
  } else if (!canBattle && !isCountdown) {
    clearMatchRuntime();
    closeOverlay();
    ui.hullValue.textContent = "-";
    ui.energyValue.textContent = "-";
    ui.splitValue.textContent = "-";
    ui.zoneValue.textContent = t("战区 -");
    ui.selectedValue.textContent = "-";
    app.pendingSubSkillAim = null;
    refreshSkillButtons(null);
  }

  if (app.room) {
    if (app.room.status === "waiting") {
      if (app.room.mode === "ai") {
        log(t("AI房准备中"));
      } else {
        log(t("已进入房间，等待对手加入"));
      }
    }
    if (app.room.status === "running") {
      log(app.spectating ? t("已进入观战") : t("对战开始"));
    }
    if (app.room.status === "countdown") {
      log(t("三秒后开战"));
    }
  }
}

function handleRoomClosed(message) {
  const reason = translateServerText(message.reason || "房间关闭", message.reasonCode);
  log(reason);
  clearReconnectTicket();
  app.room = null;
  app.seat = null;
  app.allianceId = null;
  app.ready = false;
  app.spectating = false;
  updateRoomSummary();
  setBattleControlsEnabled(false);
  updateTeamCommUi();
  setRoomHudVisible(true);
  clearMatchRuntime();
  closeOverlay();
  ui.zoneValue.textContent = t("战区 -");
  refreshSkillButtons(null);
}

function teamBySeat(state, seat) {
  if (!state) {
    return null;
  }
  if (isTwoVsTwoState(state)) {
    if (state.fleets[seat]) {
      return state.fleets[seat];
    }
    if (seat === "A" && state.fleets.A1) {
      return state.fleets.A1;
    }
    if (seat === "B" && state.fleets.B1) {
      return state.fleets.B1;
    }
    return null;
  }
  if (!state.teams) {
    return null;
  }
  if (seat === "A") {
    return state.teams.A || null;
  }
  if (seat === "B") {
    return state.teams.B || null;
  }
  return state.teams.A || null;
}

function enemySeat(seat) {
  const value = String(seat || "");
  if (value.startsWith("A")) {
    return value.length > 1 ? "B1" : "B";
  }
  if (value.startsWith("B")) {
    return value.length > 1 ? "A1" : "A";
  }
  return "B";
}

function syncShipSelectOptions(team) {
  if (!team || !team.ships) {
    return;
  }

  const selected = team.ships[app.selectedShipKey];
  if (!selected || !selected.alive || !selected.canControl) {
    const fallback = Object.keys(team.ships).find((key) => {
      const ship = team.ships[key];
      return ship && ship.alive && ship.canControl;
    });
    if (fallback) {
      app.selectedShipKey = fallback;
      sendSelectedShipUpdate();
    }
  }

  if (ui.shipSelect) {
    for (const option of Array.from(ui.shipSelect.options)) {
      const ship = team.ships[option.value];
      option.disabled = !(ship && ship.alive && ship.canControl);
    }
    ui.shipSelect.value = app.selectedShipKey;
  }

  for (const button of ui.shipSwitchButtons) {
    const key = button.dataset.ship;
    const ship = key ? team.ships[key] : null;
    const enabled = Boolean(ship && ship.alive && ship.canControl);
    button.disabled = !enabled;
    button.classList.toggle("active", key === app.selectedShipKey);
  }
}

function syncPowerFromSelectedShip(team) {
  if (!team || !team.ships) {
    return;
  }
  if (document.activeElement === ui.powerSlider) {
    return;
  }
  const ship = team.ships[app.selectedShipKey];
  if (!ship) {
    return;
  }
  const value = Math.round(clamp((ship.throttle || 1) * 100, 25, 140));
  ui.powerSlider.value = String(value);
  ui.powerValue.textContent = `${value}%`;
  app.throttle = value / 100;
}

function selectShip(shipKey, state = app.latestSnapshot ? app.latestSnapshot.state : null) {
  if (!shipKey) {
    return false;
  }
  const own = teamBySeat(state, app.seat);
  if (!own || !own.ships) {
    return false;
  }
  const ship = own.ships[shipKey];
  if (!ship || !ship.alive || !ship.canControl) {
    return false;
  }
  app.selectedShipKey = shipKey;
  sendSelectedShipUpdate();
  syncShipSelectOptions(own);
  syncPowerFromSelectedShip(own);
  if (app.mobileMode || camera.zoom > CAMERA_ZOOM_MIN + 1e-3) {
    camera.centerCameraOn(ship.x, ship.y, false);
  }
  return true;
}

// 共享 updateSkillButtons 需要选中舰等上下文,这里统一补齐
function refreshSkillButtons(own) {
  const selected = own && own.ships ? own.ships[app.selectedShipKey] : null;
  updateSkillButtons(ui, own, {
    selected,
    selectedZoneId: app.selectedZoneId,
    pendingSubSkillAim: app.pendingSubSkillAim,
    fallbackLoadout: app.playerLoadout,
  });
}

function updateSpectatorBattleStatus(state) {
  const teamA = teamBySeat(state, "A");
  const teamB = teamBySeat(state, "B");
  const hullA = Math.round((teamA?.hullRatio || 0) * 100);
  const hullB = Math.round((teamB?.hullRatio || 0) * 100);
  const energyA = energyPercentForShip(teamA?.ships?.main);
  const energyB = energyPercentForShip(teamB?.ships?.main);

  ui.hullValue.textContent = `A ${hullA}% / B ${hullB}%`;
  ui.energyValue.textContent = `A ${energyA}% / B ${energyB}%`;
  ui.splitValue.textContent = `${localizedSplitLabel(teamA?.splitLevel || 0)} / ${localizedSplitLabel(teamB?.splitLevel || 0)}`;
  ui.zoneValue.textContent = t("战区 {zone}", { zone: app.selectedZoneId });
  ui.selectedValue.textContent = t("观战");
  ui.zoomValue.textContent = `${Math.round(camera.zoom * 100)}%`;
  ui.zoomOutBtn.disabled = camera.zoom <= CAMERA_ZOOM_MIN + 1e-3;
  ui.zoomInBtn.disabled = camera.zoom >= CAMERA_ZOOM_MAX - 1e-3;
  refreshSkillButtons(null);
  renderFleetRoster(ui, teamA, { selectedShipKey: app.selectedShipKey });
  syncMobileHud(ui, null, { visible: false });
}

function updateBattleStatus(state) {
  if (isSpectatorMode()) {
    updateSpectatorBattleStatus(state);
    return;
  }
  const controlledTeam = teamBySeat(state, app.seat);
  const own = defeatedObservationTeam(state);
  if (!own) {
    ui.hullValue.textContent = "-";
    ui.energyValue.textContent = "-";
    ui.splitValue.textContent = "-";
    ui.zoneValue.textContent = t("战区 -");
    ui.selectedValue.textContent = "-";
    ui.zoomValue.textContent = `${Math.round(camera.zoom * 100)}%`;
    ui.zoomOutBtn.disabled = camera.zoom <= CAMERA_ZOOM_MIN + 1e-3;
    ui.zoomInBtn.disabled = camera.zoom >= CAMERA_ZOOM_MAX - 1e-3;
    refreshSkillButtons(null);
    renderFleetRoster(ui, null, {});
    return;
  }

  ui.hullValue.textContent = `${Math.round((own.hullRatio || 0) * 100)}%`;
  ui.splitValue.textContent = localizedSplitLabel(own.splitLevel);
  ui.zoneValue.textContent = t("战区 {zone}", { zone: app.selectedZoneId });
  ui.zoomValue.textContent = `${Math.round(camera.zoom * 100)}%`;
  ui.zoomOutBtn.disabled = camera.zoom <= CAMERA_ZOOM_MIN + 1e-3;
  ui.zoomInBtn.disabled = camera.zoom >= CAMERA_ZOOM_MAX - 1e-3;

  if (app.fleetDefeated) {
    const observedSelectedKey = selectedShipKeyForSeat(state, own.seat) || "main";
    const observedShip = own.ships ? own.ships[observedSelectedKey] || own.ships.main : null;
    ui.energyValue.textContent = `${energyPercentForShip(observedShip || own.ships?.main)}%`;
    ui.selectedValue.textContent = t("本队观察");
    refreshSkillButtons(null);
    renderFleetRoster(ui, own, { selectedShipKey: observedSelectedKey });
    syncMobileHud(ui, null, { visible: false });
    return;
  }

  syncShipSelectOptions(controlledTeam || own);
  const selectedShip = own.ships ? own.ships[app.selectedShipKey] : null;
  ui.energyValue.textContent = `${energyPercentForShip(selectedShip || own.ships.main)}%`;
  ui.selectedValue.textContent =
    selectedShip && selectedShip.alive
      ? `${shipCharacterName(selectedShip)} | ${t("能量")} ${Math.round(Number(selectedShip.fleetEnergy) || 0)}/${Math.round(
          Number(selectedShip.fleetMaxEnergy) || 1,
        )}${selectedShip.braking ? ` | ${t("急刹中")}` : ""}`
      : t("无");
  ui.splitOneBtn.disabled = own.splitLevel >= 1;
  ui.splitTwoBtn.disabled = own.splitLevel < 1 || own.splitLevel >= 2;
  refreshSkillButtons(own);
  renderFleetRoster(ui, own, { selectedShipKey: app.selectedShipKey });
  syncMobileHud(ui, own, {
    visible: app.mobileMode && Boolean(app.room && app.room.status === "running") && !app.spectating,
    selected: selectedShip,
    selectedShipKey: app.selectedShipKey,
    selectedZoneId: app.selectedZoneId,
    pendingSubSkillAim: app.pendingSubSkillAim,
  });
  if (app.pendingSubSkillAim && ui.subSkillBtn.disabled) {
    app.pendingSubSkillAim = null;
  }
}

function updateSnapshotTransportStats(snapshot) {
  if (!snapshot) {
    return;
  }
  if (app.lastSnapshotArriveAtMs > 0) {
    const arrivalGap = Math.max(0, snapshot.receivedAtMs - app.lastSnapshotArriveAtMs);
    if (app.snapshotArrivalMs <= 0) {
      app.snapshotArrivalMs = arrivalGap;
    } else {
      app.snapshotArrivalMs = lerp(app.snapshotArrivalMs, arrivalGap, 0.16);
    }
    app.snapshotArrivalJitterMs = lerp(app.snapshotArrivalJitterMs, Math.abs(arrivalGap - app.snapshotIntervalMs), 0.24);
  }
  app.lastSnapshotArriveAtMs = snapshot.receivedAtMs;

  if (snapshot.tick < app.lastSnapshotTick) {
    app.snapshotReorderRatio = lerp(app.snapshotReorderRatio, 1, 0.16);
  } else {
    app.snapshotReorderRatio = lerp(app.snapshotReorderRatio, 0, 0.06);
    app.lastSnapshotTick = Math.max(app.lastSnapshotTick, snapshot.tick);
  }

  if (snapshot.snapshotSeq > 0) {
    if (app.lastSnapshotSeq > 0) {
      if (snapshot.snapshotSeq <= app.lastSnapshotSeq) {
        app.snapshotReorderRatio = lerp(app.snapshotReorderRatio, 1, 0.22);
      } else {
        const lost = Math.max(0, snapshot.snapshotSeq - app.lastSnapshotSeq - 1);
        const lossSample = lost > 0 ? clamp(lost / 3, 0, 1) : 0;
        app.snapshotLossRatio = lerp(app.snapshotLossRatio, lossSample, 0.22);
      }
    }
    app.lastSnapshotSeq = Math.max(app.lastSnapshotSeq, snapshot.snapshotSeq);
  } else {
    app.snapshotLossRatio = lerp(app.snapshotLossRatio, 0, 0.04);
  }

  app.jitterMs = lerp(app.jitterMs, Math.max(app.rttVarianceMs, app.snapshotArrivalJitterMs), 0.16);
}

function insertSnapshot(snapshot) {
  const existingIndex = app.snapshots.findIndex((item) => item.tick === snapshot.tick);
  if (existingIndex >= 0) {
    app.snapshots[existingIndex] = snapshot;
  } else {
    app.snapshots.push(snapshot);
  }

  app.snapshots.sort((a, b) => {
    if (a.tick !== b.tick) {
      return a.tick - b.tick;
    }
    return a.receivedAtMs - b.receivedAtMs;
  });

  const latest = app.snapshots[app.snapshots.length - 1] || null;
  app.latestSnapshot = latest;

  if (!latest) {
    return;
  }

  const keepTicks = Math.ceil(app.serverTickRate * SNAPSHOT_HISTORY_SECONDS);
  const minTick = Math.max(0, latest.tick - keepTicks);
  while (app.snapshots.length > 0 && app.snapshots[0].tick < minTick) {
    app.snapshots.shift();
  }
  if (app.snapshots.length > 260) {
    app.snapshots.splice(0, app.snapshots.length - 260);
  }
}

function handleSnapshot(message) {
  if (!app.room || message.roomId !== app.room.roomId) {
    return;
  }

  const simTime = Number(message.simTime) || 0;
  const tickValue = Number(message.tick);
  const tick = Number.isFinite(tickValue) && tickValue > 0 ? Math.round(tickValue) : Math.max(0, Math.round(simTime * app.serverTickRate));
  const snapshot = {
    tick,
    simTime,
    serverTimeMs: Number(message.serverTime) || 0,
    snapshotSeq: Number(message.snapshotSeq) || 0,
    receivedAtMs: nowMs(),
    state: message.state,
  };

  updateSnapshotTransportStats(snapshot);
  insertSnapshot(snapshot);
  applyViewerControlState(snapshot.state);

  if (Number.isInteger(message.ackSeq)) {
    app.ackSeq = Math.max(app.ackSeq, message.ackSeq);
    pruneAckedOverrides(snapshot.state);
  }

  updateInterpolationDelay();

  // HUD 全量 DOM 刷新压到 ~10Hz:20Hz 快照逐条刷文本/进度条会与 rAF 抢主线程(移动端尤甚)
  if (nowMs() - (app.lastHudRefreshMs || 0) >= 95) {
    app.lastHudRefreshMs = nowMs();
    updateBattleStatus(snapshot.state);
  }
  const ownTeam = teamBySeat(snapshot.state, app.seat);
  if (ownTeam && app.canControlFleet) {
    syncPowerFromSelectedShip(ownTeam);
  }

  const phase = snapshot.state ? snapshot.state.phase : null;
  const winner = snapshot.state ? snapshot.state.winnerSeat : null;
  if (winner) {
    app.lastWinnerSeat = winner;
  }
  if (phase !== app.lastMatchPhase) {
    app.lastMatchPhase = phase;
    if (phase === "finished") {
      showMatchResultOverlay(winner || app.lastWinnerSeat || null);
    } else {
      closeOverlay();
    }
  } else if (phase === "finished" && ui.overlay.classList.contains("hidden")) {
    showMatchResultOverlay(winner || app.lastWinnerSeat || null);
  }
}

function handleServerMessage(raw) {
  let message = null;
  try {
    message = JSON.parse(raw);
  } catch (_error) {
    return;
  }

  const type = String(message.type || "");

  if (type === "connected") {
    handleConnected(message);
    return;
  }

  if (type === "lobby") {
    renderLobbyRooms(message.rooms || []);
    return;
  }

  if (type === "room_state") {
    applyRoomState(message);
    return;
  }

  if (type === "room_closed") {
    handleRoomClosed(message);
    socketSend({ type: "list_rooms" });
    return;
  }

  if (type === "snapshot") {
    handleSnapshot(message);
    return;
  }

  if (type === "pong") {
    handlePong(message);
    return;
  }

  if (type === "team_comm_event") {
    handleTeamCommEvent(message);
    return;
  }

  if (type === "error") {
    log(t("错误：{message}", { message: translateServerText(message.message || t("未知错误"), message.code) }));
    return;
  }
}

function sendAction(action) {
  if (!app.room || app.room.status !== "running") {
    return null;
  }
  if (!app.connected) {
    return null;
  }
  if (!app.seat || app.spectating || !app.canControlFleet || app.fleetDefeated) {
    return null;
  }
  app.seq += 1;
  const seq = app.seq;
  socketSend({
    type: "input",
    seq,
    action,
    clientTime: Date.now(),
  });
  return seq;
}

function sendTeamComm(commType) {
  if (!isTwoVsTwoRoom() || !app.connected || !app.room || app.room.status === "finished" || !app.seat || app.spectating) {
    return false;
  }
  const safeType = String(commType || "").trim();
  if (!TEAM_COMM_LABELS[safeType]) {
    return false;
  }
  const payload = {
    type: "team_comm",
    commType: safeType,
  };
  if (teamCommNeedsPointClient(safeType)) {
    payload.anchor = {
      type: "point",
      x: Math.round(clampToMapX(app.pointer?.x || LOGICAL * 0.5)),
      y: Math.round(clampToMapY(app.pointer?.y || LOGICAL * 0.5)),
    };
  }
  return socketSend(payload);
}

function handleTeamCommEvent(message) {
  if (!app.room || message.roomId !== app.room.roomId || !message.event) {
    return;
  }
  const event = {
    ...message.event,
    commType: String(message.event.commType || ""),
    anchor: message.event.anchor && message.event.anchor.type === "point"
      ? {
          type: "point",
          x: Number(message.event.anchor.x),
          y: Number(message.event.anchor.y),
        }
      : null,
    createdAt: Number(message.event.createdAt) || nowMs(),
    expiresAt: Number(message.event.expiresAt) || nowMs() + 8000,
  };
  if (event.anchor && (!Number.isFinite(event.anchor.x) || !Number.isFinite(event.anchor.y))) {
    event.anchor = null;
  }
  app.teamComms.push(event);
  pruneTeamComms();
  log(t("队内：{seat} {label}", { seat: event.senderSeat || "-", label: teamCommLabel(event.commType) }));
  renderTeamCommFeed();
}

function setRouteOverride(shipKey, seq, route) {
  if (!shipKey || !route) {
    return;
  }
  app.routeOverrides.set(shipKey, {
    seq,
    route,
    createdAtMs: nowMs(),
    ackedAtMs: null,
  });
}

function getLatestOwnShip(shipKey) {
  if (!app.latestSnapshot || !app.latestSnapshot.state) {
    return null;
  }
  const own = teamBySeat(app.latestSnapshot.state, app.seat);
  if (!own || !own.ships) {
    return null;
  }
  return own.ships[shipKey] || null;
}

function createRouteGuessForSet(ship, endX, endY) {
  const p0 = { x: ship.x, y: ship.y };
  const p2 = {
    x: clampToMapX(endX, 20),
    y: clampToMapY(endY, 20),
  };
  const dist = Math.max(1, distance(p0.x, p0.y, p2.x, p2.y));
  const lead = clamp(dist * 0.36, 44, 220);
  const p1 = {
    x: p0.x + Math.cos(ship.angle) * lead,
    y: p0.y + Math.sin(ship.angle) * lead,
  };
  return {
    anchorToMain: ship.key === "main",
    p0,
    p1,
    p2,
    t: 0,
  };
}

function applySetRouteOverride(shipKey, seq, endX, endY) {
  const ship = getLatestOwnShip(shipKey);
  if (!ship) {
    return;
  }
  const route = createRouteGuessForSet(ship, endX, endY);
  setRouteOverride(shipKey, seq, route);
}

function applyRouteControlOverride(shipKey, seq, controlX, controlY) {
  let existing = app.routeOverrides.get(shipKey);
  if (!existing) {
    const ship = getLatestOwnShip(shipKey);
    if (!ship || !ship.route) {
      return;
    }
    existing = {
      seq: 0,
      route: cloneRoute(ship.route),
      createdAtMs: nowMs(),
      ackedAtMs: null,
    };
    app.routeOverrides.set(shipKey, existing);
  }
  if (!existing.route) {
    return;
  }
  const route = {
    ...existing.route,
    p1: {
      x: clampToMapX(controlX, 20),
      y: clampToMapY(controlY, 20),
    },
  };
  setRouteOverride(shipKey, seq, route);
}

function applyRouteEndOverride(shipKey, seq, endX, endY) {
  let existing = app.routeOverrides.get(shipKey);
  if (!existing) {
    const ship = getLatestOwnShip(shipKey);
    if (!ship || !ship.route) {
      return;
    }
    existing = {
      seq: 0,
      route: cloneRoute(ship.route),
      createdAtMs: nowMs(),
      ackedAtMs: null,
    };
    app.routeOverrides.set(shipKey, existing);
  }
  if (!existing.route) {
    return;
  }
  const route = {
    ...existing.route,
    p2: {
      x: clampToMapX(endX, 20),
      y: clampToMapY(endY, 20),
    },
  };
  setRouteOverride(shipKey, seq, route);
}

function clearRouteOverride(shipKey) {
  app.routeOverrides.delete(shipKey);
}

function routeMatchesOverride(serverRoute, overrideRoute) {
  if (!serverRoute || !overrideRoute) {
    return false;
  }
  const serverP2 = serverRoute.p2 || { x: 0, y: 0 };
  const overrideP2 = overrideRoute.p2 || { x: 0, y: 0 };
  if (distance(serverP2.x, serverP2.y, overrideP2.x, overrideP2.y) > ROUTE_MATCH_P2_EPSILON) {
    return false;
  }

  const serverP1 = serverRoute.p1 || serverP2;
  const overrideP1 = overrideRoute.p1 || overrideP2;
  return distance(serverP1.x, serverP1.y, overrideP1.x, overrideP1.y) <= ROUTE_MATCH_P1_EPSILON;
}

function pruneAckedOverrides(snapshotState) {
  const now = nowMs();
  const own = teamBySeat(snapshotState, app.seat);
  const ownShips = own && own.ships ? own.ships : null;

  for (const [shipKey, override] of app.routeOverrides) {
    if (!override || !override.route) {
      app.routeOverrides.delete(shipKey);
      continue;
    }

    if (override.seq > app.ackSeq) {
      continue;
    }

    if (!override.ackedAtMs) {
      override.ackedAtMs = now;
      app.routeOverrides.set(shipKey, override);
    }

    if (app.drag && app.drag.shipKey === shipKey) {
      continue;
    }

    const ackAge = now - override.ackedAtMs;
    if (ackAge < ROUTE_OVERRIDE_MIN_HOLD_MS) {
      continue;
    }

    const ship = ownShips ? ownShips[shipKey] : null;
    if (ship && routeMatchesOverride(ship.route, override.route)) {
      app.routeOverrides.delete(shipKey);
      continue;
    }

    if (ackAge >= ROUTE_OVERRIDE_MAX_HOLD_MS) {
      app.routeOverrides.delete(shipKey);
    }
  }
}

function setThrottleFromSlider(shouldSend) {
  const value = clamp(Number(ui.powerSlider.value), 25, 140);
  ui.powerValue.textContent = `${Math.round(value)}%`;
  app.throttle = value / 100;

  if (!shouldSend) {
    return;
  }

  if (app.throttleSendTimer) {
    clearTimeout(app.throttleSendTimer);
  }
  app.throttleSendTimer = setTimeout(() => {
    const seq = sendAction({
      type: "set_throttle",
      shipKey: app.selectedShipKey,
      throttle: app.throttle,
    });
    if (seq !== null) {
      // 不需要绘制覆盖，仅提交控制档位。
    }
  }, 80);
}

function currentBattleState() {
  return app.lastRenderState || (app.latestSnapshot ? app.latestSnapshot.state : null);
}

function syncResponsiveMode() {
  app.mobileMode = prefersMobileBattleMode();
  if (!app.mobileMode) {
    camera.releaseManual();
  }
  if (ui.mobileBattleHud) {
    ui.mobileBattleHud.hidden = !app.mobileMode || !(app.room && app.room.status === "running") || app.spectating;
  }
  camera.resizeCanvas(); // 显示尺寸/方向变化时同步 backing store 到设备像素,保持清晰
}

function getSelectedShipFromState(state) {
  const own = teamBySeat(state, app.seat);
  if (!own || !own.ships) {
    return null;
  }
  return own.ships[app.selectedShipKey] || null;
}

function setThrottleValue(percent, shouldSend = true) {
  ui.powerSlider.value = String(clamp(Number(percent), 25, 140));
  setThrottleFromSlider(shouldSend);
}

function syncAutoScoutZoneOnline() {
  const state = currentBattleState();
  const own = teamBySeat(state, app.seat);
  if (!own?.autoScout?.enabled) {
    return null;
  }
  return sendAction({
    type: "configure_auto_scout",
    enabled: true,
    zoneId: app.selectedZoneId,
  });
}

function setSelectedZoneId(zoneId, { allowLog = true } = {}) {
  const nextZoneId = clamp(Number(zoneId) || app.selectedZoneId, 1, 9);
  const changed = nextZoneId !== app.selectedZoneId;
  app.selectedZoneId = nextZoneId;
  ui.zoneValue.textContent = t("战区 {zone}", { zone: nextZoneId });
  if (changed && allowLog) {
    log(t("已选择战区 {zone}", { zone: nextZoneId }));
  }
  syncAutoScoutZoneOnline();
  updateBattleStatus(currentBattleState());
  return changed;
}

function toggleAutoScoutOnline() {
  const state = currentBattleState();
  const own = teamBySeat(state, app.seat);
  if (!own) {
    return null;
  }
  const enabled = !own.autoScout?.enabled;
  const seq = sendAction({
    type: "configure_auto_scout",
    enabled,
    zoneId: app.selectedZoneId,
  });
  if (seq !== null) {
    log(enabled ? t("自动侦查已开启，目标战区 {zone}", { zone: app.selectedZoneId }) : t("自动侦查已关闭"));
  }
  return seq;
}

function useEmergencyBrakeOnline() {
  const ship = getLatestOwnShip(app.selectedShipKey);
  if (!ship || !ship.alive || !ship.canControl) {
    return null;
  }
  const seq = sendAction({
    type: "emergency_brake",
    shipKey: ship.key,
  });
  if (seq !== null) {
    log(t("{ship} 执行急刹", { ship: shipDisplayName(ship) }));
  }
  return seq;
}

function handleMinimapTap(screenPos, state, { allowZoneLog = true } = {}) {
  if (!app.mobileMode || !state) {
    return false;
  }
  const world = camera.minimapWorldPointFromScreenPoint(screenPos.x, screenPos.y);
  if (!world) {
    return false;
  }
  camera.centerCameraOn(world.x, world.y, true);
  const zone = zoneFromPoint(state, world.x, world.y);
  if (zone) {
    setSelectedZoneId(zone.id, { allowLog: allowZoneLog });
  }
  return true;
}

function getRouteForShip(ship) {
  if (!ship) {
    return null;
  }
  const override = app.routeOverrides.get(ship.key);
  if (override && override.route) {
    return override.route;
  }
  return ship.route || null;
}

function clonePoint(point) {
  if (!point) {
    return { x: 0, y: 0 };
  }
  return { x: point.x, y: point.y };
}

function cloneRoute(route) {
  if (!route) {
    return null;
  }
  return {
    anchorToMain: route.anchorToMain !== false,
    p0: clonePoint(route.p0),
    p1: clonePoint(route.p1),
    p2: clonePoint(route.p2),
    t: Number(route.t) || 0,
  };
}

function getDisplayRouteForShip(team, ship) {
  const route = getRouteForShip(ship);
  if (!route) {
    return null;
  }
  const output = cloneRoute(route);
  let anchor = ship;
  if (route.anchorToMain && team && team.ships && team.ships.main && team.ships.main.alive) {
    anchor = team.ships.main;
  }
  output.p0 = {
    x: anchor.x,
    y: anchor.y,
  };
  return output;
}

function interpolateRoute(a, b, t) {
  if (!a && !b) {
    return null;
  }
  if (!a && b) {
    return t < 0.35 ? null : cloneRoute(b);
  }
  if (a && !b) {
    return t > 0.65 ? null : cloneRoute(a);
  }
  return {
    anchorToMain: b.anchorToMain !== false,
    p0: {
      x: lerp(a.p0.x, b.p0.x, t),
      y: lerp(a.p0.y, b.p0.y, t),
    },
    p1: {
      x: lerp(a.p1.x, b.p1.x, t),
      y: lerp(a.p1.y, b.p1.y, t),
    },
    p2: {
      x: lerp(a.p2.x, b.p2.x, t),
      y: lerp(a.p2.y, b.p2.y, t),
    },
    t: lerp(Number(a.t) || 0, Number(b.t) || 0, t),
  };
}

function interpolateShip(a, b, t) {
  if (!a || !b) {
    return b || a || null;
  }

  const bothAlive = a.alive && b.alive;
  if (!bothAlive) {
    return t < 0.5 ? a : b;
  }

  return {
    ...b,
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    angle: a.angle + shortestAngleDelta(a.angle, b.angle) * t,
    speed: lerp(a.speed, b.speed, t),
    hp: lerp(a.hp, b.hp, t),
    throttle: lerp(a.throttle, b.throttle, t),
    route: interpolateRoute(a.route, b.route, t),
  };
}

// 1096 双子舰等额外舰船与编制舰使用同一套舰船插值，不能按普通单位直接跳快照。
function interpolateShipList(previousList, nextList, t) {
  const prev = Array.isArray(previousList) ? previousList : [];
  const next = Array.isArray(nextList) ? nextList : [];
  const prevMap = new Map(prev.map((ship) => [ship.id, ship]));
  return next.map((ship) => {
    const previous = prevMap.get(ship.id);
    return previous ? interpolateShip(previous, ship, t) : ship;
  });
}

function interpolateUnitList(previousList, nextList, t) {
  const prev = Array.isArray(previousList) ? previousList : [];
  const next = Array.isArray(nextList) ? nextList : [];
  const prevMap = new Map(prev.map((item) => [item.id, item]));
  const result = [];

  for (const current of next) {
    const old = prevMap.get(current.id);
    if (old && old.alive && current.alive) {
      const oldAngle = Number.isFinite(old.angle) ? old.angle : 0;
      const currentAngle = Number.isFinite(current.angle) ? current.angle : oldAngle;
      result.push({
        ...current,
        x: lerp(old.x, current.x, t),
        y: lerp(old.y, current.y, t),
        angle: oldAngle + shortestAngleDelta(oldAngle, currentAngle) * t,
        hp: Number.isFinite(old.hp) && Number.isFinite(current.hp) ? lerp(old.hp, current.hp, t) : current.hp,
        life: Number.isFinite(old.life) && Number.isFinite(current.life) ? lerp(old.life, current.life, t) : current.life,
      });
    } else {
      result.push(current);
    }
  }
  return result;
}

function interpolateBeamList(previousList, nextList, t) {
  const prev = Array.isArray(previousList) ? previousList : [];
  const next = Array.isArray(nextList) ? nextList : [];
  const prevMap = new Map(prev.map((item) => [item.id, item]));
  const result = [];

  for (const current of next) {
    const old = prevMap.get(current.id);
    if (old) {
      result.push({
        ...current,
        x1: lerp(old.x1, current.x1, t),
        y1: lerp(old.y1, current.y1, t),
        x2: lerp(old.x2, current.x2, t),
        y2: lerp(old.y2, current.y2, t),
        progress: Number.isFinite(old.progress) && Number.isFinite(current.progress)
          ? lerp(old.progress, current.progress, t)
          : current.progress,
        life: Number.isFinite(old.life) && Number.isFinite(current.life) ? lerp(old.life, current.life, t) : current.life,
        maxLife: Number.isFinite(old.maxLife) && Number.isFinite(current.maxLife)
          ? lerp(old.maxLife, current.maxLife, t)
          : current.maxLife,
      });
    } else {
      result.push(current);
    }
  }
  return result;
}

// 子弹是「恒速直线飞向 target」的确定性弹道,可做精确航位推算
function advanceProjectile(projectile, dt) {
  const speed = Number(projectile.speed) || 0;
  const dx = projectile.targetX - projectile.x;
  const dy = projectile.targetY - projectile.y;
  const remaining = Math.hypot(dx, dy);
  if (speed <= 0 || remaining < 1e-3) {
    return projectile;
  }
  const step = clamp(speed * dt, -remaining * 4, remaining); // 向前不越过目标;向后(回退)限幅
  return {
    ...projectile,
    x: projectile.x + (dx / remaining) * step,
    y: projectile.y + (dy / remaining) * step,
  };
}

function interpolateProjectileList(previousList, nextList, t, spanSeconds) {
  const prev = Array.isArray(previousList) ? previousList : [];
  const next = Array.isArray(nextList) ? nextList : [];
  const prevMap = new Map(prev.map((item) => [item.id, item]));
  const result = [];

  for (const current of next) {
    const old = prevMap.get(current.id);
    if (old && old.alive && current.alive) {
      result.push({
        ...current,
        x: lerp(old.x, current.x, t),
        y: lerp(old.y, current.y, t),
      });
    } else {
      // 两帧之间新生的子弹:沿弹道回退 (1-t)*span,让它从炮口平滑飞出,
      // 而不是整个插值区间冻结在快照位置(连发时表现为颗颗子弹出生即卡顿)
      result.push(advanceProjectile(current, -(1 - t) * (spanSeconds || 0)));
    }
  }
  return result;
}

function interpolateVisualList(previousList, nextList, t) {
  const prev = Array.isArray(previousList) ? previousList : [];
  const next = Array.isArray(nextList) ? nextList : [];
  const prevMap = new Map(prev.map((item) => [item.id, item]));
  const result = [];

  for (const current of next) {
    const old = prevMap.get(current.id);
    if (old) {
      result.push({
        ...current,
        x: lerp(old.x, current.x, t),
        y: lerp(old.y, current.y, t),
        radius: Number.isFinite(old.radius) && Number.isFinite(current.radius) ? lerp(old.radius, current.radius, t) : current.radius,
        life: Number.isFinite(old.life) && Number.isFinite(current.life) ? lerp(old.life, current.life, t) : current.life,
      });
    } else {
      result.push(current);
    }
  }
  return result;
}

function interpolateTeam(a, b, t) {
  if (!a || !b) {
    return b || a || null;
  }

  const ships = {};
  const shipKeys = new Set([
    ...Object.keys(a.ships || {}),
    ...Object.keys(b.ships || {}),
  ]);
  for (const key of shipKeys) {
    ships[key] = interpolateShip(a.ships?.[key], b.ships?.[key], t);
  }

  return {
    ...b,
    energy: lerpNumber(a.energy, b.energy, t, b.energy),
    hullRatio: lerpNumber(a.hullRatio, b.hullRatio, t, b.hullRatio),
    autoScout: {
      enabled: Boolean(b.autoScout?.enabled),
      zoneId: Number(b.autoScout?.zoneId) || 5,
    },
    cooldowns: {
      scout: lerpNumber(a.cooldowns?.scout, b.cooldowns?.scout, t, 0),
      flagship: lerpNumber(a.cooldowns?.flagship, b.cooldowns?.flagship, t, 0),
      sub1: lerpNumber(a.cooldowns?.sub1, b.cooldowns?.sub1, t, 0),
      sub2: lerpNumber(a.cooldowns?.sub2, b.cooldowns?.sub2, t, 0),
    },
    ships,
    extraShips: interpolateShipList(a.extraShips, b.extraShips, t),
    scouts: interpolateUnitList(a.scouts, b.scouts, t),
    wingmen: interpolateUnitList(a.wingmen, b.wingmen, t),
    beams: interpolateBeamList(a.beams, b.beams, t),
  };
}

function extrapolateShip(ship, dt) {
  if (!ship || !ship.alive) {
    return ship;
  }
  return {
    ...ship,
    x: clampToMapX(ship.x + Math.cos(ship.angle) * ship.speed * dt, 2),
    y: clampToMapY(ship.y + Math.sin(ship.angle) * ship.speed * dt, 2),
  };
}

function extrapolateTeamState(team, safeDt) {
  if (!team || !team.ships) {
    return team;
  }
  const ships = {};
  for (const [key, ship] of Object.entries(team.ships)) {
    ships[key] = extrapolateShip(ship, safeDt);
  }
  return {
    ...team,
    ships,
    extraShips: Array.isArray(team.extraShips)
      ? team.extraShips.map((ship) => extrapolateShip(ship, safeDt))
      : [],
  };
}

function extrapolateFleetMap(fleets, safeDt) {
  const result = {};
  for (const [seat, fleet] of Object.entries(fleets || {})) {
    result[seat] = extrapolateTeamState(fleet, safeDt);
  }
  return result;
}

function extrapolateState(state, dt) {
  if (!state) {
    return state;
  }

  const safeDt = clamp(dt, 0, MAX_EXTRAPOLATE_MS / 1000);
  const result = {
    ...state,
    elapsed: (Number(state.elapsed) || 0) + safeDt,
    // 子弹弹道确定,外推期间继续飞;爆发/浮字寿命本地衰减,避免冻结后跳变
    projectiles: Array.isArray(state.projectiles) ? state.projectiles.map((p) => advanceProjectile(p, safeDt)) : state.projectiles,
    bursts: Array.isArray(state.bursts)
      ? state.bursts.map((b) => ({ ...b, life: Math.max(0, (Number(b.life) || 0) - safeDt) }))
      : state.bursts,
    floatingTexts: Array.isArray(state.floatingTexts)
      ? state.floatingTexts.map((f) => ({ ...f, life: Math.max(0, (Number(f.life) || 0) - safeDt) }))
      : state.floatingTexts,
  };

  if (state.fleets) {
    result.fleets = extrapolateFleetMap(state.fleets, safeDt);
  }
  if (state.teams) {
    result.teams = {
      A: extrapolateTeamState(state.teams.A, safeDt),
      B: extrapolateTeamState(state.teams.B, safeDt),
    };
  }
  return result;
}

function estimateServerNowMs() {
  if (!app.clockReady) {
    return nowMs();
  }
  return nowMs() + app.clockOffsetMs;
}

function smoothEntity(entity, dt, followRate, teleportDistance) {
  if (!entity || !Number.isFinite(entity.id)) {
    return entity;
  }
  if (!entity.alive) {
    app.smoothEntities.delete(entity.id);
    return entity;
  }

  const cache = app.smoothEntities.get(entity.id);
  const seenAt = nowMs();
  if (!cache) {
    app.smoothEntities.set(entity.id, {
      x: entity.x,
      y: entity.y,
      angle: entity.angle || 0,
      seenAt,
    });
    return entity;
  }

  const d = distance(cache.x, cache.y, entity.x, entity.y);
  if (d > teleportDistance) {
    app.smoothEntities.set(entity.id, {
      x: entity.x,
      y: entity.y,
      angle: entity.angle || 0,
      seenAt,
    });
    return entity;
  }

  const alpha = clamp(1 - Math.exp(-dt * followRate), 0.08, 1);
  const x = lerp(cache.x, entity.x, alpha);
  const y = lerp(cache.y, entity.y, alpha);
  const baseAngle = Number.isFinite(cache.angle) ? cache.angle : entity.angle || 0;
  const targetAngle = Number.isFinite(entity.angle) ? entity.angle : baseAngle;
  const angle = baseAngle + shortestAngleDelta(baseAngle, targetAngle) * alpha;

  app.smoothEntities.set(entity.id, {
    x,
    y,
    angle,
    seenAt,
  });
  return {
    ...entity,
    x,
    y,
    angle,
  };
}

function smoothTeamState(team, isOwnTeam, dt) {
  if (!team) {
    return team;
  }
  const followRate = isOwnTeam ? 18 : 13;
  const teleportDistance = isOwnTeam ? 160 : 230;
  const ships = {};
  for (const [key, ship] of Object.entries(team.ships || {})) {
    ships[key] = smoothEntity(ship, dt, followRate, teleportDistance);
  }
  return {
    ...team,
    ships,
    extraShips: Array.isArray(team.extraShips)
      ? team.extraShips.map((ship) => smoothEntity(ship, dt, followRate, teleportDistance))
      : [],
    scouts: Array.isArray(team.scouts) ? team.scouts.map((item) => smoothEntity(item, dt, followRate - 2, teleportDistance * 0.9)) : [],
    wingmen: Array.isArray(team.wingmen) ? team.wingmen.map((item) => smoothEntity(item, dt, followRate - 2, teleportDistance * 0.9)) : [],
  };
}

function smoothFleetMap(fleets, ownAllianceId, dt) {
  const result = {};
  for (const [seat, fleet] of Object.entries(fleets || {})) {
    const allianceId = fleet?.allianceId || allianceIdForSeatClient(seat);
    result[seat] = smoothTeamState(fleet, allianceId === ownAllianceId, dt);
  }
  return result;
}

function stabilizeRenderState(state) {
  if (!state) {
    return state;
  }
  const renderNowMs = nowMs();
  const dt = app.lastRenderMs > 0 ? clamp((renderNowMs - app.lastRenderMs) / 1000, 1 / 144, 0.05) : 1 / 60;
  app.lastRenderMs = renderNowMs;

  for (const [entityId, cache] of app.smoothEntities) {
    if (renderNowMs - cache.seenAt > 1400) {
      app.smoothEntities.delete(entityId);
    }
  }

  const ownSeat = app.seat || "A";
  const result = {
    ...state,
  };
  if (state.fleets) {
    result.fleets = smoothFleetMap(state.fleets, app.allianceId || allianceIdForSeatClient(ownSeat), dt);
  }
  if (state.teams) {
    result.teams = {
      A: smoothTeamState(state.teams.A, ownSeat === "A", dt),
      B: smoothTeamState(state.teams.B, ownSeat === "B", dt),
    };
  }
  return result;
}

function interpolateFleetMap(previousFleets, nextFleets, t) {
  const result = {};
  const seats = new Set([
    ...Object.keys(previousFleets || {}),
    ...Object.keys(nextFleets || {}),
  ]);
  for (const seat of seats) {
    result[seat] = interpolateTeam(previousFleets?.[seat], nextFleets?.[seat], t);
  }
  return result;
}

function interpolateSnapshotState(previousSnapshot, nextSnapshot, t) {
  const previousState = previousSnapshot.state || {};
  const nextState = nextSnapshot.state || {};
  const result = {
    ...nextSnapshot.state,
    elapsed: lerp(Number(previousState.elapsed) || 0, Number(nextState.elapsed) || 0, t),
    phase: nextState.phase,
    winnerSeat: nextState.winnerSeat,
    winnerAllianceId: nextState.winnerAllianceId,
    projectiles: interpolateProjectileList(
      previousState.projectiles,
      nextState.projectiles,
      t,
      Math.max(1, nextSnapshot.tick - previousSnapshot.tick) / app.serverTickRate,
    ),
    bursts: interpolateVisualList(previousState.bursts, nextState.bursts, t),
    floatingTexts: interpolateVisualList(previousState.floatingTexts, nextState.floatingTexts, t),
  };
  if (previousState.fleets || nextState.fleets) {
    result.fleets = interpolateFleetMap(previousState.fleets, nextState.fleets, t);
  }
  if (previousState.teams || nextState.teams) {
    result.teams = {
      A: interpolateTeam(previousState.teams?.A, nextState.teams?.A, t),
      B: interpolateTeam(previousState.teams?.B, nextState.teams?.B, t),
    };
  }
  return result;
}

function getRenderState() {
  if (app.snapshots.length === 0) {
    return null;
  }

  const latest = app.snapshots[app.snapshots.length - 1];
  const serverNowMs = estimateServerNowMs();
  const latestServerTime = Number(latest.serverTimeMs) || 0;
  const advanceMs = latestServerTime > 0 ? clamp(serverNowMs - latestServerTime, -120, MAX_EXTRAPOLATE_MS) : clamp(nowMs() - latest.receivedAtMs, 0, MAX_EXTRAPOLATE_MS);
  const advancedTick = latest.tick + (advanceMs / 1000) * app.serverTickRate;
  const targetTick = advancedTick - (app.interpDelayMs / 1000) * app.serverTickRate;

  while (app.snapshots.length > 4 && app.snapshots[1].tick < targetTick - app.serverTickRate * 0.6) {
    app.snapshots.shift();
  }

  const first = app.snapshots[0];
  if (targetTick <= first.tick) {
    return stabilizeRenderState(first.state);
  }

  for (let i = 1; i < app.snapshots.length; i += 1) {
    const previous = app.snapshots[i - 1];
    const next = app.snapshots[i];
    if (targetTick <= next.tick) {
      const span = Math.max(1, next.tick - previous.tick);
      const t = clamp((targetTick - previous.tick) / span, 0, 1);
      return stabilizeRenderState(interpolateSnapshotState(previous, next, t));
    }
  }

  const extraTicks = Math.max(0, targetTick - latest.tick);
  const extraSeconds = clamp(extraTicks / app.serverTickRate, 0, MAX_EXTRAPOLATE_MS / 1000);
  return stabilizeRenderState(extrapolateState(latest.state, extraSeconds));
}

function renderFrame() {
  if (!running) return;
  const state = getRenderState();
  app.lastRenderState = state;

  const elapsed = state ? state.elapsed : nowSecond();
  // backing store(设备像素)对逻辑世界(LOGICAL)的比例:整幅画面放大到物理像素 → 矢量线条像素级清晰。
  const scale = canvas.width / LOGICAL;
  camera.updateCamera();
  const view = camera.currentViewState();
  ctx.setTransform(scale, 0, 0, scale, 0, 0); // 基准变换:屏幕/UI 空间(逻辑坐标 → 物理像素)
  ctx.save();
  ctx.setTransform(
    view.zoom * scale,
    0,
    0,
    view.zoom * scale,
    -view.left * view.zoom * scale,
    -view.top * view.zoom * scale
  ); // 世界/相机空间

  if (!state) {
    drawBackground(ctx, app.stars, elapsed || 0);
    ctx.restore();
    drawNoDataHint(ctx);
    if (app.room?.status === "countdown") {
      drawBattleCountdown(ctx, Number(app.room.countdownEndsAt || 0) - estimateServerNowMs());
    }
    rafId = requestAnimationFrame(renderFrame);
    return;
  }

  // 战场本体全部交给共享渲染层(src/battle/render.js);
  // 在线只负责喂「插值快照 + 本地航线覆盖」合并后的显示状态
  const ownSeat = app.seat || "A";
  const spectating = isSpectatorMode();
  const ownAllianceId = app.allianceId || allianceIdForSeatClient(ownSeat);
  let ownTeam = app.fleetDefeated ? defeatedObservationTeam(state) : teamBySeat(state, ownSeat);
  const friendlyTeams = isTwoVsTwoState(state)
    ? fleetEntriesForAlliance(state, ownAllianceId)
    : ownTeam
      ? [ownTeam]
      : [];
  if (!ownTeam && friendlyTeams.length > 0) {
    ownTeam = friendlyTeams[0];
  }
  const enemyTeams = isTwoVsTwoState(state)
    ? fleetEntriesForAlliance(state, enemyAllianceIdClient(ownAllianceId))
    : teamBySeat(state, enemySeat(ownSeat))
      ? [teamBySeat(state, enemySeat(ownSeat))]
      : [];
  const enemyTeam = enemyTeams[0] || null;
  const frame = {
    state,
    ownTeam,
    enemyTeam,
    friendlyTeams,
    enemyTeams,
    spectating,
    visibleEnemyIds: visibleEnemyIdSetForTeams(friendlyTeams),
    // 观战:按快照内各座位的选中舰高亮;对战:己方取本地选中,敌方不高亮
    selectedKeyForTeam: (team) =>
      spectating
        ? selectedShipKeyForSeat(state, team && team.seat)
        : team === ownTeam
          ? app.selectedShipKey
          : friendlyTeams.includes(team)
            ? selectedShipKeyForSeat(state, team && team.seat)
            : null,
    // 在此合并本地航线预测覆盖,渲染层拿到的即最终显示航线
    routeForShip: (team, ship) => getDisplayRouteForShip(team, ship),
    mobileMode: app.mobileMode,
    stars: app.stars,
    destructionEffects: app.destructionEffects,
    teamComms: activeTeamComms(),
    selectedZoneId: app.selectedZoneId,
    pendingSubSkillAim: app.pendingSubSkillAim,
    pointer: app.pointer,
  };
  drawBattleWorld(ctx, frame);
  ctx.restore();

  // 屏幕空间:对战视角沿用玩家阵营立绘;观战按 A 蓝/B 红在地图两侧显示双方当前所选角色。
  if (spectating) {
    const teamA = teamBySeat(state, "A");
    const teamB = teamBySeat(state, "B");
    const selectedA = teamA?.ships?.[selectedShipKeyForSeat(state, "A")];
    const selectedB = teamB?.ships?.[selectedShipKeyForSeat(state, "B")];
    if (selectedA?.alive) {
      drawInGamePortrait(ctx, selectedA.characterId, LOGICAL, LOGICAL, 0.16, "blue", "left");
    }
    if (selectedB?.alive) {
      drawInGamePortrait(ctx, selectedB.characterId, LOGICAL, LOGICAL, 0.16, "red", "right");
    }
  } else {
    const activeShip = ownTeam && ownTeam.ships ? ownTeam.ships[app.selectedShipKey] : null;
    if (activeShip && activeShip.alive) {
      drawInGamePortrait(ctx, activeShip.characterId, LOGICAL, LOGICAL, 0.14, getFaction());
    }
  }
  drawMinimap(ctx, frame, camera.minimapRect(), view);
  if (app.room?.status === "countdown") {
    drawBattleCountdown(ctx, Number(app.room.countdownEndsAt || 0) - estimateServerNowMs());
  }

  rafId = requestAnimationFrame(renderFrame);
}

function syncLoadoutToServer(logOnSuccess = true) {
  app.playerLoadout = readLoadoutFromControls();
  syncLoadoutControls(app.playerLoadout);
  storeLoadout(app.playerLoadout);
  const sent = socketSend({ type: "set_loadout", loadout: app.playerLoadout });
  if (logOnSuccess) {
    log(sent ? t("当前编队已同步到服务器") : t("当前编队已保存在本地，连接后会自动同步"));
  }
}

// 与单机一致的「翻书选角」：选完写回隐藏下拉并同步服务器
function openOnlineCharSelect() {
  if (charSelect && typeof charSelect.hide === "function") charSelect.hide();
  destroyOnlineFluidBackdrop();
  charSelect = createCharacterSelect((loadout) => {
    syncLoadoutControls(loadout); // 写入下拉，复用既有同步机制
    syncLoadoutToServer(true); // 读取下拉 → app.playerLoadout → 本地档案 → 发服务器
    syncOnlineFluidBackdrop(true);
  });
  charSelect.show();
}

function useFlagshipSkillOnline() {
  const own = teamBySeat(app.latestSnapshot ? app.latestSnapshot.state : null, app.seat);
  const meta = currentFlagshipMeta(own, app.playerLoadout);
  if (!meta || meta.type !== "active") {
    return;
  }
  const seq = sendAction({ type: "cast_flagship_skill", zoneId: app.selectedZoneId });
  if (seq !== null) {
    log(t("旗舰技能 {name} 已发动", { name: meta.name }));
  }
}

function useSubSkillOnline() {
  const state = app.latestSnapshot ? app.latestSnapshot.state : null;
  const own = teamBySeat(state, app.seat);
  const ship = own && own.ships ? own.ships[app.selectedShipKey] : null;
  const meta = currentSubMeta(ship);
  if (!ship || !meta) {
    return;
  }
  if (meta.target === "point" || meta.target === "optional_point") {
    if (app.pendingSubSkillAim && app.pendingSubSkillAim.shipKey === ship.key && meta.target === "optional_point") {
      const seq = sendAction({
        type: "cast_sub_skill",
        shipKey: ship.key,
        zoneId: app.selectedZoneId,
      });
      app.pendingSubSkillAim = null;
      if (seq !== null) {
        log(t("{ship} 使用 {name}", { ship: shipCharacterName(ship), name: meta.name }));
      }
      refreshSkillButtons(own);
      return;
    }
    app.pendingSubSkillAim = { shipKey: ship.key };
    log(
      meta.target === "optional_point"
        ? t("{name} 瞄准模式：点击地图选择闪现位置，再次点击技能按钮可原地释放", { name: meta.name })
        : t("{name} 瞄准模式：在地图上左键点击方向开火", { name: meta.name }),
    );
    refreshSkillButtons(own);
    return;
  }
  const seq = sendAction({
    type: "cast_sub_skill",
    shipKey: ship.key,
    zoneId: app.selectedZoneId,
  });
  if (seq !== null) {
    log(t("{ship} 使用 {name}", { ship: shipCharacterName(ship), name: meta.name }));
  }
}

function bindUiEvents() {
  ui.serverTargetValue.textContent = defaultServerUrl();
  const savedName = sanitizeNickname(getProfileNickname() || readCookie(NICKNAME_COOKIE_KEY));
  const fallbackName = t("玩家{num}", { num: Math.floor(Math.random() * 900 + 100) });
  setNickname(savedName || fallbackName, { persist: true });
  ui.zoneValue.textContent = t("战区 {zone}", { zone: app.selectedZoneId });
  ui.selectedValue.textContent = t("主舰");
  populateLoadoutControls();

  for (const select of [ui.onlineMainRole, ui.onlineSub1Role, ui.onlineSub2Role]) {
    if (!select) {
      continue;
    }
    select.addEventListener("change", () => {
      const normalized = readLoadoutFromControls();
      syncLoadoutControls(normalized);
    });
  }

  if (ui.applyLoadoutOnlineBtn) {
    ui.applyLoadoutOnlineBtn.addEventListener("click", () => {
      syncLoadoutToServer(true);
    });
  }

  if (ui.openFleetSelectBtn) {
    ui.openFleetSelectBtn.addEventListener("click", openOnlineCharSelect);
  }

  ui.connectBtn.addEventListener("click", () => {
    connectServer();
  });

  ui.disconnectBtn.addEventListener("click", () => {
    disconnectServer();
  });

  ui.applyNameBtn.addEventListener("click", () => {
    const name = setNickname(ui.playerNameInput ? ui.playerNameInput.value : "", { persist: true });
    if (!name) {
      log(t("昵称不能为空"));
      return;
    }
    const sent = socketSend({ type: "set_name", name });
    if (sent) {
      log(t("昵称已设置为 {name}", { name }));
    } else {
      log(t("昵称已保存为 {name}（连接后将自动同步）", { name }));
    }
  });

  ui.refreshRoomsBtn.addEventListener("click", () => {
    socketSend({ type: "list_rooms" });
  });

  ui.createPublicBtn.addEventListener("click", () => {
    syncLoadoutToServer(false);
    socketSend({ type: "create_room", visibility: "public", mode: "pvp" });
  });

  ui.createPrivateBtn.addEventListener("click", () => {
    syncLoadoutToServer(false);
    socketSend({ type: "create_room", visibility: "private", mode: "pvp" });
  });

  if (ui.create2v2Btn) {
    ui.create2v2Btn.addEventListener("click", () => {
      syncLoadoutToServer(false);
      socketSend({ type: "create_room", visibility: "public", mode: "pvp2v2" });
    });
  }

  ui.createAiRoomBtn.addEventListener("click", () => {
    syncLoadoutToServer(false);
    socketSend({ type: "create_room", visibility: "private", mode: "ai" });
  });

  ui.joinCodeBtn.addEventListener("click", () => {
    const code = ui.joinCodeInput.value.replace(/\D/g, "").slice(0, 6);
    if (code.length !== 6) {
      log(t("请输入 6 位房间号"));
      return;
    }
    syncLoadoutToServer(false);
    socketSend({ type: "join_private", code });
  });

  ui.leaveRoomBtn.addEventListener("click", () => {
    clearReconnectTicket();
    socketSend({ type: "leave_room" });
    app.room = null;
    app.seat = null;
    app.allianceId = null;
    app.ready = false;
    app.spectating = false;
    updateRoomSummary();
    setBattleControlsEnabled(false);
    clearMatchRuntime();
    closeOverlay();
    setRoomHudVisible(true); // 立即切回大厅页
  });

  if (ui.overlayActionBtn) {
    ui.overlayActionBtn.addEventListener("click", () => {
      clearReconnectTicket();
      if (app.room) {
        socketSend({ type: "leave_room" });
      }
      app.room = null;
      app.seat = null;
      app.allianceId = null;
      app.ready = false;
      app.spectating = false;
      updateRoomSummary();
      setBattleControlsEnabled(false);
      closeOverlay();
      setRoomHudVisible(true); // 立即切回大厅页
    });
  }

  if (ui.shipSelect) {
    ui.shipSelect.addEventListener("change", () => {
      selectShip(ui.shipSelect.value);
    });
  }

  if (ui.readyRoomBtn) {
    ui.readyRoomBtn.addEventListener("click", () => {
      if (!isTwoVsTwoRoom() || app.room.status !== "waiting" || !app.seat || app.spectating) {
        return;
      }
      socketSend({ type: "set_ready", ready: !app.ready });
    });
  }

  for (const button of [...(ui.teamCommButtons || []), ...(ui.mobileTeamCommButtons || [])]) {
    button.addEventListener("click", () => {
      sendTeamComm(button.dataset.commType || "");
    });
  }

  for (const button of ui.shipSwitchButtons) {
    button.addEventListener("click", () => {
      selectShip(button.dataset.ship || "");
    });
  }
  for (const cell of ui.fleetRows) {
    cell.row.addEventListener("click", () => {
      selectShip(cell.key || "");
    });
  }
  for (const button of ui.mobileShipButtons) {
    button.addEventListener("click", () => {
      selectShip(button.dataset.ship || "", currentBattleState());
    });
  }

  ui.powerSlider.addEventListener("input", () => {
    setThrottleFromSlider(true);
  });
  ui.zoomOutBtn.addEventListener("click", () => {
    camera.adjustCameraZoom(-1);
  });
  ui.zoomInBtn.addEventListener("click", () => {
    camera.adjustCameraZoom(1);
  });
  for (const button of ui.mobileThrottleButtons) {
    button.addEventListener("click", () => {
      setThrottleValue(button.dataset.throttle || 100, true);
    });
  }
  if (ui.mobileCenterBtn) {
    ui.mobileCenterBtn.addEventListener("click", () => {
      const ship = getLatestOwnShip(app.selectedShipKey);
      if (ship) {
        camera.centerCameraOn(ship.x, ship.y, false);
      }
    });
  }
  if (ui.mobileZoomOutBtn) {
    ui.mobileZoomOutBtn.addEventListener("click", () => {
      camera.adjustCameraZoom(-1);
    });
  }
  if (ui.mobileZoomInBtn) {
    ui.mobileZoomInBtn.addEventListener("click", () => {
      camera.adjustCameraZoom(1);
    });
  }

  bindPressButton(ui.splitOneBtn, () => {
    sendAction({ type: "split", level: 1 });
  });
  bindPressButton(ui.mobileSplitOneBtn, () => {
    sendAction({ type: "split", level: 1 });
  });

  bindPressButton(ui.splitTwoBtn, () => {
    sendAction({ type: "split", level: 2 });
  });
  bindPressButton(ui.mobileSplitTwoBtn, () => {
    sendAction({ type: "split", level: 2 });
  });

  bindPressButton(ui.scoutBtn, () => {
    const seq = sendAction({
      type: "launch_scout",
      zoneId: app.selectedZoneId,
      shipKey: app.selectedShipKey,
    });
    if (seq !== null) {
      log(t("侦查机已派往战区 {zone}", { zone: app.selectedZoneId }));
    }
  });
  bindPressButton(ui.mobileScoutBtn, () => {
    const seq = sendAction({
      type: "launch_scout",
      zoneId: app.selectedZoneId,
      shipKey: app.selectedShipKey,
    });
    if (seq !== null) {
      log(t("侦查机已派往战区 {zone}", { zone: app.selectedZoneId }));
    }
  });
  bindPressButton(ui.autoScoutBtn, toggleAutoScoutOnline);
  bindPressButton(ui.mobileAutoScoutBtn, toggleAutoScoutOnline);
  bindPressButton(ui.brakeBtn, useEmergencyBrakeOnline);
  bindPressButton(ui.mobileBrakeBtn, useEmergencyBrakeOnline);

  bindPressButton(ui.flagshipBtn, useFlagshipSkillOnline);
  bindPressButton(ui.mobileFlagshipBtn, useFlagshipSkillOnline);
  bindPressButton(ui.subSkillBtn, useSubSkillOnline);
  bindPressButton(ui.mobileSubSkillBtn, useSubSkillOnline);

  bindBattleExitGuard();

  // 桌面右键用于设航线:窗口级屏蔽右键菜单——含「右键拖动后在画布外松开」的情况,
  // 避免 Windows 右键拖动触发浏览器手势/右键菜单。随 ac 在卸载时自动移除。
  addWin("contextmenu", (event) => {
    if (!app.mobileMode) {
      event.preventDefault();
    }
  });

  canvas.addEventListener("mousedown", (event) => {
    if (app.mobileMode) {
      return;
    }
    if (!canControlBattle()) {
      return;
    }
    if (app.pendingSubSkillAim) {
      return; // 技能瞄准中不处理航线
    }

    const state = app.lastRenderState;
    if (!state) {
      return;
    }
    const ship = getSelectedShipFromState(state);

    // 左键:抓取航线手柄拖拽 —— 控制点=调曲率,端点=调路径。没抓到手柄则交给 click 选战区。
    if (event.button === 0) {
      if (!ship || !ship.alive || !ship.canControl) {
        return;
      }
      const ownTeam = teamBySeat(state, app.seat);
      const route = getDisplayRouteForShip(ownTeam, ship);
      if (!route) {
        return;
      }
      const pos = camera.pointerFromEvent(event);
      const handle = routeHandleAtPoint(route, pos.x, pos.y);
      if (handle) {
        app.drag = { handle, shipKey: ship.key, lastSentAt: 0 };
      }
      return;
    }

    // 右键:在落点创建路径点(设目标,默认曲率;之后用左键拖控制点调曲率)
    if (event.button === 2) {
      event.preventDefault();
      if (!ship || !ship.alive || !ship.canControl) {
        log(t("当前舰船不可操作"));
        return;
      }
      const pos = camera.pointerFromEvent(event);
      app.pointer = pos;
      const seq = sendAction({
        type: "set_route",
        shipKey: ship.key,
        endX: pos.x,
        endY: pos.y,
        throttle: app.throttle,
        anchorToMain: ship.key === "main",
      });
      if (seq !== null) {
        applySetRouteOverride(ship.key, seq, pos.x, pos.y);
        log(t("{ship} 已设定航线(左键拖控制点调曲率/端点调路径)", { ship: shipDisplayName(ship) }));
      }
    }
  });

  canvas.addEventListener("mousemove", (event) => {
    if (app.mobileMode) {
      app.pointer = camera.pointerFromEvent(event);
      return;
    }
    app.pointer = camera.pointerFromEvent(event);
    if (!app.drag || !canControlBattle()) {
      return;
    }

    const elapsedMs = performance.now();
    if (elapsedMs - app.drag.lastSentAt < DRAG_SEND_INTERVAL_MS) {
      return;
    }

    const pos = camera.pointerFromEvent(event);
    let seq = null;

    if (app.drag.handle === "control") {
      seq = sendAction({
        type: "route_control",
        shipKey: app.drag.shipKey,
        controlX: pos.x,
        controlY: pos.y,
      });
      if (seq !== null) {
        applyRouteControlOverride(app.drag.shipKey, seq, pos.x, pos.y);
      }
    } else if (app.drag.handle === "end") {
      seq = sendAction({
        type: "route_end",
        shipKey: app.drag.shipKey,
        endX: pos.x,
        endY: pos.y,
      });
      if (seq !== null) {
        applyRouteEndOverride(app.drag.shipKey, seq, pos.x, pos.y);
      }
    }

    app.drag.lastSentAt = elapsedMs;
  });

  addWin("mouseup", () => {
    if (app.mobileMode) {
      return;
    }
    if (app.drag) {
      app.drag = null;
      app.suppressClick = true; // 拖拽手柄结束后,抑制这次 click 的战区切换
    }
  });

  canvas.addEventListener("wheel", (event) => {
    if (app.mobileMode || !app.room || app.room.status !== "running") {
      return;
    }
    event.preventDefault();
    const focus = camera.screenPointFromEvent(event);
    camera.adjustCameraZoom(event.deltaY < 0 ? 1 : -1, focus);
  }, { passive: false });

  canvas.addEventListener("click", (event) => {
    if (event.button !== 0) {
      return;
    }
    if (app.suppressClick) {
      app.suppressClick = false;
      return;
    }

    const state = app.lastRenderState;
    if (!state) {
      return;
    }

    const screenPos = camera.screenPointFromEvent(event);
    const pos = camera.pointerFromEvent(event);
    if (app.mobileMode && app.pendingSubSkillAim && canControlBattle()) {
      if (handleMinimapTap(screenPos, state, { allowZoneLog: false })) {
        return;
      }
      const ship = getLatestOwnShip(app.pendingSubSkillAim.shipKey);
      const meta = currentSubMeta(ship);
      const seq = sendAction({
        type: "cast_sub_skill",
        shipKey: app.pendingSubSkillAim.shipKey,
        targetX: pos.x,
        targetY: pos.y,
      });
      app.pendingSubSkillAim = null;
      if (seq !== null) {
        log(t("{name} 已发动", { name: meta ? meta.name : t("分舰技能") }));
      }
      return;
    }

    if (app.mobileMode && canControlBattle()) {
      if (handleMinimapTap(screenPos, state)) {
        return;
      }
      const tappedShip = shipAtPoint(teamBySeat(state, app.seat), pos.x, pos.y, app.mobileMode);
      if (tappedShip) {
        selectShip(tappedShip.key, state);
        return;
      }
      const ship = getLatestOwnShip(app.selectedShipKey);
      if (!ship || !ship.alive || !ship.canControl) {
        return;
      }
      const seq = sendAction({
        type: "set_route",
        shipKey: ship.key,
        endX: pos.x,
        endY: pos.y,
        throttle: app.throttle,
        anchorToMain: ship.key === "main",
      });
      if (seq !== null) {
        applySetRouteOverride(ship.key, seq, pos.x, pos.y);
      }
      return;
    }

    if (app.pendingSubSkillAim && canControlBattle()) {
      const ship = getLatestOwnShip(app.pendingSubSkillAim.shipKey);
      const meta = currentSubMeta(ship);
      const seq = sendAction({
        type: "cast_sub_skill",
        shipKey: app.pendingSubSkillAim.shipKey,
        targetX: pos.x,
        targetY: pos.y,
      });
      app.pendingSubSkillAim = null;
      if (seq !== null) {
        log(t("{name} 已发动", { name: meta ? meta.name : t("分舰技能") }));
      }
      return;
    }

    const zone = zoneFromPoint(state, pos.x, pos.y);
    if (!zone) {
      return;
    }

    setSelectedZoneId(zone.id);
  });

  // 双击设目标点的旧逻辑已移除 → 改用右键单击(见上方 mousedown)。

  addWin("keydown", (event) => {
    if (event.defaultPrevented) {
      return;
    }
    const active = document.activeElement;
    if (
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.tagName === "SELECT" ||
        active.isContentEditable)
    ) {
      return;
    }

    const shipByKey = {
      Digit1: "main",
      Digit2: "sub1",
      Digit3: "sub2",
      Numpad1: "main",
      Numpad2: "sub1",
      Numpad3: "sub2",
    };
    const nextShip = shipByKey[event.code];
    if (nextShip) {
      if (selectShip(nextShip, app.lastRenderState || (app.latestSnapshot ? app.latestSnapshot.state : null))) {
        event.preventDefault();
      }
      return;
    }

    const state = app.lastRenderState || (app.latestSnapshot ? app.latestSnapshot.state : null);

    if (event.code === "Tab") {
      event.preventDefault();
      const own = teamBySeat(state, app.seat);
      if (!own?.ships) {
        return;
      }
      const keys = ["main", "sub1", "sub2"];
      const currentIdx = keys.indexOf(app.selectedShipKey);
      const dir = event.shiftKey ? -1 : 1;
      for (let i = 1; i <= 3; i += 1) {
        const candidate = keys[(currentIdx + i * dir + 3) % 3];
        if (selectShip(candidate, state)) {
          break;
        }
      }
      return;
    }

    const zoneId = app.selectedZoneId;
    const row = Math.floor((zoneId - 1) / 3);
    const col = (zoneId - 1) % 3;
    let newRow = row;
    let newCol = col;
    if (event.code === "KeyW") newRow = Math.max(0, row - 1);
    else if (event.code === "KeyS") newRow = Math.min(2, row + 1);
    else if (event.code === "KeyA") newCol = Math.max(0, col - 1);
    else if (event.code === "KeyD") newCol = Math.min(2, col + 1);

    if (newRow !== row || newCol !== col) {
      event.preventDefault();
      setSelectedZoneId(newRow * 3 + newCol + 1);
      return;
    }

    if (event.code === "Enter") {
      event.preventDefault();
      if (!canControlBattle() || !state?.zones) {
        return;
      }
      const zone = state.zones.find((item) => item.id === app.selectedZoneId);
      const ship = getLatestOwnShip(app.selectedShipKey);
      if (!zone || !ship || !ship.alive || !ship.canControl) {
        return;
      }
      const cx = zone.x + zone.width * 0.5;
      const cy = zone.y + zone.height * 0.5;
      const seq = sendAction({
        type: "set_route",
        shipKey: ship.key,
        endX: cx,
        endY: cy,
        throttle: app.throttle,
        anchorToMain: ship.key === "main",
      });
      if (seq !== null) {
        applySetRouteOverride(ship.key, seq, cx, cy);
        log(t("{ship} 向战区 {zone} 中心进发", { ship: shipCharacterName(ship), zone: app.selectedZoneId }));
      }
      return;
    }

    if (event.code === "KeyX") {
      event.preventDefault();
      if (!canControlBattle()) {
        return;
      }
      const seq = sendAction({
        type: "launch_scout",
        zoneId: app.selectedZoneId,
      });
      if (seq !== null) {
        log(t("侦查机已派往战区 {zone}", { zone: app.selectedZoneId }));
      }
      return;
    }

    if (event.code === "KeyZ") {
      event.preventDefault();
      if (!canControlBattle()) {
        return;
      }
      toggleAutoScoutOnline();
      return;
    }

    if (event.code === "KeyB") {
      event.preventDefault();
      if (!canControlBattle()) {
        return;
      }
      useEmergencyBrakeOnline();
      return;
    }

    if (event.code === "KeyC") {
      event.preventDefault();
      if (!canControlBattle()) {
        return;
      }
      useFlagshipSkillOnline();
      return;
    }

    if (event.code === "KeyV") {
      event.preventDefault();
      if (!canControlBattle()) {
        return;
      }
      useSubSkillOnline();
      return;
    }

    if (event.code === "Equal" || event.code === "NumpadAdd") {
      event.preventDefault();
      camera.adjustCameraZoom(1);
      return;
    }
    if (event.code === "Minus" || event.code === "NumpadSubtract") {
      event.preventDefault();
      camera.adjustCameraZoom(-1);
      return;
    }
    if (event.code === "Digit0" || event.code === "Numpad0") {
      event.preventDefault();
      camera.setCameraZoom(CAMERA_ZOOM_MIN);
    }
  });
  addWin("resize", () => {
    syncResponsiveMode();
    updateBattleStatus(currentBattleState());
  });
}

// 倒计时与正式交战都属于本局进行中——大厅/等待/结算时返回主菜单不拦。
function isBattleInProgress() {
  return Boolean(
    app &&
    app.room &&
    (app.room.status === "countdown" || app.room.status === "running") &&
    !app.spectating,
  );
}

// 战斗中误触「返回主菜单」保护:进行中先弹二次确认,确认后才 SPA 跳转。
// 链接在冒泡阶段先于 router 的 document 级监听触发,preventDefault 即可拦住路由跳转。
function bindBattleExitGuard() {
  const links = document.querySelectorAll("#battleView .btn-link-home, #battleView .mobile-menu-btn");
  for (const link of links) {
    link.addEventListener(
      "click",
      async (event) => {
        if (!isBattleInProgress()) {
          return; // 非战斗中:放行,交给 router 正常跳转
        }
        event.preventDefault();
        event.stopPropagation();
        const ok = await showConfirm({
          title: t("返回主菜单？"),
          body: t("当前对战尚未结束，返回后本局进度将丢失。"),
          confirmText: t("返回主菜单"),
          cancelText: t("继续战斗"),
          danger: true,
        });
        if (ok) {
          const href = link.getAttribute("href") || "/";
          if (typeof window.__navigate === "function") {
            window.__navigate(href);
          } else {
            window.location.assign(href);
          }
        }
      },
      ac ? { signal: ac.signal } : undefined,
    );
  }
}

// ── 可挂载入口 ──
export function mount(root) {
  root.innerHTML = onlineTemplate();
  cacheDom();
  initApp();
  camera = createBattleCamera({
    canvas,
    isMobile: () => app.mobileMode,
    mobileZoomEnabled: () => !isSpectatorMode(), // 观战要纵览全场,不做移动端基础放大
    overviewWhenIdle: () => isSpectatorMode(), // 观战未手动放大时固定全图视角
    getTrackedShip: () => getSelectedShipFromState(currentBattleState()),
    onZoomChanged: () => updateBattleStatus(currentBattleState()),
  });
  ac = new AbortController();
  running = true;
  lobbyStarfieldAc = new AbortController();
  startStarfield(root.querySelector(".page-stars"), lobbyStarfieldAc.signal);
  setBattleControlsEnabled(false);
  setRoomHudVisible(true);
  updateTeamCommUi();
  updateConnectionUi();
  syncResponsiveMode();
  bindUiEvents();
  connectServer();
  rafId = requestAnimationFrame(renderFrame);
  return unmount;
}

function unmount() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  stopPingLoop();
  if (app && app.throttleSendTimer) {
    clearTimeout(app.throttleSendTimer);
    app.throttleSendTimer = null;
  }
  disconnectServer();
  destroyOnlineFluidBackdrop();
  lobbyStarfieldAc?.abort();
  lobbyStarfieldAc = null;
  if (ac) ac.abort();
  ac = null;
  if (charSelect && typeof charSelect.hide === "function") {
    charSelect.hide();
  }
  charSelect = null;
}


function onlineTemplate() {
  return `
    <div class="online-root">
      <!-- ── 独立大厅页 ── -->
      <section id="lobbyView" class="lobby-view">
        <canvas class="page-stars" aria-hidden="true"></canvas>
        <div class="page-bg" aria-hidden="true"></div>
        <div class="lobby-frame">
          <header class="lobby-head">
            <a class="page-back" href="/">${t("‹ 主菜单")}</a>
            <h1 class="lobby-title">${t("在线对战大厅")}</h1>
            <div class="lobby-conn">
              <strong id="connectionValue">${t("未连接")}</strong>
              <strong id="seatValue">-</strong>
            </div>
          </header>

          <div class="lobby-grid">
            <section class="lobby-card">
              <h2 class="lobby-card-title">${t("指挥官")}</h2>
              <div id="onlineNicknameValue" class="compact-meta">${t("昵称：-")}</div>
              <div class="zone-pick">
                <label for="playerNameInput">${t("昵称")}</label>
                <input id="playerNameInput" maxlength="16" type="text" placeholder="${t("输入昵称")}" />
              </div>
              <button id="applyNameBtn">${t("保存昵称")}</button>

              <h2 class="lobby-card-title">${t("出战编队")}</h2>
              <div class="loadout-grid online-hidden">
                <label class="loadout-field" for="onlineMainRole"><span>${t("主舰")}</span><select id="onlineMainRole"></select></label>
                <label class="loadout-field" for="onlineSub1Role"><span>${t("副舰一")}</span><select id="onlineSub1Role"></select></label>
                <label class="loadout-field" for="onlineSub2Role"><span>${t("副舰二")}</span><select id="onlineSub2Role"></select></label>
              </div>
              <div id="onlineLoadoutPreview" class="loadout-preview"></div>
              <button id="openFleetSelectBtn" type="button">${t("选择出战编队")}</button>
              <button id="applyLoadoutOnlineBtn" class="online-hidden" type="button">${t("同步当前编队")}</button>
            </section>

            <section class="lobby-card">
              <h2 class="lobby-card-title">${t("连接")}</h2>
              <div class="btn-row">
                <button id="connectBtn">${t("重新连接")}</button>
                <button id="disconnectBtn">${t("断开连接")}</button>
              </div>

              <h2 class="lobby-card-title">${t("开房 / 加入")}</h2>
              <div class="btn-row">
                <button id="createPublicBtn">${t("创建公开房")}</button>
                <button id="createPrivateBtn">${t("创建私人房")}</button>
              </div>
              <button id="create2v2Btn" type="button">${t("创建 2v2 公开房")}</button>
              <button id="createAiRoomBtn">${t("创建 AI 训练房")}</button>
              <div class="join-code-wrap">
                <input id="joinCodeInput" type="text" inputmode="numeric" maxlength="6" placeholder="${t("输入 6 位房间号")}" />
                <button id="joinCodeBtn">${t("加入私人房")}</button>
              </div>
              <button id="refreshRoomsBtn">${t("刷新公开房列表")}</button>

              <h2 class="lobby-card-title">${t("公开房")}</h2>
              <div id="roomList" class="room-list room-list-compact"></div>

              <div id="roomSummary" class="room-summary">${t("未进入房间")}</div>
              <div class="btn-row">
                <button id="readyRoomBtn" type="button" hidden>${t("准备")}</button>
                <button id="leaveRoomBtn" disabled>${t("离开房间")}</button>
              </div>
            </section>
          </div>

          <div class="net-debug-hidden" aria-hidden="true">
            <span id="serverTargetValue">-</span>
            <span id="pingValue">-</span>
            <span id="jitterValue">-</span>
            <span id="interpValue">-</span>
          </div>
        </div>
      </section>

      <!-- ── 战斗页:DOM 完全来自共享模板(src/battle/template.js) ── -->
      ${battleViewTemplate({
        shellClass: "online-shell",
        hidden: true,
        panelFooterHTML: `
        <section id="teamCommPanel" class="controls slim-controls team-comm-panel" hidden>
          <h2>${t("队内通信")}</h2>
          <div id="teamCommButtons" class="team-comm-buttons">
            <button type="button" data-comm-type="attack">${t("集火")}</button>
            <button type="button" data-comm-type="support">${t("支援")}</button>
            <button type="button" data-comm-type="danger">${t("危险")}</button>
            <button type="button" data-comm-type="retreat">${t("撤退")}</button>
            <button type="button" data-comm-type="ack">${t("收到")}</button>
            <button type="button" data-comm-type="emoji">${t("漂亮")}</button>
          </div>
          <div id="teamCommFeed" class="team-comm-feed" aria-live="polite"></div>
        </section>`,
        mobileExtraHTML: `
          <section id="mobileTeamCommPanel" class="mobile-team-comm-panel" hidden>
            <div id="mobileTeamCommButtons" class="mobile-team-comm-buttons">
              <button type="button" data-comm-type="attack">${t("集火")}</button>
              <button type="button" data-comm-type="support">${t("支援")}</button>
              <button type="button" data-comm-type="danger">${t("危险")}</button>
              <button type="button" data-comm-type="retreat">${t("撤退")}</button>
              <button type="button" data-comm-type="ack">${t("收到")}</button>
              <button type="button" data-comm-type="emoji">${t("漂亮")}</button>
            </div>
            <div id="mobileTeamCommFeed" class="team-comm-feed mobile-team-comm-feed" aria-live="polite"></div>
          </section>`,
        resultMetaClass: " result-match-meta",
        overlayActionsHTML: `<button id="overlayActionBtn" type="button">${t("返回大厅")}</button>`,
      })}
    </div>
  `;
}
