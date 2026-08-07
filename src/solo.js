import {
  DEFAULT_WORLD_SIZE,
  MatchSimulation,
  CHARACTER_ORDER,
  CHARACTER_DEFS,
  DEFAULT_AI_LOADOUT,
  DEFAULT_TEAM_LOADOUT,
  randomAiLoadout,
  EMERGENCY_BRAKE_COST,
  SCOUT_LAUNCH_COST,
  TICK_DT,
  clamp,
  cloneLoadout,
  distance,
  normalizeLoadout,
  skillMetaForCharacter,
} from "../shared/game-core.js";
import { createFixedStepClock } from "../shared/game/fixed-step-clock.js";
import { matchActions } from "../shared/protocol/match-actions.js";

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
  getDifficulty,
} from "./profile.js";

import {
  tutorial,
  TUTORIAL_ATTACK_TARGET,
  TUTORIAL_LOADOUT,
  TUTORIAL_MOVE_TARGET,
} from "./tutorial.js";
import { createSoloSetupFlow } from "./solo-setup.js";
import { showConfirm } from "./confirm-dialog.js";
import {
  createShipDestructionEffects,
  resetShipDestructionEffects,
} from "./ship-destruction-effects.js";
import {
  drawBattleWorld,
  drawMinimap,
  drawPauseOverlay,
} from "./battle/render.js";
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
  throttleLabelForValue,
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
import { createLocalBattleActionTransport } from "./battle/action-transport.js";
import { createMobileScoutJoystick } from "./battle/scout-joystick.js";
import { interpolateBattleState } from "./battle/state-interpolation.js";
import {
  characterShortName,
  shipCharacterName,
  shipDisplayName,
  slotLabel as localizedSlotLabel,
  splitLabel as localizedSplitLabel,
  t,
} from "./i18n.js";

// 可挂载模块状态：每次 mount 重新初始化（同一时刻只挂载一个模式）
let canvas, ctx, ui, app;
let camera = null; // 共享战场相机（src/battle/camera.js），mount 时创建
let ac = null; // AbortController：统一移除 window 级监听
let rafId = 0; // 渲染循环句柄
let running = false; // 渲染循环开关
let charSelect = null; // 选角覆盖层引用，卸载时移除
let setupFlow = null; // 战役 / 难度选择覆盖层
let actionTransport = null; // 单人本地权威动作入口，与联机传输保持同一接口

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
  powerGearButtons: Array.from(document.querySelectorAll("#powerGearControl .throttle-gear-btn")),
  powerValue: document.getElementById("powerValue"),
  zoomOutBtn: document.getElementById("zoomOutBtn"),
  zoomInBtn: document.getElementById("zoomInBtn"),
  zoomValue: document.getElementById("zoomValue"),
  zoneValue: document.getElementById("zoneValue"),
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
// 逻辑世界尺寸：所有游戏/坐标运算都在这个固定的 1440 空间里(与画布物理像素解耦)。
// 画布 backing store 改为按设备像素铺满显示区域,渲染时整体放大 LOGICAL→设备像素,
// 从而在 Retina/大屏上像素级清晰、无放大模糊。
const LOGICAL = DEFAULT_WORLD_SIZE; // 与在线/服务器共用同一权威尺寸,防止两种模式地图割裂

