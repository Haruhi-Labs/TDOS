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
import { Scout } from "../shared/game/model/scout.js";
import { Wingman } from "../shared/game/model/wingman.js";
import { Projectile } from "../shared/game/model/projectile.js";
import { normalizeMatchTopology, defaultLegacySpawns } from "../shared/game/runtime/match-topology.js";
import { createFleetRegistry } from "../shared/game/runtime/fleet-registry.js";
import { createMatchFeedback } from "../shared/game/runtime/match-feedback.js";
import { createHostileView } from "../shared/game/adapters/combat-targets.js";
import { createTeamBeamPort } from "../shared/game/adapters/beam-port.js";
import { createTeamSkillPort } from "../shared/game/adapters/team-skill-port.js";
import { createProjectilePhase } from "../shared/game/characters/interactions/projectile-phase.js";
import {
  resolveHaruhiOtherworlderContacts,
  resolveBladeQueenContacts,
} from "../shared/game/characters/interactions/character-contacts.js";
import { resolveShipDestruction } from "../shared/game/characters/interactions/ship-destruction.js";
import {
  resolveKoizumiBarrierRamContacts,
  koizumiBarrierGeometry,
  koizumiBarrierProjectileImpact,
  consumeKoizumiBarrierHit,
  KOIZUMI_BARRIER_MAX_HITS,
} from "../shared/game/characters/koizumi/barrier.js";
import {
  activateKoizumiOrb,
  resolveKoizumiOrbContacts,
  updateKoizumiImpactWaves,
  sampleKoizumiOrbMotion,
} from "../shared/game/characters/koizumi/orb.js";
import { createHeroPowerRuntime } from "../shared/game/characters/haruhi/hero-power-runtime.js";
import { activateHaruhiFlagship, haruhiEsperOrb } from "../shared/game/characters/haruhi/flagship.js";
import { createVisionWavePurgePort } from "../shared/game/characters/asakura/vision-wave-port.js";
import { resolveVisionWavePurges } from "../shared/game/systems/vision-wave-purge.js";
import { ensureShamisenHuntTarget } from "../shared/game/characters/shamisen/hunt.js";
import { updateRadarPassive, serializeRadarSweep } from "../shared/game/characters/yuki/radar-port.js";
import { BeamSystem } from "../shared/game/systems/beam-system.js";
import { nextEntityId } from "../shared/game/model/model-support.js";
import { setScenarioField } from "./core-tests/ship-fixture.mjs";

function makeFleetConfig(seat, sideId, loadout, spawn) {
  return {
    seat,
    sideId,
    name: `舰队_${seat}`,
    loadout,
    spawn,
  };
}

// 多舰队技能测试宿主：复用真实 Team/Ship/Scout/Wingman/Projectile/角色扩展与端口，不绕过生产开局校验。
function createMultiFleetEffectsHost(topology, { seed = 401, bunnyHaruhiActive = false } = {}) {
  const worldSize = DEFAULT_WORLD_SIZE;
  const zones = buildZones(worldSize);
  const rng = createSeededRng(seed);
  const spawnedProjectiles = [];
  const recordedAttacks = [];
  const recordedDamage = [];
  const recordedShipLosses = [];
  const recordedActions = [];
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
    recordedActions,
    floatingTexts,
    bursts,
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
      const projectile = new Projectile(profile);
      spawnedProjectiles.push(projectile);
      return projectile;
    },
    discardProjectilesFrom() {},
  };

  const feedback = createMatchFeedback({
    now: () => host.elapsed,
    nextId: () => nextEntityId(host),
  });
  const heroPowers = createHeroPowerRuntime(host);
  host.feedback = feedback;
  host.heroPowers = heroPowers;
  host.queueHeroPower = (ship, meta) => heroPowers.enqueue(ship, meta);
  host.spawnKoizumiBarrierImpact = (options) => feedback.barrierImpact(options);
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
  host.visionWavePurgePort = createVisionWavePurgePort(host);

  return { host, teams, registry, feedback, heroPowers };
}

function placeShip(ship, x, y, angle = 0) {
  setScenarioField(ship, "x", x);
  setScenarioField(ship, "y", y);
  setScenarioField(ship, "angle", angle);
}

