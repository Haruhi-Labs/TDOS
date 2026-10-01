import { skillText, t } from "../i18n.js";
import { skillDetailRows, skillOverview } from "./skill-presentation.js";

let nextPopoverId = 0;

export function skillPreviewHTML(characterId, mode, mobile = false) {
  const type = t(mode === "sub" ? "分舰技" : "旗舰技");
  const name = skillText(characterId, mode);
  const root = mobile ? "csm-skill" : "cs-page-skill";
  const head = mobile ? "csm-skill-head" : "cs-page-skill-header";
  const tag = mobile ? "csm-skill-tag" : "cs-page-skill-type";
  const title = mobile ? "csm-skill-name" : "cs-page-skill-name";
  const desc = mobile ? "csm-skill-desc" : "cs-page-skill-desc";
  return `<button type="button" class="${root} cs-skill-trigger" data-character="${characterId}" data-skill-mode="${mode}" aria-haspopup="dialog" aria-expanded="false" aria-label="${t("查看{name}的技能详情", { name })}">
    <span class="${head}"><span class="${tag}">${type}</span><span class="${title}">${name}</span><span class="cs-skill-more">${t("详情")}</span></span>
    <span class="${desc}">${skillOverview(characterId, mode)}</span>
  </button>`;
}

// 详情位于原生浮层，贴近技能入口；不锁定书页，也不遮暗背景。
export function createSkillDetails(screen) {
  let panel = null;
  let anchor = null;
  let release = null;

  function close(returnFocus = false) {
    if (!panel) return;
    const current = panel;
    const button = anchor;
    panel = null;
    anchor = null;
    release?.();
    release = null;
    button?.setAttribute("aria-expanded", "false");
    button?.removeAttribute("aria-controls");
    if (typeof current.hidePopover === "function" && current.matches(":popover-open")) current.hidePopover();
    current.remove();
    if (returnFocus) requestAnimationFrame(() => {
      if (!panel && button?.isConnected) button.focus({ preventScroll: true });
    });
  }

  function open(button, keyboard) {
    if (anchor === button) { close(keyboard); return; }
    close();
    const characterId = button.dataset.character;
    const mode = button.dataset.skillMode;
    const current = document.createElement("div");
    current.className = `cs-skill-popover${button.closest(".csm") ? " cs-skill-popover-mobile" : ""}`;
    current.id = `cs-skill-popover-${++nextPopoverId}`;
    current.dataset.open = "true";
    current.setAttribute("role", "dialog");
    current.setAttribute("aria-modal", "false");
    current.setAttribute("aria-labelledby", `${current.id}-title`);
    if (typeof current.showPopover === "function") current.setAttribute("popover", "manual");
    current.innerHTML = `<div class="cs-skill-popover-head"><h2 id="${current.id}-title"></h2><button type="button" class="cs-skill-close" aria-label="${t("关闭")}">×</button></div><dl class="cs-skill-detail-list" tabindex="0"></dl>`;
    current.querySelector("h2").textContent = skillText(characterId, mode);
    const list = current.querySelector("dl");
    list.setAttribute("aria-labelledby", `${current.id}-title`);
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
    panel = current;
    anchor = button;
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-controls", current.id);
    document.body.append(current);
    if (typeof current.showPopover === "function") current.showPopover();

    const viewport = window.visualViewport;
    const position = () => {
      if (panel !== current || !button.isConnected) { close(); return; }
      const rect = button.getBoundingClientRect();
      const leftEdge = viewport?.offsetLeft || 0;
      const topEdge = viewport?.offsetTop || 0;
      const width = viewport?.width || window.innerWidth;
      const height = viewport?.height || window.innerHeight;
      const bottomEdge = topEdge + height;
      if (rect.bottom <= topEdge || rect.top >= bottomEdge) { close(); return; }
      const gutter = 10;
      const gap = 8;
      current.style.width = `${Math.min(340, width - gutter * 2)}px`;
      const above = Math.max(0, rect.top - topEdge - gutter - gap);
      const below = Math.max(0, bottomEdge - rect.bottom - gutter - gap);
      const useAbove = above >= Math.min(260, current.scrollHeight) || above >= below;
      current.dataset.placement = useAbove ? "above" : "below";
      current.style.maxHeight = `${Math.min(360, Math.max(80, useAbove ? above : below), height - gutter * 2)}px`;
      const box = current.getBoundingClientRect();
      const left = Math.min(leftEdge + width - gutter - box.width, Math.max(leftEdge + gutter, rect.left));
      const top = useAbove ? rect.top - gap - box.height : rect.bottom + gap;
      current.style.left = `${left}px`;
      current.style.top = `${Math.min(bottomEdge - gutter - box.height, Math.max(topEdge + gutter, top))}px`;
      current.style.setProperty("--skill-arrow-x", `${Math.max(14, Math.min(box.width - 14, rect.left + rect.width / 2 - left))}px`);
    };
    const outside = (event) => {
      if (!current.contains(event.target) && !button.contains(event.target)) close();
    };
    const escape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    const scroll = (event) => { if (!current.contains(event.target)) position(); };
    const focus = (event) => {
      if (!current.contains(event.target) && !button.contains(event.target)) close();
    };
    const observer = new ResizeObserver(position);
    observer.observe(button);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    document.addEventListener("focusin", focus);
    document.addEventListener("scroll", scroll, { capture: true, passive: true });
    window.addEventListener("resize", position);
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    release = () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", position);
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
    };
    current.querySelector(".cs-skill-close").addEventListener("click", () => close(true));
    position();
    if (keyboard) current.querySelector(".cs-skill-close").focus({ preventScroll: true });
  }

  screen.addEventListener("click", (event) => {
    const button = event.target.closest(".cs-skill-trigger");
    if (!button || !screen.contains(button)) return;
    event.stopPropagation();
    open(button, event.detail === 0);
  });
  return { close, isOpen: () => Boolean(panel) };
}
