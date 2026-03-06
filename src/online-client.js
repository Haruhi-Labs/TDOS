import {
  CHARACTER_ORDER,
  CHARACTER_DEFS,
  DEFAULT_TEAM_LOADOUT,
  FIRE_ARC_BANDS,
  cloneLoadout,
  normalizeLoadout,
  skillMetaForCharacter,
} from "../shared/game-core.js";

const canvas = document.getElementById("onlineCanvas");
const ctx = canvas.getContext("2d");

const ui = {
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
  createAiRoomBtn: document.getElementById("createAiRoomBtn"),
  joinCodeInput: document.getElementById("joinCodeInput"),
  joinCodeBtn: document.getElementById("joinCodeBtn"),
  refreshRoomsBtn: document.getElementById("refreshRoomsBtn"),
  roomList: document.getElementById("roomList"),
  roomSummary: document.getElementById("roomSummary"),
  leaveRoomBtn: document.getElementById("leaveRoomBtn"),
  battleControls: document.getElementById("battleControls"),
  seatValue: document.getElementById("seatValue"),
  hullValue: document.getElementById("hullValueOnline"),
  energyValue: document.getElementById("energyValueOnline"),
  splitValue: document.getElementById("splitValueOnline"),
  zoneValue: document.getElementById("zoneValueOnline"),
  selectedValue: document.getElementById("onlineSelectedValue"),
  shipSelect: document.getElementById("onlineShipSelect"),
  shipSwitchButtons: Array.from(document.querySelectorAll("#onlineShipQuickSwitch .ship-switch-btn")),
  powerSlider: document.getElementById("onlinePowerSlider"),
  powerValue: document.getElementById("onlinePowerValue"),
  splitOneBtn: document.getElementById("onlineSplitOneBtn"),
  splitTwoBtn: document.getElementById("onlineSplitTwoBtn"),
  scoutBtn: document.getElementById("onlineScoutBtn"),
  flagshipBtn: document.getElementById("onlineFlagshipBtn"),
  subSkillBtn: document.getElementById("onlineSubSkillBtn"),
  onlineMainRole: document.getElementById("onlineMainRole"),
  onlineSub1Role: document.getElementById("onlineSub1Role"),
  onlineSub2Role: document.getElementById("onlineSub2Role"),
  onlineLoadoutPreview: document.getElementById("onlineLoadoutPreview"),
  applyLoadoutOnlineBtn: document.getElementById("applyLoadoutOnlineBtn"),
  onlineNicknameValue: document.getElementById("onlineNicknameValue"),
  onlineLog: document.getElementById("onlineLog"),
  onlineOverlay: document.getElementById("onlineOverlay"),
  onlineOverlayTitle: document.getElementById("onlineOverlayTitle"),
  onlineOverlayActionBtn: document.getElementById("onlineOverlayActionBtn"),
  roomHud: document.querySelector(".room-hud"),
  battleNameplate: document.getElementById("battleNameplate"),
  battleNameA: document.getElementById("battleNameA"),
  battleNameB: document.getElementById("battleNameB"),
};

const TAU = Math.PI * 2;
const ROUTE_HANDLE_RADIUS = 11;
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

const app = {
  ws: null,
  connected: false,
  playerId: null,
  room: null,
  seat: null,
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
  drag: null,
  suppressClick: false,
  lastRenderState: null,
  lastMatchPhase: null,
  pendingSubSkillAim: null,
  lastWinnerSeat: null,
  gameOverLogged: false,
  connectAttemptId: 0,
  playerLoadout: readStoredLoadout(),
  pointer: { x: canvas.width * 0.5, y: canvas.height * 0.5 },
  throttleSendTimer: null,
  stars: Array.from({ length: 260 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    r: Math.random() * 1.6 + 0.4,
    p: Math.random() * TAU,
  })),
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
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
  return clamp(x, padding, canvas.width - padding);
}

