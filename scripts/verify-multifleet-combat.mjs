import assert from "node:assert/strict";
import {
  DEFAULT_WORLD_SIZE,
  MatchSimulation,
  TICK_DT,
} from "../shared/game-core.js";
import { createSeededRng } from "../shared/game/foundation/rng.js";
import { buildZones, clamp } from "../shared/game/foundation/math.js";
import { CHARACTER_ASSEMBLY } from "../shared/game/characters/assembly/character-assembly.js";
import { Team } from "../shared/game/model/team.js";
import { Ship } from "../shared/game/model/ship.js";
import { Scout } from "../shared/game/model/scout.js";
import { Wingman } from "../shared/game/model/wingman.js";
import { Projectile } from "../shared/game/model/projectile.js";
import { normalizeMatchTopology, defaultLegacySpawns } from "../shared/game/runtime/match-topology.js";
import { createFleetRegistry } from "../shared/game/runtime/fleet-registry.js";
import { BattleRuntime } from "../shared/game/runtime/battle-runtime.js";
import { createHostileView } from "../shared/game/adapters/combat-targets.js";
import { createHullCollisionPort } from "../shared/game/adapters/collision-port.js";
import { HullCollisionSystem, COLLISION_SLOW_DURATION } from "../shared/game/systems/collision-system.js";
import { setScenarioField } from "./core-tests/ship-fixture.mjs";

function makeLoadout(index = 0) {
  const presets = [
    { main: "kyon", sub1: "asakura", sub2: "koizumi" },
    { main: "haruhi", sub1: "tsuruya", sub2: "yuki" },
    { main: "koizumi", sub1: "future1096", sub2: "asakura" },
    { main: "yuki", sub1: "kyon", sub2: "shamisen" },
    { main: "tsuruya", sub1: "haruhi", sub2: "future1096" },
    { main: "asakura", sub1: "shamisen", sub2: "kyon" },
  ];
  return { ...presets[index % presets.length] };
}

function makeFleetConfig(seat, sideId, index, loadoutOverride = null, spawnOverride = null) {
  return {
    seat,
    sideId,
    name: `舰队_${seat}`,
    loadout: loadoutOverride || makeLoadout(index),
    spawn: spawnOverride || {
      x: 240 + (index % 3) * 380,
      y: 260 + Math.floor(index / 3) * 720,
      facing: index % 2 === 0 ? 0 : Math.PI,
    },
  };
}

// 多舰队组件夹具宿主：复用真实 Team/Ship/Scout/Wingman/Projectile/visibility-port/fire-control，
// 不修改或绕过生产开局校验。
function createMultiFleetHost(topology, { seed = 301, bunnyHaruhiActive = false } = {}) {
  const worldSize = DEFAULT_WORLD_SIZE;
  const zones = buildZones(worldSize);
  const rng = createSeededRng(seed);
  const spawnedProjectiles = [];
  const recordedAttacks = [];
  const recordedDamage = [];
  const recordedShipLosses = [];
  const floatingTexts = [];
  const bursts = [];

  const host = {
    worldSize,
    mapPadding: 34,
    elapsed: 0,
    tick: 0,
    zones,
    rng,
    entityIds: { value: 1 },
    rules: CHARACTER_ASSEMBLY.rules,
    shipEffects: CHARACTER_ASSEMBLY.shipEffects,
    projectShip: CHARACTER_ASSEMBLY.projectShip,
    bunnyHaruhiActive,
    spawnedProjectiles,
    recordedAttacks,
    recordedDamage,
    recordedShipLosses,
    floatingTexts,
    bursts,
    clampX(x, padding = 0) { return clamp(x, padding, worldSize - padding); },
    clampY(y, padding = 0) { return clamp(y, padding, worldSize - padding); },
    zoneById(zoneId) {
      const safeId = clamp(Number(zoneId) || 5, 1, 9);
      return zones.find((zone) => zone.id === safeId) || zones[4];
    },
    recordAction() {},
    recordAttack(seat, kind, hitCount = 0) {
      recordedAttacks.push({ seat, kind, hitCount });
    },
    recordDamage(source, target, amount, kind) {
      recordedDamage.push({
        sourceSeat: source?.team?.seat || null,
        targetSeat: target?.team?.seat || null,
        targetId: target?.id || null,
        amount,
        kind,
      });
    },
    recordShipLoss(seat) {
      recordedShipLosses.push(seat);
    },
    spawnFloatingText(x, y, text, color) {
      floatingTexts.push({ x, y, text, color });
    },
    spawnFloatingTextKey(x, y, textKey, args, color) {
      floatingTexts.push({ x, y, textKey, args, color });
    },
    spawnAnnouncementKey(x, y, textKey, args, color) {
      floatingTexts.push({ x, y, textKey, args, color, announcement: true });
    },
    spawnBurst(x, y, color, radius) {
      bursts.push({ x, y, color, radius });
    },
    spawnProjectile(profile) {
      const projectile = new Projectile(profile);
      spawnedProjectiles.push(projectile);
      return projectile;
    },
    onShipDestroyed() {},
    discardProjectilesFrom() {},
    queueHeroPower() {},
  };

  const teams = topology.fleets.map((fleet) => new Team(
    host,
    fleet.seat,
    fleet.name,
    fleet.spawn.x,
    fleet.spawn.y,
    fleet.spawn.facing,
    {
      loadout: fleet.loadout,
      sideId: fleet.sideId,
      presentation: fleet.presentation,
    },
  ));
  const registry = createFleetRegistry(topology, teams);
  const views = new Map(
    topology.seatOrder.map((seat) => [seat, createHostileView(registry, seat)]),
  );

  host.seatOrder = registry.seatOrder;
  host.relations = registry.relations;
  host.allTeams = () => registry.allTeams();
  host.teamBySeat = (seat) => registry.teamBySeat(seat);
  host.alliedTeamsOf = (seat) => registry.alliedTeamsOf(seat);
  host.enemyTeamsOf = (seat) => registry.enemyTeamsOf(seat);
  host.hostilePairs = () => registry.hostilePairs();
  host.hostileUnorderedPairs = () => registry.hostileUnorderedPairs();
  host.enemyTeamBySeat = (seat) => registry.enemyTeamBySeat(seat);
  host.hostileView = (seat) => {
    if (typeof seat !== "string" || !views.has(seat)) {
      throw new Error(`未知席位 ${String(seat)}，无法获取敌对集合视图`);
    }
    return views.get(seat);
  };

  return { host, teams, registry };
}

