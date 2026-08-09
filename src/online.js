import {
  DEFAULT_TEAM_LOADOUT,
  DEFAULT_WORLD_SIZE,
  EMERGENCY_BRAKE_COST,
  SCOUT_LAUNCH_COST,
  clamp,
  cloneLoadout,
  distance,
  normalizeLoadout,
  skillMetaForCharacter,
} from "../shared/game-core.js";
import { matchActions } from "../shared/protocol/match-actions.js";
import { createOnlineStateSync } from "./online/state-sync.js";
import { buildServerUrlCandidates, defaultServerUrl } from "./online/connection-target.js";
import { createOnlineLobbyView } from "./online/lobby-view.js";
import {
  createOnlineProfileController,
  readStoredLoadout,
  storeLoadout,
} from "./online/profile-controller.js";
import { createOnlineResultView } from "./online/result-view.js";
import {
  createOnlineSnapshotTransport,
  DEFAULT_INTERP_MS,
} from "./online/snapshot-transport.js";
import { createThrottleCommandState } from "./online/throttle-command-state.js";

import { getFaction } from "./profile.js";

// 联机选角与单机共用同一套「翻书选角」覆盖层;立绘绘制与单机同源
import { createCharacterSelect, drawInGamePortrait } from "./character-select.js";
import { startStarfield } from "./starfield.js";
import { showConfirm } from "./confirm-dialog.js";
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
import { routeHandleAtPoint, zoneFromPoint } from "./battle/input.js";
import {
  syncThrottleGearControls,
  throttleGearFromShortcut,
  throttleValueForGear,
} from "./battle/throttle.js";
import {
  currentFlagshipMeta,
  currentSubMeta,
  energyPercentForShip,
  renderFleetRoster,
  syncMobileHud,
  updateSkillButtons,
} from "./battle/hud.js";
import { battleViewTemplate } from "./battle/template.js";
import { createRemoteBattleActionTransport } from "./battle/action-transport.js";
import { createMobileScoutJoystick } from "./battle/scout-joystick.js";
import { createBattleCanvasRenderer } from "./battle/webgl-canvas.js";
import {
  drawBackground,
  drawBattleCountdown,
  drawBattleWorld,
  drawMinimap,
  drawNoDataHint,
} from "./battle/render.js";
import {
  formatClockTime,
  shipCharacterName,
  shipDisplayName,
  splitLabel as localizedSplitLabel,
  t,
  translateServerText,
} from "./i18n.js";

// 可挂载模块状态：每次 mount 重新初始化（同一时刻只挂载一个模式）
let canvas, ctx, ui, app;
let canvasRenderer = null; // 可见大地图使用 WebGL2；WebGL1 兜底，2D 仅作极端应急
let ac = null; // AbortController：统一移除 window 级监听
let rafId = 0; // 渲染循环句柄
let running = false; // 渲染循环开关
let charSelect = null; // 选角覆盖层（与单机一致），卸载时移除
let camera = null; // 共享战场相机（src/battle/camera.js），mount 时创建
let stateSync = null; // 快照插值、外推和显示态平滑
let profileController = null; // 昵称、档案编队与对应 DOM 同步
let resultView = null; // 联机结算卡片
let lobbyView = null; // 大厅房间列表与摘要
let snapshotTransport = null; // 延迟测量、差量解码与快照队列
let actionTransport = null; // 统一动作协议的远程传输适配器
let throttleCommandState = null; // 每艘舰待权威快照确认的换挡意图

function addWin(type, handler) {
  window.addEventListener(type, handler, ac ? { signal: ac.signal } : undefined);
}

