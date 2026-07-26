// 可复用玩法模式实验平台入口。
// 不含任何 modeId 专属分支：模式差异全部经 registry + runtime + schema 完成。

import {
  DEFAULT_WORLD_SIZE,
  DEFAULT_TEAM_LOADOUT,
  DEFAULT_AI_LOADOUT,
  TICK_DT,
  cloneLoadout,
  normalizeLoadout,
  randomAiLoadout,
} from "../../shared/game-core.js";
import {
  DEFAULT_GAMEPLAY_RULES,
  GAMEPLAY_RULE_SCHEMA,
  normalizeGameplayRules,
} from "../../shared/gameplay/rules.js";
import { normalizeModeParameters } from "../../shared/modes/mode-definition.js";

import {
  createBattleCamera,
  prefersMobileBattleMode,
} from "../battle/camera.js";
import { routeHandleAtPoint, shipAtPoint, zoneFromPoint } from "../battle/input.js";
import {
  currentSubMeta,
  renderFleetRoster,
  syncMobileHud,
  updateSkillButtons,
} from "../battle/hud.js";
import { drawBattleWorld, drawMinimap, drawPauseOverlay } from "../battle/render.js";
import {
  createShipDestructionEffects,
  resetShipDestructionEffects,
} from "../ship-destruction-effects.js";
import { bindBattleBgmMuteButton, startBattleBgm, stopBattleBgm } from "../battle-bgm.js";
import { t } from "../i18n.js";

import { registerBuiltInPrototypeModes } from "./modes/index.js";
import { listPrototypeModes, getPrototypeMode } from "./registry.js";
import { createPrototypeRuntime } from "./runtime.js";
import { renderParameterPanel, readParameterPanel } from "./parameter-panel.js";
import { renderDiagnostics } from "./diagnostics.js";
import { prototypeShellHTML } from "./template.js";

const LOGICAL = DEFAULT_WORLD_SIZE;
const LOADOUT_A_KEY = "tdos-prototype-loadout-a-v1";
const LOADOUT_B_KEY = "tdos-prototype-loadout-b-v1";
const MODE_KEY = "tdos-prototype-mode-v1";
const SPEED_PRESETS = [0.25, 0.5, 1, 2, 4];

let canvas;
let ctx;
let ui;
let camera;
let ac;
let rafId = 0;
let running = false;
let app = null;

function readStored(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (_error) {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_error) {
    // ignore
  }
}

function initApp() {
  registerBuiltInPrototypeModes();
  const modes = listPrototypeModes();
  const storedModeId = readStored(MODE_KEY, modes[0]?.id);
  const mode = getPrototypeMode(storedModeId) || modes[0];
  app = {
    modes,
    modeId: mode?.id || null,
    modeDefinition: mode,
    runtime: null,
    loadoutA: normalizeLoadout(readStored(LOADOUT_A_KEY, mode?.runtimePreset?.defaultLoadoutA || DEFAULT_TEAM_LOADOUT), DEFAULT_TEAM_LOADOUT),
    loadoutB: normalizeLoadout(readStored(LOADOUT_B_KEY, mode?.runtimePreset?.defaultLoadoutB || DEFAULT_AI_LOADOUT), DEFAULT_AI_LOADOUT),
    modeParameters: normalizeModeParameters(mode?.parameterSchema || [], mode?.defaultParameters || {}),
    gameplayRules: { ...DEFAULT_GAMEPLAY_RULES },
    selectedShipKey: "main",
    selectedZoneId: 5,
    pendingSubSkillAim: null,
    drag: null,
    suppressMapClick: false,
    pointer: { x: LOGICAL * 0.5, y: LOGICAL * 0.5 },
    mobileMode: false,
    lastFrameTime: performance.now(),
    destructionEffects: createShipDestructionEffects(),
    resultShown: false,
    presentation: null,
  };
}

