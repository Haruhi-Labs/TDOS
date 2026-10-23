import { ScenarioSimulation, sampleScenarioTime } from "./core-tests/scenario-simulation.mjs";
import assert from "node:assert/strict";


const match = new ScenarioSimulation({ seed: 572, aiSeats: [], teamLoadouts: {
  A: { main: "kyon", sub1: "haruhi", sub2: "yuki" },
} });
const team = match.teamA;
team.split(1);
const caster = team.ships.sub1;
const target = match.teamB.ships.main;
target.displaceTo(caster.x + 10, caster.y);
assert.equal(team.castSubSkill("sub1"), true);
const charging = match.haruhiHeroPowerEffects[0];
assert.equal(charging.phase, "charge");
assert.throws(() => { charging.phase = "shock"; }, TypeError);
assert.throws(() => charging.hitShipIds.push(target.id), TypeError);
assert.throws(() => match.haruhiHeroPowerEffects.push({}), TypeError);
assert.throws(() => { match.haruhiHeroPowerEffects = []; }, TypeError);
sampleScenarioTime(match, { elapsed: charging.releaseAt });
match.updateHaruhiHeroPowers();
const released = match.haruhiHeroPowerEffects[0];
assert.equal(released.phase, "shock");
assert.equal(charging.phase, "charge", "实时推进不能回写已取得的历史读视图");
assert.ok(released.hitShipIds.includes(target.id));
assert.equal(target.canControl(), false);
const bursts = match.bursts.length;
match.updateHaruhiHeroPowers();
assert.equal(match.bursts.length, bursts, "同时间重复推进不得再次释放冲击");
const snapshot = match.serializeState();
snapshot.haruhiHeroPowerEffects[0].hitShipIds.length = 0;
snapshot.haruhiHeroPowerEffects.length = 0;
assert.ok(match.haruhiHeroPowerEffects[0].hitShipIds.includes(target.id));
sampleScenarioTime(match, { elapsed: released.expiresAt });
match.updateHaruhiHeroPowers();
assert.deepEqual(match.haruhiHeroPowerEffects, []);
match.queueHeroPower(caster, {});
caster.retireWithoutLoss();
match.updateHaruhiHeroPowers();
assert.deepEqual(match.haruhiHeroPowerEffects, [], "施法者死亡必须取消尚未释放的事件");
console.log("勇者之力所有权校验通过：私有队列、历史读视图、恰好一次释放、快照隔离和死亡取消。");
