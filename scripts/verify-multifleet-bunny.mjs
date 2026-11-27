import assert from "node:assert/strict";
import {
  DEFAULT_WORLD_SIZE,
  MatchSimulation,
  TICK_DT,
  __resetEntityIds,
} from "../shared/game-core.js";
import { createSeededRng } from "../shared/game/foundation/rng.js";
import { buildZones, clamp } from "../shared/game/foundation/math.js";
import { CHARACTER_ASSEMBLY } from "../shared/game/characters/assembly/character-assembly.js";
import { Team } from "../shared/game/model/team.js";
import { Scout } from "../shared/game/model/scout.js";
import { Wingman } from "../shared/game/model/wingman.js";
import { Projectile } from "../shared/game/model/projectile.js";
import { ProjectileSystem } from "../shared/game/systems/projectile-system.js";
import { nextEntityId } from "../shared/game/model/model-support.js";
import { normalizeMatchTopology } from "../shared/game/runtime/match-topology.js";
import { createFleetRegistry } from "../shared/game/runtime/fleet-registry.js";
import { createMatchFeedback } from "../shared/game/runtime/match-feedback.js";
import { createHostileView } from "../shared/game/adapters/combat-targets.js";
import { resolveShipDestruction } from "../shared/game/characters/interactions/ship-destruction.js";
import { convertZoneSupport } from "../shared/game/characters/interactions/support-conversion.js";
import {
  BUNNY_HARUHI_CONFIG as C,
} from "../shared/game/characters/bunny-haruhi/config.js";
import {
  createBunnyStageExposure,
  resolveBunnyStageExposure,
  selectBunnyStageSource,
} from "../shared/game/characters/bunny-haruhi/rules.js";
import {
  createBunnyCompanionState,
  bunnyOwnerDamageBlocked,
} from "../shared/game/characters/bunny-haruhi/companion-rules.js";
import { BunnyStageRuntime } from "../shared/game/characters/bunny-haruhi/stage-runtime.js";
import {
  initializeBunnyBattle,
  resolveBunnyStages,
  advanceBunnyRules,
  cleanupBunnySources,
  cleanseBunnyShipControl,
  bunnyStageEnabled,
  sampleBunnyStages,
  bunnyStageSourceInfo,
} from "../shared/game/characters/bunny-haruhi/stage-port.js";
import {
  bunnyCompanions,
  bunnyCompanionOwner,
  bunnyCompanionForm,
  bunnyReliableState,
  convertBunnyCompanion,
  prepareBunnyCompanions,
  cleanupBunnyCompanions,
} from "../shared/game/characters/bunny-haruhi/companion-runtime.js";
import {
  refreshBunnyVisibility,
} from "../shared/game/characters/bunny-haruhi/form-port.js";
import {
  serializeBunnyShip,
  projectBunnyStageExposureSource,
  projectBunnyCompanionOwnership,
} from "../shared/game/characters/bunny-haruhi/projection.js";
import { projectTeam } from "../shared/game/projection/team-projection.js";
import { ScenarioSimulation, sampleScenarioTime } from "./core-tests/scenario-simulation.mjs";
import { setScenarioField } from "./core-tests/ship-fixture.mjs";
import { sampleVisibility } from "./core-tests/visibility-fixture.mjs";

const near = (a, b, eps = 1e-7) => assert.ok(Math.abs(a - b) < eps, `${a} 应接近 ${b}`);

function makeFleetConfig(seat, sideId, loadout, spawn) {
  return {
    seat,
    sideId,
    name: `舰队_${seat}`,
    loadout,
    spawn,
  };
}

// 多舰队兔女郎测试宿主：复用真实 Team/Ship/Scout/Wingman/Projectile/角色运行时，不绕过生产开局校验。
function createMultiFleetBunnyHost(topology, { seed = 501 } = {}) {
  const worldSize = DEFAULT_WORLD_SIZE;
  const zones = buildZones(worldSize);
  const rng = createSeededRng(seed);
  const projectiles = new ProjectileSystem((profile) => new Projectile(profile));
  const recordedActions = [];
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
    recordedActions,
    recordedAttacks,
    recordedDamage,
    recordedShipLosses,
    floatingTexts,
    bursts,
    get projectiles() {
      return projectiles.items;
    },
    clampX(x, padding = 0) { return clamp(x, padding, worldSize - padding); },
    clampY(y, padding = 0) { return clamp(y, padding, worldSize - padding); },
    zoneById(zoneId) {
      const safeId = clamp(Number(zoneId) || 5, 1, 9);
      return zones.find((zone) => zone.id === safeId) || zones[4];
    },
    recordAction(seat, action) {
      recordedActions.push({ seat, action });
    },
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
      return projectiles.spawn(profile);
    },
    discardProjectilesFrom(sourceId) {
      projectiles.discardFrom(sourceId);
    },
    serializeTeams() {
      return Object.fromEntries(host.allTeams().map((team) => [team.seat, projectTeam(team)]));
    },
  };

  const feedback = createMatchFeedback({
    now: () => host.elapsed,
    nextId: () => nextEntityId(host),
  });
  host.onShipDestroyed = (ship) => resolveShipDestruction(host, ship, feedback);

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

  for (const team of teams) {
    team.configureFormation(2);
    for (const ship of team.getPlayerShips()) {
      ship.followTarget({ x: ship.x, y: ship.y });
      setScenarioField(ship, "throttle", 0);
    }
  }

  if (initializeBunnyBattle(host)) {
    resolveBunnyStages(host);
    refreshBunnyVisibility(host);
  }
  return host;
}

function advanceTime(host, elapsed, tick = Math.round(elapsed * 30)) {
  host.elapsed = elapsed;
  host.tick = tick;
}

function spawnCompanionForTeam(team, slotKey = "sub1") {
  const owner = team.ships[slotKey];
  for (let i = 0; i < 4; i += 1) {
    owner.restoreHull(owner.maxHp);
    team.startCooldown(slotKey, 0);
    assert.equal(team.castSubSkill(slotKey), true);
  }
  const companion = team.extraShips.find((ship) => ship.id === owner.bunnyHaruhi.companionId);
  assert.ok(companion, "第四次变身必须生成伴随舰");
  return { owner, companion };
}

function placeInZone(entity, zone, offsetX = 60, offsetY = 60) {
  setScenarioField(entity, "x", zone.x + offsetX);
  setScenarioField(entity, "y", zone.y + offsetY);
}