function placeShip(ship, x, y, angle = 0) {
  setScenarioField(ship, "x", x);
  setScenarioField(ship, "y", y);
  setScenarioField(ship, "angle", angle);
}

// =========================================================================
// hostileView 契约、冻结边界、误用/未知席位抛错、单敌队等价、多敌队广播拼接
// =========================================================================
{
  const fourTopology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", 0, { main: "kyon", sub1: "asakura", sub2: "koizumi" }, { x: 100, y: 100, facing: 0 }),
      makeFleetConfig("P2", "side1", 1, { main: "haruhi", sub1: "tsuruya", sub2: "yuki" }, { x: 140, y: 1300, facing: 0 }),
      makeFleetConfig("P3", "side2", 2, { main: "haruhi", sub1: "koizumi", sub2: "asakura" }, { x: 1300, y: 140, facing: Math.PI }),
      makeFleetConfig("P4", "side2", 3, { main: "haruhi", sub1: "kyon", sub2: "yuki" }, { x: 1300, y: 1300, facing: Math.PI }),
    ],
  });
  const { host, teams, registry } = createMultiFleetHost(fourTopology, { seed: 308 });
  const [p1, p2, p3, p4] = teams;

  // 加入侦察机与僚机以验证完整实体顺序拼接（seatOrder → 队内顺序）
  const p3Scout = new Scout(p3, 1280, 140, { zone: host.zoneById(3), combatCapable: true });
  const p4Wingman = new Wingman(p4, 1280, 1280, host.zoneById(9));
  assert.equal(p3.addScout(p3Scout), true);
  assert.equal(p4.addWingman(p4Wingman), true);

  const viewP1 = host.hostileView("P1");
  assert.equal(Object.isFrozen(viewP1), true, "敌对集合视图必须是冻结对象");
  assert.deepEqual(Object.keys(viewP1), ["getEntities", "getAllShips", "getVictoryShips"], "视图只暴露三个集合方法");
  assert.deepEqual(Object.getOwnPropertyNames(viewP1), ["getEntities", "getAllShips", "getVictoryShips"]);

  // 未提供字段既不存在于对象，直接误访问也必须抛错
  for (const forbidden of [
    "ships",
    "seat",
    "sideId",
    "match",
    "scouts",
    "wingmen",
    "effects",
    "cooldowns",
    "visibleEnemyIds",
    "loadout",
    "splitLevel",
  ]) {
    assert.equal(Object.hasOwn(viewP1, forbidden), false, `视图不得声明 ${forbidden}`);
    assert.equal(forbidden in viewP1, false, `视图不得包含 ${forbidden}`);
    assert.throws(() => viewP1[forbidden], TypeError, `误访问视图.${forbidden} 必须直接抛错`);
  }
  assert.throws(() => viewP1.ships.main, TypeError, "将视图当作完整 Team 读取 ships.main 必须抛错");
  assert.throws(() => { viewP1.getEntities = () => []; }, TypeError, "视图方法不可覆写");
  assert.throws(() => { viewP1.extra = 1; }, TypeError, "视图不可扩展");

  // 未知席位与原型键必须抛错
  for (const invalidSeat of ["unknown", "A", "B", "__proto__", "constructor", "toString", "", null, undefined, 0]) {
    assert.throws(() => createHostileView(registry, invalidSeat), /未知席位/, `createHostileView 必须拒绝 ${String(invalidSeat)}`);
    assert.throws(() => host.hostileView(invalidSeat), /未知席位/, `hostileView 必须拒绝 ${String(invalidSeat)}`);
  }

  // 四席两方集合顺序与 ID 唯一性
  const entitiesP1 = viewP1.getEntities();
  assert.deepEqual(
    entitiesP1,
    [...p3.getEntities(), ...p4.getEntities()],
    "四席两方敌对集合必须按 seatOrder → 队内顺序拼接",
  );
  assert.equal(new Set(entitiesP1.map((e) => e.id)).size, entitiesP1.length, "敌对实体 ID 必须唯一");
  assert.equal(entitiesP1.some((e) => e.team === p1 || e.team === p2), false, "本队与盟友不得进入敌对实体集合");
  assert.deepEqual(viewP1.getAllShips(), [...p3.getAllShips(), ...p4.getAllShips()]);
  assert.deepEqual(viewP1.getVictoryShips(), [...p3.getVictoryShips(), ...p4.getVictoryShips()]);

  // 三席混战每席恰含其余两敌，保持 seatOrder
  const ffaTopology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("F1", "s1", 0),
      makeFleetConfig("F2", "s2", 1),
      makeFleetConfig("F3", "s3", 2),
    ],
  });
  const ffa = createMultiFleetHost(ffaTopology, { seed: 309 });
  const [f1, f2, f3] = ffa.teams;
  assert.deepEqual(ffa.host.hostileView("F1").getAllShips(), [...f2.getAllShips(), ...f3.getAllShips()]);
  assert.deepEqual(ffa.host.hostileView("F2").getAllShips(), [...f1.getAllShips(), ...f3.getAllShips()]);
  assert.deepEqual(ffa.host.hostileView("F3").getAllShips(), [...f1.getAllShips(), ...f2.getAllShips()]);

  // 单敌队完全等价（真实 MatchSimulation）
  const dualMatch = new MatchSimulation({ mode: "pvp", seed: 310 });
  const viewA = dualMatch.hostileView("A");
  const viewB = dualMatch.hostileView("B");
  assert.deepEqual(viewA.getEntities(), dualMatch.teamB.getEntities(), "单敌队 getEntities 必须与原 Team 完全等价");
  assert.deepEqual(viewA.getAllShips(), dualMatch.teamB.getAllShips(), "单敌队 getAllShips 必须与原 Team 完全等价");
  assert.deepEqual(viewA.getVictoryShips(), dualMatch.teamB.getVictoryShips(), "单敌队 getVictoryShips 必须与原 Team 完全等价");
  assert.deepEqual(viewB.getEntities(), dualMatch.teamA.getEntities());
  assert.throws(() => dualMatch.hostileView("C"), /未知席位/);
  assert.throws(() => dualMatch.hostileView("__proto__"), /未知席位/);

  // 多敌队广播拼接：P3 与 P4 同时开启春日强化广播向 P1 暴露，盟友 P2 同样开启广播但不得进入 P1 敌方可见集
  p2.activateHaruhiSupport(10, () => 0.2);
  p3.activateHaruhiSupport(10, () => 0.2);
  p4.activateHaruhiSupport(10, () => 0.2);
  p1.computeVisibility(viewP1);
  for (const ship of p3.getAllShips()) {
    assert.equal(p1.visibleEnemyIds.has(ship.id), true, `P3 广播舰 ${ship.key} 应进入 P1 可见集`);
  }
  for (const ship of p4.getAllShips()) {
    assert.equal(p1.visibleEnemyIds.has(ship.id), true, `P4 广播舰 ${ship.key} 应进入 P1 可见集`);
  }
  for (const ship of p2.getAllShips()) {
    assert.equal(p1.visibleEnemyIds.has(ship.id), false, `盟友 P2 广播舰 ${ship.key} 不得进入 P1 敌方可见集`);
  }

  // 验证广播处理器收到的是真实 Team 实例而非 hostileView（允许读 enemy.ships.main）
  const seenBroadcastTeams = [];
  const origRules = host.rules;
  host.rules = Object.freeze({
    ...origRules,
    broadcastShips: (enemy) => {
      seenBroadcastTeams.push(enemy);
      return [enemy.ships.main];
    },
  });
  p1.getVisionSources = () => [];
  p1.computeVisibility(viewP1);
  assert.deepEqual(seenBroadcastTeams, [p3, p4], "visibility-port 必须按 enemyTeamsOf 逐队传入真实 Team 调用 broadcastShips");
  assert.equal(p1.visibleEnemyIds.has(p3.ships.main.id), true);
  assert.equal(p1.visibleEnemyIds.has(p4.ships.main.id), true);
  assert.equal(p1.visibleEnemyIds.size, 2);
}

