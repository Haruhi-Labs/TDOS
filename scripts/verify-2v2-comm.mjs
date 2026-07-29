import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";

const PORT = 25000 + Math.floor(Math.random() * 1000);
const URL = `ws://127.0.0.1:${PORT}/`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function eventually(fn, timeoutMs = 4000, intervalMs = 25) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = fn();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await wait(intervalMs);
  }
  if (lastError) {
    throw lastError;
  }
  throw new Error("Timed out waiting for condition");
}

async function startServer() {
  const tempDir = await mkdtemp(path.join(process.env.TEMP || process.cwd(), "tdos-2v2-comm-"));
  const child = spawn(process.execPath, ["server/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(PORT),
      USER_DB_PATH: path.join(tempDir, "accounts.sqlite"),
      USER_AVATAR_DIR: path.join(tempDir, "avatars"),
      SESSION_SECRET: "2v2-comm-test-session-secret-that-is-long-enough",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  child.output = () => output;
  child.httpOrigin = `http://127.0.0.1:${PORT}`;
  child.tempDir = tempDir;
  await eventually(() => child.exitCode === null && output.includes(`:${PORT}`), 8000);
  return child;
}

function connectClient(cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL, { headers: { Cookie: cookie } });
    ws.messages = [];
    ws.on("message", (raw) => {
      ws.messages.push(JSON.parse(String(raw)));
    });
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function send(ws, payload) {
  ws.send(JSON.stringify(payload));
}

async function waitForMessage(ws, predicate, label) {
  return eventually(() => ws.messages.find(predicate), 5000).catch((error) => {
    throw new Error(`${label}: ${error.message}`);
  });
}

async function connectWithRetry(cookie) {
  let lastError = null;
  for (let i = 0; i < 40; i += 1) {
    try {
      return await connectClient(cookie);
    } catch (error) {
      lastError = error;
      await wait(50);
    }
  }
  throw lastError || new Error("Could not connect client");
}

async function register(server, username) {
  const response = await fetch(`${server.httpOrigin}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: `strong-password-${username}` }),
  });
  assert(response.status === 201, `${username} registration must succeed`);
  return response.headers.get("set-cookie").split(";", 1)[0];
}

async function stopServer(server) {
  if (server.exitCode === null) {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    } else {
      server.kill("SIGTERM");
    }
  }
  await eventually(() => server.exitCode !== null, 5000);
  await rm(server.tempDir, { recursive: true, force: true });
}

function teamEvents(ws) {
  return ws.messages.filter((message) => message.type === "team_comm_event");
}

async function main() {
  const server = await startServer();
  try {
    const clients = [];
    for (let i = 0; i < 4; i += 1) {
      const ws = await connectWithRetry(await register(server, `Comm${i + 1}`));
      clients.push(ws);
      await waitForMessage(ws, (message) => message.type === "connected", `client ${i} connected`);
    }

    send(clients[0], { type: "create_room", visibility: "public", mode: "pvp2v2" });
    const created = await waitForMessage(
      clients[0],
      (message) => message.type === "room_state" && message.room?.mode === "pvp2v2",
      "creator room_state",
    );
    const roomId = created.room.roomId;

    const expectedSeats = ["A1", "A2", "B1", "B2"];
    for (let i = 1; i < 4; i += 1) {
      send(clients[i], { type: "join_room", roomId });
      await waitForMessage(
        clients[i],
        (message) =>
          message.type === "room_state" &&
          message.room?.roomId === roomId &&
          message.self?.seat === expectedSeats[i],
        `client ${i} seat assignment`,
      );
    }

    send(clients[0], {
      type: "team_comm",
      commType: "attack",
      anchor: { type: "point", x: 320, y: 420 },
    });

    const senderEvent = await waitForMessage(
      clients[0],
      (message) => message.type === "team_comm_event" && message.event?.commType === "attack",
      "sender team comm echo",
    );
    const allyEvent = await waitForMessage(
      clients[1],
      (message) => message.type === "team_comm_event" && message.event?.id === senderEvent.event.id,
      "ally team comm event",
    );

    assert(senderEvent.roomId === roomId, "team comm event should include roomId");
    assert(senderEvent.event.senderSeat === "A1", "server should derive sender seat");
    assert(senderEvent.event.senderName === "Comm1", "server should derive sender account name");
    assert(senderEvent.event.allianceId === "A", "server should derive alliance");
    assert(senderEvent.event.anchor.x === 320 && senderEvent.event.anchor.y === 420, "point anchor should be preserved");
    assert(allyEvent.event.id === senderEvent.event.id, "ally should receive the same event id");

    await wait(200);
    assert(
      teamEvents(clients[2]).every((message) => message.event?.id !== senderEvent.event.id) &&
        teamEvents(clients[3]).every((message) => message.event?.id !== senderEvent.event.id),
      "enemy alliance should not receive team comm events",
    );

    send(clients[0], {
      type: "team_comm",
      commType: "support",
      anchor: { type: "point", x: 340, y: 430 },
    });
    await wait(200);
    assert(teamEvents(clients[1]).length === 1, "rate-limited comm should not be broadcast");

    await wait(850);
    send(clients[0], {
      type: "team_comm",
      commType: "danger",
      anchor: { type: "point", x: -50, y: 430 },
    });
    await wait(200);
    assert(teamEvents(clients[1]).length === 1, "invalid point anchor should not be broadcast");

    for (const ws of clients) {
      ws.close();
    }
  } finally {
    await stopServer(server);
  }
  console.log("2v2 team communication verification passed");
}

main();
