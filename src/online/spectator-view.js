import { clamp, skillMetaForCharacter } from "../../shared/game-core.js";
import { characterName, skillText, slotLabel, splitLabel, t, translateServerText } from "../i18n.js";
import { getPortraitAssetUrl } from "../character-select/portraits.js";
import { renderStatusEffects } from "../battle/status-effects.js";
import "./spectator.css";

const SLOTS = ["main", "sub1", "sub2"];
let nextTooltipId = 0;

function gaugeHTML(kind, label) {
  return `<div class="spectator-gauge" data-gauge="${kind}"><span>${label}</span><span class="spectator-track"><i></i></span><strong>—</strong></div>`;
}

function teamHTML(seat) {
  return `<aside class="spectator-team" data-seat="${seat}" aria-labelledby="spectator-player-${seat}" hidden>
    <header class="spectator-team-head"><span class="spectator-seat">${seat}</span><h2 id="spectator-player-${seat}"></h2><span class="spectator-bot" hidden>AI</span></header>
    <div class="spectator-team-summary"><span class="spectator-survivors">—</span><span class="spectator-formation">—</span></div>
    <div class="spectator-ships">${SLOTS.map((slot) => `<article class="spectator-ship" data-slot="${slot}">
      <div class="spectator-ship-head"><span class="spectator-portrait"><img alt="" draggable="false"></span>
        <div class="spectator-identity"><span class="spectator-role">${slotLabel(slot, "short")}</span><h3>—</h3><span class="spectator-ship-state">—</span></div></div>
      ${gaugeHTML("hull", t("舰体"))}${gaugeHTML("energy", t("能量"))}
      <div class="status-effects" hidden></div>
      <div class="spectator-skill"><button type="button" class="spectator-skill-name" disabled>—</button><span class="spectator-skill-readout"><strong class="spectator-skill-state">—</strong><span class="spectator-cooldown" hidden></span></span><span class="spectator-skill-track"><i></i></span></div>
    </article>`).join("")}</div>
  </aside>`;
}

function shipState(ship, team, slot) {
  if (!ship) return "—";
  if (!ship.alive) return t("已击沉");
  if (ship.stunRemaining > 0) return t("眩晕");
  if (ship.silenced) return t("沉默");
  if (ship.koizumiOrb?.active) return ship.koizumiOrb.phase === "returning" ? t("自动归航") : t("光球形态");
  if (slot === "main" && team.future1096Form) return t(`${team.future1096Form}形态`);
  const inFormation = ship.attached || (slot === "main" && SLOTS.some((key) => team.ships?.[key]?.alive && team.ships[key].attached));
  return inFormation ? t("编队") : t("独立编队");
}

// 冷却与可释放状态分开判断，避免把未分离、低能量或沉默中的技能显示为就绪。
export function spectatorSkillState(team, ship, slot, characterId) {
  const meta = characterId ? skillMetaForCharacter(characterId, slot === "main" ? "flagship" : "sub") : null;
  const remaining = Math.max(0, Number(team?.cooldowns?.[slot === "main" ? "flagship" : slot]) || 0);
  const progress = !ship?.alive ? 0 : meta?.cooldown ? clamp(1 - remaining / meta.cooldown, 0, 1) : 1;
  let status = "—";
  let tone = "waiting";
  if (ship) {
    if (!ship.alive) status = t("已击沉");
    else if (team.skillsDisabled) status = t("已封印");
    else if (meta?.type === "passive") {
      const barrier = characterId === "koizumi" ? team.koizumiBarrier : null;
      status = barrier?.active
        ? t("护盾 {count}/{max}", { count: barrier.remainingHits, max: barrier.maxHits })
        : barrier && !barrier.active
          ? t("修复{seconds}秒", { seconds: barrier.disabledRemaining.toFixed(1) }) : t("被动");
      tone = "passive";
    } else if (ship.silenced) status = t("沉默");
    else if (ship.stunRemaining > 0) status = t("眩晕");
    else if (remaining > 0) { status = `${remaining.toFixed(1)}s`; tone = "cooldown"; }
    else if (ship.koizumiOrb?.active) status = t("光球形态");
    else if (slot !== "main" && ship.attached) status = t("待分离");
    else if (!ship.canControl) status = "—";
    else if ((ship.fleetEnergy ?? ship.energy ?? 0) < (meta?.cost || 0)) status = t("能量不足");
    else if (meta) { status = t("就绪"); tone = "ready"; }
  }
  return { status, tone, remaining, progress };
}

function updateGauge(element, value, max, available) {
  const safeMax = Math.max(1, Number(max) || 1);
  const safeValue = Math.max(0, Number(value) || 0);
  const ratio = available ? clamp(safeValue / safeMax, 0, 1) : 0;
  element.querySelector("i").style.width = `${ratio * 100}%`;
  element.querySelector("strong").textContent = available ? `${Math.round(ratio * 100)}%` : "—";
  element.title = available ? `${Math.round(safeValue)} / ${Math.round(safeMax)}` : "";
}

