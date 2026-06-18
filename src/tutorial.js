// ═══════════════════════════════════════════════════════════════
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
    body: "用几步带你上手。<b>目标:歼灭对方全部舰船</b>(含分离出去的副舰)即获胜。",
    advance: "button",
  },
  {
    id: "route",
    title: "第一步 · 下航线",
    body: (mobile) =>
      mobile
        ? "点一下战场上的<b>空地</b>,给旗舰下一条航线——舰队会沿曲线自动航行,默认三舰跟随主舰。"
        : "在战场空地上<b>点右键</b>,给旗舰下一条航线——舰队会沿曲线自动航行,默认三舰跟随主舰。",
    advance: { action: "set_route" },
    hint: "↳ 下出一条航线即可继续",
  },
  {
    id: "visionRange",
    title: "机制 · 视野 ≪ 射程",
    body:
      "旗舰周围<b>青色圈是视野</b>(看得见的范围),<b>金色圈是射程</b>(能打到的范围)。" +
      "射程远大于视野——只有“看得见”的敌人才会自动开火,所以你可以吊在敌人视野外输出。",
    illustration: "visionRange",
    advance: "button",
  },
  {
    id: "fireArc",
    title: "机制 · 火力看朝向",
    body:
      "看旗舰周围的扇形:<b>侧舷(左右两侧)火力最猛(1.5×)</b>,正前为 1×," +
      "<b>正后方打不到(0×)</b>。走位时把侧面对敌最划算。",
    illustration: "fireArc",
    advance: "button",
  },
  {
    id: "autofire",
    title: "机制 · 自动交火",
    body:
      "敌人<b>进入射程且被你看见</b>时,舰船会<b>自动开火</b>,默认锁定最近的目标。" +
      "你只管走位、放技能,开火交给舰队。",
    advance: "button",
  },
  {
    id: "split",
    title: "第二步 · 分离副舰",
    body:
      "副舰默认跟着旗舰走。点<b>「一级分离」</b>让副一独立行动," +
      "之后就能单独选中它、给它下航线、放它的技能。",
    advance: { action: "split" },
    hint: "↳ 点「一级分离」即可继续",
    highlight: { desktop: "splitOneBtn", mobile: "mobileSplitOneBtn" },
  },
  {
    id: "skill",
    title: "第三步 · 释放技能",
    body:
      "选中一艘舰,点<b>「技能」</b>释放它的招牌技;有的技能需要在战场上点一个落点。" +
      "能量回满即可再放——关键时机一个技能常常翻盘。",
    advance: { action: "cast_skill" },
    hint: "↳ 放出一个技能即可完成",
    highlight: { desktop: "flagshipBtn", mobile: "mobileFlagshipBtn" },
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

function clearHighlight() {
  if (highlightedEl) {
    highlightedEl.classList.remove("tut-highlight");
    highlightedEl = null;
  }
}

function applyHighlight(step) {
  clearHighlight();
  if (!step.highlight) return;
  const id = mobileMode() ? step.highlight.mobile : step.highlight.desktop;
  const el = id && document.getElementById(id);
  if (el) {
    el.classList.add("tut-highlight");
    highlightedEl = el;
  }
}

function renderCard(step) {
  const total = STEPS.length;
  const num = activeIndex + 1;
  const bodyText = typeof step.body === "function" ? step.body(mobileMode()) : step.body;
  const isButton = step.advance === "button";
  const btnLabel = isButton ? (activeIndex === total - 1 ? "开始战斗" : "继续") : "";
  cardEl.innerHTML =
    `<div class="tut-step">第 ${num} / ${total} 步</div>` +
    `<h3 class="tut-title">${step.title}</h3>` +
    `<p class="tut-body">${bodyText}</p>` +
    (step.hint ? `<p class="tut-wait">${step.hint}</p>` : "") +
    `<div class="tut-actions">` +
    (btnLabel ? `<button type="button" class="tut-next">${btnLabel}</button>` : "") +
    `<button type="button" class="tut-skip">跳过教程</button>` +
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
  overlayEl.classList.toggle("tut-mobile", mobileMode());
  renderCard(STEPS[activeIndex]);
  applyHighlight(STEPS[activeIndex]);
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
