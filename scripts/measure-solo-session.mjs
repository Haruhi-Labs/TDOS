// 离线测量单人帧管线（模拟、序列化、插值），不包含 DOM、Canvas 或 GPU。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const baseline = JSON.parse(readFileSync(join(root, "scripts/fixtures/architecture-replay.json"), "utf8")).baseline;
const options = { mode: "ai", seed: 714931, aiDifficulty: "master" };
async function measure(moduleRoot, current) {
  let advance;
  if (current) {
    const { createSoloSession } = await import(pathToFileURL(join(moduleRoot, "src/solo/session.js")));
    const session = createSoloSession();
    session.reset(options, 0);
    advance = (timestamp) => session.advance(timestamp);
  } else {
    const { MatchSimulation, TICK_DT } = await import(pathToFileURL(join(moduleRoot, "shared/game-core.js")));
    const { createFixedStepClock } = await import(pathToFileURL(join(moduleRoot, "shared/game/fixed-step-clock.js")));
    const { interpolateBattleState } = await import(pathToFileURL(join(moduleRoot, "src/battle/state-interpolation.js")));
    const simulation = new MatchSimulation(options);
    const clock = createFixedStepClock();
    let state = simulation.serializeState(), previous = state, latest = state;
    // 原 solo.tick 的帧推进路径，避免加载依赖 DOM 的页面装配代码。
    advance = (timestamp) => {
      const active = state.phase !== "finished";
      const steps = clock.advance(timestamp, (dt) => {
        previous = latest || state || simulation.serializeState();
        simulation.update(dt);
        latest = simulation.serializeState();
      }, { active });
      state = steps > 0 ? latest : simulation.serializeState();
      if (steps === 0) latest = state;
      return { state, renderState: active && state.phase !== "finished" && previous && latest
        ? interpolateBattleState(previous, latest, clock.getAccumulatorSeconds() / TICK_DT, { spanSeconds: TICK_DT }) : state };
    };
  }
  const samples = [];
  const phases = { simulation: [], interpolation: [], finished: [] };
  let previousElapsed = 0;
  const summarize = (values) => {
    if (!values.length) return { count: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const totalMs = values.reduce((total, value) => total + value, 0);
    return { count: values.length, medianMs: sorted[Math.floor(sorted.length / 2)],
      p95Ms: sorted[Math.floor(sorted.length * 0.95)], maxMs: sorted.at(-1),
      meanMs: totalMs / values.length, totalMs };
  };
  const hash = createHash("sha256");
  for (let frame = 1; frame <= 1800; frame += 1) {
    const begin = performance.now();
    const value = advance(frame * 1000 / 60);
    const duration = performance.now() - begin;
    // 分类和摘要都在计时区间外；保留混合帧指标，不能用分类结果替换原验收口径。
    const phase = value.state.elapsed !== previousElapsed ? "simulation"
      : value.state.phase === "finished" ? "finished" : "interpolation";
    previousElapsed = value.state.elapsed;
    if (frame > 120) {
      samples.push(duration);
      phases[phase].push(duration);
    }
    hash.update(JSON.stringify(value));
  }
  return { ...summarize(samples),
    phases: Object.fromEntries(Object.entries(phases).map(([phase, values]) => [phase, summarize(values)])),
    digest: hash.digest("hex") };
}
if (process.argv[2] === "--worker") {
  console.log(JSON.stringify(await measure(process.argv[3], process.argv[4] === "after")));
} else {
  const directory = mkdtempSync(join(tmpdir(), "solo-session-performance-"));
  const environment = { measuredAt: new Date().toISOString(), cpu: cpus()[0]?.model, loadBefore: loadavg(),
    head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim() };
  const runs = { before: [], after: [] };
  try {
    const archive = join(directory, "baseline.tar");
    execFileSync("git", ["archive", baseline, "shared", "src/battle/state-interpolation.js", "src/battle/status-effect-timing.js", "package.json", "-o", archive], { cwd: root });
    execFileSync("tar", ["-xf", archive, "-C", directory]);
    for (let repeat = 0; repeat < 5; repeat += 1) {
      for (const side of repeat % 2 ? ["after", "before"] : ["before", "after"]) {
        runs[side].push(JSON.parse(execFileSync(process.execPath, [resolve(import.meta.filename), "--worker", side === "before" ? directory : root, side], { encoding: "utf8" })));
      }
      assert.equal(runs.before[repeat].digest, runs.after[repeat].digest, "单人每帧的权威与显示输出必须匹配原始基线");
    }
    const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const summaries = Object.fromEntries(Object.entries(runs).map(([side, values]) => [side, {
      medianMs: median(values.map((value) => value.medianMs)), p95Ms: median(values.map((value) => value.p95Ms)), maxMs: Math.max(...values.map((value) => value.maxMs)),
      meanMs: median(values.map((value) => value.meanMs)), totalMs: median(values.map((value) => value.totalMs)),
      phases: Object.fromEntries(Object.keys(values[0].phases).map((phase) => [phase,
        Object.fromEntries(Object.keys(values[0].phases[phase]).map((key) => [key,
          key === "maxMs" ? Math.max(...values.map((value) => value.phases[phase][key]))
            : median(values.map((value) => value.phases[phase][key])),
        ])),
      ])),
    }]));
    const regressionPercent = Object.fromEntries(["medianMs", "p95Ms"].map((key) => [key, (summaries.after[key] / summaries.before[key] - 1) * 100]));
    const output = { baseline, node: process.version, environment: { ...environment, loadAfter: loadavg() },
      runs, summaries, regressionPercent, withinSuggestedFivePercent: Object.values(regressionPercent).every((value) => value <= 5) };
    mkdirSync(join(root, "bench/architecture-acceptance"), { recursive: true });
    writeFileSync(join(root, "bench/architecture-acceptance/solo-session-performance.json"), JSON.stringify(output, null, 2));
    console.log(JSON.stringify({ summaries, regressionPercent, withinSuggestedFivePercent: output.withinSuggestedFivePercent }, null, 2));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