export function createSpectatorView(battleView) {
  battleView.insertAdjacentHTML("afterbegin", `<header class="spectator-toolbar" hidden>
    <div class="spectator-match-meta"><span>${t("观战")}</span><span class="spectator-room-id"></span><time>—</time></div>
    <div class="spectator-camera-controls"><button type="button" data-camera="out" aria-label="${t("缩小")}">−</button><button type="button" data-camera="reset">${t("全图")}</button><button type="button" data-camera="in" aria-label="${t("放大")}">＋</button></div>
    <button type="button" class="spectator-exit">${t("退出观战")}</button>
  </header>${teamHTML("A")}`);
  battleView.insertAdjacentHTML("beforeend", teamHTML("B"));
  const tooltipId = `spectator-skill-tooltip-${++nextTooltipId}`;
  battleView.insertAdjacentHTML("beforeend", `<aside id="${tooltipId}" class="spectator-skill-tooltip" role="tooltip" popover="manual" hidden><strong></strong><p></p></aside>`);
  const tooltip = battleView.querySelector(`#${tooltipId}`);
  const tooltipName = tooltip.querySelector("strong");
  const tooltipDescription = tooltip.querySelector("p");
  const tooltipEvents = new AbortController();
  const eventOptions = { signal: tooltipEvents.signal };
  let tooltipTrigger = null;
  let tooltipPinned = false;
  let tooltipTimer = 0;
  function hideTooltip() {
    clearTimeout(tooltipTimer);
    tooltipTrigger = null;
    tooltipPinned = false;
    if (tooltip.hidePopover && tooltip.matches(":popover-open")) tooltip.hidePopover();
    tooltip.hidden = true;
  }
  function showTooltip(trigger) {
    clearTimeout(tooltipTimer);
    if (trigger.disabled || !trigger.dataset.description) return;
    if (tooltipTrigger !== trigger) tooltipPinned = false;
    tooltipTrigger = trigger;
    tooltipName.textContent = trigger.textContent;
    tooltipDescription.textContent = trigger.dataset.description;
    tooltip.hidden = false;
    if (tooltip.showPopover && !tooltip.matches(":popover-open")) tooltip.showPopover();
    positionTooltip();
  }
  function positionTooltip() {
    // 顶层浮层避开横屏展板的滚动裁剪，并始终留在当前视口内。
    if (!tooltipTrigger) return;
    const anchor = tooltipTrigger.getBoundingClientRect();
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    const left = Math.max(10, Math.min(anchor.left, window.innerWidth - width - 10));
    const below = anchor.bottom + 8;
    const top = below + height <= window.innerHeight - 10 ? below : anchor.top - height - 8;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(10, Math.min(top, window.innerHeight - height - 10))}px`;
  }
  function delayHideTooltip() {
    clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(() => {
      // 浮层换边时旧位置会产生离开事件；指针仍在技能名或说明上时继续显示。
      if (!tooltipPinned && !tooltipTrigger?.matches(":hover, :focus-visible") && !tooltip.matches(":hover")) hideTooltip();
    }, 120);
  }
  for (const trigger of battleView.querySelectorAll(".spectator-skill-name")) {
    trigger.setAttribute("aria-describedby", tooltipId);
    trigger.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "touch") return;
      clearTimeout(tooltipTimer);
      if (tooltipTrigger) showTooltip(trigger);
      else tooltipTimer = setTimeout(() => showTooltip(trigger), 180);
    }, eventOptions);
    trigger.addEventListener("pointerleave", delayHideTooltip, eventOptions);
    trigger.addEventListener("focus", () => showTooltip(trigger), eventOptions);
    trigger.addEventListener("blur", () => {
      // 通用按压反馈会清理指针焦点；点击打开的说明仍由外部点按或Escape关闭。
      if (tooltipTrigger === trigger && tooltipPinned) return;
      if (trigger.matches(":hover")) delayHideTooltip();
      else hideTooltip();
    }, eventOptions);
    trigger.addEventListener("click", () => { showTooltip(trigger); tooltipPinned = true; }, eventOptions);
  }
  tooltip.addEventListener("pointerenter", () => clearTimeout(tooltipTimer), eventOptions);
  tooltip.addEventListener("pointerleave", delayHideTooltip, eventOptions);
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".spectator-skill-name") && !tooltip.contains(event.target)) hideTooltip();
  }, eventOptions);
  document.addEventListener("focusin", (event) => {
    if (!event.target.closest(".spectator-skill-name") && !tooltip.contains(event.target)) hideTooltip();
  }, eventOptions);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideTooltip();
  }, eventOptions);
  document.addEventListener("scroll", (event) => {
    if (!tooltip.contains(event.target)) positionTooltip();
  }, { ...eventOptions, capture: true });
  window.addEventListener("resize", hideTooltip, eventOptions);
  const toolbar = battleView.querySelector(".spectator-toolbar");
  const zoomOut = toolbar.querySelector('[data-camera="out"]');
  const zoomIn = toolbar.querySelector('[data-camera="in"]');
  const zoomReset = toolbar.querySelector('[data-camera="reset"]');
  function updateCamera({ zoom = 1, targetZoom = zoom, maxZoom = 4 } = {}) {
    battleView.classList.toggle("spectator-zoomed", zoom > 1.001);
    const outDisabled = targetZoom <= 1.001;
    const inDisabled = targetZoom >= maxZoom - 0.001;
    if (zoomOut.disabled !== outDisabled) zoomOut.disabled = outDisabled;
    if (zoomIn.disabled !== inDisabled) zoomIn.disabled = inDisabled;
    const label = zoom <= 1.001 ? t("全图") : `${Math.round(zoom * 100)}%`;
    if (zoomReset.textContent !== label) zoomReset.textContent = label;
  }
  const panels = Array.from(battleView.querySelectorAll(".spectator-team")).map((panel) => ({
    panel,
    seat: panel.dataset.seat,
    ships: Array.from(panel.querySelectorAll(".spectator-ship")).map((row) => ({
      row, slot: row.dataset.slot, img: row.querySelector("img"), name: row.querySelector("h3"),
      state: row.querySelector(".spectator-ship-state"), hull: row.querySelector('[data-gauge="hull"]'),
      energy: row.querySelector('[data-gauge="energy"]'), skill: row.querySelector(".spectator-skill"),
    })),
  }));

  function update({ active, room, state, zoom = 1, targetZoom = zoom }) {
    battleView.classList.toggle("spectator-shell", active);
    battleView.classList.toggle("spectator-zoomed", active && zoom > 1.001);
    battleView.querySelector(".battle-panel").hidden = active;
    toolbar.hidden = !active;
    for (const { panel } of panels) panel.hidden = !active;
    if (!active) { hideTooltip(); return; }
    toolbar.querySelector(".spectator-room-id").textContent = room?.roomId ? `#${room.roomId}` : "";
    const elapsed = Math.max(0, Math.floor(state?.elapsed || 0));
    toolbar.querySelector("time").textContent = state ? `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}` : "—";
    updateCamera({ zoom, targetZoom });
    for (const { panel, seat, ships } of panels) {
      const player = room?.players?.find((row) => row.seat === seat);
      const team = state?.teams?.[seat];
      const rawName = player?.name || team?.name;
      // 用户昵称只能写入文本节点，不能解释为 HTML。
      panel.querySelector("h2").textContent = player?.isBot ? translateServerText("统合思念体AI") : rawName || "—";
      panel.querySelector("h2").title = panel.querySelector("h2").textContent;
      panel.querySelector(".spectator-bot").hidden = !player?.isBot;
      panel.querySelector(".spectator-survivors").textContent = team ? t("存活 {count}/3", { count: SLOTS.filter((slot) => team.ships?.[slot]?.alive).length }) : "—";
      panel.querySelector(".spectator-formation").textContent = team ? splitLabel(team.splitLevel) : "—";
      for (const { row, slot, img, name, state: stateLabel, hull, energy, skill } of ships) {
        const ship = team?.ships?.[slot];
        const characterId = ship?.characterId || team?.loadout?.[slot] || player?.loadout?.[slot];
        name.textContent = characterId ? characterName(characterId) : "—";
        if (img.dataset.character !== (characterId || "")) {
          img.dataset.character = characterId || "";
          img.hidden = !characterId;
          if (characterId) img.src = getPortraitAssetUrl(characterId, seat === "A" ? "blue" : "red");
          else img.removeAttribute("src");
        }
        row.classList.toggle("is-destroyed", Boolean(ship && !ship.alive));
        row.classList.toggle("is-selected", Boolean(ship?.alive && state?.selectedShips?.[seat] === slot));
        stateLabel.textContent = shipState(ship, team, slot);
        renderStatusEffects(row.querySelector(".status-effects"), ship);
        updateGauge(hull, ship?.alive ? ship.hp : 0, ship?.maxHp, Boolean(ship));
        updateGauge(energy, ship?.alive ? ship.fleetEnergy ?? ship.energy : 0, ship?.fleetMaxEnergy ?? ship?.maxEnergy, Boolean(ship));
        const info = spectatorSkillState(team, ship, slot, characterId);
        skill.dataset.tone = info.tone;
        const skillName = skill.querySelector(".spectator-skill-name");
        const mode = slot === "main" ? "flagship" : "sub";
        const label = characterId ? skillText(characterId, mode) : "—";
        const description = characterId ? skillText(characterId, mode, "description") : "";
        // 冷却每帧更新，静态说明不重写，避免悬浮阅读期间闪烁或重置。
        if (skillName.textContent !== label) skillName.textContent = label;
        if (skillName.dataset.description !== description) {
          skillName.dataset.description = description;
          if (tooltipTrigger === skillName) {
            if (description) showTooltip(skillName);
            else hideTooltip();
          }
        }
        skillName.disabled = !description;
        skill.querySelector("strong").textContent = info.status;
        const cooldown = skill.querySelector(".spectator-cooldown");
        cooldown.hidden = !ship?.alive || info.remaining <= 0 || info.tone === "cooldown";
        cooldown.textContent = `${info.remaining.toFixed(1)}s`;
        skill.querySelector("i").style.width = `${info.progress * 100}%`;
      }
    }
  }
  return { update, updateCamera, destroy() { hideTooltip(); tooltipEvents.abort(); tooltip.remove(); } };
}
