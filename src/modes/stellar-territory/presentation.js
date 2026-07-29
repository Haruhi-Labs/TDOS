import {
  buildTerrainVisualState,
  buildTerritoryMinimapState,
  buildTerritoryTicketHudState,
  renderTerritoryEntities,
  renderTerritoryEventEffects,
  renderTerritoryMap,
  renderTerritoryMinimapOverlay,
  renderTerritoryRespawnEffects,
  renderTerritoryTacticalAim,
  renderTerritoryTicketHud,
} from "./render.js";
import { advanceTerritoryPresentationEffects, buildControlPointVisualState } from "./effects.js";
import { ALLOWED_TACTICAL_SKILLS } from "../../../shared/gameplay/territory-skills.js";

export { advanceTerritoryPresentationEffects, buildControlPointVisualState } from "./effects.js";
export {
  buildTerrainVisualState,
  buildTerritoryMinimapState,
  buildTerritoryTicketHudState,
  renderTerritoryMap,
  renderTerritoryEventEffects,
  renderTerritoryMinimapOverlay,
  renderTerritoryRespawnEffects,
  renderTerritoryTacticalAim,
  renderTerritoryTicketHud,
} from "./render.js";

const TACTICAL_SKILL_BY_ID = new Map(ALLOWED_TACTICAL_SKILLS.map((skill) => [skill.id, skill]));
const TACTICAL_SKILL_ICON = Object.freeze({
  all_fleet_shield: "盾",
  propulsion_overload: "进",
  firepower_overload: "火",
  short_warp: "跃",
  gravity_field: "引",
  repair_drones: "修",
});
const TACTICAL_TARGET_LABEL = Object.freeze({
  none: "立即生效",
  point: "地图落点",
  fleet: "友方编队",
});

export function buildTerritoryTacticalHudState(presentationState = {}, {
  allianceId = "A",
  hotkey = "X",
  fleetSeats = [],
  aiming = false,
} = {}) {
  const slot = presentationState?.alliances?.[allianceId]?.skillSlot || null;
  const skill = TACTICAL_SKILL_BY_ID.get(slot?.skillId);
  if (!skill) {
    return {
      empty: true,
      label: "战术技能：空",
      hotkey,
      icon: "-",
      fleetTargets: [],
      aiming: false,
    };
  }
  return {
    empty: false,
    label: "战术技能",
    skillId: skill.id,
    name: skill.name,
    description: skill.description,
    targetType: skill.targetType,
    targetLabel: TACTICAL_TARGET_LABEL[skill.targetType] || skill.targetType,
    hotkey,
    icon: TACTICAL_SKILL_ICON[skill.id] || "技",
    maxDistance: Number(skill.maxDistance) || null,
    radius: Number(skill.radius) || null,
    fleetTargets: skill.targetType === "fleet" ? fleetSeats.slice() : [],
    aiming: Boolean(aiming),
  };
}

export function buildTerritoryTacticalAimState({
  skillId,
  source,
  point,
  worldSize = { width: 1440, height: 1440 },
} = {}) {
  const skill = TACTICAL_SKILL_BY_ID.get(skillId);
  if (!skill || skill.targetType !== "point") return { active: false };
  const target = {
    x: Number(point?.x),
    y: Number(point?.y),
  };
  const origin = Number.isFinite(Number(source?.x)) && Number.isFinite(Number(source?.y))
    ? { x: Number(source.x), y: Number(source.y) }
    : null;
  const width = Number(worldSize?.width) || Number(worldSize) || 1440;
  const height = Number(worldSize?.height) || Number(worldSize) || width;
  const pointIsFinite = Number.isFinite(target.x) && Number.isFinite(target.y);
  const inBounds = pointIsFinite && target.x >= 0 && target.y >= 0 && target.x <= width && target.y <= height;
  const distance = origin && pointIsFinite ? Math.hypot(target.x - origin.x, target.y - origin.y) : null;
  const maxDistance = Number(skill.maxDistance) || null;
  let invalidReason = null;
  if (!inBounds) invalidReason = "bounds";
  else if (maxDistance && !origin) invalidReason = "source";
  else if (maxDistance && distance > maxDistance) invalidReason = "range";
  return {
    active: true,
    skillId: skill.id,
    source: origin,
    point: target,
    worldSize: { width, height },
    maxDistance,
    radius: Number(skill.radius) || null,
    distance,
    legal: invalidReason == null,
    invalidReason,
  };
}

function clearElement(element) {
  if (element) element.innerHTML = "";
}