function cacheDom(root) {
  canvas = root.querySelector("#gameCanvas");
  ctx = canvas.getContext("2d");
  ui = {
    root,
    modeSelect: root.querySelector("#protoModeSelect"),
    modeMeta: root.querySelector("#protoModeMeta"),
    applyModeBtn: root.querySelector("#protoApplyModeBtn"),
    pauseBtn: root.querySelector("#protoPauseBtn"),
    stepBtn: root.querySelector("#protoStepBtn"),
    restartBtn: root.querySelector("#protoRestartBtn"),
    speedButtons: Array.from(root.querySelectorAll("#protoSpeedRow [data-speed]")),
    swapLoadoutBtn: root.querySelector("#protoSwapLoadoutBtn"),
    randomBBtn: root.querySelector("#protoRandomBBtn"),
    applyLoadoutBtn: root.querySelector("#protoApplyLoadoutBtn"),
    modeParams: root.querySelector("#protoModeParams"),
    applyModeParamsBtn: root.querySelector("#protoApplyModeParamsBtn"),
    gameplayParams: root.querySelector("#protoGameplayParams"),
    applyGameplayBtn: root.querySelector("#protoApplyGameplayBtn"),
    modeTools: root.querySelector("#protoModeTools"),
    modeHud: root.querySelector("#protoModeHud"),
    diagnostics: root.querySelector("#protoDiagnostics"),
    paramHint: root.querySelector("#protoParamHint"),
    resultRestartBtn: root.querySelector("#protoResultRestartBtn"),
    overlay: root.querySelector("#overlay"),
    overlayTitle: root.querySelector("#overlayTitle"),
    resultEyebrow: root.querySelector("#resultEyebrow"),
    resultSub: root.querySelector("#resultSub"),
    hullValue: root.querySelector("#hullValue"),
    energyValue: root.querySelector("#energyValue"),
    splitValue: root.querySelector("#splitValue"),
    zoneValue: root.querySelector("#zoneValue"),
    selectedValue: root.querySelector("#selectedValue") || root.querySelector("#onlineSelectedValue"),
    powerSlider: root.querySelector("#powerSlider"),
    powerValue: root.querySelector("#powerValue"),
    zoomOutBtn: root.querySelector("#zoomOutBtn"),
    zoomInBtn: root.querySelector("#zoomInBtn"),
    zoomValue: root.querySelector("#zoomValue"),
    splitOneBtn: root.querySelector("#splitOneBtn"),
    splitTwoBtn: root.querySelector("#splitTwoBtn"),
    scoutBtn: root.querySelector("#scoutBtn"),
    autoScoutBtn: root.querySelector("#autoScoutBtn"),
    brakeBtn: root.querySelector("#brakeBtn"),
    flagshipBtn: root.querySelector("#flagshipBtn"),
    subSkillBtn: root.querySelector("#subSkillBtn"),
    shipSwitchButtons: Array.from(root.querySelectorAll("#shipQuickSwitch .ship-switch-btn")),
    fleetRows: Array.from(root.querySelectorAll("#fleetRoster .fleet-row")),
    mobileBattleHud: root.querySelector("#mobileBattleHud"),
    mobileBattleSummary: root.querySelector("#mobileBattleSummary"),
    mobileCenterBtn: root.querySelector("#mobileCenterBtn"),
    mobileZoomOutBtn: root.querySelector("#mobileZoomOutBtn"),
    mobileZoomInBtn: root.querySelector("#mobileZoomInBtn"),
    mobileShipButtons: Array.from(root.querySelectorAll("#mobileShipSwitch .mobile-ship-btn")),
    mobileSplitOneBtn: root.querySelector("#mobileSplitOneBtn"),
    mobileSplitTwoBtn: root.querySelector("#mobileSplitTwoBtn"),
    mobileBrakeBtn: root.querySelector("#mobileBrakeBtn"),
    mobileFlagshipBtn: root.querySelector("#mobileFlagshipBtn"),
    mobileSubSkillBtn: root.querySelector("#mobileSubSkillBtn"),
    mobileScoutBtn: root.querySelector("#mobileScoutBtn"),
    mobileAutoScoutBtn: root.querySelector("#mobileAutoScoutBtn"),
    mobileThrottleButtons: Array.from(root.querySelectorAll(".mobile-throttle-btn")),
  };
}

function currentSnapshot() {
  return app?.runtime?.getSnapshot?.() || null;
}

function ownTeam() {
  const snap = currentSnapshot();
  return snap?.fleets?.A || snap?.teams?.A || null;
}

function enemyTeam() {
  const snap = currentSnapshot();
  return snap?.fleets?.B || snap?.teams?.B || null;
}

function selectedShip() {
  const own = ownTeam();
  return own?.ships?.[app.selectedShipKey] || null;
}

function applyAction(action) {
  if (!app?.runtime) return false;
  return app.runtime.applyAction(action, "A");
}

