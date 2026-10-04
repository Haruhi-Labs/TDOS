// AI 重构期的黄金轨迹工具：在固定随机序列下逐帧记录对局摘要，用于证明重构前后行为一致。
// 基线对任何规则改动都敏感，只作为本地门禁使用，不加入 test:all。
//
//   node scripts/ai/golden-trace.mjs --record              录制基线
//   node scripts/ai/golden-trace.mjs                       与基线比对（默认）
//   node scripts/ai/golden-trace.mjs --scenario=<名称>      只处理名称包含该文本的场景
//   node scripts/ai/golden-trace.mjs --dump=<名称>:<tick>   输出该场景运行到指定 tick 后的完整状态
//   node scripts/ai/golden-trace.mjs --perf                记录 tick 耗时基线
//   --baseline=<路径>  指定基线文件；--out=<路径>  指定录制或耗时输出文件；--force  忽略环境不符
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import {
  CHARACTER_ORDER,
  MatchSimulation,
  TICK_DT,
  __resetEntityIds,
} from "../../shared/game-core.js";
import { RULESET_VERSION } from "../../shared/protocol/ruleset-version.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_BASELINE = resolve(ROOT, "bench/ai/golden/baseline.json");
const DEFAULT_PERF_OUTPUT = resolve(ROOT, "bench/ai/baseline/tick-timing.json");
const WORLD_SIZE = 1440;
const CHECKPOINT_TICKS = 30;