// 1. P1 伴随舰被敌方 P3 策反与归还：成员集合唯一、阵营随 Team 派生、ownerSeat 保持 P1
function verifyCompanionConversionAndReturn() {
  const topology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", { main: "kyon", sub1: "bunny_haruhi", sub2: "yuki" }, { x: 250, y: 300, facing: 0 }),
      makeFleetConfig("P2", "side1", { main: "haruhi", sub1: "tsuruya", sub2: "future1096" }, { x: 250, y: 1100, facing: 0 }),
      makeFleetConfig("P3", "side2", { main: "shamisen", sub1: "tsuruya", sub2: "asakura" }, { x: 1250, y: 300, facing: Math.PI }),
      makeFleetConfig("P4", "side2", { main: "koizumi", sub1: "tsuruya", sub2: "future1096" }, { x: 1250, y: 1100, facing: Math.PI }),
    ],
  });
  const host = createMultiFleetBunnyHost(topology, { seed: 511 });
  const teamP1 = host.teamBySeat("P1");
  const teamP3 = host.teamBySeat("P3");

  // 注册席位校验：允许本局注册席位，拒绝未注册席位与原型键
  const validState = createBunnyCompanionState(11, "P1", 0, host.seatOrder);
  assert.equal(validState.ownerSeat, "P1");
  assert.throws(() => createBunnyCompanionState(11, "A", 0, host.seatOrder), RangeError);
  assert.throws(() => createBunnyCompanionState(11, "toString", 0, host.seatOrder), RangeError);
  assert.throws(() => createBunnyCompanionState(11, "P5", 0, host.seatOrder), RangeError);

  const { owner, companion } = spawnCompanionForTeam(teamP1);
  assert.equal(companion.bunnyCompanion.ownerSeat, "P1");
  assert.equal(companion.bunnyCompanion.ownerShipId, owner.id);
  assert.equal(companion.team, teamP1);
  assert.equal(companion.team.sideId, "side1");

  // 触发一次可靠技能再由 P3 策反
  advanceTime(host, 20, 600);
  prepareBunnyCompanions(host);
  assert.ok(owner.bunnyReliable && companion.bunnyReliable);

  const zone = host.zoneById(5);
  placeInZone(companion, zone, 80, 80);
  const scoutP1 = new Scout(teamP1, zone.x + 120, zone.y + 120, { zone });
  teamP1.addScout(scoutP1);
  const wingmanP2 = new Wingman(host.teamBySeat("P2"), zone.x + 140, zone.y + 140, zone);
  host.teamBySeat("P2").addWingman(wingmanP2);
  // 敌方盟友 P4 的侦察机不得被 P3 误策反
  const scoutP4 = new Scout(host.teamBySeat("P4"), zone.x + 160, zone.y + 160, { zone });
  host.teamBySeat("P4").addScout(scoutP4);

  host.spawnProjectile({ team: teamP1, source: companion });
  host.spawnProjectile({ team: teamP1, source: owner });

  assert.equal(convertZoneSupport(teamP3.ships.sub1, 5), true);
  assert.equal(companion.team, teamP3);
  assert.equal(companion.team.sideId, "side2", "伴随舰实时阵营必须跟随当前 Team");
  assert.equal(companion.bunnyCompanion.ownerSeat, "P1", "策反不得改写永久母舰席位");
  assert.equal(companion.bunnyCompanion.ownerShipId, owner.id, "策反不得改写永久母舰实体 ID");
  assert.equal(companion.bunnyCompanion.convertedUntil, 25);
  assert.equal(teamP1.extraShips.includes(companion), false);
  assert.equal(teamP3.extraShips.filter((s) => s === companion).length, 1);
  assert.equal(bunnyCompanions(host).filter((s) => s === companion).length, 1);
  assert.equal(owner.bunnyReliable, undefined, "策反必须清除母舰上的来源增益");
  assert.equal(companion.bunnyReliable, undefined, "策反必须清除伴随舰上的来源增益");
  assert.equal(host.projectiles.some((p) => p.sourceId === companion.id), false, "策反必须清除伴随舰旧弹体");
  assert.equal(host.projectiles.some((p) => p.sourceId === owner.id), true, "策反不得误清母舰弹体");

  // 普通飞行器多敌队收集与去重、同阵营豁免
  assert.equal(scoutP1.team, teamP3);
  assert.equal(wingmanP2.team, teamP3);
  assert.equal(scoutP4.team, host.teamBySeat("P4"), "同阵营盟友的侦察机不得被策反");

  // 伴随舰只读归属读模型与旧快照字段
  const ownership = projectBunnyCompanionOwnership(companion);
  assert.ok(Object.isFrozen(ownership));
  assert.equal(ownership.ownerSeat, "P1");
  assert.equal(ownership.ownerSideId, "side1");
  assert.equal(ownership.currentSeat, "P3");
  assert.equal(ownership.currentSideId, "side2");
  assert.equal(ownership.converted, true);
  assert.equal(ownership.sameOwnerTeam, false);
  assert.equal(serializeBunnyShip(owner).bunnyHaruhi.companion.teamSeat, "P3");

  // 到期归还原母舰 P1
  advanceTime(host, 25, 750);
  prepareBunnyCompanions(host);
  assert.equal(companion.team, teamP1);
  assert.equal(companion.team.sideId, "side1");
  assert.equal(companion.bunnyCompanion.convertedUntil, 0);
  assert.equal(teamP3.extraShips.includes(companion), false);
  assert.equal(teamP1.extraShips.filter((s) => s === companion).length, 1);
  assert.equal(projectBunnyCompanionOwnership(companion).sameOwnerTeam, true);
}

