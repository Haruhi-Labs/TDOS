import { spawn } from "node:child_process";
import { createServer } from "node:net";
import WebSocket from "ws";

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

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function startServer() {
  const port = await reservePort();
  const url = `ws://127.0.0.1:${port}/`;
  const child = spawn(process.execPath, ["server/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
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
  child.port = port;
  child.url = url;

  await eventually(() => {
    if (child.exitCode !== null) {
      throw new Error(`server exited early (${child.exitCode}): ${output}`);
    }
    return output.includes("网络对战服务器已启动") || output.includes(`:${port}`);
  }, 8000, 25);

  return child;
}

function connectClient(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
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
  return eventually(() => ws.messages.find(predicate), 8000).catch((error) => {
    const recent = ws.messages.slice(-5).map((message) => message.type);
    throw new Error(`${label}: ${error.message}; recent=${recent.join(",")}`);
  });
}

async function connectWithRetry(url) {
  let lastError = null;
  for (let i = 0; i < 60; i += 1) {
    try {
      return await connectClient(url);
    } catch (error) {
      lastError = error;
      await wait(50);
    }
  }
  throw lastError || new Error("Could not connect client");
}

async function stopServer(server) {
  if (!server) return;
  try {
    if (process.platform === "win32" && server.pid) {
      spawn("taskkill", ["/pid", String(server.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      server.kill("SIGTERM");
    }
  } catch (_error) {
    // ignore
  }
  await wait(150);
  if (server.exitCode === null) {
    try {
      server.kill("SIGKILL");
    } catch (_error) {
      // ignore
    }
  }
  await wait(50);
}

async function main() {
  const server = await startServer();
  try {
    const clients = [];
    for (let i = 0; i < 4; i += 1) {
      const ws = await connectWithRetry(server.url);
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

    // Join one-by-one to avoid seat-assignment races under concurrent joins.
    const expectedSeats = ["A1", "A2", "B1", "B2"];
    const bySeat = { A1: clients[0] };
    for (let i = 1; i < 4; i += 1) {
      send(clients[i], { type: "join_room", roomId });
      const state = await waitForMessage(
        clients[i],
        (message) =>
          message.type === "room_state" &&
          message.room?.roomId === roomId &&
          message.self?.seat === expectedSeats[i],
        `client ${i} seat assignment`,
      );
      assert(state.room.status === "waiting", "2v2 should stay waiting until all players are ready");
      bySeat[state.self.seat] = clients[i];
    }
    await waitForMessage(
      clients[0],
      (message) =>
        message.type === "room_state" &&
        message.room?.roomId === roomId &&
        (message.room.players || []).filter((row) => row.playerId).length === 4,
      "creator sees four filled seats",
    );

    send(bySeat.B1, { type: "select_ship", shipKey: "sub2" });
    send(bySeat.B2, { type: "select_ship", shipKey: "sub1" });

    for (const ws of clients) {
      send(ws, { type: "set_ready", ready: true });
    }

    await waitForMessage(
      clients[0],
      (message) => message.type === "room_state" && message.room?.roomId === roomId && message.room.status === "countdown",
      "2v2 countdown",
    );
    const snapshotA = await waitForMessage(
      bySeat.A1,
      (message) => message.type === "snapshot" && message.roomId === roomId && message.state?.mode === "pvp2v2",
      "A snapshot",
    );
    const snapshotB = await waitForMessage(
      bySeat.B1,
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
    await stopServer(server);
  }

  await runLoadoutReadyRaceCases();
  console.log("2v2 server verification passed");
}

async function createFilledWaitingRoom(server) {
  const clients = [];
  for (let i = 0; i < 4; i += 1) {
    const ws = await connectWithRetry(server.url);
    clients.push(ws);
    await waitForMessage(ws, (message) => message.type === "connected", `race client ${i} connected`);
    send(ws, { type: "set_name", name: `R${i + 1}` });
  }
  send(clients[0], { type: "create_room", visibility: "public", mode: "pvp2v2" });
  const created = await waitForMessage(
    clients[0],
    (message) => message.type === "room_state" && message.room?.mode === "pvp2v2",
    "race creator room_state",
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
      `race seat ${expectedSeats[i]}`,
    );
  }
  return { clients, roomId };
}

async function runLoadoutReadyRaceCases() {
  // Scenario C: ready player changes loadout -> ready cleared, stay waiting.
  {
    const server = await startServer();
    try {
      const { clients, roomId } = await createFilledWaitingRoom(server);
      send(clients[0], { type: "set_ready", ready: true });
      await waitForMessage(
        clients[0],
        (message) => message.type === "room_state" && message.room?.roomId === roomId && message.self?.ready === true,
        "A1 ready before loadout change",
      );
      send(clients[0], {
        type: "set_loadout",
        loadout: { main: "yuki", sub1: "kyon", sub2: "koizumi" },
      });
      const cleared = await waitForMessage(
        clients[0],
        (message) =>
          message.type === "room_state" &&
          message.room?.roomId === roomId &&
          message.self?.ready === false &&
          message.self?.loadout?.main === "yuki",
        "A1 loadout should clear ready atomically",
      );
      assert(cleared.room.status === "waiting", "loadout change while waiting must not start countdown");
      const peer = await waitForMessage(
        clients[1],
        (message) =>
          message.type === "room_state" &&
          message.room?.roomId === roomId &&
          (message.room.players || []).some((row) => row.seat === "A1" && row.ready === false && row.loadout?.main === "yuki"),
        "peers should observe A1 unready after loadout change",
      );
      assert(peer.room.status === "waiting", "peer room state should remain waiting after ready loadout change");
      for (const ws of clients) ws.close();
    } finally {
      await stopServer(server);
    }
  }

  // Scenario B: three ready, unready player changes loadout -> still waiting.
  {
    const server = await startServer();
    try {
      const { clients, roomId } = await createFilledWaitingRoom(server);
      for (const index of [0, 1, 2]) {
        send(clients[index], { type: "set_ready", ready: true });
      }
      await waitForMessage(
        clients[0],
        (message) =>
          message.type === "room_state" &&
          message.room?.roomId === roomId &&
          (message.room.players || []).filter((row) => row.ready).length === 3,
        "three players ready",
      );
      send(clients[3], {
        type: "set_loadout",
        loadout: { main: "tsuruya", sub1: "haruhi", sub2: "asakura" },
      });
      const state = await waitForMessage(
        clients[3],
        (message) =>
          message.type === "room_state" &&
          message.room?.roomId === roomId &&
          message.self?.loadout?.main === "tsuruya",
        "B2 loadout while others ready",
      );
      assert(state.room.status === "waiting", "three-ready room must stay waiting after unready loadout edit");
      assert(state.self.ready === false, "unready editor must remain unready");
      for (const ws of clients) ws.close();
    } finally {
      await stopServer(server);
    }
  }

  // Scenario A1: set_loadout arrives as the fourth "ready-like" action before all ready stick.
  {
    const server = await startServer();
    try {
      const { clients, roomId } = await createFilledWaitingRoom(server);
      for (const index of [0, 1, 2]) {
        send(clients[index], { type: "set_ready", ready: true });
      }
      await waitForMessage(
        clients[0],
        (message) =>
          message.type === "room_state" &&
          message.room?.roomId === roomId &&
          (message.room.players || []).filter((row) => row.ready).length === 3,
        "three ready before last loadout",
      );
      send(clients[3], { type: "set_ready", ready: true });
      send(clients[3], {
        type: "set_loadout",
        loadout: { main: "future1096", sub1: "yuki", sub2: "kyon" },
      });
      const outcome = await eventually(() => {
        const states = clients[3].messages.filter(
          (message) => message.type === "room_state" && message.room?.roomId === roomId,
        );
        const last = states[states.length - 1];
        if (!last) return null;
        if (last.room.status === "countdown" || last.room.status === "running") {
          return last;
        }
        if (last.self?.loadout?.main === "future1096" && last.self?.ready === false && last.room.status === "waiting") {
          return last;
        }
        return null;
      }, 5000);
      if (outcome.room.status === "waiting") {
        assert(outcome.self.ready === false, "loadout-first path must clear B2 ready and stay waiting");
      } else {
        // set_ready won the race and match started; subsequent loadout must be rejected.
        await waitForMessage(
          clients[3],
          (message) => message.type === "error",
          "loadout after countdown must error",
        );
      }
      for (const ws of clients) ws.close();
    } finally {
      await stopServer(server);
    }
  }

  // Deterministic path: ready player edits loadout before fourth ready.
  {
    const server = await startServer();
    try {
      const { clients, roomId } = await createFilledWaitingRoom(server);
      for (const index of [0, 1, 2]) {
        send(clients[index], { type: "set_ready", ready: true });
      }
      await waitForMessage(
        clients[2],
        (message) => message.type === "room_state" && message.room?.roomId === roomId && message.self?.ready === true,
        "B1 ready",
      );
      send(clients[2], {
        type: "set_loadout",
        loadout: { main: "koizumi", sub1: "tsuruya", sub2: "haruhi" },
      });
      const cleared = await waitForMessage(
        clients[2],
        (message) =>
          message.type === "room_state" &&
          message.room?.roomId === roomId &&
          message.self?.ready === false &&
          message.self?.loadout?.main === "koizumi",
        "ready player loadout clears ready",
      );
      assert(cleared.room.status === "waiting", "ready loadout edit must keep room waiting");
      send(clients[3], { type: "set_ready", ready: true });
      await wait(200);
      const stillWaiting = clients[0].messages
        .filter((message) => message.type === "room_state" && message.room?.roomId === roomId)
        .at(-1);
      assert(stillWaiting?.room?.status === "waiting", "room cannot countdown while a loadout-cleared player is unready");
      for (const ws of clients) ws.close();
    } finally {
      await stopServer(server);
    }
  }
}

main();