// =========================================================================
// 1. 一束光线跨多个敌队命中 n 个目标：一次开火、一次统计、按 n 计算统一倍率
// =========================================================================
{
  const topology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", { main: "kyon", sub1: "future1096", sub2: "yuki" }, { x: 200, y: 700, facing: 0 }),
      makeFleetConfig("P2", "side1", { main: "kyon", sub1: "asakura", sub2: "tsuruya" }, { x: 320, y: 700, facing: 0 }),
      makeFleetConfig("P3", "side2", { main: "kyon", sub1: "yuki", sub2: "tsuruya" }, { x: 460, y: 700, facing: Math.PI }),
      makeFleetConfig("P4", "side2", { main: "kyon", sub1: "asakura", sub2: "shamisen" }, { x: 600, y: 700, facing: Math.PI }),
    ],
  });
  const { host, teams } = createMultiFleetEffectsHost(topology, { seed: 410 });
  const [p1, p2, p3, p4] = teams;

  // 全部解编，确保各舰独立承伤，便于直接断言每舰承受的单次统一倍率伤害。
  for (const team of teams) team.configureFormation(2);

  const caster = p1.ships.sub1;
  placeShip(caster, 200, 700, 0);
  // 盟友 P2 在射线上，必须不受命中；P3 主舰 + P4 主舰与 sub1 共 3 个合法敌方目标在射线上。
  placeShip(p2.ships.main, 300, 700, 0);
  placeShip(p2.ships.sub1, 300, 300, 0);
  placeShip(p2.ships.sub2, 300, 350, 0);
  placeShip(p3.ships.main, 420, 700, Math.PI);
  placeShip(p3.ships.sub1, 420, 260, Math.PI);
  placeShip(p3.ships.sub2, 420, 320, Math.PI);
  placeShip(p4.ships.main, 540, 700, Math.PI);
  placeShip(p4.ships.sub1, 660, 700, Math.PI);
  placeShip(p4.ships.sub2, 660, 260, Math.PI);

  // 先核对有限目标句柄：包含稳定只读 id 与几何，不含资源 setter 或完整 Team。
  const beamPort = createTeamBeamPort(p1);
  const handles = beamPort.targets("sub1", host.hostileView("P1"));
  assert.equal(handles.length, 6, "敌对集合应包含 P3 与 P4 全部 6 艘敌舰");
  assert.equal(new Set(handles.map((handle) => handle.id)).size, 6, "句柄按实体 ID 去重");
  assert.equal(Object.isFrozen(handles[0]), true, "光线有限目标句柄应冻结");
  assert.equal(handles[0].team, undefined);
  assert.equal(handles[0].hp, undefined);
  assert.throws(() => { handles[0].x = 0; }, TypeError);

  // 用窄端口 + 真实 BeamSystem 观察 fire / recordAttack / damageRatio / 投递顺序。
  const ratioArgs = [];
  const beamTrace = [];
  const observedSystem = new BeamSystem({
    ...beamPort,
    recordAttack: (count) => {
      beamTrace.push(["recordAttack", count]);
      beamPort.recordAttack(count);
    },
    targets: (key, view) => beamPort.targets(key, view).map((handle) => ({
      ...handle,
      hit: (ratio) => {
        beamTrace.push(["hit", handle.id, ratio]);
        handle.hit(ratio);
      },
    })),
  }, {
    range: 900,
    chargeDuration: 1.05,
    visualDuration: 0.26,
    hitRadius: 7,
    damageRatio: (count) => {
      ratioArgs.push(count);
      return count === 3 ? 0.14 : 0.28;
    },
  });

  const beforeHp = {
    p2Main: p2.ships.main.hp,
    p3Main: p3.ships.main.hp,
    p4Main: p4.ships.main.hp,
    p4Sub1: p4.ships.sub1.hp,
  };
  assert.equal(observedSystem.enqueue({ key: "sub1", alive: true, attached: false, controlLocked: false, x: caster.x, y: caster.y }, 1, 0), true);
  observedSystem.advance(1.05);
  observedSystem.resolve(host.hostileView("P1"));

  assert.deepEqual(ratioArgs, [3], "跨两支敌队命中 3 个目标时必须以总数 3 一次求倍率");
  assert.deepEqual(host.recordedAttacks, [{ seat: "P1", kind: "beam", hitCount: 3 }], "一束光线只记录一次攻击统计且命中数为总实体数");
  assert.equal(beamTrace[0][0], "recordAttack");
  assert.deepEqual(
    beamTrace.slice(1),
    [
      ["hit", p3.ships.main.id, 0.14],
      ["hit", p4.ships.main.id, 0.14],
      ["hit", p4.ships.sub1.id, 0.14],
    ],
    "命中投递保持 seatOrder 顺序与统一倍率",
  );
  assert.equal(p2.ships.main.hp, beforeHp.p2Main, "同阵营盟友在射线上不得受击");
  assert.ok(Math.abs((beforeHp.p3Main - p3.ships.main.hp) - p3.ships.main.maxHp * 0.14) < 1e-6);
  assert.ok(Math.abs((beforeHp.p4Main - p4.ships.main.hp) - p4.ships.main.maxHp * 0.14) < 1e-6);
  assert.ok(Math.abs((beforeHp.p4Sub1 - p4.ships.sub1.hp) - p4.ships.sub1.maxHp * 0.14) < 1e-6);

  // 真实 Team.resolveChargedBeams(hostileView) 同样生效且仅结算一次。
  host.recordedAttacks.length = 0;
  assert.equal(p1.queueBeamDirection(caster, 1, 0), true);
  p1.advanceBeams(1.05);
  p1.resolveChargedBeams(host.hostileView("P1"));
  p1.resolveChargedBeams(host.hostileView("P1"));
  assert.deepEqual(host.recordedAttacks, [{ seat: "P1", kind: "beam", hitCount: 3 }]);
}