function readLoadoutFromDom(side) {
  const box = ui.root.querySelector(`.proto-loadout[data-side="${side}"]`);
  if (!box) return side === "A" ? app.loadoutA : app.loadoutB;
  const get = (slot) => box.querySelector(`select[data-slot="${slot}"]`)?.value;
  return normalizeLoadout({ main: get("main"), sub1: get("sub1"), sub2: get("sub2") }, DEFAULT_TEAM_LOADOUT);
}

function writeLoadoutToDom(side, loadout) {
  const box = ui.root.querySelector(`.proto-loadout[data-side="${side}"]`);
  if (!box) return;
  for (const slot of ["main", "sub1", "sub2"]) {
    const select = box.querySelector(`select[data-slot="${slot}"]`);
    if (select) select.value = loadout[slot];
  }
}

function syncModeMeta() {
  const mode = app.modeDefinition;
  if (!ui.modeMeta || !mode) return;
  ui.modeMeta.textContent = `${mode.description || ""} · ${mode.status} · v${mode.version}`;
  if (ui.modeSelect) ui.modeSelect.value = mode.id;
}

function rebuildParameterPanels() {
  const mode = app.modeDefinition;
  renderParameterPanel(ui.modeParams, mode?.parameterSchema || [], app.modeParameters, (key, value) => {
    app.modeParameters = { ...app.modeParameters, [key]: value };
    if (ui.paramHint) ui.paramHint.textContent = "模式参数已修改，点击应用并重开";
  });
  renderParameterPanel(ui.gameplayParams, GAMEPLAY_RULE_SCHEMA, app.gameplayRules, (key, value) => {
    app.gameplayRules = { ...app.gameplayRules, [key]: value };
    if (ui.paramHint) ui.paramHint.textContent = "玩法倍率已修改，点击应用并重开";
  });
}

function destroyPresentation() {
  if (app?.presentation?.destroy) {
    try {
      app.presentation.destroy();
    } catch (_error) {
      // presentation 销毁失败不阻断平台
    }
  }
  if (app) app.presentation = null;
}

function createPresentationForCurrentMode() {
  destroyPresentation();
  const factory = app?.modeDefinition?.presentationFactory || app?.modeDefinition?.runtimePreset?.presentationFactory;
  if (typeof factory !== "function" || !canvas || !ui?.root) return null;
  try {
    app.presentation = factory({
      canvas,
      root: ui.root,
      quality: "medium",
      reducedMotion: typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
      modeDefinition: app.modeDefinition,
      runtime: app.runtime,
    }) || null;
  } catch (_error) {
    app.presentation = null;
  }
  return app.presentation;
}

function createRuntimeForCurrentMode() {
  const mode = app.modeDefinition;
  if (!mode) return null;
  destroyPresentation();
  if (app.runtime) {
    app.runtime.destroy();
    app.runtime = null;
  }
  const runtime = createPrototypeRuntime({
    modeDefinition: mode,
    runtimePreset: mode.runtimePreset || {},
    teamLoadouts: { A: app.loadoutA, B: app.loadoutB },
    gameplayRules: app.gameplayRules,
    modeParameters: app.modeParameters,
    aiDifficulty: mode.runtimePreset?.aiDifficulty || "normal",
    randomSeed: mode.runtimePreset?.randomSeed ?? null,
  });
  runtime.start();
  app.runtime = runtime;
  if (typeof window !== "undefined") {
    window.__TDOS_PROTOTYPE_RUNTIME__ = runtime;
  }
  app.resultShown = false;
  app.selectedShipKey = "main";
  app.selectedZoneId = 5;
  app.pendingSubSkillAim = null;
  app.drag = null;
  resetShipDestructionEffects(app.destructionEffects);
  createPresentationForCurrentMode();
  const snap = runtime.getSnapshot();
  const main = snap?.fleets?.A?.ships?.main || snap?.teams?.A?.ships?.main;
  if (main && camera) camera.reset({ x: main.x, y: main.y });
  hideResult();
  startBattleBgm();
  return runtime;
}

function setSelectedShip(shipKey) {
  const own = ownTeam();
  const ship = own?.ships?.[shipKey];
  if (!ship || !ship.alive || !ship.canControl) return false;
  app.selectedShipKey = shipKey;
  if (app.pendingSubSkillAim && app.pendingSubSkillAim.shipKey !== shipKey) {
    app.pendingSubSkillAim = null;
  }
  return true;
}

