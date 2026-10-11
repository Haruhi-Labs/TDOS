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
