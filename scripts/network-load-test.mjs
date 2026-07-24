import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import WebSocket from "ws";
import { applyStatePatch } from "../shared/network-patch.js";

const execFileAsync = promisify(execFile);

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function percentile(values, ratio) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const roomCount = positiveInteger(process.env.NETWORK_ROOMS, 3);
const spectatorsPerRoom = positiveInteger(process.env.NETWORK_SPECTATORS_PER_ROOM, 4);
const durationSeconds = positiveInteger(process.env.NETWORK_DURATION_SECONDS, 15);
const unackedClientCount = Math.max(0, Number(process.env.NETWORK_UNACKED_CLIENTS) || 0);
const ackRecoverySeconds = Math.max(0, Number(process.env.NETWORK_ACK_RECOVERY_SECONDS) || 0);
const configuredUrl = String(process.env.NETWORK_WS_URL || "").trim();
const localPort = positiveInteger(process.env.NETWORK_PORT, 23000 + Math.floor(Math.random() * 1000));
const wsUrl = configuredUrl || `ws://127.0.0.1:${localPort}`;
const shouldStartServer = !configuredUrl;

let localServer = null;
let shuttingDown = false;
const clients = [];

class LoadClient {
  constructor(role, roomIndex, index) {
    this.role = role;
    this.roomIndex = roomIndex;
    this.index = index;
    this.ws = null;
    this.messages = [];
    this.waiters = new Set();
    this.measuring = false;
    this.startWireBytes = 0;
    this.snapshotRawBytes = 0;
    this.snapshotCount = 0;
    this.snapshotArrivalTimes = [];
    this.snapshotSeqs = [];
    this.keyframeCount = 0;
    this.deltaCount = 0;
    this.decodedState = null;
    this.decodedSeq = 0;
    this.protocolError = null;
    this.deliveryAckEnabled = true;
    this.lastDeliveryAckAt = 0;
    this.snapshotRates = [];
    this.streamTiers = [];
  }

