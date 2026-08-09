import { distance } from "../shared/game-core.js";
import { t } from "./i18n.js";

export const TUTORIAL_LOADOUT = Object.freeze({ main: "haruhi", sub1: "yuki", sub2: "kyon" });
export const TUTORIAL_MOVE_TARGET = Object.freeze({ x: 720, y: 240, radius: 72, zoneId: 2 });
export const TUTORIAL_ATTACK_TARGET = Object.freeze({ x: 1110, y: 395, radius: 125, zoneId: 3 });

const STEPS = [
  {
    id: "move",
    phase: 1,
    title: "移动舰队",
    body: (mobile) => mobile
      ? "点击战场，在<b>2号战区中央</b>的标记区域内设置航线终点。"
      : "在战场上<b>右键单击</b>，将航线终点设置在<b>2号战区中央</b>的标记区域内。",
    wait: "设置航线并等待舰队抵达",
    illustration: "moveTarget",
  },
  {
    id: "vision",
    phase: 2,
    title: "视野范围",
    body: "舰船周围的<b>青色圆环</b>表示视野。敌舰进入任意友方单位的视野后，才会显示准确位置并成为可攻击目标。",
    button: "查看射程",
    illustration: "vision",
    callout: "视野用于确认敌舰的准确位置",
  },
  {
    id: "range",
    phase: 2,
    title: "武器射程",
    body: "舰船周围的<b>金色圆环</b>表示武器射程，通常大于舰船自身视野。敌舰还需被任意友方单位看见，舰船才会自动开火。",
    button: "继续",
    illustration: "range",
    callout: "同时看得见、够得着，才能开火",
  },
  {
    id: "scout",
    phase: 3,
    title: "派出侦察机",
    body: (mobile) => mobile
      ? "侦察机拥有独立视野。按住<b>侦察</b>按钮并向上拖动，指向<b>2号战区</b>后松手释放；直接轻点会释放到中央战区。"
      : "侦察机拥有独立视野，可以在舰队之外确认敌舰位置。现在向<b>2号战区</b>派出一架侦察机，观察它带来的额外视野。",
    wait: "派出一架侦察机",
    illustration: "scoutVision",
    highlight: ["scoutBtn", "mobileScoutBtn"],
  },
  {
    id: "energy",
    phase: 3,
    title: "能量与舰况",
    body: "派出侦察机、释放主动技能和使用<b>4档推进</b>都会消耗能量。P、1、2档持续回能，3档缓慢回能，4档持续耗能；教程中推进档位暂时锁定。左下角舰况栏可分别查看每艘舰船的舰体与能量。",
    button: "继续",
    callout: "需要恢复能量时，主动降低档位",
  },
  {
    id: "split_yuki",
    phase: 4,
    title: "一级分离 · 长门有希",
    body: "解锁<b>一级分离</b>，让有希独立行动。有希擅长侦察与支援，春日旗舰更擅长正面作战。分离后可分别控制舰队，但分离<b>不可逆</b>，舰船也不再共同承伤。",
    wait: "执行一级分离",
    highlight: ["splitOneBtn", "mobileSplitOneBtn"],
  },
  {
    id: "split_explain",
    phase: 4,
    title: "独立舰队",
    body: "有希现已成为独立舰队，拥有自己的航线、舰体、能量和技能状态。切换舰船后，下达的命令只会作用于当前舰队。",
    button: "继续",
  },
  {
    id: "yuki_skill",
    phase: 5,
    title: "有希的分舰技能",
    body: "选择<b>长门有希</b>，释放分舰技能「apm上万」。十六架高速侦察机会向八个方向展开搜索。",
    wait: "选择有希并释放分舰技能",
    highlight: ["subSkillBtn", "mobileSubSkillBtn"],
  },
  {
    id: "enemy_found",
    phase: 5,
    title: "发现敌方动向",
    body: "有希的侦察机已将训练舰队的大致活动区域标在<b>3号战区中下方</b>。区域提示不等于持续视野；敌舰进入任意友方视野后，位置才会被确认。",
    button: "继续",
    illustration: "enemyRegion",
    callout: "先根据情报接近，再用视野确认目标",
  },
  {
    id: "split_kyon",
    phase: 5,
    title: "二级分离 · 阿虚",
    body: "现在解锁<b>二级分离</b>。阿虚的分舰技能可同时强化机动、火力并回复舰体，适合持续作战。分离后，三支舰队的航线、舰况和技能各自独立。",
    wait: "执行二级分离",
    highlight: ["splitTwoBtn", "mobileSplitTwoBtn"],
  },
  {
    id: "regroup",
    phase: 5,
    title: "三舰协同机动",
    body: "依次选择春日、有希和阿虚，为每支舰队分别设置航线，使三支舰队全部抵达<b>3号战区中下方</b>的集结区域。",
    callout: "看不到目标点时，点击右上角小地图切换视窗",
    wait: "让三支舰队全部抵达标记区域",
    illustration: "attackTarget",
  },
  {
    id: "attack",
    phase: 6,
    title: "自动交火与朝向",
    body: "敌舰同时进入视野和射程后，舰船会自动攻击最近的目标。多数舰船<b>侧舷射速 ×1.5</b>、舰首 ×1、舰尾不开火；调整航线，让侧舷朝向敌人。",
    wait: "等待任意友方舰船首次开火",
    illustration: "fireArc",
  },
  {
    id: "battle_skills",
    phase: 6,
    title: "旗舰技与分舰技",
    body: "先发动春日的<b>旗舰技能</b>，再选择阿虚并发动他的<b>分舰技能</b>。旗舰技能无需切换当前舰队；分舰技能只能由当前选中的副舰发动。",
    wait: "发动春日旗舰技与阿虚分舰技",
    highlight: ["flagshipBtn", "mobileFlagshipBtn", "subSkillBtn", "mobileSubSkillBtn"],
  },
  {
    id: "free",
    phase: 7,
    title: "自由作战",
    body: "进入实战后，训练舰队将开始移动、攻击和侦察。教程中任一友方舰船的舰体最低保留<b>25%</b>。自由控制三支舰队，消灭全部敌舰即可完成教程。",
    button: "开始实战",
    illustration: "enemyRegion",
  },
];

