import { createInterface } from "node:readline";
import { RlBatchEnvironment } from "../../shared/training/environment.js";
import { RlBenchmarkBatchEnvironment } from "../../shared/training/evaluation.js";

let batch = null;

function requireBatch() {
  if (!batch) throw new Error("批环境尚未初始化");
  return batch;
}

function handle(message) {
  const command = String(message.command || "");
  const payload = message.payload || {};
  if (command === "ping") {
    return { protocol: 1, ready: Boolean(batch), count: batch?.count || 0 };
  }
  if (command === "init") {
    if (batch) throw new Error("批环境已经初始化");
    const Environment = payload.kind === "benchmark"
      ? RlBenchmarkBatchEnvironment
      : RlBatchEnvironment;
    batch = new Environment({
      count: payload.count,
      baseSeed: payload.baseSeed,
      decisionTicks: payload.decisionTicks,
      maxEpisodeSeconds: payload.maxEpisodeSeconds,
      streamOffset: payload.streamOffset,
    });
    return { protocol: 1, count: batch.count };
  }
  if (command === "reset") {
    return requireBatch().reset(Array.isArray(payload.options) ? payload.options : []);
  }
  if (command === "reset_at") {
    return requireBatch().resetAt(Number(payload.index), payload.options || {});
  }
  if (command === "step") {
    return requireBatch().step(Array.isArray(payload.actions) ? payload.actions : []);
  }
  if (command === "close") {
    return { closing: true };
  }
  throw new Error(`未知批环境命令：${command}`);
}

function respond(id, body) {
  process.stdout.write(`${JSON.stringify({ id, ...body })}\n`);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    respond(null, { ok: false, error: `JSON 格式错误：${error.message}` });
    continue;
  }
  const id = message.id ?? null;
  try {
    const result = handle(message);
    respond(id, { ok: true, result });
    if (message.command === "close") break;
  } catch (error) {
    respond(id, { ok: false, error: String(error?.message || error) });
  }
}