// 2. 原母舰盟友 P2 与原母舰 P1 分别夺回伴随舰 + 所有权不变回归
function verifyAllyVsOwnerRecaptureAndOwnership() {
  const topology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", { main: "kyon", sub1: "bunny_haruhi", sub2: "tsuruya" }, { x: 250, y: 300, facing: 0 }),
      makeFleetConfig("P2", "side1", { main: "haruhi", sub1: "tsuruya", sub2: "bunny_haruhi" }, { x: 250, y: 1100, facing: 0 }),
      makeFleetConfig("P3", "side2", { main: "shamisen", sub1: "tsuruya", sub2: "asakura" }, { x: 1250, y: 300, facing: Math.PI }),
      makeFleetConfig("P4", "side2", { main: "koizumi", sub1: "yuki", sub2: "future1096" }, { x: 1250, y: 1100, facing: Math.PI }),
    ],
  });
  const host = createMultiFleetBunnyHost(topology, { seed: 512 });
  const teamP1 = host.teamBySeat("P1");
  const teamP2 = host.teamBySeat("P2");
  const teamP3 = host.teamBySeat("P3");
  const zone = host.zoneById(5);

  const { owner, companion } = spawnCompanionForTeam(teamP1, "sub1");
  // P1 切至 bless 以测试形态继承与换形态时序重算只绑定原母舰 Team
  teamP1.startCooldown("sub1", 0);
  owner.restoreHull(owner.maxHp);
  assert.equal(teamP1.castSubSkill("sub1"), true);
  assert.equal(owner.bunnyHaruhi.form, "bless");
  assert.equal(bunnyCompanionForm(companion), owner.bunnyHaruhi);

  // 同阵营盟友 P2 不能直接策反仍在 P1 队的伴随舰
  placeInZone(companion, zone, 70, 70);
  assert.equal(convertBunnyCompanion(companion, teamP2, zone), false, "盟友不得直接策反己方阵营的伴随舰");
  assert.equal(convertZoneSupport(teamP2.ships.sub1, 5), false, "战区策反只收集敌对舰队候选");
  assert.equal(companion.team, teamP1);

  // 先由敌方 P3 策反伴随舰
  advanceTime(host, 10, 300);
  assert.equal(convertZoneSupport(teamP3.ships.sub1, 5), true);
  assert.equal(companion.team, teamP3);
  assert.equal(companion.bunnyCompanion.ownerSeat, "P1");
  assert.equal(bunnyCompanionForm(companion), undefined);

  // 分支 A：原母舰盟友 P2 从敌方 P3 手中夺回伴随舰
  advanceTime(host, 12, 360);
  host.spawnProjectile({ team: teamP3, source: companion });
  assert.equal(convertZoneSupport(teamP2.ships.sub1, 5), true);
  assert.equal(companion.team, teamP2, "P2 夺回后伴随舰临时归属 P2");
  assert.equal(companion.team.sideId, "side1", "实时阵营随 P2 变为 side1");
  assert.equal(companion.bunnyCompanion.ownerSeat, "P1", "P2 夺回不得伪造或改写永久母舰席位");
  assert.equal(companion.bunnyCompanion.ownerShipId, owner.id);
  assert.equal(bunnyCompanionOwner(companion), owner);
  assert.equal(companion.bunnyCompanion.convertedUntil, 17, "同阵营盟友夺回走临时策反而非精确归还");
  assert.equal(companion.bunnyCompanion.nextReliableAt, null, "在盟友舰队期间不得启动原母舰可靠周期");
  assert.equal(bunnyCompanionForm(companion), undefined, "同阵营盟友舰队不得继承原母舰形态");
  assert.equal(host.projectiles.some((p) => p.sourceId === companion.id), false);

  // 所有权回归：P1 与 P2 换形态均不得重算临时停留在 P2 队的 P1 伴随舰
  const savedSpeed = companion.speed;
  const savedCooldown = companion.cooldown;
  teamP2.startCooldown("sub2", 0);
  teamP2.ships.sub2.restoreHull(teamP2.ships.sub2.maxHp);
  assert.equal(teamP2.castSubSkill("sub2"), true);
  assert.equal(companion.speed, savedSpeed, "P2 变身不得改写他舰伴随舰速度");
  assert.equal(companion.cooldown, savedCooldown, "P2 变身不得改写他舰伴随舰射速进度");

  // 永久母舰伤害保护仅针对原母舰实体，不放宽给 P2 或同队其他船
  assert.equal(bunnyOwnerDamageBlocked(owner, companion), true);
  assert.equal(bunnyOwnerDamageBlocked(teamP2.ships.sub2, companion), false);
  assert.equal(bunnyOwnerDamageBlocked(teamP1.ships.main, companion), false);

  // P2 临时持有 5 秒到期后自动归还给精确原母舰 P1（不是留在 P2）
  advanceTime(host, 17, 510);
  prepareBunnyCompanions(host);
  assert.equal(companion.team, teamP1, "盟友临时持有到期必须归还精确原母舰 P1");
  assert.equal(companion.bunnyCompanion.convertedUntil, 0);
  assert.equal(companion.bunnyCompanion.nextReliableAt, 37);
  assert.equal(bunnyCompanionForm(companion), owner.bunnyHaruhi, "回到原母舰队立即恢复形态继承");

  // 分支 B：再次被敌方 P3 策反，由精确原母舰 P1 执行反策反 -> 触发精确提前归还
  placeInZone(companion, zone, 90, 90);
  advanceTime(host, 20, 600);
  assert.equal(convertZoneSupport(teamP3.ships.sub1, 5), true);
  assert.equal(companion.team, teamP3);
  advanceTime(host, 22, 660);
  host.spawnProjectile({ team: teamP3, source: companion });
  assert.equal(convertZoneSupport(teamP1.ships.sub2, 5), true);
  assert.equal(companion.team, teamP1, "只有原母舰舰队 P1 触发精确提前归还");
  assert.equal(companion.bunnyCompanion.convertedUntil, 0);
  assert.equal(companion.bunnyCompanion.nextReliableAt, 42);
  assert.equal(bunnyCompanionForm(companion), owner.bunnyHaruhi);
  assert.equal(host.projectiles.some((p) => p.sourceId === companion.id), false);
}

