import { characterShortName, t } from "./i18n.js";
import { isMobile } from "./mobile.js";
import { startStarfield } from "./starfield.js";
import { requestWinrateStatistics } from "./statistics-client.js";

const state = {
  mode: "solo",
  sort: "games",
  stats: null,
  loading: true,
  error: false,
};

function modeControlsHTML() {
  return `
    <div class="stats-controls" aria-label="${t("榜单筛选")}">
      <div class="stats-tabs" role="tablist" aria-label="${t("游戏模式")}">
        <button type="button" class="stats-tab active" data-stats-mode="solo" role="tab" aria-selected="true">${t("单人游戏")}</button>
        <button type="button" class="stats-tab" data-stats-mode="multiplayer" role="tab" aria-selected="false">${t("多人游戏")}</button>
      </div>
      <label class="stats-sort-label">
        <span>${t("排序")}</span>
        <select class="stats-sort" aria-label="${t("排序方式")}">
          <option value="games">${t("出场场次")}</option>
          <option value="winRate">${t("胜率")}</option>
        </select>
      </label>
    </div>`;
}

function shellHTML() {
  return `
    ${modeControlsHTML()}
    <div class="stats-meta" id="statsMeta" aria-live="polite"></div>
    <div class="stats-board" id="statsBoard" aria-live="polite"></div>`;
}

function desktopTemplate() {
  return `
    <section class="page-stage statistics-page">
      <canvas class="page-stars" aria-hidden="true"></canvas>
      <div class="page-bg" aria-hidden="true"></div>
      <div class="page-frame page-frame-wide stats-frame">
        <a class="page-back" href="/">${t("‹ 返回主菜单")}</a>
        <h1 class="page-title stats-title">${t("胜率统计")}</h1>
        <div class="page-scroll stats-scroll">${shellHTML()}</div>
      </div>
    </section>`;
}

function mobileTemplate() {
  return `
    <section class="mpage statistics-mobile">
      <canvas class="page-stars" aria-hidden="true"></canvas>
      <div class="mpage-top">
        <a class="mpage-back" href="/">‹</a>
        <h1 class="mpage-title">${t("胜率统计")}</h1>
      </div>
      <div class="mpage-body stats-mobile-body">${shellHTML()}</div>
    </section>`;
}

function lineupHTML(loadout) {
  const roles = [
    ["main", t("主舰")],
    ["sub1", t("副一")],
    ["sub2", t("副二")],
  ];
  return roles.map(([key, role]) => `
    <span class="stats-ship${key === "main" ? " stats-ship-main" : ""}">
      <span class="stats-ship-role">${role}</span>
      <span class="stats-ship-name">${characterShortName(loadout?.[key], loadout?.[key] || "-")}</span>
    </span>`).join("");
}

function sortedRows() {
  const rows = [...(state.stats?.modes?.[state.mode]?.lineups || [])];
  const primary = state.sort === "winRate" ? "winRate" : "games";
  const secondary = primary === "games" ? "winRate" : "games";
  rows.sort((left, right) => (
    Number(right[primary] || 0) - Number(left[primary] || 0)
    || Number(right[secondary] || 0) - Number(left[secondary] || 0)
    || String(left.lineup?.main || "").localeCompare(String(right.lineup?.main || ""))
  ));
  return rows;
}

function rowHTML(row, index) {
  const rate = Number(row.winRate || 0).toLocaleString(undefined, {
    minimumFractionDigits: row.winRate > 0 && row.winRate < 100 && !Number.isInteger(row.winRate) ? 1 : 0,
    maximumFractionDigits: 1,
  });
  return `
    <article class="stats-row">
      <span class="stats-rank" aria-label="${t("第{rank}名", { rank: index + 1 })}">${String(index + 1).padStart(2, "0")}</span>
      <div class="stats-lineup" aria-label="${t("阵容")}">${lineupHTML(row.lineup)}</div>
      <div class="stats-value stats-games"><strong>${Number(row.games || 0).toLocaleString()}</strong><span>${t("场")}</span></div>
      <div class="stats-value stats-rate"><strong>${rate}%</strong><span>${t("胜率")}</span></div>
    </article>`;
}

function render(root) {
  const board = root.querySelector("#statsBoard");
  const meta = root.querySelector("#statsMeta");
  if (!board || !meta) return;

  for (const button of root.querySelectorAll("[data-stats-mode]")) {
    const active = button.dataset.statsMode === state.mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  }
  const select = root.querySelector(".stats-sort");
  if (select) select.value = state.sort;

  if (state.loading) {
    meta.textContent = "";
    board.innerHTML = `<div class="stats-status"><span class="stats-loader" aria-hidden="true"></span>${t("正在读取对局档案…")}</div>`;
    return;
  }
  if (state.error) {
    meta.textContent = "";
    board.innerHTML = `<div class="stats-status">${t("统计暂时无法读取")}<button type="button" class="stats-retry">${t("重试")}</button></div>`;
    return;
  }

  const modeStats = state.stats?.modes?.[state.mode] || { matches: 0, lineups: [] };
  meta.textContent = t("已完成对局 {count} 场", { count: Number(modeStats.matches || 0).toLocaleString() });
  const rows = sortedRows();
  board.innerHTML = rows.length > 0
    ? `<div class="stats-column-head"><span>${t("阵容")}</span><span>${t("出场")}</span><span>${t("胜率")}</span></div>${rows.map(rowHTML).join("")}`
    : `<div class="stats-status">${t("暂无已完成对局")}</div>`;
}

async function load(root) {
  state.loading = true;
  state.error = false;
  render(root);
  try {
    state.stats = await requestWinrateStatistics();
  } catch (_error) {
    state.error = true;
  } finally {
    state.loading = false;
    render(root);
  }
}

export function mount(root) {
  state.mode = "solo";
  state.sort = "games";
  state.stats = null;
  state.loading = true;
  state.error = false;
  root.innerHTML = isMobile() ? mobileTemplate() : desktopTemplate();

  const ac = new AbortController();
  startStarfield(root.querySelector(".page-stars"), ac.signal);
  root.addEventListener("click", (event) => {
    const modeButton = event.target.closest("[data-stats-mode]");
    if (modeButton) {
      state.mode = modeButton.dataset.statsMode === "multiplayer" ? "multiplayer" : "solo";
      render(root);
      return;
    }
    if (event.target.closest(".stats-retry")) load(root);
  }, { signal: ac.signal });
  root.querySelector(".stats-sort")?.addEventListener("change", (event) => {
    state.sort = event.target.value === "winRate" ? "winRate" : "games";
    render(root);
  }, { signal: ac.signal });

  void load(root);
  return () => ac.abort();
}