// =========================================================================
// 全敌方候选统一选敌，单次齐射每单位只发射和提交一次冷却，不逐敌队重复开火
// =========================================================================
{
  const fourTopology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", 0, { main: "kyon", sub1: "asakura", sub2: "koizumi" }, { x: 500, y: 500, facing: 0 }),
      makeFleetConfig("P2", "side1", 1, { main: "haruhi", sub1: "tsuruya", sub2: "yuki" }, { x: 100, y: 1200, facing: 0 }),
      makeFleetConfig("P3", "side2", 2, { main: "kyon", sub1: "asakura", sub2: "koizumi" }, { x: 640, y: 500, facing: Math.PI }),
      makeFleetConfig("P4", "side2", 3, { main: "kyon", sub1: "asakura", sub2: "koizumi" }, { x: 590, y: 500, facing: Math.PI }),
    ],
  });
  const { host, teams } = createMultiFleetHost(fourTopology, { seed: 311 });
  const [p1, , p3, p4] = teams;
  // 把副舰移远，只测 P1 主舰 + 1 架作战侦察机 + 1 架僚机
  p1.configureFormation(2);
  placeShip(p1.ships.main, 500, 500, 0);
  placeShip(p1.ships.sub1, 100, 100, 0);
  placeShip(p1.ships.sub2, 100, 140, 0);
  p3.configureFormation(2);
  p4.configureFormation(2);
  placeShip(p3.ships.main, 650, 500, Math.PI);
  placeShip(p3.ships.sub1, 1300, 1300, Math.PI);
  placeShip(p3.ships.sub2, 1300, 1340, Math.PI);
  placeShip(p4.ships.main, 590, 500, Math.PI);
  placeShip(p4.ships.sub1, 1300, 1200, Math.PI);
  placeShip(p4.ships.sub2, 1300, 1240, Math.PI);

  const scout = new Scout(p1, 510, 500, { zone: host.zoneById(5), combatCapable: true });
  const wingman = new Wingman(p1, 515, 500, host.zoneById(5));
  assert.equal(p1.addScout(scout), true);
  assert.equal(p1.addWingman(wingman), true);
  p1.ships.main.resetAttackCycle(0);
  scout.resetAttackCycle(0);
  wingman.resetAttackCycle(0);

  const viewP1 = host.hostileView("P1");
  p1.computeVisibility(viewP1);
  assert.equal(p1.visibleEnemyIds.has(p3.ships.main.id), true);
  assert.equal(p1.visibleEnemyIds.has(p4.ships.main.id), true);

  const candidates = p1.fireCandidates(p1.ships.main, viewP1);
  const candidateIds = candidates.map((entry) => entry.target.id);
  assert.deepEqual(candidateIds, [p3.ships.main.id, p4.ships.main.id], "候选应按 seatOrder 包含 P3 与 P4 且无重复");
  assert.equal(p1.pickTargetFor(p1.ships.main, viewP1), p4.ships.main, "普通模式应在完整敌对候选中选中更近的 P4 主舰");

  // 一次 stepCombat：主舰、僚机、侦察机各自只发射 1 次，不能按敌队数量放大为 2 次
  p1.stepCombat(viewP1);
  assert.equal(host.spawnedProjectiles.length, 3, "一次齐射主舰/僚机/侦察机各发射一次，总共 3 发");
  assert.deepEqual(
    host.spawnedProjectiles.map((shot) => shot.source),
    [p1.ships.main, wingman, scout],
    "必须保持船体 → 僚机 → 侦察机既有执行顺序",
  );
  assert.equal(p1.ships.main.cooldown > 0, true, "开火后必须提交一次武器冷却");
  assert.equal(wingman.cooldown > 0, true);
  assert.equal(scout.cooldown > 0, true);

  // 同帧冷却未结束时再执行一次 stepCombat 不得额外发射
  p1.stepCombat(viewP1);
  assert.equal(host.spawnedProjectiles.length, 3, "冷却中不得重复发射");

  // 等距平局按 seatOrder 稳定选择先注册的 P3
  placeShip(p3.ships.main, 600, 500, Math.PI);
  placeShip(p4.ships.main, 600, 500, Math.PI);
  assert.equal(p1.pickTargetFor(p1.ships.main, viewP1), p3.ships.main, "等距平局应按 seatOrder 稳定选出 P3");

  // 极限集火跨多敌队生效：P3 主舰残血时，即便 P4 更近也优先选 P3，且仍只发射一次
  placeShip(p3.ships.main, 650, 500, Math.PI);
  placeShip(p4.ships.main, 580, 500, Math.PI);
  p3.ships.main.takeDamage(p3.ships.main.maxHp * 0.7, null, host);
  p1.configureAiHandicap({ focusLowHp: true, statMult: 1 });
  p1.ships.main.resetAttackCycle(0);
  const beforeCount = host.spawnedProjectiles.length;
  p1.stepCombat(viewP1);
  assert.equal(host.spawnedProjectiles.length, beforeCount + 1, "集火模式下主舰仍只发射一次");
  assert.equal(p1.pickTargetFor(p1.ships.main, viewP1), p3.ships.main, "残血集火可跨敌队选中低血目标");
}

