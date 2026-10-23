import assert from "node:assert/strict";
import { compileHooks, compileBattle, composeCapabilities, projectExtensions } from "../shared/game/characters/assembly/extension-contract.js";
import { CHARACTER_EXTENSIONS } from "../shared/game/characters/assembly/registry.js";
import { createTeamCharacters } from "../shared/game/characters/assembly/character-team.js";
import { createBattleCharacters } from "../shared/game/characters/assembly/character-battle.js";
import { MatchSimulation } from "../shared/game-core.js";
const calls = [];
const extra = {
  id: "验证角色",
  createTeam: () => ({ hooks: { afterMovement: [[5, () => calls.push("移动后")]] }, capabilities: { inspectOwn: () => 7 } }),
  createBattle: () => ({ operations: { custom: { phases: { afterHull: 5 }, run: () => calls.push("船体之后") } } }),
  projectShip: () => ({ customField: 7 }),
};
const team = createTeamCharacters({}, 0, [extra]);
assert.equal(team.inspectOwn(), 7);
team.afterMovement(1);
const battle = createBattleCharacters({}, [extra]);
battle.advance("afterHull", 1);
assert.deepEqual(calls, ["移动后", "船体之后"], "新增声明无需修改中央分派即可被消费");
assert.deepEqual(projectExtensions([extra], "projectShip", {}), { customField: 7 });
assert.throws(() => compileHooks([{ hooks: { illegal: [[1, () => {}]] } }], ["initialize"]), /未声明/);
assert.throws(() => compileHooks([{ hooks: { initialize: [[1, () => {}], [1, () => {}]] } }], ["initialize"]), /冲突/);
assert.throws(() => composeCapabilities([{ capabilities: { foo: 1 } }, { capabilities: { foo: 2 } }]), /重复/);
assert.throws(() => projectExtensions([extra, extra], "projectShip", {}), /重复/);
assert.throws(() => compileBattle([{ operations: { x: { phases: { unknown: 1 }, run() {} } } }]), /未声明/);
assert.throws(() => createTeamCharacters({}, 0, [{ createTeam: () => ({ capabilities: { afterMovement() {} } }) }]), /覆盖/);
assert.ok(Object.isFrozen(CHARACTER_EXTENSIONS));
for (const extension of CHARACTER_EXTENSIONS) assert.ok(Object.isFrozen(extension));
const sim = new MatchSimulation({ seed: 89 });
const actual = compileBattle(CHARACTER_EXTENSIONS.filter((x) => x.createBattle).map((x) => x.createBattle(sim))).schedule;
assert.deepEqual(actual, {
  beforeAi: ["sustain", "companions", "hunts"],
  afterTeams: ["heroPower", "barrierRam", "orbContacts", "impactWaves", "haruhiRam", "bunnyRam"],
  afterHull: ["bladeContacts"], beforeVisibility: ["stages", "purges", "sourceCleanup"],
  beforeBeams: ["radar"], afterVisuals: ["companionCleanup", "sourceCleanup", "stageVisibility"],
});
console.log("角色扩展契约通过：独立接入、冲突拒绝、冻结声明与完整同帧顺序");

const { orderedProjection } = await import("../shared/game/projection/projection-order.js");
assert.throws(() => orderedProjection({ hp: 100 }, { hp: 1 }, ["hp"]), /覆盖基础字段/);
assert.deepEqual(orderedProjection({ hp: 100 }, { added: 1 }, ["hp"]), { hp: 100, added: 1 });

const { compileActiveSkills } = await import("../shared/game/characters/assembly/extension-contract.js");
const effectCalls = [];
const skills = compileActiveSkills([{ id: "验证技能", activeSkills: { sub: (port, meta) => { port.submit(meta); return true; } } }]);
assert.equal(skills.execute("sub", "验证技能", { submit: (meta) => effectCalls.push(meta) }, 7), true);
assert.deepEqual(effectCalls, [7]);
assert.equal(skills.execute("flagship", "未注册角色", {}, {}), false);
assert.throws(() => compileActiveSkills([{ id: "重复" }, { id: "重复" }]), /编号重复/);
assert.throws(() => compileActiveSkills([{ id: "非法", activeSkills: { arbitrary() {} } }]), /未声明/);

// 清理是广播：第一个角色报告成功，也不能跳过后续接收者。
const { createShipEffects } = await import("../shared/game/characters/assembly/ship-effects.js");
const cleansed = [];
const receivers = [20, 10].map((order) => ({ ship: { hooks: {
  clearNegative: [[order, () => { cleansed.push(order); return true; }]],
} } }));
createShipEffects(receivers).clearNegative({});
assert.deepEqual(cleansed, [10, 20], "多个角色负面效果应依次净化，不因首个成功而短路");

const { createStatusProjector } = await import("../shared/game/projection/status-effects.js");
const sample = { alive: true, team: { match: { elapsed: 4 } } };
const project = createStatusProjector([
  { statusEffects: [[20, (_ship, { add }) => add("persistent")]] },
  { statusEffects: [[10, (_ship, { timed }) => timed("custom", 10, 3)]] },
], { custom: {}, persistent: {} });
const beforeSample = JSON.stringify(sample);
const projected = project(sample);
assert.deepEqual(projected, [
  { id: "custom", expiresAt: 10, duration: 6, remaining: 6 },
  { id: "persistent", expiresAt: null, duration: null, remaining: null },
], "新效果只登记角色声明与展示元数据即可输出，不修改中央投影分支");
projected[0].remaining = 100;
assert.equal(project(sample)[0].remaining, 6, "投影不能保留前次输出别名");
assert.equal(JSON.stringify(sample), beforeSample, "投影不能消费时间或修改输入");
assert.deepEqual(project({ ...sample, alive: false }), []);
assert.deepEqual(project({ ...sample, team: { match: { elapsed: 10 } } }), [projected[1]], "到期边界不再输出定时图标");
assert.throws(() => createStatusProjector([{ statusEffects: [[1, (_ship, { add }) => add("missing")]] }])(sample), /未声明/);
assert.throws(() => createStatusProjector([{ statusEffects: [[1, () => {}], [1, () => {}]] }]), /冲突/);

const { ShipStatus } = await import("../shared/game/systems/ship-status.js");
const status = new ShipStatus();
status.activate("newEffectUntil", 9, 1);
const effectOwner = { clearTimedEffect: (key, preserve) => status.clear(key, preserve, 1, 2) };
const effectExtension = createShipEffects([{ positiveTimedEffects: ["newEffectUntil"] }]);
assert.equal(effectExtension.clearPositive(effectOwner, true), false, "新效果自动沿用同帧保护");
assert.equal(status.effects.newEffectUntil, 9);
assert.equal(effectExtension.clearPositive(effectOwner, false), true);
assert.equal(status.effects.newEffectUntil, 0, "新效果无需修改通用净化列表");
assert.throws(() => createShipEffects([{ positiveTimedEffects: ["same", "same"] }]), /重复/);
