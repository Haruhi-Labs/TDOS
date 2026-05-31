import {
  FIRE_ARC_BANDS,
  MatchSimulation,
  CHARACTER_ORDER,
  CHARACTER_DEFS,
  DEFAULT_AI_LOADOUT,
  DEFAULT_TEAM_LOADOUT,
  EMERGENCY_BRAKE_COST,
  SCOUT_LAUNCH_COST,
  clamp,
  cloneLoadout,
  distance,
  normalizeLoadout,
  quadraticPoint,
  skillMetaForCharacter,
} from "../shared/game-core.js";

import {
  createCharacterSelect,
  drawInGamePortrait,
  CHARACTER_THEMES,
  getPortrait,
  loadPortraitImage,
} from "./character-select.js";

import {
  getLoadout,
  setLoadout,
  getFaction,
  setFaction,
} from "./profile.js";

// 可挂载模块状态：每次 mount 重新初始化（同一时刻只挂载一个模式）
let canvas, ctx, ui, app;
let ac = null; // AbortController：统一移除 window 级监听
let rafId = 0; // 渲染循环句柄
let running = false; // 渲染循环开关
let charSelect = null; // 选角覆盖层引用，卸载时移除

function addWin(type, handler) {
  window.addEventListener(type, handler, ac ? { signal: ac.signal } : undefined);
}

function cacheDom() {
  canvas = document.getElementById("gameCanvas");
  ctx = canvas.getContext("2d");
  ui = {
  hullValue: document.getElementById("hullValue"),
  energyValue: document.getElementById("energyValue"),
  splitValue: document.getElementById("splitValue"),
  selectedValue: document.getElementById("selectedValue"),
  splitOneBtn: document.getElementById("splitOneBtn"),
  splitTwoBtn: document.getElementById("splitTwoBtn"),
  powerSlider: document.getElementById("powerSlider"),
  powerValue: document.getElementById("powerValue"),
  zoomOutBtn: document.getElementById("zoomOutBtn"),
  zoomInBtn: document.getElementById("zoomInBtn"),
  zoomValue: document.getElementById("zoomValue"),
  zoneValue: document.getElementById("zoneValueLocal"),
  shipSwitchButtons: Array.from(document.querySelectorAll("#shipQuickSwitch .ship-switch-btn")),
  scoutBtn: document.getElementById("scoutBtn"),
  autoScoutBtn: document.getElementById("autoScoutBtn"),
  brakeBtn: document.getElementById("brakeBtn"),
  flagshipBtn: document.getElementById("flagshipBtn"),
  subSkillBtn: document.getElementById("subSkillBtn"),
  playerMainRole: document.getElementById("playerMainRole"),
  playerSub1Role: document.getElementById("playerSub1Role"),
  playerSub2Role: document.getElementById("playerSub2Role"),
  loadoutPreview: document.getElementById("loadoutPreview"),
  applyLoadoutBtn: document.getElementById("applyLoadoutBtn"),
  log: document.getElementById("log"),
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
  restartBtn: document.getElementById("restartBtn"),
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
const ROUTE_HANDLE_RADIUS = 11;
const MOBILE_ZOOM = 1.78;
const CAMERA_ZOOM_MIN = 1;
const CAMERA_ZOOM_MAX = 2.6;
const CAMERA_ZOOM_STEP = 0.2;

function initApp() {
  app = {
  sim: null,
  state: null,
  playerLoadout: readStoredLoadout(),
  enemyLoadout: cloneLoadout(DEFAULT_AI_LOADOUT),
  playerColor: getFaction(), // 玩家阵营立绘色（取自统一档案，可被角色选择覆盖）

  selectedShipKey: "main",
  selectedZoneId: 5,
  pointer: { x: canvas.width * 0.5, y: canvas.height * 0.5 },
  drag: null,
  suppressMapClick: false,
  pendingSubSkillAim: null,
  lastTime: performance.now(),
  gameOverLogged: false,
  tickRunning: false,
  paused: false,
  mobileMode: false,
  cameraCenterX: canvas.width * 0.5,
  cameraCenterY: canvas.height * 0.5,
  cameraZoom: 1,
  cameraManualUntil: 0,
  stars: Array.from({ length: 220 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    r: Math.random() * 1.6 + 0.4,
    p: Math.random() * TAU,
  })),
  };
}

// 编队读写统一走玩家档案（src/profile.js），与在线/调试模式共享同一份身份数据
function readStoredLoadout() {
  return getLoadout();
}

function storeLoadout(loadout) {
  setLoadout(loadout);
}

function ownTeamState() {
  return app.state ? app.state.teams.A : null;
}

function enemyTeamState() {
  return app.state ? app.state.teams.B : null;
}

function ownTeamSim() {
  return app.sim ? app.sim.teamA : null;
}

function selectedShipState() {
  const own = ownTeamState();
  if (!own || !own.ships) {
    return null;
  }
  return own.ships[app.selectedShipKey] || null;
}

function selectedShipSim() {
  const own = ownTeamSim();
  return own ? own.ships[app.selectedShipKey] || null : null;
}

function prefersMobileBattleMode() {
  return window.matchMedia("(max-width: 980px)").matches || window.matchMedia("(pointer: coarse)").matches;
}

function screenPointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (canvas.width / rect.width);
  const y = (event.clientY - rect.top) * (canvas.height / rect.height);
  return {
    x: clamp(x, 0, canvas.width),
    y: clamp(y, 0, canvas.height),
  };
}

function effectiveViewZoom(zoomRatio = app.cameraZoom) {
  const baseZoom = app.mobileMode ? MOBILE_ZOOM : 1;
  return baseZoom * clamp(zoomRatio, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX);
}

function clampCameraCenter(centerX, centerY, zoom = effectiveViewZoom()) {
  const width = canvas.width / zoom;
  const height = canvas.height / zoom;
  const halfW = width * 0.5;
  const halfH = height * 0.5;
  return {
    x: clamp(centerX, halfW, canvas.width - halfW),
    y: clamp(centerY, halfH, canvas.height - halfH),
    width,
    height,
    zoom,
  };
}

function currentViewState() {
  const zoom = effectiveViewZoom();
  const centered = clampCameraCenter(app.cameraCenterX, app.cameraCenterY, zoom);
  return {
    zoom: centered.zoom,
    left: centered.x - centered.width * 0.5,
    top: centered.y - centered.height * 0.5,
    width: centered.width,
    height: centered.height,
  };
}

function worldPointFromScreenPoint(x, y) {
  const view = currentViewState();
  return {
    x: clamp(view.left + x / view.zoom, 0, canvas.width),
    y: clamp(view.top + y / view.zoom, 0, canvas.height),
  };
}

function pointerFromEvent(event) {
  const screen = screenPointFromEvent(event);
  return worldPointFromScreenPoint(screen.x, screen.y);
}

function minimapRect() {
  if (!app.mobileMode) {
    return null;
  }
  const size = clamp(canvas.width * 0.145, 180, 230);
  return {
    x: canvas.width - size - 18,
    y: 18,
    width: size,
    height: size,
  };
}

function minimapWorldPointFromScreenPoint(screenX, screenY) {
  const rect = minimapRect();
  if (!rect) {
    return null;
  }
  if (screenX < rect.x || screenX > rect.x + rect.width || screenY < rect.y || screenY > rect.y + rect.height) {
    return null;
  }
  return {
    x: clamp(((screenX - rect.x) / rect.width) * canvas.width, 0, canvas.width),
    y: clamp(((screenY - rect.y) / rect.height) * canvas.height, 0, canvas.height),
  };
}

function centerCameraOn(x, y, manual = true) {
  const centered = clampCameraCenter(x, y);
  app.cameraCenterX = centered.x;
  app.cameraCenterY = centered.y;
  if (manual) {
    app.cameraManualUntil = performance.now() + 2600;
  }
}

