// 通用二次确认弹窗(皮装主题)。返回 Promise<boolean>:确认=true,取消/遮罩/Esc=false。
// 文案由调用方用 t() 预先本地化后传入;标题/正文用 textContent 写入,避免任何 HTML 注入。
let activeCleanup = null;

export function showConfirm({ title, body = "", confirmText, cancelText, danger = false } = {}) {
  // 同一时刻只允许一个:若已有打开的,先按取消关掉
  if (activeCleanup) {
    activeCleanup(false);
  }
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "ts-confirm-overlay";

    const card = document.createElement("div");
    card.className = "ts-confirm-card";
    card.setAttribute("role", "alertdialog");
    card.setAttribute("aria-modal", "true");

    const h = document.createElement("h2");
    h.className = "ts-confirm-title";
    h.textContent = title || "";
    card.appendChild(h);

    if (body) {
      const p = document.createElement("p");
      p.className = "ts-confirm-body";
      p.textContent = body;
      card.appendChild(p);
    }

    const actions = document.createElement("div");
    actions.className = "ts-confirm-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "ts-confirm-cancel";
    cancelBtn.textContent = cancelText || "取消";
    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = `ts-confirm-ok${danger ? " danger" : ""}`;
    okBtn.textContent = confirmText || "确定";
    // 取消在前:更符合「主操作=继续/留下」的安全默认,且移动端拇指更易够到
    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    card.appendChild(actions);
    overlay.appendChild(card);

    function finish(result) {
      if (activeCleanup !== finish) return;
      activeCleanup = null;
      window.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(result);
    }
    activeCleanup = finish;

    function onKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    }
    window.addEventListener("keydown", onKey, true);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(false); // 点遮罩空白 = 取消
    });
    cancelBtn.addEventListener("click", () => finish(false));
    okBtn.addEventListener("click", () => finish(true));

    document.body.appendChild(overlay);
    // 焦点给「取消」,避免键盘/回车误确认这类破坏性操作
    requestAnimationFrame(() => cancelBtn.focus());
  });
}