// =========================================================================
// 2. 多个古泉护盾竞争（近远顺序 + 等距边界）与盾后截断
// =========================================================================
{
  function runMultiBarrierBeam({ p3Pos, p4Pos, seed = 421 }) {
    const topology = normalizeMatchTopology({
      fleets: [
        makeFleetConfig("P1", "side1", { main: "kyon", sub1: "future1096", sub2: "yuki" }, { x: 150, y: 700, facing: 0 }),
        makeFleetConfig("P2", "side1", { main: "koizumi", sub1: "kyon", sub2: "yuki" }, { x: 260, y: 700, facing: 0 }),
        makeFleetConfig("P3", "side2", { main: "koizumi", sub1: "kyon", sub2: "yuki" }, { x: p3Pos.x, y: p3Pos.y, facing: Math.PI }),
        makeFleetConfig("P4", "side2", { main: "koizumi", sub1: "kyon", sub2: "yuki" }, { x: p4Pos.x, y: p4Pos.y, facing: Math.PI }),
      ],
    });
    const { host, teams, feedback } = createMultiFleetEffectsHost(topology, { seed });
    const [p1, p2, p3, p4] = teams;
    for (const team of teams) team.configureFormation(2);

    const caster = p1.ships.sub1;
    placeShip(caster, 150, 700, 0);
    // 盟友 P2 的古泉护盾在最前面，不能拦截友方光线。
    placeShip(p2.ships.main, 260, 700, 0);
    placeShip(p3.ships.main, p3Pos.x, p3Pos.y, Math.PI);
    placeShip(p4.ships.main, p4Pos.x, p4Pos.y, Math.PI);
    // 放置在两个敌方护盾后方的敌舰，用于验证光线截断后不受伤害。
    placeShip(p3.ships.sub1, 1050, 700, Math.PI);
    placeShip(p4.ships.sub1, 1120, 700, Math.PI);
    placeShip(p3.ships.sub2, 1050, 200, Math.PI);
    placeShip(p4.ships.sub2, 1120, 200, Math.PI);

    const p3Sub1Before = p3.ships.sub1.hp;
    const p4Sub1Before = p4.ships.sub1.hp;
    assert.equal(p1.queueBeamDirection(caster, 1, 0), true);
    p1.advanceBeams(1.05);
    p1.resolveChargedBeams(host.hostileView("P1"));

    return {
      beam: p1.beams[0],
      p2Hits: p2.koizumiBarrier.remainingHits,
      p3Hits: p3.koizumiBarrier.remainingHits,
      p4Hits: p4.koizumiBarrier.remainingHits,
      impacts: feedback.inspectBarrierImpacts(),
      p3BehindDamaged: p3.ships.sub1.hp < p3Sub1Before,
      p4BehindDamaged: p4.ships.sub1.hp < p4Sub1Before,
    };
  }

  // 2a. 排后的 P4 护盾比 P3 更靠近发射点：必须选中 P4，仅消费 P4 次数，截断盾后目标。
  const nearFar = runMultiBarrierBeam({
    p3Pos: { x: 820, y: 700 },
    p4Pos: { x: 520, y: 700 },
  });
  assert.equal(nearFar.beam.blockedByBarrier, true);
  assert.equal(nearFar.beam.barrierTeamSeat, "P4", "沿射线更近的敌方护盾必须优先拦截");
  assert.equal(nearFar.p2Hits, KOIZUMI_BARRIER_MAX_HITS, "同阵营护盾不得阻挡盟友光线");
  assert.equal(nearFar.p3Hits, KOIZUMI_BARRIER_MAX_HITS, "未被选中的远端敌方护盾不得消费次数");
  assert.equal(nearFar.p4Hits, KOIZUMI_BARRIER_MAX_HITS - 1, "被选中的护盾恰好消费 1 次");
  assert.equal(nearFar.impacts.length, 1);
  assert.equal(nearFar.impacts[0].teamSeat, "P4");
  assert.equal(nearFar.impacts[0].sourceSeat, "P1");
  assert.ok(nearFar.beam.x2 < 520, "光线终点应截断于较近护盾的入射边界");
  assert.equal(nearFar.p3BehindDamaged, false, "盾后敌舰不得受击");
  assert.equal(nearFar.p4BehindDamaged, false, "盾后敌舰不得受击");

  // 2b. 等距边界：P3 与 P4 关于射线完全对称，重复相同 seed 结果一致且按 seatOrder 选 P3。
  const tieFirst = runMultiBarrierBeam({
    p3Pos: { x: 640, y: 660 },
    p4Pos: { x: 640, y: 740 },
    seed: 429,
  });
  const tieSecond = runMultiBarrierBeam({
    p3Pos: { x: 640, y: 660 },
    p4Pos: { x: 640, y: 740 },
    seed: 429,
  });
  assert.equal(tieFirst.beam.barrierTeamSeat, "P3", "等距护盾按稳定注册席位顺序选先注册者");
  assert.equal(tieFirst.p3Hits, KOIZUMI_BARRIER_MAX_HITS - 1);
  assert.equal(tieFirst.p4Hits, KOIZUMI_BARRIER_MAX_HITS);
  assert.deepEqual(
    { seat: tieSecond.beam.barrierTeamSeat, x2: tieSecond.beam.x2, y2: tieSecond.beam.y2, p3Hits: tieSecond.p3Hits, p4Hits: tieSecond.p4Hits },
    { seat: tieFirst.beam.barrierTeamSeat, x2: tieFirst.beam.x2, y2: tieFirst.beam.y2, p3Hits: tieFirst.p3Hits, p4Hits: tieFirst.p4Hits },
    "等距护盾在相同 seed 下结果必须完全一致",
  );
}