function clampToMapY(y, padding = 0) {
  return clamp(y, padding, canvas.height - padding);
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

function readStoredLoadout() {
  try {
    const raw = window.localStorage.getItem(ONLINE_LOADOUT_STORAGE_KEY);
    if (!raw) {
      return cloneLoadout(DEFAULT_TEAM_LOADOUT);
    }
    return normalizeLoadout(JSON.parse(raw), DEFAULT_TEAM_LOADOUT);
  } catch (_error) {
    return cloneLoadout(DEFAULT_TEAM_LOADOUT);
  }
}

function storeLoadout(loadout) {
  try {
    window.localStorage.setItem(ONLINE_LOADOUT_STORAGE_KEY, JSON.stringify(loadout));
  } catch (_error) {
    // 忽略本地存储失败
  }
}

function roleSlotLabel(slotKey) {
  if (slotKey === "main") {
    return "主舰";
  }
  if (slotKey === "sub1") {
    return "副舰一";
  }
  return "副舰二";
}

function roleSummaryLine(slotKey, characterId) {
  const def = CHARACTER_DEFS[characterId];
  const stat = def.stats;
  return `${roleSlotLabel(slotKey)} ${def.shortName} | 舰体${stat.hp} | 能量${stat.energy} | 航速${stat.speed} | 机动${stat.turnRate.toFixed(2)}`;
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
    main: `主舰 ${CHARACTER_DEFS[loadout.main].shortName}`,
    sub1: `副一 ${CHARACTER_DEFS[loadout.sub1].shortName}`,
    sub2: `副二 ${CHARACTER_DEFS[loadout.sub2].shortName}`,
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
  ui.onlineNicknameValue.textContent = `昵称：${name || "-"}`;
}

function setNickname(name, options = {}) {
  const { persist = true } = options;
  const safeName = sanitizeNickname(name);
  if (ui.playerNameInput) {
    ui.playerNameInput.value = safeName;
  }
  updateNicknameDisplay(safeName);
  if (persist && safeName) {
    writeCookie(NICKNAME_COOKIE_KEY, safeName, NICKNAME_COOKIE_MAX_AGE);
  }
  return safeName;
}

function log(message) {
  const row = document.createElement("div");
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  row.textContent = `[${time}] ${message}`;
  ui.onlineLog.prepend(row);
  while (ui.onlineLog.children.length > 40) {
    ui.onlineLog.removeChild(ui.onlineLog.lastChild);
  }
}

function updateConnectionUi() {
  ui.connectionValue.textContent = app.connected ? "已连接" : "未连接";
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
}

function setRoomHudVisible(visible) {
  if (!ui.roomHud) {
    return;
  }
  ui.roomHud.classList.toggle("hidden-in-battle", !visible);
}

function seatDisplayName(seat) {
  const fallback = seat === "A" ? "左翼舰队" : "右翼舰队";
  if (!app.room || !Array.isArray(app.room.players)) {
    return fallback;
  }
  const row = app.room.players.find((item) => item && item.seat === seat);
  if (!row) {
    return fallback;
  }
  const name = String(row.name || "").trim() || fallback;
  return row.isBot ? `${name}（AI）` : name;
}

function updateBattleNameplate() {
  if (!ui.battleNameplate || !ui.battleNameA || !ui.battleNameB) {
    return;
  }

  const active = Boolean(app.room && app.room.status === "running");
  ui.battleNameplate.classList.toggle("hidden-inactive", !active);

  if (!active) {
    ui.battleNameA.classList.remove("self");
    ui.battleNameB.classList.remove("self");
    return;
  }

  ui.battleNameA.textContent = seatDisplayName("A");
  ui.battleNameB.textContent = seatDisplayName("B");
  ui.battleNameA.classList.toggle("self", app.seat === "A");
  ui.battleNameB.classList.toggle("self", app.seat === "B");
}

function socketSend(payload) {
  if (!app.ws || app.ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  app.ws.send(JSON.stringify(payload));
  return true;
}

function bindPressButton(button, handler) {
  if (!button) {
    return;
  }
  let suppressClickUntil = 0;
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || button.disabled) {
      return;
    }
    suppressClickUntil = performance.now() + 320;
    event.preventDefault();
    handler();
  });
  button.addEventListener("click", (event) => {
    if (performance.now() < suppressClickUntil) {
      event.preventDefault();
      return;
    }
    if (button.disabled) {
      return;
    }
    handler();
  });
  button.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && !button.disabled) {
      event.preventDefault();
      handler();
    }
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
    list.push(`${pageProtocol}://${pageHost}/test-game/ws/`);
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
  app.drag = null;
  app.lastRenderState = null;
  app.lastMatchPhase = null;
  app.ackSeq = 0;
  app.pendingSubSkillAim = null;
  app.lastWinnerSeat = null;
  app.gameOverLogged = false;
  if (app.throttleSendTimer) {
    clearTimeout(app.throttleSendTimer);
    app.throttleSendTimer = null;
  }
}

function closeOverlay() {
  ui.onlineOverlay.classList.add("hidden");
  ui.onlineOverlayTitle.textContent = "";
  app.gameOverLogged = false;
}

function showMatchResultOverlay(winnerSeat) {
  app.lastWinnerSeat = winnerSeat || null;

  if (winnerSeat && winnerSeat === app.seat) {
    ui.onlineOverlayTitle.textContent = "胜利：敌方舰队已被击溃";
    if (!app.gameOverLogged) {
      log("战斗结束：我方舰队获胜");
    }
  } else if (winnerSeat) {
    ui.onlineOverlayTitle.textContent = "失败：我方舰队被歼灭";
    if (!app.gameOverLogged) {
      log("战斗结束：我方舰队战败");
    }
  } else {
    ui.onlineOverlayTitle.textContent = "战斗结束";
    if (!app.gameOverLogged) {
      log("战斗结束：平局");
    }
  }

  app.gameOverLogged = true;
  ui.onlineOverlay.classList.remove("hidden");
}

