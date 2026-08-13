// ═══════════════════════════════════════════════════════════════
// 主菜单 / 标题画面（路由 /）
// 左：标题 + 竖排菜单；右：七人群像（前后拥簇，随阵营着色）；底：动态星尘背景。
// 键盘 ↑↓ 选择、Enter 进入。出战编队不在此处选，进入对战时再挑。
// ═══════════════════════════════════════════════════════════════

import { getFaction } from "./profile.js";
import { startStarfield } from "./starfield.js";
import { isMobile } from "./mobile.js";
import { startMenuHero } from "./menu-hero.js";
import { bindLanguageSelector, languageSelectorHTML, t } from "./i18n.js";
import { CURRENT_VERSION_LABEL } from "./changelog/meta.js";

const ITEMS = [
  { href: "/play", no: "I", label: "单人游戏", sub: "选择战役，指挥舰队迎击 AI" },
  { href: "/online", no: "II", label: "在线对战", sub: "大厅匹配，与真人同步交战" },
  { href: "/profile", no: "III", label: "指挥官档案", sub: "呼号、阵营与统一身份" },
  { href: "/guide", no: "IV", label: "玩法说明", sub: "操作与机制速览" },
  { href: "/credits", no: "V", label: "制作人员", sub: "画师 · 设计开发 · 出品" },
];

const GITHUB_URL = "https://github.com/Haruhi-Labs/TDOS";
const GROUP_URL = "https://qm.qq.com/q/zg5Bl5Ugwg";

// 首页 GitHub 链接(内嵌 Octocat 标记,fill 跟随 currentColor 以适配主题色)
function githubLinkHTML() {
  return `<a class="ts-github" href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer" aria-label="${t("GitHub 源码仓库")}" title="GitHub · TDOS">` +
    `<svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>` +
    `<span class="ts-github-label">${t("源码 · AGPL v3")}</span>` +
    `</a>`;
}

// 首页加群文字按钮(铜框小药丸,风格随主题)
function groupLinkHTML() {
  const label = t("加入交流群");
  return `<a class="ts-group" href="${GROUP_URL}" target="_blank" rel="noopener noreferrer" aria-label="${t("加入游戏交流群")}" title="${t("加入游戏交流群")}">${label}</a>`;
}

function statisticsLinkHTML() {
  return `<a class="ts-group ts-statistics" href="/statistics">${t("胜率统计")}</a>`;
}

// 页脚版本号也是更新日志入口；比新增独立图标更符合用户查阅版本内容的习惯。
function versionLinkHTML() {
  return `<a class="ts-ver ts-ver-link" href="/changelog">${t(CURRENT_VERSION_LABEL)}</a>`;
}

// 右上角语言切换:地球图标 + 原生语言下拉(隐藏「语言」字样,图标表意),与左上角印章标题对称
function languageCornerHTML() {
  return `<div class="ts-lang-corner">` +
    `<svg class="ts-globe" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18"/></svg>` +
    languageSelectorHTML("ts-language ts-language-corner") +
    `</div>`;
}

function menuItemsHTML() {
  return ITEMS.map(
    (it, i) => `
    <a class="ts-item" href="${it.href}" data-index="${i}">
      <span class="ts-item-no">${it.no}</span>
      <span class="ts-item-body">
        <span class="ts-item-label">${t(it.label)}</span>
        <span class="ts-item-sub">${t(it.sub)}</span>
      </span>
      <span class="ts-item-cue">▸</span>
    </a>`,
  ).join("");
}

// 移动端专属：纵向堆叠 —— 标题 / 清晰群像 hero / 大触控菜单行
// （复用 .ts-bg/.ts-hero-img/.ts-item 钩子，逻辑共享；群像在流内，不再压成满屏毛玻璃背景）
function mobileTemplate(faction) {
  return `
    <section class="ts-stage mmenu ts-faction-${faction}">
      <canvas class="ts-bg" aria-hidden="true"></canvas>
      ${languageCornerHTML()}
      <div class="mmenu-shell">
        <header class="mmenu-head">
          <div class="ts-seal" role="img" aria-label="${t("SOS团")}"></div>
          <h1 class="ts-title">${t("射手座之日")}</h1>
        </header>
        <div class="ts-hero mmenu-hero" aria-hidden="true"><canvas class="ts-hero-img"></canvas></div>
        <nav class="ts-menu mmenu-list" aria-label="${t("主菜单")}">${menuItemsHTML()}</nav>
        <footer class="mmenu-foot">
          <span class="ts-foot-actions">${githubLinkHTML()}${groupLinkHTML()}${statisticsLinkHTML()}</span>
          ${versionLinkHTML()}
        </footer>
      </div>
    </section>
  `;
}

function template(faction) {
  const items = menuItemsHTML();

  return `
    <section class="ts-stage ts-faction-${faction}">
      <canvas class="ts-bg" aria-hidden="true"></canvas>
      <div class="ts-vignette" aria-hidden="true"></div>
      ${languageCornerHTML()}

      <div class="ts-hero" aria-hidden="true">
        <canvas class="ts-hero-img"></canvas>
      </div>

      <div class="ts-content">
        <header class="ts-head">
          <div class="ts-seal" role="img" aria-label="${t("SOS团")}"></div>
          <h1 class="ts-title">${t("射手座之日")}</h1>
          <p class="ts-subtitle">The Day of Sagittarius</p>
          <div class="ts-rule"></div>
        </header>

        <nav class="ts-menu" aria-label="${t("主菜单")}">
          ${items}
        </nav>

        <footer class="ts-foot">
          <span class="ts-foot-actions">${githubLinkHTML()}${groupLinkHTML()}${statisticsLinkHTML()}</span>
          <span class="ts-foot-info">${versionLinkHTML()}<span class="ts-foot-dot">·</span><span class="ts-hint">${t("↑ ↓ 选择　Enter 进入")}</span></span>
        </footer>
      </div>
    </section>
  `;
}

export function mount(root, ctx) {
  const faction = getFaction();
  const mobile = isMobile();
  root.innerHTML = (mobile ? mobileTemplate : template)(faction);
  bindLanguageSelector(root);

  const ac = new AbortController();
  const { signal } = ac;

  const bg = root.querySelector(".ts-bg");
  startStarfield(bg, signal);

  startMenuHero(root.querySelector(".ts-hero-img"), { faction, signal, mobile });

  const items = Array.from(root.querySelectorAll(".ts-item"));

  // 键盘导航
  function focusItem(idx) {
    const n = items.length;
    items[((idx % n) + n) % n].focus();
  }
  function currentIndex() {
    return items.indexOf(document.activeElement);
  }
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusItem((currentIndex() < 0 ? -1 : currentIndex()) + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusItem((currentIndex() < 0 ? 0 : currentIndex()) - 1);
      } else if (event.key === "Enter") {
        const idx = currentIndex();
        if (idx >= 0) {
          event.preventDefault();
          items[idx].click();
        }
      }
    },
    { signal },
  );

  return () => ac.abort();
}