function parseArgs(argv) {
  const args = { record: false, perf: false, force: false, scenario: null, dump: null, baseline: null, out: null };
  for (const item of argv) {
    if (item === "--record") args.record = true;
    else if (item === "--perf") args.perf = true;
    else if (item === "--force") args.force = true;
    else if (item.startsWith("--scenario=")) args.scenario = item.slice("--scenario=".length);
    else if (item.startsWith("--dump=")) args.dump = item.slice("--dump=".length);
    else if (item.startsWith("--baseline=")) args.baseline = item.slice("--baseline=".length);
    else if (item.startsWith("--out=")) args.out = item.slice("--out=".length);
    else throw new Error(`未知参数：${item}`);
  }
  return args;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  const random = () => {
    random.calls += 1;
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  random.calls = 0;
  return random;
}

function seconds(value) {
  return Math.ceil(value / TICK_DT);
}

function loadoutAt(index) {
  const main = CHARACTER_ORDER[index % CHARACTER_ORDER.length];
  const subOrder = CHARACTER_ORDER.filter((characterId) => characterId !== main);
  return {
    main,
    sub1: subOrder[(index + 1) % subOrder.length],
    sub2: subOrder[(index + 2) % subOrder.length],
  };
}

function holdShip(ship, x, y, angle = null) {
  ship.x = x;
  ship.y = y;
  if (angle !== null) ship.angle = angle;
  ship.command = { x, y };
  ship.route = null;
}

// 与 simulate-ai-battles.mjs 的固定破盾布置保持一致。
function buildBarrierBreach(breakerKind) {
  const isHaruhi = breakerKind === "haruhi_otherworlder";
  const breakerCharacter = breakerKind === "blade_queen" ? "asakura" : "koizumi";
  const simulation = new MatchSimulation({
    mode: "pvp",
    worldSize: WORLD_SIZE,
    aiSeats: ["B"],
    aiDifficulty: "master",
    teamLoadouts: {
      A: { main: "koizumi", sub1: "yuki", sub2: "shamisen" },
      B: isHaruhi
        ? { main: "haruhi", sub1: "yuki", sub2: "future1096" }
        : { main: "kyon", sub1: breakerCharacter, sub2: "yuki" },
    },
  });
  simulation.setCombatEnabled("A", false);
  simulation.setCombatEnabled("B", false);
  const defendingMain = simulation.teamA.ships.main;
  const attackingTeam = simulation.teamB;
  const bot = simulation.botBySeat("B");
  const breaker = isHaruhi ? attackingTeam.ships.main : attackingTeam.ships.sub1;
  if (!isHaruhi) attackingTeam.split(1);
  if (isHaruhi) {
    attackingTeam.haruhiFlagship.supporters.add("otherworlder");
    attackingTeam.haruhiFlagship.otherworlderReadyAt = simulation.elapsed;
    bot.flagshipTimer = 999;
  } else {
    bot.subTimers.sub1 = 0;
  }
  holdShip(defendingMain, 650, 720);
  holdShip(breaker, 940, 720, Math.PI);
  breaker.energy = breaker.maxEnergy;
  attackingTeam.ships.main.x = isHaruhi ? breaker.x : 1010;
  attackingTeam.ships.main.y = 720;
  bot.moveTimer = 0;
  bot.rememberContact(defendingMain, "visible");
  return simulation;
}

function buildBarrierInfiltration() {
  const simulation = new MatchSimulation({
    mode: "pvp",
    worldSize: WORLD_SIZE,
    aiSeats: ["B"],
    aiDifficulty: "master",
    teamLoadouts: {
      A: { main: "koizumi", sub1: "yuki", sub2: "tsuruya" },
      B: { main: "kyon", sub1: "yuki", sub2: "shamisen" },
    },
  });
  simulation.setCombatEnabled("A", false);
  const defendingMain = simulation.teamA.ships.main;
  const bot = simulation.botBySeat("B");
  holdShip(defendingMain, 650, 720);
  holdShip(simulation.teamB.ships.main, 930, 720, Math.PI);
  bot.moveTimer = 0;
  bot.rememberContact(defendingMain, "visible");
  return simulation;
}

function buildScenarios() {
  const scenarios = [];
  const aiDuel = (options) => new MatchSimulation({
    mode: "pvp",
    worldSize: WORLD_SIZE,
    aiSeats: ["A", "B"],
    aiDifficulty: "master",
    ...options,
  });

  // G1：全角色镜像对局，与 simulate-ai-battles.mjs 的阵容轮转和种子相同。
  let matchIndex = 0;
  for (let round = 0; round < 2; round += 1) {
    for (let index = 0; index < CHARACTER_ORDER.length; index += 1) {
      const left = loadoutAt(index);
      const right = loadoutAt(index + 3);
      const teamLoadouts = round === 0 ? { A: left, B: right } : { A: right, B: left };
      scenarios.push({
        name: `g1-mirror-${String(matchIndex + 1).padStart(2, "0")}-${teamLoadouts.A.main}-vs-${teamLoadouts.B.main}`,
        seed: 0x5a17 + matchIndex * 7919,
        maxTicks: seconds(240),
        build: () => aiDuel({ teamLoadouts }),
      });
      matchIndex += 1;
    }
  }

  // G2：单人模式的三档非极限难度，A 席无输入。
  const soloLoadouts = [
    { A: { main: "kyon", sub1: "asakura", sub2: "koizumi" }, B: { main: "yuki", sub1: "future1096", sub2: "shamisen" } },
    { A: { main: "haruhi", sub1: "yuki", sub2: "tsuruya" }, B: { main: "asakura", sub1: "koizumi", sub2: "kyon" } },
  ];
  for (const [difficultyIndex, aiDifficulty] of ["easy", "normal", "hard"].entries()) {
    for (const [loadoutIndex, teamLoadouts] of soloLoadouts.entries()) {
      scenarios.push({
        name: `g2-solo-${aiDifficulty}-${loadoutIndex + 1}`,
        seed: 0x2d1f + difficultyIndex * 131 + loadoutIndex * 17,
        maxTicks: seconds(90),
        build: () => new MatchSimulation({ mode: "ai", worldSize: WORLD_SIZE, aiDifficulty, teamLoadouts }),
      });
    }
  }

  // G3：旧版 AI 对照分支。
  for (const [index, offset] of [1, 5].entries()) {
    const teamLoadouts = { A: loadoutAt(offset), B: loadoutAt(offset + 4) };
    scenarios.push({
      name: `g3-legacy-${index + 1}`,
      seed: 0x3e9a + index * 211,
      maxTicks: seconds(120),
      build: () => aiDuel({ teamLoadouts, legacyAiSeats: ["B"] }),
    });
  }

  // G4：兔女郎春日分别担任旗舰与副舰（阵容取自 bunny-ai-suite.mjs）。
  const bunnyLoadouts = {
    main: { main: "bunny_haruhi", sub1: "kyon", sub2: "yuki" },
    sub1: { main: "kyon", sub1: "bunny_haruhi", sub2: "yuki" },
  };
  for (const [slot, loadout] of Object.entries(bunnyLoadouts)) {
    scenarios.push({
      name: `g4-bunny-${slot}`,
      seed: 410 + (slot === "main" ? 0 : 1),
      maxTicks: 3600,
      build: () => new MatchSimulation({ mode: "pvp", aiSeats: ["A", "B"], teamLoadouts: { A: loadout } }),
    });
  }

  // G5：古泉能量圈的固定破盾与渗透布置。
  for (const [breakerKind, seed] of [["blade_queen", 0xb1ade], ["koizumi_orb", 0x0b12], ["haruhi_otherworlder", 0xa117]]) {
    scenarios.push({
      name: `g5-breach-${breakerKind}`,
      seed,
      maxTicks: seconds(14),
      build: () => buildBarrierBreach(breakerKind),
    });
  }
  scenarios.push({
    name: "g5-infiltration",
    seed: 0x1f117,
    maxTicks: seconds(30),
    build: buildBarrierInfiltration,
  });

  // G6：三味线旗舰的猎杀进攻，对手侧覆盖被猎杀防守。
  const shamisenLoadouts = [
    { A: { main: "shamisen", sub1: "yuki", sub2: "asakura" }, B: { main: "kyon", sub1: "koizumi", sub2: "future1096" } },
    { A: { main: "haruhi", sub1: "tsuruya", sub2: "yuki" }, B: { main: "shamisen", sub1: "future1096", sub2: "kyon" } },
  ];
  for (const [index, teamLoadouts] of shamisenLoadouts.entries()) {
    scenarios.push({
      name: `g6-shamisen-${index + 1}`,
      seed: 0x6c47 + index * 97,
      maxTicks: seconds(120),
      build: () => aiDuel({ teamLoadouts }),
    });
  }

  // G7：关闭间接情报的对照开关。
  scenarios.push({
    name: "g7-no-indirect-intel",
    seed: 0x7a31,
    maxTicks: seconds(90),
    build: () => {
      const simulation = aiDuel({ teamLoadouts: { A: loadoutAt(2), B: loadoutAt(6) } });
      for (const bot of Object.values(simulation.bots)) bot.noIndirectIntel = true;
      return simulation;
    },
  });

  // G8：钉住走位模式。自然对局很少进入 harvest，cutoff 又多被扇区包围计划接管，
  // 这里固定模式以覆盖每个模式各自的主舰候选点与未分离副舰站位。
  for (const [index, mode] of ["harvest", "regroup", "kite", "collapse", "broadside", "cutoff"].entries()) {
    scenarios.push({
      name: `g8-pinned-${mode}`,
      seed: 0x8d05 + index * 53,
      maxTicks: seconds(45),
      build: () => {
        return aiDuel({ teamLoadouts: { A: loadoutAt(index), B: loadoutAt(index + 4) } });
      },
      // 强制模式（搜索、脱离边缘等）会改写 mode，因此每帧重新钉住。
      beforeTick: (simulation) => {
        for (const bot of Object.values(simulation.bots)) {
          bot.mode = mode;
          bot.modeTimer = 1e9;
        }
      },
    });
  }

  return scenarios;
}

function sha(text) {
  return createHash("sha1").update(text).digest("hex").slice(0, 20);
}

function lightHash(simulation) {
  const values = [simulation.projectiles.length];
  for (const team of [simulation.teamA, simulation.teamB]) {
    values.push(
      team.splitLevel,
      team.scouts.length,
      team.wingmen.length,
      team.cooldowns.scout,
      team.cooldowns.flagship,
      team.cooldowns.sub1,
      team.cooldowns.sub2,
    );
    for (const ship of team.getAllShips()) {
      values.push(ship.x, ship.y, ship.angle, ship.hp, ship.energy, ship.throttle);
    }
  }
  const bytes = new Uint8Array(Float64Array.from(values).buffer);
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) {
    hash = Math.imul(hash ^ bytes[index], 0x01000193);
  }
  return hash >>> 0;
}

