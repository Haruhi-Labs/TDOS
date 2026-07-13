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
  clamp,
  cloneLoadout,
  distance,
  normalizeLoadout,
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
  getDifficulty,
  getTutorialSeen,
  setTutorialSeen,
} from "./profile.js";

import { tutorial } from "./tutorial.js";
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
import { routeHandleAtPoint, shipAtPoint, zoneFromPoint } from "./battle/input.js";
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
// 逻辑世界尺寸：所有游戏/坐标运算都在这个固定的 1440 空间里(与画布物理像素解耦)。
// 画布 backing store 改为按设备像素铺满显示区域,渲染时整体放大 LOGICAL→设备像素,
// 从而在 Retina/大屏上像素级清晰、无放大模糊。
const LOGICAL = DEFAULT_WORLD_SIZE; // 与在线/服务器共用同一权威尺寸,防止两种模式地图割裂

function initApp() {
  app = {
  sim: null,
  state: null,
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
  lastTime: performance.now(),
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

function fleetSlotLabel(slotKey) {
  return localizedSlotLabel(slotKey, "short");
}

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
      cell.name.textContent = fleetSlotLabel(cell.key);
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
    cell.name.textContent = `${fleetSlotLabel(cell.key)} ${shipCharacterName(ship)}`;
    let state = "";
    if (dead) {
      state = `✖ ${t("阵亡")}`;
    } else if (ship.braking) {
      state = t("急刹中");
    } else if (cell.key !== "main" && ship.attached === false) {
      state = t("分离中");
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
  const ok = app.sim.applyActionForSeat("A", action);
  if (ok) {
    tutorial.onAction(action); // 新手教程:实操步骤据玩家动作推进
  }
  return ok;
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
  });
}