// 3. 转移失败原子性：目标舰队拒收、非法目标/区域/非注册舰队均无半提交
function verifyAtomicTransferFailure() {
  const topology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", { main: "kyon", sub1: "bunny_haruhi", sub2: "yuki" }, { x: 250, y: 300, facing: 0 }),
      makeFleetConfig("P2", "side1", { main: "haruhi", sub1: "tsuruya", sub2: "future1096" }, { x: 250, y: 1100, facing: 0 }),
      makeFleetConfig("P3", "side2", { main: "shamisen", sub1: "tsuruya", sub2: "asakura" }, { x: 1250, y: 300, facing: Math.PI }),
    ],
  });
  const host = createMultiFleetBunnyHost(topology, { seed: 513 });
  const teamP1 = host.teamBySeat("P1");
  const teamP3 = host.teamBySeat("P3");
  const { owner, companion } = spawnCompanionForTeam(teamP1);

  advanceTime(host, 20, 600);
  prepareBunnyCompanions(host);
  assert.ok(owner.bunnyReliable && companion.bunnyReliable);

  const zone = host.zoneById(5);
  placeInZone(companion, zone, 75, 75);
  host.spawnProjectile({ team: teamP1, source: companion });
  setScenarioField(companion, "speed", 12);
  companion.resetAttackCycle(1.5);

  // 目标舰队已有同 key 额外舰导致 canAcceptAuxiliaryShip 返回 false
  const blocker = new companion.constructor(teamP3, companion.key, 900, 900, 0, {
    characterId: "kyon",
    isAuxiliary: true,
  });
  teamP3.addAuxiliaryShip(blocker);

  const beforeState = companion.bunnyCompanion;
  const beforeOwnerReliable = owner.bunnyReliable;
  const beforeCompReliable = companion.bunnyReliable;
  const beforeSpeed = companion.speed;
  const beforeCooldown = companion.cooldown;
  const beforeSnapshot = JSON.stringify(host.serializeTeams());
  const beforeProjectiles = host.projectiles.length;

  assert.equal(convertBunnyCompanion(companion, teamP3, zone), false);
  assert.equal(convertZoneSupport(teamP3.ships.sub1, 5), false);
  assert.equal(companion.team, teamP1);
  assert.equal(teamP1.extraShips.includes(companion), true);
  assert.equal(teamP3.extraShips.includes(companion), false);
  assert.equal(companion.bunnyCompanion, beforeState);
  assert.equal(owner.bunnyReliable, beforeOwnerReliable);
  assert.equal(companion.bunnyReliable, beforeCompReliable);
  assert.equal(companion.speed, beforeSpeed);
  assert.equal(companion.cooldown, beforeCooldown);
  assert.equal(host.projectiles.length, beforeProjectiles, "失败转移不得提前清除旧弹体");
  assert.equal(JSON.stringify(host.serializeTeams()), beforeSnapshot);

  // 移除冲突占位，传入非法 zone 必须前置拒绝且无副作用
  teamP3.removeAuxiliaryShip(blocker);
  assert.equal(convertBunnyCompanion(companion, teamP3, null), false);
  assert.equal(convertBunnyCompanion(companion, teamP3, { x: Number.NaN, y: 0, width: 10, height: 10 }), false);
  // 伪造非注册目标舰队也必须前置拒绝且无副作用
  const fakeTeam = { seat: "P3", sideId: "side2", match: host, canAcceptAuxiliaryShip: () => true };
  assert.equal(convertBunnyCompanion(companion, fakeTeam, zone), false);
  assert.equal(companion.team, teamP1);
  assert.equal(owner.bunnyReliable, beforeOwnerReliable);
  assert.equal(host.projectiles.length, beforeProjectiles);

  // 非法实体（非伴随舰）拒绝且无副作用
  assert.equal(convertBunnyCompanion(owner, teamP3, zone), false);
  assert.equal(owner.team, teamP1);
}