// =========================================================================
// 3. 弹体多来源拦截：类型顺序、同类型交点排序、友方弹体免拦截与免重置护盾修复、多敌队破盾冲撞
// =========================================================================
{
  const topology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", { main: "kyon", sub1: "asakura", sub2: "koizumi" }, { x: 100, y: 700, facing: 0 }),
      makeFleetConfig("P2", "side1", { main: "koizumi", sub1: "kyon", sub2: "yuki" }, { x: 240, y: 700, facing: 0 }),
      makeFleetConfig("P3", "side2", { main: "koizumi", sub1: "kyon", sub2: "yuki" }, { x: 760, y: 700, facing: Math.PI }),
      makeFleetConfig("P4", "side2", { main: "haruhi", sub1: "koizumi", sub2: "asakura" }, { x: 520, y: 700, facing: Math.PI }),
    ],
  });
  const { host, teams, feedback } = createMultiFleetEffectsHost(topology, { seed: 433 });
  const [p1, p2, p3, p4] = teams;

  placeShip(p1.ships.main, 100, 700, 0);
  placeShip(p2.ships.main, 240, 700, 0);
  placeShip(p3.ships.main, 760, 700, Math.PI);
  placeShip(p4.ships.main, 520, 700, Math.PI);

  // 为 P4 普通春日解锁超能力者球（esper），使其球位于弹道上且比 P3 护盾更靠前。
  let unlockGuard = 0;
  while (!haruhiEsperOrb(p4) && unlockGuard < 10) {
    activateHaruhiFlagship(p4, 16, host.rng.next);
    unlockGuard += 1;
  }
  const orb = haruhiEsperOrb(p4);
  assert.ok(orb, "应成功为 P4 激活超能力者支援球");
  // 把 P3 护盾置于支援球之后，使一颗单帧跨过两者的弹体同时命中 P4 支援球与 P3 护盾。
  const p3BarrierRadius = koizumiBarrierGeometry(p3).radius;
  placeShip(p3.ships.main, orb.x + p3BarrierRadius + 40, orb.y, Math.PI);

  const phase1 = createProjectilePhase(host);
  const crossShot = host.spawnProjectile({
    team: p1,
    source: p1.ships.main,
    x: orb.x - 60,
    y: orb.y,
    targetX: orb.x + 120,
    targetY: orb.y,
    speed: 600,
    damage: 10,
    radius: 3,
  });
  assert.equal(phase1.intercept(crossShot, 0.5), true, "同时命中支援球与护盾时应被拦截");
  assert.equal(p3.koizumiBarrier.remainingHits, KOIZUMI_BARRIER_MAX_HITS - 1, "保持护盾先于支援吸收的既有类型顺序");
  assert.equal(feedback.inspectBarrierImpacts().at(-1).teamSeat, "P3");
  assert.equal(crossShot.alive, false);

  // 移开敌队，隔离验证同阵营盟友弹体穿过满盾 P2：不拦截、不消费次数。
  placeShip(p3.ships.main, 1200, 1200, Math.PI);
  placeShip(p4.ships.main, 1200, 200, Math.PI);
  const p2Geo = koizumiBarrierGeometry(p2);
  const allyShot = host.spawnProjectile({
    team: p1,
    source: p1.ships.main,
    x: p2Geo.x - p2Geo.radius - 30,
    y: p2Geo.y,
    targetX: p2Geo.x + p2Geo.radius + 30,
    targetY: p2Geo.y,
    speed: 400,
    damage: 10,
    radius: 3,
  });
  assert.equal(koizumiBarrierProjectileImpact(allyShot, 1, p2, p2Geo), null, "护盾交点查询必须直接拒绝同阵营盟友弹体");
  const phase2 = createProjectilePhase(host);
  assert.equal(phase2.intercept(allyShot, 1), false, "同阵营盟友弹体不得被护盾拦截");
  assert.equal(p2.koizumiBarrier.remainingHits, KOIZUMI_BARRIER_MAX_HITS);
  assert.equal(allyShot.alive, true);

  // 把 P2 破盾进入 5 秒恢复倒计时：同阵营 P1 弹体穿越 P2 护盾边界不得重置修复计时。
  for (let i = 0; i < KOIZUMI_BARRIER_MAX_HITS; i += 1) {
    consumeKoizumiBarrierHit(p2, { x: p2Geo.x + p2Geo.radius, y: p2Geo.y, normalX: 1, normalY: 0 }, "P3");
  }
  assert.equal(p2.koizumiBarrier.remainingHits, 0);
  const initialDisabledUntil = p2.koizumiBarrier.disabledUntil;
  host.elapsed = 2;
  const phase3 = createProjectilePhase(host);
  const allyCrossingShot = host.spawnProjectile({
    team: p1,
    source: p1.ships.main,
    x: p2Geo.x - p2Geo.radius - 20,
    y: p2Geo.y,
    targetX: p2Geo.x + p2Geo.radius + 20,
    targetY: p2Geo.y,
    speed: 500,
    damage: 10,
    radius: 3,
  });
  assert.equal(phase3.intercept(allyCrossingShot, 1), false);
  assert.equal(p2.koizumiBarrier.disabledUntil, initialDisabledUntil, "同阵营弹体穿越破盾边界不得重置护盾修复计时");
  // 推进至恢复时间，finish() 按 allTeams() 自动修复 P2 护盾。
  host.elapsed = initialDisabledUntil;
  phase3.finish();
  assert.equal(p2.koizumiBarrier.remainingHits, KOIZUMI_BARRIER_MAX_HITS, "破盾静默到期后应正常恢复满盾");

  // 多敌队冲撞破盾：盟友刀锋穿盾不破盾，敌对刀锋穿盾立即破盾。
  p1.configureFormation(2);
  p4.configureFormation(2);
  const p1Asakura = p1.ships.sub1;
  const p4Asakura = p4.ships.sub2;
  p1Asakura.activateTimedEffect("bladeQueenUntil", 10);
  p4Asakura.activateTimedEffect("bladeQueenUntil", 10);
  const r2 = koizumiBarrierGeometry(p2).radius;
  placeShip(p1Asakura, p2.ships.main.x - r2 - 20, p2.ships.main.y, 0);
  p1Asakura.captureFlightOrigin();
  placeShip(p1Asakura, p2.ships.main.x - r2 + 15, p2.ships.main.y, 0);
  placeShip(p4Asakura, p2.ships.main.x + r2 + 20, p2.ships.main.y, Math.PI);
  p4Asakura.captureFlightOrigin();
  placeShip(p4Asakura, p2.ships.main.x + r2 + 20, p2.ships.main.y, Math.PI);
  resolveKoizumiBarrierRamContacts(host);
  assert.equal(p2.koizumiBarrier.remainingHits, KOIZUMI_BARRIER_MAX_HITS, "盟友冲撞技能不得击破同阵营护盾");

  p4Asakura.captureFlightOrigin();
  placeShip(p4Asakura, p2.ships.main.x + r2 - 15, p2.ships.main.y, Math.PI);
  resolveKoizumiBarrierRamContacts(host);
  assert.equal(p2.koizumiBarrier.remainingHits, 0, "敌对冲撞技能应击破目标护盾");
}