function setSelectedZoneId(zoneId) {
  app.selectedZoneId = zoneId;
  if (ui.zoneValue) ui.zoneValue.textContent = t("战区{zone}", { zone: zoneId });
}

function setRouteForSelectedShip(x, y) {
  return applyAction({
    type: "set_route",
    shipKey: app.selectedShipKey,
    endX: x,
    endY: y,
    throttle: Number(ui.powerSlider?.value || 100) / 100,
  });
}

function setThrottleValue(raw) {
  const pct = Math.max(25, Math.min(140, Number(raw) || 100));
  if (ui.powerSlider) ui.powerSlider.value = String(pct);
  if (ui.powerValue) ui.powerValue.textContent = `${pct}%`;
  applyAction({ type: "set_throttle", shipKey: app.selectedShipKey, throttle: pct / 100 });
}

function useFlagshipSkill() {
  applyAction({ type: "cast_flagship_skill", zoneId: app.selectedZoneId });
}

function useSubSkill() {
  const ship = selectedShip();
  const meta = currentSubMeta(ship);
  if (!ship || !meta) return;
  if (meta.target === "point" || meta.target === "optional_point") {
    if (app.pendingSubSkillAim && app.pendingSubSkillAim.shipKey === ship.key && meta.target === "optional_point") {
      applyAction({ type: "cast_sub_skill", shipKey: ship.key, zoneId: app.selectedZoneId });
      app.pendingSubSkillAim = null;
      return;
    }
    app.pendingSubSkillAim = { shipKey: ship.key };
    return;
  }
  applyAction({ type: "cast_sub_skill", shipKey: ship.key, zoneId: app.selectedZoneId });
}

function useEmergencyBrake() {
  applyAction({ type: "emergency_brake", shipKey: app.selectedShipKey });
}

function toggleAutoScout() {
  const own = ownTeam();
  const enabled = !(own?.autoScout?.enabled);
  applyAction({ type: "configure_auto_scout", enabled, zoneId: app.selectedZoneId });
}

function hideResult() {
  if (ui.overlay) ui.overlay.classList.add("hidden");
}

function showResult(result) {
  if (!ui.overlay || app.resultShown) return;
  app.resultShown = true;
  ui.overlay.classList.remove("hidden");
  const win = result?.winnerAllianceId === "A";
  const lose = result?.winnerAllianceId === "B";
  if (ui.resultEyebrow) ui.resultEyebrow.textContent = win ? "VICTORY" : lose ? "DEFEAT" : "RESULT";
  if (ui.overlayTitle) ui.overlayTitle.textContent = result?.label || t("战斗结束");
  if (ui.resultSub) ui.resultSub.textContent = `${app.modeDefinition?.name || ""} · ${result?.reason || ""}`;
}