// 4. 多敌方舞台重叠：粘滞保持、距离优先与席位序决胜、切换/离开/失效与精确区间消费
function verifyMultiHostileStageSelectionAndTransitions() {
  // 纯函数规则校验：距离优先 + 等距按 hostileStages（seatOrder）顺序 + 粘滞保持
  const targetPoint = { alive: true, x: 500, y: 500 };
  const stageFar = { sourceShipId: 10, seat: "P3", x: 560, y: 500, radius: 172 };
  const stageNear = { sourceShipId: 20, seat: "P4", x: 510, y: 500, radius: 172 };
  const stageTieLeft = { sourceShipId: 30, seat: "P3", x: 460, y: 500, radius: 172 };
  const stageTieRight = { sourceShipId: 40, seat: "P4", x: 540, y: 500, radius: 172 };
  assert.equal(selectBunnyStageSource(targetPoint, [stageFar, stageNear]).sourceShipId, 20, "首次同时入圈按更近圆心选择");
  assert.equal(selectBunnyStageSource(targetPoint, [stageTieLeft, stageTieRight]).sourceShipId, 30, "等距按注册席位顺序决胜");
  assert.equal(
    selectBunnyStageSource(targetPoint, [stageFar, stageNear], { inside: true, sourceShipId: 10 }).sourceShipId,
    10,
    "旧来源仍覆盖时保持原来源不抖动",
  );

  // 真实 4 舰队场景：P1、P2 同属 side1（P2 也有兔女郎主舰，不得影响盟友 P1），P3、P4 属 side2 均有兔女郎主舰
  const topology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", { main: "kyon", sub1: "asakura", sub2: "yuki" }, { x: 500, y: 500, facing: 0 }),
      makeFleetConfig("P2", "side1", { main: "bunny_haruhi", sub1: "kyon", sub2: "yuki" }, { x: 500, y: 500, facing: 0 }),
      makeFleetConfig("P3", "side2", { main: "bunny_haruhi", sub1: "kyon", sub2: "koizumi" }, { x: 1200, y: 300, facing: Math.PI }),
      makeFleetConfig("P4", "side2", { main: "bunny_haruhi", sub1: "haruhi", sub2: "shamisen" }, { x: 1200, y: 1100, facing: Math.PI }),
    ],
  });
  const host = createMultiFleetBunnyHost(topology, { seed: 514 });
  const target = host.teamBySeat("P1").ships.main;
  const allyStageOwner = host.teamBySeat("P2").ships.main;
  const sourceP3 = host.teamBySeat("P3").ships.main;
  const sourceP4 = host.teamBySeat("P4").ships.main;

  // 样本契约验证：冻结、含 receiverSeat/ownStage/hostileStages、盟友 P2 不进入 P1 的 hostileStages、无完整 Team 引用
  const initialSamples = sampleBunnyStages(host);
  assert.ok(Object.isFrozen(initialSamples));
  const sampleForP1 = initialSamples.find((item) => item.receiverSeat === "P1");
  assert.ok(Object.isFrozen(sampleForP1));
  assert.equal(sampleForP1.ownStage, undefined);
  assert.ok(Object.isFrozen(sampleForP1.hostileStages));
  assert.deepEqual(
    sampleForP1.hostileStages.map((s) => s.seat),
    ["P3", "P4"],
    "敌对舞台样本只包含敌对阵营并按 seatOrder 排序，排除同阵营 P2",
  );
  assert.equal(sampleForP1.hostileStages.every((s) => Object.isFrozen(s) && s.team === undefined && s.ships === undefined), true);

  // 同阵营盟友 P2 与 P1 重叠不会触发敌对舞台曝光
  setScenarioField(allyStageOwner, "x", target.x);
  setScenarioField(allyStageOwner, "y", target.y);
  resolveBunnyStages(host);
  assert.equal(target.bunnyStageExposure, undefined, "同阵营兔女郎舞台不得影响盟友");

  // P3 先覆盖目标 -> target 进入 P3 舞台并触发首次禁控
  setScenarioField(target, "hp", 300);
  setScenarioField(sourceP3, "x", target.x + 80);
  setScenarioField(sourceP3, "y", target.y);
  resolveBunnyStages(host);
  assert.equal(target.bunnyStageExposure.inside, true);
  assert.equal(target.bunnyStageExposure.sourceShipId, sourceP3.id);
  assert.equal(target.bunnyStageExposure.phase, "speechless");
  assert.equal(target.bunnyStageExposure.enteredAt, 0);
  assert.equal(target.bunnyStageExposure.nextEntryControlAt, 15);
  assert.equal(target.isControlLocked(), true);
  assert.deepEqual(bunnyStageSourceInfo(target), { sourceShipId: sourceP3.id, seat: "P3", sideId: "side2" });

  // P4 随后移动得比 P3 更近 -> 保持原有效来源 P3，不重置 enteredAt
  advanceTime(host, 5, 150);
  setScenarioField(sourceP4, "x", target.x + 10);
  setScenarioField(sourceP4, "y", target.y);
  advanceBunnyRules(host);
  assert.equal(target.bunnyStageExposure.sourceShipId, sourceP3.id, "P3 仍覆盖时必须保持原来源");
  assert.equal(target.bunnyStageExposure.enteredAt, 0);
  assert.equal(target.bunnyStageExposure.phase, "speechless");

  // 连续 10 秒进入 P3 的入迷阶段并领取一次性 15% 首次治疗
  advanceTime(host, 10, 300);
  advanceBunnyRules(host);
  assert.equal(target.bunnyStageExposure.sourceShipId, sourceP3.id);
  assert.equal(target.bunnyStageExposure.phase, "entranced");
  assert.equal(target.bunnyStageExposure.firstEntranceHealConsumed, true);
  const hpAfterFirst = 300 + target.maxHp * C.stage.firstHealRatio;
  near(target.hp, hpAfterFirst);

  // 推进 1 秒，消费 [10, 11] 持续治疗（仅 P3 一份，不因 P4 重叠而双倍）
  advanceTime(host, 11, 330);
  advanceBunnyRules(host);
  const hpAfterOneSec = hpAfterFirst + target.maxHp * C.stage.healPerSecondRatio;
  near(target.hp, hpAfterOneSec);

  // P3 离开覆盖范围，P4 仍在 -> 切换至 P4，重置入圈起点为 11，保留 15 秒禁控冷却与已领取首次治疗历史
  setScenarioField(sourceP3, "x", 1400);
  resolveBunnyStages(host);
  assert.equal(target.bunnyStageExposure.inside, true);
  assert.equal(target.bunnyStageExposure.sourceShipId, sourceP4.id, "P3 离开后必须平滑切换至替补来源 P4");
  assert.equal(target.bunnyStageExposure.enteredAt, 11);
  assert.equal(target.bunnyStageExposure.phase, "speechless");
  assert.equal(target.bunnyStageExposure.nextEntryControlAt, 15, "15 秒内切换来源不触发二次禁控");
  assert.equal(target.isControlLocked(), false);
  assert.equal(target.bunnyStageExposure.firstEntranceHealConsumed, true);
  assert.equal(projectBunnyStageExposureSource(target).sourceSeat, "P4");

  // 推进到 12 秒：已切换到 P4 哑口无言阶段，[11, 12] 期间不得再获得持续治疗
  advanceTime(host, 12, 360);
  advanceBunnyRules(host);
  near(target.hp, hpAfterOneSec, 1e-7);

  // 推进到 21 秒：在 P4 连续满 10 秒进入入迷，但不重复发放 15% 首次治疗
  advanceTime(host, 21, 630);
  advanceBunnyRules(host);
  assert.equal(target.bunnyStageExposure.sourceShipId, sourceP4.id);
  assert.equal(target.bunnyStageExposure.phase, "entranced");
  near(target.hp, hpAfterOneSec, 1e-7);

  // 推进到 22 秒：在 P4 入迷后恰好消费 [21, 22] 一秒持续治疗
  advanceTime(host, 22, 660);
  advanceBunnyRules(host);
  const hpAfterP4OneSec = hpAfterOneSec + target.maxHp * C.stage.healPerSecondRatio;
  near(target.hp, hpAfterP4OneSec);

  // P3 重新回来覆盖，此时 P4 死亡 -> 下次推进先不计死源 [22, 23] 治疗，清理后切换到 P3，且此时 23 >= 15 触发新一次禁控
  setScenarioField(sourceP3, "x", target.x + 20);
  setScenarioField(sourceP4, "alive", false);
  advanceTime(host, 23, 690);
  advanceBunnyRules(host);
  near(target.hp, hpAfterP4OneSec, 1e-7);
  assert.equal(target.bunnyStageExposure.sourceShipId, sourceP3.id);
  assert.equal(target.bunnyStageExposure.enteredAt, 23);
  assert.equal(target.bunnyStageExposure.phase, "speechless");
  assert.equal(target.isControlLocked(), true, "冷却到期后切换至新来源应触发禁控");
  assert.equal(target.bunnyStageExposure.nextEntryControlAt, 38);

  // 来源封印使舞台失效，无其他覆盖来源时离开舞台
  host.teamBySeat("P3").setRestrictions({ characters: true });
  cleanupBunnySources(host);
  assert.equal(target.bunnyStageExposure.inside, false);
  assert.equal(host.teamBySeat("P3").bunnyStage, null);
  assert.equal(bunnyStageEnabled(target), false);
}

