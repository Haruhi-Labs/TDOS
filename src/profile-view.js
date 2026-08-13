// ═══════════════════════════════════════════════════════════════
// 指挥官档案（路由 /profile）
// 只管身份：呼号 + 默认阵营。出战编队在进入对战时（选角页）挑选并自动记忆，
// 不在此处编辑。
// ═══════════════════════════════════════════════════════════════

import { getProfile, setNickname, setFaction, getFaction } from "./profile.js";
import { startStarfield } from "./starfield.js";
import { isMobile } from "./mobile.js";
import { t } from "./i18n.js";
import {
  beginGameIdentityLogin,
  getGameIdentity,
  logoutGameIdentity,
  refreshGameIdentity,
} from "./identity.js";

function accountPanel(identity) {
  const user = identity.user;
  if (!user) {
    return `
      <section class="pv-account pv-account-guest">
        <div>
          <span class="pv-account-kicker">${t("统一身份")}</span>
          <strong>${t("当前以游客身份游玩")}</strong>
          <p>${t("登录为可选项；本地编队、阵营和设置不会因登录或退出而删除。")}</p>
        </div>
        <button id="pvIdentityLogin" type="button">${t("统一身份登录 / 注册")}</button>
      </section>
    `;
  }
  const avatar = safeAvatar(user.avatar)
    ? `<img class="pv-account-avatar" src="${escapeAttr(user.avatar)}" alt="" />`
    : `<span class="pv-account-avatar pv-account-avatar-fallback" aria-hidden="true">${escapeHtml(user.nickname.slice(0, 1))}</span>`;
  return `
    <section class="pv-account pv-account-signed-in">
      ${avatar}
      <div class="pv-account-copy">
        <span class="pv-account-kicker">${t("统一身份已连接")}</span>
        <strong title="${escapeAttr(user.nickname)}">${escapeHtml(user.nickname)}</strong>
        <p>${escapeHtml(user.id)} · ${t("联机昵称由统一身份提供")}</p>
      </div>
      <button id="pvIdentityLogout" type="button">${t("退出登录")}</button>
    </section>
  `;
}

// 移动端专属：满宽表单 + 大触控目标（复用同样的 #pvNickname / .pv-faction-btn 钩子，逻辑共享）
function mobileTemplate(profile, identity) {
  const nickname = identity.user?.nickname || profile.nickname;
  const locked = identity.user ? " disabled aria-describedby=\"pvIdentityNote\"" : "";
  return `
    <section class="mpage">
      <canvas class="page-stars" aria-hidden="true"></canvas>
      <div class="mpage-top">
        <a class="mpage-back" href="/">‹</a>
        <h1 class="mpage-title">${t("指挥官档案")}</h1>
      </div>
      <div class="mpage-body">
        ${accountPanel(identity)}
        <label class="mfield">
          <span class="mfield-label">${t("呼号")}</span>
          <input id="pvNickname" type="text" maxlength="32" placeholder="${t("输入呼号")}" autocomplete="off" value="${escapeAttr(nickname)}"${locked} />
          ${identity.user ? `<small id="pvIdentityNote" class="pv-identity-note">${t("已登录时昵称以主站个人资料为准。")}</small>` : ""}
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

function template(profile, identity) {
  const nickname = identity.user?.nickname || profile.nickname;
  const locked = identity.user ? " disabled aria-describedby=\"pvIdentityNote\"" : "";
  return `
    <section class="page-stage">
      <canvas class="page-stars" aria-hidden="true"></canvas>
      <div class="page-bg" aria-hidden="true"></div>
      <div class="page-frame">
        <a class="page-back" href="/">${t("‹ 返回主菜单")}</a>
        <h1 class="page-title">${t("指挥官档案")}</h1>

        <div class="page-scroll">
        ${accountPanel(identity)}
        <div class="page-card">
          <label class="pv-field">
            <span class="pv-label">${t("呼号")}</span>
            <input id="pvNickname" type="text" maxlength="32" placeholder="${t("输入呼号")}" autocomplete="off" value="${escapeAttr(nickname)}"${locked} />
            ${identity.user ? `<small id="pvIdentityNote" class="pv-identity-note">${t("已登录时昵称以主站个人资料为准。")}</small>` : ""}
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

function escapeHtml(value) {
  return escapeAttr(value).replace(/>/g, "&gt;");
}

function safeAvatar(value) {
  return typeof value === "string" && /^\/uploads\/avatars\/[A-Za-z0-9._-]+\.webp$/.test(value);
}

export async function mount(root) {
  await refreshGameIdentity();
  const identity = getGameIdentity();
  root.innerHTML = (isMobile() ? mobileTemplate : template)(getProfile(), identity);
  const ac = new AbortController();
  const { signal } = ac;
  startStarfield(root.querySelector(".page-stars"), signal);

  const input = root.querySelector("#pvNickname");
  const factionBtns = Array.from(root.querySelectorAll(".pv-faction-btn"));

  function renderFaction() {
    const faction = getFaction();
    for (const btn of factionBtns) btn.classList.toggle("active", btn.dataset.color === faction);
  }

  if (!identity.user) {
    input.addEventListener("input", () => setNickname(input.value), { signal });
    input.addEventListener(
      "change",
      () => {
        setNickname(input.value);
        input.value = getProfile().nickname;
      },
      { signal },
    );
  }

  root.querySelector("#pvIdentityLogin")?.addEventListener(
    "click",
    (event) => {
      event.currentTarget.disabled = true;
      beginGameIdentityLogin().catch((error) => {
        event.currentTarget.disabled = false;
        event.currentTarget.textContent = error?.message || t("无法发起登录");
      });
    },
    { signal },
  );
  root.querySelector("#pvIdentityLogout")?.addEventListener(
    "click",
    async (event) => {
      event.currentTarget.disabled = true;
      await logoutGameIdentity().catch(() => {});
      window.location.reload();
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