// =========================================================================
// 更近盟友不进入敌对候选、不被敌对弹体误伤，多敌队均可合法命中
// =========================================================================
{
  const fourTopology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", 0),
      makeFleetConfig("P2", "side1", 1),
      makeFleetConfig("P3", "side2", 2),
      makeFleetConfig("P4", "side2", 3),
    ],
  });
  const { host, teams } = createMultiFleetHost(fourTopology, { seed: 312 });
  const [p1, p2, p3, p4] = teams;
  for (const team of teams) team.configureFormation(2);

  placeShip(p1.ships.main, 500, 500, 0);
  placeShip(p2.ships.main, 520, 500, 0); // 更近的盟友
  placeShip(p3.ships.main, 620, 500, Math.PI); // 合法敌人 1
  placeShip(p4.ships.main, 640, 500, Math.PI); // 合法敌人 2（在视野与射程内）
  for (const team of teams) {
    placeShip(team.ships.sub1, 1350, 100 + teams.indexOf(team) * 30, 0);
    placeShip(team.ships.sub2, 1350, 300 + teams.indexOf(team) * 30, 0);
  }

  const viewP1 = host.hostileView("P1");
  p1.computeVisibility(viewP1);
  assert.equal(p1.visibleEnemyIds.has(p2.ships.main.id), false, "盟友不得进入可见敌集");
  assert.equal(p1.visibleEnemyIds.has(p3.ships.main.id), true);
  assert.equal(p1.visibleEnemyIds.has(p4.ships.main.id), true);

  const candidates = p1.fireCandidates(p1.ships.main, viewP1);
  assert.equal(candidates.some((entry) => entry.target.team === p2), false, "盟友不得进入敌对候选");
  assert.equal(p1.pickTargetFor(p1.ships.main, viewP1), p3.ships.main, "更近盟友被排除，应命中合法敌人 P3");

  // 弹体直射盟友中心：不得造成伤害
  const p2HpBefore = p2.ships.main.hp;
  const allyShot = new Projectile({
    team: p1,
    source: p1.ships.main,
    x: p2.ships.main.x,
    y: p2.ships.main.y,
    targetX: p2.ships.main.x,
    targetY: p2.ships.main.y,
    damage: 40,
    hitRadius: 12,
  });
  allyShot.resolveImpact(host);
  assert.equal(p2.ships.main.hp, p2HpBefore, "盟友不得被敌对弹体结算命中");

  // 盟友与敌人重叠在落点时，跳过盟友并命中敌人 P3
  placeShip(p3.ships.main, p2.ships.main.x + 4, p2.ships.main.y, Math.PI);
  const p3HpBefore = p3.ships.main.hp;
  const overlapShot = new Projectile({
    team: p1,
    source: p1.ships.main,
    x: p2.ships.main.x,
    y: p2.ships.main.y,
    targetX: p2.ships.main.x,
    targetY: p2.ships.main.y,
    damage: 40,
    hitRadius: 12,
  });
  overlapShot.resolveImpact(host);
  assert.equal(p2.ships.main.hp, p2HpBefore, "重叠时盟友依然免疫敌对弹体结算");
  assert.equal(p3.ships.main.hp < p3HpBefore, true, "重叠时合法敌人 P3 应正常承伤");

  // 落点命中第二支敌方舰队 P4（验证不漏掉第三/第四舰队）
  const p4HpBefore = p4.ships.main.hp;
  const p4Shot = new Projectile({
    team: p1,
    source: p1.ships.main,
    x: p4.ships.main.x,
    y: p4.ships.main.y,
    targetX: p4.ships.main.x,
    targetY: p4.ships.main.y,
    damage: 35,
    hitRadius: 10,
  });
  p4Shot.resolveImpact(host);
  assert.equal(p4.ships.main.hp < p4HpBefore, true, "第二支敌对舰队 P4 必须正常被弹体命中");
}