// 5. 同帧多源采样后死亡/净化与查询/序列化纯度
function verifySameTickSamplingDeathCleanseAndReadPurity() {
  // 5a. 纯运行时端口验证：同帧采完多来源后 S1 在接收者结算前失效 -> 跳过已失效来源，直接选有效替补 S2
  let now = 0;
  let s1Valid = true;
  let sampleCount = 0;
  const healed = [];
  const runtime = new BunnyStageRuntime({
    seats: ["P1", "P3", "P4"],
    now: () => now,
    tick: () => now * 30,
    sampleStages: () => {
      sampleCount += 1;
      return Object.freeze([
        Object.freeze({
          receiverSeat: "P1",
          ownStage: undefined,
          hostileStages: Object.freeze([
            Object.freeze({ sourceShipId: 101, seat: "P3", x: 0, y: 0, radius: 100 }),
            Object.freeze({ sourceShipId: 102, seat: "P4", x: 30, y: 0, radius: 100 }),
          ]),
        }),
        Object.freeze({ receiverSeat: "P3", ownStage: Object.freeze({ sourceShipId: 101, seat: "P3", x: 0, y: 0, radius: 100 }), hostileStages: Object.freeze([]) }),
        Object.freeze({ receiverSeat: "P4", ownStage: Object.freeze({ sourceShipId: 102, seat: "P4", x: 30, y: 0, radius: 100 }), hostileStages: Object.freeze([]) }),
      ]);
    },
    receivers: (seat) => {
      if (seat !== "P1") return [];
      // 模拟同帧采样之后、接收者更新之前，更近的来源 S1 已经死亡
      s1Valid = false;
      return [{ id: 1, alive: true, x: 0, y: 0, maxHp: 1000 }];
    },
    sourceValid: (sourceId) => (sourceId === 101 ? s1Valid : sourceId === 102),
    stageActive: (seat) => (seat === "P3" ? s1Valid : seat === "P4"),
    resources: () => ({ hp: 500, maxHp: 1000 }),
    heal: (id, amount) => healed.push([id, amount]),
    stopIfVulnerable: () => {},
    sustainForm: () => {},
    cleanupForm: () => {},
  });
  runtime.resolve();
  assert.equal(sampleCount, 1);
  assert.equal(runtime.exposure(1).sourceShipId, 102, "同帧采样后失效的来源不得被提交为当前来源");
  assert.equal(runtime.enabled(1), true);

  // 5b. 真实多舰队场景：同帧双兔女郎互采半径不互相串帧 + 净化后同帧重复读取与序列化无副作用
  const topology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", { main: "bunny_haruhi", sub1: "kyon", sub2: "yuki" }, { x: 500, y: 500, facing: 0 }),
      makeFleetConfig("P3", "side2", { main: "bunny_haruhi", sub1: "kyon", sub2: "asakura" }, { x: 580, y: 500, facing: Math.PI }),
      makeFleetConfig("P4", "side2", { main: "bunny_haruhi", sub1: "haruhi", sub2: "koizumi" }, { x: 610, y: 500, facing: Math.PI }),
    ],
  });
  const host = createMultiFleetBunnyHost(topology, { seed: 515 });
  const shipP1 = host.teamBySeat("P1").ships.main;
  const shipP3 = host.teamBySeat("P3").ships.main;
  const shipP4 = host.teamBySeat("P4").ships.main;
  setScenarioField(shipP1, "hp", 300);

  // 初始采样：P1 处于 P3(距离80) 与 P4(距离110) 重叠中，选择更近的 P3
  assert.equal(shipP1.bunnyStageExposure.sourceShipId, shipP3.id);
  assert.equal(shipP1.isControlLocked(), true);

  // 同帧净化控制，保留舞台在场与来源身份
  cleanseBunnyShipControl(shipP1);
  assert.equal(shipP1.isControlLocked(), false);
  assert.equal(shipP1.bunnyStageExposure.inside, true);
  assert.equal(shipP1.bunnyStageExposure.sourceShipId, shipP3.id);

  // 同帧到达入迷时刻：先全量采样双方旧半径（172），再依次结算入迷，本帧半径读数不串帧
  advanceTime(host, 10, 300);
  advanceBunnyRules(host);
  near(host.teamBySeat("P1").bunnyStage.radius, 172);
  near(host.teamBySeat("P3").bunnyStage.radius, 172);
  assert.equal(shipP1.bunnyStageExposure.phase, "entranced");
  assert.equal(shipP3.bunnyStageExposure.phase, "entranced");
  const hpAfterEntrance = shipP1.hp;

  // 连续重复查询、只读投影、样本读取与序列化不得推进治疗、重置锁定或触发清理
  const snapshotBefore = JSON.stringify(host.serializeTeams());
  const exposureRef = shipP1.bunnyStageExposure;
  for (let i = 0; i < 4; i += 1) {
    assert.equal(bunnyStageEnabled(shipP1), true);
    sampleBunnyStages(host);
    bunnyStageSourceInfo(shipP1);
    projectBunnyStageExposureSource(shipP1);
    serializeBunnyShip(shipP1);
    serializeBunnyShip(shipP1, { includeSourceDetails: true });
    host.serializeTeams();
  }
  assert.equal(shipP1.hp, hpAfterEntrance);
  assert.equal(shipP1.bunnyStageExposure, exposureRef);
  assert.equal(JSON.stringify(host.serializeTeams()), snapshotBefore);

  // 来源 P3 在同帧死亡：查询立即可见失效但不自动改写状态，直到显式 cleanup 提交
  setScenarioField(shipP3, "alive", false);
  assert.equal(bunnyStageEnabled(shipP1), false);
  assert.equal(shipP1.bunnyStageExposure.inside, true, "只读查询不得自动执行来源清理");
  const readDuringDead = projectBunnyStageExposureSource(shipP1);
  assert.equal(readDuringDead.enabled, false);
  assert.equal(shipP1.hp, hpAfterEntrance);
  cleanupBunnySources(host);
  assert.equal(shipP1.bunnyStageExposure.inside, false);
  assert.equal(host.teamBySeat("P3").bunnyStage, null);
  assert.equal(host.teamBySeat("P4").bunnyStage.sourceShipId, shipP4.id);
}

