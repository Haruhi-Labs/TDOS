import { characterName, skillText, t } from "../i18n.js";
import { skillDetailRows, skillOverview } from "./skill-presentation.js";

export function skillPreviewHTML(characterId, mode, mobile = false) {
  const type = t(mode === "sub" ? "分舰技" : "旗舰技");
  const name = skillText(characterId, mode);
  const root = mobile ? "csm-skill" : "cs-page-skill";
  const head = mobile ? "csm-skill-head" : "cs-page-skill-header";
  const tag = mobile ? "csm-skill-tag" : "cs-page-skill-type";
  const title = mobile ? "csm-skill-name" : "cs-page-skill-name";
  const desc = mobile ? "csm-skill-desc" : "cs-page-skill-desc";
  return `<button type="button" class="${root} cs-skill-trigger" data-character="${characterId}" data-skill-mode="${mode}" aria-haspopup="dialog" aria-label="${t("查看{name}的技能详情", { name })}">
    <span class="${head}"><span class="${tag}">${type}</span><span class="${title}">${name}</span><span class="cs-skill-more">${t("详情")}</span></span>
    <span class="${desc}">${skillOverview(characterId, mode)}</span>
  </button>`;
}

// 弹窗不挂在缩放书页内，使用原生模态顶层与焦点约束，兼容翻页、窄屏和触屏。
export function createSkillDetails(screen) {
  let dialog = null;
  let pressedOutside = false;

  function close() {
    if (!dialog) return;
    if (dialog.open) dialog.close();
    dialog.remove();
    dialog = null;
  }

  function open(button) {
    close();
    const characterId = button.dataset.character;
    const mode = button.dataset.skillMode;
    dialog = document.createElement("dialog");
    dialog.className = "cs-skill-dialog";
    dialog.setAttribute("aria-labelledby", "cs-skill-dialog-title");
    dialog.innerHTML = `<div class="cs-skill-dialog-head"><div><p class="cs-skill-dialog-context"></p><h2 id="cs-skill-dialog-title"></h2></div><button type="button" class="cs-skill-close" aria-label="${t("关闭")}">×</button></div><dl class="cs-skill-detail-list"></dl>`;
    dialog.querySelector(".cs-skill-dialog-context").textContent = `${characterName(characterId)} / ${t(mode === "sub" ? "分舰技" : "旗舰技")}`;
    dialog.querySelector("h2").textContent = skillText(characterId, mode);
    const list = dialog.querySelector("dl");
    list.tabIndex = 0;
    list.setAttribute("aria-labelledby", "cs-skill-dialog-title");
    for (const { label, value } of skillDetailRows(characterId, mode)) {
      const row = document.createElement("div");
      row.className = "cs-skill-detail-row";
      const term = document.createElement("dt");
      const detail = document.createElement("dd");
      term.textContent = label;
      detail.textContent = value;
      row.append(term, detail);
      list.append(row);
    }
    const current = dialog;
    const closeButton = current.querySelector(".cs-skill-close");
    closeButton.addEventListener("click", close);
    // 浏览器可能把 Tab 交给浏览器工具栏；在关闭按钮与可滚动参数之间显式循环。
    current.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      event.preventDefault();
      const targets = [closeButton, list];
      const index = targets.indexOf(document.activeElement);
      targets[(index + (event.shiftKey ? -1 : 1) + targets.length) % targets.length].focus({ preventScroll: true });
    });
    const outside = (event) => {
      const rect = current.getBoundingClientRect();
      return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    };
    current.addEventListener("pointerdown", (event) => { pressedOutside = event.target === current && outside(event); });
    current.addEventListener("pointerup", (event) => {
      if (pressedOutside && event.target === current && outside(event)) close();
      pressedOutside = false;
    });
    current.addEventListener("close", () => {
      current.remove();
      if (dialog === current) dialog = null;
      // 等点击反馈完成失焦后再归还焦点，避免快速按 Esc 时被待执行的指针反馈清掉。
      requestAnimationFrame(() => {
        if (!dialog && button.isConnected && [document.body, button].includes(document.activeElement)) button.focus({ preventScroll: true });
      });
    });
    document.body.append(current);
    current.showModal();
    closeButton.focus({ preventScroll: true });
  }

  screen.addEventListener("click", (event) => {
    const button = event.target.closest(".cs-skill-trigger");
    if (!button || !screen.contains(button)) return;
    event.stopPropagation();
    open(button);
  });
  return { close, isOpen: () => Boolean(dialog?.open) };
}
