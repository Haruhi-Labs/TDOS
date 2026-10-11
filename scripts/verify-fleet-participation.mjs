import assert from "node:assert/strict";
import { MatchSimulation } from "../shared/game-core.js";
import { Ship } from "../shared/game/model/ship.js";
import { selectShamisenHuntTarget } from "../shared/game/shamisen-hunt.js";

const match = new MatchSimulation({ seed: 311, teamLoadouts: {
  A: { main: "kyon", sub1: "yuki", sub2: "future1096" },
  B: { main: "shamisen", sub1: "tsuruya", sub2: "koizumi" },
} });
const team = match.teamA;
const extra = new Ship(team, "extra", 500, 500, 0, { characterId: "kyon", isAuxiliary: true });
team.addAuxiliaryShip(extra);
assert.equal(team.fleetKeyForShip(extra), "main");
assert.ok(team.fleetMembersByKey("main").includes(extra), "旧额外舰船默认继续进入编队");

// 不改变角色身份，只替换能力：编队与胜负资格应各自独立生效。
match.rules = Object.freeze({
  ...match.rules,
  isFleetParticipant: (ship) => ship !== extra,
  countsForVictory: (ship) => ship === team.ships.sub1,
});
assert.equal(team.fleetKeyForShip(extra), extra.key);
assert.equal(team.fleetKeyForShip(extra.key), extra.key, "实体和编号查询必须消费同一资格");
assert.deepEqual(team.fleetMembersForShip(extra), [extra]);
assert.equal(team.fleetMembersByKey("main").includes(extra), false);
assert.deepEqual(team.getVictoryShips(), [team.ships.sub1]);
team.ships.sub1.drainHull(team.ships.sub1.maxHp / 2);
assert.equal(team.hullRatio(), 0.5, "战局生命比例与胜负使用同一参与资格");
assert.equal(selectShamisenHuntTarget(match.teamB, team, () => 0), team.ships.sub1,
  "猎杀候选不能绕过能力契约或自行判断伴随角色");
assert.equal(team.hasLivingShips(), true);
team.ships.sub1.retireWithoutLoss();
assert.equal(team.hasLivingShips(), false, "其他存活实体不能代替有胜负资格的舰船");
let randomCalls = 0;
assert.equal(selectShamisenHuntTarget(match.teamB, team, () => { randomCalls += 1; return 0; }), null);
assert.equal(randomCalls, 0, "无有效猎杀候选时不得消费随机数");

console.log("舰队参与资格校验通过：编队、胜负、生命比例与猎杀通过能力契约独立消费。");
