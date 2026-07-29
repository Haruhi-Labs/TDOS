import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function eventually(find, label, timeoutMs = 5000) {
  const startedAt = Date.now();
  let latestError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = find();
      if (value) return value;
    } catch (error) {
      latestError = error;
    }
    await wait(25);
  }
  throw latestError || new Error(`${label}: timed out`);
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function startServer() {
  const port = await reservePort();
  const tempDir = await mkdtemp(path.join(tmpdir(), "tdos-3v3-server-"));
  const child = spawn(process.execPath, ["server/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      USER_DB_PATH: path.join(tempDir, "accounts.sqlite"),
      USER_AVATAR_DIR: path.join(tempDir, "avatars"),
      SESSION_SECRET: "3v3-server-test-session-secret-that-is-long-enough",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  await eventually(() => child.exitCode === null && output.includes(`:${port}`), "server startup", 8000);
  return { child, url: `ws://127.0.0.1:${port}/`, httpOrigin: `http://127.0.0.1:${port}`, tempDir };
}

function connect(url, cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { Cookie: cookie } });
    ws.messages = [];
    ws.on("message", (raw) => ws.messages.push(JSON.parse(String(raw))));
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
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

function send(ws, payload) {
  ws.send(JSON.stringify(payload));
}

async function stopServer(server) {
  if (!server?.child) return;
  if (server.child.exitCode === null) {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(server.child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    } else {
      server.child.kill("SIGTERM");
    }
  }
  await eventually(() => server.child.exitCode !== null, "server shutdown", 5000);
  await rm(server.tempDir, { recursive: true, force: true });
}

async function main() {
  const server = await startServer();
  let host;
  try {
    const hostCookie = await register(server, "Host");
    host = await connect(server.url, hostCookie);
    await eventually(() => host.messages.find((message) => message.type === "connected"), "host connected");
    send(host, { type: "set_name", name: "Host" });
    send(host, { type: "create_room", visibility: "private", mode: "stellar3v3" });

    const created = await eventually(
      () => host.messages.find((message) => message.type === "room_state" && message.room?.mode === "stellar3v3"),
      "3v3 room creation",
    );
    assert(created.room.capacity === 6, "stellar3v3 room must expose six seats");
    assert(created.self.seat === "A1", "3v3 creator must occupy A1");
    assert(created.room.hostPlayerId === created.self.playerId, "creator must be the room host");
    assert(
      created.room.players.map((row) => row.seat).join(",") === "A1,A2,A3,B1,B2,B3",
      "3v3 room seats must be ordered by alliance",
    );

    send(host, {
      type: "configure_slot",
      seat: "B3",
      occupantType: "bot",
      difficulty: "hard",
      loadout: { main: "yuki", sub1: "kyon", sub2: "koizumi" },
    });
    const botConfigured = await eventually(
      () => host.messages.find((message) => {
        const row = message.room?.players?.find((item) => item.seat === "B3");
        return message.type === "room_state" && row?.isBot && row.difficulty === "hard";
      }),
      "per-seat bot configuration",
    );
    assert(botConfigured.room.players.find((row) => row.seat === "B3")?.loadout?.main === "yuki", "bot loadout must round-trip");

    for (const seat of ["A2", "A3", "B1", "B2"]) {
      send(host, { type: "configure_slot", seat, occupantType: "bot", difficulty: "normal" });
    }
    await eventually(
      () => host.messages.find((message) => message.type === "room_state" && message.room?.players?.filter((row) => row.isBot).length === 5),
      "full bot roster",
    );
    send(host, { type: "set_ready", ready: true });
    send(host, { type: "start_match" });
    const started = await eventually(
      () => host.messages.find((message) => message.type === "room_state" && message.room?.status === "countdown"),
      "host-started 3v3 countdown",
    );
    const snapshot = await eventually(
      () => host.messages.find((message) => message.type === "snapshot" && message.roomId === started.room.roomId),
      "3v3 initial snapshot",
    );
    assert(
      Object.keys(snapshot.state.fleets || {}).join(",") === "A1,A2,A3",
      "3v3 player snapshot must contain all allied fleets",
    );
    assert(!snapshot.state.fleets?.B1, "3v3 snapshot must not leak hidden enemy fleets at spawn");
    assert(snapshot.state.modeId === "stellar-territory", "3v3 must run the stellar territory authority mode");
    assert(snapshot.state.territory?.map?.worldSize?.width === 3200, "3v3 snapshot must carry the territory map state");
    assert(
      !Object.keys(snapshot.state.territory?.navigationPlans || {}).some((key) => key.startsWith("B")),
      "3v3 snapshot must not leak hidden enemy navigation plans through territory state",
    );

    const reconnectToken = started.self.reconnectToken;
    host.close();
    const resumed = await connect(server.url, hostCookie);
    await eventually(() => resumed.messages.find((message) => message.type === "connected"), "reconnect client connected");
    send(resumed, { type: "resume_player", roomId: started.room.roomId, seat: "A1", reconnectToken });
    const resumedState = await eventually(
      () => resumed.messages.find((message) => message.type === "room_state" && message.room?.roomId === started.room.roomId && message.self?.seat === "A1"),
      "3v3 reconnect",
    );
    assert(resumedState.room.hostPlayerId === resumedState.self.playerId, "reconnected host must retain host permissions");
    assert(!resumedState.room.players.find((row) => row.seat === "A1")?.disconnected, "reconnected seat must stop disconnect state");
    resumed.close();
  } finally {
    host?.close();
    await stopServer(server);
  }
  await verifyWaitingRoomSeatCases();
  console.log("3v3 server room verification passed");
}

async function verifyBotFilledLobby() {
  const server = await startServer();
  let host;
  let observer;
  try {
    host = await connect(server.url, await register(server, "BotHost"));
    observer = await connect(server.url, await register(server, "BotObserver"));
    await eventually(() => host.messages.find((message) => message.type === "connected"), "bot lobby host connected");
    await eventually(() => observer.messages.find((message) => message.type === "connected"), "bot lobby observer connected");
    send(host, { type: "create_room", visibility: "public", mode: "stellar3v3" });
    const created = await eventually(
      () => host.messages.find((message) => message.type === "room_state" && message.room?.mode === "stellar3v3"),
      "bot lobby creation",
    );
    for (const seat of ["A2", "A3", "B1", "B2", "B3"]) {
      send(host, { type: "configure_slot", seat, occupantType: "bot", difficulty: "normal" });
    }
    await eventually(
      () => host.messages.find((message) => (
        message.type === "room_state"
        && message.room?.roomId === created.room.roomId
        && message.room.players?.filter((row) => row.isBot).length === 5
      )),
      "bot-filled room state",
    );
    const listing = await eventually(
      () => observer.messages
        .filter((message) => message.type === "lobby")
        .map((message) => message.rooms?.find((room) => room.roomId === created.room.roomId))
        .find((room) => room?.count === 6),
      "bot-filled public lobby listing",
    );
    assert(listing.joinable === false, "a bot-filled 3v3 room must not advertise a joinable seat");
    send(observer, { type: "join_room", roomId: created.room.roomId });
    const rejection = await eventually(
      () => observer.messages.find((message) => message.type === "error" && message.code === "room_full"),
      "bot-filled public lobby rejection",
    );
    assert(rejection, "bot-filled public lobby must reject joins");
  } finally {
    host?.close();
    observer?.close();
    await stopServer(server);
  }
}

async function verifyWaitingRoomSeatCases() {
  const server = await startServer();
  let host;
  let guest;
  try {
    host = await connect(server.url, await register(server, "WaitingHost"));
    guest = await connect(server.url, await register(server, "WaitingGuest"));
    await eventually(() => host.messages.find((message) => message.type === "connected"), "waiting host connected");
    await eventually(() => guest.messages.find((message) => message.type === "connected"), "waiting guest connected");
    send(host, { type: "create_room", visibility: "public", mode: "stellar3v3" });
    const created = await eventually(
      () => host.messages.find((message) => message.type === "room_state" && message.room?.mode === "stellar3v3"),
      "waiting room created",
    );
    send(guest, { type: "join_room", roomId: created.room.roomId });
    await eventually(
      () => guest.messages.find((message) => message.type === "room_state" && message.room?.roomId === created.room.roomId && message.self?.seat === "A2"),
      "guest initial seat",
    );
    send(guest, { type: "choose_seat", seat: "B2" });
    const moved = await eventually(
      () => guest.messages.find((message) => message.type === "room_state" && message.room?.roomId === created.room.roomId && message.self?.seat === "B2"),
      "guest chooses open B2 seat",
    );
    assert(moved.room.players.find((row) => row.seat === "A2")?.occupantType === "open", "vacated human seat must reopen");
    const previousHostId = created.self.playerId;
    host.close();
    const transferred = await eventually(
      () => guest.messages.find((message) => message.type === "room_state" && message.room?.roomId === created.room.roomId && message.room?.hostPlayerId !== previousHostId),
      "host transfer",
    );
    assert(transferred.room.hostPlayerId === transferred.self.playerId, "remaining player must inherit host controls");
  } finally {
    host?.close();
    guest?.close();
    await stopServer(server);
  }
}

async function verifyLobbyModeScope() {
  const server = await startServer();
  let standardHost;
  let stellarHost;
  let standardGuest;
  let stellarGuest;
  try {
    standardHost = await connect(server.url, await register(server, "StandardHost"));
    stellarHost = await connect(server.url, await register(server, "StellarHost"));
    standardGuest = await connect(server.url, await register(server, "StandardGuest"));
    stellarGuest = await connect(server.url, await register(server, "StellarGuest"));
    await Promise.all([
      eventually(() => standardHost.messages.find((message) => message.type === "connected"), "standard host connected"),
      eventually(() => stellarHost.messages.find((message) => message.type === "connected"), "stellar host connected"),
      eventually(() => standardGuest.messages.find((message) => message.type === "connected"), "standard guest connected"),
      eventually(() => stellarGuest.messages.find((message) => message.type === "connected"), "stellar guest connected"),
    ]);

    send(standardHost, { type: "create_room", visibility: "private", mode: "pvp" });
    send(stellarHost, { type: "create_room", visibility: "private", mode: "stellar3v3" });
    const standardRoom = await eventually(
      () => standardHost.messages.find((message) => message.type === "room_state" && message.room?.mode === "pvp")?.room,
      "standard room creation",
    );
    const stellarRoom = await eventually(
      () => stellarHost.messages.find((message) => message.type === "room_state" && message.room?.mode === "stellar3v3")?.room,
      "stellar room creation",
    );

    send(standardGuest, { type: "join_room", roomId: stellarRoom.roomId, modeScope: "standard" });
    send(stellarGuest, { type: "join_room", roomId: standardRoom.roomId, modeScope: "stellar3v3" });
    await eventually(
      () => standardGuest.messages.find((message) => message.type === "error" && message.code === "room_mode_mismatch"),
      "standard scope rejection",
    );
    await eventually(
      () => stellarGuest.messages.find((message) => message.type === "error" && message.code === "room_mode_mismatch"),
      "stellar scope rejection",
    );

    const standardErrors = standardGuest.messages.filter((message) => message.type === "error" && message.code === "room_mode_mismatch").length;
    const stellarErrors = stellarGuest.messages.filter((message) => message.type === "error" && message.code === "room_mode_mismatch").length;
    send(standardGuest, { type: "join_private", code: stellarRoom.code, modeScope: "standard" });
    send(stellarGuest, { type: "join_private", code: standardRoom.code, modeScope: "stellar3v3" });
    await eventually(
      () => standardGuest.messages.filter((message) => message.type === "error" && message.code === "room_mode_mismatch").length > standardErrors,
      "standard private-code scope rejection",
    );
    await eventually(
      () => stellarGuest.messages.filter((message) => message.type === "error" && message.code === "room_mode_mismatch").length > stellarErrors,
      "stellar private-code scope rejection",
    );
  } finally {
    standardHost?.close();
    stellarHost?.close();
    standardGuest?.close();
    stellarGuest?.close();
    await stopServer(server);
  }
}

main()
  .then(verifyBotFilledLobby)
  .then(verifyLobbyModeScope)
  .catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
  });