// =========================================================================
// 无普通视野（含仅有猎杀标记/同阵营队友视野）不放行盲射；恢复普通视野后可选中
// =========================================================================
{
  const fourTopology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", 0),
      makeFleetConfig("P2", "side1", 1),
      makeFleetConfig("P3", "side2", 2),
      makeFleetConfig("P4", "side2", 3),
    ],
  });
  const { host, teams } = createMultiFleetHost(fourTopology, { seed: 313 });
  const [p1, p2, p3, p4] = teams;
  for (const team of teams) team.configureFormation(2);

  // 把 P1 与 P3 放在 P1 射程内但隔离 P1 传感器，同时让盟友 P2 贴近 P3 建立 P2 视野
  placeShip(p1.ships.main, 500, 500, 0);
  placeShip(p1.ships.sub1, 100, 100, 0);
  placeShip(p1.ships.sub2, 100, 140, 0);
  placeShip(p3.ships.main, 620, 500, Math.PI);
  placeShip(p3.ships.sub1, 1300, 1200, Math.PI);
  placeShip(p3.ships.sub2, 1300, 1240, Math.PI);
  placeShip(p2.ships.main, 625, 500, 0); // 盟友 P2 可看到 P3
  placeShip(p2.ships.sub1, 100, 1200, 0);
  placeShip(p2.ships.sub2, 100, 1240, 0);
  placeShip(p4.ships.main, 1350, 1350, Math.PI);
  placeShip(p4.ships.sub1, 1350, 1320, Math.PI);
  placeShip(p4.ships.sub2, 1350, 1290, Math.PI);

  const origP1Vision = p1.getVisionSources.bind(p1);
  p1.getVisionSources = () => []; // 隔离 P1 常规传感器
  // 同时模拟存在猎杀标记指向 P3 主舰
  const origRules = host.rules;
  host.rules = Object.freeze({
    ...origRules,
    preferredTargetId: (team) => (team === p1 ? p3.ships.main.id : null),
  });

  p2.computeVisibility(host.hostileView("P2"));
  p1.computeVisibility(host.hostileView("P1"));
  assert.equal(p2.visibleEnemyIds.has(p3.ships.main.id), true, "盟友 P2 应能靠自身传感器看见 P3");
  assert.equal(p1.visibleEnemyIds.has(p3.ships.main.id), false, "同阵营不默认共享普通视野");

  assert.equal(p1.fireCandidates(p1.ships.main, host.hostileView("P1")).length, 0, "仅有猎杀标记和盟友视野不得放行盲射");
  assert.equal(p1.pickTargetFor(p1.ships.main, host.hostileView("P1")), null);
  p1.ships.main.resetAttackCycle(0);
  p1.stepCombat(host.hostileView("P1"));
  assert.equal(host.spawnedProjectiles.length, 0, "无真实视野时 stepCombat 不得开火");

  // 恢复本舰队普通视野后可以合法选中并开火
  p1.getVisionSources = origP1Vision;
  p1.computeVisibility(host.hostileView("P1"));
  assert.equal(p1.visibleEnemyIds.has(p3.ships.main.id), true);
  assert.equal(p1.pickTargetFor(p1.ships.main, host.hostileView("P1")), p3.ships.main, "恢复普通视野后应可选中 P3 主舰");
  p1.stepCombat(host.hostileView("P1"));
  assert.equal(host.spawnedProjectiles.length, 1, "恢复普通视野后正常开火");
}