// 6. 母舰死亡、策反到期、连续反策反与无二次舰损统计
function verifyLifecycleExpiryChainedConversionAndOwnerDeath() {
  const topology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", { main: "kyon", sub1: "bunny_haruhi", sub2: "tsuruya" }, { x: 250, y: 300, facing: 0 }),
      makeFleetConfig("P2", "side2", { main: "shamisen", sub1: "tsuruya", sub2: "asakura" }, { x: 1250, y: 300, facing: Math.PI }),
      makeFleetConfig("P3", "side3", { main: "koizumi", sub1: "tsuruya", sub2: "future1096" }, { x: 750, y: 1200, facing: -Math.PI / 2 }),
    ],
  });
  const host = createMultiFleetBunnyHost(topology, { seed: 516 });
  const teamP1 = host.teamBySeat("P1");
  const teamP2 = host.teamBySeat("P2");
  const teamP3 = host.teamBySeat("P3");
  const zone = host.zoneById(5);

  const { owner, companion } = spawnCompanionForTeam(teamP1);
  placeInZone(companion, zone, 100, 100);

  // 三方混战连续反策反：P1 -> P2 -> P3 -> P1（精确归还）
  advanceTime(host, 5, 150);
  host.spawnProjectile({ team: teamP1, source: companion });
  assert.equal(convertZoneSupport(teamP2.ships.sub1, 5), true);
  assert.equal(companion.team, teamP2);
  assert.equal(companion.bunnyCompanion.ownerSeat, "P1");
  assert.equal(companion.bunnyCompanion.convertedUntil, 10);
  assert.equal(host.projectiles.some((p) => p.sourceId === companion.id), false);

  advanceTime(host, 7, 210);
  host.spawnProjectile({ team: teamP2, source: companion });
  assert.equal(convertZoneSupport(teamP3.ships.sub1, 5), true);
  assert.equal(companion.team, teamP3);
  assert.equal(companion.bunnyCompanion.ownerSeat, "P1");
  assert.equal(companion.bunnyCompanion.convertedUntil, 12);
  assert.equal(teamP2.extraShips.includes(companion), false);
  assert.equal(teamP3.extraShips.filter((s) => s === companion).length, 1);
  assert.equal(host.projectiles.some((p) => p.sourceId === companion.id), false);

  advanceTime(host, 9, 270);
  host.spawnProjectile({ team: teamP3, source: companion });
  assert.equal(convertZoneSupport(teamP1.ships.sub2, 5), true);
  assert.equal(companion.team, teamP1);
  assert.equal(companion.bunnyCompanion.convertedUntil, 0);
  assert.equal(companion.bunnyCompanion.nextReliableAt, 29);
  assert.equal(teamP3.extraShips.includes(companion), false);
  assert.equal(teamP1.extraShips.filter((s) => s === companion).length, 1);
  assert.equal(host.projectiles.some((p) => p.sourceId === companion.id), false);

  // 再次被 P3 策反期间，母舰 P1 被 P2 击沉 -> 伴随舰立即退场、清除弹体、不复活不归还、且不记第二次舰损
  advanceTime(host, 12, 360);
  assert.equal(convertZoneSupport(teamP3.ships.sub1, 5), true);
  assert.equal(companion.team, teamP3);
  host.spawnProjectile({ team: teamP3, source: companion });
  owner.takeDamage(100000, teamP2.ships.main, host);
  assert.equal(owner.alive, false);
  assert.equal(companion.alive, false);
  assert.equal(companion.bunnyCompanion.convertedUntil, 0);
  assert.equal(companion.bunnyCompanion.nextReliableAt, null);
  assert.equal(host.projectiles.some((p) => p.sourceId === companion.id), false);
  assert.deepEqual(host.recordedShipLosses, ["P1"], "母舰死亡引发伴随舰退场不得产生第二次舰损统计");

  // 推进过原策反截止时刻，伴随舰不得复活或回迁
  advanceTime(host, 20, 600);
  prepareBunnyCompanions(host);
  cleanupBunnyCompanions(host);
  assert.equal(companion.alive, false);
  assert.equal(companion.team, teamP3);
  assert.deepEqual(host.recordedShipLosses, ["P1"]);
}

// 7. 样本、配置与读快照不可反写，历史快照隔离
function verifyImmutabilityAndHistoricalIsolation() {
  const mutableSeats = ["P1", "P3"];
  const mutableStage = { sourceShipId: 9, seat: "P3", x: 0, y: 0, radius: 50 };
  let now = 0;
  const runtime = new BunnyStageRuntime({
    seats: mutableSeats,
    now: () => now,
    tick: () => now * 30,
    sampleStages: () => [{ receiverSeat: "P1", ownStage: undefined, hostileStages: [mutableStage] }, { receiverSeat: "P3", ownStage: mutableStage, hostileStages: [] }],
    receivers: (seat) => (seat === "P1" ? [{ id: 1, alive: true, x: 0, y: 0, maxHp: 100 }] : []),
    sourceValid: () => true,
    stageActive: () => true,
    resources: () => ({ hp: 50, maxHp: 100 }),
    heal: () => {},
    stopIfVulnerable: () => {},
    sustainForm: () => {},
    cleanupForm: () => {},
  });
  mutableSeats.push("P999");
  runtime.resolve();
  const stageBefore = runtime.stage("P3");
  const exposureBefore = runtime.exposure(1);
  mutableStage.x = 99999;
  mutableStage.radius = 1;
  assert.equal(stageBefore.x, 0, "外部修改旧样本对象不得污染已提交舞台");
  assert.throws(() => { stageBefore.radius = 0; }, TypeError);
  assert.throws(() => { exposureBefore.sourceShipId = 0; }, TypeError);

  // 真实对局中的只读投影与历史隔离
  const topology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", { main: "kyon", sub1: "bunny_haruhi", sub2: "yuki" }, { x: 400, y: 400, facing: 0 }),
      makeFleetConfig("P3", "side2", { main: "bunny_haruhi", sub1: "tsuruya", sub2: "asakura" }, { x: 1000, y: 400, facing: Math.PI }),
    ],
  });
  const host = createMultiFleetBunnyHost(topology, { seed: 517 });
  const target = host.teamBySeat("P1").ships.main;
  const { companion } = spawnCompanionForTeam(host.teamBySeat("P1"));
  setScenarioField(target, "x", 960);
  setScenarioField(target, "y", 400);
  resolveBunnyStages(host);
  const oldStageView = projectBunnyStageExposureSource(target);
  const oldCompanionView = projectBunnyCompanionOwnership(companion);
  const oldSerialized = serializeBunnyShip(target, { includeSourceDetails: true });
  assert.throws(() => { oldStageView.sourceSeat = "篡改"; }, TypeError);
  assert.throws(() => { oldCompanionView.ownerSeat = "篡改"; }, TypeError);
  oldSerialized.bunnyStageExposure.sourceSeat = "外部改写";
  assert.equal(projectBunnyStageExposureSource(target).sourceSeat, "P3", "修改序列化副本不得污染权威状态");

  // 推进状态后旧只读视图不跟随变化
  setScenarioField(target, "x", 1200);
  resolveBunnyStages(host);
  const zone = host.zoneById(5);
  placeInZone(companion, zone, 50, 50);
  assert.equal(convertZoneSupport(host.teamBySeat("P3").ships.sub1, 5), true);
  assert.equal(oldStageView.inside, true, "旧舞台曝光视图不得跟随后续离圈变化");
  assert.equal(projectBunnyStageExposureSource(target).inside, false);
  assert.equal(oldCompanionView.currentSeat, "P1", "旧伴随舰归属视图不得跟随后续策反变化");
  assert.equal(projectBunnyCompanionOwnership(companion).currentSeat, "P3");
}