function checkpoint(simulation, random) {
  const { bots, ...world } = simulation.serializeState();
  return {
    tick: simulation.tick,
    world: sha(JSON.stringify(world)),
    bots: sha(JSON.stringify(bots)),
    randomCalls: random.calls,
  };
}

function runScenario(scenario, { dumpTick = null, digest = true, timings = null } = {}) {
  const originalRandom = Math.random;
  const random = seededRandom(scenario.seed);
  __resetEntityIds(1);
  Math.random = random;
  try {
    const simulation = scenario.build();
    const light = [];
    const checkpoints = [];
    for (let tick = 0; tick < scenario.maxTicks && simulation.phase === "running"; tick += 1) {
      scenario.beforeTick?.(simulation);
      const startedAt = timings ? performance.now() : 0;
      simulation.update(TICK_DT);
      if (timings) timings.push(performance.now() - startedAt);
      if (digest) {
        light.push(lightHash(simulation));
        if (simulation.tick % CHECKPOINT_TICKS === 0) checkpoints.push(checkpoint(simulation, random));
      }
      if (dumpTick !== null && simulation.tick === dumpTick) {
        return { dump: simulation.serializeState(), randomCalls: random.calls };
      }
    }
    if (dumpTick !== null) {
      throw new Error(`场景 ${scenario.name} 在第 ${simulation.tick} tick 结束，未到达 ${dumpTick}`);
    }
    const final = digest ? checkpoint(simulation, random) : null;
    return {
      name: scenario.name,
      seed: scenario.seed,
      result: {
        ticks: simulation.tick,
        phase: simulation.phase,
        winnerSeat: simulation.winnerSeat,
        durationSeconds: Number(simulation.elapsed.toFixed(3)),
        randomCalls: random.calls,
      },
      light,
      checkpoints,
      final,
    };
  } finally {
    Math.random = originalRandom;
  }
}