function updateHud() {
  const snap = currentSnapshot();
  const own = ownTeam();
  const ship = selectedShip();
  if (ui.hullValue) ui.hullValue.textContent = ship ? `${Math.round((ship.hp / Math.max(ship.maxHp, 1)) * 100)}%` : "-";
  if (ui.energyValue) ui.energyValue.textContent = ship ? `${Math.round(ship.energy || 0)}` : "-";
  if (ui.splitValue) ui.splitValue.textContent = own?.splitLabel || own?.formation || "-";
  if (ui.zoneValue) ui.zoneValue.textContent = t("战区{zone}", { zone: app.selectedZoneId });
  if (ui.selectedValue) ui.selectedValue.textContent = ship?.characterId || app.selectedShipKey;
  if (ui.zoomValue && camera?.currentViewState) {
    const zoom = camera.currentViewState().zoom || 1;
    ui.zoomValue.textContent = `${Math.round(zoom * 100)}%`;
  }
  if (ui.pauseBtn) ui.pauseBtn.textContent = app.runtime?.isPaused?.() ? "继续" : "暂停";
  for (const button of ui.speedButtons) {
    button.classList.toggle("active", Number(button.dataset.speed) === (app.runtime?.getSpeedScale?.() || 1));
  }

  // battle/hud API 需要与 solo 相同的按钮字段：
  // syncMobileHud 会镜像 splitOneBtn/splitTwoBtn 的 disabled 到移动端按钮。
  // 缺字段会在 mobileMode 下抛 TypeError，打断 rAF，整局冻结。
  if (ui.splitOneBtn) ui.splitOneBtn.disabled = Boolean(own && own.splitLevel >= 1);
  if (ui.splitTwoBtn) ui.splitTwoBtn.disabled = Boolean(!own || own.splitLevel < 1 || own.splitLevel >= 2);
  const hudUi = {
    splitOneBtn: ui.splitOneBtn,
    splitTwoBtn: ui.splitTwoBtn,
    scoutBtn: ui.scoutBtn,
    autoScoutBtn: ui.autoScoutBtn,
    brakeBtn: ui.brakeBtn,
    flagshipBtn: ui.flagshipBtn,
    subSkillBtn: ui.subSkillBtn,
    mobileSplitOneBtn: ui.mobileSplitOneBtn,
    mobileSplitTwoBtn: ui.mobileSplitTwoBtn,
    mobileScoutBtn: ui.mobileScoutBtn,
    mobileAutoScoutBtn: ui.mobileAutoScoutBtn,
    mobileBrakeBtn: ui.mobileBrakeBtn,
    mobileFlagshipBtn: ui.mobileFlagshipBtn,
    mobileSubSkillBtn: ui.mobileSubSkillBtn,
    mobileBattleHud: ui.mobileBattleHud,
    mobileBattleSummary: ui.mobileBattleSummary,
    mobileBattleHint: ui.root?.querySelector?.("#mobileBattleHint"),
    mobileShipButtons: ui.mobileShipButtons,
    mobileThrottleButtons: ui.mobileThrottleButtons,
    fleetRows: ui.fleetRows.map((row) => ({
      row,
      key: row.dataset.ship,
      name: row.querySelector(".fleet-name"),
      state: row.querySelector(".fleet-state"),
      hullFill: row.querySelector(".fleet-fill-hull"),
      hullPct: row.querySelector(".fleet-pct-hull"),
      enFill: row.querySelector(".fleet-fill-energy"),
      enPct: row.querySelector(".fleet-pct-energy"),
    })),
  };
  updateSkillButtons(hudUi, own, {
    selected: ship,
    selectedZoneId: app.selectedZoneId,
    pendingSubSkillAim: app.pendingSubSkillAim,
    fallbackLoadout: app.loadoutA,
  });
  renderFleetRoster(hudUi, own, { selectedShipKey: app.selectedShipKey });
  syncMobileHud(hudUi, own, {
    visible: app.mobileMode,
    selected: ship,
    selectedShipKey: app.selectedShipKey,
    selectedZoneId: app.selectedZoneId,
    pendingSubSkillAim: app.pendingSubSkillAim,
  });
  if (app.runtime) {
    renderDiagnostics(ui.diagnostics, app.runtime.getDiagnostics());
    const result = app.runtime.getResult();
    if (result?.finished) showResult(result);
  }
}

function renderFrame() {
  const snap = currentSnapshot();
  if (!snap || !ctx) return;
  const scale = canvas.width / LOGICAL;
  camera.updateCamera();
  const view = camera.currentViewState();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.save();
  ctx.setTransform(
    view.zoom * scale,
    0,
    0,
    view.zoom * scale,
    -view.left * view.zoom * scale,
    -view.top * view.zoom * scale,
  );
  const own = ownTeam();
  const frame = {
    state: snap,
    ownTeam: own,
    enemyTeam: enemyTeam(),
    spectating: false,
    // 实验台玩家默认控 A：编制舰浅蓝↔深蓝脉动，便于验收后再接到 2v2 local seat
    localControlSeat: own?.seat || "A",
    visibleEnemyIds: new Set((own && own.visibleEnemyIds) || []),
    selectedKeyForTeam: (team) => (team === own ? app.selectedShipKey : null),
    mobileMode: app.mobileMode,
    stars: [],
    destructionEffects: app.destructionEffects,
    selectedZoneId: app.selectedZoneId,
    pendingSubSkillAim: app.pendingSubSkillAim,
    pointer: app.pointer,
  };
  const presentation = app.presentation;
  const presentationState = app.runtime?.getPresentationState?.() || null;
  const modeEvents = app.runtime?.consumeModeEvents?.() || [];
  if (presentation?.sync) {
    presentation.sync({
      snapshot: snap,
      modeState: app.runtime?.getModeState?.(),
      presentationState,
      events: modeEvents,
      frame,
    });
  }
  if (presentation?.renderWorldBefore) {
    presentation.renderWorldBefore(ctx, { snapshot: snap, presentationState, frame });
  }
  drawBattleWorld(ctx, frame);
  if (presentation?.renderWorldAfter) {
    presentation.renderWorldAfter(ctx, { snapshot: snap, presentationState, frame });
  }
  ctx.restore();
  drawMinimap(ctx, frame, camera.minimapRect(), view);
  if (presentation?.renderScreen) {
    presentation.renderScreen(ctx, { snapshot: snap, presentationState, frame, view: camera.currentViewState() });
  }
  if (app.runtime?.isPaused?.()) drawPauseOverlay(ctx);
}

