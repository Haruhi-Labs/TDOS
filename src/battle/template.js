// 统一战斗视图模板:单人(solo.js)与在线(online.js)共用同一套 DOM 结构与 id。
// 战场界面改结构/加按钮只改这里,两种模式天然一致;id 一律无模式前缀。
// 模式差异经插槽注入:
//   shellClass         额外壳类(在线传 "online-shell")
//   hidden             初始隐藏(在线在大厅/战斗两视图间切换)
//   panelActionsHTML   面板顶部「← 主菜单」之后的额外按钮(单人:换阵容)
//   panelFooterHTML    面板底部额外内容(在线:队内通信)
//   mobileExtraHTML    移动端 HUD 的额外内容(在线:队内通信)
//   resultMetaClass    结算元信息行的附加类(在线:" result-match-meta")
//   overlayActionsHTML 结算卡操作区(单人:再来一局+返回主菜单;在线:返回大厅)
import { DEFAULT_WORLD_SIZE } from "../../shared/game-core.js";
import { t } from "../i18n.js";

const LOGICAL = DEFAULT_WORLD_SIZE;

function fleetRowHTML(slotKey, label) {
  return `
            <button type="button" class="fleet-row" data-ship="${slotKey}">
              <div class="fleet-row-head"><span class="fleet-name">${label}</span><span class="fleet-state"></span></div>
              <div class="fleet-gauges">
                <div class="fleet-gauge"><span class="fleet-glabel">${t("舰体")}</span><span class="fleet-bar"><i class="fleet-fill fleet-fill-hull"></i></span><span class="fleet-pct fleet-pct-hull">100%</span></div>
                <div class="fleet-gauge"><span class="fleet-glabel">${t("能量")}</span><span class="fleet-bar"><i class="fleet-fill fleet-fill-energy"></i></span><span class="fleet-pct fleet-pct-energy">100%</span></div>
              </div>
            </button>`;
}