// =========================================================================
// 合法转队或消灭目标后即时读取当前资格，旧数组不影响新判断
// =========================================================================
{
  const fourTopology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", 0),
      makeFleetConfig("P2", "side1", 1),
      makeFleetConfig("P3", "side2", 2),
      makeFleetConfig("P4", "side2", 3),
    ],
  });
  const { host, teams } = createMultiFleetHost(fourTopology, { seed: 314 });
  const [p1, p2, p3, p4] = teams;
  for (const team of teams) team.configureFormation(2);

  placeShip(p1.ships.main, 500, 500, 0);
  placeShip(p3.ships.main, 1200, 1200, Math.PI);
  placeShip(p4.ships.main, 580, 500, Math.PI);

  const auxToSelf = new Ship(p3, "aux_self", 540, 500, 0, { characterId: "kyon", isAuxiliary: true });
  const auxToAlly = new Ship(p3, "aux_ally", 550, 500, 0, { characterId: "kyon", isAuxiliary: true });
  assert.equal(p3.addAuxiliaryShip(auxToSelf), true);
  assert.equal(p3.addAuxiliaryShip(auxToAlly), true);

  const viewP1 = host.hostileView("P1");
  const snapshotBefore = viewP1.getEntities();
  assert.equal(snapshotBefore.includes(auxToSelf), true);
  assert.equal(snapshotBefore.includes(auxToAlly), true);
  assert.equal(snapshotBefore.includes(p4.ships.main), true);

  // 合法事务转移：一个转给己方 P1，一个转给盟友 P2
  assert.equal(auxToSelf.transferToTeam(p1), true);
  assert.equal(auxToAlly.transferToTeam(p2), true);

  const afterTransfer = viewP1.getEntities();
  assert.equal(afterTransfer.includes(auxToSelf), false, "转归己方后必须立即从敌对视图消失");
  assert.equal(afterTransfer.includes(auxToAlly), false, "转归盟友后必须立即从敌对视图消失");
  assert.equal(snapshotBefore.includes(auxToSelf), true, "历史数组样本不得被新采样修改");

  p1.computeVisibility(viewP1);
  assert.equal(p1.visibleEnemyIds.has(auxToSelf.id), false);
  assert.equal(p1.visibleEnemyIds.has(auxToAlly.id), false);

  const auxSelfHp = auxToSelf.hp;
  const auxAllyHp = auxToAlly.hp;
  new Projectile({
    team: p1, source: p1.ships.main,
    x: auxToSelf.x, y: auxToSelf.y, targetX: auxToSelf.x, targetY: auxToSelf.y,
    damage: 50, hitRadius: 8,
  }).resolveImpact(host);
  new Projectile({
    team: p1, source: p1.ships.main,
    x: auxToAlly.x, y: auxToAlly.y, targetX: auxToAlly.x, targetY: auxToAlly.y,
    damage: 50, hitRadius: 8,
  }).resolveImpact(host);
  assert.equal(auxToSelf.hp, auxSelfHp, "不得攻击已转归己方的目标");
  assert.equal(auxToAlly.hp, auxAllyHp, "不得攻击已转归盟友的目标");

  // 合法消灭 P4 主舰后立即退出敌对视图与选敌
  p4.ships.main.takeDamage(99999, p1.ships.main, host);
  assert.equal(p4.ships.main.alive, false);
  assert.equal(viewP1.getEntities().includes(p4.ships.main), false, "死亡目标不得继续留在敌对视图");
  p1.computeVisibility(viewP1);
  assert.equal(p1.fireCandidates(p1.ships.main, viewP1).some((c) => c.target === p4.ships.main), false);
}

// =========================================================================
// 六舰队船体碰撞与敌对侦察机碰撞——无重复碰撞减速、无双向重复扣血
// =========================================================================
{
  const sixTopology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", 0),
      makeFleetConfig("P2", "side1", 1),
      makeFleetConfig("P3", "side1", 2),
      makeFleetConfig("P4", "side2", 3),
      makeFleetConfig("P5", "side2", 4),
      makeFleetConfig("P6", "side2", 5),
    ],
  });
  const { host, teams, registry } = createMultiFleetHost(sixTopology, { seed: 315 });
  const [p1, p2, p3, p4, p5, p6] = teams;
  for (const team of teams) {
    team.configureFormation(2);
    // 先把所有副舰散开避免干扰
    const idx = teams.indexOf(team);
    placeShip(team.ships.sub1, 100 + idx * 120, 1200, 0);
    placeShip(team.ships.sub2, 100 + idx * 120, 1320, 0);
  }

  // 三组相邻船体：P1-P4 重叠、P2-P5 重叠、P3-P6 重叠
  placeShip(p1.ships.main, 300, 300, 0);
  placeShip(p4.ships.main, 304, 300, Math.PI);
  placeShip(p2.ships.main, 600, 300, 0);
  placeShip(p5.ships.main, 604, 300, Math.PI);
  placeShip(p3.ships.main, 900, 300, 0);
  placeShip(p6.ships.main, 904, 300, Math.PI);

  const hullSystem = new HullCollisionSystem();
  const resolveSixHulls = (elapsed) => {
    hullSystem.resolve({
      ships: registry.allTeams()
        .flatMap((team) => team.getAllShips())
        .filter((ship) => ship.alive)
        .map((ship) => createHullCollisionPort(ship, host.rules)),
      elapsed,
    });
  };

  resolveSixHulls(10);
  for (const [left, right] of [[p1.ships.main, p4.ships.main], [p2.ships.main, p5.ships.main], [p3.ships.main, p6.ships.main]]) {
    assert.ok(right.x - left.x >= left.radius + right.radius - 1e-6, "重叠船体应被推开解除重叠");
    assert.equal(left.collisionSlowUntil, 10 + COLLISION_SLOW_DURATION, "首次碰撞应施加一次减速");
    assert.equal(right.collisionSlowUntil, 10 + COLLISION_SLOW_DURATION, "首次碰撞双方均只施加一次减速");
  }

  // 下一帧持续接触不得重复续上减速
  placeShip(p1.ships.main, 300, 300, 0);
  placeShip(p4.ships.main, 304, 300, Math.PI);
  resolveSixHulls(11);
  assert.equal(p1.ships.main.collisionSlowUntil, 10 + COLLISION_SLOW_DURATION, "持续接触下一帧不得重复施加碰撞减速");
  assert.equal(p4.ships.main.collisionSlowUntil, 10 + COLLISION_SLOW_DURATION);

  // 六舰队侦察机相撞：复用真实 BattleRuntime.prototype.resolveScoutClashes
  const allyScout1 = new Scout(p1, 200, 600, { zone: host.zoneById(4) });
  const allyScout2 = new Scout(p2, 200, 600, { zone: host.zoneById(4) });
  const clashLeft = new Scout(p1, 500, 600, { zone: host.zoneById(5) });
  const clashRight = new Scout(p4, 500, 600, { zone: host.zoneById(5) });
  const multiSide1 = new Scout(p2, 800, 600, { zone: host.zoneById(6) });
  const multiSide2A = new Scout(p5, 800, 600, { zone: host.zoneById(6) });
  const multiSide2B = new Scout(p6, 800, 600, { zone: host.zoneById(6) });

  assert.equal(p1.addScout(allyScout1), true);
  assert.equal(p2.addScout(allyScout2), true);
  assert.equal(p1.addScout(clashLeft), true);
  assert.equal(p4.addScout(clashRight), true);
  assert.equal(p2.addScout(multiSide1), true);
  assert.equal(p5.addScout(multiSide2A), true);
  assert.equal(p6.addScout(multiSide2B), true);

  const damageCalls = new Map();
  for (const s of [allyScout1, allyScout2, clashLeft, clashRight, multiSide1, multiSide2A, multiSide2B]) {
    const orig = s.takeDamage.bind(s);
    damageCalls.set(s, 0);
    s.takeDamage = (...args) => {
      damageCalls.set(s, damageCalls.get(s) + 1);
      return orig(...args);
    };
  }

  BattleRuntime.prototype.resolveScoutClashes.call(host);

  assert.equal(allyScout1.alive, true, "同阵营不同舰队侦察机不得相撞");
  assert.equal(allyScout2.alive, true);
  assert.equal(damageCalls.get(allyScout1), 0);
  assert.equal(damageCalls.get(allyScout2), 0);

  assert.equal(clashLeft.alive, false, "敌对侦察机相撞应互毁");
  assert.equal(clashRight.alive, false);
  assert.equal(damageCalls.get(clashLeft), 1, "无序敌对对每架侦察机只扣血一次，不得双向重复扣血");
  assert.equal(damageCalls.get(clashRight), 1);

  assert.equal(multiSide1.alive, false);
  assert.equal(multiSide2A.alive, false);
  assert.equal(multiSide2B.alive, true, "先与 P5 互毁后的 P2 侦察机不得再伤害 P6，且 P5/P6 同阵营不互撞");
  assert.equal(damageCalls.get(multiSide1), 1);
  assert.equal(damageCalls.get(multiSide2A), 1);
  assert.equal(damageCalls.get(multiSide2B), 0);
}

