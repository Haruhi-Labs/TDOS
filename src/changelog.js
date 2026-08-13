// ═══════════════════════════════════════════════════════════════
// 公共更新日志（路由 /changelog）—— 内容来自 changelog/entries.js，页面只负责展示。
// ═══════════════════════════════════════════════════════════════

import { getChangelogEntries } from "./changelog/entries.js";
import { getLocale, getLocaleInfo, t } from "./i18n.js";
import { isMobile } from "./mobile.js";
import { startStarfield } from "./starfield.js";

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatReleaseDate(isoDate) {
  const [year, month, day] = String(isoDate).split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return new Date(year, month - 1, day).toLocaleDateString(getLocaleInfo().timeLocale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function groupHTML(releaseId, group) {
  const headingId = `cl-group-${releaseId}-${group.id}`;
  const items = group.items.map((item) => {
    const content = item.text
      ? `<p class="cl-item-verbatim">${escapeHTML(item.text)}</p>`
      : `<h4>${escapeHTML(item.title)}</h4><p>${escapeHTML(item.body)}</p>`;
    return `
      <li class="cl-item" data-change-id="${escapeHTML(item.id)}">
        ${content}
      </li>
    `;
  }).join("");
  const heading = group.title
    ? `<h3 id="${escapeHTML(headingId)}">${escapeHTML(group.title)}</h3>`
    : "";
  const labelledBy = group.title ? ` aria-labelledby="${escapeHTML(headingId)}"` : "";
  return `
    <section class="cl-group${group.title ? "" : " cl-group-plain"}"${labelledBy}>
      ${heading}
      <ul class="cl-items">${items}</ul>
    </section>
  `;
}

function releaseHTML(release) {
  return `
    <article class="cl-release" data-release-id="${escapeHTML(release.id)}">
      <div class="cl-sheet">
        <header class="cl-sheet-head">
          <h2>${escapeHTML(release.title)}</h2>
          <time datetime="${escapeHTML(release.date)}">${escapeHTML(formatReleaseDate(release.date))}</time>
        </header>
        ${release.groups.map((group) => groupHTML(release.id, group)).join("")}
      </div>
    </article>
  `;
}

function releaseListHTML() {
  return `<div class="cl-releases">${getChangelogEntries(getLocale()).map(releaseHTML).join("")}</div>`;
}

function template() {
  return `
    <section class="page-stage changelog-page">
      <canvas class="page-stars" aria-hidden="true"></canvas>
      <div class="page-bg" aria-hidden="true"></div>
      <div class="page-frame page-frame-changelog">
        <a class="page-back" href="/">${t("‹ 返回主菜单")}</a>
        <h1 class="page-title cl-page-title">${t("更新日志")}</h1>
        <div class="page-scroll cl-scroll">${releaseListHTML()}</div>
      </div>
    </section>
  `;
}

function mobileTemplate() {
  return `
    <section class="mpage changelog-mobile">
      <canvas class="page-stars" aria-hidden="true"></canvas>
      <div class="mpage-top">
        <a class="mpage-back" href="/">‹</a>
        <h1 class="mpage-title">${t("更新日志")}</h1>
      </div>
      <div class="mpage-body cl-mobile-body">
        ${releaseListHTML()}
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
