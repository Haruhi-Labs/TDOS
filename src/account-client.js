export class AccountApiError extends Error {
  constructor(status, code, message) {
    super(message || "Account request failed.");
    this.name = "AccountApiError";
    this.status = status;
    this.code = code || "account_request_failed";
  }
}

export function createAccountClient({ baseUrl = "", fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required for account requests.");
  }

  async function request(path, { method = "GET", body, headers = {} } = {}) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      body,
      headers,
      credentials: "same-origin",
    });
    if (response.status === 204) return null;
    let payload = null;
    try {
      payload = await response.json();
    } catch (_error) {
      // Error responses are still normalized below.
    }
    if (!response.ok) {
      throw new AccountApiError(response.status, payload?.error?.code, payload?.error?.message);
    }
    return payload;
  }

  function json(path, method, value) {
    return request(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value || {}),
    });
  }

  return {
    async getMe() {
      try {
        return (await request("/api/me"))?.user || null;
      } catch (error) {
        if (error instanceof AccountApiError && error.status === 401) return null;
        throw error;
      }
    },
    async register({ username, password, loadout }) {
      return (await json("/api/auth/register", "POST", { username, password, loadout }))?.user;
    },
    async login({ username, password }) {
      return (await json("/api/auth/login", "POST", { username, password }))?.user;
    },
    async logout() {
      await request("/api/auth/logout", { method: "POST" });
    },
    async updateProfile(patch) {
      return (await json("/api/profile", "PATCH", patch))?.user;
    },
    async uploadAvatar(file) {
      const mimeType = String(file?.type || "").toLowerCase();
      if (!file || !mimeType) {
        throw new AccountApiError(400, "invalid_avatar", "Choose a PNG, JPEG, or WebP image first.");
      }
      return (await request("/api/profile/avatar", {
        method: "POST",
        headers: { "Content-Type": mimeType },
        body: file,
      }))?.user;
    },
    async getUser(userId, mode = "pvp2v2") {
      return (await request(`/api/users/${encodeURIComponent(userId)}?mode=${encodeURIComponent(mode)}`))?.user || null;
    },
    async getLeaderboard(mode = "pvp2v2", limit = 100) {
      return request(`/api/leaderboard?mode=${encodeURIComponent(mode)}&limit=${encodeURIComponent(limit)}`);
    },
  };
}

export const accountClient = createAccountClient();