function setCameraZoom(nextZoom, focusScreen = null) {
  const zoomRatio = clamp(nextZoom, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX);
  if (Math.abs(zoomRatio - app.cameraZoom) < 1e-3) {
    return false;
  }

  const prevView = currentViewState();
  let centerX = prevView.left + prevView.width * 0.5;
  let centerY = prevView.top + prevView.height * 0.5;

  if (focusScreen) {
    const worldX = clamp(prevView.left + focusScreen.x / prevView.zoom, 0, canvas.width);
    const worldY = clamp(prevView.top + focusScreen.y / prevView.zoom, 0, canvas.height);
    const zoom = effectiveViewZoom(zoomRatio);
    const width = canvas.width / zoom;
    const height = canvas.height / zoom;
    centerX = worldX - focusScreen.x / zoom + width * 0.5;
    centerY = worldY - focusScreen.y / zoom + height * 0.5;
  }

  app.cameraZoom = zoomRatio;
  if (!app.mobileMode && zoomRatio <= CAMERA_ZOOM_MIN + 1e-3) {
    app.cameraCenterX = canvas.width * 0.5;
    app.cameraCenterY = canvas.height * 0.5;
    app.cameraManualUntil = 0;
  } else {
    centerCameraOn(centerX, centerY, Boolean(focusScreen));
  }
  updateUi();
  return true;
}

function adjustCameraZoom(direction, focusScreen = null) {
  const step = direction > 0 ? CAMERA_ZOOM_STEP : -CAMERA_ZOOM_STEP;
  return setCameraZoom(app.cameraZoom + step, focusScreen);
}

function updateCamera() {
  const shouldTrack = app.mobileMode || app.cameraZoom > CAMERA_ZOOM_MIN + 1e-3;
  if (!shouldTrack) {
    app.cameraCenterX = canvas.width * 0.5;
    app.cameraCenterY = canvas.height * 0.5;
    return;
  }
  const ship = selectedShipState();
  if (!ship || !ship.alive) {
    return;
  }
  if (performance.now() < app.cameraManualUntil) {
    return;
  }
  const lead = clamp((ship.speed || 0) * 3.2, 34, 92);
  const targetX = ship.x + Math.cos(ship.angle || 0) * lead;
  const targetY = ship.y + Math.sin(ship.angle || 0) * lead;
  app.cameraCenterX = clamp(app.cameraCenterX + (targetX - app.cameraCenterX) * 0.14, 0, canvas.width);
  app.cameraCenterY = clamp(app.cameraCenterY + (targetY - app.cameraCenterY) * 0.14, 0, canvas.height);
}

function syncResponsiveMode() {
  app.mobileMode = prefersMobileBattleMode();
  if (!app.mobileMode) {
    app.cameraManualUntil = 0;
  }
  if (ui.mobileBattleHud) {
    ui.mobileBattleHud.hidden = !app.mobileMode;
  }
}

