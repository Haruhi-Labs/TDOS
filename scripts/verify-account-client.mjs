import assert from "node:assert/strict";
import { createServer } from "node:http";

let createAccountClient;
try {
  ({ createAccountClient } = await import("../src/account-client.js"));
} catch (_error) {
  // The initial RED run intentionally reaches this branch before the client exists.
}

assert.equal(typeof createAccountClient, "function", "account client should export createAccountClient(options)");

const requests = [];
const server = createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    const body = Buffer.concat(chunks);
    requests.push({ method: request.method, url: request.url, headers: request.headers, body });
    let payload = { user: { id: "u-1", username: "Haruhi", elo: 1000, stats: { wins: 0, losses: 0, games: 0, rank: 1 } } };
    let status = 200;
    if (request.url === "/api/me") status = 401;
    if (request.url.startsWith("/api/leaderboard")) payload = { entries: [{ userId: "u-1", elo: 1000 }] };
    if (request.url.startsWith("/api/profile/history")) {
      payload = { entries: [{ matchId: "match-1", mode: "pvp2v2", outcome: "win", eloDelta: 16 }] };
    }
    if (request.url === "/api/announcements") {
      payload = { entries: [{ id: "v-test-1", title: "Release note", changes: ["A change"], readAt: null }] };
    }
    if (request.url === "/api/announcements/v-test-1/read") {
      payload = { entry: { id: "v-test-1", title: "Release note", changes: ["A change"], readAt: 1_800_000_000_000 } };
    }
    if (request.url === "/api/users/u-1") payload = { user: { id: "u-1", username: "Haruhi", elo: 1000 } };
    const encoded = Buffer.from(JSON.stringify(payload));
    response.writeHead(status, { "Content-Type": "application/json", "Content-Length": encoded.length });
    response.end(encoded);
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const client = createAccountClient({ baseUrl });
  assert.equal(await client.getMe(), null, "getMe should treat a missing cookie session as signed out");
  const registered = await client.register({ username: "Haruhi", password: "strong-password-123", confirmPassword: "strong-password-123", loadout: { main: "haruhi" } });
  assert.equal(registered.username, "Haruhi", "register should return the authenticated account");
  await client.updateProfile({ signature: "SOS Brigade" });
  await client.uploadAvatar(new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }));
  const leaderboard = await client.getLeaderboard();
  assert.equal(leaderboard.entries[0].userId, "u-1", "leaderboard should decode API entries");
  const legacyLeaderboard = await client.getLeaderboard("pvp2v2", 10);
  assert.equal(legacyLeaderboard.entries[0].userId, "u-1", "legacy leaderboard calls should continue to decode API entries");
  const defaultModeLegacyLeaderboard = await client.getLeaderboard(undefined, 12);
  assert.equal(defaultModeLegacyLeaderboard.entries[0].userId, "u-1", "legacy default-mode leaderboard calls should retain their requested limit");
  const history = await client.getMatchHistory(12);
  assert.equal(history[0].matchId, "match-1", "match history should decode the private history entries");
  const publicUser = await client.getUser("u-1");
  assert.equal(publicUser.id, "u-1", "public lookup should decode API users");
  const announcements = await client.getAnnouncements();
  assert.equal(announcements[0].id, "v-test-1", "announcement history should decode authenticated account entries");
  const acknowledged = await client.markAnnouncementRead("v-test-1");
  assert.equal(acknowledged.readAt, 1_800_000_000_000, "announcement acknowledgement should decode the server read state");

  const registerRequest = requests.find((request) => request.url === "/api/auth/register");
  assert.equal(registerRequest.method, "POST", "register should use POST");
  const registerPayload = JSON.parse(registerRequest.body.toString("utf8"));
  assert.equal(registerPayload.loadout.main, "haruhi", "register should carry the legacy loadout prefill");
  assert.equal("confirmPassword" in registerPayload, false, "confirmation passwords must remain client-only");
  const avatarRequest = requests.find((request) => request.url === "/api/profile/avatar");
  assert.equal(avatarRequest.headers["content-type"], "image/png", "avatar upload should preserve the selected image MIME type");
  assert.equal(avatarRequest.body[0], 0x89, "avatar upload should preserve binary image bytes");
  assert.ok(requests.some((request) => request.url === "/api/leaderboard?limit=100"), "leaderboard lookup should not select a rating mode");
  assert.ok(requests.some((request) => request.url === "/api/leaderboard?limit=10"), "legacy leaderboard calls should discard the obsolete mode and preserve the requested limit");
  assert.ok(requests.some((request) => request.url === "/api/leaderboard?limit=12"), "legacy default-mode leaderboard calls should preserve the requested limit");
  assert.ok(requests.some((request) => request.url === "/api/profile/history?limit=12"), "match history should request the private profile endpoint with its limit");
  assert.ok(requests.some((request) => request.url === "/api/users/u-1"), "public profile lookup should not select a rating mode");
  assert.ok(requests.some((request) => request.method === "GET" && request.url === "/api/announcements"), "announcement history should use the authenticated announcement endpoint");
  assert.ok(requests.some((request) => request.method === "POST" && request.url === "/api/announcements/v-test-1/read"), "announcement acknowledgement should use the account-scoped read endpoint");
  console.log("account client verification passed");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