function environment() {
  let gitSha = "unknown";
  let dirty = false;
  try {
    gitSha = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
    dirty = execSync("git status --porcelain -- shared", { cwd: ROOT, encoding: "utf8" }).trim().length > 0;
  } catch {
    // 不在 Git 工作区时仍允许录制，只是无法追溯来源提交。
  }
  return {
    gitSha,
    sharedDirty: dirty,
    rulesetVersion: RULESET_VERSION,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
  };
}

function compareScenario(expected, actual) {
  const lightLength = Math.min(expected.light.length, actual.light.length);
  for (let index = 0; index < lightLength; index += 1) {
    if (expected.light[index] !== actual.light[index]) {
      return `第 ${index + 1} tick 的舰船轻量摘要不同`;
    }
  }
  const checkpointLength = Math.min(expected.checkpoints.length, actual.checkpoints.length);
  for (let index = 0; index < checkpointLength; index += 1) {
    const before = expected.checkpoints[index];
    const after = actual.checkpoints[index];
    const kinds = ["randomCalls", "world", "bots"].filter((key) => before[key] !== after[key]);
    if (kinds.length > 0) {
      return `第 ${before.tick} tick 检查点的 ${kinds.join("、")} 不同`
        + `（随机数消费：基线 ${before.randomCalls}，当前 ${after.randomCalls}）`;
    }
  }
  if (JSON.stringify(expected.result) !== JSON.stringify(actual.result)) {
    return `结局不同：基线 ${JSON.stringify(expected.result)}，当前 ${JSON.stringify(actual.result)}`;
  }
  if (JSON.stringify(expected.final) !== JSON.stringify(actual.final)) {
    return `终局检查点不同（第 ${expected.final.tick} tick）`;
  }
  return null;
}

function percentile(sorted, ratio) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function runPerf(scenarios, outputPath) {
  const rounds = [];
  for (let round = 0; round < 3; round += 1) {
    const timings = [];
    for (const scenario of scenarios) runScenario(scenario, { digest: false, timings });
    timings.sort((left, right) => left - right);
    rounds.push({
      ticks: timings.length,
      medianMs: Number(percentile(timings, 0.5).toFixed(4)),
      p95Ms: Number(percentile(timings, 0.95).toFixed(4)),
      maxMs: Number(timings.at(-1).toFixed(4)),
    });
  }
  const report = { environment: environment(), scenarios: scenarios.map((scenario) => scenario.name), rounds };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(rounds, null, 2));
  console.log(`tick 耗时基线已写入 ${outputPath}`);
}

