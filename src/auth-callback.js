import {
  beginGameIdentityLogin,
  completeGameIdentityLogin,
} from "./identity.js";

function template() {
  return `
    <main class="auth-callback">
      <section class="auth-callback-card">
        <p class="auth-callback-kicker">统一身份认证</p>
        <h1>正在连接指挥官身份</h1>
        <p id="authCallbackStatus" role="status">正在校验一次性授权码…</p>
        <div id="authCallbackActions" class="auth-callback-actions" hidden>
          <button id="authCallbackRetry" type="button">重新登录</button>
          <a href="/profile">返回游客档案</a>
        </div>
      </section>
    </main>
  `;
}

export async function mount(root, { navigate }) {
  root.innerHTML = template();
  const status = root.querySelector("#authCallbackStatus");
  const actions = root.querySelector("#authCallbackActions");
  const retry = root.querySelector("#authCallbackRetry");
  try {
    await completeGameIdentityLogin();
    status.textContent = "登录成功，正在返回指挥官档案…";
    navigate("/profile", { replace: true });
  } catch (error) {
    status.textContent = error?.message || "登录失败，请重试。";
    actions.hidden = false;
    retry.addEventListener("click", () => {
      retry.disabled = true;
      beginGameIdentityLogin().catch((loginError) => {
        retry.disabled = false;
        status.textContent = loginError?.message || "无法发起登录";
      });
    });
  }
}
