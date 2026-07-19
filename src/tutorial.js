// ═══════════════════════════════════════════════════════════════

import { t } from "./i18n.js";
// 引导式新手教程 —— 玩家第一次进战场时自动触发的分步引导。
// 设计:全程实时不暂停;对话卡是非阻挡 overlay(战场点击穿透,只有卡片本身吃事件),
//       逐步引导真实操作(下航线/分离/放技能),并配合画布示意图讲机制(射界/射程·视野)。
// 与 solo.js 的接口:start(ctx) / onAction(action) / getIllustration() / isActive() / stop()。
// ctx = { isMobile():boolean, onFinish():void }。illustration 由 solo.js 渲染层取用。
// ═══════════════════════════════════════════════════════════════

// 每步:
//  title/body —— 文案(body 可为 (mobile)=>string,按端给不同提示);
//  advance —— 'button'(显示「继续/开始战斗」按钮) 或 { action } (检测到该类玩家动作才推进);
//  illustration —— 'visionRange' | 'fireArc',交给画布画示意图;
//  highlight —— { desktop, mobile } 控件 id,对应步骤脉冲高亮该按钮;
//  hint —— 动作门控步骤的等待提示。
const STEPS = [
  {
    id: "welcome",
    title: "欢迎,指挥官",
    body: "用几步带你上手。<b>目标:歼灭对方全部舰船</b>(含主舰与副舰)即获胜。",
    advance: "button",
  },
  {
    id: "route",
    title: "第一步 · 移动与开火",
    body: (info) =>
      info.mobile
        ? "点战场<b>空地</b>创建航线目标,舰队自动航行(默认三舰跟随主舰)。舰队会<b>自动攻击视野内最近</b>的敌人——靠走位来集火、分担伤害。"
        : "在战场空地<b>右键</b>创建航线目标(可拖<b>控制点</b>微调曲线)。舰队会<b>自动攻击视野内最近</b>的敌人——靠走位来集火、分担伤害。",
    advance: { action: "set_route" },
    hint: "↳ 下出一条航线即可继续",
  },
  {
    id: "visionRange",
    title: "机制 · 视野远小于射程",
    body:
      "旗舰周围<b>青色圈是视野</b>(看得见的范围),<b>金色圈是射程</b>(能打到的范围)。" +
      "射程远大于视野——只有“看得见”的敌人才会自动开火,所以<b>情报是关键</b>:可吊在敌人视野外输出。",
    illustration: "visionRange",
    advance: "button",
  },
  {
    id: "scout",
    title: "机制 · 侦察与战区",
    body: (info) =>
      info.mobile
        ? "看不见的地方派<b>侦察机</b>去开图:点右上<b>小地图选一个战区</b>,再点<b>「侦察」</b>放出侦察机——它能获取敌方动向、还能吸引火力。"
        : "看不见的地方派<b>侦察机</b>去开图:<b>左键</b>在 3×3 地图选一个战区,再点<b>「侦察」</b>(或按 X)放出侦察机——它能获取敌方动向、还能吸引火力。",
    advance: { action: "launch_scout" },
    hint: "↳ 放出一架侦察机即可继续",
    highlight: { desktop: "scoutBtn", mobile: "mobileScoutBtn" },
  },
  {
    id: "fireArc",
    title: "机制 · 火力与朝向",
    body: (info) =>
      info.uniformFire
        ? "你的旗舰(<b>阿虚</b>)火力<b>均匀</b>——各方向射速均为 <b>×1.5</b>,没有侧舷差异、船尾也照常开火(看周围的均匀光环)。" +
          "但<b>尾击</b>对谁都通用:从<b>敌方船尾</b>命中仍打 <b>×1.2</b>,绕到敌后更划算。"
        : "看旗舰周围的扇形:<b>侧舷火力最猛(×1.5)</b>,正前 ×1,<b>船尾不开火(×0)</b>。" +
          "而且从<b>敌方船尾</b>命中会打出 <b>×1.2 尾击</b>——侧面对敌、绕到敌后最划算。",
    illustration: "fireArc",
    advance: "button",
  },
  {
    id: "autofire",
    title: "机制 · 自动交火",
    body:
      "敌人<b>进入射程且被你看见</b>时,舰船<b>自动攻击最近</b>的目标。" +
      "你只管走位放技能——靠站位决定<b>集火</b>还是<b>分担伤害</b>。",
    advance: "button",
  },
  {
    id: "split",
    title: "第二步 · 分离副舰",
    body:
      "副舰的技能<b>分离后才能放</b>。点<b>「一级分离」</b>让副一独立:分离后各队有独立视野、" +
      "<b>火力更强(开火 ×1.2)</b>、走位更灵活;但也更<b>脆弱、无法共同承伤</b>,易被各个击破。",
    advance: { action: "split" },
    hint: "↳ 点「一级分离」即可继续",
    highlight: { desktop: "splitOneBtn", mobile: "mobileSplitOneBtn" },
  },
  {
    id: "skill",
    title: "第三步 · 释放技能",
    // 旗舰技被动时,引导改用分舰技(选中分离出的副舰再放),避免高亮到禁用的旗舰技按钮造成冲突
    body: (info) =>
      info.flagshipPassive
        ? "你的旗舰技是<b>被动技</b>(自动生效、无需手动)。改放分舰技——<b>选中分离出的副一</b>,点<b>「分舰技」</b>释放它的主动技。"
        : "选中一艘舰,点<b>「旗舰技」</b>释放它的招牌技;有的技能需要在战场上点一个落点。能量回满即可再放——关键时机一个技能常常翻盘。",
    advance: { action: "cast_skill" },
    hint: "↳ 放出一个技能即可完成",
    highlight: (info) =>
      info.flagshipPassive
        ? { desktop: "subSkillBtn", mobile: "mobileSubSkillBtn" }
        : { desktop: "flagshipBtn", mobile: "mobileFlagshipBtn" },
  },
];