let activeIndex = -1;
let ctx = null;
let overlayEl = null;
let cardEl = null;
let highlighted = [];
let briefingClosed = false;
let usedBattleSkills = new Set();
let selectedShips = new Set();
let scoutLaunched = false;
let splitLevelReached = 0;
let yukiSkillCast = false;
let mobileLayoutObserver = null;
let removeMobileLayoutListeners = null;

function step() {
  return STEPS[activeIndex] || null;
}

function isActive() {
  return activeIndex >= 0 && activeIndex < STEPS.length;
}

function isMobile() {
  return Boolean(ctx?.isMobile?.());
}

function clearHighlights() {
  for (const el of highlighted) el.classList.remove("tut-highlight");
  highlighted = [];
}

function applyHighlights(ids = []) {
  clearHighlights();
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && ((isMobile() && id.startsWith("mobile")) || (!isMobile() && !id.startsWith("mobile")))) {
      el.classList.add("tut-highlight");
      highlighted.push(el);
    }
  }
}

function renderCard() {
  const current = step();
  if (!current || !cardEl || briefingClosed) return;
  const rawBody = typeof current.body === "function" ? current.body(isMobile()) : current.body;
  cardEl.classList.remove("ready");
  setTimeout(() => {
    if (!cardEl || step() !== current) return;
    cardEl.innerHTML = `
      <div class="tut-heading">
        <div class="tut-step">${t("教学阶段 {phase} / 7", { phase: current.phase })}</div>
        <h3 class="tut-title">${t(current.title)}</h3>
      </div>
      <div class="tut-copy">
        <p class="tut-body">${t(rawBody)}</p>
        ${current.callout ? `<p class="tut-callout">${t(current.callout)}</p>` : ""}
        ${current.wait ? `<p class="tut-wait">↳ ${t(current.wait)}</p>` : ""}
      </div>
      ${current.button ? `<div class="tut-actions"><button type="button" class="tut-next">${t(current.button)}</button></div>` : ""}`;
    cardEl.querySelector(".tut-next")?.addEventListener("click", () => {
      if (current.id === "free") closeBriefing();
      else goto(activeIndex + 1);
    });
    requestAnimationFrame(() => cardEl?.classList.add("ready"));
    layoutMobile();
  }, 110);
  applyHighlights(current.highlight);
}