// =========================================================================
// 4. 多敌队范围接触（刀锋周期、光球冲击波、春日冲撞与勇者之力）
// =========================================================================
{
  const topology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", { main: "haruhi", sub1: "asakura", sub2: "koizumi" }, { x: 500, y: 500, facing: 0 }),
      makeFleetConfig("P2", "side1", { main: "kyon", sub1: "haruhi", sub2: "yuki" }, { x: 500, y: 500, facing: 0 }),
      makeFleetConfig("P3", "side2", { main: "kyon", sub1: "yuki", sub2: "tsuruya" }, { x: 500, y: 500, facing: Math.PI }),
      makeFleetConfig("P4", "side3", { main: "kyon", sub1: "yuki", sub2: "tsuruya" }, { x: 500, y: 500, facing: Math.PI }),
      makeFleetConfig("P5", "side4", { main: "kyon", sub1: "yuki", sub2: "tsuruya" }, { x: 500, y: 500, facing: Math.PI }),
    ],
  });
  const { host, teams, heroPowers } = createMultiFleetEffectsHost(topology, { seed: 447 });
  const [p1, p2, p3, p4, p5] = teams;
  for (const team of teams) team.configureFormation(2);

  // 4a. 朝仓刀锋：三个敌队（P3/P4/P5）与盟友 P2 均在刀锋范围内。
  const blade = p1.ships.sub1;
  placeShip(blade, 500, 500, 0);
  placeShip(p2.ships.main, 510, 500, 0);
  placeShip(p3.ships.main, 512, 500, Math.PI);
  placeShip(p4.ships.main, 508, 505, Math.PI);
  placeShip(p5.ships.main, 506, 495, Math.PI);
  // 其余副舰移远避免干扰计数。
  for (const ship of [p1.ships.main, p1.ships.sub2, p2.ships.sub1, p2.ships.sub2,
    p3.ships.sub1, p3.ships.sub2, p4.ships.sub1, p4.ships.sub2, p5.ships.sub1, p5.ships.sub2]) {
    placeShip(ship, 1200, 1200, 0);
  }
  blade.activateTimedEffect("bladeQueenUntil", 10);
  host.elapsed = 1;
  resolveBladeQueenContacts(host);
  const hitCountByTarget = () => {
    const counts = new Map();
    for (const entry of host.recordedDamage) {
      counts.set(entry.targetId, (counts.get(entry.targetId) || 0) + 1);
    }
    return counts;
  };
  let counts = hitCountByTarget();
  assert.equal(counts.get(p2.ships.main.id) || 0, 0, "刀锋接触不得伤害盟友");
  assert.equal(counts.get(p3.ships.main.id), 1);
  assert.equal(counts.get(p4.ships.main.id), 1);
  assert.equal(counts.get(p5.ships.main.id), 1);

  // 持续接触但未到周期边界（hitInterval = 1）：不得重复扣血。
  host.elapsed = 1.5;
  resolveBladeQueenContacts(host);
  host.elapsed = 1.9;
  resolveBladeQueenContacts(host);
  counts = hitCountByTarget();
  assert.equal(counts.get(p3.ships.main.id), 1);
  assert.equal(counts.get(p4.ships.main.id), 1);
  assert.equal(counts.get(p5.ships.main.id), 1);

  // 跨过周期边界（hitInterval = 1）：三个敌队各自恰好再受 1 次伤害。
  host.elapsed = 2.05;
  resolveBladeQueenContacts(host);
  counts = hitCountByTarget();
  assert.equal(counts.get(p3.ships.main.id), 2);
  assert.equal(counts.get(p4.ships.main.id), 2);
  assert.equal(counts.get(p5.ships.main.id), 2);
  assert.equal(counts.get(p2.ships.main.id) || 0, 0);

  // 4b. 古泉超能力光球碰撞与扩散冲击波：仅敌对受击退/沉默/眩晕且每波去重。
  const orbShip = p1.ships.sub2;
  placeShip(orbShip, 460, 500, 0);
  assert.equal(activateKoizumiOrb(orbShip, 8), true);
  sampleKoizumiOrbMotion(orbShip);
  placeShip(orbShip, 515, 500, 0);
  resolveKoizumiOrbContacts(host);
  assert.equal(p2.ships.main.isSilenced(), false, "盟友不受光球沉默");
  assert.equal(p3.ships.main.isSilenced(), true);
  assert.equal(p4.ships.main.isSilenced(), true);
  assert.equal(p5.ships.main.isSilenced(), true);

  // 推进冲击波覆盖全部舰船，确认盟友不眩晕且同波多次推进不续期眩晕。
  host.elapsed += 0.1;
  updateKoizumiImpactWaves(host);
  assert.equal(p2.ships.main.hasEffect("stunnedUntil"), false, "盟友不受冲击波眩晕");
  const p3StunUntil = p3.ships.main.effects.stunnedUntil;
  assert.ok(p3StunUntil > host.elapsed);
  host.elapsed += 0.05;
  updateKoizumiImpactWaves(host);
  assert.equal(p3.ships.main.effects.stunnedUntil, p3StunUntil, "同一圈冲击波不得对同一目标重复续期眩晕");

  // 4c. 春日异世界人冲撞：在全敌方中按前沿 localX 选中唯一目标触发一次。
  p2.ships.main.clearControlEffects();
  p3.ships.main.clearControlEffects();
  p4.ships.main.clearControlEffects();
  p5.ships.main.clearControlEffects();
  const haruhiMain = p1.ships.main;
  placeShip(haruhiMain, 300, 300, 0);
  haruhiMain.setFlightSpeed(haruhiMain.effectiveSpeed());
  let readyGuard = 0;
  while (!p1.haruhiFlagship.supporters.has("otherworlder") && readyGuard < 10) {
    activateHaruhiFlagship(p1, 16, host.rng.next);
    readyGuard += 1;
  }
  assert.ok(p1.haruhiFlagship.supporters.has("otherworlder"));
  // 盟友 P2 最近（忽略），敌对 P4 比 P3 更靠前（localX 更小），应命中 P4 而非 P3。
  placeShip(p2.ships.main, 305, 300, 0);
  placeShip(p3.ships.main, 330, 300, Math.PI);
  placeShip(p4.ships.main, 315, 300, Math.PI);
  placeShip(p5.ships.main, 900, 900, Math.PI);
  resolveHaruhiOtherworlderContacts(host);
  assert.equal(Boolean(p2.ships.main.forcedKnockback), false, "异世界人冲撞不得作用于盟友");
  assert.equal(Boolean(p4.ships.main.forcedKnockback), true, "异世界人冲撞应在全部敌队中选出最前沿目标");
  assert.equal(Boolean(p3.ships.main.forcedKnockback), false, "一次冲撞只触发一个前沿目标并进入冷却");

  // 4d. 勇者之力：命中多个敌队并去重，不震慑盟友，清理全部范围内飞行器。
  const heroCaster = p2.ships.sub1;
  placeShip(heroCaster, 800, 800, 0);
  placeShip(p1.ships.main, 820, 800, 0);
  placeShip(p3.ships.main, 830, 800, Math.PI);
  placeShip(p4.ships.main, 800, 835, Math.PI);
  placeShip(p5.ships.main, 770, 800, Math.PI);
  const p1Scout = new Scout(p1, 815, 810, { zone: host.zoneById(5) });
  const p3Scout = new Scout(p3, 825, 810, { zone: host.zoneById(5) });
  const p4Wingman = new Wingman(p4, 790, 810, host.zoneById(5));
  p1.addScout(p1Scout);
  p3.addScout(p3Scout);
  p4.addWingman(p4Wingman);

  host.elapsed = 10;
  heroPowers.enqueue(heroCaster, {});
  const queued = heroPowers.inspect()[0];
  host.elapsed = queued.releaseAt;
  heroPowers.advance();
  const released = heroPowers.inspect()[0];
  assert.equal(released.phase, "shock");
  assert.deepEqual(
    released.hitShipIds,
    [p3.ships.main.id, p4.ships.main.id, p5.ships.main.id],
    "勇者之力应一次命中多个敌队并排除同阵营盟友",
  );
  assert.equal(p1.ships.main.canControl(), true, "盟友不得被勇者之力震慑");
  assert.deepEqual(
    released.destroyedAircraftIds,
    [p1Scout.id, p3Scout.id, p4Wingman.id],
    "勇者之力按全舰队顺序清理范围内所有航空单位且无重复",
  );
}

