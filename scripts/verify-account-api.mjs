import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAccountApi } from "../server/account-api.js";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function eventually(fn, timeoutMs = 8000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await wait(30);
  }
  throw lastError || new Error("Timed out waiting for condition");
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.on("error", reject);
  });
}

async function stopServer(child) {
  if (!child) return;
  if (child.exitCode === null) {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    } else {
      child.kill("SIGTERM");
    }
  }
  await eventually(() => child.exitCode !== null, 5000);
}

async function verifyPrehashLoginThrottle() {
  const pendingAuthentications = [];
  const api = createAccountApi({
    store: {
      authenticate: ({ username }) => new Promise((resolve) => pendingAuthentications.push({ username, resolve })),
      createSession: () => ({ token: "test-session", expiresAt: Date.now() + 60_000 }),
      getRating: () => ({ elo: 1000, wins: 0, losses: 0, games: 0 }),
      getRank: () => 1,
    },
    avatarStorage: { urlForKey: () => null },
  });
  const server = createHttpServer((request, response) => {
    api(request, response).then((handled) => {
      if (!handled) response.writeHead(404).end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const throttleOrigin = `http://127.0.0.1:${address.port}`;
  const failedRequests = Array.from({ length: 7 }, () => fetch(`${throttleOrigin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "Haruhi", password: "not-the-password" }),
  }));
  const successfulRequest = fetch(`${throttleOrigin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "Yuki", password: "correct-password" }),
  });
  let followupRequest = null;
  try {
    await eventually(() => pendingAuthentications.length === 8);
    for (const pending of pendingAuthentications.filter((entry) => entry.username === "Haruhi")) pending.resolve(null);
    for (const response of await Promise.all(failedRequests)) assert.equal(response.status, 401, "failed attempts should resolve normally");
    pendingAuthentications.find((entry) => entry.username === "Yuki").resolve({
      id: "yuki-id", username: "Yuki", signature: "", avatarKey: null, loadout: null,
    });
    assert.equal((await successfulRequest).status, 200, "the valid login should resolve normally");
    followupRequest = fetch(`${throttleOrigin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Haruhi", password: "not-the-password" }),
    });
    assert.equal(
      await Promise.race([followupRequest.then((response) => response.status), wait(250).then(() => "still_pending")]),
      429,
      "a successful login must not reopen pre-hash capacity after concurrent failures",
    );
  } finally {
    for (const pending of pendingAuthentications) pending.resolve(null);
    await Promise.allSettled([...failedRequests, successfulRequest, followupRequest]);
    await new Promise((resolve) => server.close(resolve));
  }
}

const tempDir = await mkdtemp(path.join(tmpdir(), "tdos-account-api-"));
const port = await reservePort();
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["server/server.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    USER_DB_PATH: path.join(tempDir, "accounts.sqlite"),
    USER_AVATAR_DIR: path.join(tempDir, "avatars"),
    SESSION_SECRET: "api-test-session-secret-that-is-long-enough",
    NODE_ENV: "production",
    SESSION_COOKIE_SECURE: "false",
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let output = "";
child.stdout.on("data", (chunk) => { output += String(chunk); });
child.stderr.on("data", (chunk) => { output += String(chunk); });

try {
  await eventually(() => output.includes(`:${port}`));

  const register = await fetch(`${origin}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "Haruhi", password: "strong-password-123" }),
  });
  assert.equal(register.status, 201, "registration should create an account over HTTP");
  const cookie = register.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie?.startsWith("tdos_session="), "registration should issue an HttpOnly session cookie");
  assert.doesNotMatch(
    register.headers.get("set-cookie") || "",
    /(?:^|;)\s*Secure(?:;|$)/i,
    "SESSION_COOKIE_SECURE=false should allow HTTP session persistence",
  );
  const created = await register.json();
  assert.equal(created.user.username, "Haruhi", "registration response should return the authenticated user");

  for (const username of ["RateOne", "RateTwo", "RateThree"]) {
    const response = await fetch(`${origin}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "strong-password-123" }),
    });
    assert.equal(response.status, 201, "registration quota should allow the configured number of attempts");
  }
  const rateLimitedRegistration = await fetch(`${origin}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "RateFour", password: "strong-password-123" }),
  });
  assert.equal(rateLimitedRegistration.status, 429, "registration attempts should be rate limited before more password work starts");
  const proxiedRegistration = await fetch(`${origin}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.7" },
    body: JSON.stringify({ username: "ProxyRate", password: "strong-password-123" }),
  });
  assert.equal(proxiedRegistration.status, 201, "loopback proxy requests should use the forwarded client address for quotas");

  const me = await fetch(`${origin}/api/me`, { headers: { Cookie: cookie } });
  assert.equal(me.status, 200, "a session cookie should authenticate /api/me");
  const meData = await me.json();
  assert.equal(meData.user.elo, 1000, "the profile should expose one global rating");
  assert.equal(meData.user.stats.rank, 1, "the profile should expose one global rank");

  const profile = await fetch(`${origin}/api/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ signature: "SOS Brigade", loadout: { hull: "swift" } }),
  });
  assert.equal(profile.status, 200, "an authenticated user should update their profile");
  assert.equal((await profile.json()).user.signature, "SOS Brigade", "profile edits should persist the signature");

  const renamed = await fetch(`${origin}/api/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ username: "Suzumiya" }),
  });
  assert.equal(renamed.status, 200, "the first username change should succeed");
  const prematureRename = await fetch(`${origin}/api/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ username: "Haruhi2" }),
  });
  assert.equal(prematureRename.status, 409, "a second username change should respect the cooldown");

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl9cJcAAAAASUVORK5CYII=", "base64");
  const avatar = await fetch(`${origin}/api/profile/avatar`, {
    method: "POST",
    headers: { "Content-Type": "image/png", Cookie: cookie },
    body: png,
  });
  assert.equal(avatar.status, 200, "an authenticated PNG avatar upload should succeed");
  const avatarData = await avatar.json();
  assert.match(avatarData.user.avatarUrl, /^\/api\/avatars\//, "the profile should expose a safe avatar route");
  const image = await fetch(`${origin}${avatarData.user.avatarUrl}`);
  assert.equal(image.status, 200, "the uploaded avatar should be served from the API route");
  assert.equal(image.headers.get("content-type"), "image/png", "the avatar route should preserve the validated image MIME type");
  const invalidAvatar = await fetch(`${origin}/api/profile/avatar`, {
    method: "POST",
    headers: { "Content-Type": "image/png", Cookie: cookie },
    body: Buffer.from("this is not a PNG"),
  });
  assert.equal(invalidAvatar.status, 400, "avatar uploads should validate image bytes instead of trusting the MIME header");
  const truncatedJpeg = await fetch(`${origin}/api/profile/avatar`, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg", Cookie: cookie },
    body: Buffer.from([0xff, 0xd8, 0xff]),
  });
  assert.equal(truncatedJpeg.status, 400, "an image signature without valid dimensions must be rejected");

  const publicUser = await fetch(`${origin}/api/users/${created.user.id}`);
  assert.equal(publicUser.status, 200, "a public profile should be available without a session");
  const publicData = await publicUser.json();
  assert.equal(publicData.user.username, "Suzumiya", "public profile should include the display name");
  assert.equal(publicData.user.signature, "SOS Brigade", "public profile should include the configured signature");
  const legacyPublicUser = await fetch(`${origin}/api/users/${created.user.id}?mode=stellar3v3`);
  assert.equal((await legacyPublicUser.json()).user.elo, publicData.user.elo, "legacy profile mode queries should resolve to the global rating");

  const leaderboard = await fetch(`${origin}/api/leaderboard`);
  assert.equal(leaderboard.status, 200, "leaderboard should be publicly queryable");
  const leaderboardData = await leaderboard.json();
  assert.equal("mode" in leaderboardData, false, "the global leaderboard response should not expose a mode selector");
  assert.equal(leaderboardData.entries[0].userId, created.user.id, "leaderboard should include registered users");
  assert.equal(leaderboardData.entries[0].signature, "SOS Brigade", "leaderboard entries should include the configured signature");
  const legacyLeaderboard = await fetch(`${origin}/api/leaderboard?mode=pvp2v2`);
  assert.equal((await legacyLeaderboard.json()).entries[0].userId, created.user.id, "legacy leaderboard mode queries should resolve to the global board");

  const logout = await fetch(`${origin}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie } });
  assert.equal(logout.status, 204, "logout should revoke the current session");
  const afterLogout = await fetch(`${origin}/api/me`, { headers: { Cookie: cookie } });
  assert.equal(afterLogout.status, 401, "a revoked cookie should not authenticate /api/me");

  await verifyPrehashLoginThrottle();

  console.log("account API verification passed");
} finally {
  await stopServer(child);
  await rm(tempDir, { recursive: true, force: true });
}
