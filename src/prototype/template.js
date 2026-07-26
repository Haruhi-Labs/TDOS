import { t } from "../i18n.js";
import { battleViewTemplate } from "../battle/template.js";
import { CHARACTER_ORDER, CHARACTER_DEFS } from "../../shared/game-core.js";

function roleOptions(selected) {
  return CHARACTER_ORDER.map((id) => {
    const def = CHARACTER_DEFS[id];
    const sel = id === selected ? " selected" : "";
    return `<option value="${id}"${sel}>${def.shortName}</option>`;
  }).join("");
}

function loadoutSelects(prefix, loadout) {
  return `
    <div class="proto-loadout" data-side="${prefix}">
      <label>主舰<select data-slot="main">${roleOptions(loadout?.main)}</select></label>
      <label>副1<select data-slot="sub1">${roleOptions(loadout?.sub1)}</select></label>
      <label>副2<select data-slot="sub2">${roleOptions(loadout?.sub2)}</select></label>
    </div>
  `;
}

export function prototypeShellHTML({ modeOptionsHTML = "", loadoutA, loadoutB } = {}) {
  const developerPanelHTML = `
    <section class="proto-section">
      <h2>玩法实验室 DEV</h2>
      <p class="proto-muted">可复用模式实验平台 · 不接入正式菜单</p>
    </section>

    <section class="proto-section">
      <h3>模式</h3>
      <select id="protoModeSelect">${modeOptionsHTML}</select>
      <div id="protoModeMeta" class="proto-muted"></div>
      <button id="protoApplyModeBtn" type="button">切换并重开</button>
    </section>

    <section class="proto-section">
      <h3>对局控制</h3>
      <div class="proto-btn-row">
        <button id="protoPauseBtn" type="button">暂停</button>
        <button id="protoStepBtn" type="button">单步</button>
        <button id="protoRestartBtn" type="button">重新开始</button>
      </div>
      <div id="protoSpeedRow" class="proto-btn-row">
        <button type="button" data-speed="0.25">0.25x</button>
        <button type="button" data-speed="0.5">0.5x</button>
        <button type="button" data-speed="1" class="active">1x</button>
        <button type="button" data-speed="2">2x</button>
        <button type="button" data-speed="4">4x</button>
      </div>
    </section>

    <section class="proto-section">
      <h3>阵容 A / B</h3>
      <div class="proto-loadout-block">
        <div class="proto-subtitle">A 队</div>
        ${loadoutSelects("A", loadoutA)}
        <div class="proto-subtitle">B 队</div>
        ${loadoutSelects("B", loadoutB)}
      </div>
      <div class="proto-btn-row">
        <button id="protoSwapLoadoutBtn" type="button">交换阵容</button>
        <button id="protoRandomBBtn" type="button">随机 B</button>
        <button id="protoApplyLoadoutBtn" type="button">应用阵容并重开</button>
      </div>
    </section>

    <section class="proto-section">
      <h3>模式参数</h3>
      <div id="protoModeParams"></div>
      <button id="protoApplyModeParamsBtn" type="button">应用模式参数并重开</button>
    </section>

    <section class="proto-section">
      <h3>玩法倍率</h3>
      <div id="protoGameplayParams"></div>
      <button id="protoApplyGameplayBtn" type="button">应用玩法倍率并重开</button>
      <p id="protoParamHint" class="proto-muted">修改参数后需重开对局生效</p>
    </section>

    <section class="proto-section">
      <h3>模式工具</h3>
      <div id="protoModeTools" class="proto-mode-tools"></div>
    </section>

    <section class="proto-section">
      <h3>模式 HUD</h3>
      <div id="protoModeHud" class="proto-mode-hud"></div>
    </section>

    <section class="proto-section">
      <h3>诊断</h3>
      <div id="protoDiagnostics" class="proto-diagnostics"></div>
    </section>
  `;

  return battleViewTemplate({
    shellClass: "prototype-shell",
    panelActionsHTML: `<span class="proto-badge">DEV</span>`,
    developerPanelHTML,
    overlayActionsHTML: `
      <button id="protoResultRestartBtn" type="button">${t("再来一局")}</button>
      <a class="btn-link overlay-home-link" href="/">${t("返回主菜单")}</a>
    `,
  });
}
