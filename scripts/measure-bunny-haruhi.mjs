// 离线验收：只在内存模拟和 bench 输出，不连接游戏、身份或统计服务。
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir, cpus } from "node:os";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { withSeededRandom } from "./core-tests/helpers.mjs";
import { BUNNY_HARUHI_CONFIG as C } from "../shared/game/bunny-haruhi-config.js";
import { DAMAGE_KIND } from "../shared/game/damage.js";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "bench/bunny-haruhi-acceptance");
const quantile = (values, p) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)];
const fixed = (number) => Math.round(number * 10000) / 10000;
const loadout = (main = "kyon", sub1 = "bunny_haruhi", sub2 = "yuki") => ({ main, sub1, sub2 });
const oldLoadout = (value) => {
  const old = { ...value };
  for (const key of Object.keys(old)) if (old[key] === C.characterId) {
    old[key] = ["haruhi", "koizumi", "future1096"].find((id) => !Object.values(old).includes(id));
  }
  return old;
};

async function measureWorker(moduleRoot, worst) {
  const core = await import(pathToFileURL(join(moduleRoot, "shared/game-core.js")));
  return withSeededRandom(20261003, () => {
    core.__resetEntityIds(1);
    const roster = worst ? loadout("haruhi", C.characterId, "asakura") : loadout("haruhi", "koizumi", "asakura");
    const sim = new core.MatchSimulation({ mode: "pvp", aiSeats: ["A", "B"], teamLoadouts: { A: roster, B: roster } });
    if (worst) for (const team of [sim.teamA, sim.teamB]) {
      team.splitLevel = 2;
      // 压力夹具从双方已解锁全部支援与伴随舰开始，不改变实战的施放规则。
      for (let i = 0; i < 4; i++) {
        team.cooldowns.sub1 = 0;
        assert.equal(team.castSubSkill("sub1"), true);
      }
      for (const id of ["alien", "time_traveler", "otherworlder", "esper"]) team.haruhiFlagship.supporters.add(id);
      team.haruhiFlagship.alienNextAt = 1;
      team.haruhiFlagship.timeTravelerNextAt = 1;
    }
    const samples = [];
    let maxBytes = 0;
    for (let i = 0; i < 1800 && !sim.winnerSeat; i++) {
      const start = performance.now();
      sim.update(core.TICK_DT);
      if (i >= 300) samples.push(performance.now() - start);
      if (i % 30 === 0) maxBytes = Math.max(maxBytes, Buffer.byteLength(JSON.stringify(sim.serializeState())));
    }
    assert.ok(samples.length >= 300, "性能场景必须包含足够的实际战斗 tick");
    return { ticks: samples.length, medianMs: quantile(samples, 0.5), p95Ms: quantile(samples, 0.95), maxMs: Math.max(...samples), maxSnapshotBytes: maxBytes,
      digest: createHash("sha256").update(JSON.stringify(sim.serializeState())).digest("hex") };
  });
}

