import { accountClient, AccountApiError } from "./account-client.js";
import { getProfile } from "./profile.js";
import { startStarfield } from "./starfield.js";

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function validateRegistration({ password, confirmPassword }) {
  const safePassword = String(password || "");
  if (safePassword.length < PASSWORD_MIN_LENGTH || safePassword.length > PASSWORD_MAX_LENGTH) {
    return { valid: false, code: "invalid_password" };
  }
  if (safePassword !== String(confirmPassword || "")) {
    return { valid: false, code: "password_mismatch" };
  }
  return { valid: true, code: null };
}

function accountErrorMessage(error) {
  if (error instanceof AccountApiError) {
    if (error.code === "username_taken") return "该用户名已被使用。";
    if (error.code === "invalid_credentials") return "用户名或密码不正确。";
    if (error.code === "login_throttled") return "登录尝试过多，请稍后再试。";
    if (error.code === "invalid_password") return "密码长度需为 8 至 128 个字符。";
    return error.message;
  }
  return "请求失败，请确认服务已启动后重试。";
}

function validationMessage(code) {
  if (code === "invalid_password") return "密码长度需为 8 至 128 个字符。";
  if (code === "password_mismatch") return "两次输入的密码不一致。";
  return "";
}

function template({ mode, message, busy, profile, canRetry }) {
  const registering = mode === "register";
  const submitLabel = registering ? "注册并进入" : "登录进入";
  return `
    <section class="page-stage auth-page" aria-labelledby="authTitle">
      <canvas class="page-stars" aria-hidden="true"></canvas>
      <div class="page-bg" aria-hidden="true"></div>
      <div class="page-frame auth-frame">
        <header class="auth-heading">
          <p>THE DAY OF SAGITTARIUS</p>
          <h1 id="authTitle">指挥官认证</h1>
          <span>ACCESS TERMINAL</span>
        </header>
        <section class="account-surface auth-surface">
          <div class="auth-mode-tabs" role="tablist" aria-label="账号操作">
            <button type="button" role="tab" aria-selected="${!registering}" class="${!registering ? "active" : ""}" data-auth-mode="login" ${busy ? "disabled" : ""}>登录</button>
            <button type="button" role="tab" aria-selected="${registering}" class="${registering ? "active" : ""}" data-auth-mode="register" ${busy ? "disabled" : ""}>注册</button>
          </div>
          <form class="auth-form" novalidate>
            <label class="pv-field"><span class="pv-label">用户名</span><input name="username" maxlength="16" value="${escapeHtml(profile.nickname)}" autocomplete="username" required ${busy ? "disabled" : ""} /></label>
            <label class="pv-field"><span class="pv-label">密码</span><input name="password" type="password" minlength="8" maxlength="128" autocomplete="${registering ? "new-password" : "current-password"}" required ${busy ? "disabled" : ""} /></label>
            ${registering ? `<label class="pv-field"><span class="pv-label">确认密码</span><input name="confirmPassword" type="password" minlength="8" maxlength="128" autocomplete="new-password" required ${busy ? "disabled" : ""} /></label>` : ""}
            <button type="submit" class="account-button account-button-primary auth-submit" ${busy ? "disabled" : ""}>${busy ? "处理中..." : submitLabel}</button>
          </form>
          <p class="account-message auth-message" role="status">${escapeHtml(message)}</p>
          ${canRetry ? `<button type="button" class="account-link auth-retry" data-auth-retry ${busy ? "disabled" : ""}>重新检查会话</button>` : ""}
        </section>
      </div>
    </section>`;
}

export function mount(root, { onAuthenticated, initialMessage = "", onRetry = null } = {}) {
  let mode = "login";
  let message = initialMessage;
  let busy = false;
  let eventAbort = null;
  let starfieldAbort = null;

  function render() {
    eventAbort?.abort();
    starfieldAbort?.abort();
    root.innerHTML = template({
      mode,
      message,
      busy,
      profile: getProfile(),
      canRetry: typeof onRetry === "function",
    });
    eventAbort = new AbortController();
    starfieldAbort = new AbortController();
    const { signal } = eventAbort;
    startStarfield(root.querySelector(".page-stars"), starfieldAbort.signal);

    for (const button of root.querySelectorAll("[data-auth-mode]")) {
      button.addEventListener("click", () => {
        mode = button.dataset.authMode === "register" ? "register" : "login";
        message = "";
        render();
      }, { signal });
    }

    root.querySelector(".auth-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;
      const form = new FormData(event.currentTarget);
      const username = String(form.get("username") || "");
      const password = String(form.get("password") || "");
      const confirmPassword = String(form.get("confirmPassword") || "");
      if (mode === "register") {
        const validation = validateRegistration({ password, confirmPassword });
        if (!validation.valid) {
          message = validationMessage(validation.code);
          render();
          return;
        }
      }

      busy = true;
      message = "";
      render();
      try {
        const user = mode === "register"
          ? await accountClient.register({ username, password, loadout: getProfile().loadout })
          : await accountClient.login({ username, password });
        onAuthenticated?.(user);
      } catch (error) {
        busy = false;
        message = accountErrorMessage(error);
        render();
      }
    }, { signal });

    root.querySelector("[data-auth-retry]")?.addEventListener("click", async () => {
      if (busy || typeof onRetry !== "function") return;
      busy = true;
      message = "";
      render();
      try {
        await onRetry();
      } catch (error) {
        busy = false;
        message = accountErrorMessage(error);
        render();
      }
    }, { signal });
  }

  render();
  return () => {
    eventAbort?.abort();
    starfieldAbort?.abort();
  };
}
