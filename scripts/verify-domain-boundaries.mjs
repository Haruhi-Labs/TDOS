import assert from "node:assert/strict";
import { MatchSimulation } from "../shared/game-core.js";

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
assert.equal(match.teamA.fireCandidates(left, match.teamB).length, 0, "目标资格必须消费能力契约");
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

// 输出给 UI 或工具的快照不得把航线、地图或 AI 记忆的引用带出权威层。
const isolated = new MatchSimulation({ mode: "ai", seed: 93 });
isolated.teamA.ships.main.setBezierRoute(undefined, undefined, 500, 500, 1, false);
for (let tick = 0; tick < 20; tick += 1) isolated.update();
const detached = isolated.serializeState();
const expected = JSON.stringify(detached);
function vandalize(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "number") value[key] = -999;
    else if (typeof item === "string") value[key] = "外部修改";
    else vandalize(item);
  }
}
vandalize(detached);
assert.equal(JSON.stringify(isolated.serializeState()), expected, "修改输出快照不得回写权威或 AI 状态");
const observation = isolated.bot.port.observe();
const zoneX = isolated.zones[0].x;
observation.world.zones[0].x = -500;
assert.equal(isolated.zones[0].x, zoneX, "AI 观察不得引用权威地图对象");
console.log("输出隔离校验通过：外部修改快照及观察不能回写对局。");

// 过期状态的读取不负责结算；重复序列化也不能触发清理。
left.clawMarks = { sourceSeat: "B", stacks: 2, required: 4, expiresAt: 1, color: "#fff" };
match.elapsed = 2;
const expired = { ...left.clawMarks };
for (let repeat = 0; repeat < 3; repeat += 1) {
  assert.equal(left.activeClawMarks().stacks, 0);
  left.serialize();
}
assert.deepEqual(left.clawMarks, expired, "只读查询不得提交过期状态");
left.update(0);
assert.equal(left.clawMarks.stacks, 0, "实体更新应提交到期清理");
left.activeClawMarks().required = 999;
assert.equal(left.clawMarks.required, 4, "抓痕查询不得暴露可写组件引用");
console.log("查询纯度校验通过：过期清理属于实体生命周期，读取次数不影响权威状态。");

// 策略不需要模拟实例；冻结读模型仍能完成预算分配和优先级选择。
const { assignFocusTargets, pickTargetId } = await import("../shared/game/targeting-system.js");
const { freezePlainData } = await import("../shared/data/plain-data.js");
const candidates = freezePlainData([
  { target: { id: "近", hp: 80, maxHp: 100 }, dist: 1, arc: 0 },
  { target: { id: "弱", hp: 10, maxHp: 100 }, dist: 4, arc: 1 },
  { target: { id: "次弱", hp: 20, maxHp: 100 }, dist: 2, arc: 1 },
]);
const assignments = assignFocusTargets(freezePlainData([
  { id: "低输出", budget: 5, candidates },
  { id: "高输出", budget: 12, candidates },
]), 0.5);
assert.deepEqual([...assignments], [["高输出", "弱"], ["低输出", "次弱"]]);
assert.equal(pickTargetId(candidates, { focusLowHp: false }), "近", "普通选敌保留最近目标与后续射界判定的顺序");
assert.equal(pickTargetId(candidates, { focusLowHp: true, focusHpFrac: 0.5 }), "弱");
assert.equal(pickTargetId(candidates, { huntTargetId: "次弱", assignedTargetId: "弱", focusLowHp: true, focusHpFrac: 0.5 }), "次弱");
assert.equal(pickTargetId(candidates.filter((entry) => entry.target.id !== "弱"), { assignedTargetId: "弱", focusLowHp: true, focusHpFrac: 0.5 }), "次弱", "已失效分配不得压过本次有效候选");
console.log("选敌读模型校验通过：纯数据分配、优先级与失效目标回退保持契约。");
