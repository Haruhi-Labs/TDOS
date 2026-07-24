import { spawn } from "node:child_process";
import WebSocket from "ws";

const PORT = 24000 + Math.floor(Math.random() * 1000);
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

function startServer() {
  const child = spawn(process.execPath, ["server/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  child.output = () => output;
  return child;
}

function connectClient() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
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

async function connectWithRetry() {
  let lastError = null;
  for (let i = 0; i < 40; i += 1) {
    try {
      return await connectClient();
    } catch (error) {
      lastError = error;
      await wait(50);
    }
  }
  throw lastError || new Error("Could not connect client");
}

async function main() {
  const server = startServer();
  try {
    const clients = [];
    for (let i = 0; i < 4; i += 1) {
      const ws = await connectWithRetry();
      clients.push(ws);
      await waitForMessage(ws, (message) => message.type === "connected", `client ${i} connected`);
      send(ws, { type: "set_name", name: `P${i + 1}` });
    }

    send(clients[0], { type: "create_room", visibility: "public", mode: "pvp2v2" });
    const created = await waitForMessage(
      clients[0],
      (message) => message.type === "room_state" && message.room?.mode === "pvp2v2",
      "creator room_state",
    );
    const roomId = created.room.roomId;
    assert(created.self.seat === "A1", "creator should be assigned to A1");
    assert(created.room.players.length === 4, "2v2 room_state should expose four slots");
    assert(created.room.players.map((row) => row.seat).join(",") === "A1,A2,B1,B2", "2v2 slots should be ordered");

    for (let i = 1; i < 4; i += 1) {
      send(clients[i], { type: "join_room", roomId });
    }

    const expectedSeats = ["A1", "A2", "B1", "B2"];
    for (let i = 0; i < 4; i += 1) {
      const state = await waitForMessage(
        clients[i],
        (message) => message.type === "room_state" && message.room?.roomId === roomId && message.self?.seat === expectedSeats[i],
        `client ${i} seat assignment`,
      );
      assert(state.room.status === "waiting", "2v2 should stay waiting until all players are ready");
    }

    send(clients[2], { type: "select_ship", shipKey: "sub2" });
    send(clients[3], { type: "select_ship", shipKey: "sub1" });

    for (const ws of clients) {
      send(ws, { type: "set_ready", ready: true });
    }

    await waitForMessage(
      clients[0],
      (message) => message.type === "room_state" && message.room?.roomId === roomId && message.room.status === "countdown",
      "2v2 countdown",
    );
    const snapshotA = await waitForMessage(
      clients[0],
      (message) => message.type === "snapshot" && message.roomId === roomId && message.state?.mode === "pvp2v2",
      "A snapshot",
    );
    const snapshotB = await waitForMessage(
      clients[2],
      (message) => message.type === "snapshot" && message.roomId === roomId && message.state?.mode === "pvp2v2",
      "B snapshot",
    );

    assert(snapshotA.state.viewer.allianceId === "A", "A player should receive A alliance snapshot");
    assert(snapshotA.state.viewer.seat === "A1", "A player snapshot should include viewer seat");
    assert(snapshotA.state.viewer.canControlFleet === true, "live A player should be allowed to control its fleet");
    assert(snapshotA.state.viewer.fleetDefeated === false, "live A player should not be marked defeated");
    assert(snapshotB.state.viewer.allianceId === "B", "B player should receive B alliance snapshot");
    assert(snapshotA.state.fleets.A1 && snapshotA.state.fleets.A2, "A snapshot should include allied fleets");
    assert(!snapshotA.state.fleets.B1 && !snapshotA.state.fleets.B2, "A snapshot should not include hidden enemy fleets at spawn");
    assert(snapshotA.state.selectedShips?.A1 === "main", "A snapshot should include the viewer selected ship");
    assert(snapshotA.state.selectedShips?.A2 === "main", "A snapshot should include allied selected ships");
    assert(
      !Object.prototype.hasOwnProperty.call(snapshotA.state.selectedShips || {}, "B1") &&
        !Object.prototype.hasOwnProperty.call(snapshotA.state.selectedShips || {}, "B2"),
      "A snapshot must not leak hidden enemy selected ships",
    );
    assert(snapshotB.state.selectedShips?.B1 === "sub2", "B snapshot should include B1 selected ship");
    assert(snapshotB.state.selectedShips?.B2 === "sub1", "B snapshot should include B2 selected ship");
    assert(
      !Object.prototype.hasOwnProperty.call(snapshotB.state.selectedShips || {}, "A1") &&
        !Object.prototype.hasOwnProperty.call(snapshotB.state.selectedShips || {}, "A2"),
      "B snapshot must not leak hidden enemy selected ships",
    );
    assert(snapshotA.ackSeq === 0, "snapshot should include per-player ack sequence");

    send(clients[0], { type: "set_name", name: "MutatedAfterReady" });
    await waitForMessage(
      clients[0],
      (message) => message.type === "error",
      "set_name should be rejected after ready countdown starts",
    );
    send(clients[0], {
      type: "set_loadout",
      loadout: { main: "asakura", sub1: "asakura", sub2: "asakura" },
    });
    await waitForMessage(
      clients[0],
      (message) => message.type === "error",
      "set_loadout should be rejected after ready countdown starts",
    );

    for (const ws of clients) {
      ws.close();
    }
  } finally {
    server.kill();
    await wait(100);
    if (server.exitCode === null) {
      server.kill("SIGKILL");
    }
  }
  console.log("2v2 server verification passed");
}

main();
