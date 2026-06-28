// ═══════════════════════════════════════════════════════════════
// 指挥官档案（路由 /profile）
// 只管身份：呼号 + 默认阵营。出战编队在进入对战时（选角页）挑选并自动记忆，
// 不在此处编辑。
// ═══════════════════════════════════════════════════════════════

import { getProfile, setNickname, setFaction, getFaction } from "./profile.js";
import { startStarfield } from "./starfield.js";
import { isMobile } from "./mobile.js";
import { t } from "./i18n.js";

// 移动端专属：满宽表单 + 大触控目标（复用同样的 #pvNickname / .pv-faction-btn 钩子，逻辑共享）
function mobileTemplate(profile) {
  return `
    <section class="mpage">
      <canvas class="page-stars" aria-hidden="true"></canvas>
      <div class="mpage-top">
        <a class="mpage-back" href="/">‹</a>
        <h1 class="mpage-title">${t("指挥官档案")}</h1>
      </div>
      <div class="mpage-body">
        <label class="mfield">
          <span class="mfield-label">${t("呼号")}</span>
          <input id="pvNickname" type="text" maxlength="16" placeholder="${t("输入呼号")}" autocomplete="off" value="${escapeAttr(profile.nickname)}" />
        </label>
        <div class="mfield">
          <span class="mfield-label">${t("默认阵营")}</span>
          <div class="m-faction">
            <button type="button" class="pv-faction-btn blue" data-color="blue">${t("蓝队")}</button>
            <button type="button" class="pv-faction-btn red" data-color="red">${t("红队")}</button>
          </div>
          <p class="pv-note">${t("阵营色用于立绘与画面着色；每局开战仍可在选角页临时切换。")}</p>
        </div>
        <p class="pv-tip">${t("出战编队不在此处设定 —— 进入任意对战模式时挑选，并自动记住上次选择。")}</p>
      </div>
    </section>
  `;
}

function template(profile) {
  return `
    <section class="page-stage">
      <canvas class="page-stars" aria-hidden="true"></canvas>
      <div class="page-bg" aria-hidden="true"></div>
      <div class="page-frame">
        <a class="page-back" href="/">${t("‹ 返回主菜单")}</a>
        <h1 class="page-title">${t("指挥官档案")}</h1>

        <div class="page-scroll">
        <div class="page-card">
          <label class="pv-field">
            <span class="pv-label">${t("呼号")}</span>
            <input id="pvNickname" type="text" maxlength="16" placeholder="${t("输入呼号")}" autocomplete="off" value="${escapeAttr(profile.nickname)}" />
          </label>

          <div class="pv-field">
            <span class="pv-label">${t("默认阵营")}</span>
            <div class="pv-faction">
              <button type="button" class="pv-faction-btn blue" data-color="blue">${t("蓝队")}</button>
              <button type="button" class="pv-faction-btn red" data-color="red">${t("红队")}</button>
            </div>
            <p class="pv-note">${t("阵营色用于立绘与画面着色；每局开战仍可在选角页临时切换。")}</p>
          </div>
        </div>

        <p class="pv-tip">${t("出战编队不在此处设定 —— 进入任意对战模式时挑选，并自动记住上次选择。")}</p>
        </div>
      </div>
    </section>
  `;
}

function escapeAttr(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function mount(root) {
  root.innerHTML = (isMobile() ? mobileTemplate : template)(getProfile());
  const ac = new AbortController();
  const { signal } = ac;
  startStarfield(root.querySelector(".page-stars"), signal);

  const input = root.querySelector("#pvNickname");
  const factionBtns = Array.from(root.querySelectorAll(".pv-faction-btn"));

  function renderFaction() {
    const faction = getFaction();
    for (const btn of factionBtns) btn.classList.toggle("active", btn.dataset.color === faction);
  }

  input.addEventListener("input", () => setNickname(input.value), { signal });
  input.addEventListener(
    "change",
    () => {
      setNickname(input.value);
      input.value = getProfile().nickname;
    },
    { signal },
  );

  for (const btn of factionBtns) {
    btn.addEventListener(
      "click",
      () => {
        setFaction(btn.dataset.color);
        renderFaction();
      },
      { signal },
    );
  }

  renderFaction();

  return () => ac.abort();
}
