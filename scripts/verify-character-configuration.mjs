import assert from "node:assert/strict";
import { CHARACTER_DEFS, CHARACTER_ORDER, MatchSimulation } from "../shared/game-core.js";
import { Ship } from "../shared/game/model/ship.js";

assert.throws(() => { CHARACTER_ORDER.reverse(); }, TypeError, "消费方排序不得改写共享角色目录");

for (const id of CHARACTER_ORDER) {
  const loadout = { main: id, sub1: "kyon", sub2: "yuki" };
  const simulation = new MatchSimulation({ seed: 221, teamLoadouts: { A: loadout } });
  const team = simulation.teamA;
  const ship = team.ships.main;
  const initial = simulation.serializeState();
  const definition = CHARACTER_DEFS[id];
  loadout.main = "未注册角色";
  assert.equal(team.mainCharacterId(), id, "创建参数不能反向修改运行中阵容");
  assert.throws(() => { team.loadout.main = "未注册角色"; }, TypeError);
  assert.throws(() => { team.loadout = {}; }, TypeError);
  assert.throws(() => { ship.characterId = "未注册角色"; }, TypeError);
  assert.throws(() => { ship.character = {}; }, TypeError);
  assert.throws(() => { ship.entityRole = "bunny_kyon"; }, TypeError);
  assert.throws(() => { ship.base = {}; }, TypeError);
  assert.throws(() => { ship.base.speed = 0; }, TypeError);
  assert.throws(() => { definition.subSkill.cooldown = 0; }, TypeError);
  assert.throws(() => { CHARACTER_DEFS[id] = {}; }, TypeError);
  const output = team.serialize();
  output.loadout.main = "未注册角色";
  output.ships.main.characterId = "未注册角色";
  assert.deepEqual(simulation.serializeState(), initial, "非法写入和可写投影均不得改变对局");
}

const simulation = new MatchSimulation({ seed: 222 });
const stats = { ...CHARACTER_DEFS.kyon.stats };
const custom = new Ship(simulation.teamA, "custom", 100, 200, 0, {
  characterId: "kyon", entityRole: "test_role", baseStats: stats,
});
const initialBase = custom.base;
stats.speed = 999;
assert.equal(custom.base.speed, CHARACTER_DEFS.kyon.stats.speed, "自定义机体必须取得独立配置");
assert.notEqual(custom.base, stats);
assert.throws(() => { custom.entityRole = "bunny_kyon"; }, TypeError);
const training = { hp: 2000, energy: 80, speed: 2 };
custom.configureTraining(training, { x: 300, y: 400 });
training.speed = 800;
assert.equal(custom.base.speed, 2, "训练装配经舰体所有者替换配置，不保留可写入参");
assert.equal(custom.hp, 2000);
assert.equal(custom.energy, 80);
assert.deepEqual(custom.command, { x: 300, y: 400 });
assert.equal(initialBase.speed, CHARACTER_DEFS.kyon.stats.speed, "历史机体配置不随替换改变");
assert.equal(custom.characterId, "kyon", "训练配置替换不改变角色身份");
assert.throws(() => { custom.base.speed = 0; }, TypeError);
console.log("角色出生配置校验通过：九角色定义、阵容与身份只读，自定义机体和训练配置独立消费。");
