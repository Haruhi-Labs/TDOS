// ═══════════════════════════════════════════════════════════════
// 可选统一身份状态层
// · 浏览器只保存 PKCE 临时参数，不保存访问令牌或长期会话；
// · 登录态来自游戏站同源、HttpOnly 的独立 Cookie；
// · 任意接口不可用时均退回游客身份，不阻塞游戏。
// ═══════════════════════════════════════════════════════════════

const CLIENT_ID = "star-game";
const PKCE_STORAGE_KEY = "haruhi-game-pkce-v1";
const SESSION_ENDPOINT = "/api/game/session";
const REQUEST_TIMEOUT_MS = 5000;
const IDENTITY_CHANGE_EVENT = "haruhi:identity-change";

let identityState = { ready: false, user: null };
let refreshPromise = null;

function normalizeUser(value) {
  if (!value || typeof value !== "object") return null;
  const id = String(value.id || "").trim().slice(0, 160);
  const nickname = Array.from(String(value.nickname || "").replace(/\s+/g, " ").trim())
    .slice(0, 32)
    .join("");
  const avatar = typeof value.avatar === "string" ? value.avatar.slice(0, 512) : null;
  if (!id || !nickname) return null;
  return { id, nickname, avatar };
}

function publish(user, ready = true) {
  identityState = { ready, user: normalizeUser(user) };
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(IDENTITY_CHANGE_EVENT, { detail: getGameIdentity() }));
  }
  return getGameIdentity();
}

export function getGameIdentity() {
  return {
    ready: identityState.ready,
    user: identityState.user ? { ...identityState.user } : null,
  };
}

function timeoutSignal() {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    : undefined;
}

async function responseJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `身份服务请求失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return body;
}

export function refreshGameIdentity({ force = false } = {}) {
  if (!force && identityState.ready) return Promise.resolve(getGameIdentity());
  if (refreshPromise) return refreshPromise;
  refreshPromise = fetch(SESSION_ENDPOINT, {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal: timeoutSignal(),
  })
    .then(async (response) => {
      if (response.status === 401) return publish(null);
      const body = await responseJson(response);
      return publish(body.user);
    })
    .catch(() => publish(null))
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function callbackUrl() {
  const base = import.meta.env.BASE_URL || "/";
  return new URL(`${base}auth/callback`, window.location.origin).toString();
}

function identityAuthorizeUrl() {
  if (import.meta.env.VITE_IDENTITY_AUTHORIZE_URL) {
    return String(import.meta.env.VITE_IDENTITY_AUTHORIZE_URL);
  }
  if (window.location.hostname === "test.haruyuki.cn") {
    return "https://test.haruyuki.cn/news/sso/game";
  }
  if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    return "http://localhost:5204/news/sso/game";
  }
  return "https://haruyuki.cn/news/sso/game";
}

function expectedIssuer() {
  if (import.meta.env.VITE_IDENTITY_ISSUER) {
    return String(import.meta.env.VITE_IDENTITY_ISSUER).replace(/\/+$/, "");
  }
  return window.location.hostname === "test.haruyuki.cn"
    ? "https://test.haruyuki.cn"
    : "https://haruyuki.cn";
}

export async function beginGameIdentityLogin() {
  if (!window.crypto?.subtle || !window.sessionStorage) {
    throw new Error("当前浏览器不支持安全登录流程");
  }
  const verifier = randomToken();
  const state = randomToken();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const redirectUri = callbackUrl();
  const issuer = expectedIssuer();
  sessionStorage.setItem(
    PKCE_STORAGE_KEY,
    JSON.stringify({ verifier, state, redirectUri, issuer, createdAt: Date.now() }),
  );

  const authorize = new URL(identityAuthorizeUrl());
  authorize.searchParams.set("client_id", CLIENT_ID);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("code_challenge", base64Url(new Uint8Array(digest)));
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("state", state);
  window.location.assign(authorize.toString());
}

function readPkceState() {
  try {
    return JSON.parse(sessionStorage.getItem(PKCE_STORAGE_KEY) || "null");
  } catch (_error) {
    return null;
  }
}

export async function completeGameIdentityLogin(search = window.location.search) {
  const params = new URLSearchParams(search);
  const stored = readPkceState();
  sessionStorage.removeItem(PKCE_STORAGE_KEY);
  if (params.get("error")) throw new Error("统一身份登录已取消或被拒绝");
  if (!stored || Date.now() - Number(stored.createdAt) > 10 * 60 * 1000) {
    throw new Error("登录请求已失效，请重新发起登录");
  }
  if (!params.get("state") || params.get("state") !== stored.state) {
    throw new Error("登录状态校验失败，请重新发起登录");
  }
  if (!params.get("iss") || params.get("iss").replace(/\/+$/, "") !== stored.issuer) {
    throw new Error("身份提供方校验失败");
  }
  const code = params.get("code");
  if (!code) throw new Error("登录回调缺少授权码");

  const response = await fetch(`${SESSION_ENDPOINT}/exchange`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      clientId: CLIENT_ID,
      redirectUri: stored.redirectUri,
      code,
      codeVerifier: stored.verifier,
    }),
    signal: timeoutSignal(),
  });
  const body = await responseJson(response);
  return publish(body.user);
}

function readCookie(name) {
  const prefix = `${name}=`;
  for (const part of String(document.cookie || "").split(";")) {
    const item = part.trim();
    if (item.startsWith(prefix)) return decodeURIComponent(item.slice(prefix.length));
  }
  return "";
}

function csrfToken() {
  return readCookie("__Host-haruhi_game_csrf") || readCookie("haruhi_game_csrf");
}

async function gamePost(path) {
  const csrf = csrfToken();
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    body: "{}",
    signal: timeoutSignal(),
  });
  return responseJson(response);
}

export async function logoutGameIdentity() {
  try {
    await gamePost(`${SESSION_ENDPOINT}/logout`);
  } finally {
    publish(null);
  }
}

export async function requestGameIdentityTicket() {
  if (!identityState.ready) await refreshGameIdentity();
  if (!identityState.user) return null;
  try {
    const body = await gamePost("/api/game/ticket");
    return typeof body.ticket === "string" ? body.ticket : null;
  } catch (error) {
    if (error?.status === 401) publish(null);
    return null;
  }
}

export { IDENTITY_CHANGE_EVENT };