function initApp() {
  app = {
  sim: null,
  state: null,
  renderPreviousState: null,
  renderCurrentState: null,
  renderState: null,
  campaign: "standard",
  playerLoadout: readStoredLoadout(),
  enemyLoadout: cloneLoadout(DEFAULT_AI_LOADOUT),
  playerColor: getFaction(), // 玩家阵营立绘色（取自统一档案，可被角色选择覆盖）

  selectedShipKey: "main",
  selectedZoneId: 5,
  pointer: { x: LOGICAL * 0.5, y: LOGICAL * 0.5 },
  drag: null,
  suppressMapClick: false,
  pendingSubSkillAim: null,
  destructionEffects: createShipDestructionEffects(),
  logicClock: createFixedStepClock({ initialTimeMs: performance.now() }),
  gameOverLogged: false,
  tickRunning: false,
  paused: false,
  mobileMode: false,
  stars: Array.from({ length: 220 }, () => ({
    x: Math.random() * LOGICAL,
    y: Math.random() * LOGICAL,
    r: Math.random() * 1.6 + 0.4,
    p: Math.random() * TAU,
  })),
  };
  actionTransport = createLocalBattleActionTransport({
    getSimulation: () => app.sim,
    seat: "A",
    onAccepted: (action) => tutorial.onAction(action),
  });
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

function syncResponsiveMode() {
  app.mobileMode = prefersMobileBattleMode();
  if (!app.mobileMode) {
    camera.releaseManual();
  }
  if (ui.mobileBattleHud) {
    ui.mobileBattleHud.hidden = !app.mobileMode;
  }
  camera.resizeCanvas(); // 显示尺寸/方向变化时,同步 backing store 到设备像素,保持清晰
}

function log(message) {
  // 日志面板已被「全队舰况」取代；保留函数让各处战斗事件调用安全空转
  if (!ui.log) {
    return;
  }
  const row = document.createElement("div");
  const elapsed = app.state ? Math.floor(app.state.elapsed) : 0;
  row.textContent = `[${t("{value}秒", { value: String(elapsed).padStart(3, "0") })}] ${message}`;
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

function applyAction(action) {
  if (!actionTransport) {
    return false;
  }
  if (tutorial.isActive() && !tutorial.allowsAction(action)) {
    return false;
  }
  return actionTransport.send(action);
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
  return `${slotLabel(slotKey)} ${def.shortName} | ${t("舰体")}${stat.hp} | ${t("能量")}${stat.energy} | ${t("航速")}${stat.speed} | ${t("机动")}${stat.turnRate.toFixed(2)}`;
}

function slotLabel(slotKey) {
  return localizedSlotLabel(slotKey);
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
    main: `${localizedSlotLabel("main", "short")} ${CHARACTER_DEFS[loadout.main].shortName}`,
    sub1: `${localizedSlotLabel("sub1", "short")} ${CHARACTER_DEFS[loadout.sub1].shortName}`,
    sub2: `${localizedSlotLabel("sub2", "short")} ${CHARACTER_DEFS[loadout.sub2].shortName}`,
  };
  for (const button of ui.shipSwitchButtons) {
    button.textContent = labelMap[button.dataset.ship] || button.textContent;
  }
}

function createSimulation() {
  return new MatchSimulation({
    mode: "ai",
    worldSize: LOGICAL,
    teamNames: {
      A: t("SOS先遣舰队"),
      B: t("统合思念体舰队"),
    },
    teamLoadouts: {
      A: app.playerLoadout,
      B: app.enemyLoadout,
    },
    aiDifficulty: getDifficulty(), // 单人难度:敌方数值(血量+伤害)缩放 + AI反应快慢,极限额外开启智能集火残血
    tutorialMode: app.campaign === "tutorial",
  });
}

function resetMatch(logMessage = true) {
  if (app.campaign === "standard") {
    app.enemyLoadout = randomAiLoadout(); // 每局随机 AI 阵容(主舰不含长门/鹤屋),结算画面据此展示敌方
  } else {
    app.enemyLoadout = cloneLoadout(DEFAULT_AI_LOADOUT); // 教程敌舰技能由仿真层禁用，阵容只用于既有绘制结构
  }
  app.sim = createSimulation();
  app.state = app.sim.serializeState();
  app.renderPreviousState = app.state;
  app.renderCurrentState = app.state;
  app.renderState = app.state;
  app.selectedShipKey = "main";
  app.selectedZoneId = 5;
  app.drag = null;
  app.suppressMapClick = false;
  app.pendingSubSkillAim = null;
  resetShipDestructionEffects(app.destructionEffects);
  app.gameOverLogged = false;
  app.paused = false;
  app.logicClock.reset(performance.now());
  const mainShip = app.sim.teamA.ships.main;
  camera.reset({ x: mainShip.x, y: mainShip.y });
  updateShipSwitchLabels(app.playerLoadout);
  if (logMessage) {
    clearLog();
    log(app.mobileMode ? t("战斗开始。点战场直接移动，按住侦察并拖向目标战区。") : t("战斗开始。右键单击设目标点；左键拖控制点调曲率、拖端点调路径；左键单击空白处选战区。"));
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
  if (tutorial.isActive() && !tutorial.allowsShipSelection(shipKey)) {
    return false;
  }
  app.selectedShipKey = shipKey;
  if (app.pendingSubSkillAim && app.pendingSubSkillAim.shipKey !== shipKey) {
    app.pendingSubSkillAim = null;
  }
  const shipSim = selectedShipSim();
  if ((app.mobileMode || camera.zoom > CAMERA_ZOOM_MIN + 1e-3) && shipSim) {
    camera.centerCameraOn(shipSim.x, shipSim.y, false);
  }
  syncPowerFromSelected();
  updateUi();
  tutorial.onShipSelection(shipKey);
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

function syncPowerFromSelected() {
  const ship = selectedShipState();
  if (!ship) {
    return;
  }
  syncThrottleGearControls(ui, ship.throttle);
}

function setThrottleGear(gear) {
  if (tutorial.isActive() && !tutorial.allowsControl("throttle")) return false;
  const throttle = throttleValueForGear(gear);
  syncThrottleGearControls(ui, throttle);
  applyAction(matchActions.setThrottle({
    shipKey: app.selectedShipKey,
    throttle,
  }));
  updateUi();
}

function syncAutoScoutZone() {
  const own = ownTeamState();
  if (!own?.autoScout?.enabled) {
    return false;
  }
  return applyAction(matchActions.configureAutoScout({
    enabled: true,
    zoneId: app.selectedZoneId,
  }));
}

function setSelectedZoneId(zoneId, { allowLog = true } = {}) {
  if (tutorial.isActive() && !tutorial.allowsControl("zoneSelection")) return false;
  const nextZoneId = clamp(Number(zoneId) || app.selectedZoneId, 1, 9);
  const changed = nextZoneId !== app.selectedZoneId;
  app.selectedZoneId = nextZoneId;
  if (changed && allowLog) {
    log(t("已选中战区{zone}", { zone: nextZoneId }));
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
  const ok = applyAction(matchActions.configureAutoScout({
    enabled,
    zoneId: app.selectedZoneId,
  }));
  if (ok) {
    log(enabled ? t("自动侦查已开启，目标战区{zone}", { zone: app.selectedZoneId }) : t("自动侦查已关闭"));
    updateUi();
  }
  return ok;
}

function useEmergencyBrake() {
  const ship = selectedShipState();
  if (!ship || !ship.alive || !ship.canControl) {
    return false;
  }
  const ok = applyAction(matchActions.emergencyBrake(ship.key));
  if (ok) {
    log(t("{ship} 执行急刹", { ship: shipDisplayName(ship) }));
    updateUi();
  }
  return ok;
}

function handleMinimapTap(screenPos, { allowZoneLog = true } = {}) {
  if (!app.mobileMode) {
    return false;
  }
  const world = camera.minimapWorldPointFromScreenPoint(screenPos.x, screenPos.y);
  if (!world) {
    return false;
  }
  camera.centerCameraOn(world.x, world.y, true);
  const zone = zoneFromPoint(app.state, world.x, world.y);
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
  const throttle = throttleValueForGear(syncThrottleGearControls(ui, ship.throttle));
  const ok = applyAction(matchActions.setRoute({
    shipKey: ship.key,
    endX: x,
    endY: y,
    throttle,
    anchorToMain: ship.key === "main",
  }));
  if (ok && logRoute) {
    log(t("{ship} 已设置新航线", { ship: shipDisplayName(ship) }));
  }
  return ok;
}

function forceTutorialControl(elements, allowed) {
  for (const el of (Array.isArray(elements) ? elements : [elements])) {
    if (!el) continue;
    el.classList.toggle("tut-locked", !allowed);
    if (!allowed && "disabled" in el) el.disabled = true;
    el.setAttribute("aria-disabled", allowed ? "false" : "true");
  }
}

function applyTutorialUiGates() {
  if (!tutorial.isActive()) return;
  const allow = (key) => tutorial.allowsControl(key);
  forceTutorialControl([...ui.powerGearButtons, ...ui.mobileThrottleButtons], false);
  forceTutorialControl([ui.zoomOutBtn, ui.zoomInBtn, ui.mobileZoomOutBtn, ui.mobileZoomInBtn], false);
  forceTutorialControl([ui.autoScoutBtn, ui.mobileAutoScoutBtn, ui.brakeBtn, ui.mobileBrakeBtn], false);
  forceTutorialControl([ui.mobileCenterBtn, ui.applyLoadoutBtn], false);
  forceTutorialControl([ui.scoutBtn, ui.mobileScoutBtn], allow("scout"));
  forceTutorialControl([ui.splitOneBtn, ui.mobileSplitOneBtn], allow("split1"));
  forceTutorialControl([ui.splitTwoBtn, ui.mobileSplitTwoBtn], allow("split2"));
  forceTutorialControl([ui.flagshipBtn, ui.mobileFlagshipBtn], allow("flagshipSkill"));
  forceTutorialControl([ui.subSkillBtn, ui.mobileSubSkillBtn], allow("subSkill"));
  for (const button of [...ui.shipSwitchButtons, ...ui.mobileShipButtons, ...ui.fleetRows.map((item) => item.row)]) {
    forceTutorialControl(button, allow("shipSelection") && tutorial.allowsShipSelection(button.dataset.ship));
  }
  ui.energyValue?.parentElement?.classList.toggle("tut-concealed", !allow("energy"));
  document.getElementById("fleetRoster")?.closest(".fleet-section")?.classList.toggle("tut-concealed", !allow("fleetRoster"));
}

function updateUi() {
  const own = ownTeamState();
  if (!own) {
    return;
  }

  syncShipSelection();
  syncPowerFromSelected();

  ui.hullValue.textContent = `${Math.round((own.hullRatio || 0) * 100)}%`;
  ui.splitValue.textContent = localizedSplitLabel(own.splitLevel);
  ui.zoneValue.textContent = t("战区{zone}", { zone: app.selectedZoneId });
  ui.zoomValue.textContent = `${Math.round(camera.zoom * 100)}%`;
  ui.zoomOutBtn.disabled = camera.zoom <= CAMERA_ZOOM_MIN + 1e-3;
  ui.zoomInBtn.disabled = camera.zoom >= CAMERA_ZOOM_MAX - 1e-3;

  const selectedState = selectedShipState();
  const selectedSim = selectedShipSim();
  ui.energyValue.textContent = `${energyPercentForShip(selectedState || own.ships.main)}%`;
  if (selectedState && selectedSim) {
    const minRadius = Math.round(selectedSim.routeConstraintProfile().minTurnRadius);
    ui.selectedValue.textContent = `${shipCharacterName(selectedState)} | ${throttleLabelForValue(selectedState.throttle)} | ${t("能量")} ${Math.round(
      Number(selectedState.fleetEnergy) || 0,
    )}/${Math.round(Number(selectedState.fleetMaxEnergy) || 1)} | ${t("最小半径")}${minRadius}${selectedState.braking ? ` | ${t("急刹中")}` : ""}`;
  } else {
    ui.selectedValue.textContent = t("无");
  }

  ui.splitOneBtn.disabled = own.splitLevel >= 1;
  ui.splitTwoBtn.disabled = own.splitLevel < 1 || own.splitLevel >= 2;
  updateSkillButtons(ui, own, {
    selected: selectedState,
    selectedZoneId: app.selectedZoneId,
    pendingSubSkillAim: app.pendingSubSkillAim,
    fallbackLoadout: app.playerLoadout,
  });
  renderFleetRoster(ui, own, { selectedShipKey: app.selectedShipKey });
  syncMobileHud(ui, own, {
    visible: app.mobileMode,
    selected: selectedState,
    selectedShipKey: app.selectedShipKey,
    selectedZoneId: app.selectedZoneId,
    pendingSubSkillAim: app.pendingSubSkillAim,
  });
  applyTutorialUiGates();

  if (app.state.phase === "finished") {
    if (!app.gameOverLogged) {
      showResultScreen(app.state.winnerSeat);
      if (app.state.winnerSeat === "A") {
        log(t("战斗结束：SOS先遣舰队获胜"));
      } else if (app.state.winnerSeat === "B") {
        log(t("战斗结束：SOS先遣舰队战败"));
      } else {
        log(t("战斗结束：平局"));
      }
      app.gameOverLogged = true;
    }
    ui.overlay.classList.remove("hidden");
  } else {
    ui.overlay.classList.add("hidden");
    app.gameOverLogged = false;
  }
}

// 单人难度 → 展示用 { 文案, 配色类 }(与选角页四档一致)
function difficultyMeta() {
  const map = {
    easy: { label: "简单", cls: "easy" },
    normal: { label: "普通", cls: "normal" },
    hard: { label: "困难", cls: "hard" },
    master: { label: "极限", cls: "master" },
  };
  return map[getDifficulty()] || map.normal;
}

// 一侧阵容(主舰高亮 + 两副舰):头像取该阵营立绘,头部偏上裁切
function resultSideHTML(loadout, faction, sideLabel, sideClass) {
  const base = import.meta.env.BASE_URL;
  const cards = ["main", "sub1", "sub2"]
    .map((slot, i) => {
      const id = loadout[slot];
      const src = `${base}assets/portraits/${faction}/${id}.webp`;
      const role = localizedSlotLabel(slot, "short");
      const name = characterShortName(id, CHARACTER_DEFS[id] ? CHARACTER_DEFS[id].shortName : id);
      return (
        `<div class="rl-card${slot === "main" ? " rl-main" : ""}" style="--i:${i}">` +
        `<span class="rl-portrait"><img src="${src}" alt="" loading="lazy" draggable="false"></span>` +
        `<span class="rl-role">${role}</span>` +
        `<span class="rl-name">${name}</span>` +
        `</div>`
      );
    })
    .join("");
  return (
    `<div class="result-side ${sideClass}">` +
    `<div class="result-side-label">${sideLabel}</div>` +
    `<div class="rl-cards">${cards}</div>` +
    `</div>`
  );
}

// 结算画面:只在进入 finished 时渲染一次(避免每帧重置动画)
function showResultScreen(winnerSeat) {
  const card = document.getElementById("resultCard");
  if (!card) return;
  const eyebrowEl = document.getElementById("resultEyebrow");
  const subEl = document.getElementById("resultSub");
  const diffEl = document.getElementById("resultDiff");
  const versusEl = document.getElementById("resultVersus");

  let cls, eyebrow, title, sub;
  if (winnerSeat === "A") {
    cls = "result-win"; eyebrow = "VICTORY"; title = t("胜利"); sub = t("敌方舰队已被击溃");
  } else if (winnerSeat === "B") {
    cls = "result-lose"; eyebrow = "DEFEAT"; title = t("失败"); sub = t("SOS先遣舰队被歼灭");
  } else {
    cls = "result-draw"; eyebrow = "STALEMATE"; title = t("战斗结束"); sub = t("双方同归于尽");
  }
  card.classList.remove("result-win", "result-lose", "result-draw");
  card.classList.add(cls);
  eyebrowEl.textContent = eyebrow;
  ui.overlayTitle.textContent = title;
  subEl.textContent = sub;

  const dm = difficultyMeta();
  diffEl.innerHTML = app.campaign === "tutorial"
    ? `<span class="result-diff-label">${t("战役")}</span><span class="result-diff-val rd-normal">${t("教程")}</span>`
    : `<span class="result-diff-label">${t("难度")}</span><span class="result-diff-val rd-${dm.cls}">${t(dm.label)}</span>`;

  const playerFaction = getFaction();
  const enemyFaction = playerFaction === "blue" ? "red" : "blue";
  versusEl.innerHTML =
    resultSideHTML(app.playerLoadout, playerFaction, t("SOS先遣舰队"), "result-side-player") +
    `<div class="result-vs"><span>VS</span></div>` +
    resultSideHTML(app.enemyLoadout, enemyFaction, t("统合思念体舰队"), "result-side-enemy");

  // 重新触发入场动画
  card.classList.remove("result-in");
  void card.offsetWidth;
  card.classList.add("result-in");
}

function drawTutorialIllustration(kind) {
  const own = ownTeamState();
  if (!own?.ships || !kind) return;
  const ship = own.ships.main;
  if (!ship?.alive) return;
  const pulse = 0.5 + Math.sin(performance.now() / 420) * 0.18;
  ctx.save();

  const drawTarget = (target, label, color = "#f0d488") => {
    ctx.fillStyle = `${color}14`;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 7]);
    ctx.beginPath();
    ctx.arc(target.x, target.y, target.radius * (0.97 + pulse * 0.05), 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "700 14px 'Noto Sans SC', 'PingFang SC', sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = color;
    ctx.fillText(t(label), target.x, target.y - target.radius - 12);
  };

  if (kind === "moveTarget") drawTarget(TUTORIAL_MOVE_TARGET, "移动目标", "#8adfff");
  if (kind === "attackTarget") drawTarget(TUTORIAL_ATTACK_TARGET, "三舰集结区域", "#f0d488");
  if (kind === "enemyRegion") drawTarget({ ...TUTORIAL_ATTACK_TARGET, x: 980, radius: 96 }, "敌方动向", "#ef7272");

  if (kind === "vision" || kind === "range") {
    const radius = kind === "vision" ? ship.vision : ship.range;
    const color = kind === "vision" ? "#8adfff" : "#f0d488";
    ctx.strokeStyle = color;
    ctx.fillStyle = `${color}0d`;
    ctx.lineWidth = 2.4;
    ctx.setLineDash(kind === "range" ? [10, 7] : []);
    ctx.beginPath();
    ctx.arc(ship.x, ship.y, radius, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "700 14px 'Noto Sans SC', 'PingFang SC', sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = color;
    ctx.fillText(t(kind === "vision" ? "视野" : "射程"), ship.x, ship.y - radius - 8);
  }

  if (kind === "scoutVision") {
    for (const scout of own.scouts || []) {
      ctx.strokeStyle = "#8adfffcc";
      ctx.fillStyle = "#8adfff0b";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(scout.x, scout.y, scout.vision || 96, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

function render(state = app.state) {
  if (!state) {
    return;
  }

  const tutorialIllustration = tutorial.isActive() ? tutorial.getIllustration() : null;
  if (app.mobileMode && tutorialIllustration === "moveTarget") {
    const main = state.teams?.A?.ships?.main;
    if (main?.alive) {
      // 第一阶段同时框住起始舰队与目标点，避免移动端自动跟随把唯一合法落点推到视野外。
      camera.centerCameraOn(
        (main.x + TUTORIAL_MOVE_TARGET.x) * 0.5,
        (main.y + TUTORIAL_MOVE_TARGET.y) * 0.5,
        true,
      );
    }
  }

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

  // 战场本体全部交给共享渲染层(src/battle/render.js),单人只负责喂本地仿真状态
  const own = state.teams?.A || null;
  const enemy = state.teams?.B || null;
  const frame = {
    state,
    ownTeam: own,
    enemyTeam: enemy,
    spectating: false,
    radar: app.sim ? app.sim.serializeRadarForSeat("A") : null,
    visibleEnemyIds: new Set((own && own.visibleEnemyIds) || []),
    selectedKeyForTeam: (team) => (team === own ? app.selectedShipKey : null),
    mobileMode: app.mobileMode,
    stars: app.stars,
    destructionEffects: app.destructionEffects,
    selectedZoneId: app.selectedZoneId,
    pendingSubSkillAim: app.pendingSubSkillAim,
    pointer: app.pointer,
  };
  drawBattleWorld(ctx, frame);
  if (tutorialIllustration) {
    drawTutorialIllustration(tutorialIllustration);
  }
  ctx.restore();

  // 屏幕空间:角色立绘、移动端小地图、暂停遮罩
  const activeShip = own?.ships?.[app.selectedShipKey] || null;
  if (activeShip && activeShip.alive) {
    drawInGamePortrait(ctx, activeShip.characterId, LOGICAL, LOGICAL, 0.14, app.playerColor);
  }

  drawMinimap(ctx, frame, camera.minimapRect(), view);

  if (app.paused) {
    drawPauseOverlay(ctx);
  }
}

function tick(timestamp) {
  if (!running) return;
  const simulationActive = Boolean(
    !app.paused &&
    app.sim &&
    (!app.state || app.state.phase !== "finished")
  );
  const stepCount = app.logicClock.advance(timestamp, (stepSeconds) => {
    app.renderPreviousState = app.renderCurrentState || app.state || app.sim.serializeState();
    app.sim.update(stepSeconds);
    app.renderCurrentState = app.sim.serializeState();
  }, {
    active: simulationActive,
  });
  if (app.sim) {
    app.state = stepCount > 0 ? app.renderCurrentState : app.sim.serializeState();
    if (stepCount === 0) {
      // 输入动作会在两个逻辑 tick 之间立即改变仿真；同步离散字段，位置仍由前一权威帧平滑过渡。
      app.renderCurrentState = app.state;
    }
  } else {
    app.state = null;
  }

  const shouldInterpolate = Boolean(
    simulationActive &&
    app.state?.phase !== "finished" &&
    app.renderPreviousState &&
    app.renderCurrentState
  );
  app.renderState = shouldInterpolate
    ? interpolateBattleState(
      app.renderPreviousState,
      app.renderCurrentState,
      app.logicClock.getAccumulatorSeconds() / TICK_DT,
      { spanSeconds: TICK_DT },
    )
    : app.state;

  tutorial.update(app.state);
  updateUi();
  render(app.renderState);

  rafId = requestAnimationFrame(tick);
}

function useFlagshipSkill() {
  if (tutorial.isActive() && !tutorial.allowsControl("flagshipSkill")) return;
  const own = ownTeamState();
  const meta = currentFlagshipMeta(own, app.playerLoadout);
  if (!meta || meta.type !== "active") {
    return;
  }
  const ok = applyAction(matchActions.castFlagshipSkill(app.selectedZoneId));
  if (ok) {
    log(t("旗舰技能 {name} 已发动", { name: meta.name }));
  }
}

function useSubSkill() {
  if (tutorial.isActive() && !tutorial.allowsControl("subSkill")) return;
  const selected = selectedShipState();
  const own = ownTeamState();
  const meta = currentSubMeta(selected);
  if (!selected || !meta || !own) {
    return;
  }
  if (meta.target === "point" || meta.target === "optional_point") {
    if (app.pendingSubSkillAim && app.pendingSubSkillAim.shipKey === selected.key && meta.target === "optional_point") {
      const ok = applyAction(matchActions.castSubSkill({
        shipKey: selected.key,
        zoneId: app.selectedZoneId,
      }));
      app.pendingSubSkillAim = null;
      if (ok) {
        log(t("{ship} 使用 {name}", { ship: shipCharacterName(selected), name: meta.name }));
      }
      updateUi();
      return;
    }
    app.pendingSubSkillAim = { shipKey: selected.key };
    log(
      meta.target === "optional_point"
        ? t("{name} 瞄准模式：点击地图选择闪现位置，再次点击技能按钮可原地释放", { name: meta.name })
        : t("{name} 瞄准模式：在地图上左键点击方向开火", { name: meta.name }),
    );
    updateUi();
    return;
  }
  const ok = applyAction(matchActions.castSubSkill({
    shipKey: selected.key,
    zoneId: app.selectedZoneId,
  }));
  if (ok) {
    log(t("{ship} 使用 {name}", { ship: shipCharacterName(selected), name: meta.name }));
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

  for (const button of ui.powerGearButtons) {
    button.addEventListener("click", () => {
      setThrottleGear(button.dataset.gear);
    });
  }
  ui.zoomOutBtn.addEventListener("click", () => {
    if (tutorial.isActive()) return;
    camera.adjustCameraZoom(-1);
  });
  ui.zoomInBtn.addEventListener("click", () => {
    if (tutorial.isActive()) return;
    camera.adjustCameraZoom(1);
  });
  for (const button of ui.mobileThrottleButtons) {
    button.addEventListener("click", () => {
      setThrottleGear(button.dataset.gear);
    });
  }
  if (ui.mobileCenterBtn) {
    ui.mobileCenterBtn.addEventListener("click", () => {
      if (tutorial.isActive()) return;
      const ship = selectedShipState();
      if (ship) {
        camera.centerCameraOn(ship.x, ship.y, false);
      }
    });
  }
  if (ui.mobileZoomOutBtn) {
    ui.mobileZoomOutBtn.addEventListener("click", () => {
      if (tutorial.isActive()) return;
      camera.adjustCameraZoom(-1);
    });
  }
  if (ui.mobileZoomInBtn) {
    ui.mobileZoomInBtn.addEventListener("click", () => {
      if (tutorial.isActive()) return;
      camera.adjustCameraZoom(1);
    });
  }

  bindPressButton(ui.splitOneBtn, () => {
    applyAction(matchActions.split(1));
  });
  bindPressButton(ui.mobileSplitOneBtn, () => {
    applyAction(matchActions.split(1));
  });

  bindPressButton(ui.splitTwoBtn, () => {
    applyAction(matchActions.split(2));
  });
  bindPressButton(ui.mobileSplitTwoBtn, () => {
    applyAction(matchActions.split(2));
  });

  bindPressButton(ui.scoutBtn, () => {
    const ok = applyAction(matchActions.launchScout({ zoneId: app.selectedZoneId, shipKey: app.selectedShipKey }));
    if (ok) {
      log(t("侦查机已派往战区{zone}", { zone: app.selectedZoneId }));
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
      const ok = applyAction(matchActions.launchScout({ zoneId: app.selectedZoneId, shipKey: app.selectedShipKey }));
      if (ok) {
        log(t("侦查机已派往战区{zone}", { zone: app.selectedZoneId }));
      }
      return ok;
    },
  });
  bindPressButton(ui.autoScoutBtn, toggleAutoScout);
  bindPressButton(ui.mobileAutoScoutBtn, toggleAutoScout);
  bindPressButton(ui.brakeBtn, useEmergencyBrake);
  bindPressButton(ui.mobileBrakeBtn, useEmergencyBrake);

  bindPressButton(ui.flagshipBtn, useFlagshipSkill);
  bindPressButton(ui.mobileFlagshipBtn, useFlagshipSkill);
  bindPressButton(ui.subSkillBtn, useSubSkill);
  bindPressButton(ui.mobileSubSkillBtn, useSubSkill);

  bindBattleExitGuard();

  ui.restartBtn.addEventListener("click", () => {
    if (app.campaign === "tutorial") launchTutorialCampaign();
    else showCharacterSelectScreen();
  });

  // 桌面右键用于设航线:窗口级屏蔽右键菜单——含「右键按下拖动后在画布外松开」的情况,
  // 避免 Windows 右键拖动触发浏览器手势/右键菜单。随 ac 在卸载时自动移除。
  addWin("contextmenu", (event) => {
    if (!app.mobileMode) {
      event.preventDefault();
    }
  });

  canvas.addEventListener("mousedown", (event) => {
    if (app.mobileMode || !app.state || app.state.phase === "finished") {
      return;
    }
    if (app.pendingSubSkillAim) {
      return; // 技能瞄准中不处理航线
    }

    const ship = selectedShipState();

    // 左键:抓取航线手柄拖拽 —— 控制点=调曲率,端点=调路径。没抓到手柄则交给 click 选战区。
    if (event.button === 0) {
      if (!ship || !ship.alive || !ship.canControl) {
        return;
      }
      const pos = camera.pointerFromEvent(event);
      app.pointer = pos;
      const handle = routeHandleAtPoint(ship.route, pos.x, pos.y);
      if (handle) {
        app.drag = { handle, shipKey: ship.key };
      }
      return;
    }

    // 右键:在落点创建路径点(设目标,默认曲率;之后用左键拖控制点调曲率)
    if (event.button === 2) {
      event.preventDefault();
      if (!ship || !ship.alive || !ship.canControl) {
        log(t("当前没有可用舰船可设置目标点"));
        return;
      }
      const pos = camera.pointerFromEvent(event);
      app.pointer = pos;
      setRouteForSelectedShip(pos.x, pos.y);
      const shipSim = selectedShipSim();
      const minRadius = shipSim ? Math.round(shipSim.routeConstraintProfile().minTurnRadius) : 0;
      log(t("{ship} 已设置航线(左键拖控制点调曲率/端点调路径,最小转弯半径约 {radius})", { ship: shipDisplayName(ship), radius: minRadius }));
    }
  });

  canvas.addEventListener("mousemove", (event) => {
    if (app.mobileMode) {
      app.pointer = camera.pointerFromEvent(event);
      return;
    }
    const pos = camera.pointerFromEvent(event);
    app.pointer = pos;

    if (!app.drag || !app.state || app.state.phase === "finished") {
      return;
    }

    if (app.drag.handle === "control") {
      applyAction(matchActions.routeControl({
        shipKey: app.drag.shipKey,
        controlX: pos.x,
        controlY: pos.y,
      }));
    } else {
      applyAction(matchActions.routeEnd({
        shipKey: app.drag.shipKey,
        endX: pos.x,
        endY: pos.y,
      }));
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
    app.suppressMapClick = true; // 拖拽手柄结束后,抑制这次 click 的战区切换
  });

  canvas.addEventListener("wheel", (event) => {
    if (app.mobileMode || tutorial.isActive() || !app.state || app.state.phase === "finished") {
      return;
    }
    event.preventDefault();
    const focus = camera.screenPointFromEvent(event);
    camera.adjustCameraZoom(event.deltaY < 0 ? 1 : -1, focus);
  }, { passive: false });

  canvas.addEventListener("click", (event) => {
    if (event.button !== 0 || !app.state || app.state.phase === "finished") {
      return;
    }

    const screenPos = camera.screenPointFromEvent(event);
    if (app.suppressMapClick) {
      app.suppressMapClick = false;
      return;
    }

    const pos = camera.pointerFromEvent(event);
    app.pointer = pos;

    if (app.mobileMode && app.pendingSubSkillAim) {
      if (handleMinimapTap(screenPos, { allowZoneLog: false })) {
        return;
      }
      const shipKey = app.pendingSubSkillAim.shipKey;
      const ok = applyAction(matchActions.castSubSkill({
        shipKey,
        targetX: pos.x,
        targetY: pos.y,
      }));
      const ship = ownTeamState()?.ships?.[shipKey];
      const meta = ship ? currentSubMeta(ship) : null;
      app.pendingSubSkillAim = null;
      if (ok) {
        log(t("{name} 已发动", { name: meta ? meta.name : t("分舰技能") }));
      }
      updateUi();
      return;
    }

    if (app.mobileMode) {
      if (handleMinimapTap(screenPos)) {
        return;
      }
      setRouteForSelectedShip(pos.x, pos.y);
      return;
    }

    if (app.pendingSubSkillAim) {
      const shipKey = app.pendingSubSkillAim.shipKey;
      const ok = applyAction(matchActions.castSubSkill({
        shipKey,
        targetX: pos.x,
        targetY: pos.y,
      }));
      const ship = ownTeamState()?.ships?.[shipKey];
      const meta = ship ? currentSubMeta(ship) : null;
      app.pendingSubSkillAim = null;
      if (ok) {
        log(t("{name} 已发动", { name: meta ? meta.name : t("分舰技能") }));
      }
      return;
    }

    const zone = zoneFromPoint(app.state, pos.x, pos.y);
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
      (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT" || active.isContentEditable)
    ) {
      return;
    }

    const throttleGear = throttleGearFromShortcut(event, selectedShipState()?.throttle);
    if (throttleGear !== null) {
      event.preventDefault();
      if (!tutorial.isActive()) setThrottleGear(throttleGear);
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
      if (tutorial.isActive()) return;
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
        log(t("{ship} 向战区{zone}中心进发", { ship: shipCharacterName(ship), zone: app.selectedZoneId }));
      }
      return;
    }

    // X — launch scout
    if (event.code === "KeyX") {
      event.preventDefault();
      const ok = applyAction(matchActions.launchScout({ zoneId: app.selectedZoneId, shipKey: app.selectedShipKey }));
      if (ok) {
        log(t("侦查机已派往战区{zone}", { zone: app.selectedZoneId }));
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
      if (!tutorial.isActive()) camera.adjustCameraZoom(1);
      return;
    }
    if (event.code === "Minus" || event.code === "NumpadSubtract") {
      event.preventDefault();
      if (!tutorial.isActive()) camera.adjustCameraZoom(-1);
      return;
    }
    if (event.code === "Digit0" || event.code === "Numpad0") {
      event.preventDefault();
      if (!tutorial.isActive()) camera.setCameraZoom(CAMERA_ZOOM_MIN);
      return;
    }

    // Space — toggle pause
    if (event.code === "Space") {
      event.preventDefault();
      if (!app.state || app.state.phase === "finished") return;
      app.paused = !app.paused;
      log(app.paused ? t("战斗已暂停") : t("战斗继续"));
      return;
    }
  });
  addWin("resize", () => {
    syncResponsiveMode();
    updateUi();
  });
}

function beginSimulationLoop() {
  camera.resizeCanvas();
  if (!running) {
    running = true;
    app.tickRunning = true;
    app.logicClock.reset(performance.now());
    rafId = requestAnimationFrame(tick);
  }
}

function applyPlayerFaction(color, loadout) {
  if (color !== "blue" && color !== "red") return;
  app.playerColor = color;
  setFaction(color);
  for (const key of ["main", "sub1", "sub2"]) {
    if (loadout[key]) loadPortraitImage(loadout[key], color);
  }
}

function launchWithLoadout(loadout, color) {
  setupFlow?.destroy();
  setupFlow = null;
  document.getElementById("battleView")?.removeAttribute("inert");
  tutorial.stop();
  app.campaign = "standard";
  app.playerLoadout = loadout;
  applyPlayerFaction(color, loadout);
  storeLoadout(loadout);
  syncLoadoutControls(loadout);
  resetMatch(true);
  beginSimulationLoop();
}

function launchTutorialCampaign() {
  setupFlow?.destroy();
  setupFlow = null;
  document.getElementById("battleView")?.removeAttribute("inert");
  tutorial.stop();
  app.campaign = "tutorial";
  app.playerLoadout = cloneLoadout(TUTORIAL_LOADOUT);
  applyPlayerFaction(getFaction(), app.playerLoadout);
  syncLoadoutControls(app.playerLoadout);
  resetMatch(true);
  app.selectedZoneId = 2;
  beginSimulationLoop();
  tutorial.start({
    isMobile: () => app.mobileMode,
    getSelectedShipKey: () => app.selectedShipKey,
    onStageChange: (id) => {
      if (!app?.sim) return;
      if (id === "attack") app.sim.setCombatEnabled("A", true);
      if (id === "free") {
        app.sim.setCombatEnabled("A", true);
        app.sim.setCombatEnabled("B", true);
        app.sim.setAiEnabled("B", true);
      }
      updateUi();
    },
  });
  updateUi();
}

function showCharacterSelectScreen({ fromSetup = false } = {}) {
  document.getElementById("battleView")?.setAttribute("inert", "");
  charSelect = createCharacterSelect((loadout, color) => {
    charSelect = null;
    launchWithLoadout(loadout, color);
  }, {
    backLabel: fromSetup ? "返回难度选择" : "返回战场",
    onBack: () => {
      charSelect = null;
      if (fromSetup) setupFlow?.showDifficulty();
      else document.getElementById("battleView")?.removeAttribute("inert");
    },
  });
  charSelect.show();
}

// ── 可挂载入口 ──
// 对局进行中(未结算)才算「战斗中」——结算/未开局时返回主菜单不拦
function isBattleInProgress() {
  return Boolean(running && app && app.state && app.state.phase === "running");
}

// 战斗中误触「返回主菜单」保护:进行中先弹二次确认,确认后才 SPA 跳转。
// 链接在冒泡阶段先于 router 的 document 级监听触发,preventDefault 即可拦住路由跳转。
function bindBattleExitGuard() {
  const links = document.querySelectorAll(".btn-link-home, .mobile-menu-btn");
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

export function mount(root) {
  root.innerHTML = soloTemplate();
  cacheDom();
  initApp();
  camera = createBattleCamera({
    canvas,
    isMobile: () => app.mobileMode,
    getTrackedShip: () => app.renderState?.teams?.A?.ships?.[app.selectedShipKey] || selectedShipState(),
    onZoomChanged: () => updateUi(),
  });
  ac = new AbortController();
  running = false;
  rafId = 0;
  syncResponsiveMode();
  populateLoadoutControls();
  bindUiEvents();
  setupFlow = createSoloSetupFlow({
    onStandard: () => showCharacterSelectScreen({ fromSetup: true }),
    onTutorial: launchTutorialCampaign,
    onHome: () => window.__navigate?.("/"),
  });
  if (window.location.pathname.endsWith("/play/tutorial")) {
    setupFlow.conceal(launchTutorialCampaign);
  }
  return unmount;
}

function unmount() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  tutorial.stop(); // 静默拆掉独立教程覆盖层
  setupFlow?.destroy();
  setupFlow = null;
  if (ac) ac.abort();
  ac = null;
  // 选角覆盖层挂在 body 上：用 hide() 清掉它的 keydown 监听与背景 rAF，并移除节点
  if (charSelect && typeof charSelect.hide === "function") {
    charSelect.hide();
  }
  charSelect = null;
  actionTransport = null;
  app = null;
}

function soloTemplate() {
  // 战斗视图 DOM 完全来自共享模板(src/battle/template.js);单人只注入「换阵容」与结算按钮
  return battleViewTemplate({
    panelActionsHTML: `<button id="applyLoadoutBtn" type="button">${t("换阵容")}</button>`,
    overlayActionsHTML: `
              <button id="restartBtn">${t("再来一局")}</button>
              <a class="btn-link overlay-home-link" href="/">${t("返回主菜单")}</a>`,
  });
}
