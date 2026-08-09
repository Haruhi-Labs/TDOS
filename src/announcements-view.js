import { accountClient, AccountApiError } from "./account-client.js";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" }).format(new Date(timestamp));
}

function announceState(entries) {
  const hasUnread = Boolean(entries[0] && !entries[0].readAt);
  window.dispatchEvent(new CustomEvent("haruhi:announcement-state", { detail: { hasUnread } }));
}

function historyTemplate(entries, statusMessage) {
  const rows = entries.map((entry) => {
    const unread = !entry.readAt;
    return `
      <article class="announcement-history-entry ${unread ? "is-unread" : "is-read"}">
        <header>
          <div>
            <p class="announcement-history-meta">${escapeHtml(entry.version)} <span>${escapeHtml(formatDate(entry.publishedAt))}</span></p>
            <h2>${escapeHtml(entry.title)}</h2>
          </div>
          ${unread ? `<button type="button" class="announcement-history-mark" data-announcement-id="${escapeHtml(entry.id)}">确认已读</button>` : `<span class="announcement-history-read">已读</span>`}
        </header>
        <ul>${entry.changes.map((change) => `<li>${escapeHtml(change)}</li>`).join("")}</ul>
      </article>`;
  }).join("");
  return `
    <section class="page-stage announcement-history-page" aria-labelledby="announcementHistoryTitle">
      <div class="page-bg" aria-hidden="true"></div>
      <main class="announcement-history">
        <a class="page-back" href="/">返回主菜单</a>
        <header class="announcement-history-heading">
          <p>RELEASE ARCHIVE</p>
          <h1 id="announcementHistoryTitle">更新公告</h1>
          <span aria-hidden="true"></span>
        </header>
        ${statusMessage ? `<p class="announcement-history-status" role="status">${escapeHtml(statusMessage)}</p>` : ""}
        <div class="announcement-history-list">${rows || `<p class="announcement-history-empty">暂时没有已发布的更新公告。</p>`}</div>
      </main>
    </section>`;
}

export async function mount(root, { onSignedOut } = {}) {
  let entries = [];
  let statusMessage = "";
  const abort = new AbortController();
  const { signal } = abort;

  function render() {
    root.innerHTML = historyTemplate(entries, statusMessage);
  }

  try {
    entries = await accountClient.getAnnouncements();
    announceState(entries);
  } catch (error) {
    if (error instanceof AccountApiError && error.status === 401) {
      onSignedOut?.();
      return () => {};
    }
    statusMessage = "公告暂时无法加载，请稍后再试。";
  }
  render();

  root.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-announcement-id]");
    if (!button || button.disabled) return;
    const announcementId = button.dataset.announcementId;
    button.disabled = true;
    try {
      const updated = await accountClient.markAnnouncementRead(announcementId);
      entries = entries.map((entry) => entry.id === updated?.id ? updated : entry);
      announceState(entries);
      render();
    } catch (error) {
      if (error instanceof AccountApiError && error.status === 401) {
        onSignedOut?.();
        return;
      }
      button.disabled = false;
      statusMessage = "确认公告失败，请重试。";
      render();
    }
  }, { signal });

  return () => abort.abort();
}