// =========================================================================
// 5. 多猎杀者标记同一目标并击杀：每来源恰好通知一次，无候选不消费随机数
// =========================================================================
{
  const topology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", { main: "shamisen", sub1: "kyon", sub2: "yuki" }, { x: 200, y: 300, facing: 0 }),
      makeFleetConfig("P2", "side1", { main: "shamisen", sub1: "kyon", sub2: "yuki" }, { x: 200, y: 900, facing: 0 }),
      makeFleetConfig("P3", "side2", { main: "kyon", sub1: "yuki", sub2: "tsuruya" }, { x: 1100, y: 300, facing: Math.PI }),
      makeFleetConfig("P4", "side2", { main: "kyon", sub1: "yuki", sub2: "tsuruya" }, { x: 1100, y: 900, facing: Math.PI }),
    ],
  });
  const { host, teams, feedback } = createMultiFleetEffectsHost(topology, { seed: 455 });
  const [p1, p2, p3, p4] = teams;

  // 先清除除 P3 主舰与 P4 主舰外的敌方副舰，确保两猎杀者共同标记 P3 主舰（随机值固定取 0 选中首项 P3 主舰）。
  p3.ships.sub1.retireWithoutLoss();
  p3.ships.sub2.retireWithoutLoss();
  p4.ships.sub1.retireWithoutLoss();
  p4.ships.sub2.retireWithoutLoss();
  ensureShamisenHuntTarget(p1, host.hostileView("P1"), () => 0);
  ensureShamisenHuntTarget(p2, host.hostileView("P2"), () => 0);
  assert.equal(p1.shamisenHunt.targetId, p3.ships.main.id);
  assert.equal(p2.shamisenHunt.targetId, p3.ships.main.id);

  // 状态卡验证：双猎杀者同标同一目标，状态卡仅显示一条 hunt；盟友无 hunt 状态。
  const p3Statuses = p3.ships.main.serialize().statusEffects.filter((item) => item.id === "hunt");
  assert.equal(p3Statuses.length, 1, "多猎杀者标记同一目标时状态卡去重显示一次");
  assert.equal(p1.ships.main.serialize().statusEffects.some((item) => item.id === "hunt"), false);

  // 合法击杀 P3 主舰：P1 与 P2 各自恰好收到一次击杀特效通知并重选到 P4 主舰。
  p3.ships.main.takeDamage(p3.ships.main.maxHp * 2, p1.ships.main, host);
  const killEffects = feedback.inspectHuntKills();
  assert.equal(killEffects.length, 2, "两个标记该目标的猎杀者应各自恰好收到一次通知");
  assert.deepEqual(killEffects.map((item) => item.hunterSeat), ["P1", "P2"]);
  assert.equal(p1.shamisenHunt.targetId, p4.ships.main.id);
  assert.equal(p2.shamisenHunt.targetId, p4.ships.main.id);
  assert.equal(p1.visibleEnemyIds.has(p4.ships.main.id), false, "猎杀标记不得被当作真实视野");

  // 击杀最后存活的敌舰 P4 主舰：无合法重选候选时，不得额外消费随机数。
  let rngCalls = 0;
  const originalNext = host.rng.next;
  host.rng = {
    ...host.rng,
    next: () => {
      rngCalls += 1;
      return originalNext();
    },
  };
  p4.ships.main.takeDamage(p4.ships.main.maxHp * 2, p2.ships.main, host);
  assert.equal(feedback.inspectHuntKills().length, 4, "再次击杀后两来源各新增一条通知");
  assert.equal(p1.shamisenHunt.targetId, null);
  assert.equal(p2.shamisenHunt.targetId, null);
  assert.equal(rngCalls, 0, "无合法重选目标时不得消耗随机数");
}

