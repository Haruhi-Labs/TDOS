import assert from "node:assert/strict";
import { MatchSimulation } from "../shared/game-core.js";
import { ProjectileSystem } from "../shared/game/systems/projectile-system.js";
import { Scout } from "../shared/game/model/scout.js";
import { Wingman } from "../shared/game/model/wingman.js";

// 不使用任何角色、领域实体或模拟对象，仍可验证通用阶段的消费顺序。
const first = { id: 1, alive: true };
const second = { id: 2, alive: true };
const arriving = { id: 3, alive: true };
const system = new ProjectileSystem((profile) => profile);
system.spawn(first);
system.spawn(second);
const history = system.items;
assert.throws(() => history.push(arriving), TypeError);
assert.throws(() => { system.items = []; }, TypeError);
const trace = [];
system.advance(0.02, {
  intercept(projectile, dt) {
    assert.equal(dt, 0.02);
    trace.push(`拦截检查${projectile.id}`);
    if (projectile === first) { projectile.alive = false; return true; }
    return false;
  },
  finish() { assert.deepEqual(system.items, [second, arriving]); },
  advance(projectile) {
    trace.push(`推进${projectile.id}`);
    if (projectile === second) system.spawn(arriving);
  },
});
assert.deepEqual(trace, ["拦截检查1", "拦截检查2", "推进2", "拦截检查3", "推进3"]);
assert.deepEqual(system.items, [second, arriving], "保持原活集合迭代语义，不偷偷改成帧末新增");

assert.deepEqual(history, [first, second], "历史成员视图不跟随新成员发布");

// 来源清理在遍历中重发集合时，仍保留旧版当前遍历与最终筛选的归属。
const retiring = new ProjectileSystem((profile) => ({ ...profile, alive: true, discard() { this.alive = false; } }));
const retiringShot = retiring.spawn({ id: 4, sourceId: 4 });
const survivor = retiring.spawn({ id: 5, sourceId: 5 });
const consumed = [];
let afterFinish;
retiring.advance(0.02, {
  intercept: () => false,
  advance(projectile) {
    consumed.push(projectile.id);
    if (projectile === retiringShot) {
      retiring.discardFrom(4);
      retiring.spawn({ id: 6, sourceId: 6 });
    }
  },
  finish() {
    assert.deepEqual(retiring.items, [survivor], "最终筛选仍基于本轮捕获的数组");
    afterFinish = retiring.spawn({ id: 7, sourceId: 7 });
  },
});
assert.deepEqual(consumed, [4, 5]);
assert.deepEqual(retiring.items, [survivor, afterFinish], "收尾阶段创建的弹体保留到下一帧");

const match = new MatchSimulation({ seed: 569, aiSeats: [] });
const source = match.teamA.ships.main;
const claw = { triggerHits: 4, burstDamage: 20 };
const shot = match.spawnProjectile({ team: match.teamA, source, x: source.x, y: source.y,
  targetX: 700, targetY: 700, damage: 1, claw });
assert.equal(match.projectiles[0], shot);
assert.throws(() => { match.projectiles = []; }, TypeError);
assert.throws(() => { match.projectiles.length = 0; }, TypeError);
claw.burstDamage = 999;
assert.equal(shot.claw.burstDamage, 20, "创建操作不保留外部可写载荷别名");
let prepared = 0;
let finished = 0;
match.createProjectilePhase = (owner) => {
  assert.equal(owner, match);
  prepared += 1;
  return {
    intercept(projectile) { projectile.discard(); return true; },
    advance() { assert.fail("被拦截弹体不得继续移动或命中"); },
    finish() {
      finished += 1;
      assert.deepEqual(owner.projectiles, [], "阶段结束时先发布存活集合，再执行护盾恢复等收尾");
    },
  };
};
match.updateProjectiles(0.02);
assert.equal(prepared, 1);
assert.equal(finished, 1);
const firing = new MatchSimulation({ seed: 598, aiSeats: [] });
const team = firing.teamA;
const enemy = firing.teamB;
const target = enemy.ships.main;
const ship = team.ships.main;
const scout = new Scout(team, ship.x, ship.y, { combatCapable: true, zone: firing.zones[0] });
const wingman = new Wingman(team, ship.x, ship.y, firing.zones[0]);
team.pickTargetFor = () => target;
ship.broadsideMultiplier = () => 1;
const requests = [];
firing.spawnProjectile = (profile) => { requests.push(profile); };
for (const actor of [ship, scout, wingman]) {
  if (actor === ship) actor.resetAttackCycle(0);
  else actor.resetAttackCycle(0);
  actor.tryAttack(firing, enemy);
}
assert.deepEqual(requests.map((request) => request.source), [ship, scout, wingman]);
assert.equal(firing.projectiles.length, 0, "替换创建能力后，攻击者不得绕过端口自行修改对局集合");
console.log("弹体阶段校验通过：所有者创建、载荷隔离、即时拦截、活集合迭代及发布后收尾。");
