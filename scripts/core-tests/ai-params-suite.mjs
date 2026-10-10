import assert from "node:assert/strict";
import { MatchSimulation, TICK_DT } from "../../shared/game-core.js";
import {
  AI_HANDICAPS,
  DEFAULT_AI_PARAMS,
  aiHandicapFor,
  resolveAiParams,
} from "../../shared/game/ai/params/index.js";

function resolutionCheck() {
  const master = resolveAiParams();
  assert.deepEqual(JSON.parse(JSON.stringify(master)), master, "AI 参数必须是可 JSON 往返的纯数据");
  assert.deepEqual(master, DEFAULT_AI_PARAMS, "极限难度、无预设时的参数必须等于默认参数");
  assert.ok(Object.isFrozen(master) && Object.isFrozen(master.mode.scores.press) && Object.isFrozen(master.profile),
    "解析结果必须深冻结");
  assert.throws(() => { master.profile.moveReplanMin = 9; }, TypeError);

  const expected = {
    easy: { reactionMult: 9, replanMult: 2.4, advancedCounterplay: false, statMult: 0.8, focusLowHp: false },
    normal: { reactionMult: 4.5, replanMult: 1.7, advancedCounterplay: false, statMult: 1, focusLowHp: false },
    hard: { reactionMult: 2.2, replanMult: 1.25, advancedCounterplay: true, statMult: 1.2, focusLowHp: false },
    master: { reactionMult: 1, replanMult: 1, advancedCounterplay: true, statMult: 1.2, focusLowHp: true },
  };
  for (const [difficulty, values] of Object.entries(expected)) {
    const params = resolveAiParams({ difficulty });
    assert.equal(params.difficulty.reactionMult, values.reactionMult);
    assert.equal(params.difficulty.replanMult, values.replanMult);
    assert.equal(params.features.advancedCounterplay, values.advancedCounterplay);
    assert.deepEqual(AI_HANDICAPS[difficulty], { statMult: values.statMult, focusLowHp: values.focusLowHp });
  }
  assert.deepEqual(resolveAiParams({ difficulty: "unknown" }), master, "未知难度按极限处理");
  assert.equal(aiHandicapFor("unknown"), AI_HANDICAPS.master);

  const legacy = resolveAiParams({ difficulty: "master", preset: "legacy" });
  for (const key of ["characterPriority", "closeout", "barrierTactics", "skillAimLead", "advancedCounterplay", "visionEngage", "formationLeash"]) {
    assert.equal(legacy.features[key], false, `legacy 预设必须关闭 ${key}`);
  }
  assert.equal(legacy.features.indirectIntel, true);

  // 合并顺序：默认 ← 难度 ← 预设 ← 覆盖。
  const overridden = resolveAiParams({
    difficulty: "easy",
    preset: "legacy",
    overrides: { features: { closeout: true }, difficulty: { replanMult: 3 }, mode: { choose: { lowHullHold: [2, 4] } } },
  });
  assert.equal(overridden.features.closeout, true);
  assert.equal(overridden.features.visionEngage, false);
  assert.equal(overridden.difficulty.reactionMult, 9);
  assert.equal(overridden.difficulty.replanMult, 3);
  assert.deepEqual(overridden.mode.choose.lowHullHold, [2, 4]);
  assert.deepEqual(DEFAULT_AI_PARAMS.mode.choose.lowHullHold, [1.6, 2.8], "覆盖不得改动默认参数");

  assert.throws(() => resolveAiParams({ overrides: { mode: { scores: { press: { bsae: 1 } } } } }), /未知的 AI 参数：mode\.scores\.press\.bsae/);
  assert.throws(() => resolveAiParams({ overrides: { profile: { stuckTrigger: "0.9" } } }), TypeError);
  assert.throws(() => resolveAiParams({ overrides: { profile: { stuckTrigger: Number.NaN } } }), TypeError);
  assert.throws(() => resolveAiParams({ overrides: { mode: { choose: { lowHullHold: [1] } } } }), TypeError);
  assert.throws(() => resolveAiParams({ overrides: { profile: 3 } }), TypeError);
  assert.throws(() => resolveAiParams({ preset: "missing" }), RangeError);
}

const LOADOUTS = {
  A: { main: "kyon", sub1: "asakura", sub2: "yuki" },
  B: { main: "tsuruya", sub1: "koizumi", sub2: "future1096" },
};

function createMatch(options = {}) {
  return new MatchSimulation({ mode: "pvp", worldSize: 1440, aiSeats: ["A", "B"], teamLoadouts: LOADOUTS, ...options });
}

