const METRIC_NAMES = Object.freeze([
  "inputs",
  "simulation",
  "snapshotBuild",
  "snapshotSend",
  "eventLoopDelay",
]);

function quantile(samples, fraction) {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function formatMetric(samples) {
  return `${quantile(samples, 0.5).toFixed(1)}/${quantile(samples, 0.95).toFixed(1)}ms`;
}

export function createServerPerformanceDiagnostics({
  enabled = false,
  now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  reportIntervalMs = 10_000,
  maxSamples = 300,
  log = console.log,
} = {}) {
  const active = enabled === true;
  const samples = Object.fromEntries(METRIC_NAMES.map((name) => [name, []]));
  let catchupDrops = 0;
  let lastReportAt = now();

  function record(name, durationMs) {
    if (!active || !Object.hasOwn(samples, name)) return;
    const duration = Number(durationMs);
    if (!Number.isFinite(duration) || duration < 0) return;
    const metric = samples[name];
    metric.push(duration);
    if (metric.length > maxSamples) metric.splice(0, metric.length - maxSamples);
  }

  function recordCatchupDrop() {
    if (active) catchupDrops += 1;
  }

  function flush({ activeRooms = 0, players = 0 } = {}) {
    if (!active) return false;
    const timestamp = now();
    if (timestamp - lastReportAt < reportIntervalMs) return false;
    if (Number(activeRooms) <= 0) return false;
    lastReportAt = timestamp;
    log(
      `[perf] rooms=${Math.max(0, Number(activeRooms) || 0)} players=${Math.max(0, Number(players) || 0)}`
      + ` input=${formatMetric(samples.inputs)}`
      + ` sim=${formatMetric(samples.simulation)}`
      + ` snapshot=${formatMetric(samples.snapshotBuild)}+${formatMetric(samples.snapshotSend)}`
      + ` loop=${formatMetric(samples.eventLoopDelay)}`
      + ` catchupDrops=${catchupDrops}`,
    );
    catchupDrops = 0;
    return true;
  }

  return {
    enabled: active,
    record,
    recordEventLoopDelay(durationMs) {
      record("eventLoopDelay", durationMs);
    },
    recordCatchupDrop,
    flush,
  };
}
