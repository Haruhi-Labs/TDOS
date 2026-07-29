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
    let payload = { user: { id: "u-1", username: "Haruhi", elo: { pvp2v2: 1000 }, stats: {} } };
    let status = 200;
    if (request.url === "/api/me") status = 401;
    if (request.url.startsWith("/api/leaderboard")) payload = { mode: "stellar3v3", entries: [{ userId: "u-1", elo: 1000 }] };
    if (request.url === "/api/users/u-1?mode=pvp2v2") payload = { user: { id: "u-1", username: "Haruhi", elo: 1000 } };
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
  const leaderboard = await client.getLeaderboard("stellar3v3");
  assert.equal(leaderboard.entries[0].userId, "u-1", "leaderboard should decode API entries");
  const publicUser = await client.getUser("u-1", "pvp2v2");
  assert.equal(publicUser.id, "u-1", "public lookup should decode API users");

  const registerRequest = requests.find((request) => request.url === "/api/auth/register");
  assert.equal(registerRequest.method, "POST", "register should use POST");
  const registerPayload = JSON.parse(registerRequest.body.toString("utf8"));
  assert.equal(registerPayload.loadout.main, "haruhi", "register should carry the legacy loadout prefill");
  assert.equal("confirmPassword" in registerPayload, false, "confirmation passwords must remain client-only");
  const avatarRequest = requests.find((request) => request.url === "/api/profile/avatar");
  assert.equal(avatarRequest.headers["content-type"], "image/png", "avatar upload should preserve the selected image MIME type");
  assert.equal(avatarRequest.body[0], 0x89, "avatar upload should preserve binary image bytes");
  console.log("account client verification passed");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