const args = parseArgs(process.argv.slice(2));
const allScenarios = buildScenarios();
const scenarios = args.scenario
  ? allScenarios.filter((scenario) => scenario.name.includes(args.scenario))
  : allScenarios;
if (scenarios.length === 0) throw new Error(`没有名称包含 ${args.scenario} 的场景`);
const baselinePath = args.baseline ? resolve(args.baseline) : DEFAULT_BASELINE;

if (args.dump) {
  const separator = args.dump.lastIndexOf(":");
  const name = args.dump.slice(0, separator);
  const dumpTick = Number(args.dump.slice(separator + 1));
  const scenario = allScenarios.find((item) => item.name === name);
  if (!scenario || !Number.isInteger(dumpTick) || dumpTick < 1) {
    throw new Error("--dump 需要 <完整场景名>:<正整数 tick>");
  }
  console.log(JSON.stringify(runScenario(scenario, { dumpTick }), null, 2));
} else if (args.perf) {
  const perfScenarios = args.scenario ? scenarios : scenarios.filter((scenario) => scenario.name.startsWith("g1-"));
  runPerf(perfScenarios, args.out ? resolve(args.out) : DEFAULT_PERF_OUTPUT);
} else if (args.record) {
  if (args.scenario) throw new Error("录制基线必须包含全部场景，不能与 --scenario 同用");
  const outputPath = args.out ? resolve(args.out) : baselinePath;
  const startedAt = performance.now();
  const baseline = {
    format: 1,
    checkpointTicks: CHECKPOINT_TICKS,
    environment: environment(),
    scenarios: scenarios.map((scenario) => runScenario(scenario)),
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(baseline)}\n`);
  const totalTicks = baseline.scenarios.reduce((sum, item) => sum + item.result.ticks, 0);
  console.log(`已录制 ${baseline.scenarios.length} 个场景、${totalTicks} tick 到 ${outputPath}`
    + `（${((performance.now() - startedAt) / 1000).toFixed(1)} 秒）`);
} else {
  if (!existsSync(baselinePath)) throw new Error(`基线不存在：${baselinePath}，请先在未改动的代码上运行 --record`);
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const current = environment();
  for (const key of ["node", "platform"]) {
    if (baseline.environment[key] !== current[key] && !args.force) {
      throw new Error(`运行环境与基线不符（${key}：基线 ${baseline.environment[key]}，当前 ${current[key]}）；`
        + "浮点结果不保证可比，请在基线提交上重录，或用 --force 强制比对");
    }
  }
  if (baseline.environment.rulesetVersion !== current.rulesetVersion) {
    console.warn(`注意：规则版本已从 ${baseline.environment.rulesetVersion} 变为 ${current.rulesetVersion}`);
  }
  const expectedByName = new Map(baseline.scenarios.map((item) => [item.name, item]));
  if (!args.scenario && expectedByName.size !== scenarios.length) {
    throw new Error(`场景数量与基线不符：基线 ${expectedByName.size}，当前 ${scenarios.length}`);
  }
  const startedAt = performance.now();
  const failures = [];
  for (const scenario of scenarios) {
    const expected = expectedByName.get(scenario.name);
    if (!expected) {
      failures.push(`${scenario.name}：基线中没有该场景`);
      continue;
    }
    const difference = compareScenario(expected, runScenario(scenario));
    if (difference) failures.push(`${scenario.name}：${difference}`);
  }
  const elapsedSeconds = ((performance.now() - startedAt) / 1000).toFixed(1);
  if (failures.length > 0) {
    console.error(`黄金轨迹比对失败（${failures.length}/${scenarios.length} 个场景，${elapsedSeconds} 秒）：`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`黄金轨迹比对通过：${scenarios.length} 个场景与基线 ${baseline.environment.gitSha.slice(0, 7)} 逐帧一致`
    + `（${elapsedSeconds} 秒）。`);
}