  async connect() {
    this.ws = new WebSocket(wsUrl, {
      perMessageDeflate: true,
    });
    this.ws.on("message", (data) => {
      const raw = String(data);
      let message = null;
      try {
        message = JSON.parse(raw);
      } catch (_error) {
        return;
      }
      this.messages.push(message);
      if (this.messages.length > 200) {
        this.messages.splice(0, this.messages.length - 200);
      }
      if (message.type === "snapshot") {
        this.decodedState = message.state;
        this.decodedSeq = Number(message.snapshotSeq) || 0;
      } else if (message.type === "snapshot_delta") {
        const baseSeq = Number(message.baseSnapshotSeq) || 0;
        if (!this.decodedState || baseSeq !== this.decodedSeq) {
          this.protocolError = `差量基线不连续：需要 ${baseSeq}，本地为 ${this.decodedSeq}`;
        } else {
          try {
            this.decodedState = applyStatePatch(this.decodedState, message.patch ?? null);
            this.decodedSeq = Number(message.snapshotSeq) || 0;
          } catch (error) {
            this.protocolError = error instanceof Error ? error.message : String(error);
          }
        }
      }
      if (this.measuring && (message.type === "snapshot" || message.type === "snapshot_delta")) {
        this.snapshotRawBytes += Buffer.byteLength(raw);
        this.snapshotCount += 1;
        this.snapshotArrivalTimes.push(performance.now());
        this.snapshotSeqs.push(Number(message.snapshotSeq) || 0);
        this.snapshotRates.push(Number(message.snapshotRate) || 0);
        this.streamTiers.push(Number(message.streamTier) || 0);
        if (message.type === "snapshot") {
          this.keyframeCount += 1;
        } else {
          this.deltaCount += 1;
        }
      }
      if (
        this.deliveryAckEnabled &&
        !this.protocolError &&
        this.ws?.readyState === WebSocket.OPEN &&
        (message.type === "snapshot" || message.type === "snapshot_delta")
      ) {
        const now = performance.now();
        if (message.type === "snapshot" || now - this.lastDeliveryAckAt >= 200) {
          this.send({
            type: "snapshot_ack",
            snapshotSeq: Number(message.snapshotSeq) || 0,
          });
          this.lastDeliveryAckAt = now;
        }
      }
      for (const waiter of [...this.waiters]) {
        if (waiter.predicate(message)) {
          this.waiters.delete(waiter);
          clearTimeout(waiter.timer);
          waiter.resolve(message);
        }
      }
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`连接超时：${this.role}-${this.roomIndex}-${this.index}`)), 5000);
      this.ws.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    await this.waitFor((message) => message.type === "connected");
  }

  send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`连接未就绪：${this.role}-${this.roomIndex}-${this.index}`);
    }
    this.ws.send(JSON.stringify(payload));
  }

  waitFor(predicate, timeoutMs = 7000) {
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
          reject(new Error(`等待服务器消息超时：${this.role}-${this.roomIndex}-${this.index}`));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  beginMeasure() {
    this.measuring = true;
    this.startWireBytes = Number(this.ws?._socket?.bytesRead) || 0;
    this.snapshotRawBytes = 0;
    this.snapshotCount = 0;
    this.snapshotArrivalTimes = [];
    this.snapshotSeqs = [];
    this.keyframeCount = 0;
    this.deltaCount = 0;
    this.snapshotRates = [];
    this.streamTiers = [];
  }

  finishMeasure() {
    this.measuring = false;
    const endWireBytes = Number(this.ws?._socket?.bytesRead) || this.startWireBytes;
    const gaps = [];
    for (let i = 1; i < this.snapshotArrivalTimes.length; i += 1) {
      gaps.push(this.snapshotArrivalTimes[i] - this.snapshotArrivalTimes[i - 1]);
    }
    let maxSeqGap = 0;
    for (let i = 1; i < this.snapshotSeqs.length; i += 1) {
      maxSeqGap = Math.max(maxSeqGap, this.snapshotSeqs[i] - this.snapshotSeqs[i - 1]);
    }
    return {
      role: this.role,
      wireBytes: Math.max(0, endWireBytes - this.startWireBytes),
      snapshotRawBytes: this.snapshotRawBytes,
      snapshotCount: this.snapshotCount,
      arrivalP50Ms: percentile(gaps, 0.5),
      arrivalP95Ms: percentile(gaps, 0.95),
      arrivalMaxMs: gaps.length ? Math.max(...gaps) : 0,
      maxSeqGap,
      keyframes: this.keyframeCount,
      deltas: this.deltaCount,
      protocolError: this.protocolError,
      minSnapshotRate: this.snapshotRates.length ? Math.min(...this.snapshotRates) : 0,
      maxSnapshotRate: this.snapshotRates.length ? Math.max(...this.snapshotRates) : 0,
      finalSnapshotRate: this.snapshotRates.at(-1) || 0,
      maxStreamTier: Math.max(0, ...this.streamTiers),
    };
  }

  close() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      // 压测客户端不需要等待 WebSocket 关闭握手；直接终止可避免测试结束后残留30秒定时器。
      this.ws.terminate();
    }
  }
}

async function startLocalServer() {
  localServer = spawn(process.execPath, ["server/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(localPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  localServer.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  localServer.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  await Promise.race([
    new Promise((resolve, reject) => {
      const check = setInterval(() => {
        if (output.includes("网络对战服务器已启动")) {
          clearInterval(check);
          resolve();
        }
        if (localServer.exitCode !== null) {
          clearInterval(check);
          reject(new Error(`本地服务器提前退出：${output.trim()}`));
        }
      }, 20);
    }),
    delay(5000).then(() => {
      throw new Error(`本地服务器启动超时：${output.trim()}`);
    }),
  ]);
}

async function sampleServerProcess(samples) {
  if (!localServer || localServer.exitCode !== null) {
    return;
  }
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "%cpu=,rss=", "-p", String(localServer.pid)]);
    const [cpuRaw, rssRaw] = stdout.trim().split(/\s+/);
    const cpu = Number(cpuRaw);
    const rssKb = Number(rssRaw);
    if (Number.isFinite(cpu) && Number.isFinite(rssKb)) {
      samples.push({ cpu, rssMb: rssKb / 1024 });
    }
  } catch (_error) {
    // 压测结果仍可使用网络数据，进程采样失败不应中断整轮测试。
  }
}