function wiringCheck() {
  const solo = new MatchSimulation({ mode: "ai", worldSize: 1440, aiDifficulty: "easy" });
  assert.equal(solo.bot.difficulty, "easy");
  assert.equal(solo.bot.params.difficulty.reactionMult, 9);
  // 让分由对局写入 AI 所控舰队，玩家舰队不受影响。
  assert.equal(solo.teamB.statMult, 0.8);
  assert.equal(solo.teamB.aiFocusLowHp, false);
  assert.equal(solo.teamA.statMult || 1, 1);
  assert.equal(new MatchSimulation({ mode: "ai", worldSize: 1440 }).teamB.aiFocusLowHp, true);

  const sim = createMatch({
    legacyAiSeats: ["B"],
    aiParams: { A: { overrides: { profile: { stuckTrigger: 1.5 } } }, B: { overrides: { profile: { stuckTrigger: 2 } } } },
  });
  assert.equal(sim.bots.A.params.profile.stuckTrigger, 1.5);
  assert.equal(sim.bots.A.legacy, false);
  assert.equal(sim.bots.B.legacy, true);
  assert.equal(sim.bots.B.params.profile.stuckTrigger, 2);
  assert.equal(sim.bots.B.params.features.visionEngage, false);
  assert.throws(() => createMatch({ aiParams: { A: { overrides: { nope: 1 } } } }), RangeError);

  const bot = sim.bots.A;
  bot.noIndirectIntel = true;
  assert.equal(bot.params.features.indirectIntel, false);
  assert.equal(bot.params.profile.stuckTrigger, 1.5, "切换对照开关不得丢失已有覆盖");
  bot.legacy = true;
  assert.equal(bot.params.features.closeout, false);
  bot.setDifficulty("normal");
  assert.equal(bot.params.difficulty.replanMult, 1.7);
  assert.equal(bot.legacy, true);
  assert.equal(sim.teamA.statMult, 1.2, "切换决策难度不得改动对局让分");
}

function digest(simulation) {
  const values = [];
  for (const team of [simulation.teamA, simulation.teamB]) {
    values.push(team.splitLevel, team.scouts.length, team.cooldowns.flagship, team.cooldowns.sub1, team.cooldowns.sub2);
    for (const ship of team.getAllShips()) values.push(ship.x, ship.y, ship.hp, ship.energy, ship.throttle);
  }
  return values.join(",");
}

function run(overrides, ticks) {
  const simulation = createMatch({ seed: 20261004, aiParams: overrides ? { A: { overrides }, B: { overrides } } : undefined });
  for (let tick = 0; tick < ticks && simulation.phase === "running"; tick += 1) simulation.update(TICK_DT);
  return digest(simulation);
}

// 每个参数分节各取一项改写，对局结果必须随之改变，证明决策读取的是参数表而不是残留的内联数值。
function effectCheck() {
  const ticks = 1500;
  const baseline = run(null, ticks);
  assert.equal(run(null, ticks), baseline, "相同种子与参数必须得到相同结果");
  assert.equal(run({}, ticks), baseline, "空覆盖不得改变行为");
  const cases = {
    "profile.moveReplan": { profile: { moveReplanMin: 5, moveReplanMax: 6 } },
    "difficulty.reactionMult": { difficulty: { reactionMult: 12 } },
    "features.visionEngage": { features: { visionEngage: false } },
    "perception.shipDelay": { perception: { shipDelay: 3 } },
    "focus.typeMain": { focus: { typeMain: -50 } },
    "mode.scores.press.base": { mode: { scores: { press: { base: -50 } } } },
    "mode.choose.recoverEdgePressure": { mode: { choose: { recoverEdgePressure: -1 } } },
    "context.advantageBias": { context: { advantageBias: 50 } },
    "split.level1.weakFleetHull": { split: { level1: { weakFleetHull: 2 } } },
    "energy.gear.overdriveStartRatio": { energy: { gear: { overdriveStartRatio: 2, overdriveStopRatio: 2 } } },
    "energy.commit.conserveAbove": { energy: { commit: { conserveAbove: -1 } } },
    "scout.timers.launched": { scout: { timers: { launched: [40, 41], launchedUrgent: [40, 41], launchedTrackable: [40, 41] } } },
    "skills.subTimers.hold": { skills: { subTimers: { hold: [30, 31], aggressiveHold: [30, 31], conserveHold: [30, 31] } } },
    "skills.sub.kyonRange": { skills: { sub: { koizumiRange: 0, asakuraRange: 0, future1096Age: -1 } } },
    "value.rangeRef": { value: { rangeRef: 50 } },
    "intel.projection.memoryUncertaintyGrowth": { intel: { projection: { memoryUncertaintyGrowth: 400, memoryUncertaintyMax: 900 } } },
    "detached.intelLead.minScore": { detached: { intelLead: { minScore: -100 } } },
    "detached.retreat.hpWeight": { detached: { retreat: { hpCeiling: 5, hpWeight: 10 } } },
  };
  for (const [name, overrides] of Object.entries(cases)) {
    assert.notEqual(run(overrides, ticks), baseline, `改写 ${name} 后对局结果没有变化`);
  }
}

export function runAiParamsSuite() {
  resolutionCheck();
  wiringCheck();
  effectCheck();
}