function zoneFromPoint(x, y) {
  const zones = app.state ? app.state.zones : [];
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

function log(message) {
  // 日志面板已被「全队舰况」取代；保留函数让各处战斗事件调用安全空转
  if (!ui.log) {
    return;
  }
  const row = document.createElement("div");
  const elapsed = app.state ? Math.floor(app.state.elapsed) : 0;
  row.textContent = `[${String(elapsed).padStart(3, "0")}秒] ${message}`;
  ui.log.prepend(row);
  while (ui.log.children.length > 26) {
    ui.log.removeChild(ui.log.lastChild);
  }
}

function clearLog() {
  if (ui.log) {
    ui.log.innerHTML = "";
  }
}

const FLEET_SLOT_LABEL = { main: "主舰", sub1: "副一", sub2: "副二" };

// 全队舰况：逐舰刷新血/能量条 + 状态，并高亮当前选中舰
function renderFleetRoster(own) {
  if (!ui.fleetRows) {
    return;
  }
  for (const cell of ui.fleetRows) {
    const ship = own && own.ships ? own.ships[cell.key] : null;
    cell.row.classList.toggle("active", cell.key === app.selectedShipKey);
    if (!ship) {
      cell.row.classList.add("gone");
      cell.name.textContent = FLEET_SLOT_LABEL[cell.key] || cell.key;
      cell.state.textContent = "—";
      cell.state.classList.remove("danger");
      cell.hullFill.style.width = "0%";
      cell.enFill.style.width = "0%";
      cell.hullPct.textContent = "—";
      cell.enPct.textContent = "—";
      continue;
    }
    const dead = !ship.alive;
    const hull = dead ? 0 : Math.max(0, Math.round((Number(ship.hp) / Math.max(1, Number(ship.maxHp))) * 100));
    const energy = energyPercentForShip(ship);
    cell.row.classList.toggle("gone", dead);
    cell.name.textContent = `${FLEET_SLOT_LABEL[cell.key] || cell.key} ${ship.characterName}`;
    let state = "";
    if (dead) {
      state = "✖ 阵亡";
    } else if (ship.braking) {
      state = "急刹中";
    } else if (cell.key !== "main" && ship.attached === false) {
      state = "分离中";
    }
    cell.state.textContent = state;
    cell.state.classList.toggle("danger", dead);
    cell.hullFill.style.width = `${hull}%`;
    cell.hullFill.classList.toggle("low", !dead && hull <= 30);
    cell.enFill.style.width = `${energy}%`;
    cell.hullPct.textContent = `${hull}%`;
    cell.enPct.textContent = `${energy}%`;
  }
}

function applyAction(action) {
  if (!app.sim) {
    return false;
  }
  return app.sim.applyActionForSeat("A", action);
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

function createRoleOption(characterId) {
  const def = CHARACTER_DEFS[characterId];
  const option = document.createElement("option");
  option.value = characterId;
  option.textContent = `${def.shortName} · ${def.title}`;
  return option;
}

function populateLoadoutControls() {
  for (const select of [ui.playerMainRole, ui.playerSub1Role, ui.playerSub2Role]) {
    if (!select) {
      continue;
    }
    select.innerHTML = "";
    for (const characterId of CHARACTER_ORDER) {
      select.append(createRoleOption(characterId));
    }
  }
  syncLoadoutControls(app.playerLoadout);
}

function syncLoadoutControls(loadout) {
  // 内联编队下拉已从对战面板移除，换阵容统一走翻书选角；下拉存在时（其他模式）才回填
  if (ui.playerMainRole) ui.playerMainRole.value = loadout.main;
  if (ui.playerSub1Role) ui.playerSub1Role.value = loadout.sub1;
  if (ui.playerSub2Role) ui.playerSub2Role.value = loadout.sub2;
  renderLoadoutPreview(loadout, ui.loadoutPreview);
  updateShipSwitchLabels(loadout);
}

function readLoadoutFromControls() {
  return normalizeLoadout(
    {
      main: ui.playerMainRole.value,
      sub1: ui.playerSub1Role.value,
      sub2: ui.playerSub2Role.value,
    },
    DEFAULT_TEAM_LOADOUT,
  );
}

function roleSummaryLine(slotKey, characterId) {
  const def = CHARACTER_DEFS[characterId];
  const stat = def.stats;
  return `${slotLabel(slotKey)} ${def.shortName} | 舰体${stat.hp} | 能量${stat.energy} | 航速${stat.speed} | 机动${stat.turnRate.toFixed(2)}`;
}

function slotLabel(slotKey) {
  if (slotKey === "main") {
    return "主舰";
  }
  if (slotKey === "sub1") {
    return "副舰一";
  }
  return "副舰二";
}

function renderLoadoutPreview(loadout, target) {
  if (!target) {
    return;
  }
  target.innerHTML = "";
  ["main", "sub1", "sub2"].forEach((slotKey) => {
    const row = document.createElement("div");
    row.textContent = roleSummaryLine(slotKey, loadout[slotKey]);
    target.append(row);
  });
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

function createSimulation() {
  return new MatchSimulation({
    mode: "ai",
    worldSize: canvas.width,
    teamNames: {
      A: "SOS先遣舰队",
      B: "统合思念体舰队",
    },
    teamLoadouts: {
      A: app.playerLoadout,
      B: app.enemyLoadout,
    },
  });
}

function resetMatch(logMessage = true) {
  app.sim = createSimulation();
  app.state = app.sim.serializeState();
  app.selectedShipKey = "main";
  app.selectedZoneId = 5;
  app.drag = null;
  app.suppressMapClick = false;
  app.pendingSubSkillAim = null;
  app.gameOverLogged = false;
  app.paused = false;
  app.lastTime = performance.now();
  app.cameraZoom = 1;
  app.cameraManualUntil = 0;
  const mainShip = app.sim.teamA.ships.main;
  app.cameraCenterX = mainShip.x;
  app.cameraCenterY = mainShip.y;
  updateShipSwitchLabels(app.playerLoadout);
  if (logMessage) {
    clearLog();
    log(app.mobileMode ? "战斗开始。点战场直接移动，点右上小地图选战区。" : "战斗开始。单击选战区，双击设目标点，拖拽控制点可调曲线。");
  }
  updateUi();
}

function setSelectedShip(shipKey) {
  const own = ownTeamState();
  if (!own || !own.ships || !shipKey) {
    return false;
  }
  const ship = own.ships[shipKey];
  if (!ship || !ship.alive || !ship.canControl) {
    return false;
  }
  app.selectedShipKey = shipKey;
  if (app.pendingSubSkillAim && app.pendingSubSkillAim.shipKey !== shipKey) {
    app.pendingSubSkillAim = null;
  }
  const shipSim = selectedShipSim();
  if ((app.mobileMode || app.cameraZoom > CAMERA_ZOOM_MIN + 1e-3) && shipSim) {
    centerCameraOn(shipSim.x, shipSim.y, false);
  }
  syncPowerSliderFromSelected();
  updateUi();
  return true;
}

function syncShipSelection() {
  const own = ownTeamState();
  if (!own || !own.ships) {
    return;
  }

  const selected = own.ships[app.selectedShipKey];
  if (!selected || !selected.alive || !selected.canControl) {
    const fallback = Object.keys(own.ships).find((key) => {
      const ship = own.ships[key];
      return ship && ship.alive && ship.canControl;
    });
    if (fallback) {
      app.selectedShipKey = fallback;
    }
  }

  for (const button of ui.shipSwitchButtons) {
    const key = button.dataset.ship;
    const ship = key ? own.ships[key] : null;
    const enabled = Boolean(ship && ship.alive && ship.canControl);
    button.disabled = !enabled;
    button.classList.toggle("active", key === app.selectedShipKey);
  }
}

function ownShipAtPoint(x, y) {
  const own = ownTeamState();
  if (!own || !own.ships) {
    return null;
  }
  let best = null;
  let bestDist = Infinity;
  const hitPadding = app.mobileMode ? 28 : 14;
  for (const ship of Object.values(own.ships)) {
    if (!ship || !ship.alive || !ship.canControl) {
      continue;
    }
    const d = distance(x, y, ship.x, ship.y);
    if (d <= ship.radius + hitPadding && d < bestDist) {
      best = ship;
      bestDist = d;
    }
  }
  return best;
}

function syncPowerSliderFromSelected() {
  if (document.activeElement === ui.powerSlider) {
    return;
  }
  const ship = selectedShipState();
  if (!ship) {
    return;
  }
  const value = Math.round(clamp((ship.throttle || 1) * 100, 25, 140));
  ui.powerSlider.value = String(value);
  ui.powerValue.textContent = `${value}%`;
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

function currentSubMeta(selected) {
  if (!selected || selected.key === "main") {
    return null;
  }
  return skillMetaForCharacter(selected.characterId, "sub");
}

function setThrottleValue(percent) {
  const value = clamp(Number(percent), 25, 140);
  ui.powerSlider.value = String(value);
  ui.powerValue.textContent = `${Math.round(value)}%`;
  applyAction({
    type: "set_throttle",
    shipKey: app.selectedShipKey,
    throttle: value / 100,
  });
  updateUi();
}

function syncAutoScoutZone() {
  const own = ownTeamState();
  if (!own?.autoScout?.enabled) {
    return false;
  }
  return applyAction({
    type: "configure_auto_scout",
    enabled: true,
    zoneId: app.selectedZoneId,
  });
}

function setSelectedZoneId(zoneId, { allowLog = true } = {}) {
  const nextZoneId = clamp(Number(zoneId) || app.selectedZoneId, 1, 9);
  const changed = nextZoneId !== app.selectedZoneId;
  app.selectedZoneId = nextZoneId;
  if (changed && allowLog) {
    log(`已选中战区${nextZoneId}`);
  }
  syncAutoScoutZone();
  updateUi();
  return changed;
}

function toggleAutoScout() {
  const own = ownTeamState();
  if (!own) {
    return false;
  }
  const enabled = !own.autoScout?.enabled;
  const ok = applyAction({
    type: "configure_auto_scout",
    enabled,
    zoneId: app.selectedZoneId,
  });
  if (ok) {
    log(enabled ? `自动侦查已开启，目标战区${app.selectedZoneId}` : "自动侦查已关闭");
    updateUi();
  }
  return ok;
}

function useEmergencyBrake() {
  const ship = selectedShipState();
  if (!ship || !ship.alive || !ship.canControl) {
    return false;
  }
  const ok = applyAction({
    type: "emergency_brake",
    shipKey: ship.key,
  });
  if (ok) {
    log(`${ship.name} 执行急刹`);
    updateUi();
  }
  return ok;
}

function handleMinimapTap(screenPos, { allowZoneLog = true } = {}) {
  if (!app.mobileMode) {
    return false;
  }
  const world = minimapWorldPointFromScreenPoint(screenPos.x, screenPos.y);
  if (!world) {
    return false;
  }
  centerCameraOn(world.x, world.y, true);
  const zone = zoneFromPoint(world.x, world.y);
  if (zone) {
    setSelectedZoneId(zone.id, { allowLog: allowZoneLog });
  } else {
    updateUi();
  }
  return true;
}

function setRouteForSelectedShip(x, y, logRoute = false) {
  const ship = selectedShipState();
  if (!ship || !ship.alive || !ship.canControl) {
    return false;
  }
  const throttle = clamp(Number(ui.powerSlider.value) / 100, 0.25, 1.4);
  const ok = applyAction({
    type: "set_route",
    shipKey: ship.key,
    endX: x,
    endY: y,
    throttle,
    anchorToMain: ship.key === "main",
  });
  if (ok && logRoute) {
    log(`${ship.name} 已设置新航线`);
  }
  return ok;
}

function updateSkillButtons(own) {
  if (!own) {
    ui.scoutBtn.disabled = true;
    ui.autoScoutBtn.disabled = true;
    ui.autoScoutBtn.classList.remove("toggle-active");
    ui.brakeBtn.disabled = true;
    ui.flagshipBtn.disabled = true;
    ui.subSkillBtn.disabled = true;
    return;
  }

  const cooldowns = own.cooldowns || {};
  const selected = selectedShipState();
  const mainShip = own.ships ? own.ships.main : null;
  const mainEnergy = mainShip ? Number(mainShip.fleetEnergy) || 0 : 0;

  const scoutLocked = own.skillsDisabled;
  ui.scoutBtn.disabled = scoutLocked || (cooldowns.scout || 0) > 0 || mainEnergy < SCOUT_LAUNCH_COST;
  ui.scoutBtn.textContent = scoutLocked
    ? "派出侦查机（已被封印）"
    : (cooldowns.scout || 0) > 0
      ? `派出侦查机（冷却${(cooldowns.scout || 0).toFixed(1)}秒）`
      : "派出侦查机";

  const autoScoutEnabled = Boolean(own.autoScout?.enabled);
  const autoScoutZoneId = Number(own.autoScout?.zoneId) || app.selectedZoneId;
  const autoScoutDisabled = own.skillsDisabled && !autoScoutEnabled;
  let autoScoutSuffix = autoScoutEnabled ? `开·战区${autoScoutZoneId}` : "关";
  if (autoScoutEnabled) {
    if ((cooldowns.scout || 0) > 0) {
      autoScoutSuffix += `·冷却${(cooldowns.scout || 0).toFixed(1)}秒`;
    } else if (mainEnergy < SCOUT_LAUNCH_COST) {
      autoScoutSuffix += "·等待能量";
    }
  } else if (own.skillsDisabled) {
    autoScoutSuffix = "关·已封印";
  }
  ui.autoScoutBtn.disabled = autoScoutDisabled;
  ui.autoScoutBtn.textContent = `自动侦查：${autoScoutSuffix}`;
  ui.autoScoutBtn.classList.toggle("toggle-active", autoScoutEnabled);

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

  const brakeCooldown = Number(selected?.brakeCooldown) || 0;
  const brakeEnergy = Number(selected?.fleetEnergy) || 0;
  const brakeDisabled = !selected || !selected.alive || !selected.canControl || selected.attached || brakeCooldown > 0 || brakeEnergy < EMERGENCY_BRAKE_COST;
  let brakeSuffix = "";
  if (!selected || !selected.alive || !selected.canControl) {
    brakeSuffix = "（切换到可控舰）";
  } else if (selected.attached) {
    brakeSuffix = "（分离后可用）";
  } else if (brakeCooldown > 0) {
    brakeSuffix = `（冷却${brakeCooldown.toFixed(1)}秒）`;
  } else if (brakeEnergy < EMERGENCY_BRAKE_COST) {
    brakeSuffix = `（需${EMERGENCY_BRAKE_COST}能量）`;
  } else if (selected.braking) {
    brakeSuffix = "（制动中）";
  }
  ui.brakeBtn.disabled = brakeDisabled;
  ui.brakeBtn.textContent = `急刹${brakeSuffix}`;

  const subMeta = currentSubMeta(selected);
  if (!selected || !subMeta) {
    ui.subSkillBtn.disabled = true;
    ui.subSkillBtn.textContent = "分舰技能：切换到副舰后使用";
    return;
  }

  const skillEnergy = Number(selected.fleetEnergy) || 0;
  const cooldown = Number(cooldowns[selected.key] || 0);
  const detached = !selected.attached && selected.canControl;
  const disabled = own.skillsDisabled || !detached || cooldown > 0 || skillEnergy < (subMeta.cost || 0);

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

function syncMobileHud(own) {
  if (!ui.mobileBattleHud) {
    return;
  }
  ui.mobileBattleHud.hidden = !app.mobileMode;
  if (!app.mobileMode || !own) {
    return;
  }

  const selected = selectedShipState();
  const shipName = selected ? selected.characterName : "无";
  const throttleValue = Math.round(clamp((selected?.throttle || 1) * 100, 25, 140));
  ui.mobileBattleSummary.textContent = `${shipName} | 战区${app.selectedZoneId} | 推进${throttleValue}%`;
  ui.mobileBattleHint.textContent = app.pendingSubSkillAim
    ? "技能瞄准中：点主视图确认，点右上小地图先挪镜头。"
    : "点舰船切换，点主视图直接下航线，点右上小地图选战区，+/-可缩放。";

  const buttonStates = {
    main: own.ships.main,
    sub1: own.ships.sub1,
    sub2: own.ships.sub2,
  };
  for (const button of ui.mobileShipButtons) {
    const ship = buttonStates[button.dataset.ship];
    const enabled = Boolean(ship && ship.alive && ship.canControl);
    button.disabled = !enabled;
    button.classList.toggle("active", button.dataset.ship === app.selectedShipKey);
  }

  ui.mobileSplitOneBtn.disabled = ui.splitOneBtn.disabled;
  ui.mobileSplitTwoBtn.disabled = ui.splitTwoBtn.disabled;
  ui.mobileScoutBtn.disabled = ui.scoutBtn.disabled;
  ui.mobileAutoScoutBtn.disabled = ui.autoScoutBtn.disabled;
  ui.mobileBrakeBtn.disabled = ui.brakeBtn.disabled;
  ui.mobileFlagshipBtn.disabled = ui.flagshipBtn.disabled;
  ui.mobileSubSkillBtn.disabled = ui.subSkillBtn.disabled;

  const autoScoutEnabled = Boolean(own.autoScout?.enabled);
  ui.mobileAutoScoutBtn.textContent = autoScoutEnabled ? "自侦开" : "自侦关";
  ui.mobileAutoScoutBtn.classList.toggle("toggle-active", autoScoutEnabled);
  ui.mobileBrakeBtn.textContent = "急刹";
  ui.mobileFlagshipBtn.textContent = "旗舰技";
  ui.mobileSubSkillBtn.textContent = selected && currentSubMeta(selected) ? currentSubMeta(selected).name : "分舰技";

  for (const button of ui.mobileThrottleButtons) {
    const preset = Number(button.dataset.throttle);
    button.classList.toggle("active", Math.abs(preset - throttleValue) <= 10);
  }
}

function updateUi() {
  const own = ownTeamState();
  if (!own) {
    return;
  }

  syncShipSelection();
  syncPowerSliderFromSelected();

  ui.hullValue.textContent = `${Math.round((own.hullRatio || 0) * 100)}%`;
  ui.splitValue.textContent = own.splitLevel === 0 ? "编队" : own.splitLevel === 1 ? "一级分离" : "二级分离";
  ui.zoneValue.textContent = `战区${app.selectedZoneId}`;
  ui.zoomValue.textContent = `${Math.round(app.cameraZoom * 100)}%`;
  ui.zoomOutBtn.disabled = app.cameraZoom <= CAMERA_ZOOM_MIN + 1e-3;
  ui.zoomInBtn.disabled = app.cameraZoom >= CAMERA_ZOOM_MAX - 1e-3;

  const selectedState = selectedShipState();
  const selectedSim = selectedShipSim();
  ui.energyValue.textContent = `${energyPercentForShip(selectedState || own.ships.main)}%`;
  if (selectedState && selectedSim) {
    const minRadius = Math.round(selectedSim.routeConstraintProfile().minTurnRadius);
    ui.selectedValue.textContent = `${selectedState.characterName} | 推进 ${(selectedState.throttle || 1).toFixed(2)} | 能量 ${Math.round(
      Number(selectedState.fleetEnergy) || 0,
    )}/${Math.round(Number(selectedState.fleetMaxEnergy) || 1)} | 最小半径${minRadius}${selectedState.braking ? " | 急刹中" : ""}`;
  } else {
    ui.selectedValue.textContent = "无";
  }

  ui.splitOneBtn.disabled = own.splitLevel >= 1;
  ui.splitTwoBtn.disabled = own.splitLevel < 1 || own.splitLevel >= 2;
  updateSkillButtons(own);
  renderFleetRoster(own);
  syncMobileHud(own);

  if (app.state.phase === "finished") {
    ui.overlay.classList.remove("hidden");
    if (app.state.winnerSeat === "A") {
      ui.overlayTitle.textContent = "胜利：敌方舰队已被击溃";
      if (!app.gameOverLogged) {
        log("战斗结束：SOS先遣舰队获胜");
      }
    } else if (app.state.winnerSeat === "B") {
      ui.overlayTitle.textContent = "失败：SOS先遣舰队被歼灭";
      if (!app.gameOverLogged) {
        log("战斗结束：SOS先遣舰队战败");
      }
    } else {
      ui.overlayTitle.textContent = "战斗结束";
      if (!app.gameOverLogged) {
        log("战斗结束：平局");
      }
    }
    app.gameOverLogged = true;
  } else {
    ui.overlay.classList.add("hidden");
    app.gameOverLogged = false;
  }
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

function drawZones() {
  if (!app.state || !app.state.zones) {
    return;
  }
  for (const zone of app.state.zones) {
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

  if (selected && !app.mobileMode) {
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

    const progressPoint = quadraticPoint(p0, p1, p2, clamp(route.t || 0, 0, 1));
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(progressPoint.x, progressPoint.y, 3.2, 0, TAU);
    ctx.fill();
  }

  ctx.restore();
}

function shipHullDrawScale(ship) {
  const baseScale = ship.key === "main" ? 0.72 : ship.key === "twin" ? 0.56 : 0.62;
  const baseRadius = ship.key === "main" ? 10 : ship.key === "twin" ? 8 : 9;
  return baseScale * ((ship.radius || baseRadius) / baseRadius);
}

function drawShip(ship, color, selected, attached) {
  if (!ship || !ship.alive) {
    return;
  }

  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);

  const hullScale = shipHullDrawScale(ship);
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
  const barWidth = Math.max(26, ship.radius * 2.5);
  const barLeft = ship.x - barWidth * 0.5;
  ctx.fillStyle = "#0f1f31";
  ctx.fillRect(barLeft, ship.y - ship.radius - 10, barWidth, 4);
  ctx.fillStyle = hpRatio > 0.35 ? "#72f5a8" : "#ff8a8a";
  ctx.fillRect(barLeft, ship.y - ship.radius - 10, barWidth * hpRatio, 4);
  ctx.fillStyle = "#10263d";
  ctx.fillRect(barLeft, ship.y - ship.radius - 4, barWidth, 3);
  ctx.fillStyle = "#6ad8ff";
  ctx.fillRect(barLeft, ship.y - ship.radius - 4, barWidth * energyRatio, 3);
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
  const maxLife = Math.max(0.001, Number(beam.maxLife) || (phase === "charge" ? 1.05 : 0.26));
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

function drawSelectedVisionCircle() {
  const own = ownTeamState();
  if (!own || !own.ships) {
    return;
  }
  const selected = own.ships[app.selectedShipKey];
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

function drawSelectedFireArc() {
  const own = ownTeamState();
  if (!own || !own.ships) {
    return;
  }
  const ship = own.ships[app.selectedShipKey];
  if (!ship || !ship.alive) {
    return;
  }

  const outerRadius = clamp((ship.range || 0) * 0.22, 84, 124);
  const innerRadius = ship.radius + 14;
  const labelRadius = outerRadius - 12;

  if (own.loadout && own.loadout.main === "kyon") {
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

function drawSubSkillAimHint() {
  const own = ownTeamState();
  if (!app.pendingSubSkillAim || !own || !own.ships) {
    return;
  }
  const ship = own.ships[app.pendingSubSkillAim.shipKey];
  if (!ship || !ship.alive || ship.attached) {
    return;
  }
  ctx.save();
  ctx.strokeStyle = "#7ff4ff";
  ctx.lineWidth = 1.6;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(ship.x, ship.y);
  ctx.lineTo(app.pointer.x, app.pointer.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawMinimap() {
  if (!app.mobileMode || !app.state) {
    return;
  }
  const rect = minimapRect();
  if (!rect) {
    return;
  }

  ctx.save();
  ctx.fillStyle = "#06121fda";
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.strokeStyle = "#285279";
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

  if (Array.isArray(app.state.zones)) {
    for (const zone of app.state.zones) {
      const zx = rect.x + (zone.x / canvas.width) * rect.width;
      const zy = rect.y + (zone.y / canvas.height) * rect.height;
      const zw = (zone.width / canvas.width) * rect.width;
      const zh = (zone.height / canvas.height) * rect.height;
      ctx.strokeStyle = zone.id === app.selectedZoneId ? "#6fd9ff" : "#2d5d884f";
      ctx.lineWidth = zone.id === app.selectedZoneId ? 1.6 : 1;
      ctx.strokeRect(zx, zy, zw, zh);
    }
  }

  const plotShip = (ship, color) => {
    if (!ship || !ship.alive) {
      return;
    }
    const x = rect.x + (ship.x / canvas.width) * rect.width;
    const y = rect.y + (ship.y / canvas.height) * rect.height;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, TAU);
    ctx.fill();
  };

  const own = ownTeamState();
  const enemy = enemyTeamState();
  const visibleEnemyIds = new Set((own && own.visibleEnemyIds) || []);
  if (own && own.ships) {
    for (const ship of [...Object.values(own.ships), ...(own.extraShips || [])]) {
      plotShip(ship, ship.key === app.selectedShipKey ? "#ffe184" : "#79dcff");
    }
  }
  if (enemy && enemy.ships) {
    for (const ship of [...Object.values(enemy.ships), ...(enemy.extraShips || [])]) {
      if (app.state.phase !== "finished" && !visibleEnemyIds.has(ship.id)) {
        continue;
      }
      plotShip(ship, "#ff95a0");
    }
  }

  const view = currentViewState();
  ctx.strokeStyle = "#ffe08a";
  ctx.lineWidth = 1.6;
  ctx.strokeRect(
    rect.x + (view.left / canvas.width) * rect.width,
    rect.y + (view.top / canvas.height) * rect.height,
    (view.width / canvas.width) * rect.width,
    (view.height / canvas.height) * rect.height,
  );

  ctx.fillStyle = "#d2ecff";
  ctx.font = "bold 11px 'Noto Sans SC', 'PingFang SC', sans-serif";
  ctx.fillText("战区/镜头", rect.x + 8, rect.y + 14);
  ctx.restore();
}

function drawShipGroup(shipGroup, color, visibleEnemyIds = null) {
  for (const ship of shipGroup) {
    if (!ship || !ship.alive) {
      continue;
    }
    if (visibleEnemyIds && !visibleEnemyIds.has(ship.id) && app.state.phase !== "finished") {
      continue;
    }
    drawShip(ship, color, ship.key === app.selectedShipKey, ship.attached);
  }
}

function render() {
  if (!app.state) {
    return;
  }

  updateCamera();
  const view = currentViewState();
  ctx.save();
  ctx.setTransform(view.zoom, 0, 0, view.zoom, -view.left * view.zoom, -view.top * view.zoom);
  drawBackground(app.state.elapsed || 0);
  drawZones();

  const own = ownTeamState();
  const enemy = enemyTeamState();
  const visibleEnemyIds = new Set((own && own.visibleEnemyIds) || []);

  if (own && own.ships) {
    for (const ship of Object.values(own.ships)) {
      if (!ship || !ship.alive || !ship.route) {
        continue;
      }
      drawRoute(ship.route, ship.key === app.selectedShipKey);
    }
  }

  if (own && Array.isArray(own.beams)) {
    for (const beam of own.beams) {
      drawBeam(beam);
    }
  }
  if (enemy && Array.isArray(enemy.beams)) {
    for (const beam of enemy.beams) {
      drawBeam(beam);
    }
  }

  if (Array.isArray(app.state.projectiles)) {
    for (const projectile of app.state.projectiles) {
      if (!projectile || !projectile.alive) {
        continue;
      }
      drawProjectile(projectile, projectile.teamSeat === "A");
    }
  }

  if (own && own.ships) {
    drawShipGroup([...Object.values(own.ships), ...(own.extraShips || [])], own.color || "#65d9ff");
  }

  if (enemy && enemy.ships) {
    drawShipGroup([...Object.values(enemy.ships), ...(enemy.extraShips || [])], enemy.color || "#ff8692", visibleEnemyIds);
  }

  if (own && Array.isArray(own.scouts)) {
    for (const scout of own.scouts) {
      drawScout(scout, true);
    }
  }
  if (enemy && Array.isArray(enemy.scouts)) {
    for (const scout of enemy.scouts) {
      if (!visibleEnemyIds.has(scout.id) && app.state.phase !== "finished") {
        continue;
      }
      drawScout(scout, false);
    }
  }

  if (own && Array.isArray(own.wingmen)) {
    for (const wingman of own.wingmen) {
      drawWingman(wingman, true);
    }
  }
  if (enemy && Array.isArray(enemy.wingmen)) {
    for (const wingman of enemy.wingmen) {
      if (!visibleEnemyIds.has(wingman.id) && app.state.phase !== "finished") {
        continue;
      }
      drawWingman(wingman, false);
    }
  }

  if (Array.isArray(app.state.bursts)) {
    for (const burst of app.state.bursts) {
      drawBurst(burst);
    }
  }
  if (Array.isArray(app.state.floatingTexts)) {
    for (const label of app.state.floatingTexts) {
      drawFloatingText(label);
    }
  }

  drawSelectedFireArc();
  drawSelectedVisionCircle();
  drawSubSkillAimHint();
  ctx.restore();

  // In-game character portrait (drawn in screen space, after camera restore)
  const activeShip = selectedShipState();
  if (activeShip && activeShip.alive) {
    drawInGamePortrait(ctx, activeShip.characterId, canvas.width, canvas.height, 0.14, app.playerColor);
  }

  drawMinimap();

  // Pause overlay
  if (app.paused) {
    ctx.save();
    ctx.fillStyle = "rgba(2,8,15,0.45)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#e4f0ff";
    ctx.font = 'bold 42px "Noto Sans SC", "PingFang SC", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("PAUSED", canvas.width * 0.5, canvas.height * 0.5 - 20);
    ctx.fillStyle = "#8ab8d8";
    ctx.font = '16px "Noto Sans SC", "PingFang SC", sans-serif';
    ctx.fillText("按空格键继续", canvas.width * 0.5, canvas.height * 0.5 + 24);
    ctx.restore();
  }
}

function tick(timestamp) {
  if (!running) return;
  const dt = clamp((timestamp - app.lastTime) / 1000, 0, 0.05);
  app.lastTime = timestamp;

  if (!app.paused && app.sim && (!app.state || app.state.phase !== "finished")) {
    app.sim.update(dt);
  }
  app.state = app.sim ? app.sim.serializeState() : null;

  updateUi();
  render();

  rafId = requestAnimationFrame(tick);
}

function useFlagshipSkill() {
  const own = ownTeamState();
  const meta = currentFlagshipMeta(own);
  if (!meta || meta.type !== "active") {
    return;
  }
  const ok = applyAction({ type: "cast_flagship_skill", zoneId: app.selectedZoneId });
  if (ok) {
    log(`旗舰技能 ${meta.name} 已发动`);
  }
}

function useSubSkill() {
  const selected = selectedShipState();
  const own = ownTeamState();
  const meta = currentSubMeta(selected);
  if (!selected || !meta || !own) {
    return;
  }
  if (meta.target === "point" || meta.target === "optional_point") {
    if (app.pendingSubSkillAim && app.pendingSubSkillAim.shipKey === selected.key && meta.target === "optional_point") {
      const ok = applyAction({
        type: "cast_sub_skill",
        shipKey: selected.key,
        zoneId: app.selectedZoneId,
      });
      app.pendingSubSkillAim = null;
      if (ok) {
        log(`${selected.characterName} 使用 ${meta.name}`);
      }
      updateUi();
      return;
    }
    app.pendingSubSkillAim = { shipKey: selected.key };
    log(
      meta.target === "optional_point"
        ? `${meta.name} 瞄准模式：点击地图选择闪现位置，再次点击技能按钮可原地释放`
        : `${meta.name} 瞄准模式：在地图上左键点击方向开火`,
    );
    updateUi();
    return;
  }
  const ok = applyAction({
    type: "cast_sub_skill",
    shipKey: selected.key,
    zoneId: app.selectedZoneId,
  });
  if (ok) {
    log(`${selected.characterName} 使用 ${meta.name}`);
  }
}

function bindUiEvents() {
  for (const select of [ui.playerMainRole, ui.playerSub1Role, ui.playerSub2Role]) {
    if (!select) {
      continue;
    }
    select.addEventListener("change", () => {
      const normalized = readLoadoutFromControls();
      syncLoadoutControls(normalized);
    });
  }

  ui.applyLoadoutBtn.addEventListener("click", () => {
    showCharacterSelectScreen();
  });

  for (const button of ui.shipSwitchButtons) {
    button.addEventListener("click", () => {
      setSelectedShip(button.dataset.ship || "");
    });
  }
  for (const cell of ui.fleetRows) {
    cell.row.addEventListener("click", () => {
      setSelectedShip(cell.key || "");
    });
  }
  for (const button of ui.mobileShipButtons) {
    button.addEventListener("click", () => {
      setSelectedShip(button.dataset.ship || "");
    });
  }

  ui.powerSlider.addEventListener("input", () => {
    setThrottleValue(ui.powerSlider.value);
  });
  ui.zoomOutBtn.addEventListener("click", () => {
    adjustCameraZoom(-1);
  });
  ui.zoomInBtn.addEventListener("click", () => {
    adjustCameraZoom(1);
  });
  for (const button of ui.mobileThrottleButtons) {
    button.addEventListener("click", () => {
      setThrottleValue(button.dataset.throttle || 100);
    });
  }
  if (ui.mobileCenterBtn) {
    ui.mobileCenterBtn.addEventListener("click", () => {
      const ship = selectedShipState();
      if (ship) {
        centerCameraOn(ship.x, ship.y, false);
      }
    });
  }
  if (ui.mobileZoomOutBtn) {
    ui.mobileZoomOutBtn.addEventListener("click", () => {
      adjustCameraZoom(-1);
    });
  }
  if (ui.mobileZoomInBtn) {
    ui.mobileZoomInBtn.addEventListener("click", () => {
      adjustCameraZoom(1);
    });
  }

  bindPressButton(ui.splitOneBtn, () => {
    applyAction({ type: "split", level: 1 });
  });
  bindPressButton(ui.mobileSplitOneBtn, () => {
    applyAction({ type: "split", level: 1 });
  });

  bindPressButton(ui.splitTwoBtn, () => {
    applyAction({ type: "split", level: 2 });
  });
  bindPressButton(ui.mobileSplitTwoBtn, () => {
    applyAction({ type: "split", level: 2 });
  });

  bindPressButton(ui.scoutBtn, () => {
    const ok = applyAction({ type: "launch_scout", zoneId: app.selectedZoneId });
    if (ok) {
      log(`侦查机已派往战区${app.selectedZoneId}`);
    }
  });
  bindPressButton(ui.mobileScoutBtn, () => {
    const ok = applyAction({ type: "launch_scout", zoneId: app.selectedZoneId });
    if (ok) {
      log(`侦查机已派往战区${app.selectedZoneId}`);
    }
  });
  bindPressButton(ui.autoScoutBtn, toggleAutoScout);
  bindPressButton(ui.mobileAutoScoutBtn, toggleAutoScout);
  bindPressButton(ui.brakeBtn, useEmergencyBrake);
  bindPressButton(ui.mobileBrakeBtn, useEmergencyBrake);

  bindPressButton(ui.flagshipBtn, useFlagshipSkill);
  bindPressButton(ui.mobileFlagshipBtn, useFlagshipSkill);
  bindPressButton(ui.subSkillBtn, useSubSkill);
  bindPressButton(ui.mobileSubSkillBtn, useSubSkill);

  ui.restartBtn.addEventListener("click", () => {
    showCharacterSelectScreen();
  });

  canvas.addEventListener("mousedown", (event) => {
    if (app.mobileMode) {
      return;
    }
    if (event.button !== 0 || !app.state || app.state.phase === "finished") {
      return;
    }

    const pos = pointerFromEvent(event);
    app.pointer = pos;

    if (app.pendingSubSkillAim) {
      return;
    }

    const ship = selectedShipState();
    if (!ship || !ship.alive || !ship.canControl) {
      return;
    }

    const handle = routeHandleAtPoint(ship.route, pos.x, pos.y);
    if (!handle) {
      return;
    }

    app.drag = {
      handle,
      shipKey: ship.key,
    };
  });

  canvas.addEventListener("mousemove", (event) => {
    if (app.mobileMode) {
      app.pointer = pointerFromEvent(event);
      return;
    }
    const pos = pointerFromEvent(event);
    app.pointer = pos;

    if (!app.drag || !app.state || app.state.phase === "finished") {
      return;
    }

    if (app.drag.handle === "control") {
      applyAction({
        type: "route_control",
        shipKey: app.drag.shipKey,
        controlX: pos.x,
        controlY: pos.y,
      });
    } else {
      applyAction({
        type: "route_end",
        shipKey: app.drag.shipKey,
        endX: pos.x,
        endY: pos.y,
      });
    }
  });

  addWin("mouseup", () => {
    if (app.mobileMode) {
      return;
    }
    if (!app.drag) {
      return;
    }
    app.drag = null;
    app.suppressMapClick = true;
  });

  canvas.addEventListener("wheel", (event) => {
    if (app.mobileMode || !app.state || app.state.phase === "finished") {
      return;
    }
    event.preventDefault();
    const focus = screenPointFromEvent(event);
    adjustCameraZoom(event.deltaY < 0 ? 1 : -1, focus);
  }, { passive: false });

  canvas.addEventListener("click", (event) => {
    if (event.button !== 0 || !app.state || app.state.phase === "finished") {
      return;
    }

    const screenPos = screenPointFromEvent(event);
    if (app.suppressMapClick) {
      app.suppressMapClick = false;
      return;
    }

    const pos = pointerFromEvent(event);
    app.pointer = pos;

    if (app.mobileMode && app.pendingSubSkillAim) {
      if (handleMinimapTap(screenPos, { allowZoneLog: false })) {
        return;
      }
      const shipKey = app.pendingSubSkillAim.shipKey;
      const ok = applyAction({
        type: "cast_sub_skill",
        shipKey,
        targetX: pos.x,
        targetY: pos.y,
      });
      const ship = ownTeamState()?.ships?.[shipKey];
      const meta = ship ? currentSubMeta(ship) : null;
      app.pendingSubSkillAim = null;
      if (ok) {
        log(`${meta ? meta.name : "分舰技能"} 已发动`);
      }
      updateUi();
      return;
    }

    if (app.mobileMode) {
      if (handleMinimapTap(screenPos)) {
        return;
      }
      const tappedShip = ownShipAtPoint(pos.x, pos.y);
      if (tappedShip) {
        setSelectedShip(tappedShip.key);
        return;
      }
      setRouteForSelectedShip(pos.x, pos.y);
      return;
    }

    if (app.pendingSubSkillAim) {
      const shipKey = app.pendingSubSkillAim.shipKey;
      const ok = applyAction({
        type: "cast_sub_skill",
        shipKey,
        targetX: pos.x,
        targetY: pos.y,
      });
      const ship = ownTeamState()?.ships?.[shipKey];
      const meta = ship ? currentSubMeta(ship) : null;
      app.pendingSubSkillAim = null;
      if (ok) {
        log(`${meta ? meta.name : "分舰技能"} 已发动`);
      }
      return;
    }

    const zone = zoneFromPoint(pos.x, pos.y);
    if (!zone) {
      return;
    }

    setSelectedZoneId(zone.id);
  });

  canvas.addEventListener("dblclick", (event) => {
    if (app.mobileMode) {
      return;
    }
    if (event.button !== 0 || !app.state || app.state.phase === "finished") {
      return;
    }

    if (app.pendingSubSkillAim) {
      return;
    }

    const pos = pointerFromEvent(event);
    app.pointer = pos;

    const ship = selectedShipState();
    if (!ship || !ship.alive || !ship.canControl) {
      log("当前没有可用舰船可设置目标点");
      return;
    }

    const throttle = clamp(Number(ui.powerSlider.value) / 100, 0.25, 1.4);
    applyAction({
      type: "set_route",
      shipKey: ship.key,
      endX: pos.x,
      endY: pos.y,
      throttle,
      anchorToMain: ship.key === "main",
    });
    const shipSim = selectedShipSim();
    const minRadius = shipSim ? Math.round(shipSim.routeConstraintProfile().minTurnRadius) : 0;
    log(`${ship.name} 已设置贝塞尔航线`);
    log(`当前最小可行转弯半径约 ${minRadius}`);
  });

  addWin("keydown", (event) => {
    if (event.defaultPrevented) {
      return;
    }
    const active = document.activeElement;
    if (
      active &&
      (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT" || active.isContentEditable)
    ) {
      return;
    }

    // 1/2/3 or Numpad — switch ship
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
      if (setSelectedShip(nextShip)) {
        event.preventDefault();
      }
      return;
    }

    // Tab — cycle ship
    if (event.code === "Tab") {
      event.preventDefault();
      const own = ownTeamState();
      if (!own || !own.ships) return;
      const keys = ["main", "sub1", "sub2"];
      const currentIdx = keys.indexOf(app.selectedShipKey);
      const dir = event.shiftKey ? -1 : 1;
      for (let i = 1; i <= 3; i++) {
        const candidate = keys[(currentIdx + i * dir + 3) % 3];
        if (setSelectedShip(candidate)) break;
      }
      return;
    }

    // WASD — navigate zones (3x3 grid, ids 1-9)
    // Layout:  1 2 3
    //          4 5 6
    //          7 8 9
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
      const newZoneId = newRow * 3 + newCol + 1;
      setSelectedZoneId(newZoneId);
      return;
    }

    // Enter — move selected ship toward selected zone center
    if (event.code === "Enter") {
      event.preventDefault();
      if (!app.state || app.state.phase === "finished") return;
      const zone = app.state.zones ? app.state.zones.find((z) => z.id === app.selectedZoneId) : null;
      if (!zone) return;
      const cx = zone.x + zone.width * 0.5;
      const cy = zone.y + zone.height * 0.5;
      setRouteForSelectedShip(cx, cy);
      const ship = selectedShipState();
      if (ship) {
        log(`${ship.characterName} 向战区${app.selectedZoneId}中心进发`);
      }
      return;
    }

    // X — launch scout
    if (event.code === "KeyX") {
      event.preventDefault();
      const ok = applyAction({ type: "launch_scout", zoneId: app.selectedZoneId });
      if (ok) {
        log(`侦查机已派往战区${app.selectedZoneId}`);
      }
      return;
    }

    // Z — toggle auto scout
    if (event.code === "KeyZ") {
      event.preventDefault();
      toggleAutoScout();
      return;
    }

    // B — emergency brake
    if (event.code === "KeyB") {
      event.preventDefault();
      useEmergencyBrake();
      return;
    }

    // C — flagship skill
    if (event.code === "KeyC") {
      event.preventDefault();
      useFlagshipSkill();
      return;
    }

    // V — sub ship skill
    if (event.code === "KeyV") {
      event.preventDefault();
      useSubSkill();
      return;
    }

    // +/-/0 — camera zoom
    if (event.code === "Equal" || event.code === "NumpadAdd") {
      event.preventDefault();
      adjustCameraZoom(1);
      return;
    }
    if (event.code === "Minus" || event.code === "NumpadSubtract") {
      event.preventDefault();
      adjustCameraZoom(-1);
      return;
    }
    if (event.code === "Digit0" || event.code === "Numpad0") {
      event.preventDefault();
      setCameraZoom(CAMERA_ZOOM_MIN);
      return;
    }

    // Space — toggle pause
    if (event.code === "Space") {
      event.preventDefault();
      if (!app.state || app.state.phase === "finished") return;
      app.paused = !app.paused;
      log(app.paused ? "战斗已暂停" : "战斗继续");
      return;
    }
  });
  addWin("resize", () => {
    syncResponsiveMode();
    updateUi();
  });
}

function launchWithLoadout(loadout, color) {
  app.playerLoadout = loadout;
  if (color === "blue" || color === "red") {
    app.playerColor = color;
    setFaction(color); // 阵营写入统一档案，主菜单与在线模式同步
    // 预加载本队所选阵营立绘，保证画布角落立绘正确着色
    for (const key of ["main", "sub1", "sub2"]) {
      if (loadout[key]) loadPortraitImage(loadout[key], color);
    }
  }
  storeLoadout(loadout);
  syncLoadoutControls(loadout);
  resetMatch(true);
  if (!running) {
    running = true;
    app.tickRunning = true;
    app.lastTime = performance.now();
    rafId = requestAnimationFrame(tick);
  }
}

function showCharacterSelectScreen() {
  charSelect = createCharacterSelect((loadout, color) => {
    launchWithLoadout(loadout, color);
  });
  charSelect.show();
}

// ── 可挂载入口 ──
export function mount(root) {
  root.innerHTML = soloTemplate();
  cacheDom();
  initApp();
  ac = new AbortController();
  running = false;
  rafId = 0;
  syncResponsiveMode();
  populateLoadoutControls();
  bindUiEvents();
  showCharacterSelectScreen();
  return unmount;
}

function unmount() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  if (ac) ac.abort();
  ac = null;
  // 选角覆盖层挂在 body 上：用 hide() 清掉它的 keydown 监听与背景 rAF，并移除节点
  if (charSelect && typeof charSelect.hide === "function") {
    charSelect.hide();
  }
  charSelect = null;
  app = null;
}

function soloTemplate() {
  return `
    <div class="app-shell">
      <aside class="panel compact-panel battle-panel">
        <h1>射手座之日</h1>

        <div class="panel-actions">
          <a class="btn-link btn-link-home" href="/">← 主菜单</a>
          <button id="applyLoadoutBtn" type="button">换阵容</button>
        </div>

        <section class="status">
          <div><span>舰体</span><strong id="hullValue">100%</strong></div>
          <div><span>能量</span><strong id="energyValue">100%</strong></div>
          <div><span>分离</span><strong id="splitValue">编队</strong></div>
          <div><span>战区</span><strong id="zoneValueLocal">战区5</strong></div>
        </section>

        <section class="controls slim-controls">
          <h2>舰队控制</h2>
          <div id="shipQuickSwitch" class="ship-switch">
            <button type="button" class="ship-switch-btn" data-ship="main">主舰</button>
            <button type="button" class="ship-switch-btn" data-ship="sub1">副舰1</button>
            <button type="button" class="ship-switch-btn" data-ship="sub2">副舰2</button>
          </div>
          <div class="btn-row">
            <button id="splitOneBtn">一级分离</button>
            <button id="splitTwoBtn">二级分离</button>
          </div>
          <div class="slider-wrap">
            <div class="slider-head"><label for="powerSlider">推进功率</label><strong id="powerValue">100%</strong></div>
            <input id="powerSlider" type="range" min="25" max="140" step="1" value="100" />
          </div>
          <div class="zoom-control-row">
            <button id="zoomOutBtn" type="button">缩小</button>
            <strong id="zoomValue">100%</strong>
            <button id="zoomInBtn" type="button">放大</button>
          </div>
        </section>

        <section class="controls slim-controls">
          <h2>技能</h2>
          <div class="btn-grid">
            <button id="flagshipBtn">旗舰技能</button>
            <button id="subSkillBtn">分舰技能</button>
            <button id="scoutBtn">派出侦查机</button>
            <button id="autoScoutBtn" type="button">自动侦查：关</button>
            <button id="brakeBtn" type="button" class="span-2">急刹</button>
          </div>
        </section>

        <section class="controls slim-controls fleet-section">
          <h2>全队舰况</h2>
          <div id="fleetRoster" class="fleet-roster">
            <button type="button" class="fleet-row" data-ship="main">
              <div class="fleet-row-head"><span class="fleet-name">主舰</span><span class="fleet-state"></span></div>
              <div class="fleet-gauges">
                <div class="fleet-gauge"><span class="fleet-glabel">舰体</span><span class="fleet-bar"><i class="fleet-fill fleet-fill-hull"></i></span><span class="fleet-pct fleet-pct-hull">100%</span></div>
                <div class="fleet-gauge"><span class="fleet-glabel">能量</span><span class="fleet-bar"><i class="fleet-fill fleet-fill-energy"></i></span><span class="fleet-pct fleet-pct-energy">100%</span></div>
              </div>
            </button>
            <button type="button" class="fleet-row" data-ship="sub1">
              <div class="fleet-row-head"><span class="fleet-name">副一</span><span class="fleet-state"></span></div>
              <div class="fleet-gauges">
                <div class="fleet-gauge"><span class="fleet-glabel">舰体</span><span class="fleet-bar"><i class="fleet-fill fleet-fill-hull"></i></span><span class="fleet-pct fleet-pct-hull">100%</span></div>
                <div class="fleet-gauge"><span class="fleet-glabel">能量</span><span class="fleet-bar"><i class="fleet-fill fleet-fill-energy"></i></span><span class="fleet-pct fleet-pct-energy">100%</span></div>
              </div>
            </button>
            <button type="button" class="fleet-row" data-ship="sub2">
              <div class="fleet-row-head"><span class="fleet-name">副二</span><span class="fleet-state"></span></div>
              <div class="fleet-gauges">
                <div class="fleet-gauge"><span class="fleet-glabel">舰体</span><span class="fleet-bar"><i class="fleet-fill fleet-fill-hull"></i></span><span class="fleet-pct fleet-pct-hull">100%</span></div>
                <div class="fleet-gauge"><span class="fleet-glabel">能量</span><span class="fleet-bar"><i class="fleet-fill fleet-fill-energy"></i></span><span class="fleet-pct fleet-pct-energy">100%</span></div>
              </div>
            </button>
          </div>
        </section>
      </aside>

      <main class="game-wrap">
        <canvas id="gameCanvas" width="1440" height="1440"></canvas>
        <section id="mobileBattleHud" class="mobile-battle-hud" aria-live="polite">
          <div class="mobile-battle-head">
            <div id="mobileBattleSummary" class="mobile-battle-summary">主舰 | 战区5</div>
            <div class="mobile-head-actions">
              <button id="mobileCenterBtn" type="button" class="mobile-chip-btn">跟随</button>
              <button id="mobileZoomOutBtn" type="button" class="mobile-chip-btn mobile-zoom-btn">-</button>
              <button id="mobileZoomInBtn" type="button" class="mobile-chip-btn mobile-zoom-btn">+</button>
            </div>
          </div>
          <div id="mobileShipSwitch" class="mobile-ship-switch">
            <button type="button" class="mobile-ship-btn" data-ship="main">主舰</button>
            <button type="button" class="mobile-ship-btn" data-ship="sub1">副一</button>
            <button type="button" class="mobile-ship-btn" data-ship="sub2">副二</button>
          </div>
          <div class="mobile-action-grid">
            <button id="mobileSplitOneBtn" type="button">分离1</button>
            <button id="mobileSplitTwoBtn" type="button">分离2</button>
            <button id="mobileScoutBtn" type="button">侦察</button>
            <button id="mobileAutoScoutBtn" type="button">自动侦察</button>
            <button id="mobileBrakeBtn" type="button">急刹</button>
            <button id="mobileFlagshipBtn" type="button">旗舰技</button>
            <button id="mobileSubSkillBtn" type="button">分舰技</button>
            <div class="mobile-throttle-row">
              <button type="button" class="mobile-throttle-btn" data-throttle="70">70%</button>
              <button type="button" class="mobile-throttle-btn" data-throttle="100">100%</button>
              <button type="button" class="mobile-throttle-btn" data-throttle="125">125%</button>
            </div>
          </div>
          <div id="mobileBattleHint" class="mobile-battle-hint">点舰船切换，点战场直接下航线，点右上小地图选战区。</div>
        </section>
        <div id="overlay" class="overlay hidden">
          <h2 id="overlayTitle"></h2>
          <div class="overlay-actions">
            <button id="restartBtn">再来一局</button>
            <a class="btn-link overlay-home-link" href="/">返回主菜单</a>
          </div>
        </div>
      </main>
    </div>
  `;
}