async function stopEverything() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const client of clients) {
    client.close();
  }
  await delay(80);
  if (localServer && localServer.exitCode === null) {
    localServer.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => localServer.once("exit", resolve)),
      delay(1500),
    ]);
    if (localServer.exitCode === null) {
      localServer.kill("SIGKILL");
    }
  }
}

function summarize(results, role) {
  const selected = results.filter((item) => item.role === role);
  const wireBytes = selected.reduce((sum, item) => sum + item.wireBytes, 0);
  const rawBytes = selected.reduce((sum, item) => sum + item.snapshotRawBytes, 0);
  const snapshots = selected.reduce((sum, item) => sum + item.snapshotCount, 0);
  return {
    connections: selected.length,
    snapshots,
    snapshotsPerSecondPerConnection: round(snapshots / Math.max(1, selected.length) / durationSeconds),
    wireKBpsTotal: round(wireBytes / durationSeconds / 1024),
    rawKBpsTotal: round(rawBytes / durationSeconds / 1024),
    wireBytesPerSnapshot: snapshots ? round(wireBytes / snapshots) : 0,
    rawBytesPerSnapshot: snapshots ? round(rawBytes / snapshots) : 0,
    arrivalP95Ms: round(percentile(selected.map((item) => item.arrivalP95Ms), 0.95)),
    arrivalMaxMs: round(Math.max(0, ...selected.map((item) => item.arrivalMaxMs))),
    maxSeqGap: Math.max(0, ...selected.map((item) => item.maxSeqGap)),
    keyframes: selected.reduce((sum, item) => sum + item.keyframes, 0),
    deltas: selected.reduce((sum, item) => sum + item.deltas, 0),
    minSnapshotRate: Math.min(...selected.map((item) => item.minSnapshotRate)),
    maxSnapshotRate: Math.max(0, ...selected.map((item) => item.maxSnapshotRate)),
    minFinalSnapshotRate: Math.min(...selected.map((item) => item.finalSnapshotRate)),
    maxFinalSnapshotRate: Math.max(0, ...selected.map((item) => item.finalSnapshotRate)),
    maxStreamTier: Math.max(0, ...selected.map((item) => item.maxStreamTier)),
  };
}