function resetMatch(logMessage = true) {
  app.enemyLoadout = randomAiLoadout(); // 每局随机 AI 阵容(主舰不含长门/鹤屋),结算画面据此展示敌方
  app.sim = createSimulation();
  app.state = app.sim.serializeState();
  app.selectedShipKey = "main";
  app.selectedZoneId = 5;
  app.drag = null;
  app.suppressMapClick = false;
  app.pendingSubSkillAim = null;
  resetShipDestructionEffects(app.destructionEffects);
  app.gameOverLogged = false;
  app.paused = false;
  app.lastTime = performance.now();
  const mainShip = app.sim.teamA.ships.main;
  camera.reset({ x: mainShip.x, y: mainShip.y });
  updateShipSwitchLabels(app.playerLoadout);
  if (logMessage) {
    clearLog();
    log(app.mobileMode ? t("战斗开始。点战场直接移动，点右上小地图选战区。") : t("战斗开始。右键单击设目标点；左键拖控制点调曲率、拖端点调路径；左键单击空白处选战区。"));
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
  if ((app.mobileMode || camera.zoom > CAMERA_ZOOM_MIN + 1e-3) && shipSim) {
    camera.centerCameraOn(shipSim.x, shipSim.y, false);
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
  const ok = applyAction({
    type: "configure_auto_scout",
    enabled,
    zoneId: app.selectedZoneId,
  });
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
  const ok = applyAction({
    type: "emergency_brake",
    shipKey: ship.key,
  });
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
    log(t("{ship} 已设置新航线", { ship: shipDisplayName(ship) }));
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
  // 侦察机现从选中舰发出：按选中舰的可用能量判定是否可派
  const scoutEnergy = selected && selected.alive ? (Number(selected.fleetEnergy) || 0) : mainEnergy;

  const scoutLocked = own.skillsDisabled;
  ui.scoutBtn.disabled = scoutLocked || (cooldowns.scout || 0) > 0 || scoutEnergy < SCOUT_LAUNCH_COST;
  ui.scoutBtn.textContent = scoutLocked
    ? t("派出侦查机（已被封印）")
    : (cooldowns.scout || 0) > 0
      ? t("派出侦查机（冷却{seconds}秒）", { seconds: (cooldowns.scout || 0).toFixed(1) })
      : t("派出侦查机");

  const autoScoutEnabled = Boolean(own.autoScout?.enabled);
  const autoScoutZoneId = Number(own.autoScout?.zoneId) || app.selectedZoneId;
  const autoScoutDisabled = own.skillsDisabled && !autoScoutEnabled;
  let autoScoutSuffix = autoScoutEnabled ? t("开·战区{zone}", { zone: autoScoutZoneId }) : t("关");
  if (autoScoutEnabled) {
    if ((cooldowns.scout || 0) > 0) {
      autoScoutSuffix += `·${t("冷却{seconds}秒", { seconds: (cooldowns.scout || 0).toFixed(1) })}`;
    } else if (mainEnergy < SCOUT_LAUNCH_COST) {
      autoScoutSuffix += `·${t("等待能量")}`;
    }
  } else if (own.skillsDisabled) {
    autoScoutSuffix = t("关·已封印");
  }
  ui.autoScoutBtn.disabled = autoScoutDisabled;
  ui.autoScoutBtn.textContent = t("自动侦查：{state}", { state: autoScoutSuffix });
  ui.autoScoutBtn.classList.toggle("toggle-active", autoScoutEnabled);

  const flagMeta = currentFlagshipMeta(own);
  if (!flagMeta) {
    ui.flagshipBtn.disabled = true;
    ui.flagshipBtn.textContent = t("旗舰技能");
  } else if (flagMeta.type === "passive") {
    ui.flagshipBtn.disabled = true;
    ui.flagshipBtn.textContent = t("旗舰技能：{name}{suffix}", { name: flagMeta.name, suffix: t("（被动）") });
  } else {
    const disabled =
      own.skillsDisabled ||
      (cooldowns.flagship || 0) > 0 ||
      mainEnergy < (flagMeta.cost || 0) ||
      !(mainShip && mainShip.alive);
    ui.flagshipBtn.disabled = disabled;
    ui.flagshipBtn.textContent =
      (cooldowns.flagship || 0) > 0
        ? t("旗舰技能：{name}{suffix}", { name: flagMeta.name, suffix: t("（冷却{seconds}秒）", { seconds: (cooldowns.flagship || 0).toFixed(1) }) })
        : t("旗舰技能：{name}", { name: flagMeta.name });
  }

  const brakeCooldown = Number(selected?.brakeCooldown) || 0;
  const brakeEnergy = Number(selected?.fleetEnergy) || 0;
  const brakeDisabled = !selected || !selected.alive || !selected.canControl || selected.attached || brakeCooldown > 0 || brakeEnergy < EMERGENCY_BRAKE_COST;
  let brakeSuffix = "";
  if (!selected || !selected.alive || !selected.canControl) {
    brakeSuffix = t("（切换到可控舰）");
  } else if (selected.attached) {
    brakeSuffix = t("（分离后可用）");
  } else if (brakeCooldown > 0) {
    brakeSuffix = t("（冷却{seconds}秒）", { seconds: brakeCooldown.toFixed(1) });
  } else if (brakeEnergy < EMERGENCY_BRAKE_COST) {
    brakeSuffix = t("（需{energy}能量）", { energy: EMERGENCY_BRAKE_COST });
  } else if (selected.braking) {
    brakeSuffix = t("（制动中）");
  }
  ui.brakeBtn.disabled = brakeDisabled;
  ui.brakeBtn.textContent = t("急刹{suffix}", { suffix: brakeSuffix });

  const subMeta = currentSubMeta(selected);
  if (!selected || !subMeta) {
    ui.subSkillBtn.disabled = true;
    ui.subSkillBtn.textContent = t("分舰技能：切换到副舰后使用");
    return;
  }

  const skillEnergy = Number(selected.fleetEnergy) || 0;
  const cooldown = Number(cooldowns[selected.key] || 0);
  const detached = !selected.attached && selected.canControl;
  const disabled = own.skillsDisabled || !detached || cooldown > 0 || skillEnergy < (subMeta.cost || 0);

  let suffix = "";
  if (own.skillsDisabled) {
    suffix = t("（已被封印）");
  } else if (!detached) {
    suffix = t("（分离后可用）");
  } else if (cooldown > 0) {
    suffix = t("（冷却{seconds}秒）", { seconds: cooldown.toFixed(1) });
  } else if (app.pendingSubSkillAim && app.pendingSubSkillAim.shipKey === selected.key) {
    suffix = subMeta.target === "optional_point" ? t("（地图点击闪现，再点按钮原地释放）") : t("（地图点击瞄准）");
  }
  ui.subSkillBtn.disabled = disabled;
  ui.subSkillBtn.textContent = t("分舰技能：{name}{suffix}", { name: subMeta.name, suffix });
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
  const shipName = selected ? shipCharacterName(selected) : t("无");
  const throttleValue = Math.round(clamp((selected?.throttle || 1) * 100, 25, 140));
  const hullPercent = Math.round((own.hullRatio || 0) * 100);
  ui.mobileBattleSummary.textContent = `${shipName} · ${t("区")}${app.selectedZoneId} · ${t("体")}${hullPercent}%`;
  ui.mobileBattleHint.textContent = app.pendingSubSkillAim
    ? t("技能瞄准中：点战场确认，点右上小地图先挪镜头")
    : t("点舰船切换 · 点战场下航线 · 点右上小地图选战区");

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
  ui.mobileAutoScoutBtn.textContent = autoScoutEnabled ? t("自侦开") : t("自侦关");
  ui.mobileAutoScoutBtn.classList.toggle("toggle-active", autoScoutEnabled);
  ui.mobileBrakeBtn.textContent = t("急刹");
  ui.mobileFlagshipBtn.textContent = t("旗舰技");
  ui.mobileSubSkillBtn.textContent = selected && currentSubMeta(selected) ? currentSubMeta(selected).name : t("分舰技");

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
    ui.selectedValue.textContent = `${shipCharacterName(selectedState)} | ${t("推进")} ${(selectedState.throttle || 1).toFixed(2)} | ${t("能量")} ${Math.round(
      Number(selectedState.fleetEnergy) || 0,
    )}/${Math.round(Number(selectedState.fleetMaxEnergy) || 1)} | ${t("最小半径")}${minRadius}${selectedState.braking ? ` | ${t("急刹中")}` : ""}`;
  } else {
    ui.selectedValue.textContent = t("无");
  }

  ui.splitOneBtn.disabled = own.splitLevel >= 1;
  ui.splitTwoBtn.disabled = own.splitLevel < 1 || own.splitLevel >= 2;
  updateSkillButtons(own);
  renderFleetRoster(own);
  syncMobileHud(own);

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
  diffEl.innerHTML =
    `<span class="result-diff-label">${t("难度")}</span>` +
    `<span class="result-diff-val rd-${dm.cls}">${t(dm.label)}</span>`;

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

// 新手教程画布示意图。'fireArc' 复用已有 drawSelectedFireArc(每帧已为选中舰画扇形),无需重画;
// 'visionRange' 在旗舰上额外画出真实「射程圈」(金)与加亮「视野圈」(青)+ 标注,直观呈现 视野 ≪ 射程。
function drawTutorialIllustration(kind) {
  if (kind !== "visionRange") {
    return;
  }
  const own = ownTeamState();
  if (!own || !own.ships) {
    return;
  }
  const ship = own.ships.main;
  if (!ship || !ship.alive) {
    return;
  }
  ctx.save();
  if (ship.range) {
    ctx.strokeStyle = "#f0d488d6";
    ctx.lineWidth = 2;
    ctx.setLineDash([9, 7]);
    ctx.beginPath();
    ctx.arc(ship.x, ship.y, ship.range, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (ship.vision) {
    ctx.strokeStyle = "#8adfffe6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ship.x, ship.y, ship.vision, 0, TAU);
    ctx.stroke();
  }
  ctx.font = "bold 13px 'Noto Sans SC', 'PingFang SC', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  if (ship.vision) {
    ctx.fillStyle = "#bde6ff";
    ctx.fillText(t("视野"), ship.x, ship.y - ship.vision - 4);
  }
  if (ship.range) {
    ctx.fillStyle = "#ffe7a1";
    ctx.fillText(t("射程"), ship.x, ship.y - ship.range - 4);
  }
  ctx.restore();
}

function render() {
  if (!app.state) {
    return;
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
  const own = ownTeamState();
  const frame = {
    state: app.state,
    ownTeam: own,
    enemyTeam: enemyTeamState(),
    spectating: false,
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
  if (tutorial.isActive()) {
    drawTutorialIllustration(tutorial.getIllustration());
  }
  ctx.restore();

  // 屏幕空间:角色立绘、移动端小地图、暂停遮罩
  const activeShip = selectedShipState();
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
    log(t("旗舰技能 {name} 已发动", { name: meta.name }));
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
  const ok = applyAction({
    type: "cast_sub_skill",
    shipKey: selected.key,
    zoneId: app.selectedZoneId,
  });
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

  ui.powerSlider.addEventListener("input", () => {
    setThrottleValue(ui.powerSlider.value);
  });
  ui.zoomOutBtn.addEventListener("click", () => {
    camera.adjustCameraZoom(-1);
  });
  ui.zoomInBtn.addEventListener("click", () => {
    camera.adjustCameraZoom(1);
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
    const ok = applyAction({ type: "launch_scout", zoneId: app.selectedZoneId, shipKey: app.selectedShipKey });
    if (ok) {
      log(t("侦查机已派往战区{zone}", { zone: app.selectedZoneId }));
    }
  });
  bindPressButton(ui.mobileScoutBtn, () => {
    const ok = applyAction({ type: "launch_scout", zoneId: app.selectedZoneId, shipKey: app.selectedShipKey });
    if (ok) {
      log(t("侦查机已派往战区{zone}", { zone: app.selectedZoneId }));
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

  bindBattleExitGuard();

  ui.restartBtn.addEventListener("click", () => {
    showCharacterSelectScreen();
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
    app.suppressMapClick = true; // 拖拽手柄结束后,抑制这次 click 的战区切换
  });

  canvas.addEventListener("wheel", (event) => {
    if (app.mobileMode || !app.state || app.state.phase === "finished") {
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
        log(t("{name} 已发动", { name: meta ? meta.name : t("分舰技能") }));
      }
      updateUi();
      return;
    }

    if (app.mobileMode) {
      if (handleMinimapTap(screenPos)) {
        return;
      }
      const tappedShip = shipAtPoint(ownTeamState(), pos.x, pos.y);
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
        log(t("{ship} 向战区{zone}中心进发", { ship: shipCharacterName(ship), zone: app.selectedZoneId }));
      }
      return;
    }

    // X — launch scout
    if (event.code === "KeyX") {
      event.preventDefault();
      const ok = applyAction({ type: "launch_scout", zoneId: app.selectedZoneId, shipKey: app.selectedShipKey });
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
  camera.resizeCanvas(); // 战斗画布此刻可见且已布局,按设备像素定 backing,首帧即清晰
  if (!running) {
    running = true;
    app.tickRunning = true;
    app.lastTime = performance.now();
    rafId = requestAnimationFrame(tick);
  }
  // 首次进战场:等选角翻书动画收尾、战场显出后再弹出新手教程
  if (!getTutorialSeen()) {
    setTimeout(() => {
      if (app && app.sim && !getTutorialSeen()) {
        tutorial.start({
          isMobile: () => app.mobileMode,
          // 旗舰技是否被动:被动时「放技能」步改引导用分舰技,避免高亮到禁用的旗舰技按钮
          flagshipPassive: () => {
            const meta = currentFlagshipMeta(ownTeamState());
            return !!meta && meta.type === "passive";
          },
          // 阿虚旗舰:火力各方向均匀(无侧舷加成/船尾也开火),火力讲解需换说法
          uniformFire: () => !!(app.playerLoadout && app.playerLoadout.main === "kyon"),
          onFinish: () => setTutorialSeen(true),
        });
      }
    }, 450);
  }
}

function showCharacterSelectScreen() {
  charSelect = createCharacterSelect((loadout, color) => {
    launchWithLoadout(loadout, color);
  }, { showDifficulty: true });
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
    getTrackedShip: () => selectedShipState(),
    onZoomChanged: () => updateUi(),
  });
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
  tutorial.stop(); // 静默拆掉教程 overlay(没走完不写已看过标记)
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
    <div class="app-shell battle-shell">
      <aside class="panel compact-panel battle-panel">
        <h1>${t("射手座之日")}</h1>

        <div class="panel-actions">
          <a class="btn-link btn-link-home" href="/">${t("← 主菜单")}</a>
          <button id="applyLoadoutBtn" type="button">${t("换阵容")}</button>
        </div>

        <section class="status">
          <div><span>${t("舰体")}</span><strong id="hullValue">100%</strong></div>
          <div><span>${t("能量")}</span><strong id="energyValue">100%</strong></div>
          <div><span>${t("分离")}</span><strong id="splitValue">${t("编队")}</strong></div>
          <div><span>${t("战区")}</span><strong id="zoneValueLocal">${t("战区{zone}", { zone: 5 })}</strong></div>
        </section>

        <section class="controls slim-controls">
          <h2>${t("舰队控制")}</h2>
          <div id="shipQuickSwitch" class="ship-switch">
            <button type="button" class="ship-switch-btn" data-ship="main">${t("主舰")}</button>
            <button type="button" class="ship-switch-btn" data-ship="sub1">${t("副舰1")}</button>
            <button type="button" class="ship-switch-btn" data-ship="sub2">${t("副舰2")}</button>
          </div>
          <div class="btn-row">
            <button id="splitOneBtn">${t("一级分离")}</button>
            <button id="splitTwoBtn">${t("二级分离")}</button>
          </div>
          <div class="slider-wrap">
            <div class="slider-head"><label for="powerSlider">${t("推进功率")}</label><strong id="powerValue">100%</strong></div>
            <input id="powerSlider" type="range" min="25" max="140" step="1" value="100" />
          </div>
          <div class="zoom-control-row">
            <button id="zoomOutBtn" type="button">${t("缩小")}</button>
            <strong id="zoomValue">100%</strong>
            <button id="zoomInBtn" type="button">${t("放大")}</button>
          </div>
        </section>

        <section class="controls slim-controls">
          <h2>${t("技能")}</h2>
          <div class="btn-grid">
            <button id="flagshipBtn">${t("旗舰技能")}</button>
            <button id="subSkillBtn">${t("分舰技能")}</button>
            <button id="scoutBtn">${t("派出侦查机")}</button>
            <button id="autoScoutBtn" type="button">${t("自动侦查：{state}", { state: t("关") })}</button>
            <button id="brakeBtn" type="button" class="span-2">${t("急刹")}</button>
          </div>
        </section>

        <section class="controls slim-controls fleet-section">
          <h2>${t("全队舰况")}</h2>
          <div id="fleetRoster" class="fleet-roster">
            <button type="button" class="fleet-row" data-ship="main">
              <div class="fleet-row-head"><span class="fleet-name">${t("主舰")}</span><span class="fleet-state"></span></div>
              <div class="fleet-gauges">
                <div class="fleet-gauge"><span class="fleet-glabel">${t("舰体")}</span><span class="fleet-bar"><i class="fleet-fill fleet-fill-hull"></i></span><span class="fleet-pct fleet-pct-hull">100%</span></div>
                <div class="fleet-gauge"><span class="fleet-glabel">${t("能量")}</span><span class="fleet-bar"><i class="fleet-fill fleet-fill-energy"></i></span><span class="fleet-pct fleet-pct-energy">100%</span></div>
              </div>
            </button>
            <button type="button" class="fleet-row" data-ship="sub1">
              <div class="fleet-row-head"><span class="fleet-name">${t("副一")}</span><span class="fleet-state"></span></div>
              <div class="fleet-gauges">
                <div class="fleet-gauge"><span class="fleet-glabel">${t("舰体")}</span><span class="fleet-bar"><i class="fleet-fill fleet-fill-hull"></i></span><span class="fleet-pct fleet-pct-hull">100%</span></div>
                <div class="fleet-gauge"><span class="fleet-glabel">${t("能量")}</span><span class="fleet-bar"><i class="fleet-fill fleet-fill-energy"></i></span><span class="fleet-pct fleet-pct-energy">100%</span></div>
              </div>
            </button>
            <button type="button" class="fleet-row" data-ship="sub2">
              <div class="fleet-row-head"><span class="fleet-name">${t("副二")}</span><span class="fleet-state"></span></div>
              <div class="fleet-gauges">
                <div class="fleet-gauge"><span class="fleet-glabel">${t("舰体")}</span><span class="fleet-bar"><i class="fleet-fill fleet-fill-hull"></i></span><span class="fleet-pct fleet-pct-hull">100%</span></div>
                <div class="fleet-gauge"><span class="fleet-glabel">${t("能量")}</span><span class="fleet-bar"><i class="fleet-fill fleet-fill-energy"></i></span><span class="fleet-pct fleet-pct-energy">100%</span></div>
              </div>
            </button>
          </div>
        </section>
      </aside>

      <main class="game-wrap">
        <canvas id="gameCanvas" width="${LOGICAL}" height="${LOGICAL}"></canvas>
        <section id="mobileBattleHud" class="mobile-battle-hud" aria-live="polite">
          <div class="mobile-battle-head">
            <a class="mobile-menu-btn" href="/">${t("← 菜单")}</a>
            <div id="mobileBattleSummary" class="mobile-battle-summary">${t("主舰")} · ${t("区")}5 · ${t("推进")}100%</div>
            <button id="mobileCenterBtn" type="button" class="mobile-chip-btn">${t("跟随")}</button>
          </div>
          <div id="mobileShipSwitch" class="mobile-ship-switch">
            <button type="button" class="mobile-ship-btn" data-ship="main">${t("主舰")}</button>
            <button type="button" class="mobile-ship-btn" data-ship="sub1">${t("副一")}</button>
            <button type="button" class="mobile-ship-btn" data-ship="sub2">${t("副二")}</button>
          </div>
          <div class="mobile-action-grid">
            <button id="mobileSplitOneBtn" type="button">${t("分离1")}</button>
            <button id="mobileSplitTwoBtn" type="button">${t("分离2")}</button>
            <button id="mobileBrakeBtn" type="button">${t("急刹")}</button>
            <button id="mobileFlagshipBtn" type="button">${t("旗舰技")}</button>
            <button id="mobileSubSkillBtn" type="button">${t("分舰技")}</button>
            <button id="mobileScoutBtn" type="button">${t("侦察")}</button>
            <button id="mobileAutoScoutBtn" type="button">${t("自动侦察")}</button>
            <button id="mobileZoomOutBtn" type="button" class="mobile-zoom-btn">${t("缩小")}</button>
            <button id="mobileZoomInBtn" type="button" class="mobile-zoom-btn">${t("放大")}</button>
          </div>
          <div class="mobile-throttle-wrap">
            <span class="mobile-throttle-label">${t("推进")}</span>
            <button type="button" class="mobile-throttle-btn" data-throttle="40">40</button>
            <button type="button" class="mobile-throttle-btn" data-throttle="70">70</button>
            <button type="button" class="mobile-throttle-btn" data-throttle="100">100</button>
            <button type="button" class="mobile-throttle-btn" data-throttle="120">120</button>
            <button type="button" class="mobile-throttle-btn" data-throttle="140">140</button>
          </div>
          <div id="mobileBattleHint" class="mobile-battle-hint">${t("点舰船切换 · 点战场下航线 · 点右上小地图选战区")}</div>
        </section>
        <div id="overlay" class="overlay hidden" role="dialog" aria-modal="true">
          <div id="resultCard" class="result-card">
            <div class="result-glow" aria-hidden="true"></div>
            <div class="result-head">
              <span id="resultEyebrow" class="result-eyebrow"></span>
              <h2 id="overlayTitle" class="result-title"></h2>
              <p id="resultSub" class="result-sub"></p>
              <div id="resultDiff" class="result-diff"></div>
            </div>
            <div id="resultVersus" class="result-versus"></div>
            <div class="overlay-actions">
              <button id="restartBtn">${t("再来一局")}</button>
              <a class="btn-link overlay-home-link" href="/">${t("返回主菜单")}</a>
            </div>
          </div>
        </div>
      </main>
    </div>
  `;
}