if (process.argv[2] === "--worker") {
  console.log(JSON.stringify(await measureWorker(process.argv[3], process.argv[4] === "worst")));
} else {
  mkdirSync(output, { recursive: true });
  const flags = new Set(process.argv.slice(2));
  if (!flags.size || flags.has("--performance")) {
    const baseline = "3d7f6a1";
    const temp = mkdtempSync(join(tmpdir(), "tdos-bunny-performance-"));
    try {
      const archive = join(temp, "baseline.tar");
      execFileSync("git", ["archive", baseline, "shared", "package.json", "-o", archive], { cwd: root });
      execFileSync("tar", ["-xf", archive, "-C", temp]);
      const runs = { before: [], after: [], worst: [] };
      for (let repeat = 0; repeat < 5; repeat++) {
        for (const kind of repeat % 2 ? ["after", "before", "worst"] : ["before", "after", "worst"]) {
          const result = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), "--worker", kind === "before" ? temp : root, kind], { cwd: root, encoding: "utf8" }));
          runs[kind].push(result);
        }
        console.log(`性能测量完成 ${repeat + 1}/5`);
      }
      assert.deepEqual(runs.before.map((x) => x.digest), runs.after.map((x) => x.digest), "旧场景最终权威快照必须逐字节一致");
      const summary = Object.fromEntries(Object.entries(runs).map(([key, values]) => [key, {
        medianMs: quantile(values.map((v) => v.medianMs), 0.5), p95Ms: quantile(values.map((v) => v.p95Ms), 0.5),
        maxMs: Math.max(...values.map((v) => v.maxMs)), maxSnapshotBytes: values[0].maxSnapshotBytes,
      }]));
      const regression = Object.fromEntries(["medianMs", "p95Ms"].map((key) => [key, (summary.after[key] / summary.before[key] - 1) * 100]));
      const result = { baseline, node: process.version, cpu: cpus()[0]?.model, runs, summary, regression,
        snapshotIncrementBytes: summary.worst.maxSnapshotBytes - summary.after.maxSnapshotBytes,
        oldWithinSuggestedFivePercent: Object.values(regression).every((v) => v <= 5),
        worstWithinTickBudget: summary.worst.maxMs <= 1000 / 30,
        note: "独立进程交替顺序重复五轮；p95为各轮p95的中位数。最慢tick包含GC/系统调度，不隐去离群值。压力夹具双方各四旧支援、三新支援与一个阿虚；字节增量包含实体及实际弹幕差异。" };
      writeFileSync(join(output, "performance.json"), JSON.stringify(result, null, 2));
      console.log(JSON.stringify({ performance: summary, regression, withinBudget: result.worstWithinTickBudget }));
    } finally {
      assert.equal(dirname(temp), resolve(tmpdir()));
      rmSync(temp, { recursive: true, force: true });
    }
  }
  if (!flags.size || flags.has("--balance")) {
    const core = await import("../shared/game-core.js");
    const scenarios = [
      { id: "hold-bless", label: "停留bless", policy: "bless" },
      { id: "cycle", label: "按CD循环", policy: "cycle" },
      { id: "hold-encore", label: "冲encore后停留", policy: "encore" },
      { id: "low-hp", label: "低血防御切换", policy: "defense" },
      { id: "stage-edge", label: "舞台边缘反复进出", stage: true, route: "edge" },
      { id: "stage-kite", label: "远程绕舞台", stage: true, route: "kite" },
      { id: "future1096", label: "1096组合", main: "future1096" },
      { id: "haruhi", label: "普通春日组合", main: "haruhi" },
      { id: "tsuruya", label: "鹤屋组合", main: "tsuruya" },
      { id: "purge", label: "朝仓涤除", opponent: loadout("asakura", "tsuruya", "future1096") },
      { id: "conversion", label: "鹤屋策反", opponent: loadout("kyon", "tsuruya", "asakura"), policy: "encore" },
      { id: "encore-ready", label: "已到激奏的条件场景", policy: "encore", prepared: true },
      { id: "conversion-ready", label: "阿虚策反的条件场景", policy: "encore", prepared: true, bribe: true },
    ];
    const only = process.argv.find((arg) => arg.startsWith("--scenarios="))?.slice("--scenarios=".length).split(",");
    const selected = only ? scenarios.filter((scenario) => only.includes(scenario.id)) : scenarios;
    const results = [];
    for (const scenario of selected) {
      for (const seed of [410, 7919, 20261]) for (const seat of ["A", "B"]) for (const variant of ["new", "old"]) {
        const result = withSeededRandom(seed, () => {
          core.__resetEntityIds(1);
          const candidate = scenario.stage ? loadout(C.characterId, "kyon", "yuki") : loadout(scenario.main);
          const roster = variant === "new" ? candidate : oldLoadout(candidate);
          const enemySeat = seat === "A" ? "B" : "A";
          const opponent = scenario.opponent || loadout("kyon", "tsuruya", "asakura");
          const sim = new core.MatchSimulation({ mode: "pvp", aiSeats: ["A", "B"], aiDifficulty: "master", teamLoadouts: { [seat]: roster, [enemySeat]: opponent } });
          const own = seat === "A" ? sim.teamA : sim.teamB;
          const bot = sim.bots[seat];
          let opening = null;
          if (scenario.prepared) {
            const originals = [];
            // 对局经 aiRunners 驱动 AI；准备期用对局自带的开关暂停双方 AI。
            for (const aiSeat of ["A", "B"]) sim.setAiEnabled(aiSeat, false);
            for (const team of [sim.teamA, sim.teamB]) {
              sim.combatEnabled[team.seat] = false;
              team.splitLevel = 2;
              for (const unit of team.getAllShips()) {
                originals.push([unit, unit.takeDamage]);
                unit.takeDamage = () => {};
                unit.throttle = unit.speed = 0;
              }
            }
            let casts = 0;
            // 明示条件开局：停战期间正常支付资源、等待真实CD，先完成四次领域施放。
            while (casts < 4 && sim.elapsed < 150) {
              if (own.cooldowns.sub1 <= 0 && own.castSubSkill("sub1")) casts++;
              if (casts < 4) sim.update(core.TICK_DT);
            }
            assert.equal(casts, 4);
            for (const [unit, method] of originals) unit.takeDamage = method;
            for (const aiSeat of ["A", "B"]) sim.setAiEnabled(aiSeat, true);
            for (const team of [sim.teamA, sim.teamB]) {
              sim.combatEnabled[team.seat] = true;
              if (scenario.bribe) team.getAllShips().forEach((unit, index) => {
                unit.x = team === own ? 650 : 780;
                unit.y = 620 + index * 30;
                unit.command = { x: unit.x, y: unit.y };
              });
            }
            opening = { preparationSeconds: sim.elapsed, hp: own.ships.sub1.hp, energy: own.ships.sub1.energy,
              form: own.ships.sub1.bunnyHaruhi?.form || null, note: "准备期双方停战且不承受外部伤害；资源支付与CD不跳过。正式统计从这里开始；策反场景双方位于中央战区。" };
          }
          const originalCast = bot.shouldCastSubSkill.bind(bot);
          let policyDecisions = 0;
          if (scenario.policy && variant === "new") bot.shouldCastSubSkill = (ship, estimate, context) => {
            // AI 传入的是观测数据；场景策略需要的成功施放次数只在权威状态里，按舰位取回实时舰船。
            const state = own.ships[ship.key]?.bunnyHaruhi;
            if (!state) return originalCast(ship, estimate, context);
            policyDecisions++;
            if (scenario.policy === "bless") return state.successfulCasts === 0;
            if (scenario.policy === "encore") return state.successfulCasts < 4;
            if (scenario.policy === "defense") return state.form === "bless" ? ship.hp / ship.maxHp < 0.48 : originalCast(ship, estimate, context);
            return true;
          };
          if (scenario.route) {
            const enemyBot = sim.bots[enemySeat];
            const issue = enemyBot.issueShipRoute.bind(enemyBot);
            enemyBot.issueShipRoute = (ship, x, y, throttle, padding) => {
              const contact = enemyBot.currentContext?.focus;
              if (contact && contact.source !== "spawn" && (contact.visible || contact.age <= 3)) {
                const angle = Math.atan2(ship.y - contact.y, ship.x - contact.x) + (scenario.route === "kite" ? 0.4 : 0);
                const radius = scenario.route === "kite" ? C.baseStats.vision + 80 : C.baseStats.vision + (Math.floor(sim.elapsed / 4) % 2 ? 60 : -50);
                x = contact.x + Math.cos(angle) * radius;
                y = contact.y + Math.sin(angle) * radius;
              }
              return issue(ship, x, y, throttle, padding);
            };
          }
          const metrics = { formSeconds: { neutral: 0, bless: 0, knows: 0, encore: 0 }, casts: 0, companionSeconds: 0, conversions: 0, entrances: 0,
            firstStageHeal: 0, stageHeal: 0, companionHeal: 0, encoreHeal: 0, otherHeal: 0, transformCost: 0, selfDrain: 0,
            supportBeamDamage: 0, supportImpactDamage: 0, companionDamage: { A: 0, B: 0 }, beamLaunches: 0, flagshipCasts: { A: 0, B: 0 } };
          // 仅离线收集器拦截实际HP写入，计实际到账量（含满血截断），不改规则/公开快照。
          const observed = new Set();
          const observe = (unit) => {
            if (observed.has(unit.id)) return;
            observed.add(unit.id);
            let hp = unit.hp;
            Object.defineProperty(unit, "hp", { enumerable: true, configurable: true, get: () => hp, set(value) {
              const delta = value - hp;
              hp = value;
              if (!delta) return;
              const stack = new Error().stack;
              if (delta > 0) {
                const key = stack.includes("resolveBunnyStages") ? "firstStageHeal" : stack.includes("advanceBunnyRules") ? "stageHeal"
                  : stack.includes("prepareBunnyCompanions") ? "companionHeal" : stack.includes("commitBunnyTransform") ? "encoreHeal" : "otherHeal";
                metrics[key] += delta;
              } else if (stack.includes("commitBunnyTransform")) metrics.transformCost -= delta;
              else if (stack.includes("advanceBunnyRules")) metrics.selfDrain -= delta;
            } });
          };
          for (const team of [sim.teamA, sim.teamB]) {
            const spawn = team.spawnBunnyCompanion.bind(team);
            team.spawnBunnyCompanion = (...args) => { const result = spawn(...args); team.extraShips.forEach(observe); return result; };
            const beam = team.launchHaruhiRandomBeam.bind(team);
            team.launchHaruhiRandomBeam = (...args) => { metrics.beamLaunches++; return beam(...args); };
            const cast = team.castFlagshipSkill.bind(team);
            team.castFlagshipSkill = (...args) => { const result = cast(...args); if (result) metrics.flagshipCasts[team.seat]++; return result; };
            team.getAllShips().forEach(observe);
          }
          const damage = sim.recordDamage.bind(sim);
          sim.recordDamage = (source, target, amount, kind) => {
            if (source?.bunnyCompanion) metrics.companionDamage[source.team.seat] += amount;
            if (["haruhi", C.characterId].includes(source?.characterId)) {
              if (kind === DAMAGE_KIND.SKILL) metrics.supportBeamDamage += amount;
              if (kind === DAMAGE_KIND.COLLISION) metrics.supportImpactDamage += amount;
            }
            return damage(source, target, amount, kind);
          };
          const priorStage = new Map(), priorConverted = new Map();
          const combatStartedAt = sim.elapsed;
          if (scenario.bribe) {
            const enemy = sim.teamBySeat(enemySeat);
            const target = own.extraShips[0] || own.ships.sub1;
            const zone = sim.zones.find((z) => target.x >= z.x && target.x <= z.x + z.width && target.y >= z.y && target.y <= z.y + z.height);
            const converted = sim.applyActionForSeat(enemySeat, { type: "cast_sub_skill", shipKey: "sub1", zoneId: zone.id });
            if (variant === "new") assert.equal(converted, true, "条件场景必须实际策反阿虚");
          }
          for (let tick = 0; tick < 5400 && !sim.winnerSeat; tick++) {
            sim.update(core.TICK_DT);
            for (const team of [sim.teamA, sim.teamB]) for (const unit of team.getAllShips()) {
              assert.ok([unit.x, unit.y, unit.hp, unit.energy].every(Number.isFinite));
              if (unit.bunnyHaruhi && unit.key !== "main") {
                if (unit.alive) metrics.formSeconds[unit.bunnyHaruhi.form] += core.TICK_DT;
                metrics.casts = unit.bunnyHaruhi.successfulCasts;
                assert.ok(unit.bunnyHaruhi.support.supporters.size <= 3);
              }
              const entranced = unit.bunnyStageExposure?.phase === "entranced";
              if (entranced && !priorStage.get(unit.id)) metrics.entrances++;
              priorStage.set(unit.id, entranced);
              if (unit.bunnyCompanion) {
                if (unit.alive) metrics.companionSeconds += core.TICK_DT;
                const converted = unit.team.seat !== unit.bunnyCompanion.ownerSeat;
                if (converted && !priorConverted.get(unit.id)) metrics.conversions++;
                priorConverted.set(unit.id, converted);
              }
            }
          }
          if (scenario.policy && variant === "new") {
            assert.ok(policyDecisions > 0, `${scenario.id} 的场景策略从未被 AI 调用`);
            if (scenario.policy === "bless") assert.ok(metrics.casts <= 1 && metrics.formSeconds.knows === 0, "停留bless的场景不得继续变身");
            if (scenario.policy === "encore") assert.ok(metrics.casts <= 4, "冲encore后停留的场景不得超过四次施放");
          }
          return { scenario: scenario.id, seed, seat, variant, roster, opponent, opening, winner: sim.winnerSeat, won: sim.winnerSeat === seat, timedOut: !sim.winnerSeat, duration: fixed(sim.elapsed - combatStartedAt), metrics, telemetry: sim.statisticsSummary().telemetry };
        });
        results.push(result);
      }
      console.log(`平衡场景完成：${scenario.label}`);
    }
    const summary = selected.map((scenario) => ({ id: scenario.id, label: scenario.label, ...Object.fromEntries(["new", "old"].map((variant) => {
      const rows = results.filter((r) => r.scenario === scenario.id && r.variant === variant);
      return [variant, { n: rows.length, wins: rows.filter((r) => r.won).length, timeouts: rows.filter((r) => r.timedOut).length,
        winRate: fixed(rows.filter((r) => r.won).length / rows.length), meanDuration: fixed(rows.reduce((n, r) => n + r.duration, 0) / rows.length) }];
    })) }));
    writeFileSync(join(output, only ? `balance-${only.join("_")}.json` : "balance.json"), JSON.stringify({ seeds: [410, 7919, 20261], limitSeconds: 180, summary, results,
      note: "每场景3种子×双方换边×新旧阵容；两个prepared条件开局与自然开局分开报告，不合并胜率。超时单列，不用剩余血量伪造胜负。形态秒数仅存活时累计；治疗/自损记录实际HP写入，支援伤害含双方春日来源，伴随舰伤害按当前阵营。无吸弹伤害折算。未出现的事件不能算覆盖。小样本不证明平衡。" }, null, 2));
    console.log(JSON.stringify(summary));
  }
}