function goto(index) {
  activeIndex = Math.max(0, Math.min(index, STEPS.length - 1));
  const current = step();
  ctx?.onStageChange?.(current.id, current.phase);
  renderCard();
}

function closeBriefing() {
  briefingClosed = true;
  clearHighlights();
  overlayEl?.classList.add("closed");
  ctx?.onStageChange?.("free", 7);
}

export function tutorialMobileDockLayout({
  buttonRects = [],
  hudRect = null,
  viewportWidth = 0,
  viewportHeight = 0,
} = {}) {
  const width = Math.max(0, Number(viewportWidth) || 0);
  const height = Math.max(0, Number(viewportHeight) || 0);
  const visibleButtons = buttonRects
    .map((rect) => ({
      top: Number(rect?.top),
      bottom: Number(rect?.bottom),
    }))
    .filter((rect) => Number.isFinite(rect.top) && Number.isFinite(rect.bottom) && rect.bottom > rect.top)
    .sort((a, b) => a.top - b.top);

  const rows = [];
  for (const rect of visibleButtons) {
    const row = rows.find((candidate) => Math.abs(candidate.top - rect.top) <= 2);
    if (row) {
      row.bottom = Math.max(row.bottom, rect.bottom);
    } else {
      rows.push({ top: rect.top, bottom: rect.bottom });
    }
  }

  const secondLastRow = rows[Math.max(0, rows.length - 2)] || null;
  const hudTop = Number.isFinite(Number(hudRect?.top)) ? Number(hudRect.top) : height;
  const hudBottom = Number.isFinite(Number(hudRect?.bottom)) ? Number(hudRect.bottom) : height;
  const topBoundary = Math.min(height, Math.max(0, (secondLastRow?.bottom ?? hudTop) + 6));
  const bottomInset = Math.max(8, height - Math.min(height, hudBottom) + 8);
  const leftInset = Math.max(8, (Number(hudRect?.left) || 0) + 8);
  const rightInset = Math.max(8, width - (Number(hudRect?.right) || width) + 8);

  return {
    topBoundary,
    bottomInset,
    leftInset,
    rightInset,
    maxHeight: Math.max(1, height - bottomInset - topBoundary),
  };
}

function layoutMobile() {
  if (!overlayEl) return;
  overlayEl.classList.toggle("tut-mobile", isMobile());
  if (!isMobile()) {
    for (const property of [
      "--tut-mobile-dock-bottom",
      "--tut-mobile-dock-left",
      "--tut-mobile-dock-right",
      "--tut-mobile-dock-max-height",
    ]) {
      overlayEl.style.removeProperty(property);
    }
    return;
  }

  const hud = document.getElementById("mobileBattleHud");
  const actionButtons = [...document.querySelectorAll(".mobile-action-grid > button")];
  if (!hud || actionButtons.length === 0) return;
  const viewportWidth = window.visualViewport?.width || innerWidth;
  const viewportHeight = window.visualViewport?.height || innerHeight;
  const dock = tutorialMobileDockLayout({
    buttonRects: actionButtons.map((button) => button.getBoundingClientRect()),
    hudRect: hud.getBoundingClientRect(),
    viewportWidth,
    viewportHeight,
  });
  overlayEl.style.setProperty("--tut-mobile-dock-bottom", `${dock.bottomInset}px`);
  overlayEl.style.setProperty("--tut-mobile-dock-left", `${dock.leftInset}px`);
  overlayEl.style.setProperty("--tut-mobile-dock-right", `${dock.rightInset}px`);
  overlayEl.style.setProperty("--tut-mobile-dock-max-height", `${dock.maxHeight}px`);
}

