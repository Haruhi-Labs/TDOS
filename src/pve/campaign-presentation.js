import { getPortraitAssetUrl } from "../character-select/portraits.js";
import { t } from "../i18n.js";

function createElement(tag, className) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
}

export function createPveCampaignPresentation({
  battleView,
  campaign,
  runtime,
  getFaction,
  isMobile,
  onOpeningCue,
  onOpeningComplete,
}) {
  const controller = new AbortController();
  const hud = createElement("section", "pve-campaign-hud");
  hud.hidden = true;
  hud.setAttribute("aria-live", "polite");
  hud.innerHTML = `
    <div class="pve-hud-heading">
      <span class="pve-hud-kicker">PVE</span>
      <strong class="pve-hud-title"></strong>
    </div>
    <div class="pve-hud-phase"></div>
    <div class="pve-hud-detail"></div>
    <div class="pve-hud-timer" hidden></div>`;

  const toast = createElement("section", "pve-event-toast");
  toast.hidden = true;
  toast.setAttribute("aria-live", "assertive");
  toast.innerHTML = `
    <img class="pve-event-portrait" alt="">
    <div class="pve-event-copy">
      <strong class="pve-event-speaker"></strong>
      <p class="pve-event-text"></p>
    </div>`;

  const story = createElement("section", "pve-story");
  story.setAttribute("role", "dialog");
  story.setAttribute("aria-modal", "true");
  story.setAttribute("aria-label", t("战役序幕"));
  story.innerHTML = `
    <div class="pve-story-scan" aria-hidden="true"></div>
    <figure class="pve-story-portrait" aria-hidden="true">
      <img alt="">
    </figure>
    <div class="pve-story-script">
      <div class="pve-story-meta">
        <span class="pve-story-eyebrow"></span>
        <span class="pve-story-progress"></span>
      </div>
      <h2 class="pve-story-speaker"></h2>
      <p class="pve-story-text"></p>
      <div class="pve-story-actions">
        <button type="button" class="pve-story-skip">${t("跳过序幕")}</button>
        <button type="button" class="pve-story-next">${t("继续")}</button>
      </div>
    </div>`;

  battleView.append(hud, toast, story);
  battleView.classList.add("campaign-story-active");

  const portraitFrame = story.querySelector(".pve-story-portrait");
  const portrait = portraitFrame.querySelector("img");
  const eyebrow = story.querySelector(".pve-story-eyebrow");
  const progress = story.querySelector(".pve-story-progress");
  const speaker = story.querySelector(".pve-story-speaker");
  const copy = story.querySelector(".pve-story-text");
  const nextButton = story.querySelector(".pve-story-next");
  const skipButton = story.querySelector(".pve-story-skip");
  let stepIndex = -1;
  let finished = false;
  let lastHudSignature = "";
  let activeToastUntil = 0;
  let toastQueue = [];

  function syncResponsiveClass() {
    const mobile = Boolean(isMobile());
    story.classList.toggle("pve-story-mobile", mobile);
    hud.classList.toggle("pve-campaign-hud-mobile", mobile);
    toast.classList.toggle("pve-event-toast-mobile", mobile);
  }

  function renderStep(index) {
    const step = campaign.opening[index];
    if (!step) return;
    stepIndex = index;
    story.className = `pve-story${isMobile() ? " pve-story-mobile" : ""} pve-story-${step.side || "center"} pve-story-${step.tone || "neutral"}`;
    story.classList.toggle("pve-story-title-step", step.kind === "title");
    story.classList.toggle("pve-story-objective-step", step.kind === "objective");
    eyebrow.textContent = t(step.eyebrow || campaign.title);
    progress.textContent = `${String(index + 1).padStart(2, "0")} / ${String(campaign.opening.length).padStart(2, "0")}`;
    speaker.textContent = t(step.speaker);
    copy.textContent = t(step.text);
    nextButton.textContent = t(step.actionLabel || (index === campaign.opening.length - 1 ? "开始作战" : "继续"));

    if (step.characterId) {
      portrait.src = getPortraitAssetUrl(step.characterId, step.side === "right" ? "red" : getFaction());
      portrait.alt = "";
      portraitFrame.hidden = false;
      story.style.setProperty("--pve-portrait-accent", step.characterId === "yuki" ? "#b8a9f0" : "#f0d488");
    } else {
      portrait.removeAttribute("src");
      portraitFrame.hidden = true;
    }

    runtime.applyOpeningCue(step.cue);
    onOpeningCue?.(step);
    story.classList.remove("pve-story-step-enter");
    void story.offsetWidth;
    story.classList.add("pve-story-step-enter");
    nextButton.focus({ preventScroll: true });
  }

  function finishOpening() {
    if (finished) return;
    finished = true;
    runtime.startBattle();
    battleView.classList.remove("campaign-story-active");
    story.classList.add("pve-story-closing");
    hud.hidden = false;
    setTimeout(() => story.remove(), 260);
    onOpeningComplete?.();
  }

  function advance() {
    if (finished) return;
    if (stepIndex + 1 >= campaign.opening.length) {
      finishOpening();
      return;
    }
    renderStep(stepIndex + 1);
  }

  nextButton.addEventListener("click", advance, { signal: controller.signal });
  skipButton.addEventListener("click", finishOpening, { signal: controller.signal });
  story.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    advance();
  }, { signal: controller.signal });
  window.addEventListener("keydown", (event) => {
    if (finished) return;
    if (event.key === "Enter" || event.key === " " || event.key === "ArrowRight") {
      event.preventDefault();
      advance();
    } else if (event.key === "Escape") {
      event.preventDefault();
      finishOpening();
    }
  }, { signal: controller.signal, capture: true });
  window.addEventListener("resize", syncResponsiveClass, { signal: controller.signal });

  function showToast(value, now) {
    const toastPortrait = toast.querySelector(".pve-event-portrait");
    toast.className = `pve-event-toast${isMobile() ? " pve-event-toast-mobile" : ""} pve-event-${value.tone || "info"}`;
    toast.querySelector(".pve-event-speaker").textContent = t(value.speaker);
    toast.querySelector(".pve-event-text").textContent = t(value.text, value.textArgs || {});
    if (value.characterId) {
      toastPortrait.src = getPortraitAssetUrl(value.characterId, value.tone === "danger" ? "red" : getFaction());
      toastPortrait.hidden = false;
    } else {
      toastPortrait.hidden = true;
      toastPortrait.removeAttribute("src");
    }
    toast.hidden = false;
    toast.classList.remove("pve-event-toast-enter");
    void toast.offsetWidth;
    toast.classList.add("pve-event-toast-enter");
    activeToastUntil = now + 3800;
  }

  function update() {
    if (finished && runtime.sim.phase === "finished") {
      hud.hidden = true;
      toast.hidden = true;
      toastQueue = [];
      runtime.consumeEvents();
      return;
    }
    if (finished) {
      const state = runtime.hudState();
      const signature = JSON.stringify(state);
      if (signature !== lastHudSignature) {
        lastHudSignature = signature;
        hud.className = `pve-campaign-hud${isMobile() ? " pve-campaign-hud-mobile" : ""} pve-hud-${state.tone || "info"}`;
        hud.querySelector(".pve-hud-title").textContent = t(state.title);
        hud.querySelector(".pve-hud-phase").textContent = t(state.phase, state.phaseArgs || {});
        hud.querySelector(".pve-hud-detail").textContent = t(state.detail || state.objective);
        const timer = hud.querySelector(".pve-hud-timer");
        timer.hidden = !Number.isFinite(state.countdown);
        timer.textContent = Number.isFinite(state.countdown) ? t("下一阶段 {seconds}秒", { seconds: state.countdown.toFixed(1) }) : "";
      }
    }

    toastQueue.push(...runtime.consumeEvents());
    const now = performance.now();
    if (!toast.hidden && now >= activeToastUntil) toast.hidden = true;
    if ((toast.hidden || now >= activeToastUntil) && toastQueue.length) showToast(toastQueue.shift(), now);
  }

  syncResponsiveClass();
  renderStep(0);

  return {
    update,
    isOpening: () => !finished,
    finishOpening,
    destroy() {
      controller.abort();
      battleView.classList.remove("campaign-story-active");
      story.remove();
      hud.remove();
      toast.remove();
      toastQueue = [];
    },
  };
}
