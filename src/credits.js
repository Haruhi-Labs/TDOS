// ═══════════════════════════════════════════════════════════════
// 制作人员（路由 /credits）
// ═══════════════════════════════════════════════════════════════

import { startStarfield } from "./starfield.js";
import { isMobile } from "./mobile.js";

const CREDITS = [
  { role: "画师", name: "橙海" },
  { role: "设计 · 开发", name: "春日しゅぎ" },
  { role: "出品", name: "凉宫春日开发组" },
];

function rowsHTML() {
  return CREDITS.map(
    (c) =>
      `<div class="credit-row"><span class="credit-role">${c.role}</span><span class="credit-name">${c.name}</span></div>`,
  ).join("");
}

function template() {
  return `
    <section class="page-stage">
      <canvas class="page-stars" aria-hidden="true"></canvas>
      <div class="page-bg" aria-hidden="true"></div>
      <div class="page-frame">
        <a class="page-back" href="/">‹ 返回主菜单</a>
        <h1 class="page-title">制作人员</h1>
        <div class="page-scroll">
          <div class="credits-list">${rowsHTML()}</div>
        </div>
      </div>
    </section>
  `;
}

// 移动端：固定顶栏 + 原生可滚动列表
function mobileTemplate() {
  return `
    <section class="mpage">
      <canvas class="page-stars" aria-hidden="true"></canvas>
      <div class="mpage-top">
        <a class="mpage-back" href="/">‹</a>
        <h1 class="mpage-title">制作人员</h1>
      </div>
      <div class="mpage-body">
        <div class="credits-list">${rowsHTML()}</div>
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
