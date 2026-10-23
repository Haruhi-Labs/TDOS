import assert from "node:assert/strict";
import { createPolicyProgram, POLICY_PROGRAM_EFFECTS } from "../shared/game/ai/policy/policy-program.js";
import { resolveAiParams } from "../shared/game/ai/params/index.js";
import { freezePlainData } from "../shared/data/plain-data.js";

const calls = [];
const ship = freezePlainData({ id: 1, key: "main", alive: true, attached: false, throttle: 1.4,
  effects: {}, stats: { energyRegen: 1, moveDrain: 2 }, fleet: { memberIds: [1], energy: 0, maxEnergy: 100 } });
const obs = freezePlainData({ time: 10, self: { ships: { main: ship } }, world: { size: 1440 } });
const params = resolveAiParams();
const program = createPolicyProgram((key) => {
  if (key === 'obs') return obs;
  if (key === 'params') return params;
  if (key === 'port') return Object.freeze({ submit: (action) => { calls.push(action); return true; } });
  throw new Error(`本场景不应读取 ${key}`);
}, (key, args) => {
  if (key === 'ownShipById') return args[0] === ship.id ? ship : null;
  if (key === 'ownShips') return Object.freeze([ship]);
  throw new Error(`本场景不应调用 ${key}`);
});
const first = program.run('energyProfile', ship);
for (let i = 0; i < 3; i++) {
  assert.deepEqual(program.run('energyProfile', ship), first);
  assert.equal(program.run('energyThrottleGearCap', ship), 1);
}
assert.equal(calls.length, 0, '嵌套能量求值不提交动作、不消费随机或策略调度');
const order = program.run('planEnergyThrottleCap', ship);
assert.equal(calls.length, 0, '能量规划返回意图，不能下发动作');
program.run('writeThrottle', order.shipKey, order.throttle);
assert.equal(calls.length, 1, '执行阶段才通过专用命令能力换挡');
assert.equal(calls[0].shipKey, 'main');
assert.equal(obs.self.ships.main.throttle, 1.4, '动作不能直接修改观测');
assert.throws(() => program.run('chooseMode'), /未声明/);
assert.throws(() => program.run('advanceSearchCenter'), /未声明/);
assert.throws(() => program.run('toString'), /未声明/);
assert.throws(() => POLICY_PROGRAM_EFFECTS.executeMovement.push('port'), TypeError);
assert.equal(POLICY_PROGRAM_EFFECTS.executeSplit, undefined);
assert.equal(POLICY_PROGRAM_EFFECTS.planEnergyThrottleCap, undefined);
assert.deepEqual(POLICY_PROGRAM_EFFECTS.executeOrbSteering, ['issueShipRoute']);
assert.ok(!POLICY_PROGRAM_EFFECTS.executeMovement.includes('chooseMode'));
assert.ok(!POLICY_PROGRAM_EFFECTS.executeMovement.includes('advanceSearchCenter'));
console.log('AI 启发式能力校验通过：嵌套查询无执行能力，执行阶段按声明提交，调度由策略所有者编排。');