function observeMobileLayout() {
  const visualViewport = window.visualViewport;
  window.addEventListener("resize", layoutMobile);
  visualViewport?.addEventListener("resize", layoutMobile);
  visualViewport?.addEventListener("scroll", layoutMobile);
  removeMobileLayoutListeners = () => {
    window.removeEventListener("resize", layoutMobile);
    visualViewport?.removeEventListener("resize", layoutMobile);
    visualViewport?.removeEventListener("scroll", layoutMobile);
  };
  if (typeof ResizeObserver === "function") {
    mobileLayoutObserver = new ResizeObserver(layoutMobile);
    const hud = document.getElementById("mobileBattleHud");
    const actionGrid = document.querySelector(".mobile-action-grid");
    if (hud) mobileLayoutObserver.observe(hud);
    if (actionGrid) mobileLayoutObserver.observe(actionGrid);
  }
}

export function tutorialTargetContainsPoint(point, target) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  const targetX = Number(target?.x);
  const targetY = Number(target?.y);
  const radius = Number(target?.radius);
  return Number.isFinite(x)
    && Number.isFinite(y)
    && Number.isFinite(targetX)
    && Number.isFinite(targetY)
    && Number.isFinite(radius)
    && distance(x, y, targetX, targetY) <= radius;
}

function endpointInTarget(action, target) {
  return tutorialTargetContainsPoint({ x: action.endX, y: action.endY }, target);
}

export function tutorialEventStepSatisfied(stepId, progress = {}) {
  const selections = progress.selectedShips instanceof Set
    ? progress.selectedShips
    : new Set(progress.selectedShips || []);
  const battleSkills = progress.usedBattleSkills instanceof Set
    ? progress.usedBattleSkills
    : new Set(progress.usedBattleSkills || []);
  if (stepId === "scout") return Boolean(progress.scoutLaunched);
  if (stepId === "split_yuki") return Number(progress.splitLevelReached) >= 1;
  if (stepId === "yuki_skill") return selections.has("sub1") && Boolean(progress.yukiSkillCast);
  if (stepId === "split_kyon") return Number(progress.splitLevelReached) >= 2;
  if (stepId === "battle_skills") return battleSkills.has("flagship") && battleSkills.has("kyon");
  return false;
}

function currentProgress() {
  return {
    selectedShips,
    usedBattleSkills,
    scoutLaunched,
    splitLevelReached,
    yukiSkillCast,
  };
}

function advanceFromRecordedEvents() {
  const current = step();
  if (!current || !tutorialEventStepSatisfied(current.id, currentProgress())) return false;
  goto(activeIndex + 1);
  return true;
}

function allowsAction(action) {
  if (!isActive() || !action) return true;
  const id = step().id;
  const type = String(action.type || "");
  if (id === "move") {
    return action.shipKey === "main" && type === "set_route" && endpointInTarget(action, TUTORIAL_MOVE_TARGET);
  }
  if (id === "scout") return type === "launch_scout";
  if (id === "split_yuki") return type === "split" && Number(action.level) === 1;
  if (id === "yuki_skill") return type === "cast_sub_skill" && action.shipKey === "sub1";
  if (id === "split_kyon") return type === "split" && Number(action.level) === 2;
  if (id === "regroup") {
    if (type === "set_route" || type === "route_end") return endpointInTarget(action, TUTORIAL_ATTACK_TARGET);
    return type === "route_control";
  }
  if (id === "attack") return type === "set_route" || type === "route_control" || type === "route_end";
  if (id === "battle_skills") {
    return type === "set_route" || type === "route_control" || type === "route_end"
      || type === "cast_flagship_skill"
      || (type === "cast_sub_skill" && action.shipKey === "sub2");
  }
  if (id === "free") {
    return ["set_route", "route_control", "route_end", "launch_scout", "cast_flagship_skill", "cast_sub_skill"].includes(type);
  }
  return false;
}

function allowsShipSelection(shipKey) {
  if (!isActive()) return true;
  const index = activeIndex;
  if (shipKey === "main") return true;
  if (shipKey === "sub1") return index >= STEPS.findIndex((item) => item.id === "split_yuki");
  if (shipKey === "sub2") return index >= STEPS.findIndex((item) => item.id === "split_kyon");
  return false;
}

