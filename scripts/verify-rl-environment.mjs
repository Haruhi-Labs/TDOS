import assert from "node:assert/strict";
import {
  RlBatchEnvironment,
  RlMatchEnvironment,
  RL_ENVIRONMENT_SCHEMA_VERSION,
  RL_OUTCOME_REWARDS,
  sampleUniversalLoadout,
} from "../shared/training/environment.js";
import { createSeededRandom } from "../shared/game/random.js";

function noOp() {
  return { A: {}, B: {} };
}

function deterministicBatchCheck() {
  const options = {
    count: 4,
    baseSeed: 12001,
    decisionTicks: 3,
    maxEpisodeSeconds: 30,
  };
  const first = new RlBatchEnvironment(options);
  const second = new RlBatchEnvironment(options);
  assert.deepEqual(first.reset(), second.reset(), "同配置批环境首次 reset 不一致");
  for (let step = 0; step < 25; step += 1) {
    const actions = Array.from({ length: 4 }, noOp);
    assert.deepEqual(first.step(actions), second.step(actions), `批环境第 ${step + 1} 步不一致`);
  }

  const third = new RlBatchEnvironment({ ...options, baseSeed: 12002 });
  const firstReset = new RlBatchEnvironment(options).reset();
  const thirdReset = third.reset();
  assert.notDeepEqual(firstReset.map((item) => item.info.loadouts), thirdReset.map((item) => item.info.loadouts), "不同批种子没有产生不同局面");
}

function universalLoadoutCheck() {
  const random = createSeededRandom(15551);
  const seenMain = new Set();
  for (let index = 0; index < 400; index += 1) {
    const loadout = sampleUniversalLoadout(random);
    assert.equal(new Set(Object.values(loadout)).size, 3, "同一舰队抽到了重复角色");
    seenMain.add(loadout.main);
  }
  assert(seenMain.has("shamisen"), "通用训练分布仍沿用了现有 AI 的主舰排除偏好");
  assert(seenMain.has("tsuruya"), "通用训练分布没有覆盖全部旗舰角色");
}

function authorityActionCheck() {
  const environment = new RlMatchEnvironment({ baseSeed: 16661, decisionTicks: 3 });
  const reset = environment.reset({
    teamLoadouts: {
      A: { main: "haruhi", sub1: "future1096", sub2: "koizumi" },
      B: { main: "yuki", sub1: "kyon", sub2: "asakura" },
    },
  });
  assert.equal(reset.schemaVersion, RL_ENVIRONMENT_SCHEMA_VERSION);
  const result = environment.step({
    A: {
      ships: [{
        navigation: "route",
        end: { x: 0.2, y: -0.4 },
        control: { x: -0.4, y: 0.1 },
        gear: 4,
      }],
      split: 1,
    },
    B: {},
  });
  assert.equal(result.reward.A, 0, "非终局出现了奖励塑形");
  assert.equal(result.reward.B, 0, "非终局出现了奖励塑形");
  assert.equal(result.info.acceptedActions.A.length, 2, "组合动作没有全部进入权威入口");
  assert(result.info.acceptedActions.A.every((item) => item.accepted), "合法组合动作被权威规则拒绝");
  assert.equal(environment.simulation.teamA.splitLevel, 1, "环境动作没有改变权威分离状态");
  assert.equal(result.info.simulatedTicks, 3, "每次决策推进的逻辑 tick 数错误");
}

function terminalRewardCheck() {
  const environment = new RlMatchEnvironment({ baseSeed: 17771, decisionTicks: 3 });
  environment.reset();
  for (const ship of environment.simulation.teamB.getAllShips()) {
    ship.alive = false;
    ship.hp = 0;
  }
  const result = environment.step(noOp());
  assert.equal(result.terminated, true, "舰队覆灭后环境没有终止");
  assert.equal(result.truncated, false, "正常终局被错误标为截断");
  assert.deepEqual(result.reward, { A: RL_OUTCOME_REWARDS.win, B: RL_OUTCOME_REWARDS.loss }, "胜负奖励错误");
  assert.throws(() => environment.step(noOp()), /必须 reset/, "终局后仍可继续推进环境");
}

function timeoutRewardCheck() {
  const environment = new RlMatchEnvironment({
    baseSeed: 18881,
    decisionTicks: 3,
    maxEpisodeSeconds: 0.1,
  });
  environment.reset();
  const result = environment.step(noOp());
  assert.equal(result.terminated, false, "超时被错误标为自然终局");
  assert.equal(result.truncated, true, "训练时限没有截断环境");
  assert.deepEqual(
    result.reward,
    { A: RL_OUTCOME_REWARDS.timeout, B: RL_OUTCOME_REWARDS.timeout },
    "超时轻微负奖励错误",
  );
}

deterministicBatchCheck();
universalLoadoutCheck();
authorityActionCheck();
terminalRewardCheck();
timeoutRewardCheck();
console.log("批量强化学习环境校验通过：确定性、通用阵容、权威动作和纯终局奖励均正常。");
