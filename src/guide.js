// ═══════════════════════════════════════════════════════════════
// 玩法说明（路由 /guide）
// 目标：实用、易上手。先「四步开打」给最小可玩集，再分要点 + 分端操作 + 贴士。
// ═══════════════════════════════════════════════════════════════

import { startStarfield } from "./starfield.js";
import { isMobile } from "./mobile.js";

// 四步开打：新手只看这块就能开局
const QUICKSTART = [
  "<b>编队出击</b>：从 7 名团员里选 1 主舰 + 2 副舰（舰体、机动、技能各不同），挑好阵营与难度即可出击。",
  "<b>下达航线</b>：选中舰船给它指一条航线，舰队就自动航行过去。默认三舰<b>编队跟随主舰</b>一起走——此时只有主舰能单独下航线。",
  "<b>分离副舰（核心）</b>：想让副舰单独走位 / 包抄，必须先点「分离」把它放出来——一级分离放<b>副一</b>、二级分离再放<b>副二</b>；<b>不分离，副舰就不能单独下航线</b>。放出后选中副舰，再给它自己的航线。",
  "<b>自动交火</b>：敌人进射程、且被你任一单位看见时，舰炮<b>自动开火</b>——你专心走位、放技能就好。",
];
const QUICKSTART_GOAL = "击毁对方<b>全部</b>舰船（含分离出去的副舰）即获胜。";

// 打法要点（按"先理解什么最有用"排序）
const SECTIONS = [
  {
    title: "视野 ≪ 射程，情报为王",
    body: "你的视野范围<b>远小于</b>攻击射程：看不见的敌人打不到。但只要队里<b>任一单位（含侦察机）</b>看得见，全队就能向它开火。所以——先开图，再输出。",
  },
  {
    title: "火力看朝向",
    body: "炮火集中在两侧：<b>左右侧舷火力 ×1.5</b> 最猛，正前方正常，<b>正后方（舰尾）完全不开火</b>。用侧舷蹭敌人，别把屁股对着人。",
  },
  {
    title: "炮弹能被挡",
    body: "子弹会被舰船挡下、由它替队友吃伤害。让<b>厚血主舰顶在前面</b>替脆皮副舰挡弹，是最常用的保命打法。",
  },
  {
    title: "侦察开图",
    body: "派<b>侦察机</b>飞进目标战区拉开视野（战区比侦察视野大，它会直飞过去覆盖）；也可开<b>自动侦察</b>持续盯一区。“侦察机开图 + 主力吊在视野边缘打”，能打到对方却挨不到打。",
  },
  {
    title: "推进功率：快 vs 灵活",
    body: "功率越高跑得越快，但<b>转弯半径越大</b>、更难急转；功率低则更灵活。转不过弯，就把功率调低。",
  },
  {
    title: "技能定胜负",
    body: "每名角色有<b>旗舰技 + 分舰技</b>，消耗能量、有冷却，分主动 / 被动 / 指向点 / 指向战区。能量会自动回复，关键时机一个技能常常直接翻盘。",
  },
  {
    title: "分离副舰",
    body: "<b>一级分离</b>放出副一、<b>二级分离</b>再放出副二，脱队后各自独立走位：转向更灵活、能量各自结算。编队一起走时，航速取队内<b>最慢</b>的那艘。适合包抄、逼对方分火、单独偷点。",
  },
  {
    title: "难度（仅单人）",
    body: "简单 / 普通 / 困难 / 极限——只调 AI 的<b>反应快慢</b>（多久注意到你、多快跟上你的走位），<b>不改</b>它的火力或血量。你越是不规律地机动，低难度越好打。",
  },
];

// 操作：分端展示——桌面看鼠标/键盘，移动看触控
const KEYS_DESKTOP = [
  ["右键单击战场", "设定航线落点（舰队前往）"],
  ["左键拖 控制点 / 端点", "调航线弯度 / 改落点"],
  ["左键单击空白", "选择战区"],
  ["1 / 2 / 3 · Tab", "切换主舰 / 副一 / 副二"],
  ["W A S D · Enter", "选战区 · 选中舰驶向该战区"],
  ["推进滑块", "调推进功率"],
  ["C / V", "旗舰技 / 分舰技"],
  ["X / Z", "派侦察机 / 自动侦察开关"],
  ["B", "急刹（立刻停下）"],
  ["滚轮 · + / − / 0", "缩放 / 复位镜头"],
  ["空格", "暂停"],
];
const KEYS_MOBILE = [
  ["点战场", "给选中舰下航线（前往落点）"],
  ["点己方舰船", "切换控制的舰"],
  ["点右上小地图", "选战区 / 移动镜头"],
  ["推进按钮", "调推进功率"],
  ["旗舰技 / 分舰技", "放技能"],
  ["侦察 / 自动侦察", "派侦察机 / 持续侦察"],
  ["分离1 / 分离2", "副舰一级 / 二级分离"],
  ["急刹", "立刻停下"],
  ["缩小 / 放大 / 跟随", "镜头缩放 / 跟随舰船"],
];

// 上手贴士
const TIPS = [
  "开局先派侦察机或开自动侦察，别在黑暗里乱撞。",
  "拿侧舷对敌、别让舰尾朝向对方；主舰顶在前面替副舰挡弹。",
  "急刹能立刻停下，用来调朝向、拉开距离、躲走位。",
  "副舰分离去包抄，逼对方分散火力。",
  "新手先打简单 / 普通，熟了再上困难 / 极限。",
];

function buildHTML(itemClass, keyClass, tipClass) {
  const quickstart = QUICKSTART.map((s, i) => `<li><span class="qs-no">${i + 1}</span><span>${s}</span></li>`).join("");
  const sections = SECTIONS.map((s) => `<div class="${itemClass}"><h3>${s.title}</h3><p>${s.body}</p></div>`).join("");
  const keys = (isMobile() ? KEYS_MOBILE : KEYS_DESKTOP)
    .map(([k, v]) => `<div class="${keyClass}"><kbd>${k}</kbd><span>${v}</span></div>`)
    .join("");
  const tips = TIPS.map((t) => `<li>${t}</li>`).join("");
  return { quickstart, sections, keys, tips };
}

function template() {
  const { quickstart, sections, keys, tips } = buildHTML("guide-item", "guide-key", "guide-tip");
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

          <h2 class="guide-subtitle">打法要点</h2>
          <div class="guide-grid">${sections}</div>

          <h2 class="guide-subtitle">操作一览</h2>
          <div class="guide-keys">${keys}</div>

          <h2 class="guide-subtitle">上手贴士</h2>
          <ul class="guide-tips">${tips}</ul>
        </div>
      </div>
    </section>
  `;
}

// 移动端专属：顶栏固定 + 原生可滚
function mobileTemplate() {
  const { quickstart, sections, keys, tips } = buildHTML("m-guide-item", "m-guide-key", "m-guide-tip");
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
        <h2 class="m-guide-sub">操作一览</h2>
        ${keys}
        <h2 class="m-guide-sub">上手贴士</h2>
        <ul class="guide-tips">${tips}</ul>
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