function allowsControl(control) {
  if (!isActive()) return true;
  const id = step().id;
  if (control === "mainMenu") return true;
  if (control === "fleetRoster" || control === "energy") return activeIndex >= STEPS.findIndex((item) => item.id === "energy");
  if (control === "scout") return ["scout", "free"].includes(id);
  if (control === "split1") return id === "split_yuki";
  if (control === "split2") return id === "split_kyon";
  if (control === "flagshipSkill") return id === "battle_skills" || id === "free";
  if (control === "subSkill") return id === "yuki_skill" || id === "battle_skills" || id === "free";
  if (control === "shipSelection") return activeIndex >= STEPS.findIndex((item) => item.id === "split_yuki");
  return false;
}

function onAction(action) {
  if (!isActive() || !action) return;
  const type = String(action.type || "");
  if (type === "launch_scout") scoutLaunched = true;
  if (type === "split") splitLevelReached = Math.max(splitLevelReached, Number(action.level) || 0);
  if (type === "cast_sub_skill" && action.shipKey === "sub1") yukiSkillCast = true;
  if (type === "cast_flagship_skill") usedBattleSkills.add("flagship");
  if (type === "cast_sub_skill" && action.shipKey === "sub2") usedBattleSkills.add("kyon");
  advanceFromRecordedEvents();
}

function onShipSelection(shipKey) {
  if (!isActive() || !shipKey) return;
  selectedShips.add(String(shipKey));
  advanceFromRecordedEvents();
}

function update(state) {
  if (!isActive() || !state) return;
  const own = state.teams?.A;
  if (!own?.ships) return;
  splitLevelReached = Math.max(splitLevelReached, Number(own.splitLevel) || 0);
  if (advanceFromRecordedEvents()) return;
  const id = step().id;
  if (id === "move") {
    const main = own.ships.main;
    if (main && tutorialTargetContainsPoint(main, TUTORIAL_MOVE_TARGET)) goto(activeIndex + 1);
  } else if (id === "regroup") {
    const arrived = ["main", "sub1", "sub2"].every((key) => {
      const ship = own.ships[key];
      return ship && tutorialTargetContainsPoint(ship, TUTORIAL_ATTACK_TARGET);
    });
    if (arrived) goto(activeIndex + 1);
  } else if (id === "attack") {
    const enemyDamaged = Number(state.teams?.B?.hullRatio) < 0.999;
    const friendlyProjectile = (state.projectiles || []).some((item) => item.teamSeat === "A" || item.team === "A");
    if (enemyDamaged || friendlyProjectile) goto(activeIndex + 1);
  }
}

function getIllustration() {
  return isActive() ? step().illustration || null : null;
}

function start(context = {}) {
  stop();
  ctx = context;
  activeIndex = 0;
  briefingClosed = false;
  usedBattleSkills = new Set();
  selectedShips = new Set([String(context.getSelectedShipKey?.() || "main")]);
  scoutLaunched = false;
  splitLevelReached = 0;
  yukiSkillCast = false;
  overlayEl = document.createElement("div");
  overlayEl.className = "tut-overlay tut-campaign";
  cardEl = document.createElement("div");
  cardEl.className = "tut-card ready";
  overlayEl.appendChild(cardEl);
  document.body.appendChild(overlayEl);
  observeMobileLayout();
  goto(0);
}

function stop() {
  removeMobileLayoutListeners?.();
  removeMobileLayoutListeners = null;
  mobileLayoutObserver?.disconnect();
  mobileLayoutObserver = null;
  clearHighlights();
  overlayEl?.remove();
  overlayEl = null;
  cardEl = null;
  activeIndex = -1;
  ctx = null;
  briefingClosed = false;
}

export const tutorial = {
  start,
  stop,
  update,
  onAction,
  isActive,
  getIllustration,
  allowsAction,
  allowsControl,
  allowsShipSelection,
  onShipSelection,
};
