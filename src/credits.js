// ═══════════════════════════════════════════════════════════════
// 制作人员（路由 /credits）
// ═══════════════════════════════════════════════════════════════

import { startStarfield } from "./starfield.js";
import { isMobile } from "./mobile.js";
import { getLocale, t } from "./i18n.js";
import { mountRouteFluidBackdrop } from "./effects/fluid-reveal/routeBackdrop.js";

const CREDITS_ZH = [
  { role: "画师", name: "橙海" },
  { role: "开发", name: "春日しゅぎ" },
  { role: "设计", name: ["春日しゅぎ", "syd", "可能是寂寞"] },
  { role: "出品", name: ["凉宫春日应援团超能力者组", "凉宫春日应援团开发组"] },
];

const CREDITS_EN = [
  { role: "Artist", name: "cheng hai" },
  { role: "Development", name: { label: "Haruhiyuki", href: "https://github.com/Haruhiyuki" } },
  { role: "Design", name: [{ label: "Haruhiyuki", href: "https://github.com/Haruhiyuki" }, "syd", "Maybe Lonely"] },
  {
    role: "Production",
    name: [
      { label: "Haruhi-Labs", href: "https://github.com/Haruhi-Labs" },
      { label: "Haruhifanclub", href: "https://space.bilibili.com/201296348" },
    ],
  },
];

function creditsData() {
  return getLocale() === "zh" ? CREDITS_ZH : CREDITS_EN;
}

function pageTitle() {
  return getLocale() === "zh" ? t("制作人员") : "Credits";
}

function creditNameHTML(item) {
  const entry = typeof item === "string" ? { label: getLocale() === "zh" ? t(item) : item } : item;
  const label = entry.label || "";
  if (!entry.href) return `<span class="credit-name">${label}</span>`;
  return `<a class="credit-name credit-link" href="${entry.href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

function rowsHTML() {
  return creditsData().map((c) => {
    // name 可为数组:每个占一行(.credit-row 本就是居中竖排),避免单行过长
    const names = Array.isArray(c.name) ? c.name : [c.name];
    const role = getLocale() === "zh" ? t(c.role) : c.role;
    const nameHTML = names.map(creditNameHTML).join("");
    return `<div class="credit-row"><span class="credit-role">${role}</span>${nameHTML}</div>`;
  }).join("");
}

function template() {
  return `
    <section class="page-stage">
      <canvas class="page-stars" aria-hidden="true"></canvas>
      <div class="page-bg" aria-hidden="true"></div>
      <div class="page-frame">
        <a class="page-back" href="/">${t("‹ 返回主菜单")}</a>
        <h1 class="page-title">${pageTitle()}</h1>
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
        <h1 class="mpage-title">${pageTitle()}</h1>
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
  const starfieldAc = new AbortController();
  startStarfield(root.querySelector(".page-stars"), starfieldAc.signal);
  const fluidBackdrop = mountRouteFluidBackdrop(root.querySelector(".page-stage, .mpage"), {
    logLabel: "Credits fluid backdrop",
    onReady: () => starfieldAc.abort(),
  });
  return () => {
    fluidBackdrop.destroy();
    starfieldAc.abort();
    ac.abort();
  };
}