// =========================================================================
// 6. 多源波带同帧采样与净化顺序（三方混战 + 2v2 友方仅本舰队边界）
// =========================================================================
{
  // 6a. 三方混战同帧互扫：先全采样，后先净本方负面，再清敌方正面，前席净化不吞掉后席已采样结果。
  const ffaTopology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "s1", { main: "asakura", sub1: "kyon", sub2: "yuki" }, { x: 700, y: 700, facing: 0 }),
      makeFleetConfig("P2", "s2", { main: "asakura", sub1: "kyon", sub2: "yuki" }, { x: 700, y: 700, facing: 0 }),
      makeFleetConfig("P3", "s3", { main: "asakura", sub1: "kyon", sub2: "yuki" }, { x: 700, y: 700, facing: 0 }),
    ],
  });
  const { host, teams } = createMultiFleetEffectsHost(ffaTopology, { seed: 461 });
  for (const team of teams) {
    placeShip(team.ships.main, 700, 700, 0);
    assert.equal(team.castFlagshipSkill(), true);
    team.ships.main.silenceUntil(10);
  }
  host.tick += 1;
  host.elapsed += TICK_DT;
  const basePort = host.visionWavePurgePort;
  const phaseTrace = [];
  let mutated = false;
  resolveVisionWavePurges({
    friendlyPairs: () => basePort.friendlyPairs(),
    hostilePairs: () => basePort.hostilePairs(),
    targets: (source, target) => {
      assert.equal(mutated, false, "全部配对采样必须在首次净化提交前完成");
      phaseTrace.push(`sample:${source}->${target}`);
      return basePort.targets(source, target);
    },
    clearNegative: (handle) => {
      mutated = true;
      phaseTrace.push(`neg:${handle.id}`);
      return basePort.clearNegative(handle);
    },
    clearPositive: (seat, handle) => {
      mutated = true;
      phaseTrace.push(`pos:${seat}:${handle.id}`);
      return basePort.clearPositive(seat, handle);
    },
    present: (handle, friendly) => basePort.present(handle, friendly),
  });
  for (const team of teams) {
    assert.equal(team.ships.main.isSilenced(), false, `${team.seat} 本舰队负面必须被净化`);
    assert.equal(team.hasActiveVisionWaveSkill(), false, `${team.seat} 正面波带必须被其他来源已采样命中清除`);
  }
  // 三方 6 组敌对 + 3 组本舰队 = 9 次采样，全在首次修改前完成。
  assert.equal(phaseTrace.filter((entry) => entry.startsWith("sample:")).length, 9);
  assert.ok(phaseTrace.indexOf(`neg:${teams[0].ships.main.id}`) > 8);

  // 6b. 2v2 友方边界：朝仓波带净化本舰队负面，不扩散净化同阵营盟友，也不清除盟友正面增益。
  const teamTopology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", { main: "asakura", sub1: "kyon", sub2: "yuki" }, { x: 700, y: 700, facing: 0 }),
      makeFleetConfig("P2", "side1", { main: "kyon", sub1: "asakura", sub2: "yuki" }, { x: 700, y: 700, facing: 0 }),
      makeFleetConfig("P3", "side2", { main: "kyon", sub1: "yuki", sub2: "tsuruya" }, { x: 700, y: 700, facing: Math.PI }),
      makeFleetConfig("P4", "side2", { main: "kyon", sub1: "yuki", sub2: "tsuruya" }, { x: 1200, y: 1200, facing: Math.PI }),
    ],
  });
  const teamCase = createMultiFleetEffectsHost(teamTopology, { seed: 462 });
  const [tp1, tp2, tp3] = teamCase.teams;
  placeShip(tp1.ships.main, 700, 700, 0);
  placeShip(tp2.ships.main, 700, 700, 0);
  placeShip(tp3.ships.main, 700, 700, Math.PI);
  assert.equal(tp1.castFlagshipSkill(), true);
  tp1.ships.main.silenceUntil(10);
  tp2.ships.main.silenceUntil(10);
  tp2.ships.main.activateTimedEffect("reliableUntil", 14);
  tp3.ships.main.activateTimedEffect("reliableUntil", 14);
  teamCase.host.tick += 1;
  teamCase.host.elapsed += TICK_DT;
  resolveVisionWavePurges(teamCase.host.visionWavePurgePort);
  assert.equal(tp1.ships.main.isSilenced(), false, "本舰队负面被净化");
  assert.equal(tp2.ships.main.isSilenced(), true, "盟友负面不自动扩散净化");
  assert.equal(tp2.ships.main.hasEffect("reliableUntil"), true, "盟友正面增益不得被清除");
  assert.equal(tp3.ships.main.hasEffect("reliableUntil"), false, "敌对正面增益应被清除");
}

// =========================================================================
// 7. 多敌队雷达私有接触与权限边界
// =========================================================================
{
  const topology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", { main: "yuki", sub1: "kyon", sub2: "asakura" }, { x: 200, y: 700, facing: 0 }),
      makeFleetConfig("P2", "side1", { main: "kyon", sub1: "asakura", sub2: "tsuruya" }, { x: 200, y: 300, facing: 0 }),
      makeFleetConfig("P3", "side2", { main: "kyon", sub1: "haruhi", sub2: "tsuruya" }, { x: 700, y: 700, facing: Math.PI }),
      makeFleetConfig("P4", "side2", { main: "koizumi", sub1: "shamisen", sub2: "future1096" }, { x: 900, y: 700, facing: Math.PI }),
    ],
  });
  const { host, teams } = createMultiFleetEffectsHost(topology, { seed: 471 });
  const [p1, p2, p3, p4] = teams;

  // 让 P3/P4 主舰位于 P1 视野外但处于 P1 雷达扇区方向，盟友 P2 在同方向。
  placeShip(p1.ships.main, 200, 700, 0);
  placeShip(p2.ships.main, 520, 700, 0);
  placeShip(p3.ships.main, 720, 700, Math.PI);
  placeShip(p4.ships.main, 920, 700, Math.PI);
  for (const ship of [p1.ships.sub1, p1.ships.sub2, p2.ships.sub1, p2.ships.sub2,
    p3.ships.sub1, p3.ships.sub2, p4.ships.sub1, p4.ships.sub2]) {
    placeShip(ship, 1300, 1300, 0);
  }
  for (const team of teams) {
    team.computeVisibility(host.hostileView(team.seat));
  }
  assert.equal(p1.visibleEnemyIds.has(p3.ships.main.id), false);
  assert.equal(p1.visibleEnemyIds.has(p4.ships.main.id), false);

  // 完整扫过一圈（radar 扫描一周约 2.2s），捕获全部隐藏敌对主舰的误差接触。
  host.elapsed = 2.2;
  host.tick = 66;
  for (const team of teams) {
    updateRadarPassive(team, host.hostileView(team.seat), 2.2);
  }
  const p1Radar = p1.serializeRadarPassive();
  const p2Radar = p2.serializeRadarPassive();
  const p1PublicSweep = serializeRadarSweep(p1);
  assert.ok(p1Radar, "有希主舰应产生私有雷达快照");
  const contactIds = new Set(p1Radar.contacts.map((contact) => contact.targetId));
  assert.equal(contactIds.has(p3.ships.main.id), true, "应捕获第一支敌队隐藏目标");
  assert.equal(contactIds.has(p4.ships.main.id), true, "应捕获第二支敌队隐藏目标");
  assert.equal(contactIds.has(p2.ships.main.id), false, "盟友不得进入敌方雷达接触");
  for (const contact of p1Radar.contacts) {
    assert.equal(contact.hp, undefined, "雷达回波不得泄露未许可的实体血量");
    assert.equal(contact.team, undefined, "雷达回波不得泄露实体所属对象");
  }
  assert.equal(p1.visibleEnemyIds.has(p3.ships.main.id), false, "雷达误差接触不得提升为普通真实视野");
  assert.equal(p1.visibleEnemyIds.has(p4.ships.main.id), false);
  assert.equal(p2Radar, null, "盟友舰队不得共享另一席的私有雷达");
  assert.equal(Object.hasOwn(p1PublicSweep, "contacts"), false, "公开扫线不得向观众泄露私有回波");
}

