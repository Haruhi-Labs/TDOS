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
      ? "点击战场，为舰队创建一条前往<b>2号战区中央</b>的航线。教程暂时只接受落在标记区域内的航线。"
      : "在战场上<b>右键单击</b>，为舰队创建一条前往<b>2号战区中央</b>的航线。教程暂时只接受落在标记区域内的航线。",
    wait: "将舰队移动到目标区域",
    illustration: "moveTarget",
  },
  {
    id: "vision",
    phase: 2,
    title: "视野范围",
    body: "舰船周围的<b>青色圆环</b>是视野。敌人只有进入任意友方单位的视野，才能成为真实目标。",
    button: "查看射程",
    illustration: "vision",
    callout: "视野决定你能否发现目标",
  },
  {
    id: "range",
    phase: 2,
    title: "武器射程",
    body: "舰船周围的<b>金色圆环</b>是射程。射程明显大于视野，因此侦察和情报往往比盲目前进更重要。",
    button: "继续",
    illustration: "range",
    callout: "看得见，才打得到",
  },
  {
    id: "scout",
    phase: 3,
    title: "派出侦察机",
    body: "侦察机拥有自己的视野。现在已解锁<b>侦察</b>：向2号战区派出一架侦察机，观察它扩展出的情报范围。",
    wait: "派出一架侦察机",
    illustration: "scoutVision",
    highlight: ["scoutBtn", "mobileScoutBtn"],
  },
  {
    id: "energy",
    phase: 3,
    title: "能量与舰况",
    body: "几乎所有操作都会消耗能量，降低航速可更快恢复。教程中推进档位已锁定。全舰队状态栏会分别显示舰体与能量，请随时留意。",
    button: "继续",
    callout: "能量并非越快越好",
  },
  {
    id: "split_yuki",
    phase: 4,
    title: "一级分离 · 长门有希",
    body: "解锁<b>一级分离</b>，让有希独立行动。她擅长侦察与支援；春日旗舰则更偏重正面火力。分离能增加战术自由，但<b>不可逆</b>，也会失去编队共同承伤。",
    wait: "执行一级分离",
    highlight: ["splitOneBtn", "mobileSplitOneBtn"],
  },
  {
    id: "split_explain",
    phase: 4,
    title: "独立舰队",
    body: "有希现在拥有独立的航线、舰况和技能。切换舰船后，下达的命令只会作用于当前舰队。",
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
    body: "侦察机在<b>3号战区中下方</b>发现了训练舰队。地图上的标记只是情报提示；真实交火仍以单位视野为准。",
    button: "继续",
    illustration: "enemyRegion",
    callout: "目标位于3号战区中下方",
  },
  {
    id: "split_kyon",
    phase: 5,
    title: "二级分离 · 阿虚",
    body: "现在解锁<b>二级分离</b>。阿虚也将成为独立舰队；三支舰队的航线、状态和技能互不共用。",
    wait: "执行二级分离",
    highlight: ["splitTwoBtn", "mobileSplitTwoBtn"],
  },
  {
    id: "regroup",
    phase: 5,
    title: "三舰协同机动",
    body: "分别选择春日、有希和阿虚，为三支舰队各自设置航线，移动到<b>3号战区中下方</b>的集结区域。",
    wait: "让三支舰队全部抵达标记区域",
    illustration: "attackTarget",
  },
  {
    id: "attack",
    phase: 6,
    title: "自动交火与朝向",
    body: "进入视野与射程后，舰队会自动攻击最近的敌人。多数舰船<b>侧舷射速 ×1.5</b>、正面 ×1、船尾不开火；用航线控制朝向。",
    wait: "等待任意友方舰船首次开火",
    illustration: "fireArc",
  },
  {
    id: "battle_skills",
    phase: 6,
    title: "旗舰技与分舰技",
    body: "先发动春日的<b>旗舰技能</b>，再选择阿虚并发动他的<b>分舰技能</b>。旗舰技可直接发动；分舰技必须先选中对应舰队。",
    wait: "发动春日旗舰技与阿虚分舰技",
    highlight: ["flagshipBtn", "mobileFlagshipBtn", "subSkillBtn", "mobileSubSkillBtn"],
  },
  {
    id: "free",
    phase: 7,
    title: "自由作战",
    body: "训练舰队即将开始移动、攻击和侦察。你的舰船在本关会锁定于<b>至少1/4舰体</b>。现在自由控制三支舰队，歼灭全部敌舰即可获胜。",
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
      <div class="tut-step">${t("教学阶段 {phase} / 7", { phase: current.phase })}</div>
      <h3 class="tut-title">${t(current.title)}</h3>
      <p class="tut-body">${t(rawBody)}</p>
      ${current.callout ? `<p class="tut-callout">${t(current.callout)}</p>` : ""}
      ${current.wait ? `<p class="tut-wait">↳ ${t(current.wait)}</p>` : ""}
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

function layoutMobile() {
  if (!overlayEl) return;
  overlayEl.classList.toggle("tut-mobile", isMobile());
  if (isMobile()) {
    const hud = document.getElementById("mobileBattleHud");
    const top = hud?.getBoundingClientRect().top || innerHeight;
    overlayEl.style.setProperty("--tut-hud-clear", `${Math.max(12, innerHeight - top)}px`);
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
  goto(0);
}

function stop() {
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
