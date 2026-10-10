import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { CHARACTER_ORDER, MatchSimulation, TICK_DT, __resetEntityIds } from "../shared/game-core.js";

// 基线只在明确评估规则变化后重新录制；架构重构必须逐段匹配原有权威与 AI 输出。
const fixture = new URL("./fixtures/architecture-replay.json", import.meta.url);
const record = process.argv.includes("--record");
const expected = record ? null : JSON.parse(readFileSync(fixture, "utf8"));
const results = [];
const originalRandom = Math.random;
function loadout(index) {
  return Object.fromEntries(["main", "sub1", "sub2"].map((key, offset) => [
    key, CHARACTER_ORDER[(index + offset) % CHARACTER_ORDER.length],
  ]));
}
try {
  for (let index = 0; index < CHARACTER_ORDER.length; index += 1) {
    let seed = (0x1096cafe + index) >>> 0;
    Math.random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    __resetEntityIds(1);
    const difficulty = ["easy", "normal", "hard", "master"][index % 4];
    const simulation = new MatchSimulation({
      mode: "pvp", worldSize: 1440, aiSeats: ["A", "B"], aiDifficulty: difficulty,
      teamLoadouts: { A: loadout(index), B: loadout(index + 3) },
    });
    const segments = [];
    let digest = createHash("sha256");
    for (let tick = 1; tick <= 3600; tick += 1) {
      simulation.update(TICK_DT);
      digest.update(JSON.stringify(simulation.serializeState()));
      if (tick % 300 === 0) {
        const hash = digest.digest("hex");
        segments.push(hash);
        if (expected) assert.equal(hash, expected.cases[index].segments[segments.length - 1],
          `阵容 ${index}（${difficulty}）在第 ${tick - 299}～${tick} 帧与重构前行为不同`);
        digest = createHash("sha256");
      }
    }
    results.push({ index, difficulty, segments });
  }
} finally {
  Math.random = originalRandom;
}
if (record) writeFileSync(fixture, `${JSON.stringify({ baseline: "83766723e1047ed2ba94df1f565e4cbdba9ee667", cases: results }, null, 2)}\n`);
console.log(`架构回放${record ? "基线录制" : "校验"}通过：八组阵容、四种难度，共 28800 帧权威状态与 AI 决策。`);