// =========================================================================
// 8. 技能后全舰队视野刷新顺序、显名边界（仅盟友可见不误显，任一敌队可见即显名）与猎杀弹色透传
// =========================================================================
{
  const topology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", { main: "haruhi", sub1: "shamisen", sub2: "kyon" }, { x: 200, y: 200, facing: 0 }),
      makeFleetConfig("P2", "side1", { main: "kyon", sub1: "shamisen", sub2: "yuki" }, { x: 220, y: 200, facing: 0 }),
      makeFleetConfig("P3", "side2", { main: "kyon", sub1: "shamisen", sub2: "yuki" }, { x: 1200, y: 1200, facing: Math.PI }),
      makeFleetConfig("P4", "side2", { main: "kyon", sub1: "shamisen", sub2: "yuki" }, { x: 1200, y: 200, facing: Math.PI }),
    ],
  });
  const { host, teams } = createMultiFleetEffectsHost(topology, { seed: 481 });
  const [p1, p2, p3, p4] = teams;

  // 记录技能后 refreshVisibility 调用顺序。
  const refreshOrder = [];
  for (const team of teams) {
    const orig = team.computeVisibility.bind(team);
    team.computeVisibility = (view) => {
      refreshOrder.push(team.seat);
      return orig(view);
    };
  }

  // 8a. 仅同阵营盟友 P2 在 P1 身旁，P3 与 P4 均在视野外：P1 施放副技能不得误显名。
  p1.configureFormation(2);
  p2.configureFormation(2);
  p3.configureFormation(2);
  p4.configureFormation(2);
  placeShip(p1.ships.sub1, 200, 200, 0);
  placeShip(p2.ships.main, 220, 200, 0);
  placeShip(p3.ships.main, 1200, 1200, Math.PI);
  placeShip(p4.ships.main, 1200, 200, Math.PI);
  for (const team of teams) team.computeVisibility(host.hostileView(team.seat));
  refreshOrder.length = 0;

  const skillPort = createTeamSkillPort(p1, {});
  skillPort.refreshVisibility();
  assert.deepEqual(refreshOrder, ["P1", "P2", "P3", "P4"], "技能后视野刷新必须按 seatOrder 刷新全部舰队视野");

  assert.equal(p1.castSubSkill("sub1"), true, "P1 三味线副舰施放猫爪连射成功");
  assert.equal(p1.ships.sub1.nameRevealed, false, "仅盟友在附近而无敌队可见时不得误显名");

  // 8b. 多席下三味线猎杀弹色透传自 team.huntColor，而非仅靠 seat === "A" 分支。
  for (const team of teams) {
    team.ships.sub1.activateTimedEffect("catPawUntil", 12);
    const profile = host.rules.projectileProfile(team.ships.sub1);
    assert.equal(profile.visualKind, "cat_paw");
    assert.equal(profile.color, team.huntColor, `${team.seat} 猫爪弹颜色应透传自本舰队 huntColor`);
    assert.ok(typeof profile.color === "string" && profile.color.length > 0);
  }
  assert.notEqual(p1.huntColor, p3.huntColor, "多席舰队应拥有区分化的派生猎杀弹色");

  // 8c. 仅第二支敌队 P4 可见 P1 主舰（P3 仍不可见）：P1 施放旗舰技能后立即显名。
  placeShip(p1.ships.main, 200, 500, 0);
  placeShip(p4.ships.main, 250, 500, Math.PI);
  for (const team of teams) team.computeVisibility(host.hostileView(team.seat));
  assert.equal(p3.visibleEnemyIds.has(p1.ships.main.id), false);
  assert.equal(p4.visibleEnemyIds.has(p1.ships.main.id), true);
  assert.equal(p1.ships.main.nameRevealed, false);
  assert.equal(p1.castFlagshipSkill(), true);
  assert.equal(p1.ships.main.nameRevealed, true, "任一敌对舰队可见即应显名");
}

// =========================================================================
// 9. 默认 1v1 与显式 A/B 拓扑的技能等价性与色值兼容（含九角色覆盖）
// =========================================================================
{
  const pairs = [
    {
      A: { main: "haruhi", sub1: "future1096", sub2: "shamisen" },
      B: { main: "koizumi", sub1: "asakura", sub2: "yuki" },
    },
    {
      A: { main: "asakura", sub1: "koizumi", sub2: "kyon" },
      B: { main: "shamisen", sub1: "haruhi", sub2: "tsuruya" },
    },
  ];
  for (let index = 0; index < pairs.length; index += 1) {
    const loadouts = pairs[index];
    const spawns = defaultLegacySpawns(DEFAULT_WORLD_SIZE);
    const legacy = new MatchSimulation({ seed: 490 + index, mode: "pvp", aiSeats: [], teamLoadouts: loadouts });
    const explicit = new MatchSimulation({
      seed: 490 + index,
      mode: "pvp",
      aiSeats: [],
      fleets: [
        { seat: "A", sideId: "side1", name: "玩家A舰队", loadout: loadouts.A, spawn: spawns.A },
        { seat: "B", sideId: "side2", name: "玩家B舰队", loadout: loadouts.B, spawn: spawns.B },
      ],
    });
    assert.equal(legacy.teamA.huntColor, "#8fe8ff");
    assert.equal(legacy.teamB.huntColor, "#ff9eb8");
    assert.equal(explicit.teamA.huntColor, "#8fe8ff");
    assert.equal(explicit.teamB.huntColor, "#ff9eb8");

    for (const sim of [legacy, explicit]) {
      sim.teamA.split(1);
      sim.teamB.split(1);
      sim.teamA.castFlagshipSkill();
      sim.teamB.castFlagshipSkill();
      if (loadouts.A.sub1 === "future1096") {
        sim.teamA.castSubSkill("sub1", { targetX: sim.teamB.ships.main.x, targetY: sim.teamB.ships.main.y });
      } else {
        sim.teamA.castSubSkill("sub1");
      }
      sim.teamB.castSubSkill("sub1");
    }
    for (let frame = 0; frame < 90; frame += 1) {
      legacy.update(TICK_DT);
      explicit.update(TICK_DT);
    }
    assert.deepEqual(
      explicit.serializeState(),
      legacy.serializeState(),
      `默认与显式 A/B 拓扑在技能组合 #${index + 1} 下必须逐帧完全等价`,
    );
  }
}

console.log("多舰队跨来源技能验证通过：光线统一倍率、多护盾竞争与截断、弹体拦截与友军豁免、范围接触去重、多猎杀通知、波带全采样净化、私有雷达边界、全席视野刷新与显名及默认 1v1 等价。");
