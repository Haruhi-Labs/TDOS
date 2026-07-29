import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";

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

function connect(url, cookie, headers = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { Cookie: cookie, ...headers } });
    ws.messages = [];
    ws.closeCode = null;
    ws.on("message", (raw) => ws.messages.push(JSON.parse(String(raw))));
    ws.on("close", (code) => { ws.closeCode = code; });
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

async function stopServer(child) {
  if (child.exitCode === null) {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    } else {
      child.kill("SIGTERM");
    }
  }
  await eventually(() => child.exitCode !== null, 5000);
}

const tempDir = await mkdtemp(path.join(tmpdir(), "tdos-account-online-"));
const port = await reservePort();
const httpOrigin = `http://127.0.0.1:${port}`;
const wsOrigin = `ws://127.0.0.1:${port}/ws`;
const child = spawn(process.execPath, ["server/server.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    USER_DB_PATH: path.join(tempDir, "accounts.sqlite"),
    USER_AVATAR_DIR: path.join(tempDir, "avatars"),
    SESSION_SECRET: "online-account-test-session-secret-that-is-long-enough",
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let output = "";
child.stdout.on("data", (chunk) => { output += String(chunk); });
child.stderr.on("data", (chunk) => { output += String(chunk); });

try {
  await eventually(() => output.includes(`:${port}`));
  await assert.rejects(
    connect(wsOrigin, "", { Origin: "https://untrusted.example" }),
    /Unexpected server response: 403/,
    "cross-origin WebSocket upgrades must be rejected before a session can be attached",
  );
  await assert.rejects(
    connect(wsOrigin, ""),
    /Unexpected server response: 401/,
    "WebSocket upgrades without a session cookie must be rejected",
  );
  await assert.rejects(
    connect(wsOrigin, "tdos_session=%"),
    /Unexpected server response: 401/,
    "WebSocket upgrades with malformed session cookies must be rejected",
  );

  async function register(username) {
    const response = await fetch(`${httpOrigin}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: `strong-password-${username}` }),
    });
    assert.equal(response.status, 201, `${username} registration should succeed`);
    return {
      cookie: response.headers.get("set-cookie").split(";", 1)[0],
      user: (await response.json()).user,
    };
  }

  const alice = await register("Alice");
  const bob = await register("Bob");
  const carol = await register("Carol");
  const aliceSocket = await connect(wsOrigin, alice.cookie);
  const aliceSecondSocket = await connect(wsOrigin, alice.cookie);
  const bobSocket = await connect(wsOrigin, bob.cookie);
  const carolSocket = await connect(wsOrigin, carol.cookie);
  await eventually(() => aliceSocket.messages.some((message) => message.type === "connected"));
  await eventually(() => aliceSecondSocket.messages.some((message) => message.type === "connected"));
  await eventually(() => bobSocket.messages.some((message) => message.type === "connected"));
  await eventually(() => carolSocket.messages.some((message) => message.type === "connected"));

  carolSocket.send(JSON.stringify({ type: "create_room", visibility: "public", mode: "pvp" }));
  const oneVsOneCreated = await eventually(() => carolSocket.messages.find(
    (message) => message.type === "room_state" && message.room?.mode === "pvp",
  ));
  const carolRow = oneVsOneCreated.room.players.find((player) => player.seat === "A");
  assert.ok(carolRow.user, "a public 1v1 room should expose its host's global account summary");
  assert.equal(carolRow.user.id, carol.user.id, "the 1v1 summary should use the persistent account ID");
  assert.equal(carolRow.user.elo, 1000, "the 1v1 room should expose the global Elo");

  aliceSocket.send(JSON.stringify({ type: "set_name", name: "Imposter" }));
  aliceSocket.send(JSON.stringify({ type: "create_room", visibility: "public", mode: "pvp2v2" }));
  const created = await eventually(() => aliceSocket.messages.find(
    (message) => message.type === "room_state" && message.room?.mode === "pvp2v2",
  ));
  const roomId = created.room.roomId;
  const aliceRow = created.room.players.find((player) => player.seat === "A1");
  assert.ok(aliceRow.user, "an authenticated socket should expose a public user summary in the room");
  assert.equal(aliceRow.user.id, alice.user.id, "an authenticated socket should expose its persistent user ID in the room");
  assert.equal(aliceRow.user.username, "Alice", "account username should override browser-local set_name data");
  assert.equal(aliceRow.user.elo, 1000, "room rows should expose the current mode Elo");
  assert.equal("signature" in aliceRow.user, false, "room rows must not expose private signatures");

  aliceSecondSocket.send(JSON.stringify({ type: "join_room", roomId }));
  const duplicateSeatError = await eventually(() => aliceSecondSocket.messages.find((message) => message.type === "error"));
  assert.equal(duplicateSeatError.code, "account_already_in_room", "duplicate account seating should report its specific error");

  bobSocket.send(JSON.stringify({ type: "join_room", roomId }));
  const withBob = await eventually(() => aliceSocket.messages.find(
    (message) => message.type === "room_state" && message.room?.roomId === roomId &&
      message.room.players.some((player) => player.user?.id === bob.user.id),
  ));
  const bobRow = withBob.room.players.find((player) => player.user?.id === bob.user.id);
  assert.equal(bobRow.user.username, "Bob", "allies should receive the joining player's public account summary");
  assert.equal(bobRow.user.elo, 1000, "the joining player summary should use 2v2 Elo");
  assert.equal(
    withBob.room.players.filter((player) => player.user?.id === alice.user.id).length,
    1,
    "the latest room state must keep an account on exactly one seat",
  );

  const revoked = await fetch(`${httpOrigin}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: alice.cookie },
  });
  assert.equal(revoked.status, 204, "an authenticated account should be able to revoke its active session");
  await eventually(() => aliceSocket.closeCode === 4001, 5000);
  await eventually(() => aliceSecondSocket.closeCode === 4001, 5000);

  aliceSocket.close();
  aliceSecondSocket.close();
  bobSocket.close();
  carolSocket.close();
  console.log("account online verification passed");
} finally {
  await stopServer(child);
  await rm(tempDir, { recursive: true, force: true });
}