let activeIndex = -1;
let overlayEl = null;
let cardEl = null;
let ctx = null;
let highlightedEl = null;

function isActive() {
  return activeIndex >= 0 && activeIndex < STEPS.length;
}

function getIllustration() {
  return isActive() ? STEPS[activeIndex].illustration || null : null;
}

function mobileMode() {
  return !!(ctx && typeof ctx.isMobile === "function" && ctx.isMobile());
}

// 当前步可用的运行态信息(端、旗舰技是否被动),供 body / highlight 按情况取用。
function stepInfo() {
  return {
    mobile: mobileMode(),
    flagshipPassive: !!(ctx && typeof ctx.flagshipPassive === "function" && ctx.flagshipPassive()),
    uniformFire: !!(ctx && typeof ctx.uniformFire === "function" && ctx.uniformFire()),
  };
}

function clearHighlight() {
  if (highlightedEl) {
    highlightedEl.classList.remove("tut-highlight");
    highlightedEl = null;
  }
}

function applyHighlight(step, info) {
  clearHighlight();
  if (!step.highlight) return;
  const hl = typeof step.highlight === "function" ? step.highlight(info) : step.highlight;
  if (!hl) return;
  const id = info.mobile ? hl.mobile : hl.desktop;
  const el = id && document.getElementById(id);
  if (el) {
    el.classList.add("tut-highlight");
    highlightedEl = el;
  }
}

