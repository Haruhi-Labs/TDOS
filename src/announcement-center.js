import { accountClient } from "./account-client.js";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formattedDate(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" }).format(new Date(timestamp));
}

export function getLatestUnreadAnnouncement(entries) {
  const latest = Array.isArray(entries) ? entries[0] : null;
  return latest && !latest.readAt ? latest : null;
}

export function createAnnouncementCenter({ client = accountClient, documentRef = globalThis.document, onStateChange = () => {} } = {}) {
  let overlay = null;
  let requestId = 0;

  function close() {
    overlay?.remove();
    overlay = null;
  }

  function open(entry) {
    if (!documentRef?.body || overlay) return;
    overlay = documentRef.createElement("div");
    overlay.className = "announcement-overlay";
    overlay.innerHTML = `
      <section class="announcement-dialog" role="dialog" aria-modal="true" aria-labelledby="announcementTitle">
        <p class="announcement-kicker">SOS 团发布通报</p>
        <p class="announcement-version">${escapeHtml(entry.version)} / ${escapeHtml(formattedDate(entry.publishedAt))}</p>
        <h1 id="announcementTitle">${escapeHtml(entry.title)}</h1>
        <ul class="announcement-changes">${entry.changes.map((change) => `<li>${escapeHtml(change)}</li>`).join("")}</ul>
        <p class="announcement-error" data-announcement-error hidden>暂时无法确认公告，请重试。</p>
        <button class="announcement-confirm" type="button" data-announcement-confirm>我已阅读</button>
      </section>
    `;
    const confirm = overlay.querySelector("[data-announcement-confirm]");
    const error = overlay.querySelector("[data-announcement-error]");
    confirm?.addEventListener("click", async () => {
      if (confirm.disabled) return;
      confirm.disabled = true;
      error.hidden = true;
      try {
        await client.markAnnouncementRead(entry.id);
        onStateChange(false);
        close();
      } catch (_error) {
        error.hidden = false;
        confirm.disabled = false;
      }
    });
    documentRef.body.append(overlay);
    requestAnimationFrame(() => confirm?.focus());
  }

  async function checkForUnread() {
    const pendingRequest = ++requestId;
    const entries = await client.getAnnouncements();
    if (pendingRequest !== requestId) return null;
    const latestUnread = getLatestUnreadAnnouncement(entries);
    onStateChange(Boolean(latestUnread));
    if (latestUnread) open(latestUnread);
    return latestUnread;
  }

  function dispose() {
    requestId += 1;
    close();
  }

  return { checkForUnread, dispose };
}
