import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = new URL("./fixtures/architecture-replay.json", import.meta.url);
const script = fileURLToPath(import.meta.url);

// 两个版本使用相同场景和随机序列，分别在独立进程中执行，避免全局状态相互影响。
async function replay(corePath) {
  const { CHARACTER_ORDER, MatchSimulation, TICK_DT, __resetEntityIds } = await import(pathToFileURL(corePath));
  const results = [];
  const roster = [...new Set([...CHARACTER_ORDER, "bunny_haruhi"])];
  const originalRandom = Math.random;
  function loadout(index) {
    return Object.fromEntries(["main", "sub1", "sub2"].map((key, offset) => [
      key, roster[(index + offset) % roster.length],
    ]));
  }
  try {
    for (let index = 0; index < roster.length; index += 1) {
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
          segments.push(digest.digest("hex"));
          digest = createHash("sha256");
        }
      }
      results.push({ index, difficulty, segments });
    }
  } finally {
    Math.random = originalRandom;
  }
  return results;
}

export function compareReplay(expected, actual) {
  assert.equal(actual.length, expected.length, "回放阵容数量必须与重构前一致");
  for (const [index, result] of actual.entries()) {
    const before = expected[index];
    assert.equal(result.index, before.index, "回放阵容顺序必须一致");
    assert.equal(result.difficulty, before.difficulty, "回放难度必须一致");
    assert.equal(result.segments.length, before.segments.length, "回放帧数必须一致");
    for (const [segment, hash] of result.segments.entries()) {
      assert.equal(hash, before.segments[segment],
        `阵容 ${index}（${result.difficulty}）在第 ${segment * 300 + 1}～${(segment + 1) * 300} 帧与重构前行为不同`);
    }
  }
}

function runWorker(corePath) {
  return JSON.parse(execFileSync(process.execPath, [script, "--worker", corePath], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"],
  }));
}

// 固定 Git 提交才是跨运行环境的行为基线；原摘要继续保留，不从候选代码更新预期。
function compareInSameRuntime(recorded) {
  assert.match(recorded.baseline, /^[a-f0-9]{40}$/, "回放基线必须是完整 Git 提交号");
  const temporary = mkdtempSync(join(tmpdir(), "haruhi-replay-"));
  try {
    const archive = join(temporary, "baseline.tar");
    execFileSync("git", ["archive", recorded.baseline, "shared", "package.json", "-o", archive], { cwd: root });
    execFileSync("tar", ["-xf", archive, "-C", temporary]);
    const expected = runWorker(join(temporary, "shared/game-core.js"));
    const actual = runWorker(join(root, "shared/game-core.js"));
    compareReplay(expected, actual);
    const matchesRecorded = JSON.stringify(expected) === JSON.stringify(recorded.cases);
    console.log(`同环境对照：${recorded.baseline.slice(0, 7)} → 当前代码，${process.platform}/${process.arch} ${process.version}；`
      + (matchesRecorded ? "原始摘要一致。" : "原始录制环境的摘要不同，本次严格比较固定提交与当前代码的完整状态摘要。"));
    return actual;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [mode, corePath] = process.argv.slice(2);
  if (mode === "--worker" && corePath) {
    console.log(JSON.stringify(await replay(resolve(corePath))));
  } else {
    assert.ok([undefined, "--record", "--same-runtime"].includes(mode), "未知回放选项");
    const recorded = JSON.parse(readFileSync(fixture, "utf8"));
    const results = mode === "--same-runtime"
      ? compareInSameRuntime(recorded) : await replay(join(root, "shared/game-core.js"));
    if (mode === "--record") {
      writeFileSync(fixture, `${JSON.stringify({ baseline: recorded.baseline, cases: results }, null, 2)}\n`);
    } else if (mode !== "--same-runtime") {
      compareReplay(recorded.cases, results);
    }
    console.log(`架构回放${mode === "--record" ? "基线录制" : "校验"}通过：${results.length} 组阵容、四种难度，共 ${results.length * 3600} 帧权威状态与 AI 决策。`);
  }
}
