import { renderTerritoryEntities, renderTerritoryMap } from "./render.js";

function clearElement(element) {
  if (element) element.innerHTML = "";
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

function renderHud(container, state) {
  if (!container || !state) return;
  const cps = state.map?.controlPoints || [];
  container.innerHTML = `
    <div class="territory-hud">
      <div><span>A战争点数</span><strong>${state.alliances?.A?.tickets ?? "-"}</strong></div>
      <div><span>B战争点数</span><strong>${state.alliances?.B?.tickets ?? "-"}</strong></div>
      <div><span>控制区</span><strong>${cps.length}</strong></div>
      <div><span>资源节点</span><strong>${state.map?.resourceSpawnNodes?.length ?? 0}</strong></div>
      <div><span>技能节点</span><strong>${state.map?.skillSpawnNodes?.length ?? 0}</strong></div>
      <div><span>资源实体</span><strong>${state.pickups?.length ?? 0}</strong></div>
      <div><span>技能包</span><strong>${state.skillPickups?.length ?? 0}</strong></div>
      <div><span>阶段</span><strong>${state.phase || "-"}</strong></div>
    </div>
  `;
}

export function createStellarTerritoryPresentation({ root, runtime } = {}) {
  const tools = root?.querySelector?.("#protoModeTools");
  const hud = root?.querySelector?.("#protoModeHud");
  const state = {
    showDebugBounds: true,
    showNodes: true,
    showTerrain: true,
    presentationState: null,
  };

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
    panel.append(copyBtn);
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
    panel.append(makeToggle("显示地形碰撞区域", state.showTerrain, (value) => (state.showTerrain = value)));
    tools.append(panel);
  }

  syncTools();

  return {
    sync({ presentationState }) {
      state.presentationState = presentationState || null;
      renderHud(hud, state.presentationState);
    },

    update() {},

    renderWorldBefore(ctx, { presentationState }) {
      renderTerritoryMap(ctx, presentationState?.map, {
        showDebugBounds: state.showDebugBounds,
        showNodes: state.showNodes,
        showTerrain: state.showTerrain,
      });
    },

    renderWorldAfter(ctx, { presentationState }) {
      renderTerritoryEntities(ctx, presentationState);
    },

    renderScreen() {},

    destroy() {
      clearElement(tools);
      clearElement(hud);
    },
  };
}
