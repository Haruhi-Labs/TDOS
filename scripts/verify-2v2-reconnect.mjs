import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";

const PORT = 26000 + Math.floor(Math.random() * 1000);
const URL = `ws://127.0.0.1:${PORT}/`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function eventually(fn, timeoutMs = 6000, intervalMs = 25) {
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
  const tempDir = await mkdtemp(path.join(process.env.TEMP || process.cwd(), "tdos-2v2-reconnect-"));
  const child = spawn(process.execPath, ["server/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(PORT),
      USER_DB_PATH: path.join(tempDir, "accounts.sqlite"),
      USER_AVATAR_DIR: path.join(tempDir, "avatars"),
      SESSION_SECRET: "2v2-reconnect-test-session-secret-that-is-long-enough",
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

async function waitForMessage(ws, predicate, label, timeoutMs = 6000) {
  return eventually(() => ws.messages.find(predicate), timeoutMs).catch((error) => {
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

async function main() {
  const server = await startServer();
  const clients = [];
  try {
    const cookies = [];
    for (let i = 0; i < 4; i += 1) {
      const cookie = await register(server, `Reconnect${i + 1}`);
      cookies.push(cookie);
      const ws = await connectWithRetry(cookie);
      clients.push(ws);
      await waitForMessage(ws, (message) => message.type === "connected", `client ${i} connected`);
    }

    send(clients[0], { type: "create_room", visibility: "public", mode: "pvp2v2" });
    const created = await waitForMessage(
      clients[0],
      (message) => message.type === "room_state" && message.room?.mode === "pvp2v2" && message.self?.seat === "A1",
      "creator room_state",
    );
    const roomId = created.room.roomId;
    const reconnectToken = created.self.reconnectToken;
    assert(typeof reconnectToken === "string" && reconnectToken.length >= 24, "room_state self should expose a reconnect token");

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

    for (const ws of clients) {
      send(ws, { type: "set_ready", ready: true });
    }

    await waitForMessage(
      clients[1],
      (message) => message.type === "room_state" && message.room?.roomId === roomId && message.room.status === "running",
      "2v2 running",
      8000,
    );

    send(clients[0], {
      type: "input",
      seq: 1,
      action: {
        type: "set_route",
        shipKey: "main",
        endX: 520,
        endY: 540,
        throttle: 0.88,
      },
    });
    const preRefreshInput = await waitForMessage(
      clients[0],
      (message) =>
        message.type === "snapshot" &&
        message.roomId === roomId &&
        Number(message.ackSeq) >= 1 &&
        Math.abs(Number(message.state?.fleets?.A1?.ships?.main?.route?.p2?.x) - 520) < 0.001,
      "original page input is processed before refresh",
      7000,
    );
    const previousAckSeq = Number(preRefreshInput.ackSeq);

    clients[0].close();
    await waitForMessage(
      clients[1],
      (message) =>
        message.type === "room_state" &&
        message.room?.roomId === roomId &&
        message.room.status === "running" &&
        message.room.players?.find((row) => row.seat === "A1" && row.disconnected === true),
      "ally sees A1 reserved after disconnect",
    );
    assert(!clients[1].messages.some((message) => message.type === "room_closed"), "ally should not receive room_closed after one 2v2 disconnect");

    clients[1].messages = [];
    const guardedSnapshot = await waitForMessage(
      clients[1],
      (message) =>
        message.type === "snapshot" &&
        message.roomId === roomId &&
        message.state?.fleets?.A1?.ships?.main &&
        message.state.fleets.A1.ships.main.route === null &&
        Number(message.state.fleets.A1.ships.main.throttle) <= 0.25,
      "disconnected fleet enters guard stop",
    );
    assert(guardedSnapshot.state.fleets.A1.ships.main.alive, "disconnect guard should not destroy the abandoned fleet");

    const resumed = await connectWithRetry(cookies[0]);
    clients.push(resumed);
    await waitForMessage(resumed, (message) => message.type === "connected", "resumed client connected");
    send(resumed, { type: "resume_player", roomId, seat: "A1", reconnectToken });

    const resumedState = await waitForMessage(
      resumed,
      (message) => message.type === "room_state" && message.room?.roomId === roomId && message.self?.seat === "A1",
      "resumed room_state",
    );
    assert(resumedState.self.allianceId === "A", "resume should restore the original alliance");
    assert(resumedState.self.reconnectToken === reconnectToken, "resume should preserve the same reconnect token");
    const nextInputSeq = Number(resumedState.self.nextInputSeq);
    assert(
      Number.isInteger(nextInputSeq) && nextInputSeq > previousAckSeq,
      "resume room_state should expose the next usable input sequence",
    );
    assert(
      resumedState.room.players?.filter((row) => row.seat === "A1" && row.playerId).length === 1,
      "resume should create exactly one occupied A1 row",
    );

    send(resumed, {
      type: "input",
      seq: nextInputSeq,
      action: {
        type: "set_route",
        shipKey: "main",
        endX: 640,
        endY: 620,
        throttle: 0.92,
      },
    });
    await waitForMessage(
      resumed,
      (message) =>
        message.type === "snapshot" &&
        message.roomId === roomId &&
        Number(message.ackSeq) >= nextInputSeq &&
        Math.abs(Number(message.state?.fleets?.A1?.ships?.main?.route?.p2?.x) - 640) < 0.001,
      "resumed page first combat input is processed immediately",
      7000,
    );

    const duplicate = await connectWithRetry(cookies[1]);
    clients.push(duplicate);
    await waitForMessage(duplicate, (message) => message.type === "connected", "duplicate client connected");
    send(duplicate, { type: "resume_player", roomId, seat: "A1", reconnectToken });
    await wait(250);
    assert(
      !duplicate.messages.some((message) => message.type === "room_state" && message.self?.seat === "A1"),
      "reusing a consumed reconnect token must not create a duplicate A1 controller",
    );

    send(resumed, { type: "select_ship", shipKey: "sub1" });
    const resumedSnapshot = await waitForMessage(
      resumed,
      (message) =>
        message.type === "snapshot" &&
        message.roomId === roomId &&
        message.state?.mode === "pvp2v2" &&
        message.state?.viewer?.allianceId === "A" &&
        message.state?.selectedShips?.A1 === "sub1",
      "resumed player controls A1 selected ship",
      7000,
    );
    assert(Number(resumedSnapshot.ackSeq) >= nextInputSeq, "resumed player should receive snapshots with a continued ack sequence");
  } finally {
    for (const ws of clients) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
    await stopServer(server);
  }
  console.log("2v2 reconnect verification passed");
}

main();