// 8. 技能后全舰队视野刷新与旧 1v1 兔女郎完整行为/输出兼容
function verifyVisibilityRefreshAndLegacyCompatibility() {
  // 多舰队视野刷新：refreshBunnyVisibility 刷新全部已注册舰队视野
  const topology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", { main: "kyon", sub1: "bunny_haruhi", sub2: "yuki" }, { x: 200, y: 200, facing: 0 }),
      makeFleetConfig("P2", "side1", { main: "haruhi", sub1: "kyon", sub2: "future1096" }, { x: 200, y: 1200, facing: 0 }),
      makeFleetConfig("P3", "side2", { main: "shamisen", sub1: "tsuruya", sub2: "asakura" }, { x: 1300, y: 200, facing: Math.PI }),
      makeFleetConfig("P4", "side2", { main: "koizumi", sub1: "yuki", sub2: "future1096" }, { x: 1300, y: 1200, facing: Math.PI }),
    ],
  });
  const host = createMultiFleetBunnyHost(topology, { seed: 518 });
  const teamP1 = host.teamBySeat("P1");
  const teamP3 = host.teamBySeat("P3");
  const teamP4 = host.teamBySeat("P4");
  const sub1 = teamP1.ships.sub1;
  assert.equal(teamP3.visibleEnemyIds.has(sub1.id), false);
  assert.equal(teamP4.visibleEnemyIds.has(sub1.id), false);
  // 变身 bless 广播全己方玩家舰位，两个敌队视野均立即刷新可见
  assert.equal(teamP1.castSubSkill("sub1"), true);
  refreshBunnyVisibility(host);
  assert.equal(teamP3.visibleEnemyIds.has(sub1.id), true);
  assert.equal(teamP4.visibleEnemyIds.has(sub1.id), true);
  assert.equal(teamP3.visibleEnemyIds.has(teamP1.ships.main.id), true);
  assert.equal(teamP4.visibleEnemyIds.has(teamP1.ships.main.id), true);
  // 同阵营盟友 P2 不被 P1 的 bless 广播给敌方（本舰队作用域）
  assert.equal(teamP3.visibleEnemyIds.has(host.teamBySeat("P2").ships.main.id), false);

  // 旧 1v1 默认输出结构保持不变，不向旧 schema 追加新键
  __resetEntityIds();
  const legacy = new MatchSimulation({
    mode: "pvp",
    aiSeats: [],
    seed: 912,
    teamLoadouts: {
      A: { main: "bunny_haruhi", sub1: "kyon", sub2: "yuki" },
      B: { main: "kyon", sub1: "bunny_haruhi", sub2: "tsuruya" },
    },
  });
  legacy.teamA.configureFormation(2);
  legacy.teamB.configureFormation(2);
  setScenarioField(legacy.teamB.ships.main, "x", legacy.teamA.ships.main.x + 50);
  setScenarioField(legacy.teamB.ships.main, "y", legacy.teamA.ships.main.y);
  legacy.update(TICK_DT);
  const legacyState = legacy.serializeState();
  const exposureFields = Object.keys(legacyState.teams.B.ships.main.bunnyStageExposure);
  assert.deepEqual(
    exposureFields,
    ["sourceShipId", "phase", "inside", "controlLocked", "lockRemaining", "recoveryRemaining", "entranceRemaining"],
    "旧 1v1 舞台曝光快照字段结构不得新增额外键",
  );

  // 相同种子双次 120 帧运行确定性一致（无额外随机数消费）
  const runDeterministic = () => {
    const sim = new MatchSimulation({
      mode: "pvp",
      aiSeats: [],
      seed: 913,
      teamLoadouts: {
        A: { main: "bunny_haruhi", sub1: "kyon", sub2: "yuki" },
        B: { main: "shamisen", sub1: "bunny_haruhi", sub2: "tsuruya" },
      },
    });
    sim.teamB.split(1);
    for (let i = 0; i < 120; i += 1) {
      if (i === 1) sim.applyActionForSeat("B", { type: "cast_sub_skill", shipKey: "sub1" });
      sim.update(TICK_DT);
    }
    return JSON.stringify(sim.serializeState());
  };
  assert.equal(runDeterministic(), runDeterministic(), "旧双边兔女郎固定种子回放必须逐字节一致");

  // ScenarioSimulation 旧伴随舰全流程兼容校验
  const scenario = new ScenarioSimulation({
    seed: 914,
    teamLoadouts: {
      A: { main: "kyon", sub1: "bunny_haruhi", sub2: "yuki" },
      B: { main: "shamisen", sub1: "tsuruya", sub2: "asakura" },
    },
  });
  scenario.teamA.configureFormation(2);
  const { companion } = spawnCompanionForTeam(scenario.teamA);
  sampleVisibility(scenario.teamB, [companion.id]);
  const compView = companion.serialize();
  assert.deepEqual(
    Object.keys(compView.bunnyCompanion),
    ["ownerShipId", "ownerSeat", "convertedRemaining", "reliableRemaining", "nextReliableRemaining"],
    "旧 1v1 伴随舰快照字段结构保持不变",
  );
  sampleScenarioTime(scenario, { elapsed: 20, tick: 600 });
  prepareBunnyCompanions(scenario);
  assert.ok(scenario.teamA.ships.sub1.bunnyReliable);
}

verifyCompanionConversionAndReturn();
verifyAllyVsOwnerRecaptureAndOwnership();
verifyAtomicTransferFailure();
verifyMultiHostileStageSelectionAndTransitions();
verifySameTickSamplingDeathCleanseAndReadPurity();
verifyLifecycleExpiryChainedConversionAndOwnerDeath();
verifyImmutabilityAndHistoricalIsolation();
verifyVisibilityRefreshAndLegacyCompatibility();

console.log("多舰队兔女郎舞台与伴随舰归属校验通过：多来源选择切换、永久母舰身份、同方盟友边界、原子策反与只读投影隔离。");
