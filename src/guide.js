// ═══════════════════════════════════════════════════════════════
// 玩法说明（路由 /guide）—— 基础玩法与星域争夺 3v3 共用同一说明页。
// ═══════════════════════════════════════════════════════════════

import { startStarfield } from "./starfield.js";
import { isMobile } from "./mobile.js";
import { setTutorialSeen } from "./profile.js";
import { t } from "./i18n.js";
import { mountRouteFluidBackdrop } from "./effects/fluid-reveal/routeBackdrop.js";
import { stellar3v3GuideHTML } from "./stellar3v3-rules.js";

const QUICKSTART = [
  "<b>编队</b>：选 1 名角色担任<b>主舰</b>、2 名担任<b>副舰</b>；同一角色在主舰与副舰位置上技能不同。",
  "<b>移动与开火</b>：<b>右键</b>创建航线目标，可拖拽<b>控制点</b>微调。舰队会自动攻击<b>视野内距离最近</b>的敌人——利用这一点来集火与分担伤害。",
  "<b>分离副舰</b>：副舰的技能<b>分离后才能释放</b>；分离后每个舰队拥有独立视野、<b>总计更强的火力</b>、更灵活的战术安排，但也更<b>脆弱、无法共同承伤</b>，更容易被各个击破。",
  "<b>战区与侦察</b>：<b>左键</b>在 3×3 地图中选择战区并释放<b>侦察机</b>；侦察机可获取敌方动向并吸引火力。",
];
const QUICKSTART_GOAL = "歼灭对方<b>全部</b>舰船（包括主舰与副舰）即获胜。";

const SECTIONS = [
  {
    title: "视野远小于射程",
    body: "<b>情报是获胜的关键</b>——看不见的敌人打不到，也可吊在敌人视野外输出。",
  },
  {
    title: "火力与朝向有关",
    body: "<b>侧舷火力 ×1.5</b>、<b>船尾不开火</b>；从敌方船尾命中造成 <b>×1.2 尾击</b>伤害。",
  },
  {
    title: "技能、推进与能量",
    body: "<b>提高推进功率</b>与<b>释放技能</b>都会消耗能量；能量会自动回复。",
  },
  {
    title: "碰撞与阻挡",
    body: "舰船拥有<b>碰撞体积</b>，相撞时会<b>减速</b>；舰船会挡住中途的子弹，转而替后方承受伤害。",
  },
];

const KEYS_DESKTOP = [
  ["右键单击战场", "设航线落点"],
  ["左键拖 控制点 / 端点", "调弯度 / 改落点"],
  ["左键单击空白", "选战区"],
  ["1 / 2 / 3", "切换主舰 / 副一 / 副二"],
  ["C / V", "旗舰技 / 分舰技"],
  ["X / Z", "侦察 / 自动侦察"],
  ["B · 滚轮", "急刹 · 缩放镜头"],
];
const KEYS_MOBILE = [
  ["点战场", "给选中舰下航线"],
  ["点己方舰船", "切换控制的舰"],
  ["点右上小地图", "选战区 / 移镜头"],
  ["旗舰技 / 分舰技", "放技能"],
  ["侦察 / 自动侦察", "侦察机 / 持续侦察"],
  ["分离1 / 分离2", "分离副一 / 副二"],
];

function buildHTML(itemClass, keyClass) {
  const quickstart = QUICKSTART.map((s, i) => `<li><span class="qs-no">${i + 1}</span><span>${t(s)}</span></li>`).join("");
  const sections = SECTIONS.map((s) => `<div class="${itemClass}"><h3>${t(s.title)}</h3><p>${t(s.body)}</p></div>`).join("");
  const keys = (isMobile() ? KEYS_MOBILE : KEYS_DESKTOP)
    .map(([k, v]) => `<div class="${keyClass}"><kbd>${t(k)}</kbd><span>${t(v)}</span></div>`)
    .join("");
  return { quickstart, sections, keys };
}