// =========================================================================
// 同舰队附着免碰撞 vs 同阵营跨舰队仍碰撞（不混同）
// =========================================================================
{
  const fourTopology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", 0),
      makeFleetConfig("P2", "side1", 1),
      makeFleetConfig("P3", "side2", 2),
      makeFleetConfig("P4", "side2", 3),
    ],
  });
  const { host, teams, registry } = createMultiFleetHost(fourTopology, { seed: 316 });
  const [p1, p2, p3, p4] = teams;

  // 保持 P1、P2 为 splitLevel === 0（附着编队状态）
  assert.equal(p1.splitLevel, 0);
  assert.equal(p2.splitLevel, 0);
  assert.equal(p1.ships.sub1.isAttached(), true);
  assert.equal(p2.ships.sub1.isAttached(), true);

  // 把 P3/P4 移远
  placeShip(p3.ships.main, 1300, 200, Math.PI);
  placeShip(p3.ships.sub1, 1300, 260, Math.PI);
  placeShip(p3.ships.sub2, 1300, 320, Math.PI);
  placeShip(p4.ships.main, 1300, 1200, Math.PI);
  placeShip(p4.ships.sub1, 1300, 1260, Math.PI);
  placeShip(p4.ships.sub2, 1300, 1320, Math.PI);

  // 组 1：同舰队附着（P1.main 与 P1.sub1 重叠）
  placeShip(p1.ships.main, 300, 300, 0);
  placeShip(p1.ships.sub1, 303, 300, 0);
  // 组 2：同阵营跨舰队（P1.sub2 与同方盟友 P2.main 重叠，即使二者都在各自附着编队中）
  placeShip(p1.ships.sub2, 700, 700, 0);
  placeShip(p2.ships.main, 704, 700, 0);
  placeShip(p2.ships.sub1, 704, 820, 0);
  placeShip(p2.ships.sub2, 704, 920, 0);

  const hullSystem = new HullCollisionSystem();
  hullSystem.resolve({
    ships: registry.allTeams()
      .flatMap((team) => team.getAllShips())
      .filter((ship) => ship.alive)
      .map((ship) => createHullCollisionPort(ship, host.rules)),
    elapsed: 5,
  });

  // 同舰队附着保持原免碰撞
  assert.equal(p1.ships.main.x, 300, "同舰队附着主副舰保持免碰撞不位移");
  assert.equal(p1.ships.sub1.x, 303);
  assert.equal(p1.ships.main.collisionSlowUntil, 0);
  assert.equal(p1.ships.sub1.collisionSlowUntil, 0);

  // 同阵营跨舰队正常碰撞，不享受另一舰队的附着免碰撞
  assert.ok(p2.ships.main.x - p1.ships.sub2.x >= p1.ships.sub2.radius + p2.ships.main.radius - 1e-6, "同阵营跨舰队船体应正常碰撞推开");
  assert.equal(p1.ships.sub2.collisionSlowUntil, 5 + COLLISION_SLOW_DURATION);
  assert.equal(p2.ships.main.collisionSlowUntil, 5 + COLLISION_SLOW_DURATION);
}