function tick(timestamp) {
  if (!running) return;
  const rawDt = Math.min(0.05, Math.max(0, (timestamp - app.lastFrameTime) / 1000));
  app.lastFrameTime = timestamp;
  if (app.runtime) {
    app.runtime.update(rawDt, { maxSteps: 8 });
  }
  if (app.presentation?.update) {
    app.presentation.update(rawDt, {
      snapshot: currentSnapshot(),
      modeState: app.runtime?.getModeState?.(),
      presentationState: app.runtime?.getPresentationState?.(),
    });
  }
  updateHud();
  renderFrame();
  rafId = requestAnimationFrame(tick);
}

function bindPressButton(button, handler) {
  if (!button) return;
  let swallow = false;
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || button.disabled) return;
    swallow = true;
    event.preventDefault();
    handler();
  }, ac ? { signal: ac.signal } : undefined);
  button.addEventListener("click", (event) => {
    if (swallow) {
      swallow = false;
      event.preventDefault();
      return;
    }
    if (!button.disabled) handler();
  }, ac ? { signal: ac.signal } : undefined);
}

function bindUi() {
  const signal = ac.signal;

  ui.modeSelect?.addEventListener("change", () => {
    const mode = getPrototypeMode(ui.modeSelect.value);
    if (!mode) return;
    app.modeDefinition = mode;
    app.modeId = mode.id;
    app.modeParameters = normalizeModeParameters(mode.parameterSchema || [], mode.defaultParameters || {});
    writeStored(MODE_KEY, mode.id);
    syncModeMeta();
    rebuildParameterPanels();
  }, { signal });

  ui.applyModeBtn?.addEventListener("click", () => {
    const mode = getPrototypeMode(ui.modeSelect?.value) || app.modeDefinition;
    app.modeDefinition = mode;
    app.modeId = mode.id;
    app.modeParameters = normalizeModeParameters(mode.parameterSchema || [], {
      ...(mode.defaultParameters || {}),
      ...readParameterPanel(ui.modeParams),
    });
    writeStored(MODE_KEY, mode.id);
    syncModeMeta();
    rebuildParameterPanels();
    createRuntimeForCurrentMode();
  }, { signal });

  ui.pauseBtn?.addEventListener("click", () => {
    app.runtime?.togglePause?.();
    updateHud();
  }, { signal });

  ui.stepBtn?.addEventListener("click", () => {
    app.runtime?.pause?.();
    app.runtime?.step?.(TICK_DT);
    updateHud();
    renderFrame();
  }, { signal });

  ui.restartBtn?.addEventListener("click", () => {
    createRuntimeForCurrentMode();
  }, { signal });

  ui.resultRestartBtn?.addEventListener("click", () => {
    createRuntimeForCurrentMode();
  }, { signal });

  for (const button of ui.speedButtons) {
    button.addEventListener("click", () => {
      const speed = Number(button.dataset.speed);
      if (SPEED_PRESETS.includes(speed)) app.runtime?.setSpeedScale?.(speed);
      updateHud();
    }, { signal });
  }

  ui.swapLoadoutBtn?.addEventListener("click", () => {
    const a = readLoadoutFromDom("A");
    const b = readLoadoutFromDom("B");
    app.loadoutA = b;
    app.loadoutB = a;
    writeLoadoutToDom("A", app.loadoutA);
    writeLoadoutToDom("B", app.loadoutB);
  }, { signal });

  ui.randomBBtn?.addEventListener("click", () => {
    app.loadoutB = randomAiLoadout();
    writeLoadoutToDom("B", app.loadoutB);
  }, { signal });

  ui.applyLoadoutBtn?.addEventListener("click", () => {
    app.loadoutA = readLoadoutFromDom("A");
    app.loadoutB = readLoadoutFromDom("B");
    writeStored(LOADOUT_A_KEY, app.loadoutA);
    writeStored(LOADOUT_B_KEY, app.loadoutB);
    createRuntimeForCurrentMode();
  }, { signal });

  ui.applyModeParamsBtn?.addEventListener("click", () => {
    app.modeParameters = normalizeModeParameters(app.modeDefinition.parameterSchema || [], {
      ...(app.modeDefinition.defaultParameters || {}),
      ...readParameterPanel(ui.modeParams),
    });
    createRuntimeForCurrentMode();
  }, { signal });

  ui.applyGameplayBtn?.addEventListener("click", () => {
    app.gameplayRules = normalizeGameplayRules(readParameterPanel(ui.gameplayParams));
    createRuntimeForCurrentMode();
  }, { signal });

  for (const button of ui.shipSwitchButtons) {
    button.addEventListener("click", () => setSelectedShip(button.dataset.ship || "main"), { signal });
  }
  for (const row of ui.fleetRows) {
    row.addEventListener("click", () => setSelectedShip(row.dataset.ship || "main"), { signal });
  }
  for (const button of ui.mobileShipButtons) {
    button.addEventListener("click", () => setSelectedShip(button.dataset.ship || "main"), { signal });
  }

  ui.powerSlider?.addEventListener("input", () => setThrottleValue(ui.powerSlider.value), { signal });
  ui.zoomOutBtn?.addEventListener("click", () => camera.adjustCameraZoom(-1), { signal });
  ui.zoomInBtn?.addEventListener("click", () => camera.adjustCameraZoom(1), { signal });
  ui.mobileZoomOutBtn?.addEventListener("click", () => camera.adjustCameraZoom(-1), { signal });
  ui.mobileZoomInBtn?.addEventListener("click", () => camera.adjustCameraZoom(1), { signal });
  ui.mobileCenterBtn?.addEventListener("click", () => {
    const ship = selectedShip();
    if (ship) camera.centerCameraOn(ship.x, ship.y, false);
  }, { signal });

  bindPressButton(ui.splitOneBtn, () => applyAction({ type: "split", level: 1 }));
  bindPressButton(ui.splitTwoBtn, () => applyAction({ type: "split", level: 2 }));
  bindPressButton(ui.mobileSplitOneBtn, () => applyAction({ type: "split", level: 1 }));
  bindPressButton(ui.mobileSplitTwoBtn, () => applyAction({ type: "split", level: 2 }));
  bindPressButton(ui.scoutBtn, () => applyAction({ type: "launch_scout", zoneId: app.selectedZoneId, shipKey: app.selectedShipKey }));
  bindPressButton(ui.mobileScoutBtn, () => applyAction({ type: "launch_scout", zoneId: app.selectedZoneId, shipKey: app.selectedShipKey }));
  bindPressButton(ui.autoScoutBtn, toggleAutoScout);
  bindPressButton(ui.mobileAutoScoutBtn, toggleAutoScout);
  bindPressButton(ui.brakeBtn, useEmergencyBrake);
  bindPressButton(ui.mobileBrakeBtn, useEmergencyBrake);
  bindPressButton(ui.flagshipBtn, useFlagshipSkill);
  bindPressButton(ui.mobileFlagshipBtn, useFlagshipSkill);
  bindPressButton(ui.subSkillBtn, useSubSkill);
  bindPressButton(ui.mobileSubSkillBtn, useSubSkill);

  for (const button of ui.mobileThrottleButtons) {
    button.addEventListener("click", () => setThrottleValue(button.dataset.throttle || 100), { signal });
  }

  window.addEventListener("contextmenu", (event) => {
    if (!app.mobileMode) event.preventDefault();
  }, { signal });

  canvas.addEventListener("mousedown", (event) => {
    if (app.mobileMode || app.runtime?.isFinished?.()) return;
    const ship = selectedShip();
    if (event.button === 0) {
      if (!ship?.alive || !ship.canControl) return;
      const pos = camera.pointerFromEvent(event);
      app.pointer = pos;
      const handle = routeHandleAtPoint(ship.route, pos.x, pos.y);
      if (handle) app.drag = { handle, shipKey: ship.key };
      return;
    }
    if (event.button === 2) {
      event.preventDefault();
      if (!ship?.alive || !ship.canControl) return;
      const pos = camera.pointerFromEvent(event);
      app.pointer = pos;
      setRouteForSelectedShip(pos.x, pos.y);
    }
  }, { signal });

  canvas.addEventListener("mousemove", (event) => {
    const pos = camera.pointerFromEvent(event);
    app.pointer = pos;
    if (!app.drag || app.runtime?.isFinished?.()) return;
    if (app.drag.handle === "control") {
      applyAction({ type: "route_control", shipKey: app.drag.shipKey, controlX: pos.x, controlY: pos.y });
    } else {
      applyAction({ type: "route_end", shipKey: app.drag.shipKey, endX: pos.x, endY: pos.y });
    }
  }, { signal });

  window.addEventListener("mouseup", () => {
    if (!app.drag) return;
    app.drag = null;
    app.suppressMapClick = true;
  }, { signal });

  canvas.addEventListener("wheel", (event) => {
    if (app.mobileMode || app.runtime?.isFinished?.()) return;
    event.preventDefault();
    camera.adjustCameraZoom(event.deltaY < 0 ? 1 : -1, camera.screenPointFromEvent(event));
  }, { passive: false, signal });

  canvas.addEventListener("click", (event) => {
    if (event.button !== 0 || app.runtime?.isFinished?.()) return;
    if (app.suppressMapClick) {
      app.suppressMapClick = false;
      return;
    }
    const pos = camera.pointerFromEvent(event);
    app.pointer = pos;
    if (app.pendingSubSkillAim) {
      applyAction({
        type: "cast_sub_skill",
        shipKey: app.pendingSubSkillAim.shipKey,
        targetX: pos.x,
        targetY: pos.y,
      });
      app.pendingSubSkillAim = null;
      return;
    }
    if (app.mobileMode) {
      const tapped = shipAtPoint(ownTeam(), pos.x, pos.y);
      if (tapped) {
        setSelectedShip(tapped.key);
        return;
      }
      setRouteForSelectedShip(pos.x, pos.y);
      return;
    }
    const zone = zoneFromPoint(currentSnapshot(), pos.x, pos.y);
    if (zone) setSelectedZoneId(zone.id);
  }, { signal });

  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "SELECT" || active.tagName === "TEXTAREA" || active.isContentEditable)) {
      return;
    }
    const shipMap = { Digit1: "main", Digit2: "sub1", Digit3: "sub2" };
    if (shipMap[event.code]) {
      setSelectedShip(shipMap[event.code]);
      event.preventDefault();
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      app.runtime?.togglePause?.();
      return;
    }
    if (event.code === "KeyC") {
      event.preventDefault();
      useFlagshipSkill();
      return;
    }
    if (event.code === "KeyV") {
      event.preventDefault();
      useSubSkill();
      return;
    }
    if (event.code === "KeyX") {
      event.preventDefault();
      applyAction({ type: "launch_scout", zoneId: app.selectedZoneId, shipKey: app.selectedShipKey });
      return;
    }
    if (event.code === "KeyB") {
      event.preventDefault();
      useEmergencyBrake();
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
    }
  }, { signal });

  window.addEventListener("resize", () => {
    app.mobileMode = prefersMobileBattleMode();
    camera.resizeCanvas();
  }, { signal });
}