export function battleViewTemplate({
  shellClass = "",
  hidden = false,
  panelActionsHTML = "",
  panelFooterHTML = "",
  mobileExtraHTML = "",
  resultMetaClass = "",
  overlayActionsHTML = "",
} = {}) {
  const shell = ["app-shell", shellClass, "battle-shell"].filter(Boolean).join(" ");
  return `
    <div id="battleView" class="${shell}"${hidden ? " hidden" : ""}>
      <aside class="panel compact-panel battle-panel">
        <h1>${t("射手座之日")}</h1>

        <div class="panel-actions">
          <a class="btn-link btn-link-home" href="/">${t("← 主菜单")}</a>
          ${panelActionsHTML}
        </div>

        <section class="status">
          <div><span>${t("舰体")}</span><strong id="hullValue">100%</strong></div>
          <div><span>${t("能量")}</span><strong id="energyValue">100%</strong></div>
          <div><span>${t("分离")}</span><strong id="splitValue">${t("编队")}</strong></div>
          <div><span>${t("战区")}</span><strong id="zoneValue">${t("战区{zone}", { zone: 5 })}</strong></div>
        </section>

        <div id="battleControls">
          <section class="controls slim-controls">
            <h2>${t("舰队控制")}</h2>
            <div id="shipQuickSwitch" class="ship-switch">
              <button type="button" class="ship-switch-btn" data-ship="main">${t("主舰")}</button>
              <button type="button" class="ship-switch-btn" data-ship="sub1">${t("副舰1")}</button>
              <button type="button" class="ship-switch-btn" data-ship="sub2">${t("副舰2")}</button>
            </div>
            <div class="btn-row">
              <button id="splitOneBtn">${t("一级分离")}</button>
              <button id="splitTwoBtn">${t("二级分离")}</button>
            </div>
            <div class="slider-wrap">
              <div class="slider-head"><label for="powerSlider">${t("推进功率")}</label><strong id="powerValue">100%</strong></div>
              <input id="powerSlider" type="range" min="25" max="140" step="1" value="100" />
            </div>
            <div class="zoom-control-row">
              <button id="zoomOutBtn" type="button">${t("缩小")}</button>
              <strong id="zoomValue">100%</strong>
              <button id="zoomInBtn" type="button">${t("放大")}</button>
            </div>
          </section>

          <section class="controls slim-controls">
            <h2>${t("技能")}</h2>
            <div class="btn-grid">
              <button id="flagshipBtn">${t("旗舰技能")}</button>
              <button id="subSkillBtn">${t("分舰技能")}</button>
              <button id="scoutBtn">${t("派出侦查机")}</button>
              <button id="autoScoutBtn" type="button">${t("自动侦查：{state}", { state: t("关") })}</button>
              <button id="brakeBtn" type="button" class="span-2">${t("急刹")}</button>
            </div>
          </section>
        </div>

        <section class="controls slim-controls fleet-section">
          <h2>${t("全队舰况")}</h2>
          <div id="fleetRoster" class="fleet-roster">
${fleetRowHTML("main", t("主舰"))}
${fleetRowHTML("sub1", t("副一"))}
${fleetRowHTML("sub2", t("副二"))}
          </div>
        </section>
        ${panelFooterHTML}
      </aside>

      <main class="game-wrap">
        <canvas id="gameCanvas" width="${LOGICAL}" height="${LOGICAL}"></canvas>
        <section id="mobileBattleHud" class="mobile-battle-hud" aria-live="polite">
          <div class="mobile-battle-head">
            <a class="mobile-menu-btn" href="/">${t("← 菜单")}</a>
            <div id="mobileBattleSummary" class="mobile-battle-summary">${t("主舰")} · ${t("区")}5 · ${t("推进")}100%</div>
            <button id="mobileCenterBtn" type="button" class="mobile-chip-btn">${t("跟随")}</button>
          </div>
          <div id="mobileShipSwitch" class="mobile-ship-switch">
            <button type="button" class="mobile-ship-btn" data-ship="main">${t("主舰")}</button>
            <button type="button" class="mobile-ship-btn" data-ship="sub1">${t("副一")}</button>
            <button type="button" class="mobile-ship-btn" data-ship="sub2">${t("副二")}</button>
          </div>
          <div class="mobile-action-grid">
            <button id="mobileSplitOneBtn" type="button">${t("分离1")}</button>
            <button id="mobileSplitTwoBtn" type="button">${t("分离2")}</button>
            <button id="mobileBrakeBtn" type="button">${t("急刹")}</button>
            <button id="mobileFlagshipBtn" type="button">${t("旗舰技")}</button>
            <button id="mobileSubSkillBtn" type="button">${t("分舰技")}</button>
            <button id="mobileScoutBtn" type="button">${t("侦察")}</button>
            <button id="mobileAutoScoutBtn" type="button">${t("自动侦察")}</button>
            <button id="mobileZoomOutBtn" type="button" class="mobile-zoom-btn">${t("缩小")}</button>
            <button id="mobileZoomInBtn" type="button" class="mobile-zoom-btn">${t("放大")}</button>
          </div>
          <div class="mobile-throttle-wrap">
            <span class="mobile-throttle-label">${t("推进")}</span>
            <button type="button" class="mobile-throttle-btn" data-throttle="40">40</button>
            <button type="button" class="mobile-throttle-btn" data-throttle="70">70</button>
            <button type="button" class="mobile-throttle-btn" data-throttle="100">100</button>
            <button type="button" class="mobile-throttle-btn" data-throttle="120">120</button>
            <button type="button" class="mobile-throttle-btn" data-throttle="140">140</button>
          </div>
          ${mobileExtraHTML}
          <div id="mobileBattleHint" class="mobile-battle-hint">${t("点舰船切换 · 点战场下航线 · 点右上小地图选战区")}</div>
        </section>
        <div id="overlay" class="overlay hidden" role="dialog" aria-modal="true">
          <div id="resultCard" class="result-card">
            <div class="result-glow" aria-hidden="true"></div>
            <div class="result-head">
              <span id="resultEyebrow" class="result-eyebrow"></span>
              <h2 id="overlayTitle" class="result-title"></h2>
              <p id="resultSub" class="result-sub"></p>
              <div id="resultDiff" class="result-diff${resultMetaClass}"></div>
            </div>
            <div id="resultVersus" class="result-versus"></div>
            <div class="overlay-actions">
              ${overlayActionsHTML}
            </div>
          </div>
        </div>
      </main>
    </div>
  `;
}
