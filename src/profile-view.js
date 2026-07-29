import { getFaction, getProfile, saveProfile, setFaction } from "./profile.js";
import { accountClient, AccountApiError } from "./account-client.js";
import { startStarfield } from "./starfield.js";
import { isMobile } from "./mobile.js";
import { mountRouteFluidBackdrop } from "./effects/fluid-reveal/routeBackdrop.js";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statLine(label, stat) {
  const safe = stat || { elo: 1000, wins: 0, losses: 0, games: 0, rank: "-" };
  return `<div class="account-stat"><span>${label}</span><strong>${safe.elo || 1000}</strong><small>#${safe.rank || "-"} / ${safe.wins || 0}W ${safe.losses || 0}L</small></div>`;
}

function avatarHtml(user) {
  if (user?.avatarUrl) {
    return `<img class="account-avatar" src="${escapeHtml(user.avatarUrl)}" alt="${escapeHtml(user.username)}" />`;
  }
  return `<span class="account-avatar account-avatar-fallback" aria-hidden="true">${escapeHtml(String(user?.username || "?").slice(0, 1).toUpperCase())}</span>`;
}

function accountTemplate(account) {
  return `
    <section class="account-surface account-member" aria-labelledby="accountHeading">
      <div class="account-identity">
        <label class="account-avatar-control" title="更换头像">${avatarHtml(account)}<input id="accountAvatarInput" type="file" accept="image/png,image/jpeg,image/webp" /></label>
        <div><p>COMMANDER ACCOUNT</p><h2 id="accountHeading">${escapeHtml(account.username)}</h2><span class="account-status">已登录</span></div>
        <button type="button" class="account-icon-button" data-account-action="logout" title="退出登录" aria-label="退出登录">↪</button>
      </div>
      <form id="accountProfileForm" class="account-profile-form">
        <label class="pv-field"><span class="pv-label">用户名</span><input id="accountProfileUsername" maxlength="16" value="${escapeHtml(account.username)}" autocomplete="username" /></label>
        <label class="pv-field"><span class="pv-label">个性签名</span><input id="accountSignature" maxlength="160" value="${escapeHtml(account.signature)}" /></label>
        <div class="account-actions"><button type="submit" class="account-button account-button-primary">保存资料</button><a class="account-link" href="/leaderboard">查看排行榜</a></div>
      </form>
      <div class="account-stats" aria-label="个人战绩">${statLine("2v2", account.stats?.pvp2v2)}${statLine("3v3", account.stats?.stellar3v3)}</div>
    </section>`;
}

function template(profile, account, message) {
  return `
    <section class="page-stage account-profile-page">
      <canvas class="page-stars" aria-hidden="true"></canvas>
      <div class="page-bg" aria-hidden="true"></div>
      <div class="page-frame">
        <a class="page-back" href="/">返回主菜单</a>
        <h1 class="page-title">指挥官档案</h1>
        <div class="page-scroll">
          ${accountTemplate(account)}
          <section class="page-card profile-local-settings">
            <div class="account-section-head"><p>LOCAL LOADOUT</p><h2>本机出战偏好</h2></div>
            <label class="pv-field"><span class="pv-label">本地呼号</span><input id="pvNickname" maxlength="16" value="${escapeHtml(profile.nickname)}" autocomplete="off" /></label>
            <div class="pv-field"><span class="pv-label">默认阵营</span><div class="pv-faction"><button type="button" class="pv-faction-btn blue" data-color="blue">蓝队</button><button type="button" class="pv-faction-btn red" data-color="red">红队</button></div></div>
            <p class="pv-note">编队会在进入对战时选择；登录后会同步到账号，作为下次出战的默认配置。</p>
          </section>
          <p class="account-message" role="status">${escapeHtml(message || "")}</p>
        </div>
      </div>
    </section>`;
}

function accountErrorMessage(error) {
  if (error instanceof AccountApiError) {
    if (error.code === "username_taken") return "该用户名已被使用。";
    if (error.code === "username_cooldown") return "用户名每 30 天只能修改一次。";
    if (error.code === "invalid_credentials") return "用户名或密码不正确。";
    if (error.code === "login_throttled") return "登录尝试过多，请稍后再试。";
    return error.message;
  }
  return "请求失败，请确认服务已启动后重试。";
}

export async function mount(root, { onSignedOut } = {}) {
  let account = null;
  let message = "";
  let eventAbort = null;
  let starfieldAbort = null;
  let fluidBackdrop = null;

  try {
    account = await accountClient.getMe();
  } catch (error) {
    message = accountErrorMessage(error);
  }

  if (!account) {
    onSignedOut?.();
    return () => {};
  }

  function syncAccountToLocal(user) {
    if (!user) return;
    saveProfile({ username: undefined, nickname: user.username, loadout: user.loadout || getProfile().loadout });
  }

  function render() {
    eventAbort?.abort();
    starfieldAbort?.abort();
    fluidBackdrop?.destroy();
    root.innerHTML = template(getProfile(), account, message);
    eventAbort = new AbortController();
    const { signal } = eventAbort;
    starfieldAbort = new AbortController();
    startStarfield(root.querySelector(".page-stars"), starfieldAbort.signal);
    fluidBackdrop = mountRouteFluidBackdrop(root.querySelector(".account-profile-page"), {
      logLabel: "Account profile fluid backdrop",
      onReady: () => starfieldAbort.abort(),
    });

    const nicknameInput = root.querySelector("#pvNickname");
    nicknameInput?.addEventListener("input", () => saveProfile({ nickname: nicknameInput.value }), { signal });
    for (const button of root.querySelectorAll(".pv-faction-btn")) {
      button.classList.toggle("active", button.dataset.color === getFaction());
      button.addEventListener("click", () => {
        setFaction(button.dataset.color);
        for (const item of root.querySelectorAll(".pv-faction-btn")) item.classList.toggle("active", item.dataset.color === getFaction());
      }, { signal });
    }

    async function run(action) {
      message = "";
      try {
        account = await action();
        syncAccountToLocal(account);
        message = "资料已同步。";
      } catch (error) {
        if (error instanceof AccountApiError && error.status === 401) {
          onSignedOut?.();
          return;
        }
        message = accountErrorMessage(error);
      }
      render();
    }

    root.querySelector('[data-account-action="logout"]')?.addEventListener("click", async () => {
      try {
        await accountClient.logout();
        account = null;
        onSignedOut?.();
        return;
      } catch (error) {
        message = accountErrorMessage(error);
      }
      render();
    }, { signal });
    root.querySelector("#accountProfileForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const username = root.querySelector("#accountProfileUsername")?.value || "";
      const signature = root.querySelector("#accountSignature")?.value || "";
      run(() => accountClient.updateProfile({ username, signature, loadout: getProfile().loadout }));
    }, { signal });
    root.querySelector("#accountAvatarInput")?.addEventListener("change", () => {
      const file = root.querySelector("#accountAvatarInput")?.files?.[0];
      if (file) run(() => accountClient.uploadAvatar(file));
    }, { signal });
  }

  render();
  return () => {
    eventAbort?.abort();
    starfieldAbort?.abort();
    fluidBackdrop?.destroy();
  };
}
