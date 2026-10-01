import { STATUS_EFFECT_DEFS } from "../../shared/game/status-effect-definitions.js";
import { t } from "../i18n.js";
import "./status-effects.css";

const icons = {
  shield: '<path d="M12 3 5 6v5c0 5 7 9 7 9s7-4 7-9V6Z"/><path d="m9 11 2 2 4-4"/>',
  broken_shield: '<path d="m12 3-7 3v5c0 5 7 9 7 9s7-4 7-9V6Z"/><path d="m12 5-3 6 5 2-3 6"/>',
  blade: '<path d="m16 3 5 0 0 5-12 12-5-5Z M3 21l4-4 M3 13l8 8"/>',
  paw: '<ellipse cx="6" cy="7" rx="2" ry="3"/><ellipse cx="12" cy="5" rx="2" ry="3"/><ellipse cx="18" cy="7" rx="2" ry="3"/><path d="M5 17c0-3 4-7 7-7s7 4 7 7c0 4-4 2-7 2s-7 2-7-2Z"/>',
  spark: '<path d="m14 2-9 11h6l-1 9 9-12h-6Z"/>',
  orb: '<circle cx="12" cy="12" r="4"/><ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(-40 12 12)"/>',
  return: '<path d="m8 4-5 5 5 5 M3 9h10a7 7 0 0 1 0 14 M12 12l7 0"/>',
  plus: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m12 12 7-7 M12 3v2 M3 12h2"/>',
  star: '<path d="m12 2 3 7 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1Z"/>',
  beam: '<path d="M3 8h11 M1 12h16 M3 16h11 M17 4l5 8-5 8"/>',
  impact: '<path d="m12 2 2 6 6-3-3 6 5 3-7 1 0 7-4-5-6 4 2-7-6-2 7-3Z"/>',
  arrow: '<path d="m5 13 7-9 7 9 M12 4v17 M4 18l2-3 M20 18l-2-3"/>',
  stun: '<path d="m12 2 1 4 4 1-4 1-1 4-1-4-4-1 4-1Z"/><ellipse cx="12" cy="17" rx="10" ry="3"/><path d="M3 11 1 9 M21 11l2-2"/>',
  silence: '<path d="M9 5v8a3 3 0 0 0 6 0V5a3 3 0 0 0-6 0 M5 12v1a7 7 0 0 0 14 0 M12 20v2 M3 3l18 18"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4 M12 14v3"/>',
  slow: '<path d="M2 8h8 M2 12h5 M2 16h8 m7-13 0 17 m-4-4 4 4 4-4"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v5 M12 18v5 M1 12h5 M18 12h5"/>',
  eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z"/><circle cx="12" cy="12" r="3"/>',
};
const rows = new WeakMap();
const details = new WeakMap();
let nextTooltipId = 0;

export function statusEffectPresentation(effect) {
  const definition = STATUS_EFFECT_DEFS[effect.id];
  if (!definition) return null;
  const remaining = effect.remaining === null ? null : Math.max(0, Number(effect.remaining) || 0);
  if (remaining !== null && remaining <= 0) return null;
  const parameters = { ...effect };
  const readout = remaining === null
    ? effect.id === "barrier" ? t("剩余{stacks}/{required}次", parameters) : t(definition.persistent)
    : t("剩余{seconds}秒", { seconds: remaining.toFixed(1) });
  const progress = remaining === null
    ? effect.id === "barrier" ? effect.stacks / Math.max(1, effect.required) : 1
    : remaining / Math.max(0.001, Number(effect.duration) || remaining);
  return { ...definition, name: t(definition.name), description: t(definition.description, parameters), readout, progress: Math.max(0, Math.min(1, progress)), stacks: effect.stacks || 0 };
}

// 按稳定状态 ID 复用节点。倒计时、叠层与续期不会打断正在阅读的浮层或键盘焦点。
export function renderStatusEffects(container, ship) {
  if (!container) return;
  let buttons = rows.get(container);
  if (!buttons) { buttons = new Map(); rows.set(container, buttons); }
  const active = new Set();
  for (const effect of ship?.alive ? ship.statusEffects || [] : []) {
    const info = statusEffectPresentation(effect);
    if (!info || active.has(effect.id)) continue;
    active.add(effect.id);
    let button = buttons.get(effect.id);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "status-effect";
      button.dataset.effect = effect.id;
      button.dataset.tone = info.tone;
      button.innerHTML = `<svg class="status-effect-ring" viewBox="0 0 32 32" aria-hidden="true"><circle class="status-effect-track" cx="16" cy="16" r="13"/><circle class="status-effect-progress" cx="16" cy="16" r="13" pathLength="100"/></svg><svg class="status-effect-symbol" viewBox="0 0 24 24" aria-hidden="true">${icons[info.icon] || icons.spark}</svg><span class="status-effect-stack" aria-hidden="true"></span>`;
      buttons.set(effect.id, button);
      container.append(button);
    }
    details.set(button, info);
    button.setAttribute("aria-label", `${info.name} · ${t(info.tone === "positive" ? "增益" : "减益")} · ${info.readout}`);
    button.querySelector(".status-effect-progress").style.strokeDashoffset = String((1 - info.progress) * 100);
    const stack = button.querySelector(".status-effect-stack");
    stack.hidden = !info.stacks;
    stack.textContent = info.stacks || "";
  }
  for (const [id, button] of buttons) {
    if (active.has(id)) continue;
    button.remove();
    buttons.delete(id);
  }
}

