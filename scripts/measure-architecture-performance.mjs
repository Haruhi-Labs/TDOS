// 同机、独立进程、交替顺序对照；不连接服务，不更新行为基线。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const baseline = JSON.parse(readFileSync(join(root, "scripts/fixtures/architecture-replay.json"), "utf8")).baseline;
const temporary = mkdtempSync(join(tmpdir(), "architecture-performance-"));
const output = join(root, "bench/architecture-acceptance");
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
try {
  const archive = join(temporary, "baseline.tar");
  execFileSync("git", ["archive", baseline, "shared", "package.json", "-o", archive], { cwd: root });
  execFileSync("tar", ["-xf", archive, "-C", temporary]);
  const runs = { ordinary: { before: [], after: [] }, supportPressure: { before: [], after: [] } };
  for (let repeat = 0; repeat < 5; repeat += 1) {
    for (const [scenario, samples] of Object.entries(runs)) {
      for (const side of repeat % 2 ? ["after", "before"] : ["before", "after"]) {
        const value = JSON.parse(execFileSync(process.execPath, [
          join(root, "scripts/measure-bunny-haruhi.mjs"), "--worker",
          side === "before" ? temporary : root, scenario === "supportPressure" ? "worst" : "ordinary",
        ], { cwd: root, encoding: "utf8" }));
        samples[side].push(value);
      }
      assert.equal(samples.before[repeat].digest, samples.after[repeat].digest, `${scenario} 前后权威状态必须一致`);
      assert.equal(samples.before[repeat].maxSnapshotBytes, samples.after[repeat].maxSnapshotBytes, `${scenario} 快照字节不得变化`);
    }
    console.log(`架构性能对照完成 ${repeat + 1}/5`);
  }
  const summaries = Object.fromEntries(Object.entries(runs).map(([scenario, samples]) => {
    const summary = Object.fromEntries(Object.entries(samples).map(([side, values]) => [side, {
      medianMs: median(values.map((value) => value.medianMs)),
      p95Ms: median(values.map((value) => value.p95Ms)),
      maxMs: Math.max(...values.map((value) => value.maxMs)),
      maxSnapshotBytes: values[0].maxSnapshotBytes,
    }]));
    summary.regressionPercent = Object.fromEntries(["medianMs", "p95Ms"].map((key) => [key, (summary.after[key] / summary.before[key] - 1) * 100]));
    summary.withinSuggestedFivePercent = Object.values(summary.regressionPercent).every((value) => value <= 5);
    return [scenario, summary];
  }));
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "performance.json"), JSON.stringify({ baseline, node: process.version, cpu: cpus()[0]?.model, runs, summaries,
    note: "复用已有普通战斗与全部支援压力夹具，测量实际模拟 tick；不包含浏览器渲染、网络解码或每帧序列化成本。5%仅为提示，不放宽门槛或隐藏离群值。" }, null, 2));
  console.log(JSON.stringify(summaries, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
