// ═══════════════════════════════════════════════════════════════
// 玩法说明（路由 /guide）
// ═══════════════════════════════════════════════════════════════

import { startStarfield } from "./starfield.js";

const SECTIONS = [
  {
    title: "选舰",
    body: "开战前从 7 名团员中编入 1 主舰 + 2 副舰，每人舰体、能量、机动与技能各异。",
  },
  {
    title: "航行",
    body: "单击地图选战区；双击落点生成贝塞尔航线，拖拽控制点调弧度、拖绿色终点改落点；推进功率用滑块控制。",
  },
  {
    title: "分离",
    body: "一级 / 二级分离让副舰独立行动：分离后转向更灵活、能量各自结算；编队航速取队内最慢者。",
  },
  {
    title: "射界与视野",
    body: "侧舷火力密度更高、舰尾不开火；视野外的敌人不可见，靠侦查机进入战区开图。",
  },
  {
    title: "技能",
    body: "每名角色有旗舰技与分舰技（主动 / 被动 / 指向 / 战区），配合阵容与时机决定胜负。",
  },
  {
    title: "胜负",
    body: "歼灭对方全部存活舰船即获胜；分离出的小编队也需各自存活。",
  },
];

const KEYS = [
  ["左键单击", "选择战区"],
  ["左键双击", "设定航线落点"],
  ["拖拽控制点 / 终点", "调整贝塞尔航线"],
  ["数字 / 滑块", "切换舰船 · 推进功率"],
  ["B", "急刹"],
  ["C / V", "旗舰技 / 分舰技"],
  ["+ / - / 0", "放大 / 缩小 / 复位镜头"],
];

function template() {
  const sections = SECTIONS.map(
    (s) => `<div class="guide-item"><h3>${s.title}</h3><p>${s.body}</p></div>`,
  ).join("");
  const keys = KEYS.map(
    ([k, v]) => `<div class="guide-key"><kbd>${k}</kbd><span>${v}</span></div>`,
  ).join("");

  return `
    <section class="page-stage">
      <canvas class="page-stars" aria-hidden="true"></canvas>
      <div class="page-bg" aria-hidden="true"></div>
      <div class="page-frame page-frame-wide">
        <a class="page-back" href="/">‹ 返回主菜单</a>
        <h1 class="page-title">玩法说明</h1>

        <div class="guide-grid">${sections}</div>

        <h2 class="guide-subtitle">操作一览</h2>
        <div class="guide-keys">${keys}</div>
      </div>
    </section>
  `;
}

export function mount(root) {
  root.innerHTML = template();
  const ac = new AbortController();
  startStarfield(root.querySelector(".page-stars"), ac.signal);
  return () => ac.abort();
}