function cacheDom() {
  canvas = document.getElementById("gameCanvas");
  canvasRenderer = createBattleCanvasRenderer(canvas);
  ctx = canvasRenderer.ctx;
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
  createAiRoomBtn: document.getElementById("createAiRoomBtn"),
  joinCodeInput: document.getElementById("joinCodeInput"),
  joinCodeBtn: document.getElementById("joinCodeBtn"),
  refreshRoomsBtn: document.getElementById("refreshRoomsBtn"),
  roomList: document.getElementById("roomList"),
  roomSummary: document.getElementById("roomSummary"),
  leaveRoomBtn: document.getElementById("leaveRoomBtn"),
  battleControls: document.getElementById("battleControls"),
  seatValue: document.getElementById("seatValue"),
  hullValue: document.getElementById("hullValue"),
  energyValue: document.getElementById("energyValue"),
  splitValue: document.getElementById("splitValue"),
  zoneValue: document.getElementById("zoneValue"),
  selectedValue: document.getElementById("onlineSelectedValue"),
  shipSelect: document.getElementById("onlineShipSelect"),
  shipSwitchButtons: Array.from(document.querySelectorAll("#shipQuickSwitch .ship-switch-btn")),
  powerGearButtons: Array.from(document.querySelectorAll("#powerGearControl .throttle-gear-btn")),
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
const MAX_EXTRAPOLATE_MS = 180;
const DRAG_SEND_INTERVAL_MS = 75;
const ROUTE_OVERRIDE_MIN_HOLD_MS = 180;
const ROUTE_OVERRIDE_MAX_HOLD_MS = 1200;
const ROUTE_MATCH_P2_EPSILON = 30;
const ROUTE_MATCH_P1_EPSILON = 42;

function initApp() {
  app = {
  ws: null,
  connected: false,
  playerId: null,
  room: null,
  seat: null,
  spectating: false,
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
  networkProtocolVersion: 1,
  serverRulesetVersion: "",
  rulesetStatus: "pending",
  rulesetCompatible: false,
  snapshotIntervalMs: 1000 / 20,
  snapshots: [],
  latestSnapshot: null,
  lastSnapshotTick: 0,
  lastSnapshotSeq: 0,
  decodedSnapshotState: null,
  decodedSnapshotSeq: 0,
  lastSnapshotAckSentAt: 0,
  lastAckedSnapshotSeq: 0,
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
  destructionEffects: createShipDestructionEffects(),
  lastWinnerSeat: null,
  gameOverLogged: false,
  connectAttemptId: 0,
  playerLoadout: readStoredLoadout(),
  pointer: { x: LOGICAL * 0.5, y: LOGICAL * 0.5 },
  mobileMode: false,
  stars: Array.from({ length: 260 }, () => ({
    x: Math.random() * LOGICAL,
    y: Math.random() * LOGICAL,
    r: Math.random() * 1.6 + 0.4,
    p: Math.random() * TAU,
  })),
  };
  profileController = createOnlineProfileController({
    ui,
    getPlayerLoadout: () => app.playerLoadout,
  });
  resultView = createOnlineResultView({
    app,
    ui,
    log,
    now: () => stateSync?.estimateServerNowMs?.() ?? Date.now(),
  });
  lobbyView = createOnlineLobbyView({ app, ui, socketSend, syncLoadoutToServer });
  snapshotTransport = createOnlineSnapshotTransport({ app, nowMs, socketSend, updateConnectionUi, log });
  throttleCommandState = createThrottleCommandState();
  stateSync = createOnlineStateSync({
    app,
    nowMs,
    worldSize: LOGICAL,
    maxExtrapolateMs: MAX_EXTRAPOLATE_MS,
  });
  actionTransport = createRemoteBattleActionTransport({
    canSend: () => Boolean(
      app.room &&
      app.room.status === "running" &&
      app.connected &&
      app.rulesetCompatible &&
      app.seat &&
      !app.spectating
    ),
    nextSequence: () => {
      app.seq += 1;
      return app.seq;
    },
    sendEnvelope: socketSend,
    now: Date.now,
  });
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
  ui.connectionValue.textContent = !app.connected
    ? t("未连接")
    : app.rulesetStatus === "mismatch"
      ? t("规则版本不兼容")
      : t("已连接");
  ui.pingValue.textContent = app.connected ? `${Math.round(app.pingMs)}ms` : "-";
  ui.jitterValue.textContent = app.connected ? `${Math.round(app.jitterMs)}ms` : "-";
  ui.interpValue.textContent = app.connected ? `${Math.round(app.interpDelayMs)}ms` : "-";

  ui.connectBtn.disabled = app.connected;
  ui.disconnectBtn.disabled = !app.connected;
  const lobbyActionsDisabled = !app.connected || !app.rulesetCompatible || Boolean(app.room);
  ui.createPublicBtn.disabled = lobbyActionsDisabled;
  ui.createPrivateBtn.disabled = lobbyActionsDisabled;
  ui.createAiRoomBtn.disabled = lobbyActionsDisabled;
  ui.joinCodeBtn.disabled = lobbyActionsDisabled;
  ui.joinCodeInput.disabled = lobbyActionsDisabled;
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

// 大厅页与战斗页二选一全屏切换（visible=true 显示独立大厅页，false 显示战斗页）
function setRoomHudVisible(visible) {
  if (ui.lobbyView) ui.lobbyView.hidden = !visible;
  if (ui.battleView) ui.battleView.hidden = visible;
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

function canControlBattle() {
  return Boolean(app && app.connected && app.rulesetCompatible && app.room && app.room.status === "running" && app.seat && !app.spectating);
}

function validShipKey(shipKey) {
  return shipKey === "main" || shipKey === "sub1" || shipKey === "sub2" ? shipKey : "main";
}

function selectedShipKeyForSeat(state, seat) {
  const selectedShips = state && state.selectedShips ? state.selectedShips : null;
  return validShipKey(selectedShips && selectedShips[seat] ? selectedShips[seat] : "main");
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

function clearMatchRuntime() {
  snapshotTransport.resetMatchState();
  app.smoothEntities.clear();
  app.lastRenderMs = 0;
  app.routeOverrides.clear();
  throttleCommandState.clear();
  app.drag = null;
  app.lastRenderState = null;
  app.lastMatchPhase = null;
  camera.reset();
  app.ackSeq = 0;
  app.pendingSubSkillAim = null;
  resetShipDestructionEffects(app.destructionEffects);
  app.lastWinnerSeat = null;
  app.gameOverLogged = false;
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

  snapshotTransport.resetConnectionState();
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

      const name = profileController.setNickname(ui.playerNameInput ? ui.playerNameInput.value : "", { persist: true });
      if (name) {
        socketSend({ type: "set_name", name });
      }
      socketSend({ type: "set_loadout", loadout: app.playerLoadout });
      socketSend({ type: "list_rooms" });
      snapshotTransport.startPingLoop();
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
      app.spectating = false;
      lobbyView.updateRoomSummary();
      setBattleControlsEnabled(false);
      setRoomHudVisible(true);
      snapshotTransport.stopPingLoop();
      clearMatchRuntime();
      snapshotTransport.resetConnectionState();
      resultView.close();
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
  if (!app.ws) {
    return;
  }
  app.ws.close();
}

function applyRoomState(message) {
  const previousRoomId = app.room ? app.room.roomId : null;
  const previousSpectating = app.spectating;
  app.room = message.room || null;
  app.spectating = Boolean(message.self && message.self.spectating);
  app.seat = app.spectating ? null : message.self ? message.self.seat : null;
  if (app.room && (app.room.roomId !== previousRoomId || app.spectating !== previousSpectating)) {
    clearMatchRuntime();
  }
  if (message.self && message.self.loadout) {
    app.playerLoadout = normalizeLoadout(message.self.loadout, DEFAULT_TEAM_LOADOUT);
    profileController.syncLoadoutControls(app.playerLoadout);
  }

  lobbyView.updateRoomSummary();
  updateConnectionUi();

  const roomStatus = app.room ? app.room.status : null;
  const isCountdown = roomStatus === "countdown";
  const canBattle = roomStatus === "running";
  const isFinished = roomStatus === "finished";
  const showBattleView = isCountdown || canBattle || isFinished;
  setBattleControlsEnabled(Boolean(canBattle && !app.spectating && app.rulesetCompatible));
  setRoomHudVisible(!showBattleView);
  syncResponsiveMode();
  // 战斗页刚由 hidden 显示时,首次测量可能拿到 0 宽 → 下一帧布局就绪后再校准画布清晰度
  if (showBattleView) requestAnimationFrame(() => camera.resizeCanvas());
  profileController.updateShipSwitchLabels(app.playerLoadout);
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
    resultView.show(latestWinner || app.lastWinnerSeat || (app.room ? app.room.winnerSeat : null) || null);
  } else if (!canBattle && !isCountdown) {
    clearMatchRuntime();
    resultView.close();
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
  app.room = null;
  app.seat = null;
  app.spectating = false;
  lobbyView.updateRoomSummary();
  updateConnectionUi();
  setBattleControlsEnabled(false);
  setRoomHudVisible(true);
  clearMatchRuntime();
  resultView.close();
  ui.zoneValue.textContent = t("战区 -");
  refreshSkillButtons(null);
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
  const ship = team.ships[app.selectedShipKey];
  if (!ship) {
    return;
  }
  const throttle = throttleCommandState.valueFor(app.selectedShipKey, ship.throttle);
  const gear = syncThrottleGearControls(ui, throttle);
  app.throttle = throttleValueForGear(gear);
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
  const own = teamBySeat(state, app.seat);
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

  syncShipSelectOptions(own);
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

function handleSnapshot(message) {
  if (!app.room || message.roomId !== app.room.roomId) {
    return;
  }

  const snapshot = snapshotTransport.receiveSnapshot(message);
  if (!snapshot) return;

  if (Number.isInteger(message.ackSeq)) {
    app.ackSeq = Math.max(app.ackSeq, message.ackSeq);
    pruneAckedOverrides(snapshot.state);
  }

  snapshotTransport.updateInterpolationDelay();

  // HUD 全量 DOM 刷新压到 ~10Hz:20Hz 快照逐条刷文本/进度条会与 rAF 抢主线程(移动端尤甚)
  if (nowMs() - (app.lastHudRefreshMs || 0) >= 95) {
    app.lastHudRefreshMs = nowMs();
    updateBattleStatus(snapshot.state);
  }
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
      resultView.show(winner || app.lastWinnerSeat || null);
    } else {
      resultView.close();
    }
  } else if (phase === "finished" && ui.overlay.classList.contains("hidden")) {
    resultView.show(winner || app.lastWinnerSeat || null);
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
    snapshotTransport.handleConnected(message);
    return;
  }

  if (type === "ruleset_mismatch") {
    app.rulesetCompatible = false;
    app.rulesetStatus = "mismatch";
    app.serverRulesetVersion = String(message.serverRulesetVersion || app.serverRulesetVersion || "");
    setBattleControlsEnabled(false);
    updateConnectionUi();
    log(t("规则版本不兼容：客户端与服务器无法进入同一场对战"));
    return;
  }

  if (type === "lobby") {
    lobbyView.renderRooms(message.rooms || []);
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

  if (type === "snapshot" || type === "snapshot_delta") {
    handleSnapshot(message);
    return;
  }

  if (type === "pong") {
    snapshotTransport.handlePong(message);
    return;
  }

  if (type === "error") {
    log(t("错误：{message}", { message: translateServerText(message.message || t("未知错误"), message.code) }));
    return;
  }
}

function sendAction(action) {
  return actionTransport ? actionTransport.send(action) : null;
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
      route: stateSync.cloneRoute(ship.route),
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
      route: stateSync.cloneRoute(ship.route),
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

  throttleCommandState.reconcile({
    ackSeq: app.ackSeq,
    ships: ownShips,
    nowMs: now,
  });

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

function setThrottleGear(gear, shouldSend = true) {
  const throttle = throttleValueForGear(gear);
  app.throttle = throttle;
  syncThrottleGearControls(ui, throttle);

  if (!shouldSend) {
    return true;
  }

  const shipKey = app.selectedShipKey;
  const seq = sendAction(matchActions.setThrottle({ shipKey, throttle }));
  if (seq === null) {
    return false;
  }
  throttleCommandState.record(shipKey, seq, throttle, nowMs());
  return true;
}

function throttleForShipCommand(ship) {
  if (!ship) {
    return app.throttle;
  }
  return throttleCommandState.valueFor(ship.key, ship.throttle);
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

function syncAutoScoutZoneOnline() {
  const state = currentBattleState();
  const own = teamBySeat(state, app.seat);
  if (!own?.autoScout?.enabled) {
    return null;
  }
  return sendAction(matchActions.configureAutoScout({
    enabled: true,
    zoneId: app.selectedZoneId,
  }));
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
  const seq = sendAction(matchActions.configureAutoScout({
    enabled,
    zoneId: app.selectedZoneId,
  }));
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
  const seq = sendAction(matchActions.emergencyBrake(ship.key));
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

function renderFrame() {
  if (!running) return;
  canvasRenderer.beginFrame();
  const state = stateSync.getRenderState();
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
      drawBattleCountdown(ctx, Number(app.room.countdownEndsAt || 0) - stateSync.estimateServerNowMs());
    }
    canvasRenderer.present();
    rafId = requestAnimationFrame(renderFrame);
    return;
  }

  // 战场本体全部交给共享渲染层(src/battle/render.js);
  // 在线只负责喂「插值快照 + 本地航线覆盖」合并后的显示状态
  const ownSeat = app.seat || "A";
  const ownTeam = teamBySeat(state, ownSeat);
  const enemyTeam = teamBySeat(state, enemySeat(ownSeat));
  const spectating = isSpectatorMode();
  const frame = {
    state,
    ownTeam,
    enemyTeam,
    spectating,
    radar: spectating ? null : app.latestSnapshot?.radar || null,
    visibleEnemyIds: new Set((ownTeam && ownTeam.visibleEnemyIds) || []),
    // 观战:按快照内各座位的选中舰高亮;对战:己方取本地选中,敌方不高亮
    selectedKeyForTeam: (team) =>
      spectating
        ? selectedShipKeyForSeat(state, team && team.seat)
        : team === ownTeam
          ? app.selectedShipKey
          : null,
    // 在此合并本地航线预测覆盖,渲染层拿到的即最终显示航线
    routeForShip: (team, ship) => stateSync.getDisplayRouteForShip(team, ship),
    mobileMode: app.mobileMode,
    stars: app.stars,
    destructionEffects: app.destructionEffects,
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
    drawBattleCountdown(ctx, Number(app.room.countdownEndsAt || 0) - stateSync.estimateServerNowMs());
  }

  canvasRenderer.present();

  rafId = requestAnimationFrame(renderFrame);
}

function syncLoadoutToServer(logOnSuccess = true) {
  app.playerLoadout = profileController.readLoadoutFromControls();
  profileController.syncLoadoutControls(app.playerLoadout);
  storeLoadout(app.playerLoadout);
  const sent = socketSend({ type: "set_loadout", loadout: app.playerLoadout });
  if (logOnSuccess) {
    log(sent ? t("当前编队已同步到服务器") : t("当前编队已保存在本地，连接后会自动同步"));
  }
}

// 与单机一致的「翻书选角」：选完写回隐藏下拉并同步服务器
function openOnlineCharSelect() {
  if (charSelect && typeof charSelect.hide === "function") charSelect.hide();
  charSelect = createCharacterSelect((loadout) => {
    profileController.syncLoadoutControls(loadout); // 写入下拉，复用既有同步机制
    syncLoadoutToServer(true); // 读取下拉 → app.playerLoadout → 本地档案 → 发服务器
  });
  charSelect.show();
}

function useFlagshipSkillOnline() {
  const own = teamBySeat(app.latestSnapshot ? app.latestSnapshot.state : null, app.seat);
  const meta = currentFlagshipMeta(own, app.playerLoadout);
  if (!meta || meta.type !== "active") {
    return;
  }
  const seq = sendAction(matchActions.castFlagshipSkill(app.selectedZoneId));
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
      const seq = sendAction(matchActions.castSubSkill({
        shipKey: ship.key,
        zoneId: app.selectedZoneId,
      }));
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
  const seq = sendAction(matchActions.castSubSkill({
    shipKey: ship.key,
    zoneId: app.selectedZoneId,
  }));
  if (seq !== null) {
    log(t("{ship} 使用 {name}", { ship: shipCharacterName(ship), name: meta.name }));
  }
}

function bindUiEvents() {
  ui.serverTargetValue.textContent = defaultServerUrl();
  profileController.initializeNickname();
  ui.zoneValue.textContent = t("战区 {zone}", { zone: app.selectedZoneId });
  ui.selectedValue.textContent = t("主舰");
  profileController.populateLoadoutControls();

  for (const select of [ui.onlineMainRole, ui.onlineSub1Role, ui.onlineSub2Role]) {
    if (!select) {
      continue;
    }
    select.addEventListener("change", () => {
      const normalized = profileController.readLoadoutFromControls();
      profileController.syncLoadoutControls(normalized);
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
    const name = profileController.setNickname(ui.playerNameInput ? ui.playerNameInput.value : "", { persist: true });
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
    socketSend({ type: "leave_room" });
    app.room = null;
    app.seat = null;
    app.spectating = false;
    lobbyView.updateRoomSummary();
    updateConnectionUi();
    setBattleControlsEnabled(false);
    clearMatchRuntime();
    resultView.close();
    setRoomHudVisible(true); // 立即切回大厅页
  });

  if (ui.overlayActionBtn) {
    ui.overlayActionBtn.addEventListener("click", () => {
      if (app.room) {
        socketSend({ type: "leave_room" });
      }
      app.room = null;
      app.seat = null;
      app.spectating = false;
      lobbyView.updateRoomSummary();
      updateConnectionUi();
      setBattleControlsEnabled(false);
      resultView.close();
      setRoomHudVisible(true); // 立即切回大厅页
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

  for (const button of ui.powerGearButtons) {
    button.addEventListener("click", () => {
      setThrottleGear(button.dataset.gear, true);
    });
  }
  ui.zoomOutBtn.addEventListener("click", () => {
    camera.adjustCameraZoom(-1);
  });
  ui.zoomInBtn.addEventListener("click", () => {
    camera.adjustCameraZoom(1);
  });
  for (const button of ui.mobileThrottleButtons) {
    button.addEventListener("click", () => {
      setThrottleGear(button.dataset.gear, true);
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
    sendAction(matchActions.split(1));
  });
  bindPressButton(ui.mobileSplitOneBtn, () => {
    sendAction(matchActions.split(1));
  });

  bindPressButton(ui.splitTwoBtn, () => {
    sendAction(matchActions.split(2));
  });
  bindPressButton(ui.mobileSplitTwoBtn, () => {
    sendAction(matchActions.split(2));
  });

  bindPressButton(ui.scoutBtn, () => {
    const seq = sendAction(matchActions.launchScout({
      zoneId: app.selectedZoneId,
      shipKey: app.selectedShipKey,
    }));
    if (seq !== null) {
      log(t("侦查机已派往战区 {zone}", { zone: app.selectedZoneId }));
    }
  });
  createMobileScoutJoystick({
    button: ui.mobileScoutBtn,
    signal: ac?.signal,
    formatZone: (zoneId) => zoneId === 5 ? t("中央") : t("{zone}区", { zone: zoneId }),
    formatReadout: (zoneId) => t("松手释放 · {zone}", {
      zone: zoneId === 5 ? t("中央战区") : t("战区{zone}", { zone: zoneId }),
    }),
    onCommit: (zoneId) => {
      setSelectedZoneId(zoneId, { allowLog: false });
      const seq = sendAction(matchActions.launchScout({
        zoneId: app.selectedZoneId,
        shipKey: app.selectedShipKey,
      }));
      if (seq !== null) {
        log(t("侦查机已派往战区 {zone}", { zone: app.selectedZoneId }));
      }
      return seq !== null;
    },
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
      const route = stateSync.getDisplayRouteForShip(ownTeam, ship);
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
      const seq = sendAction(matchActions.setRoute({
        shipKey: ship.key,
        endX: pos.x,
        endY: pos.y,
        throttle: throttleForShipCommand(ship),
        anchorToMain: ship.key === "main",
      }));
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
      seq = sendAction(matchActions.routeControl({
        shipKey: app.drag.shipKey,
        controlX: pos.x,
        controlY: pos.y,
      }));
      if (seq !== null) {
        applyRouteControlOverride(app.drag.shipKey, seq, pos.x, pos.y);
      }
    } else if (app.drag.handle === "end") {
      seq = sendAction(matchActions.routeEnd({
        shipKey: app.drag.shipKey,
        endX: pos.x,
        endY: pos.y,
      }));
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
      const seq = sendAction(matchActions.castSubSkill({
        shipKey: app.pendingSubSkillAim.shipKey,
        targetX: pos.x,
        targetY: pos.y,
      }));
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
      const ship = getLatestOwnShip(app.selectedShipKey);
      if (!ship || !ship.alive || !ship.canControl) {
        return;
      }
      const seq = sendAction(matchActions.setRoute({
        shipKey: ship.key,
        endX: pos.x,
        endY: pos.y,
        throttle: throttleForShipCommand(ship),
        anchorToMain: ship.key === "main",
      }));
      if (seq !== null) {
        applySetRouteOverride(ship.key, seq, pos.x, pos.y);
      }
      return;
    }

    if (app.pendingSubSkillAim && canControlBattle()) {
      const ship = getLatestOwnShip(app.pendingSubSkillAim.shipKey);
      const meta = currentSubMeta(ship);
      const seq = sendAction(matchActions.castSubSkill({
        shipKey: app.pendingSubSkillAim.shipKey,
        targetX: pos.x,
        targetY: pos.y,
      }));
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

    const throttleGear = throttleGearFromShortcut(event, app.throttle);
    if (throttleGear !== null) {
      if (canControlBattle()) {
        event.preventDefault();
        setThrottleGear(throttleGear, true);
      }
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
      const seq = sendAction(matchActions.setRoute({
        shipKey: ship.key,
        endX: cx,
        endY: cy,
        throttle: throttleForShipCommand(ship),
        anchorToMain: ship.key === "main",
      }));
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
      const seq = sendAction(matchActions.launchScout({
        zoneId: app.selectedZoneId,
      }));
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
  startStarfield(root.querySelector(".page-stars"), ac.signal);
  setBattleControlsEnabled(false);
  setRoomHudVisible(true);
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
  resultView?.close();
  resultView = null;
  snapshotTransport.stopPingLoop();
  disconnectServer();
  if (ac) ac.abort();
  ac = null;
  if (charSelect && typeof charSelect.hide === "function") {
    charSelect.hide();
  }
  charSelect = null;
  actionTransport = null;
  canvasRenderer?.destroy();
  canvasRenderer = null;
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
              <button id="createAiRoomBtn">${t("创建 AI 训练房")}</button>
              <div class="join-code-wrap">
                <input id="joinCodeInput" type="text" inputmode="numeric" maxlength="6" placeholder="${t("输入 6 位房间号")}" />
                <button id="joinCodeBtn">${t("加入私人房")}</button>
              </div>
              <button id="refreshRoomsBtn">${t("刷新公开房列表")}</button>

              <h2 class="lobby-card-title">${t("公开房")}</h2>
              <div id="roomList" class="room-list room-list-compact"></div>

              <div id="roomSummary" class="room-summary">${t("未进入房间")}</div>
              <button id="leaveRoomBtn" disabled>${t("离开房间")}</button>
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
        resultMetaClass: " result-match-meta",
        overlayActionsHTML: `<button id="overlayActionBtn" type="button">${t("返回大厅")}</button>`,
      })}
    </div>
  `;
}
