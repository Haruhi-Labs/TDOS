// ═══════════════════════════════════════════════════════════════
// 玩法说明（路由 /guide）—— 精简版：四步开打 + 几条要点 + 分端操作。
// ═══════════════════════════════════════════════════════════════

import { startStarfield } from "./starfield.js";
import { isMobile } from "./mobile.js";

const QUICKSTART = [
  "<b>编队</b>：选 1 主舰 + 2 副舰，挑好阵营与难度即可出击。",
  "<b>下航线</b>：选中舰船下一条航线，舰队自动航行；默认三舰<b>跟随主舰</b>一起走。",
  "<b>分离副舰</b>：点「分离」才能让副舰单独走位 / 下航线——一级放副一、二级再放副二；<b>不分离，副舰只能跟着主舰</b>。",
  "<b>自动交火</b>：敌人进射程、且被你看见时<b>自动开火</b>，你专心走位、放技能。",
];
const QUICKSTART_GOAL = "歼灭对方<b>全部</b>舰船（含分离出去的副舰）即获胜。";

const SECTIONS = [
  {
    title: "视野 ≪ 射程",
    body: "看不见的敌人打不到。派<b>侦察机</b>开图、主力吊在远处打，对方看不见你就还不了手。",
  },
  {
    title: "火力看朝向",
    body: "左右<b>侧舷火力 ×1.5</b> 最猛、<b>舰尾不开火</b>；炮弹会被舰船挡——让主舰顶前面替副舰挡弹。",
  },
  {
    title: "技能与能量",
    body: "每人有旗舰技 + 分舰技，耗能、有冷却，关键时机一个技能常常翻盘；能量会自动回复。",
  },
  {
    title: "推进功率",
    body: "功率越高跑得越快，但转弯半径越大；转不过弯就调低功率。",
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
  const quickstart = QUICKSTART.map((s, i) => `<li><span class="qs-no">${i + 1}</span><span>${s}</span></li>`).join("");
  const sections = SECTIONS.map((s) => `<div class="${itemClass}"><h3>${s.title}</h3><p>${s.body}</p></div>`).join("");
  const keys = (isMobile() ? KEYS_MOBILE : KEYS_DESKTOP)
    .map(([k, v]) => `<div class="${keyClass}"><kbd>${k}</kbd><span>${v}</span></div>`)
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
        <a class="page-back" href="/">‹ 返回主菜单</a>
        <h1 class="page-title">玩法说明</h1>

        <div class="page-scroll">
          <div class="guide-quickstart">
            <div class="qs-head">四步开打</div>
            <ol class="qs-steps">${quickstart}</ol>
            <div class="qs-goal"><b>胜负</b>：${QUICKSTART_GOAL}</div>
          </div>

          <h2 class="guide-subtitle">要点</h2>
          <div class="guide-grid">${sections}</div>

          <h2 class="guide-subtitle">操作</h2>
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
        <h1 class="mpage-title">玩法说明</h1>
      </div>
      <div class="mpage-body">
        <div class="guide-quickstart">
          <div class="qs-head">四步开打</div>
          <ol class="qs-steps">${quickstart}</ol>
          <div class="qs-goal"><b>胜负</b>：${QUICKSTART_GOAL}</div>
        </div>
        ${sections}
        <h2 class="m-guide-sub">操作</h2>
        ${keys}
      </div>
    </section>
  `;
}

export function mount(root) {
  root.innerHTML = isMobile() ? mobileTemplate() : template();
  const ac = new AbortController();
  startStarfield(root.querySelector(".page-stars"), ac.signal);
  return () => ac.abort();
}
