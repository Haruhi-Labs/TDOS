import assert from "node:assert/strict";
import { RlBenchmarkBatchEnvironment } from "../shared/training/evaluation.js";

const batch = new RlBenchmarkBatchEnvironment({
  count: 2,
  decisionTicks: 3,
  maxEpisodeSeconds: 0.2,
});
const reset = batch.reset([
  { seed: 771, learnerSeat: "A" },
  { seed: 772, learnerSeat: "B" },
]);
assert.equal(reset[0].info.learnerSeat, "A");
assert.equal(reset[0].info.botSeat, "B");
assert.equal(reset[1].info.learnerSeat, "B");
assert.equal(reset[1].info.botSeat, "A");
assert(reset[0].seat.observation.self.entities.length >= 3, "学习方没有获得自己的公平观察");
assert.equal(reset[0].seat.observation.opponent.visibleEntities.length, 0, "评测初始观察泄露了 master AI 真值");

let results = reset;
for (let step = 0; step < 4 && results.some((item) => !item.terminated && !item.truncated); step += 1) {
  results = batch.step([{}, {}]);
}
assert(results.every((item) => item.terminated || item.truncated), "短时限评测没有结束");
assert(results.every((item) => item.reward === -0.02), "评测超时奖励没有沿用纯终局契约");
console.log("强化学习 master AI 评测环境校验通过：换边、公平观察与终局奖励均正常。");
