import { getDifficulty, getFaction, setDifficulty } from "./profile.js";
import { startStarfield } from "./starfield.js";
import { startMenuHero } from "./menu-hero.js";
import { isMobile } from "./mobile.js";
import { t } from "./i18n.js";

const DIFFICULTIES = [
  { key: "easy", no: "I", label: "简单", sub: "敌方数值 ×0.8 · 反应迟钝" },
  { key: "normal", no: "II", label: "普通", sub: "敌方数值 ×1.0 · 标准反应" },
  { key: "hard", no: "III", label: "困难", sub: "敌方数值 ×1.2 · 反应敏捷" },
  { key: "master", no: "IV", label: "极限", sub: "敌方数值 ×1.2 · 最快反应与智能集火" },
];

function menuItem({ no, label, sub, action, active = false }) {
  return `
    <button type="button" class="ts-item solo-flow-item${active ? " active" : ""}" data-action="${action}">
      <span class="ts-item-no">${no}</span>
      <span class="ts-item-body">
        <span class="ts-item-label">${t(label)}</span>
        <span class="ts-item-sub">${t(sub)}</span>
      </span>
      <span class="ts-item-cue" aria-hidden="true">›</span>
    </button>`;
}

export function createSoloSetupFlow({ onStandard, onTutorial, onHome }) {
  const controller = new AbortController();
  const faction = getFaction();
  const mobile = isMobile();
  const screen = document.createElement("section");
  screen.className = `solo-flow ts-stage ts-faction-${faction}${mobile ? " solo-flow-mobile" : ""}`;
  screen.innerHTML = `
    <canvas class="ts-bg" aria-hidden="true"></canvas>
    <div class="ts-vignette" aria-hidden="true"></div>
    <div class="ts-hero" aria-hidden="true"><canvas class="ts-hero-img"></canvas></div>
    <div class="ts-content solo-flow-content">
      <div class="solo-flow-panel"></div>
    </div>`;
  document.body.appendChild(screen);
  const battleView = document.getElementById("battleView");
  battleView?.setAttribute("inert", "");
  startStarfield(screen.querySelector(".ts-bg"), controller.signal);
  startMenuHero(screen.querySelector(".ts-hero-img"), {
    faction,
    signal: controller.signal,
    mobile,
  });

  const panel = screen.querySelector(".solo-flow-panel");
  let step = "campaign";
  let changing = false;

  function campaignHtml() {
    return `
      <header class="ts-head solo-flow-heading">
        <div class="ts-seal" role="img" aria-label="${t("SOS团")}"></div>
        <h1 class="ts-title">${t("射手座之日")}</h1>
        <p class="ts-subtitle">The Day of Sagittarius</p>
        <div class="ts-rule"></div>
      </header>
      <nav class="ts-menu" aria-label="${t("选择战役")}">
        ${menuItem({ no: "01", label: "标准对战", sub: "自由编队，对抗统合思念体舰队", action: "standard" })}
        ${menuItem({ no: "02", label: "教程", sub: "固定舰队，循序学习航行、侦察、分舰与交火", action: "tutorial" })}
      </nav>
      <button type="button" class="solo-flow-back" data-action="home">‹ ${t("返回主菜单")}</button>`;
  }

  function difficultyHtml() {
    const current = getDifficulty();
    return `
      <header class="ts-head solo-flow-heading">
        <div class="ts-seal" role="img" aria-label="${t("SOS团")}"></div>
        <h1 class="ts-title">${t("射手座之日")}</h1>
        <p class="ts-subtitle">The Day of Sagittarius</p>
        <div class="ts-rule"></div>
      </header>
      <nav class="ts-menu" aria-label="${t("选择难度")}">
        ${DIFFICULTIES.map((item) => menuItem({ ...item, action: `difficulty:${item.key}`, active: item.key === current })).join("")}
      </nav>
      <button type="button" class="solo-flow-back" data-action="campaign">‹ ${t("返回战役选择")}</button>`;
  }

  function render(nextStep, direction = "forward", immediate = false) {
    if (changing && !immediate) return;
    const update = () => {
      step = nextStep;
      panel.innerHTML = nextStep === "difficulty" ? difficultyHtml() : campaignHtml();
      panel.className = `solo-flow-panel enter-${direction}`;
      requestAnimationFrame(() => panel.classList.add("ready"));
      panel.querySelector(".solo-flow-item")?.focus({ preventScroll: true });
      changing = false;
    };
    if (immediate || !panel.childElementCount) {
      update();
      return;
    }
    changing = true;
    panel.className = `solo-flow-panel leave-${direction}`;
    setTimeout(update, 230);
  }

  function conceal(callback) {
    screen.classList.add("concealed");
    battleView?.removeAttribute("inert");
    setTimeout(() => {
      if (screen.isConnected) callback?.();
    }, 320);
  }

  function show(nextStep = step, direction = "back") {
    battleView?.setAttribute("inert", "");
    screen.classList.remove("concealed");
    render(nextStep, direction, step === nextStep && panel.childElementCount > 0);
  }

  screen.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "standard") render("difficulty", "forward");
    else if (action === "tutorial") conceal(() => onTutorial());
    else if (action === "campaign") render("campaign", "back");
    else if (action === "home") onHome();
    else if (action.startsWith("difficulty:")) {
      const difficulty = action.split(":")[1];
      setDifficulty(difficulty);
      // 先同步挂载不透明的阵容选择层，再隐藏本层，避免两层切换间露出战场一帧。
      onStandard(difficulty);
      screen.classList.add("concealed");
    }
  }, { signal: controller.signal });

  screen.addEventListener("keydown", (event) => {
    const items = Array.from(panel.querySelectorAll(".solo-flow-item"));
    const index = Math.max(0, items.indexOf(document.activeElement));
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      items[(index + delta + items.length) % items.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (step === "difficulty") render("campaign", "back");
      else onHome();
    }
  }, { signal: controller.signal });

  render("campaign", "forward", true);

  return {
    showCampaign: () => show("campaign", "back"),
    showDifficulty: () => show("difficulty", "back"),
    conceal,
    destroy() {
      controller.abort();
      battleView?.removeAttribute("inert");
      screen.remove();
    },
  };
}