function baseGuideHTML(itemClass, keyClass, subtitleClass) {
  const { quickstart, sections, keys } = buildHTML(itemClass, keyClass);
  return `
    <div class="guide-quickstart">
      <div class="qs-head">${t("快速开始")}</div>
      <ol class="qs-steps">${quickstart}</ol>
      <div class="qs-goal"><b>${t("胜负")}</b>：${t(QUICKSTART_GOAL)}</div>
      <a class="guide-replay" href="/play" data-replay-tutorial>${t("▶ 重看新手教程")}</a>
    </div>
    <h2 class="${subtitleClass}">${t("要点")}</h2>
    <div class="guide-grid">${sections}</div>
    <h2 class="${subtitleClass}">${t("操作")}</h2>
    <div class="guide-keys">${keys}</div>
  `;
}

function guideTabsHTML(activeTab) {
  return `
    <div class="guide-tabs" role="tablist" aria-label="${t("玩法说明")}">
      <button type="button" class="${activeTab === "base" ? "active" : ""}" data-guide-tab="base" role="tab" aria-selected="${activeTab === "base"}">${t("基础玩法")}</button>
      <button type="button" class="${activeTab === "stellar3v3" ? "active" : ""}" data-guide-tab="stellar3v3" role="tab" aria-selected="${activeTab === "stellar3v3"}">${t("星域争夺 3v3")}</button>
    </div>
  `;
}

function tabPanelHTML(tab, activeTab, content, className = "") {
  return `<section class="guide-tab-panel ${className}" data-guide-panel="${tab}"${tab === activeTab ? "" : " hidden"}>${content}</section>`;
}

function template(activeTab) {
  return `
    <section class="page-stage">
      <canvas class="page-stars" aria-hidden="true"></canvas>
      <div class="page-bg" aria-hidden="true"></div>
      <div class="page-frame page-frame-wide">
        <a class="page-back" href="/">${t("‹ 返回主菜单")}</a>
        <h1 class="page-title">${t("玩法说明")}</h1>
        <div class="page-scroll guide-scroll">
          ${guideTabsHTML(activeTab)}
          ${tabPanelHTML("base", activeTab, baseGuideHTML("guide-item", "guide-key", "guide-subtitle"))}
          ${tabPanelHTML("stellar3v3", activeTab, stellar3v3GuideHTML(), "stellar-rules-scroll")}
        </div>
      </div>
    </section>
  `;
}

function mobileTemplate(activeTab) {
  return `
    <section class="mpage">
      <canvas class="page-stars" aria-hidden="true"></canvas>
      <div class="mpage-top">
        <a class="mpage-back" href="/">‹</a>
        <h1 class="mpage-title">${t("玩法说明")}</h1>
      </div>
      <div class="mpage-body guide-mobile-body">
        ${guideTabsHTML(activeTab)}
        ${tabPanelHTML("base", activeTab, baseGuideHTML("m-guide-item", "m-guide-key", "m-guide-sub"))}
        ${tabPanelHTML("stellar3v3", activeTab, stellar3v3GuideHTML(), "stellar-rules-scroll")}
      </div>
    </section>
  `;
}

function setActiveGuideTab(root, tab) {
  const activeTab = tab === "stellar3v3" ? "stellar3v3" : "base";
  for (const button of root.querySelectorAll("[data-guide-tab]")) {
    const active = button.dataset.guideTab === activeTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
  for (const panel of root.querySelectorAll("[data-guide-panel]")) {
    panel.hidden = panel.dataset.guidePanel !== activeTab;
  }
}

export function mount(root, { initialTab } = {}) {
  const activeTab = initialTab === "stellar3v3" ? "stellar3v3" : "base";
  root.innerHTML = isMobile() ? mobileTemplate(activeTab) : template(activeTab);
  const ac = new AbortController();
  const starfieldAc = new AbortController();
  startStarfield(root.querySelector(".page-stars"), starfieldAc.signal);
  const fluidBackdrop = mountRouteFluidBackdrop(root.querySelector(".page-stage, .mpage"), {
    logLabel: "Guide fluid backdrop",
    onReady: () => starfieldAc.abort(),
  });
  for (const button of root.querySelectorAll("[data-guide-tab]")) {
    button.addEventListener("click", () => setActiveGuideTab(root, button.dataset.guideTab), { signal: ac.signal });
  }
  root.querySelector("[data-replay-tutorial]")?.addEventListener(
    "click",
    () => {
      setTutorialSeen(false);
    },
    { signal: ac.signal },
  );
  return () => {
    fluidBackdrop.destroy();
    starfieldAc.abort();
    ac.abort();
  };
}
