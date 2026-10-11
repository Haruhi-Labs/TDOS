import assert from "node:assert/strict";
import { CHARACTER_ORDER, MatchSimulation, TICK_DT } from "../../shared/game-core.js";
import { createActionPort } from "../../shared/game/ai/bridge/action-port.js";
import { resolveAiParams } from "../../shared/game/ai/params/index.js";
import { characterProfile } from "../../shared/game/ai/policy/characters/index.js";
import { characterDecisionFacts, characterDecisionInput } from "../../shared/game/ai/policy/characters/decision-view.js";
import { RulePolicy } from "../../shared/game/ai/policy/rule-policy.js";
import { createSeededRng } from "../../shared/game/rng.js";

const params = resolveAiParams();

function profileRegistryCheck() {
  for (const characterId of CHARACTER_ORDER) {
    assert.equal(characterProfile(characterId).id, characterId, `${characterId} 缺少 AI 档案`);
  }
  assert.equal(characterProfile("unknown").id, null, "未知角色应得到空档案");
  assert.equal(characterProfile("unknown").sub, undefined);
  assert.equal(characterProfile("asakura").detachedDefaultRole, "flank");
  assert.equal(characterProfile("koizumi").splitsEarlyAgainstBarrier, true);
  assert.equal(characterProfile("yuki").splitBias(params.split.utility), params.split.utility.yukiBias);
  assert.equal(characterProfile("kyon").splitBias, undefined, "没有专属偏置的角色使用通用偏置");
}

// 档案里的判断只依赖传入的纯数据，不需要启动对局。
function profileDecisionCheck() {
  const observation = { self: { cooldowns: { flagship: 3 } } };
  const facts = characterDecisionFacts({ obs: observation, mode: "press", port: { submit() {} }, timers: { main: 0 } });
  assert.equal("port" in facts, false, "角色档案不得得到动作执行能力");
  assert.equal("timers" in facts, false, "角色档案不得得到策略状态");
  assert.throws(() => { facts.obs.self.cooldowns.flagship = 0; }, TypeError);
  observation.self.cooldowns.flagship = 9;
  assert.equal(facts.obs.self.cooldowns.flagship, 3, "决策事实必须脱离来源状态");
  const context = { focus: { x: 1 }, candidates: [{ id: "a" }] };
  const input = characterDecisionInput({ context, dist: Infinity });
  context.focus.x = 2;
  assert.equal(input.context.focus.x, 1);
  assert.equal(input.dist, Infinity, "不能用 JSON 往返改变无穷距离语义");
  assert.throws(() => input.context.candidates.push({}), TypeError);
  assert.throws(() => { characterProfile("future1096").sub.target = () => null; }, TypeError);

  const K = params.skills.sub;
  const kyon = characterProfile("kyon").sub;
  const ship = { hp: 100, maxHp: 100, stats: { range: 400 } };
  assert.equal(kyon.shouldCast(null, { K, ship, estimate: { x: 0, y: 0 }, dist: 400 * K.kyonRange + 1 }), false);
  assert.equal(kyon.shouldCast(null, { K, ship, estimate: { x: 0, y: 0 }, dist: 400 * K.kyonRange - 1 }), true);
  assert.equal(kyon.shouldCast(null, { K, ship: { ...ship, hp: 100 * K.kyonHull - 1 }, estimate: null, dist: Infinity }), true);

  const future1096 = characterProfile("future1096").sub;
  const policy = {
    skillAimLead: params.features.skillAimLead,
    obs: { world: { size: 1440 } },
    aimPadding: 100,
  };
  const T = params.skills.subTimers;
  assert.equal(future1096.target(policy, { T, estimate: { source: "spawn", visible: false, age: 0 } }), null, "出生点情报不带目标施放");
  const moving = { source: "visible", visible: true, age: 0, x: 700, y: 700, angle: 0, speed: 40, confidence: 1 };
  assert.deepEqual(future1096.target(policy, { T, estimate: moving }), { targetX: 700 + 40 * T.future1096AimLead, targetY: 700 });
  const noLead = { ...policy, skillAimLead: resolveAiParams({ preset: "legacy" }).features.skillAimLead };
  assert.deepEqual(future1096.target(noLead, { T, estimate: moving }), { targetX: 700, targetY: 700 }, "legacy 预设不做预判");
  assert.equal(future1096.shouldCast(policy, { K, estimate: moving, context: { skillAggression: 1 }, blockedByBarrier: true }), false);

  assert.deepEqual(
    characterProfile("tsuruya").sub.target({ searchZoneId: 7 }, { estimate: null }),
    { zoneId: 7 },
  );
  assert.equal(characterProfile("haruhi").flagship.shouldCast, undefined, "春日旗舰通过通用前置条件即施放");
  assert.equal(typeof characterProfile("bunny_haruhi").sub.decideAlone, "function");
}

// 规则策略只需要端口、随机流和参数即可运行，不依赖对外门面，也不持有对局或舰队对象。
function standalonePolicyCheck() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    seed: 77,
    teamLoadouts: {
      A: { main: "kyon", sub1: "asakura", sub2: "yuki" },
      B: { main: "tsuruya", sub1: "koizumi", sub2: "future1096" },
    },
  });
  assert.deepEqual(Object.keys(sim.bots), [], "本场景不启用内置 AI");
  const port = createActionPort(sim, "B");
  const policy = new RulePolicy(port, { rng: createSeededRng(5), params: { difficulty: "hard" } });
  for (const key of ["team", "match", "enemy"]) {
    assert.equal(key in policy, false, `策略不得持有 ${key}`);
  }
  for (let tick = 0; tick < 600; tick += 1) {
    port.invalidate();
    policy.update(TICK_DT, sim.elapsed);
    sim.update(TICK_DT);
  }
  assert.ok(sim.teamB.ships.main.route, "独立运行的策略应当下发航线");
  assert.ok(sim.teamB.splitLevel > 0, "独立运行的策略应当完成分离");
  assert.equal(policy.params.difficulty.reactionMult, 2.2);
  const debug = policy.serializeDebugState();
  assert.equal(debug.seat, "B");
  assert.deepEqual(JSON.parse(JSON.stringify(debug)), debug, "调试状态必须是纯数据");
}

export function runAiPolicySuite() {
  profileRegistryCheck();
  profileDecisionCheck();
  standalonePolicyCheck();
}
