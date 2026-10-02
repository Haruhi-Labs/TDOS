import assert from "node:assert/strict";
import { MatchSimulation, TICK_DT, __resetEntityIds } from "../../shared/game-core.js";
import { prepareBunnyCompanions } from "../../shared/game/bunny-companion-runtime.js";
import { selectShamisenHuntTarget } from "../../shared/game/shamisen-hunt.js";
import { fireCandidates } from "../../shared/game/targeting-system.js";
import { resolveBunnyOtherworlderContacts, resolveShipCollisions } from "../../shared/game/collision-system.js";
import { createInputQueue } from "../../server/input-queue.js";
import { applyStatePatch, createStatePatch, quantizeNetworkState } from "../../shared/network-patch.js";
import { createOnlineStateSync } from "../../src/online/state-sync.js";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} 应接近 ${b}`);
function setup(mult = 1, dual = false) {
  const sim = new MatchSimulation({
    mode: "pvp", aiSeats: [], allowExperimentalBunnyHaruhi: true,
    teamLoadouts: {
      A: { main: "kyon", sub1: "bunny_haruhi", sub2: "yuki" },
      B: { main: "shamisen", sub1: "tsuruya", sub2: dual ? "bunny_haruhi" : "future1096" },
    },
  });
  const team = sim.teamA;
  for (const side of [team, sim.teamB]) {
    side.splitLevel = 2;
    sim.combatEnabled[side.seat] = false;
    side.getPlayerShips().forEach((ship, i) => {
      ship.x = side.seat === "A" ? 300 : 1300;
      ship.y = 250 + i * 250;
      ship.command = { x: ship.x, y: ship.y };
      ship.throttle = 0;
    });
  }
  team.applyAiStatMult(mult);
  const owner = team.ships.sub1;
  for (let i = 0; i < 4; i += 1) {
    owner.hp = owner.maxHp;
    team.cooldowns.sub1 = 0;
    assert.equal(team.castSubSkill("sub1"), true);
  }
  owner.bunnyHaruhi.support.supporters.clear();
  return { sim, team, owner, companion: team.extraShips[0] };
}

function entityCheck() {
  const { sim, team, owner, companion } = setup(1.2);
  assert.equal(companion.entityRole, "bunny_kyon");
  assert.equal(companion.characterId, "kyon");
  assert.equal(companion.isAttached(), false);
  assert.equal(companion.canControl(), false);
  near(companion.base.hp, 308);
  assert.equal(companion.maxHp, Math.round(308 * 1.2), "难度仅缩放一次");
  near(companion.base.damage, 11.6);
  near(companion.effectiveFireRate(), 0.282, "独立舰不能获得单飞射速");
  near(companion.maxEnergy, 65);
  assert.deepEqual(team.fleetMembersForShip(companion), [companion]);
  team.splitLevel = 0;
  assert.equal(team.fleetMembersByKey("main").length, 3);
  companion.x = owner.x + 1;
  companion.y = owner.y;
  resolveShipCollisions(sim);
  assert.ok(Math.hypot(companion.x - owner.x, companion.y - owner.y) >= companion.radius + owner.radius - 1e-7,
    "母舰附着时阿虚仍保持实体碰撞体积");
  const hp = companion.hp;
  team.ships.main.takeDamage(30, sim.teamB.ships.main, sim);
  assert.equal(companion.hp, hp, "主编队不向阿虚分摊伤害");
  const mainHp = team.ships.main.hp;
  companion.takeDamage(30, sim.teamB.ships.main, sim);
  assert.equal(team.ships.main.hp, mainHp, "阿虚不向主编队分摊伤害");
  const ratio = team.hullRatio();
  companion.hp = 1;
  assert.equal(team.hullRatio(), ratio);
  assert.ok(team.getVisionSources().some((source) => source.id === companion.id));
  assert.equal(team.spawnBunnyCompanion(owner), null, "生成历史必须防止重复实体");
  for (const type of ["set_throttle", "set_route", "cast_sub_skill", "launch_scout"]) {
    assert.equal(sim.applyActionForSeat("A", { type, shipKey: companion.key, throttle: 1, endX: 500, endY: 500 }), false);
  }
  team.splitLevel = 2;
  owner.x = 800;
  prepareBunnyCompanions(sim);
  const x = companion.x;
  companion.update(TICK_DT);
  assert.ok(Math.abs(companion.x - x) < 2, "跟随不能瞬移");
  assert.equal(companion.throttle, owner.throttle);
  const view = companion.serialize();
  assert.equal(view.bunnyCompanion.ownerShipId, owner.id);
  assert.equal(view.bunnyCompanion.nextReliableRemaining, 20);
  assert.equal(view.bunnyCompanion.followOffset, undefined);
  for (const ship of team.getPlayerShips()) ship.alive = false;
  assert.equal(team.hasLivingShips(), false, "仅阿虚存活不阻止胜负结算");
  sim.teamB.shamisenHunt.targetId = null;
  assert.equal(selectShamisenHuntTarget(sim.teamB, team), null);
  prepareBunnyCompanions(sim);
  assert.equal(companion.alive, false);
  assert.equal(sim.telemetry.teams.A.shipsLost, 0, "退场不重复记舰损");

  const second = setup();
  second.companion.takeDamage(10000, second.sim.teamB.ships.main, second.sim);
  assert.equal(second.companion.alive, false);
  assert.equal(second.sim.telemetry.teams.A.shipsLost, 0);
  assert.equal(second.owner.bunnyHaruhi.companionSpawned, true);
  second.owner.takeDamage(10000, second.sim.teamB.ships.main, second.sim);
  assert.equal(second.sim.telemetry.teams.A.shipsLost, 1);

  const legacy = new companion.constructor(team, "legacy_extra", 700, 700, 0, { characterId: "kyon", isAuxiliary: true });
  team.extraShips.push(legacy);
  assert.ok(team.fleetMembersByKey("main").includes(legacy), "旧额外舰船继续进入主编队");
  assert.equal(team.hasLivingShips(), true);
  assert.equal(selectShamisenHuntTarget(sim.teamB, team), legacy, "不扩大新阿虚的猎杀排除范围");
  legacy.takeDamage(10000, sim.teamB.ships.main, sim);
  assert.equal(sim.telemetry.teams.A.shipsLost, 1, "旧额外舰船仍计入舰损");
}

function reliableCheck() {
  const { sim, team, owner, companion } = setup();
  owner.hp = 400;
  owner.energy = 5;
  companion.hp = 100;
  companion.energy = 0;
  sim.elapsed = 19.99;
  prepareBunnyCompanions(sim);
  assert.equal(owner.bunnyReliable, undefined);
  sim.elapsed = 20;
  sim.tick = 600;
  prepareBunnyCompanions(sim);
  near(owner.hp, 400 + 880 * 0.06);
  near(owner.energy, 5 + 130 * 0.15);
  near(companion.hp, 100 + 308 * 0.06);
  near(companion.energy, 65 * 0.15);
  near(companion.effectiveDamage(), 11.6 * 1.06);
  near(companion.damageTakenMultiplier(), 1, "可靠不能偷带普通阿虚的减伤");
  near(companion.baseAcceleration(), 1.02 * 1.1);
  assert.notEqual(owner.bunnyReliable, companion.bunnyReliable);
  owner.clearActiveSkillBuffs();
  assert.equal(owner.bunnyReliable.suppressed, false, "同tick保护");
  sim.tick += 1;
  owner.clearActiveSkillBuffs();
  assert.equal(owner.bunnyReliable.suppressed, true);
  assert.equal(companion.bunnyReliable.suppressed, false, "接收者独立驱散");
  const hp = owner.hp;
  prepareBunnyCompanions(sim);
  assert.equal(owner.hp, hp, "重复采样不重复恢复");
  team.forceCharacterSkillsDisabled = true;
  near(companion.effectiveDamage(), 11.6);
  team.forceCharacterSkillsDisabled = false;
  sim.elapsed = 26;
  prepareBunnyCompanions(sim);
  assert.equal(owner.bunnyReliable, undefined);
  assert.equal(companion.bunnyReliable, undefined);
  companion.effects.silencedUntil = 41;
  sim.elapsed = 40;
  prepareBunnyCompanions(sim);
  assert.equal(companion.bunnyCompanion.nextReliableAt, 60);
  assert.equal(companion.bunnyReliable, undefined, "沉默跳过整个周期");
  sim.elapsed = 60;
  prepareBunnyCompanions(sim);
  assert.ok(owner.bunnyReliable);
  companion.takeDamage(10000, sim.teamB.ships.main, sim);
  assert.equal(owner.bunnyReliable, undefined, "阿虚死亡立即清除母舰来源增益");
  assert.equal(companion.bunnyReliable, undefined);

  for (const blocker of ["seal", "stun", "knockback"]) {
    const other = setup();
    other.sim.elapsed = 20;
    if (blocker === "seal") other.team.forceCharacterSkillsDisabled = true;
    if (blocker === "stun") other.companion.effects.stunnedUntil = 21;
    if (blocker === "knockback") other.companion.forcedKnockback = { endsAt: 21 };
    prepareBunnyCompanions(other.sim);
    assert.equal(other.owner.bunnyReliable, undefined, `${blocker}应阻止触发`);
    assert.equal(other.companion.bunnyCompanion.nextReliableAt, 40);
    other.team.forceCharacterSkillsDisabled = false;
    other.sim.elapsed = 40;
    prepareBunnyCompanions(other.sim);
    assert.ok(other.owner.bunnyReliable, "阻止结束后仅在新周期触发，过期击退不阻止触发");
  }
}

function conversionCheck() {
  const { sim, team, owner, companion } = setup();
  const enemy = sim.teamB;
  sim.elapsed = 20;
  sim.tick = 600;
  prepareBunnyCompanions(sim);
  assert.ok(owner.bunnyReliable);
  // 首次encore之后再进入bless，验证继承的倍率、速度和射击进度换算。
  companion.speed = 10;
  companion.cooldown = 2;
  team.cooldowns.sub1 = 0;
  assert.equal(team.castSubSkill("sub1"), true);
  near(companion.speed, 11.5);
  near(companion.cooldown, 2 / 1.2);
  near(companion.effectiveDamage(), 11.6 * 1.25 * 1.06);
  const id = companion.id;
  const key = companion.key;
  companion.x = owner.x + 40;
  companion.y = owner.y;
  const zone = sim.zones.find((z) => companion.x >= z.x && companion.x <= z.x + z.width && companion.y >= z.y && companion.y <= z.y + z.height);
  sim.projectiles.push({ sourceId: id, alive: true }, { sourceId: owner.id, alive: true });
  assert.equal(enemy.bribeZone(enemy.ships.sub1, zone.id), true);
  assert.equal(companion.team, enemy);
  assert.ok(!team.extraShips.includes(companion) && enemy.extraShips.includes(companion));
  assert.equal(companion.id, id);
  assert.equal(companion.key, key);
  assert.equal(companion.bunnyCompanion.ownerSeat, "A");
  assert.equal(companion.bunnyCompanion.convertedUntil, 25);
  assert.equal(companion.bunnyCompanion.nextReliableAt, null);
  assert.equal(owner.bunnyReliable, undefined);
  assert.equal(companion.bunnyReliable, undefined);
  near(companion.effectiveDamage(), 11.6);
  near(companion.damageTakenMultiplier(), 1);
  assert.equal(sim.projectiles.some((p) => p.sourceId === id), false);
  assert.equal(sim.projectiles.some((p) => p.sourceId === owner.id), true);
  sim.projectiles.length = 0;
  team.visibleEnemyIds.add(id);
  assert.equal(fireCandidates(team, owner, enemy).some((entry) => entry.target === companion), false);
  const health = companion.hp;
  const telemetry = JSON.stringify(sim.telemetry);
  for (const kind of ["projectile", "attack_effect", "skill", "collision", "status_effect"]) {
    assert.equal(companion.takeDamage(50, owner, sim, { kind }), false);
  }
  assert.equal(companion.registerClawHit({ triggerHits: 1, burstDamage: 100, sourceSeat: "A" }, sim, owner), false);
  assert.equal(companion.hp, health);
  assert.equal(companion.clawMarks.stacks, 0);
  assert.equal(JSON.stringify(sim.telemetry), telemetry);
  companion.takeDamage(10, team.ships.sub2, sim);
  near(companion.hp, health - 10, "其他原友舰可以正常伤害阿虚");
  owner.bunnyHaruhi.support.supporters.add("otherworlder");
  owner.speed = owner.effectiveSpeed() * 1.4;
  owner.angle = 0;
  resolveBunnyOtherworlderContacts(sim);
  assert.equal(owner.bunnyHaruhi.support.otherworlderReadyAt, 0, "保护目标不能消耗异世界冲撞冷却");
  assert.equal(companion.forcedKnockback, null);
  owner.bunnyHaruhi.support.supporters.clear();
  // 由真实弹体验证母舰命中不产生伤害、命中统计或猫爪附效。
  companion.angle = 0;
  companion.cooldown = 0;
  enemy.visibleEnemyIds.add(owner.id);
  owner.x = companion.x + 20;
  owner.y = companion.y;
  companion.tryAttack(sim, team);
  assert.equal(sim.projectiles.length, 1, "被策反阿虚可以向母舰开火");
  const projectile = sim.projectiles[0];
  projectile.x = owner.x;
  projectile.y = owner.y;
  const oldOwnerHp = owner.hp;
  projectile.resolveImpact(sim);
  assert.ok(owner.hp < oldOwnerHp);
  assert.ok(sim.telemetry.teams.B.damageDealt.projectile > 0, "命中归当前攻击阵营");
  projectile.team = team;
  projectile.source = owner;
  projectile.sourceId = owner.id;
  projectile.x = companion.x;
  projectile.y = companion.y;
  projectile.claw = { triggerHits: 1, burstDamage: 100 };
  const hits = sim.telemetry.teams.A.attacks.projectileHits;
  const oldHp = companion.hp;
  projectile.resolveImpact(sim);
  assert.equal(companion.hp, oldHp);
  assert.equal(sim.telemetry.teams.A.attacks.projectileHits, hits);
  assert.equal(companion.clawMarks.stacks, 0);
  sim.projectiles.length = 0;

  // 光线先排除受保护目标，再计算命中数伤害档位。
  companion.x = owner.x + 30;
  enemy.ships.main.x = owner.x + 80;
  enemy.ships.main.y = owner.y;
  enemy.ships.sub1.y = owner.y + 300;
  enemy.ships.sub2.y = owner.y + 400;
  team.queueBeamDirection(owner, 1, 0);
  team.beams[0].life = 0;
  const beamHits = sim.telemetry.teams.A.attacks.beamHits;
  team.resolveChargedBeams(enemy);
  assert.equal(sim.telemetry.teams.A.attacks.beamHits - beamHits, 1);
  assert.equal(companion.hp, oldHp);
  team.beams.length = 0;
  sim.elapsed = 24.99;
  prepareBunnyCompanions(sim);
  assert.equal(companion.team, enemy);
  sim.projectiles.push({ sourceId: id, alive: true });
  sim.elapsed = 25;
  const oldRate = companion.effectiveFireRate();
  companion.cooldown = 1;
  let updates = 0;
  const update = companion.update.bind(companion);
  companion.update = (dt) => { updates += 1; update(dt); };
  sim.update(TICK_DT);
  assert.equal(companion.team, team);
  assert.equal(updates, 1, "跨队归还一帧只能更新一次");
  assert.equal(sim.projectiles.some((p) => p.sourceId === id), false);
  near(companion.cooldown, oldRate / companion.effectiveFireRate() - TICK_DT);
  near(companion.bunnyCompanion.nextReliableAt, sim.elapsed + 20);
  assert.equal(companion.bunnyCompanion.convertedUntil, 0);
  assert.equal(owner.bunnyReliable, undefined, "归还不立即触发可靠");
  assert.equal(companion.bunnyCompanion.ownerShipId, owner.id);

  // 母舰死亡优先于策反归还，不能复活或再次记舰损。
  companion.x = zone.x + zone.width / 2;
  companion.y = zone.y + zone.height / 2;
  assert.equal(enemy.bribeZone(enemy.ships.sub1, zone.id), true);
  owner.takeDamage(10000, enemy.ships.main, sim);
  assert.equal(companion.alive, false);
  assert.equal(sim.telemetry.teams.A.shipsLost, 1);
  assert.equal(sim.telemetry.teams.B.shipsLost, 0);
  sim.elapsed += 6;
  prepareBunnyCompanions(sim);
  assert.equal(companion.alive, false);
  assert.equal(companion.team, enemy);
}

function multipleAndImmunityCheck() {
  const { sim, team, owner, companion } = setup(1, true);
  const enemy = sim.teamB;
  for (let i = 0; i < 4; i += 1) {
    enemy.ships.sub2.hp = enemy.ships.sub2.maxHp;
    enemy.cooldowns.sub2 = 0;
    assert.equal(enemy.castSubSkill("sub2"), true);
  }
  const second = enemy.extraShips[0];
  const zone = sim.zoneById(5);
  companion.x = zone.x + 60;
  companion.y = zone.y + 60;
  second.x = zone.x + 180;
  second.y = zone.y + 180;
  assert.equal(enemy.bribeZone(enemy.ships.sub1, 5), true);
  assert.equal(enemy.extraShips.length, 2);
  let firstUpdates = 0;
  let secondUpdates = 0;
  companion.update = () => { firstUpdates += 1; };
  second.update = () => { secondUpdates += 1; };
  sim.update(TICK_DT);
  assert.equal(firstUpdates, 1);
  assert.equal(secondUpdates, 1);
  assert.deepEqual(enemy.fleetMembersForShip(companion), [companion]);
  assert.deepEqual(enemy.fleetMembersForShip(second), [second]);
  sim.elapsed = 5;
  prepareBunnyCompanions(sim);
  assert.equal(companion.team, team);
  assert.equal(enemy.extraShips.length, 1);
  // 母舰在策反末尾进入knows：归还只继承剩余免伤，不重建4秒窗口。
  assert.equal(enemy.bribeZone(enemy.ships.sub1, 5), true);
  sim.elapsed = 9;
  for (let i = 0; i < 2; i += 1) {
    team.cooldowns.sub1 = 0;
    assert.equal(team.castSubSkill("sub1"), true);
  }
  assert.equal(owner.bunnyHaruhi.form, "knows");
  assert.equal(companion.isDamageImmune(), false);
  sim.elapsed = 10;
  prepareBunnyCompanions(sim);
  assert.equal(companion.isDamageImmune(), true);
  near(companion.effectiveDamage(), 11.6 * 0.7);
  sim.elapsed = 13;
  assert.equal(companion.isDamageImmune(), false);
  assert.equal(owner.bunnyHaruhi.immunityUntil, 13);
  assert.equal(enemy.bribeZone(enemy.ships.sub1, 5), true);
  assert.equal(team.bribeZone(owner, 5), true, "原阵营反策反可提前归还");
  assert.equal(companion.team, team);
  assert.equal(companion.bunnyCompanion.convertedUntil, 0);
  assert.equal(companion.bunnyCompanion.nextReliableAt, 33);
}

function replayAndDisplayCheck() {
  const original = Math.random;
  function replay(queued) {
    let seed = 603;
    Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    __resetEntityIds();
    const { sim, owner, companion } = setup();
    const queue = createInputQueue();
    const player = { inputQueue: [], lastProcessedSeq: 0, lastQueuedSeq: 0 };
    const states = [];
    let previous = quantizeNetworkState(sim.serializeState());
    for (let i = 0; i < 900; i += 1) {
      if (i === 630) {
        const zone = sim.zoneById(5);
        companion.x = zone.x + 100;
        companion.y = zone.y + 100;
        const action = { type: "cast_sub_skill", shipKey: "sub1", zoneId: 5 };
        if (queued) assert.equal(queue.queueInput(player, { seq: 1, action }), true);
        else assert.equal(sim.applyActionForSeat("B", action), true);
      }
      if (i === 850) owner.takeDamage(10000, sim.teamB.ships.main, sim);
      if (queued) queue.applyQueuedInputs({ match: sim, seats: { A: "A", B: "B" } }, (id) => id === "B" ? player : null);
      sim.update(TICK_DT);
      const view = sim.serializeState();
      states.push(JSON.stringify(view));
      const next = quantizeNetworkState(view);
      const patch = JSON.parse(JSON.stringify(createStatePatch(previous, next)));
      assert.deepEqual(applyStatePatch(previous, patch), next);
      previous = next;
    }
    return states;
  }
  try { assert.deepEqual(replay(false), replay(true), "实体/技能/策反/死亡的服务端输入回放必须一致"); }
  finally { Math.random = original; }

  const { sim, companion } = setup();
  const before = sim.serializeState();
  companion.x += 20;
  const zone = sim.zones.find((z) => companion.x >= z.x && companion.x <= z.x + z.width && companion.y >= z.y && companion.y <= z.y + z.height);
  sim.teamB.bribeZone(sim.teamB.ships.sub1, zone.id);
  const after = sim.serializeState();
  const app = { routeOverrides: new Map(), smoothEntities: new Map(), lastRenderMs: 0, seat: "A", serverTickRate: 30, interpDelayMs: 0 };
  let now = 1000;
  const sync = createOnlineStateSync({ app, nowMs: () => now, worldSize: sim.worldSize, maxExtrapolateMs: 180 });
  app.snapshots = [{ tick: 0, state: before, serverTimeMs: now, receivedAtMs: now }];
  sync.getRenderState();
  now += 16;
  app.snapshots = [{ tick: 1, state: after, serverTimeMs: now, receivedAtMs: now }];
  const stable = sync.getRenderState();
  assert.equal(stable.teams.A.extraShips.length, 0);
  assert.equal(stable.teams.B.extraShips[0].x, companion.x, "换队首帧不得复用旧阵营平滑缓存");
  const interpolated = sync.interpolateSnapshotState({ tick: 1, state: before }, { tick: 2, state: after }, 0.5);
  assert.equal(interpolated.teams.B.extraShips[0].x, companion.x);
  assert.equal(interpolated.teams.B.extraShips[0].bunnyCompanion.convertedRemaining, 5);
  assert.deepEqual(sim.serializeState(), after, "显示插值不得回写模拟");
}

export function runBunnyCompanionSuite() {
  entityCheck();
  reliableCheck();
  conversionCheck();
  multipleAndImmunityCheck();
  replayAndDisplayCheck();
}
