// ═══════════════════════════════════════════════════════════════
// 玩法说明（路由 /guide）—— 精简版：四步开打 + 几条要点 + 分端操作。
// ═══════════════════════════════════════════════════════════════

import { startStarfield } from "./starfield.js";
import { isMobile } from "./mobile.js";
import { setTutorialSeen } from "./profile.js";
import { t } from "./i18n.js";

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

function template() {
  const { quickstart, sections, keys } = buildHTML("guide-item", "guide-key");
  return `
    <section class="page-stage">
      <canvas class="page-stars" aria-hidden="true"></canvas>
      <div class="page-bg" aria-hidden="true"></div>
      <div class="page-frame page-frame-wide">
        <a class="page-back" href="/">${t("‹ 返回主菜单")}</a>
        <h1 class="page-title">${t("玩法说明")}</h1>

        <div class="page-scroll">
          <div class="guide-quickstart">
            <div class="qs-head">${t("快速开始")}</div>
            <ol class="qs-steps">${quickstart}</ol>
            <div class="qs-goal"><b>${t("胜负")}</b>：${t(QUICKSTART_GOAL)}</div>
            <a class="guide-replay" href="/play" data-replay-tutorial>${t("▶ 重看新手教程")}</a>
          </div>

          <h2 class="guide-subtitle">${t("要点")}</h2>
          <div class="guide-grid">${sections}</div>

          <h2 class="guide-subtitle">${t("操作")}</h2>
          <div class="guide-keys">${keys}</div>
        </div>
      </div>
    </section>
  `;
}

// 移动端专属：顶栏固定 + 原生可滚
function mobileTemplate() {
  const { quickstart, sections, keys } = buildHTML("m-guide-item", "m-guide-key");
  return `
    <section class="mpage">
      <canvas class="page-stars" aria-hidden="true"></canvas>
      <div class="mpage-top">
        <a class="mpage-back" href="/">‹</a>
        <h1 class="mpage-title">${t("玩法说明")}</h1>
      </div>
      <div class="mpage-body">
        <div class="guide-quickstart">
          <div class="qs-head">${t("快速开始")}</div>
          <ol class="qs-steps">${quickstart}</ol>
          <div class="qs-goal"><b>${t("胜负")}</b>：${t(QUICKSTART_GOAL)}</div>
          <a class="guide-replay" href="/play" data-replay-tutorial>${t("▶ 重看新手教程")}</a>
        </div>
        ${sections}
        <h2 class="m-guide-sub">${t("操作")}</h2>
        ${keys}
      </div>
    </section>
  `;
}

export function mount(root) {
  root.innerHTML = isMobile() ? mobileTemplate() : template();
  const ac = new AbortController();
  startStarfield(root.querySelector(".page-stars"), ac.signal);
  // 「重看新手教程」:清掉已看过标记,再让路由跳到 /play(下次进战场即重新触发引导)
  const replay = root.querySelector("[data-replay-tutorial]");
  if (replay) {
    replay.addEventListener(
      "click",
      () => {
        setTutorialSeen(false);
      },
      { signal: ac.signal },
    );
  }
  return () => ac.abort();
}