export function createStatusEffectTooltip(root) {
  const id = `status-effect-tooltip-${++nextTooltipId}`;
  const tooltip = document.createElement("aside");
  tooltip.id = id;
  tooltip.className = "status-effect-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.setAttribute("popover", "manual");
  tooltip.hidden = true;
  tooltip.innerHTML = "<div><strong></strong><span></span></div><p></p><small></small>";
  root.append(tooltip);
  const abort = new AbortController();
  const options = { signal: abort.signal };
  let trigger = null, pinned = false, timer = 0, frame = 0, lastUpdate = 0;
  function hide() {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    frame = 0;
    trigger?.removeAttribute("aria-describedby");
    trigger = null;
    pinned = false;
    if (tooltip.matches(":popover-open")) tooltip.hidePopover();
    tooltip.hidden = true;
  }
  function refresh() {
    if (!trigger?.isConnected || !trigger.getClientRects().length || !details.has(trigger)) { hide(); return; }
    const info = details.get(trigger);
    tooltip.dataset.tone = info.tone;
    for (const [selector, text] of [["strong", info.name], ["span", t(info.tone === "positive" ? "增益" : "减益")], ["p", info.description], ["small", info.readout]]) {
      const node = tooltip.querySelector(selector);
      if (node.textContent !== text) node.textContent = text;
    }
    const anchor = trigger.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - tooltip.offsetWidth - 8));
    const below = anchor.bottom + 8;
    const top = below + tooltip.offsetHeight <= window.innerHeight - 8 ? below : anchor.top - tooltip.offsetHeight - 8;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
  }
  function tick(now) {
    if (now - lastUpdate > 80) { lastUpdate = now; refresh(); }
    if (trigger) frame = requestAnimationFrame(tick);
  }
  function show(button, pin = false) {
    clearTimeout(timer);
    if (!details.has(button)) return;
    if (trigger !== button) trigger?.removeAttribute("aria-describedby");
    trigger = button;
    pinned = pin;
    trigger.setAttribute("aria-describedby", id);
    tooltip.hidden = false;
    refresh();
    if (trigger && tooltip.showPopover && !tooltip.matches(":popover-open")) { tooltip.showPopover(); refresh(); }
    if (trigger && !frame) frame = requestAnimationFrame(tick);
  }
  const buttonAt = (event) => event.target.closest?.(".status-effect");
  const delayHide = () => { if (!pinned) { clearTimeout(timer); timer = setTimeout(hide, 100); } };
  root.addEventListener("pointerover", (event) => {
    const button = buttonAt(event);
    if (!button || button.contains(event.relatedTarget) || event.pointerType === "touch") return;
    clearTimeout(timer);
    timer = setTimeout(() => show(button), 140);
  }, options);
  root.addEventListener("pointerout", (event) => {
    const button = buttonAt(event);
    if (button && !button.contains(event.relatedTarget)) delayHide();
  }, options);
  root.addEventListener("focusin", (event) => { const button = buttonAt(event); if (button) show(button); }, options);
  root.addEventListener("click", (event) => {
    const button = buttonAt(event);
    if (!button) return;
    event.stopPropagation();
    if (trigger === button && pinned) hide(); else show(button, true);
  }, options);
  tooltip.addEventListener("pointerenter", () => clearTimeout(timer), options);
  tooltip.addEventListener("pointerleave", delayHide, options);
  document.addEventListener("pointerdown", (event) => { if (!buttonAt(event) && !tooltip.contains(event.target)) hide(); }, options);
  document.addEventListener("focusin", (event) => { if (!buttonAt(event) && !tooltip.contains(event.target) && !pinned) hide(); }, options);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") hide(); }, options);
  window.addEventListener("resize", hide, options);
  return { hide, destroy() { hide(); abort.abort(); tooltip.remove(); } };
}