// =========================================================================
// 舰队所有权回归断言 & 默认 A/B 精确兼容
// =========================================================================
{
  const fourTopology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", 0),
      makeFleetConfig("P2", "side1", 1),
      makeFleetConfig("P3", "side2", 2),
      makeFleetConfig("P4", "side2", 3),
    ],
  });
  const { host, teams } = createMultiFleetHost(fourTopology, { seed: 317 });
  const [p1, p2, p3] = teams;

  // aircraft-port.js：owns 仅校验同舰队归属（entity.team === team）
  const p2Scout = new Scout(p2, 400, 400, { zone: host.zoneById(5) });
  assert.equal(p2.addScout(p2Scout), true);
  assert.equal(p1.addScout(p2Scout), false, "未转队前盟友舰队不得接收另一舰队侦察机");
  assert.equal(p1.assignScoutMission(p2Scout, { zoneId: 1 }), false, "同阵营另一舰队不得指挥盟友侦察机");
  p1.removeScout(p2Scout);
  assert.equal(p2.scouts.includes(p2Scout), true, "同阵营另一舰队调用移除不得影响盟友侦察机集合");

  // fleet-roster.js：同 Team 归属校验
  const p2Aux = new Ship(p2, "p2_aux", 420, 420, 0, { characterId: "kyon", isAuxiliary: true });
  assert.equal(p1.addAuxiliaryShip(p2Aux), false, "未转队前盟友舰队不得接收另一舰队的额外舰");
  assert.equal(p2.addAuxiliaryShip(p2Aux), true);

  // team.js：fleetMembersForShip 编队成员与能量扣费保持本舰队
  assert.deepEqual(
    p1.fleetMembersForShip(p1.ships.main),
    [p1.ships.main, p1.ships.sub1, p1.ships.sub2],
    "编队成员必须限定本舰队，不得混入同阵营盟友",
  );
  const p2EnergyBefore = p2.availableEnergyForShip("main");
  assert.equal(p1.spendEnergyForShip("main", 20), true);
  assert.equal(p2.availableEnergyForShip("main"), p2EnergyBefore, "本舰队扣能不得影响同阵营盟友");

  // ship-combat-port.js：承伤分摊、舰损归属与战损编队保持本舰队
  const p2MainHpBefore = p2.ships.main.hp;
  const p1Sub1HpBefore = p1.ships.sub1.hp;
  const p1Sub2HpBefore = p1.ships.sub2.hp;
  p1.ships.main.takeDamage(100, p3.ships.main, host);
  assert.equal(p1.ships.sub1.hp < p1Sub1HpBefore, true, "本舰队附着副舰正常分摊伤害");
  assert.equal(p1.ships.sub2.hp < p1Sub2HpBefore, true);
  assert.equal(p2.ships.main.hp, p2MainHpBefore, "同阵营盟友不得参与本舰队编队伤害分摊");

  p1.ships.main.takeDamage(99999, p3.ships.main, host);
  assert.deepEqual(host.recordedShipLosses, ["P1", "P1", "P1"], "附着分摊击沉的舰损全部只记入受击舰队 P1，不记入盟友 P2");
  assert.equal(p2.ships.main.alive && p2.ships.sub1.alive && p2.ships.sub2.alive, true, "盟友 P2 全部舰船保持存活不受波及");
  assert.equal(p2.splitLevel, 0, "P1 主舰战损不得改变盟友 P2 的编队分离层级");

  // 默认 A/B 与等价显式 A/B 逐 tick 状态、随机消费、碰撞与弹体精确一致
  const spawns = defaultLegacySpawns(DEFAULT_WORLD_SIZE);
  const implicitMatch = new MatchSimulation({ mode: "pvp", seed: 777 });
  const explicitMatch = new MatchSimulation({
    mode: "pvp",
    seed: 777,
    fleets: [
      {
        seat: "A",
        sideId: "side1",
        name: implicitMatch.teamA.name,
        loadout: { ...implicitMatch.teamA.loadout },
        spawn: spawns.A,
      },
      {
        seat: "B",
        sideId: "side2",
        name: implicitMatch.teamB.name,
        loadout: { ...implicitMatch.teamB.loadout },
        spawn: spawns.B,
      },
    ],
  });

  for (const sim of [implicitMatch, explicitMatch]) {
    sim.applyActionForSeat("A", { type: "split", level: 1 });
    sim.applyActionForSeat("B", { type: "split", level: 1 });
    sim.applyActionForSeat("A", { type: "set_route", shipKey: "main", endX: 700, endY: 700, throttle: 3 });
    sim.applyActionForSeat("B", { type: "set_route", shipKey: "main", endX: 700, endY: 700, throttle: 3 });
    sim.applyActionForSeat("A", { type: "launch_scout", shipKey: "main", zoneId: 5 });
    sim.applyActionForSeat("B", { type: "launch_scout", shipKey: "main", zoneId: 5 });
  }

  for (let tick = 0; tick < 180; tick += 1) {
    implicitMatch.update(TICK_DT);
    explicitMatch.update(TICK_DT);
    assert.deepEqual(explicitMatch.serializeState(), implicitMatch.serializeState(), `第 ${tick + 1} 帧 A/B 状态必须完全一致`);
  }
  assert.deepEqual(explicitMatch.statisticsSummary(), implicitMatch.statisticsSummary(), "A/B 统计摘要必须完全一致");
  assert.equal(explicitMatch.rng.next(), implicitMatch.rng.next(), "主随机流消费必须完全一致");
  assert.equal(explicitMatch.aiRng.A.next(), implicitMatch.aiRng.A.next(), "A 席 AI 随机流消费必须完全一致");
  assert.equal(explicitMatch.aiRng.B.next(), implicitMatch.aiRng.B.next(), "B 席 AI 随机流消费必须完全一致");
}

console.log("多舰队普通战斗校验通过（敌对集合视图、选敌命中、视野、碰撞与舰队所有权回归全部通过）。");
