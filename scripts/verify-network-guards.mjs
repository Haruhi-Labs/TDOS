import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import WebSocket from "ws";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const port = 24000 + Math.floor(Math.random() * 1000);
const url = `ws://127.0.0.1:${port}`;
let server = null;
const clients = new Set();

class GuardClient {
  constructor(options = {}) {
    this.ws = new WebSocket(url, options);
    this.messages = [];
    this.waiters = new Set();
    clients.add(this);
    this.ws.on("message", (raw) => {
      let message = null;
      try {
        message = JSON.parse(String(raw));
      } catch (_error) {
        return;
      }
      this.messages.push(message);
      for (const waiter of [...this.waiters]) {
        if (waiter.predicate(message)) {
          this.waiters.delete(waiter);
          clearTimeout(waiter.timer);
          waiter.resolve(message);
        }
      }
    });
  }

  async open() {
    await Promise.race([
      new Promise((resolve, reject) => {
        this.ws.once("open", resolve);
        this.ws.once("error", reject);
      }),
      delay(2000).then(() => {
        throw new Error("保护测试连接超时");
      }),
    ]);
    return this;
  }

  send(payload) {
    this.ws.send(JSON.stringify(payload));
  }

  waitFor(predicate, timeoutMs = 5000) {
    const existing = [...this.messages].reverse().find(predicate);
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error("等待保护测试消息超时"));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  waitForClose(timeoutMs = 2000) {
    if (this.ws.readyState === WebSocket.CLOSED) {
      return Promise.resolve({ code: this.ws._closeCode, reason: String(this.ws._closeMessage || "") });
    }
    return Promise.race([
      new Promise((resolve) => {
        this.ws.once("close", (code, reason) => resolve({ code, reason: String(reason) }));
      }),
      delay(timeoutMs).then(() => {
        throw new Error("等待连接关闭超时");
      }),
    ]);
  }

  terminate() {
    if (this.ws.readyState !== WebSocket.CLOSED) {
      this.ws.terminate();
    }
    clients.delete(this);
  }
}

async function startServer() {
  server = spawn(process.execPath, ["server/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      MAX_PAYLOAD_BYTES: "1024",
      MAX_CONNECTIONS: "8",
      MAX_ROOMS: "4",
      MAX_ACTIVE_ROOMS: "2",
      MAX_SPECTATORS_PER_ROOM: "1",
      HEARTBEAT_INTERVAL_MS: "100",
      NETWORK_METRICS_INTERVAL_MS: "1000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  server.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  for (let index = 0; index < 200; index += 1) {
    if (output.includes("网络对战服务器已启动")) {
      return;
    }
    if (server.exitCode !== null) {
      throw new Error(`保护测试服务器提前退出：${output}`);
    }
    await delay(10);
  }
  throw new Error(`保护测试服务器启动超时：${output}`);
}

async function terminateClients() {
  for (const client of [...clients]) {
    client.terminate();
  }
  await delay(120);
}

async function oversizedPayloadCheck() {
  const client = await new GuardClient().open();
  client.send({ type: "ping", padding: "超".repeat(800) });
  const closed = await client.waitForClose();
  assert.equal(closed.code, 1009, "超限消息没有以1009关闭");
  client.terminate();
}

async function heartbeatCheck() {
  const client = await new GuardClient({ autoPong: false }).open();
  const closed = await client.waitForClose(1000);
  assert.equal(closed.code, 1006, "不回应心跳的连接没有被终止");
  client.terminate();
}

async function connectionLimitCheck() {
  const accepted = await Promise.all(Array.from({ length: 8 }, async () => {
    const client = await new GuardClient().open();
    await client.waitFor((message) => message.type === "connected");
    return client;
  }));
  const rejected = await new GuardClient().open();
  const closed = await rejected.waitForClose();
  assert.equal(closed.code, 1013, "连接上限没有返回1013");
  assert.match(closed.reason, /连接数已满/, "连接上限关闭原因错误");
  rejected.terminate();
  for (const client of accepted) {
    client.terminate();
  }
  await delay(120);
}

async function spectatorLimitCheck() {
  const host = await new GuardClient().open();
  const guest = await new GuardClient().open();
  const spectatorA = await new GuardClient().open();
  const spectatorB = await new GuardClient().open();
  host.send({ type: "create_room", visibility: "public", mode: "pvp" });
  const waiting = await host.waitFor(
    (message) => message.type === "room_state" && message.room?.status === "waiting",
  );
  const roomId = waiting.room.roomId;
  guest.send({ type: "join_room", roomId });
  await host.waitFor(
    (message) => message.type === "room_state" && message.room?.status === "running",
    5000,
  );
  spectatorA.send({ type: "spectate_room", roomId });
  await spectatorA.waitFor(
    (message) => message.type === "room_state" && message.self?.spectating === true,
  );
  spectatorB.send({ type: "spectate_room", roomId });
  const error = await spectatorB.waitFor(
    (message) => message.type === "error" && message.code === "room_spectator_limit",
  );
  assert.equal(error.code, "room_spectator_limit", "观战上限错误码不正确");
  await terminateClients();
}

async function activeRoomLimitCheck() {
  const first = await new GuardClient().open();
  const second = await new GuardClient().open();
  const third = await new GuardClient().open();
  first.send({ type: "create_room", visibility: "private", mode: "ai" });
  second.send({ type: "create_room", visibility: "private", mode: "ai" });
  await first.waitFor((message) => message.type === "room_state" && message.room?.status === "running");
  await second.waitFor((message) => message.type === "room_state" && message.room?.status === "running");
  third.send({ type: "create_room", visibility: "private", mode: "ai" });
  const error = await third.waitFor(
    (message) => message.type === "error" && message.code === "server_active_room_limit",
  );
  assert.equal(error.code, "server_active_room_limit", "活跃房间上限错误码不正确");
  await terminateClients();
}

async function messageFloodCheck() {
  const client = await new GuardClient().open();
  for (let index = 0; index < 500; index += 1) {
    client.send({ type: "list_rooms" });
  }
  await delay(1100);
  client.send({ type: "ping", pingId: 999, clientTime: Date.now() });
  const pong = await client.waitFor(
    (message) => message.type === "pong" && message.pingId === 999,
  );
  assert.equal(pong.pingId, 999, "消息洪泛后服务未恢复响应");
  client.terminate();
}

async function stopEverything() {
  await terminateClients();
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => server.once("exit", resolve)),
      delay(1000),
    ]);
    if (server.exitCode === null) {
      server.kill("SIGKILL");
    }
  }
}

try {
  await startServer();
  await oversizedPayloadCheck();
  await heartbeatCheck();
  await connectionLimitCheck();
  await spectatorLimitCheck();
  await activeRoomLimitCheck();
  await messageFloodCheck();
  console.log("网络保护校验通过：大包、心跳、连接、房间、观战与消息洪泛均已受控。");
} catch (error) {
  console.error(`网络保护校验失败：${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await stopEverything();
}