function buildModeOptions() {
  return listPrototypeModes()
    .map((mode) => `<option value="${mode.id}">${mode.name}</option>`)
    .join("");
}

export function mount(root) {
  initApp();
  root.innerHTML = prototypeShellHTML({
    modeOptionsHTML: buildModeOptions(),
    loadoutA: app.loadoutA,
    loadoutB: app.loadoutB,
  });
  cacheDom(root);
  camera = createBattleCamera({
    canvas,
    isMobile: () => app.mobileMode,
    getTrackedShip: () => selectedShip(),
    onZoomChanged: () => updateHud(),
  });
  ac = new AbortController();
  running = true;
  app.mobileMode = prefersMobileBattleMode();
  bindBattleBgmMuteButton(root.querySelector("#battleBgmMuteBtn"));
  bindUi();
  syncModeMeta();
  rebuildParameterPanels();
  writeLoadoutToDom("A", app.loadoutA);
  writeLoadoutToDom("B", app.loadoutB);
  createRuntimeForCurrentMode();
  camera.resizeCanvas();
  app.lastFrameTime = performance.now();
  rafId = requestAnimationFrame(tick);
  return unmount;
}

function unmount() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  stopBattleBgm();
  destroyPresentation();
  if (app?.runtime) {
    app.runtime.destroy();
    app.runtime = null;
  }
  if (typeof window !== "undefined") {
    window.__TDOS_PROTOTYPE_RUNTIME__ = null;
  }
  if (ac) ac.abort();
  ac = null;
  camera = null;
  app = null;
  canvas = null;
  ctx = null;
  ui = null;
}
