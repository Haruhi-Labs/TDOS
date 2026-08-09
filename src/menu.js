// ═══════════════════════════════════════════════════════════════
// 主菜单 / 标题画面（路由 /）
// 左：标题 + 竖排菜单；底：动态星尘与 WebGL 视频封面背景。
// 键盘 ↑↓ 选择、Enter 进入。出战编队不在此处选，进入对战时再挑。
// ═══════════════════════════════════════════════════════════════

import { getFaction } from "./profile.js";
import { accountClient } from "./account-client.js";
import { startStarfield } from "./starfield.js";
import { isMobile } from "./mobile.js";
import { bindLanguageSelector, languageSelectorHTML, t } from "./i18n.js";
import { mountRouteFluidBackdrop } from "./effects/fluid-reveal/routeBackdrop.js";

const ITEMS = [
  { href: "/play", no: "I", label: "单人实战", sub: "挑选舰队，迎击 AI 舰群" },
  { href: "/online", no: "II", label: "在线对战", sub: "大厅匹配，与真人同步交战" },
  { href: "/stellar3v3", no: "III", label: "星域争夺 3v3", sub: "六舰编队，争夺星域控制权" },
  { href: "/guide", no: "IV", label: "玩法说明", sub: "操作与机制速览" },
  { href: "/credits", no: "V", label: "制作人员", sub: "画师 · 设计开发 · 出品" },
  { href: "/leaderboard", no: "VI", label: "排行榜", sub: "全模式统一指挥官积分" },
];

const GITHUB_URL = "https://github.com/Haruhi-Labs/TDOS";
const GROUP_URL = "https://qm.qq.com/q/zg5Bl5Ugwg";
const VERSION_LABEL = `公测版 v${__APP_VERSION__}`;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 首页 GitHub 链接(内嵌 Octocat 标记,fill 跟随 currentColor 以适配主题色)
function githubLinkHTML() {
  return `<a class="ts-github" href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer" aria-label="${t("GitHub 源码仓库")}" title="GitHub · TDOS">` +
    `<svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>` +
    `</a>`;
}

// 首页加群文字按钮(铜框小药丸,风格随主题)
function groupLinkHTML() {
  const label = t("加入交流群");
  return `<a class="ts-group" href="${GROUP_URL}" target="_blank" rel="noopener noreferrer" aria-label="${t("加入游戏交流群")}" title="${t("加入游戏交流群")}">${label}</a>`;
}

// 右上角语言切换:地球图标 + 原生语言下拉(隐藏「语言」字样,图标表意),与左上角印章标题对称
function languageCornerHTML() {
  return `<div class="ts-lang-corner">` +
    `<svg class="ts-globe" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18"/></svg>` +
    languageSelectorHTML("ts-language ts-language-corner") +
    `</div>`;
}

function accountCornerHTML(account) {
  const username = String(account?.username || "?");
  const fallback = escapeHtml(username.slice(0, 1).toUpperCase());
  const avatar = account?.avatarUrl
    ? `<img data-menu-avatar-image src="${escapeHtml(account.avatarUrl)}" alt="" /><span data-menu-avatar-fallback hidden>${fallback}</span>`
    : `<span data-menu-avatar-fallback>${fallback}</span>`;
  const label = t("指挥官档案");
  return `<a class="ts-account-corner" href="/profile" aria-label="${label}" title="${label}"><span class="ts-account-avatar">${avatar}</span></a>`;
}

function announcementCornerHTML() {
  const label = "更新公告";
  return `<a class="ts-announcement-corner" data-menu-announcements href="/announcements" aria-label="${label}" title="${label}">` +
    `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 22h4"/></svg></a>`;
}

function cornerControlsHTML(account) {
  return `<div class="ts-corner-controls">${accountCornerHTML(account)}${announcementCornerHTML()}${languageCornerHTML()}</div>`;
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

// 移动端专属：纵向堆叠 —— 标题 / 大触控菜单行
function mobileTemplate(faction, account) {
  return `
    <section class="ts-stage mmenu ts-faction-${faction}">
      <canvas class="ts-bg" aria-hidden="true"></canvas>
      ${cornerControlsHTML(account)}
      <div class="mmenu-shell">
        <header class="mmenu-head">
          <div class="ts-seal" role="img" aria-label="${t("SOS团")}"></div>
          <h1 class="ts-title">${t("射手座之日")}</h1>
        </header>
        <nav class="ts-menu mmenu-list" aria-label="${t("主菜单")}">${menuItemsHTML()}</nav>
        <footer class="mmenu-foot">
          <span class="ts-foot-actions">${githubLinkHTML()}${groupLinkHTML()}</span>
          <span class="ts-ver">${t(VERSION_LABEL)}</span>
        </footer>
      </div>
    </section>
  `;
}

function template(faction, account) {
  const items = menuItemsHTML();

  return `
    <section class="ts-stage ts-faction-${faction}">
      <canvas class="ts-bg" aria-hidden="true"></canvas>
      <div class="ts-vignette" aria-hidden="true"></div>
      ${cornerControlsHTML(account)}

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
          <span class="ts-foot-actions">${githubLinkHTML()}${groupLinkHTML()}</span>
          <span class="ts-foot-info"><span class="ts-ver">${t(VERSION_LABEL)}</span><span class="ts-foot-dot">·</span><span class="ts-hint">${t("↑ ↓ 选择　Enter 进入")}</span></span>
        </footer>
      </div>
    </section>
  `;
}

export async function mount(root, ctx) {
  let account;
  let accountLoadFailed = false;
  try {
    account = await accountClient.getMe();
  } catch (_error) {
    accountLoadFailed = true;
  }
  if (!account && !accountLoadFailed) {
    ctx?.onSignedOut?.();
    return () => {};
  }
  const faction = getFaction();
  const mobile = isMobile();
  root.innerHTML = (mobile ? mobileTemplate : template)(faction, account);
  bindLanguageSelector(root);

  const ac = new AbortController();
  const { signal } = ac;

  root.querySelector("[data-menu-avatar-image]")?.addEventListener("error", (event) => {
    event.currentTarget.hidden = true;
    root.querySelector("[data-menu-avatar-fallback]")?.removeAttribute("hidden");
  }, { signal });

  const stage = root.querySelector(".ts-stage");
  const bg = root.querySelector(".ts-bg");
  const announcementControl = root.querySelector("[data-menu-announcements]");
  const setAnnouncementUnread = (hasUnread) => announcementControl?.classList.toggle("has-unread", Boolean(hasUnread));
  window.addEventListener("haruhi:announcement-state", (event) => setAnnouncementUnread(event.detail?.hasUnread), { signal });
  void accountClient.getAnnouncements()
    .then((entries) => setAnnouncementUnread(entries[0] && !entries[0].readAt))
    .catch(() => {});
  const starfieldAc = new AbortController();
  startStarfield(bg, starfieldAc.signal);

  const fluidCover = mountRouteFluidBackdrop(stage, {
    activeClass: "ts-fluid-cover",
    logLabel: "Fluid cover",
    onReady: () => starfieldAc.abort(),
  });

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

  // 入场后聚焦首项（仅当无键盘焦点环，避免突兀）
  requestAnimationFrame(() => {
    if (stage && document.activeElement === document.body) items[0]?.focus({ preventScroll: true });
  });

  return () => {
    starfieldAc.abort();
    fluidCover.destroy();
    ac.abort();
  };
}