function connectServer() {
  const candidates = buildServerUrlCandidates();
  if (candidates.length === 0) {
    log("服务器地址不能为空");
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
      log("无法连接服务器：请确认本地 21246 或远程反向代理是否可用");
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
      log(`已连接服务器：${url}`);

      const name = setNickname(ui.playerNameInput ? ui.playerNameInput.value : "", { persist: true });
      if (name) {
        socketSend({ type: "set_name", name });
      }
      socketSend({ type: "set_loadout", loadout: app.playerLoadout });
      socketSend({ type: "list_rooms" });
      startPingLoop();
    });

    ws.addEventListener("close", () => {
      if (currentAttemptId !== app.connectAttemptId || app.ws !== ws) {
        return;
      }
      if (!opened && index < candidates.length - 1) {
        log(`连接失败，尝试备用地址：${candidates[index + 1]}`);
        tryConnect(index + 1);
        return;
      }

      app.connected = false;
      app.playerId = null;
      app.room = null;
      app.seat = null;
      updateRoomSummary();
      setBattleControlsEnabled(false);
      setRoomHudVisible(true);
      updateBattleNameplate();
      stopPingLoop();
      clearMatchRuntime();
      resetConnectionSyncState();
      closeOverlay();
      updateConnectionUi();
      log("连接已断开");
    });

    ws.addEventListener("error", () => {
      if (currentAttemptId !== app.connectAttemptId || app.ws !== ws) {
        return;
      }
      if (opened) {
        log("连接异常，请检查服务器状态");
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
  if (!app.ws) {
    return;
  }
  app.ws.close();
}

function updateRoomSummary() {
  if (!app.room) {
    ui.roomSummary.textContent = "未进入房间";
    ui.leaveRoomBtn.disabled = true;
    return;
  }

  const rows = [];
  rows.push(`房间ID：${app.room.roomId}`);
  rows.push(`类型：${app.room.mode === "ai" ? "AI 训练" : "玩家对战"}`);
  rows.push(`可见性：${app.room.visibility === "private" ? "私人" : "公开"}`);
  if (app.room.visibility === "private" && app.room.code) {
    rows.push(`房间号：${app.room.code}`);
  }
  rows.push(`状态：${roomStatusText(app.room.status)}`);
  for (const playerRow of app.room.players || []) {
    const seatText = playerRow.seat === "A" ? "A位" : "B位";
    const suffix = playerRow.isBot ? "（AI）" : "";
    const loadoutText = playerRow.loadout
      ? ` | ${CHARACTER_DEFS[playerRow.loadout.main].shortName}/${CHARACTER_DEFS[playerRow.loadout.sub1].shortName}/${CHARACTER_DEFS[playerRow.loadout.sub2].shortName}`
      : "";
    rows.push(`${seatText}：${playerRow.name}${suffix}${loadoutText}`);
  }

  ui.roomSummary.textContent = rows.join("\n");
  ui.leaveRoomBtn.disabled = false;
}

function roomStatusText(status) {
  if (status === "waiting") {
    return "等待玩家";
  }
  if (status === "running") {
    return "对战中";
  }
  if (status === "finished") {
    return "已结束";
  }
  return "未知";
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
    log(`服务器版本：${build}`);
  } else {
    log("服务器版本信息缺失，可能仍在运行旧版服务端");
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
}

function renderLobbyRooms(rooms) {
  ui.roomList.innerHTML = "";

  if (!rooms || rooms.length === 0) {
    const empty = document.createElement("div");
    empty.className = "room-item room-item-empty";
    empty.textContent = "当前没有公开房，可先创建一个。";
    ui.roomList.append(empty);
    return;
  }

  for (const room of rooms) {
    const item = document.createElement("div");
    item.className = "room-item";

    const title = document.createElement("div");
    title.className = "room-item-title";
    title.textContent = `${room.mode === "ai" ? "AI房" : "玩家对战房"} · ${room.roomId}`;

    const meta = document.createElement("div");
    meta.className = "room-item-meta";
    meta.textContent = `房主：${room.hostName} | 人数：${room.count}/${room.capacity} | 状态：${roomStatusText(room.status)}`;

    const joinBtn = document.createElement("button");
    joinBtn.textContent = "加入";
    joinBtn.disabled = !app.connected || Boolean(app.room) || room.status !== "waiting" || room.count >= room.capacity;
    joinBtn.addEventListener("click", () => {
      syncLoadoutToServer(false);
      socketSend({ type: "join_room", roomId: room.roomId });
    });

    item.append(title, meta, joinBtn);
    ui.roomList.append(item);
  }
}

function applyRoomState(message) {
  app.room = message.room || null;
  app.seat = message.self ? message.self.seat : null;
  if (message.self && message.self.loadout) {
    app.playerLoadout = normalizeLoadout(message.self.loadout, DEFAULT_TEAM_LOADOUT);
    syncLoadoutControls(app.playerLoadout);
  }

  updateRoomSummary();

  const roomStatus = app.room ? app.room.status : null;
  const canBattle = roomStatus === "running";
  const isFinished = roomStatus === "finished";
  setBattleControlsEnabled(Boolean(canBattle));
  setRoomHudVisible(!canBattle);
  updateBattleNameplate();
  updateShipSwitchLabels(app.playerLoadout);
  const loadoutLocked = Boolean(app.room && app.room.status === "running");
  for (const element of [ui.onlineMainRole, ui.onlineSub1Role, ui.onlineSub2Role, ui.applyLoadoutOnlineBtn]) {
    if (element) {
      element.disabled = loadoutLocked;
    }
  }

  if (app.seat === "A") {
    ui.seatValue.textContent = "A位（左翼舰队）";
  } else if (app.seat === "B") {
    ui.seatValue.textContent = "B位（右翼舰队）";
  } else {
    ui.seatValue.textContent = "-";
  }

  if (isFinished) {
    const latestWinner = app.latestSnapshot && app.latestSnapshot.state ? app.latestSnapshot.state.winnerSeat : null;
    showMatchResultOverlay(latestWinner || app.lastWinnerSeat || null);
  } else if (!canBattle) {
    clearMatchRuntime();
    closeOverlay();
    ui.hullValue.textContent = "-";
    ui.energyValue.textContent = "-";
    ui.splitValue.textContent = "-";
    ui.zoneValue.textContent = "战区 -";
    ui.selectedValue.textContent = "-";
    app.pendingSubSkillAim = null;
    updateSkillButtons(null);
  }

  if (app.room) {
    if (app.room.status === "waiting") {
      if (app.room.mode === "ai") {
        log("AI房准备中");
      } else {
        log("已进入房间，等待对手加入");
      }
    }
    if (app.room.status === "running") {
      log("对战开始");
    }
  }
}

function handleRoomClosed(message) {
  const reason = message.reason || "房间关闭";
  log(reason);
  app.room = null;
  app.seat = null;
  updateRoomSummary();
  setBattleControlsEnabled(false);
  setRoomHudVisible(true);
  updateBattleNameplate();
  clearMatchRuntime();
  closeOverlay();
  ui.zoneValue.textContent = "战区 -";
  updateSkillButtons(null);
}

function teamBySeat(state, seat) {
  if (!state || !state.teams) {
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
  return seat === "A" ? "B" : "A";
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
  syncShipSelectOptions(own);
  syncPowerFromSelectedShip(own);
  return true;
}

function energyPercentForShip(ship) {
  const max = Math.max(1, Number(ship?.fleetMaxEnergy) || Number(ship?.maxEnergy) || 1);
  const value = Number(ship?.fleetEnergy) || Number(ship?.energy) || 0;
  return Math.round((value / max) * 100);
}

function currentFlagshipMeta(own) {
  const loadout = own && own.loadout ? own.loadout : app.playerLoadout;
  return skillMetaForCharacter(loadout.main, "flagship");
}

function currentSubMeta(ship) {
  if (!ship || ship.key === "main") {
    return null;
  }
  return skillMetaForCharacter(ship.characterId, "sub");
}

function updateSkillButtons(own) {
  if (!own) {
    ui.scoutBtn.disabled = true;
    ui.flagshipBtn.disabled = true;
    ui.subSkillBtn.disabled = true;
    return;
  }
  const cooldowns = own.cooldowns || {};
  const selected = own.ships ? own.ships[app.selectedShipKey] : null;
  const mainShip = own.ships ? own.ships.main : null;
  const mainEnergy = Number(mainShip?.fleetEnergy) || 0;

  ui.scoutBtn.disabled = own.skillsDisabled || (cooldowns.scout || 0) > 0 || mainEnergy < 28;
  ui.scoutBtn.textContent = own.skillsDisabled
    ? "派出侦查机（已被封印）"
    : (cooldowns.scout || 0) > 0
      ? `派出侦查机（冷却${(cooldowns.scout || 0).toFixed(1)}秒）`
      : "派出侦查机";

  const flagMeta = currentFlagshipMeta(own);
  if (!flagMeta) {
    ui.flagshipBtn.disabled = true;
    ui.flagshipBtn.textContent = "旗舰技能";
  } else if (flagMeta.type === "passive") {
    ui.flagshipBtn.disabled = true;
    ui.flagshipBtn.textContent = `旗舰技能：${flagMeta.name}（被动）`;
  } else {
    const disabled =
      own.skillsDisabled ||
      (cooldowns.flagship || 0) > 0 ||
      mainEnergy < (flagMeta.cost || 0) ||
      !(mainShip && mainShip.alive);
    ui.flagshipBtn.disabled = disabled;
    ui.flagshipBtn.textContent =
      (cooldowns.flagship || 0) > 0
        ? `旗舰技能：${flagMeta.name}（冷却${(cooldowns.flagship || 0).toFixed(1)}秒）`
        : `旗舰技能：${flagMeta.name}`;
  }

  const subMeta = currentSubMeta(selected);
  if (!selected || !subMeta) {
    ui.subSkillBtn.disabled = true;
    ui.subSkillBtn.textContent = "分舰技能：切换到副舰后使用";
    return;
  }

  const detached = !selected.attached && selected.canControl;
  const energy = Number(selected.fleetEnergy) || 0;
  const cooldown = Number(cooldowns[selected.key] || 0);
  const disabled = own.skillsDisabled || !detached || cooldown > 0 || energy < (subMeta.cost || 0);

  let suffix = "";
  if (own.skillsDisabled) {
    suffix = "（已被封印）";
  } else if (!detached) {
    suffix = "（分离后可用）";
  } else if (cooldown > 0) {
    suffix = `（冷却${cooldown.toFixed(1)}秒）`;
  } else if (app.pendingSubSkillAim && app.pendingSubSkillAim.shipKey === selected.key) {
    suffix = subMeta.target === "optional_point" ? "（地图点击闪现，再点按钮原地释放）" : "（地图点击瞄准）";
  }
  ui.subSkillBtn.disabled = disabled;
  ui.subSkillBtn.textContent = `分舰技能：${subMeta.name}${suffix}`;
}

function updateBattleStatus(state) {
  const own = teamBySeat(state, app.seat);
  if (!own) {
    ui.hullValue.textContent = "-";
    ui.energyValue.textContent = "-";
    ui.splitValue.textContent = "-";
    ui.zoneValue.textContent = "战区 -";
    ui.selectedValue.textContent = "-";
    updateSkillButtons(null);
    return;
  }

  ui.hullValue.textContent = `${Math.round((own.hullRatio || 0) * 100)}%`;
  ui.splitValue.textContent = own.splitLevel === 0 ? "编队" : own.splitLevel === 1 ? "一级分离" : "二级分离";
  ui.zoneValue.textContent = `战区 ${app.selectedZoneId}`;

  syncShipSelectOptions(own);
  const selectedShip = own.ships ? own.ships[app.selectedShipKey] : null;
  ui.energyValue.textContent = `${energyPercentForShip(selectedShip || own.ships.main)}%`;
  ui.selectedValue.textContent =
    selectedShip && selectedShip.alive
      ? `${selectedShip.characterName} | 能量 ${Math.round(Number(selectedShip.fleetEnergy) || 0)}/${Math.round(
          Number(selectedShip.fleetMaxEnergy) || 1,
        )}`
      : "无";
  ui.splitOneBtn.disabled = own.splitLevel >= 1;
  ui.splitTwoBtn.disabled = own.splitLevel < 1 || own.splitLevel >= 2;
  updateSkillButtons(own);
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

  if (Number.isInteger(message.ackSeq)) {
    app.ackSeq = Math.max(app.ackSeq, message.ackSeq);
    pruneAckedOverrides(snapshot.state);
  }

  updateInterpolationDelay();

  updateBattleStatus(snapshot.state);
  const ownTeam = teamBySeat(snapshot.state, app.seat);
  if (ownTeam) {
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
  } else if (phase === "finished" && ui.onlineOverlay.classList.contains("hidden")) {
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

  if (type === "error") {
    log(`错误：${message.message || "未知错误"}`);
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

function pointerFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (canvas.width / rect.width);
  const y = (event.clientY - rect.top) * (canvas.height / rect.height);
  return {
    x: clamp(x, 0, canvas.width),
    y: clamp(y, 0, canvas.height),
  };
}

function zoneFromPoint(x, y, state) {
  const zones = state && state.zones ? state.zones : null;
  if (!zones) {
    return null;
  }
  return zones.find((zone) => x >= zone.x && x < zone.x + zone.width && y >= zone.y && y < zone.y + zone.height) || null;
}

function routeHandleAtPoint(route, x, y) {
  if (!route) {
    return null;
  }
  if (distance(x, y, route.p1.x, route.p1.y) <= ROUTE_HANDLE_RADIUS) {
    return "control";
  }
  if (distance(x, y, route.p2.x, route.p2.y) <= ROUTE_HANDLE_RADIUS + 1.5) {
    return "end";
  }
  return null;
}

function getSelectedShipFromState(state) {
  const own = teamBySeat(state, app.seat);
  if (!own || !own.ships) {
    return null;
  }
  return own.ships[app.selectedShipKey] || null;
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

function interpolateProjectileList(previousList, nextList, t) {
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
      result.push(current);
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

  return {
    ...b,
    energy: lerp(a.energy, b.energy, t),
    hullRatio: lerp(a.hullRatio, b.hullRatio, t),
    cooldowns: {
      scout: lerp(a.cooldowns?.scout || 0, b.cooldowns?.scout || 0, t),
      haruhi: lerp(a.cooldowns?.haruhi || 0, b.cooldowns?.haruhi || 0, t),
      beam: lerp(a.cooldowns?.beam || 0, b.cooldowns?.beam || 0, t),
    },
    ships: {
      main: interpolateShip(a.ships.main, b.ships.main, t),
      sub1: interpolateShip(a.ships.sub1, b.ships.sub1, t),
      sub2: interpolateShip(a.ships.sub2, b.ships.sub2, t),
    },
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

function extrapolateState(state, dt) {
  if (!state || !state.teams) {
    return state;
  }

  const safeDt = clamp(dt, 0, MAX_EXTRAPOLATE_MS / 1000);
  return {
    ...state,
    elapsed: state.elapsed + safeDt,
    teams: {
      A: {
        ...state.teams.A,
        ships: {
          main: extrapolateShip(state.teams.A.ships.main, safeDt),
          sub1: extrapolateShip(state.teams.A.ships.sub1, safeDt),
          sub2: extrapolateShip(state.teams.A.ships.sub2, safeDt),
        },
      },
      B: {
        ...state.teams.B,
        ships: {
          main: extrapolateShip(state.teams.B.ships.main, safeDt),
          sub1: extrapolateShip(state.teams.B.ships.sub1, safeDt),
          sub2: extrapolateShip(state.teams.B.ships.sub2, safeDt),
        },
      },
    },
  };
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
  return {
    ...team,
    ships: {
      main: smoothEntity(team.ships.main, dt, followRate, teleportDistance),
      sub1: smoothEntity(team.ships.sub1, dt, followRate, teleportDistance),
      sub2: smoothEntity(team.ships.sub2, dt, followRate, teleportDistance),
    },
    scouts: Array.isArray(team.scouts) ? team.scouts.map((item) => smoothEntity(item, dt, followRate - 2, teleportDistance * 0.9)) : [],
    wingmen: Array.isArray(team.wingmen) ? team.wingmen.map((item) => smoothEntity(item, dt, followRate - 2, teleportDistance * 0.9)) : [],
  };
}

function stabilizeRenderState(state) {
  if (!state || !state.teams) {
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
  return {
    ...state,
    teams: {
      A: smoothTeamState(state.teams.A, ownSeat === "A", dt),
      B: smoothTeamState(state.teams.B, ownSeat === "B", dt),
    },
  };
}

function interpolateSnapshotState(previousSnapshot, nextSnapshot, t) {
  return {
    ...nextSnapshot.state,
    elapsed: lerp(previousSnapshot.state.elapsed, nextSnapshot.state.elapsed, t),
    phase: nextSnapshot.state.phase,
    winnerSeat: nextSnapshot.state.winnerSeat,
    projectiles: interpolateProjectileList(previousSnapshot.state.projectiles, nextSnapshot.state.projectiles, t),
    bursts: interpolateVisualList(previousSnapshot.state.bursts, nextSnapshot.state.bursts, t),
    floatingTexts: interpolateVisualList(previousSnapshot.state.floatingTexts, nextSnapshot.state.floatingTexts, t),
    teams: {
      A: interpolateTeam(previousSnapshot.state.teams.A, nextSnapshot.state.teams.A, t),
      B: interpolateTeam(previousSnapshot.state.teams.B, nextSnapshot.state.teams.B, t),
    },
  };
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

function drawBackground(elapsed) {
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#040d18");
  gradient.addColorStop(0.5, "#071423");
  gradient.addColorStop(1, "#050b14");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const star of app.stars) {
    const alpha = 0.24 + Math.sin(elapsed * 1.6 + star.p) * 0.24 + 0.34;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#b7dbff";
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawZones(state) {
  if (!state || !state.zones) {
    return;
  }
  for (const zone of state.zones) {
    const selected = zone.id === app.selectedZoneId;
    ctx.strokeStyle = selected ? "#4ec9ff99" : "#2d5d884f";
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeRect(zone.x, zone.y, zone.width, zone.height);

    ctx.fillStyle = selected ? "#76d6ff" : "#5f8ab8";
    ctx.font = "bold 14px 'Noto Sans SC', 'PingFang SC', sans-serif";
    ctx.fillText(`战区 ${zone.id}`, zone.x + 10, zone.y + 20);
  }
}

function drawRoute(route, selected) {
  if (!route) {
    return;
  }

  const { p0, p1, p2 } = route;

  ctx.save();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = selected ? "#a6ebff66" : "#77d8ff55";
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.strokeStyle = selected ? "#c4f4ff" : "#8fe9ff";
  ctx.lineWidth = selected ? 2.8 : 2.2;
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
  ctx.stroke();

  if (selected) {
    ctx.fillStyle = "#ffdd8a";
    ctx.beginPath();
    ctx.arc(p1.x, p1.y, ROUTE_HANDLE_RADIUS, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#fff2bf";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#9af7b5";
    ctx.beginPath();
    ctx.arc(p2.x, p2.y, ROUTE_HANDLE_RADIUS - 1, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#ddffe8";
    ctx.stroke();
  }

  ctx.restore();
}

function drawShip(ship, color, selected, attached) {
  if (!ship || !ship.alive) {
    return;
  }

  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);

  const hullScale = ship.key === "main" ? 0.72 : ship.key === "twin" ? 0.56 : 0.62;
  ctx.globalAlpha = attached ? 0.84 : 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(16 * hullScale, 0);
  ctx.lineTo(-13 * hullScale, -10 * hullScale);
  ctx.lineTo(-6 * hullScale, 0);
  ctx.lineTo(-13 * hullScale, 10 * hullScale);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "#ffffffaa";
  ctx.lineWidth = 1;
  ctx.stroke();

  if (selected) {
    ctx.strokeStyle = "#ffe084";
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    ctx.arc(0, 0, ship.radius + 4, 0, TAU);
    ctx.stroke();
  }

  ctx.restore();

  const hpRatio = clamp((ship.hp || 0) / Math.max(1, ship.maxHp || 1), 0, 1);
  const energyRatio = clamp((ship.energy || 0) / Math.max(1, ship.maxEnergy || 1), 0, 1);
  ctx.fillStyle = "#0f1f31";
  ctx.fillRect(ship.x - 13, ship.y - ship.radius - 9, 26, 4);
  ctx.fillStyle = hpRatio > 0.35 ? "#72f5a8" : "#ff8a8a";
  ctx.fillRect(ship.x - 13, ship.y - ship.radius - 9, 26 * hpRatio, 4);
  ctx.fillStyle = "#10263d";
  ctx.fillRect(ship.x - 13, ship.y - ship.radius - 4, 26, 3);
  ctx.fillStyle = "#6ad8ff";
  ctx.fillRect(ship.x - 13, ship.y - ship.radius - 4, 26 * energyRatio, 3);
}

function drawScout(scout, isOwnTeam) {
  if (!scout || !scout.alive) {
    return;
  }

  if (Number.isFinite(scout.vision) && scout.vision > 0) {
    ctx.save();
    ctx.strokeStyle = isOwnTeam ? "#8adfff40" : "#ffb7c040";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(scout.x, scout.y, scout.vision, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(scout.x, scout.y);
  ctx.rotate(scout.angle || 0);
  ctx.fillStyle = isOwnTeam ? "#9de8ff" : "#ffb7c0";
  ctx.beginPath();
  ctx.moveTo(5, 0);
  ctx.lineTo(0, -3);
  ctx.lineTo(-5, 0);
  ctx.lineTo(0, 3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawWingman(wingman, isOwnTeam) {
  if (!wingman || !wingman.alive) {
    return;
  }
  ctx.save();
  ctx.translate(wingman.x, wingman.y);
  ctx.rotate(wingman.angle || 0);
  ctx.fillStyle = isOwnTeam ? "#ffe7aa" : "#ffc6b3";
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(-4, -3);
  ctx.lineTo(-2, 0);
  ctx.lineTo(-4, 3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBeam(beam) {
  if (!beam) {
    return;
  }
  const phase = beam.phase || "fire";
  const maxLife = Math.max(0.001, Number(beam.maxLife) || (phase === "charge" ? 1.15 : 0.28));
  const alpha = clamp((beam.life || 0) / maxLife, 0, 1);
  if (alpha <= 0) {
    return;
  }

  if (phase === "charge") {
    const progress = Number.isFinite(beam.progress) ? clamp(beam.progress, 0, 1) : clamp(1 - alpha, 0, 1);
    const pulse = 0.55 + Math.sin(performance.now() * 0.02 + (beam.id || 0)) * 0.45;
    const glow = 9 + progress * 22 + pulse * 4;

    ctx.save();
    ctx.globalAlpha = 0.14 + progress * 0.28;
    ctx.strokeStyle = beam.color || "#8ef8ff";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.moveTo(beam.x1, beam.y1);
    ctx.lineTo(beam.x2, beam.y2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = 0.35 + progress * 0.4;
    ctx.beginPath();
    ctx.arc(beam.x1, beam.y1, glow, 0, TAU);
    ctx.strokeStyle = "#8ef8ff";
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.globalAlpha = 0.22 + progress * 0.45;
    ctx.beginPath();
    ctx.arc(beam.x1, beam.y1, 4.5 + pulse * 3.5, 0, TAU);
    ctx.fillStyle = "#dfffff";
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = beam.color || "#8ef8ff";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(beam.x1, beam.y1);
  ctx.lineTo(beam.x2, beam.y2);
  ctx.stroke();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = "#ffffff";
  ctx.globalAlpha = alpha * 0.7;
  ctx.stroke();
  ctx.restore();
}

function drawProjectile(projectile, isOwnTeam) {
  if (!projectile || !projectile.alive) {
    return;
  }
  ctx.save();
  ctx.fillStyle = projectile.color || (isOwnTeam ? "#9be8ff" : "#ffc0bd");
  ctx.beginPath();
  ctx.arc(projectile.x, projectile.y, projectile.radius || 2, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawBurst(burst) {
  if (!burst) {
    return;
  }
  const alpha = clamp((burst.life || 0) / 0.35, 0, 1);
  if (alpha <= 0) {
    return;
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(burst.x, burst.y, burst.radius || 7, 0, TAU);
  ctx.strokeStyle = burst.color || "#ffdb9b";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawFloatingText(label) {
  if (!label) {
    return;
  }
  const alpha = clamp((label.life || 0) / 0.8, 0, 1);
  if (alpha <= 0) {
    return;
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = label.color || "#ffd178";
  ctx.font = "bold 12px 'Noto Sans SC', 'PingFang SC', sans-serif";
  ctx.fillText(label.text || "", label.x, label.y);
  ctx.restore();
}

function drawSelectedVisionCircle(ownTeam) {
  if (!ownTeam || !ownTeam.ships) {
    return;
  }
  const selected = ownTeam.ships[app.selectedShipKey];
  if (!selected || !selected.alive || !selected.vision) {
    return;
  }
  ctx.save();
  ctx.strokeStyle = "#8adfff3a";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(selected.x, selected.y, selected.vision, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function drawFireArcBand(ship, startDeg, endDeg, outerRadius, innerRadius, color, alpha = 0.2) {
  const start = ship.angle + (startDeg * Math.PI) / 180;
  const end = ship.angle + (endDeg * Math.PI) / 180;
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(ship.x, ship.y, outerRadius, start, end);
  ctx.arc(ship.x, ship.y, innerRadius, end, start, true);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawFireArcLabel(ship, offsetDeg, radius, text, color) {
  const angle = ship.angle + (offsetDeg * Math.PI) / 180;
  const x = ship.x + Math.cos(angle) * radius;
  const y = ship.y + Math.sin(angle) * radius;
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = "bold 10px 'Noto Sans SC', 'PingFang SC', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawSelectedFireArc(ownTeam) {
  if (!ownTeam || !ownTeam.ships) {
    return;
  }
  const ship = ownTeam.ships[app.selectedShipKey];
  if (!ship || !ship.alive) {
    return;
  }

  const outerRadius = clamp((ship.range || 0) * 0.22, 84, 124);
  const innerRadius = ship.radius + 14;
  const labelRadius = outerRadius - 12;

  if (ownTeam.loadout && ownTeam.loadout.main === "kyon") {
    drawFireArcBand(ship, -180, 180, outerRadius, innerRadius, "#7de4ff", 0.14);
    drawFireArcLabel(ship, 0, labelRadius, "均匀", "#b9f4ff");
    return;
  }

  for (const band of FIRE_ARC_BANDS) {
    let color = "#7bd8ff";
    let alpha = 0.14;
    if (band.multiplier === 1.5) {
      color = "#ffd56c";
      alpha = 0.24;
    } else if (band.multiplier === 0) {
      color = "#ff6e6e";
      alpha = 0.16;
    }
    drawFireArcBand(ship, band.startDeg, band.endDeg, outerRadius, innerRadius, color, alpha);
  }

  ctx.save();
  ctx.strokeStyle = "#d2f3ff66";
  ctx.lineWidth = 1;
  for (const boundaryDeg of [-150, -120, -60, 60, 120, 150, 180]) {
    const angle = ship.angle + (boundaryDeg * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(ship.x + Math.cos(angle) * innerRadius, ship.y + Math.sin(angle) * innerRadius);
    ctx.lineTo(ship.x + Math.cos(angle) * outerRadius, ship.y + Math.sin(angle) * outerRadius);
    ctx.stroke();
  }
  ctx.restore();

  drawFireArcLabel(ship, 0, labelRadius, "1x", "#bfefff");
  drawFireArcLabel(ship, 90, labelRadius, "1.5x", "#ffe7a1");
  drawFireArcLabel(ship, -90, labelRadius, "1.5x", "#ffe7a1");
  drawFireArcLabel(ship, 135, labelRadius, "1x", "#bfefff");
  drawFireArcLabel(ship, -135, labelRadius, "1x", "#bfefff");
  drawFireArcLabel(ship, 180, labelRadius, "0x", "#ffb0b0");
}

function drawSubSkillAimHint(ownTeam) {
  if (!app.pendingSubSkillAim || !ownTeam || !ownTeam.ships) {
    return;
  }
  const s = ownTeam.ships[app.pendingSubSkillAim.shipKey];
  if (!s || !s.alive || s.attached) {
    return;
  }
  ctx.save();
  ctx.strokeStyle = "#7ff4ff";
  ctx.lineWidth = 1.6;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  ctx.lineTo(app.pointer.x, app.pointer.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawNoDataHint() {
  ctx.save();
  ctx.fillStyle = "#c4dbf6";
  ctx.font = "16px 'Noto Sans SC', 'PingFang SC', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("等待网络同步数据...", canvas.width * 0.5, canvas.height * 0.5);
  ctx.restore();
}

function renderFrame() {
  const state = getRenderState();
  app.lastRenderState = state;

  const elapsed = state ? state.elapsed : nowSecond();
  drawBackground(elapsed || 0);

  if (!state) {
    drawNoDataHint();
    requestAnimationFrame(renderFrame);
    return;
  }

  drawZones(state);

  const ownSeat = app.seat || "A";
  const ownTeam = teamBySeat(state, ownSeat);
  const enemyTeam = teamBySeat(state, enemySeat(ownSeat));
  const visibleEnemyIds = new Set((ownTeam && ownTeam.visibleEnemyIds) || []);

  if (ownTeam && ownTeam.ships) {
    for (const ship of [...Object.values(ownTeam.ships), ...(ownTeam.extraShips || [])]) {
      if (!ship || !ship.alive) {
        continue;
      }
      const route = getDisplayRouteForShip(ownTeam, ship);
      if (!route) {
        continue;
      }
      drawRoute(route, ship.key === app.selectedShipKey);
    }
  }

  if (ownTeam && Array.isArray(ownTeam.beams)) {
    for (const beam of ownTeam.beams) {
      drawBeam(beam);
    }
  }
  if (enemyTeam && Array.isArray(enemyTeam.beams)) {
    for (const beam of enemyTeam.beams) {
      drawBeam(beam);
    }
  }

  if (Array.isArray(state.projectiles)) {
    for (const projectile of state.projectiles) {
      if (!projectile || !projectile.alive) {
        continue;
      }
      const isOwnProjectile = projectile.teamSeat === ownSeat;
      drawProjectile(projectile, isOwnProjectile);
    }
  }

  if (ownTeam && ownTeam.ships) {
    for (const ship of [...Object.values(ownTeam.ships), ...(ownTeam.extraShips || [])]) {
      drawShip(ship, ownTeam.color || "#65d9ff", ship.key === app.selectedShipKey, ship.attached);
    }
  }

  if (enemyTeam && enemyTeam.ships) {
    for (const ship of [...Object.values(enemyTeam.ships), ...(enemyTeam.extraShips || [])]) {
      if (!visibleEnemyIds.has(ship.id) && state.phase !== "finished") {
        continue;
      }
      drawShip(ship, enemyTeam.color || "#ff8692", false, ship.attached);
    }
  }

  if (ownTeam && Array.isArray(ownTeam.scouts)) {
    for (const scout of ownTeam.scouts) {
      drawScout(scout, true);
    }
  }
  if (enemyTeam && Array.isArray(enemyTeam.scouts)) {
    for (const scout of enemyTeam.scouts) {
      if (!visibleEnemyIds.has(scout.id) && state.phase !== "finished") {
        continue;
      }
      drawScout(scout, false);
    }
  }
  if (ownTeam && Array.isArray(ownTeam.wingmen)) {
    for (const wingman of ownTeam.wingmen) {
      drawWingman(wingman, true);
    }
  }
  if (enemyTeam && Array.isArray(enemyTeam.wingmen)) {
    for (const wingman of enemyTeam.wingmen) {
      if (!visibleEnemyIds.has(wingman.id) && state.phase !== "finished") {
        continue;
      }
      drawWingman(wingman, false);
    }
  }

  if (Array.isArray(state.bursts)) {
    for (const burst of state.bursts) {
      drawBurst(burst);
    }
  }
  if (Array.isArray(state.floatingTexts)) {
    for (const label of state.floatingTexts) {
      drawFloatingText(label);
    }
  }

  drawSelectedFireArc(ownTeam);
  drawSelectedVisionCircle(ownTeam);
  drawSubSkillAimHint(ownTeam);

  requestAnimationFrame(renderFrame);
}

function syncLoadoutToServer(logOnSuccess = true) {
  app.playerLoadout = readLoadoutFromControls();
  syncLoadoutControls(app.playerLoadout);
  storeLoadout(app.playerLoadout);
  const sent = socketSend({ type: "set_loadout", loadout: app.playerLoadout });
  if (logOnSuccess) {
    log(sent ? "当前编队已同步到服务器" : "当前编队已保存在本地，连接后会自动同步");
  }
}

function useFlagshipSkillOnline() {
  const own = teamBySeat(app.latestSnapshot ? app.latestSnapshot.state : null, app.seat);
  const meta = currentFlagshipMeta(own);
  if (!meta || meta.type !== "active") {
    return;
  }
  const seq = sendAction({ type: "cast_flagship_skill", zoneId: app.selectedZoneId });
  if (seq !== null) {
    log(`旗舰技能 ${meta.name} 已发动`);
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
        log(`${ship.characterName} 使用 ${meta.name}`);
      }
      updateSkillButtons(own);
      return;
    }
    app.pendingSubSkillAim = { shipKey: ship.key };
    log(
      meta.target === "optional_point"
        ? `${meta.name} 瞄准模式：点击地图选择闪现位置，再次点击技能按钮可原地释放`
        : `${meta.name} 瞄准模式：在地图上左键点击方向开火`,
    );
    updateSkillButtons(own);
    return;
  }
  const seq = sendAction({
    type: "cast_sub_skill",
    shipKey: ship.key,
    zoneId: app.selectedZoneId,
  });
  if (seq !== null) {
    log(`${ship.characterName} 使用 ${meta.name}`);
  }
}

function bindUiEvents() {
  ui.serverTargetValue.textContent = defaultServerUrl();
  const savedName = sanitizeNickname(readCookie(NICKNAME_COOKIE_KEY));
  const fallbackName = `玩家${Math.floor(Math.random() * 900 + 100)}`;
  setNickname(savedName || fallbackName, { persist: true });
  ui.zoneValue.textContent = `战区 ${app.selectedZoneId}`;
  ui.selectedValue.textContent = "主舰";
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

  ui.connectBtn.addEventListener("click", () => {
    connectServer();
  });

  ui.disconnectBtn.addEventListener("click", () => {
    disconnectServer();
  });

  ui.applyNameBtn.addEventListener("click", () => {
    const name = setNickname(ui.playerNameInput ? ui.playerNameInput.value : "", { persist: true });
    if (!name) {
      log("昵称不能为空");
      return;
    }
    const sent = socketSend({ type: "set_name", name });
    if (sent) {
      log(`昵称已设置为 ${name}`);
    } else {
      log(`昵称已保存为 ${name}（连接后将自动同步）`);
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

  ui.createAiRoomBtn.addEventListener("click", () => {
    syncLoadoutToServer(false);
    socketSend({ type: "create_room", visibility: "private", mode: "ai" });
  });

  ui.joinCodeBtn.addEventListener("click", () => {
    const code = ui.joinCodeInput.value.replace(/\D/g, "").slice(0, 6);
    if (code.length !== 6) {
      log("请输入 6 位房间号");
      return;
    }
    syncLoadoutToServer(false);
    socketSend({ type: "join_private", code });
  });

  ui.leaveRoomBtn.addEventListener("click", () => {
    socketSend({ type: "leave_room" });
    clearMatchRuntime();
    closeOverlay();
  });

  if (ui.onlineOverlayActionBtn) {
    ui.onlineOverlayActionBtn.addEventListener("click", () => {
      if (app.room) {
        socketSend({ type: "leave_room" });
      }
      closeOverlay();
    });
  }

  if (ui.shipSelect) {
    ui.shipSelect.addEventListener("change", () => {
      selectShip(ui.shipSelect.value);
    });
  }

  for (const button of ui.shipSwitchButtons) {
    button.addEventListener("click", () => {
      selectShip(button.dataset.ship || "");
    });
  }

  ui.powerSlider.addEventListener("input", () => {
    setThrottleFromSlider(true);
  });

  bindPressButton(ui.splitOneBtn, () => {
    sendAction({ type: "split", level: 1 });
  });

  bindPressButton(ui.splitTwoBtn, () => {
    sendAction({ type: "split", level: 2 });
  });

  bindPressButton(ui.scoutBtn, () => {
    const seq = sendAction({
      type: "launch_scout",
      zoneId: app.selectedZoneId,
    });
    if (seq !== null) {
      log(`侦查机已派往战区 ${app.selectedZoneId}`);
    }
  });

  bindPressButton(ui.flagshipBtn, useFlagshipSkillOnline);
  bindPressButton(ui.subSkillBtn, useSubSkillOnline);

  canvas.addEventListener("mousedown", (event) => {
    if (event.button !== 0) {
      return;
    }
    if (!app.room || app.room.status !== "running") {
      return;
    }

    const state = app.lastRenderState;
    if (!state) {
      return;
    }

    const ship = getSelectedShipFromState(state);
    if (!ship || !ship.alive || !ship.canControl) {
      return;
    }

    const ownTeam = teamBySeat(state, app.seat);
    const route = getDisplayRouteForShip(ownTeam, ship);
    if (!route) {
      return;
    }

    const pos = pointerFromEvent(event);
    const handle = routeHandleAtPoint(route, pos.x, pos.y);
    if (!handle) {
      return;
    }

    app.drag = {
      handle,
      shipKey: ship.key,
      lastSentAt: 0,
    };
  });

  canvas.addEventListener("mousemove", (event) => {
    app.pointer = pointerFromEvent(event);
    if (!app.drag || !app.room || app.room.status !== "running") {
      return;
    }

    const elapsedMs = performance.now();
    if (elapsedMs - app.drag.lastSentAt < DRAG_SEND_INTERVAL_MS) {
      return;
    }

    const pos = pointerFromEvent(event);
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

  window.addEventListener("mouseup", () => {
    if (app.drag) {
      app.drag = null;
      app.suppressClick = true;
    }
  });

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

    const pos = pointerFromEvent(event);
    if (app.pendingSubSkillAim && app.room && app.room.status === "running") {
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
        log(`${meta ? meta.name : "分舰技能"} 已发动`);
      }
      return;
    }

    const zone = zoneFromPoint(pos.x, pos.y, state);
    if (!zone) {
      return;
    }

    if (zone.id !== app.selectedZoneId) {
      app.selectedZoneId = zone.id;
      ui.zoneValue.textContent = `战区 ${zone.id}`;
      log(`已选择战区 ${zone.id}`);
    }
  });

  canvas.addEventListener("dblclick", (event) => {
    if (event.button !== 0) {
      return;
    }
    if (!app.room || app.room.status !== "running") {
      return;
    }
    if (app.pendingSubSkillAim) {
      return;
    }

    const pos = pointerFromEvent(event);
    const ship = getLatestOwnShip(app.selectedShipKey);
    if (!ship || !ship.alive || !ship.canControl) {
      log("当前舰船不可操作");
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
      log(`${ship.name} 已设定新航线`);
    }
  });

  window.addEventListener("keydown", (event) => {
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
    if (!nextShip) {
      return;
    }
    if (selectShip(nextShip, app.lastRenderState || (app.latestSnapshot ? app.latestSnapshot.state : null))) {
      event.preventDefault();
    }
  });
}

setBattleControlsEnabled(false);
setRoomHudVisible(true);
updateBattleNameplate();
updateConnectionUi();
bindUiEvents();
connectServer();
requestAnimationFrame(renderFrame);