async function main() {
  if (shouldStartServer) {
    await startLocalServer();
  }

  const rooms = [];
  for (let roomIndex = 0; roomIndex < roomCount; roomIndex += 1) {
    const host = new LoadClient("player", roomIndex, 0);
    const guest = new LoadClient("player", roomIndex, 1);
    const spectators = Array.from(
      { length: spectatorsPerRoom },
      (_unused, index) => new LoadClient("spectator", roomIndex, index),
    );
    rooms.push({ host, guest, spectators, roomId: null });
    clients.push(host, guest, ...spectators);
  }

  await Promise.all(clients.map((client) => client.connect()));
  const unackedClients = clients.slice(Math.max(0, clients.length - unackedClientCount));
  for (const client of unackedClients) {
    client.deliveryAckEnabled = false;
  }

  await Promise.all(
    rooms.map(async (room, roomIndex) => {
      room.host.send({ type: "set_name", name: `压测主机${roomIndex}` });
      room.host.send({ type: "create_room", visibility: "public", mode: "pvp" });
      const state = await room.host.waitFor(
        (message) => message.type === "room_state" && message.self?.seat === "A" && message.room?.status === "waiting",
      );
      room.roomId = state.room.roomId;
    }),
  );

  await Promise.all(
    rooms.map(async (room, roomIndex) => {
      room.guest.send({ type: "set_name", name: `压测客机${roomIndex}` });
      room.guest.send({ type: "join_room", roomId: room.roomId });
      await room.guest.waitFor(
        (message) => message.type === "room_state" && message.room?.roomId === room.roomId && message.room?.status === "countdown",
      );
    }),
  );

  await Promise.all(
    rooms.map((room) =>
      room.host.waitFor(
        (message) => message.type === "room_state" && message.room?.roomId === room.roomId && message.room?.status === "running",
        9000,
      ),
    ),
  );

  await Promise.all(
    rooms.flatMap((room) =>
      room.spectators.map(async (spectator) => {
        spectator.send({ type: "spectate_room", roomId: room.roomId });
        await spectator.waitFor(
          (message) =>
            message.type === "room_state" &&
            message.room?.roomId === room.roomId &&
            message.self?.spectating === true,
        );
      }),
    ),
  );

  let inputSeq = 0;
  for (const room of rooms) {
    room.host.send({
      type: "input",
      seq: ++inputSeq,
      action: { type: "set_route", shipKey: "main", endX: 680, endY: 720, throttle: 1.4 },
    });
    room.guest.send({
      type: "input",
      seq: ++inputSeq,
      action: { type: "set_route", shipKey: "main", endX: 760, endY: 720, throttle: 1.4 },
    });
    room.host.send({
      type: "input",
      seq: ++inputSeq,
      action: { type: "configure_auto_scout", enabled: true, zoneId: 5 },
    });
    room.guest.send({
      type: "input",
      seq: ++inputSeq,
      action: { type: "configure_auto_scout", enabled: true, zoneId: 5 },
    });
  }

  await delay(250);
  for (const client of clients) {
    client.beginMeasure();
  }
  if (ackRecoverySeconds > 0 && unackedClients.length > 0) {
    setTimeout(() => {
      for (const client of unackedClients) {
        client.deliveryAckEnabled = true;
      }
    }, ackRecoverySeconds * 1000).unref();
  }

  const processSamples = [];
  let sampling = false;
  const sampleTimer = setInterval(async () => {
    if (sampling) {
      return;
    }
    sampling = true;
    await sampleServerProcess(processSamples);
    sampling = false;
  }, 500);

  await delay(durationSeconds * 1000);
  clearInterval(sampleTimer);
  await sampleServerProcess(processSamples);

  const results = clients.map((client) => client.finishMeasure());
  const protocolError = results.find((item) => item.protocolError);
  if (protocolError) {
    throw new Error(`快照协议校验失败：${protocolError.protocolError}`);
  }
  const wireBytes = results.reduce((sum, item) => sum + item.wireBytes, 0);
  const rawBytes = results.reduce((sum, item) => sum + item.snapshotRawBytes, 0);
  const report = {
    scenario: {
      url: wsUrl,
      localServer: shouldStartServer,
      rooms: roomCount,
      players: roomCount * 2,
      spectators: roomCount * spectatorsPerRoom,
      totalConnections: clients.length,
      durationSeconds,
    },
    total: {
      wireKBps: round(wireBytes / durationSeconds / 1024),
      snapshotRawKBps: round(rawBytes / durationSeconds / 1024),
      compressionRatio: rawBytes > 0 ? round(wireBytes / rawBytes, 4) : 0,
    },
    players: summarize(results, "player"),
    spectators: summarize(results, "spectator"),
    server: {
      cpuAveragePercent: round(
        processSamples.reduce((sum, sample) => sum + sample.cpu, 0) / Math.max(1, processSamples.length),
      ),
      cpuMaxPercent: round(Math.max(0, ...processSamples.map((sample) => sample.cpu))),
      rssAverageMb: round(
        processSamples.reduce((sum, sample) => sum + sample.rssMb, 0) / Math.max(1, processSamples.length),
      ),
      rssMaxMb: round(Math.max(0, ...processSamples.map((sample) => sample.rssMb))),
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

process.once("SIGINT", async () => {
  await stopEverything();
  process.exit(130);
});
process.once("SIGTERM", async () => {
  await stopEverything();
  process.exit(143);
});

try {
  await main();
} catch (error) {
  console.error(`网络压力测试失败：${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await stopEverything();
}