function renderCard(step, info) {
  const total = STEPS.length;
  const num = activeIndex + 1;
  const rawBody = typeof step.body === "function" ? step.body(info) : step.body;
  const bodyText = t(rawBody);
  const isButton = step.advance === "button";
  const btnLabel = isButton ? (activeIndex === total - 1 ? t("开始战斗") : t("继续")) : "";
  cardEl.innerHTML =
    `<div class="tut-step">${t("第 {num} / {total} 步", { num, total })}</div>` +
    `<h3 class="tut-title">${t(step.title)}</h3>` +
    `<p class="tut-body">${bodyText}</p>` +
    (step.hint ? `<p class="tut-wait">${t(step.hint)}</p>` : "") +
    `<div class="tut-actions">` +
    (btnLabel ? `<button type="button" class="tut-next">${btnLabel}</button>` : "") +
    `<button type="button" class="tut-skip">${t("跳过教程")}</button>` +
    `</div>`;
  const nextBtn = cardEl.querySelector(".tut-next");
  if (nextBtn) nextBtn.addEventListener("click", () => goto(activeIndex + 1));
  const skipBtn = cardEl.querySelector(".tut-skip");
  if (skipBtn) skipBtn.addEventListener("click", () => finish());
}

function goto(index) {
  activeIndex = index;
  if (!isActive()) {
    finish();
    return;
  }
  const step = STEPS[activeIndex];
  const info = stepInfo();
  renderCard(step, info);
  applyHighlight(step, info);
  layoutMobile();
}

// 移动端:把教程卡压到底部操作面板上方、并按当前高亮按钮的位置自动偏到另一侧,尽量不挡视野/按钮。
function layoutMobile() {
  if (!overlayEl) return;
  const mobile = mobileMode();
  overlayEl.classList.toggle("tut-mobile", mobile);
  overlayEl.classList.remove("tut-bias-left", "tut-bias-right");
  if (!mobile) return;
  // 卡片底边坐到底部 HUD 顶沿之上(测 HUD 实际高度);非底栏布局(横屏)退回小留白
  const hud = document.getElementById("mobileBattleHud");
  const vh = window.innerHeight || 800;
  let clear = 12;
  if (hud) {
    const top = hud.getBoundingClientRect().top;
    if (top > vh * 0.4) clear = Math.round(vh - top); // 确认是底栏才贴它上沿
  }
  overlayEl.style.setProperty("--tut-hud-clear", `${clear}px`);
  // 自动避让:当前步高亮了某个按钮,就把卡片偏到按钮所在的另一半,留出按钮
  if (highlightedEl) {
    const r = highlightedEl.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    overlayEl.classList.add(cx < (window.innerWidth || 400) / 2 ? "tut-bias-right" : "tut-bias-left");
  }
}

function start(context) {
  ctx = context || {};
  if (!overlayEl) {
    overlayEl = document.createElement("div");
    overlayEl.className = "tut-overlay";
    cardEl = document.createElement("div");
    cardEl.className = "tut-card";
    overlayEl.appendChild(cardEl);
    document.body.appendChild(overlayEl);
  }
  goto(0);
}

// solo.js 在每次成功 applyAction 后调用:动作门控步骤检测到对应动作即推进。
function onAction(action) {
  if (!isActive() || !action) return;
  const step = STEPS[activeIndex];
  if (!step.advance || step.advance === "button") return;
  const want = step.advance.action;
  const type = action.type;
  let match = false;
  if (want === "set_route") {
    match = type === "set_route";
  } else if (want === "split") {
    match = type === "split";
  } else if (want === "launch_scout") {
    match = type === "launch_scout";
  } else if (want === "cast_skill") {
    // 旗舰技/分舰技/侦察任一都算“用了一个能力”,避免被动技或无可放时卡死
    match = type === "cast_flagship_skill" || type === "cast_sub_skill" || type === "launch_scout";
  }
  if (match) goto(activeIndex + 1);
}

function teardown() {
  clearHighlight();
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
    cardEl = null;
  }
  activeIndex = -1;
}

// 走完最后一步或点「跳过教程」:拆掉 UI 并写“已看过”标记。
function finish() {
  const wasActive = activeIndex >= 0 || overlayEl != null;
  teardown();
  if (wasActive && ctx && typeof ctx.onFinish === "function") ctx.onFinish();
}

// 模块卸载时静默清理:不写标记(没走完不算看过,下次仍会触发)。
function stop() {
  teardown();
}

export const tutorial = { start, onAction, getIllustration, isActive, stop };
