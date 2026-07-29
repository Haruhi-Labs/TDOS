import { COMPETITIVE_MODES, AccountStoreError } from "./account-store.js";

const JSON_BODY_LIMIT = 64 * 1024;
const AVATAR_BODY_LIMIT = 2 * 1024 * 1024;
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_ATTEMPT_LIMIT = 8;
const REGISTRATION_WINDOW_MS = 60_000;
const REGISTRATION_ATTEMPT_LIMIT = 4;

function sendJson(response, status, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(body);
}

function sendEmpty(response, status, headers = {}) {
  response.writeHead(status, { "Cache-Control": "no-store", ...headers });
  response.end();
}

function parseCookies(value) {
  const cookies = new Map();
  for (const part of String(value || "").split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    try {
      cookies.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
    } catch (_error) {
      // Ignore malformed cookie values and continue without their session data.
    }
  }
  return cookies;
}

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(request.headers["content-length"] || 0);
    if (declaredLength > limit) {
      reject(Object.assign(new Error("Request body is too large."), { status: 413, code: "body_too_large" }));
      request.resume();
      return;
    }
    const chunks = [];
    let received = 0;
    request.on("data", (chunk) => {
      received += chunk.length;
      if (received > limit) {
        reject(Object.assign(new Error("Request body is too large."), { status: 413, code: "body_too_large" }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function readJson(request) {
  const body = await readBody(request, JSON_BODY_LIMIT);
  try {
    return JSON.parse(body.toString("utf8") || "{}");
  } catch (_error) {
    throw Object.assign(new Error("Request body must be valid JSON."), { status: 400, code: "invalid_json" });
  }
}

function allowedMode(mode) {
  return COMPETITIVE_MODES.includes(mode) ? mode : "pvp2v2";
}

function serializePrivateUser(store, avatarStorage, user) {
  const stats = {};
  const elo = {};
  for (const mode of COMPETITIVE_MODES) {
    const rating = store.getRating(user.id, mode);
    elo[mode] = rating.elo;
    stats[mode] = { ...rating, rank: store.getRank(user.id, mode) };
  }
  return {
    id: user.id,
    username: user.username,
    signature: user.signature,
    avatarUrl: avatarStorage.urlForKey(user.avatarKey),
    loadout: user.loadout,
    elo,
    stats,
  };
}

function serializePublicUser(store, avatarStorage, userId, mode) {
  const user = store.getPublicUser(userId, mode);
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    avatarUrl: avatarStorage.urlForKey(user.avatarKey),
    elo: user.elo,
    wins: user.wins,
    losses: user.losses,
    games: user.games,
    rank: store.getRank(user.id, mode),
  };
}

function sessionCookie(token, { secure = false, maxAge = 0 } = {}) {
  const attributes = ["tdos_session=" + encodeURIComponent(token), "Path=/", "HttpOnly", "SameSite=Lax"];
  if (maxAge >= 0) attributes.push(`Max-Age=${Math.floor(maxAge)}`);
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

function assertSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch (_error) {
    throw Object.assign(new Error("Invalid request origin."), { status: 403, code: "invalid_origin" });
  }
  if (parsed.host !== request.headers.host) {
    throw Object.assign(new Error("Cross-origin requests are not allowed."), { status: 403, code: "invalid_origin" });
  }
}

export function createAccountApi({ store, avatarStorage, secureCookies = false, now = () => Date.now() }) {
  const loginAttempts = new Map();
  const registrations = new Map();

  function requestAddress(request) {
    const remoteAddress = request.socket.remoteAddress || "unknown";
    const isLoopbackProxy = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
    if (!isLoopbackProxy) return remoteAddress;
    const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
    return forwarded || remoteAddress;
  }

  function authenticatedUser(request) {
    return store.getSessionUser(parseCookies(request.headers.cookie).get("tdos_session"));
  }

  function requireUser(request) {
    const user = authenticatedUser(request);
    if (!user) throw Object.assign(new Error("Authentication is required."), { status: 401, code: "authentication_required" });
    return user;
  }

  function reserveLoginAttempt(request) {
    const key = requestAddress(request);
    const current = loginAttempts.get(key);
    const state = current?.resetAt > now() ? current : { count: 0, resetAt: now() + LOGIN_WINDOW_MS };
    if (state.count >= LOGIN_ATTEMPT_LIMIT) return false;
    loginAttempts.set(key, { ...state, count: state.count + 1 });
    return true;
  }

  function reserveRegistration(request) {
    const key = requestAddress(request);
    const current = registrations.get(key);
    const state = current?.resetAt > now() ? current : { count: 0, resetAt: now() + REGISTRATION_WINDOW_MS };
    if (state.count >= REGISTRATION_ATTEMPT_LIMIT) return false;
    registrations.set(key, { ...state, count: state.count + 1 });
    return true;
  }

  return async function handleAccountApi(request, response) {
    const url = new URL(request.url || "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) return false;
    try {
      if (request.method === "GET" && url.pathname.startsWith("/api/avatars/")) {
        const image = avatarStorage.read(decodeURIComponent(url.pathname.slice("/api/avatars/".length)));
        if (!image) {
          sendJson(response, 404, { error: { code: "avatar_not_found", message: "Avatar not found." } });
        } else {
          response.writeHead(200, { "Content-Type": image.mimeType, "Content-Length": image.body.length, "Cache-Control": "public, max-age=86400" });
          response.end(image.body);
        }
        return true;
      }
      if (request.method === "POST" && url.pathname === "/api/auth/register") {
        assertSameOrigin(request);
        if (!reserveRegistration(request)) throw Object.assign(new Error("Too many registration attempts."), { status: 429, code: "registration_throttled" });
        const payload = await readJson(request);
        const user = await store.register(payload);
        const session = store.createSession(user.id);
        sendJson(response, 201, { user: serializePrivateUser(store, avatarStorage, user) }, {
          "Set-Cookie": sessionCookie(session.token, { secure: secureCookies, maxAge: (session.expiresAt - now()) / 1000 }),
        });
        return true;
      }
      if (request.method === "POST" && url.pathname === "/api/auth/login") {
        assertSameOrigin(request);
        if (!reserveLoginAttempt(request)) throw Object.assign(new Error("Too many login attempts."), { status: 429, code: "login_throttled" });
        const user = await store.authenticate(await readJson(request));
        if (!user) {
          throw Object.assign(new Error("Invalid username or password."), { status: 401, code: "invalid_credentials" });
        }
        const session = store.createSession(user.id);
        sendJson(response, 200, { user: serializePrivateUser(store, avatarStorage, user) }, {
          "Set-Cookie": sessionCookie(session.token, { secure: secureCookies, maxAge: (session.expiresAt - now()) / 1000 }),
        });
        return true;
      }
      if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        assertSameOrigin(request);
        store.revokeSession(parseCookies(request.headers.cookie).get("tdos_session"));
        sendEmpty(response, 204, { "Set-Cookie": sessionCookie("", { secure: secureCookies, maxAge: 0 }) });
        return true;
      }
      if (request.method === "GET" && url.pathname === "/api/me") {
        const user = requireUser(request);
        sendJson(response, 200, { user: serializePrivateUser(store, avatarStorage, user) });
        return true;
      }
      if (request.method === "GET" && url.pathname === "/api/profile") {
        const user = requireUser(request);
        sendJson(response, 200, { user: serializePrivateUser(store, avatarStorage, user) });
        return true;
      }
      if (request.method === "PATCH" && url.pathname === "/api/profile") {
        assertSameOrigin(request);
        const user = requireUser(request);
        const updated = store.updateProfile(user.id, await readJson(request));
        sendJson(response, 200, { user: serializePrivateUser(store, avatarStorage, updated) });
        return true;
      }
      if (request.method === "POST" && url.pathname === "/api/profile/avatar") {
        assertSameOrigin(request);
        const user = requireUser(request);
        const avatar = avatarStorage.save(await readBody(request, AVATAR_BODY_LIMIT), request.headers["content-type"]);
        const previousAvatarKey = user.avatarKey;
        const updated = store.setAvatarKey(user.id, avatar.key);
        if (previousAvatarKey && previousAvatarKey !== avatar.key) avatarStorage.remove(previousAvatarKey);
        sendJson(response, 200, { user: serializePrivateUser(store, avatarStorage, updated) });
        return true;
      }
      if (request.method === "GET" && url.pathname.startsWith("/api/users/")) {
        const user = serializePublicUser(store, avatarStorage, decodeURIComponent(url.pathname.slice("/api/users/".length)), allowedMode(url.searchParams.get("mode")));
        if (!user) throw Object.assign(new Error("User not found."), { status: 404, code: "user_not_found" });
        sendJson(response, 200, { user });
        return true;
      }
      if (request.method === "GET" && url.pathname === "/api/leaderboard") {
        const mode = allowedMode(url.searchParams.get("mode"));
        const entries = store.getLeaderboard(mode, url.searchParams.get("limit")).map((entry) => ({
          ...entry,
          avatarUrl: avatarStorage.urlForKey(entry.avatarKey),
          avatarKey: undefined,
        }));
        sendJson(response, 200, { mode, entries });
        return true;
      }
      sendJson(response, 404, { error: { code: "api_not_found", message: "API endpoint not found." } });
      return true;
    } catch (error) {
      const status = error.status || (error instanceof AccountStoreError && error.code === "username_cooldown" ? 409 : 400);
      sendJson(response, status, { error: { code: error.code || "invalid_request", message: error.message || "Request failed." } });
      return true;
    }
  };
}

export function sessionTokenFromRequest(request) {
  return parseCookies(request?.headers?.cookie).get("tdos_session") || null;
}
