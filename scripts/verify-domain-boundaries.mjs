import assert from "node:assert/strict";
import { MatchSimulation } from "../shared/game-core.js";
import { fireCandidates } from "../shared/game/targeting-system.js";

const match = new MatchSimulation({ mode: "pvp", seed: 741 });
const left = match.teamA.ships.main;
const right = match.teamB.ships.main;
const originalRules = match.rules;
left.x = right.x = 700;
left.y = 700;
right.y = 701;
match.teamA.visibleEnemyIds.add(right.id);

// 未新增角色分支，仅替换能力契约即可改变通用碰撞、伤害资格与广播视野。
match.rules = Object.freeze({
  ...originalRules,
  participatesInHullCollision: () => false,
  canDamage: () => false,
  broadcastShips: (team) => [team.ships.main],
});
match.resolveShipCollisions();
assert.equal(left.x, 700);
assert.equal(left.y, 700);
assert.equal(right.y, 701, "碰撞系统必须消费能力契约");
assert.equal(fireCandidates(match.teamA, left, match.teamB).length, 0, "目标资格必须消费能力契约");
const hp = left.hp;
left.takeDamage(50, right, match);
assert.equal(left.hp, hp, "承伤与选敌必须共用攻击资格");
match.teamA.getVisionSources = () => [];
match.teamA.computeVisibility(match.teamB);
assert.equal(match.teamA.visibleEnemyIds.has(right.id), true, "通用视野必须消费广播来源");

// 查询能力不得改变任何权威字段；统计、序列化和战斗可在同一帧重复查询。
match.rules = originalRules;
const before = JSON.stringify(match.serializeState());
for (let repeat = 0; repeat < 3; repeat += 1) {
  left.isControlLocked();
  left.isSilenced();
  left.isDamageImmune();
  left.baseSpeed();
  left.minimumFlightSpeed();
  left.damageTakenMultiplier();
  match.rules.broadcastShips(match.teamA);
}
assert.equal(JSON.stringify(match.serializeState()), before, "能力查询不得写入权威状态");
console.log("领域边界校验通过：通用系统消费能力契约，查询不写入权威状态。");
