import { accountClient } from "./account-client.js";
import { startStarfield } from "./starfield.js";
import { mountRouteFluidBackdrop } from "./effects/fluid-reveal/routeBackdrop.js";

function escapeHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function avatarHtml(entry) {
  return entry.avatarUrl
    ? `<img src="${escapeHtml(entry.avatarUrl)}" alt="" />`
    : `<span>${escapeHtml(String(entry.username || "?").slice(0, 1).toUpperCase())}</span>`;
}

function template(mode, entries, status, selectedUser = null) {
  const rows = entries.map((entry) => `
    <button type="button" class="leaderboard-row" data-user-id="${escapeHtml(entry.userId)}">
      <span class="leaderboard-rank">${entry.rank}</span>
      <span class="leaderboard-avatar">${avatarHtml(entry)}</span>
      <span class="leaderboard-player"><strong>${escapeHtml(entry.username)}</strong><small>${entry.wins}W ${entry.losses}L / ${entry.games}</small></span>
      <strong class="leaderboard-elo">${entry.elo}</strong>
    </button>`).join("");
  const detail = selectedUser ? `
    <aside class="leaderboard-detail"><button type="button" data-close-detail aria-label="关闭">×</button><p>PUBLIC PROFILE</p><h2>${escapeHtml(selectedUser.username)}</h2><strong>${selectedUser.elo}</strong><span>#${selectedUser.rank} / ${selectedUser.wins}W ${selectedUser.losses}L</span></aside>` : "";
  return `
    <section class="page-stage leaderboard-page">
      <canvas class="page-stars" aria-hidden="true"></canvas><div class="page-bg" aria-hidden="true"></div>
      <div class="page-frame page-frame-wide"><a class="page-back" href="/">返回主菜单</a><h1 class="page-title">排行榜</h1>
        <div class="page-scroll leaderboard-scroll">
          <div class="leaderboard-tabs"><button type="button" data-mode="pvp2v2" class="${mode === "pvp2v2" ? "active" : ""}">2v2</button><button type="button" data-mode="stellar3v3" class="${mode === "stellar3v3" ? "active" : ""}">3v3</button></div>
          <section class="leaderboard-table"><header><span>排名</span><span>指挥官</span><span>积分</span></header>${rows || `<p class="leaderboard-empty">${escapeHtml(status || "暂无战绩")}</p>`}</section>
          <p class="leaderboard-status">${escapeHtml(status || "")}</p>${detail}
        </div>
      </div>
    </section>`;
}

export async function mount(root) {
  let mode = "pvp2v2";
  let entries = [];
  let status = "正在读取排名...";
  let selectedUser = null;
  let eventAbort = null;
  let starfieldAbort = null;
  let fluidBackdrop = null;

  async function load() {
    try {
      const data = await accountClient.getLeaderboard(mode);
      entries = data.entries || [];
      status = entries.length ? "" : "暂无已结算的对局。";
    } catch (_error) {
      entries = [];
      status = "排行榜暂不可用。";
    }
  }

  function render() {
    eventAbort?.abort();
    starfieldAbort?.abort();
    fluidBackdrop?.destroy();
    root.innerHTML = template(mode, entries, status, selectedUser);
    eventAbort = new AbortController();
    const { signal } = eventAbort;
    starfieldAbort = new AbortController();
    startStarfield(root.querySelector(".page-stars"), starfieldAbort.signal);
    fluidBackdrop = mountRouteFluidBackdrop(root.querySelector(".leaderboard-page"), {
      logLabel: "Leaderboard fluid backdrop",
      onReady: () => starfieldAbort.abort(),
    });
    for (const button of root.querySelectorAll("[data-mode]")) {
      button.addEventListener("click", async () => {
        mode = button.dataset.mode;
        selectedUser = null;
        status = "正在读取排名...";
        render();
        await load();
        render();
      }, { signal });
    }
    for (const button of root.querySelectorAll("[data-user-id]")) {
      button.addEventListener("click", async () => {
        status = "正在读取公开资料...";
        render();
        try {
          selectedUser = await accountClient.getUser(button.dataset.userId, mode);
          status = "";
        } catch (_error) {
          status = "公开资料暂不可用。";
        }
        render();
      }, { signal });
    }
    root.querySelector("[data-close-detail]")?.addEventListener("click", () => {
      selectedUser = null;
      render();
    }, { signal });
  }

  await load();
  render();
  return () => {
    eventAbort?.abort();
    starfieldAbort?.abort();
    fluidBackdrop?.destroy();
  };
}