function allianceIdForSeat(seat) {
  return String(seat || "A").toUpperCase().startsWith("B") ? "B" : "A";
}

function navigationFeedbackVisibleForLocalSeat(feedback, snapshot, frame, localSeat) {
  if (frame?.spectating) return true;
  const seat = String(feedback?.seat || "").trim();
  if (!seat) return false;
  if (allianceIdForSeat(seat) === allianceIdForSeat(localSeat)) return true;
  const fleet = snapshot?.fleets?.[seat] || snapshot?.teams?.[seat];
  const shipKey = feedback?.shipKey || feedback?.payload?.shipKey || "main";
  const ship = fleet?.ships?.[shipKey];
  const entityId = feedback?.entityId || feedback?.payload?.entityId || ship?.id;
  return Boolean(entityId && frame?.visibleEnemyIds?.has?.(entityId));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function makeToggle(label, checked, onChange) {
  const wrap = document.createElement("label");
  wrap.className = "proto-mode-toggle";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  const span = document.createElement("span");
  span.textContent = label;
  input.addEventListener("change", () => onChange(input.checked));
  wrap.append(input, span);
  return wrap;
}

function renderHud(container, presentationState, tactical, onFleetTarget) {
  if (!container || !presentationState) return;
  const cps = presentationState.map?.controlPoints || [];
  const skillId = tactical.empty ? "" : tactical.skillId;
  const tacticalMarkup = tactical.empty
    ? `<div class="territory-tactical-empty">${escapeHtml(tactical.label)}</div>`
    : `
      <div class="territory-tactical-head">
        <span class="territory-tactical-icon" aria-hidden="true">${escapeHtml(tactical.icon)}</span>
        <span class="territory-tactical-name">${escapeHtml(tactical.name)}</span>
        <kbd>${escapeHtml(tactical.hotkey)}</kbd>
      </div>
      <div class="territory-tactical-meta">${escapeHtml(tactical.targetLabel)}</div>
      <p>${escapeHtml(tactical.description)}</p>
      ${tactical.fleetTargets.length > 0 ? `
        <div class="territory-tactical-targets" aria-label="友方编队目标">
          ${tactical.fleetTargets.map((seat) => `<button type="button" data-tactical-target-seat="${escapeHtml(seat)}">${escapeHtml(seat)}</button>`).join("")}
        </div>
      ` : ""}
    `;
  container.innerHTML = `
    <div class="territory-hud">
      <div><span>A战争点数</span><strong>${presentationState.alliances?.A?.tickets ?? "-"}</strong></div>
      <div><span>B战争点数</span><strong>${presentationState.alliances?.B?.tickets ?? "-"}</strong></div>
      <div><span>控制区</span><strong>${cps.length}</strong></div>
      <div><span>资源节点</span><strong>${presentationState.map?.resourceSpawnNodes?.length ?? 0}</strong></div>
      <div><span>技能节点</span><strong>${presentationState.map?.skillSpawnNodes?.length ?? 0}</strong></div>
      <div><span>资源实体</span><strong>${presentationState.pickups?.length ?? 0}</strong></div>
      <div><span>技能包</span><strong>${presentationState.skillPickups?.length ?? 0}</strong></div>
      <div><span>阶段</span><strong>${presentationState.phase || "-"}</strong></div>
    </div>
    <section
      class="territory-tactical-hud"
      data-skill-id="${escapeHtml(skillId)}"
      data-aiming="${tactical.aiming}"
      data-invalid="${tactical.invalid}"
      aria-label="战术技能"
    >
      ${tacticalMarkup}
    </section>
  `;
  for (const button of container.querySelectorAll("[data-tactical-target-seat]")) {
    button.addEventListener("click", () => onFleetTarget(button.dataset.tacticalTargetSeat));
  }
}

export function createStellarTerritoryPresentation({ root, runtime, restartHost } = {}) {
  const tools = root?.querySelector?.("#protoModeTools");
  const hud = root?.querySelector?.("#protoModeHud");
  const tacticalButtons = [
    root?.querySelector?.("#tacticalSkillBtn"),
    root?.querySelector?.("#mobileTacticalSkillBtn"),
  ].filter(Boolean);
  const mobileTacticalButton = root?.querySelector?.("#mobileTacticalSkillBtn");
  const mobileFleetTargets = mobileTacticalButton ? document.createElement("div") : null;
  if (mobileFleetTargets) {
    mobileFleetTargets.className = "mobile-territory-tactical-targets";
    mobileFleetTargets.hidden = true;
    mobileTacticalButton.insertAdjacentElement("afterend", mobileFleetTargets);
  }
  const tacticalButtonDefaults = tacticalButtons.map((button) => ({
    button,
    hidden: button.hidden,
    disabled: button.disabled,
    text: button.textContent,
    title: button.getAttribute("title"),
  }));
  const interactionController = new AbortController();
  const state = {
    showDebugBounds: true,
    showNodes: true,
    showTerrainDebug: false,
    presentationState: null,
    effects: null,
    aimingSkillId: null,
    invalidTarget: false,
    lastSlotSkillId: null,
    hudSignature: null,
    mobileTargetSignature: null,
  };

  function localTacticalContext() {
    const layout = runtime?.getFleetLayout?.();
    const localSeat = String(layout?.localSeat || "A").toUpperCase();
    const allianceId = allianceIdForSeat(localSeat);
    const fleetSeats = (layout?.alliances?.[allianceId] || []).map((entry) => entry.seat).filter(Boolean);
    return { localSeat, allianceId, fleetSeats };
  }

  function tacticalHudState() {
    const context = localTacticalContext();
    return {
      ...buildTerritoryTacticalHudState(state.presentationState, {
        allianceId: context.allianceId,
        fleetSeats: context.fleetSeats,
        aiming: Boolean(state.aimingSkillId),
      }),
      invalid: state.invalidTarget,
    };
  }

  function invalidateHud() {
    state.hudSignature = null;
  }

  function cancelTacticalInteraction() {
    if (!state.aimingSkillId) return false;
    state.aimingSkillId = null;
    state.invalidTarget = false;
    invalidateHud();
    return true;
  }

  function restartMode(options) {
    state.effects = advanceTerritoryPresentationEffects(state.effects, { reset: true });
    state.presentationState = null;
    state.aimingSkillId = null;
    state.invalidTarget = false;
    state.lastSlotSkillId = null;
    invalidateHud();
    if (typeof restartHost === "function") {
      const hostOptions = options === undefined
        ? { randomSeed: runtime?.getRandomSeed?.() }
        : options;
      return restartHost(hostOptions);
    }
    const result = options === undefined ? runtime?.restart?.() : runtime?.restart?.(options);
    syncTools();
    return result;
  }

  function activateTacticalSkill() {
    const tactical = tacticalHudState();
    if (state.aimingSkillId) {
      cancelTacticalInteraction();
      return true;
    }
    if (tactical.empty) return true;
    if (tactical.targetType === "none") {
      state.invalidTarget = runtime?.applyAction?.({ type: "use_tactical_skill" }, localTacticalContext().localSeat) === false;
      invalidateHud();
      return true;
    }
    state.aimingSkillId = tactical.skillId;
    state.invalidTarget = false;
    invalidateHud();
    return true;
  }

  function useFleetTarget(targetSeat) {
    const tactical = tacticalHudState();
    if (tactical.empty || tactical.targetType !== "fleet") return false;
    const accepted = runtime?.applyAction?.({
      type: "use_tactical_skill",
      targetSeat,
    }, localTacticalContext().localSeat) !== false;
    state.invalidTarget = !accepted;
    if (accepted) state.aimingSkillId = null;
    invalidateHud();
    return true;
  }

  function syncTacticalButtons(tactical) {
    for (const button of tacticalButtons) {
      button.hidden = false;
      button.disabled = tactical.empty;
      button.textContent = tactical.empty ? "战术技能" : `${tactical.icon} ${tactical.name}`;
      button.title = tactical.empty ? tactical.label : `${tactical.name}（X）`;
    }
  }

  function syncMobileFleetTargets(tactical) {
    if (!mobileFleetTargets) return;
    const targets = tactical.targetType === "fleet" ? tactical.fleetTargets : [];
    const signature = targets.join(",");
    mobileFleetTargets.hidden = targets.length === 0;
    if (signature === state.mobileTargetSignature) return;
    state.mobileTargetSignature = signature;
    mobileFleetTargets.innerHTML = targets
      .map((seat) => `<button type="button" data-mobile-tactical-target-seat="${escapeHtml(seat)}">${escapeHtml(seat)}</button>`)
      .join("");
    for (const button of mobileFleetTargets.querySelectorAll("[data-mobile-tactical-target-seat]")) {
      button.addEventListener("click", () => useFleetTarget(button.dataset.mobileTacticalTargetSeat));
    }
  }

  for (const button of tacticalButtons) {
    button.addEventListener("click", activateTacticalSkill, { signal: interactionController.signal });
  }

  function syncTools() {
    if (!tools) return;
    clearElement(tools);
    const panel = document.createElement("div");
    panel.className = "territory-tools";
    const seed = runtime?.getRandomSeed?.() ?? state.presentationState?.seed ?? "-";
    const seedRow = document.createElement("div");
    seedRow.className = "territory-seed-row";
    seedRow.innerHTML = `<span>当前种子</span><strong>${seed == null ? "-" : seed}</strong>`;
    panel.append(seedRow);

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "复制种子";
    copyBtn.addEventListener("click", () => {
      if (navigator?.clipboard && seed !== "-") {
        navigator.clipboard.writeText(String(seed)).catch(() => {});
      }
    });
    const seedField = document.createElement("label");
    seedField.className = "territory-seed-field";
    const seedFieldLabel = document.createElement("span");
    seedFieldLabel.textContent = "地图种子";
    const seedInput = document.createElement("input");
    seedInput.type = "number";
    seedInput.min = "0";
    seedInput.max = "4294967295";
    seedInput.step = "1";
    seedInput.value = seed === "-" ? "" : String(seed);
    seedInput.dataset.territorySeedInput = "";
    seedInput.setAttribute("aria-label", "地图种子");
    seedField.append(seedFieldLabel, seedInput);

    const loadSeedBtn = document.createElement("button");
    loadSeedBtn.type = "button";
    loadSeedBtn.textContent = "载入种子";
    loadSeedBtn.addEventListener("click", () => {
      const requestedSeed = Number(seedInput.value);
      if (!Number.isInteger(requestedSeed) || requestedSeed < 0 || requestedSeed > 0xffffffff) {
        seedInput.setCustomValidity("请输入 0 到 4294967295 之间的整数");
        seedInput.reportValidity();
        return;
      }
      seedInput.setCustomValidity("");
      restartMode({ randomSeed: requestedSeed });
    });

    const seedActions = document.createElement("div");
    seedActions.className = "territory-seed-actions";
    seedActions.append(copyBtn, loadSeedBtn);
    panel.append(seedField, seedActions);

    const newMapBtn = document.createElement("button");
    newMapBtn.type = "button";
    newMapBtn.textContent = "新地图重开";
    newMapBtn.className = "territory-new-map-btn";
    newMapBtn.addEventListener("click", () => {
      restartMode({ randomSeed: null });
    });
    const replayMapBtn = document.createElement("button");
    replayMapBtn.type = "button";
    replayMapBtn.textContent = "同种子重开";
    replayMapBtn.addEventListener("click", () => {
      restartMode();
    });
    const restartActions = document.createElement("div");
    restartActions.className = "territory-restart-actions";
    restartActions.append(newMapBtn, replayMapBtn);
    panel.append(restartActions);
    const spawnRepairBtn = document.createElement("button");
    spawnRepairBtn.type = "button";
    spawnRepairBtn.textContent = "生成维修包";
    spawnRepairBtn.addEventListener("click", () => {
      runtime?.applyAction?.({ type: "debug_spawn_resource", resourceType: "repair", rarity: "common" }, "A");
    });
    panel.append(spawnRepairBtn);
    const spawnSkillBtn = document.createElement("button");
    spawnSkillBtn.type = "button";
    spawnSkillBtn.textContent = "生成技能包";
    spawnSkillBtn.addEventListener("click", () => {
      runtime?.applyAction?.({ type: "debug_spawn_skill", skillId: "all_fleet_shield" }, "A");
    });
    panel.append(spawnSkillBtn);
    panel.append(makeToggle("显示调试边界", state.showDebugBounds, (value) => (state.showDebugBounds = value)));
    panel.append(makeToggle("显示生成节点", state.showNodes, (value) => (state.showNodes = value)));
    panel.append(makeToggle("显示地形碰撞区域", state.showTerrainDebug, (value) => (state.showTerrainDebug = value)));
    tools.append(panel);
  }

  syncTools();

  return {
    sync({ snapshot, presentationState, events = [], frame }) {
      state.presentationState = presentationState || null;
      const nextSlotSkillId = tacticalHudState().skillId || null;
      if (nextSlotSkillId !== state.lastSlotSkillId) {
        state.lastSlotSkillId = nextSlotSkillId;
        state.aimingSkillId = null;
        state.invalidTarget = false;
        invalidateHud();
      }
      state.effects = advanceTerritoryPresentationEffects(state.effects, {
        presentationState: state.presentationState,
        snapshot,
        events,
        isNavigationFeedbackVisible: (feedback) => {
          const { localSeat } = localTacticalContext();
          return navigationFeedbackVisibleForLocalSeat(feedback, snapshot, frame, localSeat);
        },
      });
      const tactical = tacticalHudState();
      const hudSignature = JSON.stringify({
        ticketsA: state.presentationState?.alliances?.A?.tickets,
        ticketsB: state.presentationState?.alliances?.B?.tickets,
        controls: state.presentationState?.map?.controlPoints?.length,
        resourceNodes: state.presentationState?.map?.resourceSpawnNodes?.length,
        skillNodes: state.presentationState?.map?.skillSpawnNodes?.length,
        pickups: state.presentationState?.pickups?.length,
        skillPickups: state.presentationState?.skillPickups?.length,
        phase: state.presentationState?.phase,
        tactical,
      });
      if (hudSignature !== state.hudSignature) {
        renderHud(hud, state.presentationState, tactical, useFleetTarget);
        state.hudSignature = hudSignature;
      }
      syncTacticalButtons(tactical);
      syncMobileFleetTargets(tactical);
    },

    handleKeyDown({ code } = {}) {
      if (code === "KeyX") return activateTacticalSkill();
      if (code === "Escape") return cancelTacticalInteraction();
      return false;
    },

    handleWorldClick({ point } = {}) {
      const tactical = tacticalHudState();
      if (!state.aimingSkillId || tactical.targetType !== "point") return false;
      const accepted = runtime?.applyAction?.({
        type: "use_tactical_skill",
        targetX: Number(point?.x),
        targetY: Number(point?.y),
      }, localTacticalContext().localSeat) !== false;
      state.invalidTarget = !accepted;
      if (accepted) state.aimingSkillId = null;
      invalidateHud();
      return true;
    },

    cancelInteraction() {
      return cancelTacticalInteraction();
    },

    update(dt, { snapshot, presentationState } = {}) {
      state.effects = advanceTerritoryPresentationEffects(state.effects, {
        dt,
        presentationState: presentationState || state.presentationState,
        snapshot,
      });
    },

    renderWorldBefore(ctx, { presentationState }) {
      const { localSeat } = localTacticalContext();
      renderTerritoryMap(ctx, presentationState?.map, {
        showDebugBounds: state.showDebugBounds,
        showNodes: state.showNodes,
        showTerrainDebug: state.showTerrainDebug,
        effects: state.effects,
        navigationPlans: presentationState?.navigationPlans,
        localSeat,
      });
    },

    renderWorldAfter(ctx, { snapshot, presentationState, frame }) {
      renderTerritoryEntities(ctx, presentationState);
      const { localSeat } = localTacticalContext();
      renderTerritoryEventEffects(ctx, state.effects, {
        isNavigationFeedbackVisible: (feedback) => (
          navigationFeedbackVisibleForLocalSeat(feedback, snapshot, frame, localSeat)
        ),
      });
      renderTerritoryRespawnEffects(ctx, state.effects);
      if (state.aimingSkillId) {
        const fleet = snapshot?.fleets?.[localSeat] || snapshot?.teams?.[localSeat];
        const source = fleet?.ships?.main?.alive
          ? fleet.ships.main
          : Object.values(fleet?.ships || {}).find((ship) => ship?.alive);
        const aim = buildTerritoryTacticalAimState({
          skillId: state.aimingSkillId,
          source,
          point: frame?.pointer,
          worldSize: presentationState?.map?.worldSize || snapshot?.world?.size,
        });
        renderTerritoryTacticalAim(ctx, aim);
      }
    },

    renderMinimap(ctx, { presentationState, rect }) {
      renderTerritoryMinimapOverlay(ctx, presentationState, { rect });
    },

    renderScreen(ctx, { presentationState, frame }) {
      renderTerritoryTicketHud(ctx, presentationState, state.effects, frame?.screenSize);
    },

    destroy() {
      interactionController.abort();
      mobileFleetTargets?.remove();
      for (const defaults of tacticalButtonDefaults) {
        defaults.button.hidden = defaults.hidden;
        defaults.button.disabled = defaults.disabled;
        defaults.button.textContent = defaults.text;
        if (defaults.title == null) defaults.button.removeAttribute("title");
        else defaults.button.setAttribute("title", defaults.title);
      }
      clearElement(tools);
      clearElement(hud);
    },
  };
}
