import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CHARACTER_DEFS,
  CHARACTER_ORDER,
  MatchSimulation,
  randomAiLoadout,
} from "../shared/game-core.js";
import { setLocale, skillText, t } from "../src/i18n.js";

function runSteps(sim, seconds) {
  const steps = Math.ceil(seconds / (1 / 30));
  for (let index = 0; index < steps; index += 1) sim.update(1 / 30);
}

function characterDefinitionContract() {
  assert.ok(CHARACTER_ORDER.includes("shamisen"), "三味线必须进入角色顺序");
  assert.equal(CHARACTER_DEFS.shamisen.stats.speed, 39, "三味线航速应为39");
  assert.equal(CHARACTER_DEFS.shamisen.subSkill.id, "cat_paw_barrage", "三味线分舰技ID不正确");
  assert.equal(CHARACTER_DEFS.shamisen.subSkill.triggerHits, 5, "猫爪连击需要五次命中");
  for (let index = 0; index < 40; index += 1) {
    assert.notEqual(randomAiLoadout().main, "shamisen", "三味线不应作为随机AI旗舰");
  }
}

async function portraitResourceConsumerContract() {
  const [onlineSource, soloSource] = await Promise.all([
    readFile(new URL("../src/online.js", import.meta.url), "utf8"),
    readFile(new URL("../src/solo.js", import.meta.url), "utf8"),
  ]);
  for (const [name, source] of [["online", onlineSource], ["solo", soloSource]]) {
    assert.ok(source.includes("getPortraitAssetUrl"), `${name} result portraits must use the shared asset mapper`);
    assert.ok(source.includes("const src = getPortraitAssetUrl(id, faction);"), `${name} Shamisen result portrait must resolve shamisen-paw.webp`);
  }
}

function shamisenCatPawContract() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "haruhi", sub1: "shamisen", sub2: "yuki" },
      B: { main: "kyon", sub1: "koizumi", sub2: "tsuruya" },
    },
  });
  const team = sim.teamA;
  team.split(1);
  const shamisen = team.ships.sub1;
  const enemy = sim.teamB.ships.main;
  shamisen.x = 680;
  shamisen.y = 720;
  shamisen.angle = 0;
  shamisen.route = null;
  shamisen.throttle = 0;
  enemy.x = 820;
  enemy.y = 720;
  enemy.hp = enemy.maxHp = 1000;
  enemy.route = null;
  team.visibleEnemyIds.add(enemy.id);
  assert.equal(team.castSubSkill("sub1"), true, "三味线分舰技应可释放");
  shamisen.cooldown = 0;
  team.stepCombat(sim.teamB);
  assert.equal(sim.projectiles[0]?.visualKind, "cat_paw", "猫爪技应产生猫爪弹丸");
  assert.equal(sim.projectiles[0]?.claw?.triggerHits, 5, "猫爪弹丸应携带连击阈值");
  runSteps(sim, 8);
  assert.ok(enemy.hp < enemy.maxHp, "猫爪攻击应造成伤害");
}

function future1096FormContract() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "future1096", sub1: "haruhi", sub2: "kyon" },
      B: { main: "yuki", sub1: "koizumi", sub2: "tsuruya" },
    },
  });
  const team = sim.teamA;
  assert.equal(team.future1096Form, null, "1096初始不应预设形态");
  assert.equal(team.extraShips.length, 0, "1096新形态不应生成旧版僚舰");
  assert.equal(team.castFlagshipSkill(), true, "1096首次形态切换应成功");
  assert.equal(team.future1096Form, "A", "1096首次使用应进入A形态");
  assert.equal(team.cooldowns.flagship, 10, "1096形态冷却应为10秒");
  assert.equal(team.castFlagshipSkill(), false, "1096冷却中不能重复切换");
  runSteps(sim, 10.1);
  assert.equal(team.castFlagshipSkill(), true, "1096冷却后应能切换B形态");
  assert.equal(team.future1096Form, "B", "1096第二次使用应进入B形态");
  assert.equal(team.serialize().future1096Form, "B", "1096形态必须进入权威快照");
}

function yukiCombatScoutContract() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "yuki", sub1: "haruhi", sub2: "koizumi" },
      B: { main: "kyon", sub1: "tsuruya", sub2: "future1096" },
    },
  });
  const team = sim.teamA;
  assert.equal(team.launchScout(5, { fromShipKey: "sub1" }), true, "长门应能释放侦察机");
  const scout = team.scouts[0];
  assert.equal(scout.combatCapable, true, "长门侦察机应成为战斗僚机");
  assert.equal(scout.vision, CHARACTER_DEFS.yuki.stats.vision, "战斗僚机视野应等于长门舰船视野");
  assert.equal(scout.attackRange, scout.vision, "战斗僚机射程应等于自身视野");
  assert.equal(scout.damage, 16, "战斗僚机伤害应为16");
  assert.equal(scout.fireRate, CHARACTER_DEFS.yuki.stats.fireRate, "战斗僚机射速应使用常规舰炮射速");
}

function asakuraVisionWaveContract() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "asakura", sub1: "haruhi", sub2: "yuki" },
      B: { main: "kyon", sub1: "koizumi", sub2: "tsuruya" },
    },
  });
  const team = sim.teamA;
  assert.equal(team.castFlagshipSkill(), true, "朝仓资讯压制应可释放");
  assert.ok(team.hasActiveVisionWaveSkill(), "朝仓技能应进入视野波状态");
  assert.equal(team.visionWaveSkill.waves.length, 1, "朝仓技能应立即发射首个视野波");
  assert.equal(team.visionWaveSkill.waves[0].speed, 480, "视野波传播速度应为480");
  assert.ok(team.visionWaveSkill.waves[0].width >= sim.worldSize * 0.11, "视野波宽度应覆盖规则下限");
}

function asakuraVisionWaveRuntimeContract() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "asakura", sub1: "haruhi", sub2: "yuki" },
      B: { main: "kyon", sub1: "koizumi", sub2: "tsuruya" },
    },
  });
  const source = sim.teamA.ships.main;
  const nearEnemy = sim.teamB.ships.sub1;
  const farEnemy = sim.teamB.ships.main;
  sim.teamB.split(1);
  Object.assign(source, { x: 280, y: 720, route: null, throttle: 0 });
  Object.assign(nearEnemy, { x: 540, y: 720, route: null, throttle: 0 });
  Object.assign(farEnemy, { x: 1100, y: 720, route: null, throttle: 0 });
  source.command.x = source.x;
  source.command.y = source.y;
  nearEnemy.command.x = nearEnemy.x;
  nearEnemy.command.y = nearEnemy.y;
  farEnemy.command.x = farEnemy.x;
  farEnemy.command.y = farEnemy.y;
  nearEnemy.effects.critUntil = sim.elapsed + 20;
  farEnemy.effects.critUntil = sim.elapsed + 20;
  assert.equal(sim.teamA.castFlagshipSkill(), true, "朝仓旗舰技应能释放");
  assert.ok(nearEnemy.effects.critUntil > sim.elapsed, "波尚未命中时不应提前净化近处敌舰");
  assert.ok(farEnemy.effects.critUntil > sim.elapsed, "波尚未命中时不应提前净化远处敌舰");
  runSteps(sim, 0.7);
  assert.equal(nearEnemy.effects.critUntil, 0, "视野波扫到敌舰后应净化该舰主动增益");
  assert.ok(farEnemy.effects.critUntil > sim.elapsed, "未被当前波扫到的敌舰不应被净化");
  runSteps(sim, 0.9);
  assert.equal(farEnemy.effects.critUntil, 0, "视野波传播到远处敌舰后应净化其主动增益");
  assert.ok(sim.teamA.visibleEnemyIds.has(farEnemy.id), "视野波传播到敌舰后应提供真实视野");

  const simultaneous = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "asakura", sub1: "haruhi", sub2: "yuki" },
      B: { main: "asakura", sub1: "haruhi", sub2: "yuki" },
    },
  });
  simultaneous.teamA.castFlagshipSkill();
  simultaneous.teamB.castFlagshipSkill();
  assert.ok(simultaneous.teamA.hasActiveVisionWaveSkill(), "同 tick 施法不应清除 A 方视野波");
  assert.ok(simultaneous.teamB.hasActiveVisionWaveSkill(), "同 tick 施法不应清除 B 方视野波");
}

function hiddenVisionWaveSnapshotContract() {
  const fleetLayout = {
    alliances: {
      A: [{ seat: "A1", control: "human", loadout: { main: "haruhi", sub1: "koizumi", sub2: "yuki" } }],
      B: [{ seat: "B1", control: "human", loadout: { main: "asakura", sub1: "haruhi", sub2: "yuki" } }],
    },
  };
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    fleetLayout,
  });
  const friendly = sim.fleetBySeat("A1").ships.main;
  const enemyFleet = sim.fleetBySeat("B1");
  const enemy = enemyFleet.ships.main;
  Object.assign(friendly, { x: 220, y: 720, route: null, throttle: 0 });
  Object.assign(enemy, { x: 1220, y: 720, route: null, throttle: 0 });
  friendly.command.x = friendly.x;
  friendly.command.y = friendly.y;
  enemy.command.x = enemy.x;
  enemy.command.y = enemy.y;
  assert.equal(enemyFleet.castFlagshipSkill(), true, "隐身朝仓应能释放视野波");

  const snapshot = sim.buildSnapshotForViewer("A1");
  const hiddenEnemy = snapshot.fleets.B1;
  assert.ok(hiddenEnemy, "敌方无可见实体时仍应同步公开视野波");
  assert.equal(hiddenEnemy.visionWaves.length, 1, "敌方视野波应进入不可见敌舰的快照");
  assert.deepEqual(hiddenEnemy.ships, {}, "仅同步波形时不应泄露敌舰实体");
  assert.equal(hiddenEnemy.loadout, undefined, "仅同步波形时不应泄露敌方编队");
}

function asakuraVisionWaveTeamBuffContract() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "asakura", sub1: "haruhi", sub2: "yuki" },
      B: { main: "koizumi", sub1: "haruhi", sub2: "tsuruya" },
    },
  });
  const source = sim.teamA.ships.main;
  const hitSub = sim.teamB.ships.sub1;
  const enemyMain = sim.teamB.ships.main;
  sim.teamB.split(1);
  Object.assign(source, { x: 280, y: 720, route: null, throttle: 0 });
  Object.assign(hitSub, { x: 540, y: 720, route: null, throttle: 0 });
  Object.assign(enemyMain, { x: 1100, y: 720, route: null, throttle: 0 });
  for (const ship of [source, hitSub, enemyMain]) {
    ship.command.x = ship.x;
    ship.command.y = ship.y;
  }
  assert.equal(sim.teamB.castFlagshipSkill(), true, "敌方古泉应能施放编队增益");
  assert.ok(sim.teamB.effects.taxiUntil > sim.elapsed, "敌方编队增益应处于生效状态");
  assert.equal(sim.teamA.castFlagshipSkill(), true, "朝仓旗舰技应能释放");
  runSteps(sim, 0.7);
  assert.ok(sim.teamB.effects.taxiUntil <= sim.elapsed, "视野波扫到副舰后应清除该舰的编队主动增益");
  assert.ok(sim.teamB.effects.taxiInvulnUntil <= sim.elapsed, "视野波扫到副舰后应清除该舰的编队无敌");
}

function yukiRadarContract() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "yuki", sub1: "haruhi", sub2: "koizumi" },
      B: { main: "kyon", sub1: "tsuruya", sub2: "future1096" },
    },
  });
  const enemy = sim.teamB.ships.main;
  enemy.x = 1160;
  enemy.y = 720;
  sim.update(1 / 30);
  sim.update(1 / 30);
  const radar = sim.serializeRadarForSeat("A");
  assert.ok(radar?.active, "长门旗舰应提供私有雷达快照");
  assert.ok(radar.contacts.length >= 1, "雷达扫描应产生视野外敌舰回波");
  assert.equal(sim.serializeRadarForSeat("B"), null, "非长门旗舰不应获得雷达私有状态");
  const contact = radar.contacts[0];
  assert.ok(contact.kind === "afterimage" || contact.kind === "disturbance", "雷达回波应标注类型");
  assert.ok(Number.isFinite(contact.uncertainty) && contact.uncertainty > 0, "雷达回波应携带距离不确定度");
}

function haruhiFlagshipReworkContract() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "haruhi", sub1: "koizumi", sub2: "yuki" },
      B: { main: "kyon", sub1: "tsuruya", sub2: "future1096" },
    },
  });
  const team = sim.teamA;
  const enemy = sim.teamB;
  const ships = team.getAllShips();
  for (const ship of ships) {
    Object.assign(ship, { x: 220, y: 720, route: null, throttle: 0 });
    ship.command.x = ship.x;
    ship.command.y = ship.y;
  }
  for (const ship of enemy.getAllShips()) {
    Object.assign(ship, { x: 1220, y: 720, route: null, throttle: 0 });
    ship.command.x = ship.x;
    ship.command.y = ship.y;
  }

  const main = team.ships.main;
  const before = {
    speed: main.baseSpeed(),
    turnRate: main.baseTurnRate(),
    accel: main.baseAcceleration(),
    range: main.effectiveRange(),
    vision: main.effectiveVision(),
    damage: main.effectiveDamage(),
    fireRate: main.effectiveFireRate(),
    damageTaken: main.damageTakenMultiplier(),
  };

  assert.equal(CHARACTER_DEFS.haruhi.flagshipSkill.id, "im_here", "春日旗舰应使用上游重做后的技能ID");
  assert.equal(team.castFlagshipSkill(), true, "春日旗舰重做后应可直接释放");
  assert.ok(team.effects.haruhiBoostUntil > sim.elapsed, "春日旗舰应记录全队强化持续时间");
  assert.equal(team.haruhiFlagship.supporters.size, 1, "春日每次旗舰施放应永久解锁一项支援");
  const assertMultiplier = (actual, expected, message) => {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: expected ${expected}, got ${actual}`);
  };
  assertMultiplier(main.baseSpeed() / before.speed, 1.15, "春日旗舰应提升全队航速15%");
  assertMultiplier(main.baseTurnRate() / before.turnRate, 1.15, "春日旗舰应提升全队机动15%");
  assertMultiplier(main.baseAcceleration() / before.accel, 1.15, "春日旗舰应提升全队加速15%");
  assertMultiplier(main.effectiveRange() / before.range, 1.15, "春日旗舰应提升全队射程15%");
  assertMultiplier(main.effectiveVision() / before.vision, 1.15, "春日旗舰应提升全队视野15%");
  assertMultiplier(main.effectiveDamage() / before.damage, 1.15, "春日旗舰应提升全队伤害15%");
  assertMultiplier(main.effectiveFireRate() / before.fireRate, 1.15, "春日旗舰应提升全队射速15%");
  assertMultiplier(main.damageTakenMultiplier() / before.damageTaken, 0.85, "春日旗舰应降低全队承伤15%");

  enemy.computeVisibility(team);
  assert.ok(ships.every((ship) => enemy.visibleEnemyIds.has(ship.id)), "春日旗舰期间敌方应获得全舰队真实视野");
  const snapshot = sim.buildSnapshotForViewer("A");
  assert.ok(snapshot.fleets.A.haruhiFlagship?.boostActive, "春日旗舰状态应进入权威快照");
  assert.equal(snapshot.fleets.A.haruhiFlagship.supporters.length, 1, "快照应同步永久支援解锁状态");

  runSteps(sim, 16.1);
  enemy.computeVisibility(team);
  assert.ok(ships.every((ship) => !enemy.visibleEnemyIds.has(ship.id)), "春日旗舰结束后不应继续暴露全舰队");
}

function haruhiPermanentSupportRuntimeContract() {
  const createSimulation = () => new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "haruhi", sub1: "koizumi", sub2: "yuki" },
      B: { main: "kyon", sub1: "tsuruya", sub2: "future1096" },
    },
  });

  const alienSim = createSimulation();
  alienSim.teamA.haruhiFlagship.supporters.add("alien");
  alienSim.teamA.haruhiFlagship.alienNextAt = alienSim.elapsed;
  alienSim.update(1 / 30);
  assert.ok(alienSim.teamA.scouts.some((scout) => scout.combatCapable), "宇宙人支援应定期生成战斗侦察机");

  const futureSim = createSimulation();
  futureSim.teamA.haruhiFlagship.supporters.add("time_traveler");
  futureSim.teamA.haruhiFlagship.timeTravelerNextAt = futureSim.elapsed;
  futureSim.update(1 / 30);
  assert.ok(futureSim.teamA.beams.length >= 1, "未来人支援应定期发射随机方向光线");

  const esperSim = createSimulation();
  esperSim.teamA.haruhiFlagship.supporters.add("esper");
  const esperSnapshot = esperSim.serializeState().teams.A.haruhiFlagship;
  assert.ok(esperSnapshot.esperOrb?.absorbRadius > 0, "超能力者支援应生成可吸弹的环绕球");

  const otherworlderSim = createSimulation();
  const source = otherworlderSim.teamA.ships.main;
  const target = otherworlderSim.teamB.ships.main;
  otherworlderSim.teamA.haruhiFlagship.supporters.add("otherworlder");
  otherworlderSim.teamA.haruhiFlagship.otherworlderReadyAt = otherworlderSim.elapsed;
  Object.assign(source, { x: 600, y: 720, angle: 0, speed: source.effectiveSpeed(), route: null });
  Object.assign(target, { x: 620, y: 720, route: null });
  source.command.x = source.x;
  source.command.y = source.y;
  target.command.x = target.x;
  target.command.y = target.y;
  const beforeHp = target.hp;
  otherworlderSim.update(1 / 30);
  assert.ok(target.hp < beforeHp, "异世界人支援应在正面撞击时造成伤害");
  assert.ok(target.forcedKnockback, "异世界人支援应击退命中的敌方编队");
}

function haruhiAiOpeningFlagshipContract() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    aiSeats: ["B"],
    teamLoadouts: {
      A: { main: "kyon", sub1: "asakura", sub2: "shamisen" },
      B: { main: "haruhi", sub1: "yuki", sub2: "future1096" },
    },
  });
  const bot = sim.botBySeat("B");
  const team = sim.teamB;

  assert.equal(bot.flagshipTimer, 0, "春日 AI 开局应立即检查旗舰技能");
  sim.update(1 / 30);
  assert.equal(team.haruhiFlagship.supporters.size, 1, "春日 AI 开局应解锁首项常驻支援");
  assert.ok(team.effects.haruhiBoostUntil > sim.elapsed, "春日 AI 开局应施放团队强化");
  assert.ok(bot.flagshipTimer >= team.cooldowns.flagship, "春日 AI 的下次旗舰检查应不早于实际冷却");
}

function haruhiAiEnergyReserveContract() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    aiSeats: ["B"],
    teamLoadouts: {
      A: { main: "kyon", sub1: "asakura", sub2: "shamisen" },
      B: { main: "haruhi", sub1: "yuki", sub2: "future1096" },
    },
  });
  const bot = sim.botBySeat("B");
  const team = sim.teamB;
  const meta = CHARACTER_DEFS.haruhi.flagshipSkill;

  team.cooldowns.flagship = 2;
  bot.flagshipTimer = 2;
  for (const ship of team.fleetMembersForShip("main")) {
    ship.energy = 0;
  }
  team.ships.main.energy = meta.cost + 24 - 1;
  assert.equal(bot.shouldReserveEnergyForHaruhiFlagship(), true, "春日旗舰冷却将结束时应预留施放能量");
  assert.equal(bot.shouldLaunchScout(bot.currentContext), false, "侦察机不应抢占春日旗舰的预留能量");
}

function yukiAiScoutDoctrineContract() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    aiSeats: ["B"],
    teamLoadouts: {
      A: { main: "haruhi", sub1: "asakura", sub2: "shamisen" },
      B: { main: "yuki", sub1: "kyon", sub2: "future1096" },
    },
  });
  const team = sim.teamB;
  const bot = sim.botBySeat("B");

  const openingPlan = bot.planScoutDeployment();
  assert.equal(openingPlan.mission, "frontline-screen", "长门 AI 开局应先建立前沿警戒线");
  assert.ok([2, 5, 8].includes(openingPlan.zoneId), "长门 AI 开局警戒应部署在双方之间的中线战区");
  runSteps(sim, 12);
  const combatScouts = team.scouts.filter((scout) => scout.alive && scout.combatCapable);
  assert.ok(bot.scoutDoctrine.deployments >= 3, "长门 AI 前12秒应建立至少三个战斗侦察节点");
  assert.ok(bot.scoutDoctrine.deployments >= combatScouts.length, "长门 AI 侦察学说状态应记录累计部署次数");
}

function yukiAiScreenCoverageContract() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    aiSeats: ["B"],
    teamLoadouts: {
      A: { main: "haruhi", sub1: "asakura", sub2: "shamisen" },
      B: { main: "yuki", sub1: "kyon", sub2: "future1096" },
    },
  });
  const team = sim.teamB;
  const bot = sim.botBySeat("B");
  for (const zoneId of [2, 5, 8]) {
    team.cooldowns.scout = 0;
    assert.equal(team.launchScout(zoneId), true, `长门前沿警戒应能建立${zoneId}战区节点`);
  }
  bot.scoutDoctrine.nextRetaskAt = 0;
  const retasked = bot.retaskYukiCombatScouts({
    mode: "screen",
    mission: "frontline-screen",
    primaryZoneId: 5,
    patrolRadius: 150,
  });
  assert.equal(retasked, 0, "长门前沿警戒不应把已覆盖的中线侦察机重新集中");
  assert.deepEqual(team.scouts.map((scout) => scout.zone?.id).sort((a, b) => a - b), [2, 5, 8], "长门前沿警戒应保留三条中线覆盖");
}

function yukiAiHarassRetaskContract() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    aiSeats: ["B"],
    teamLoadouts: {
      A: { main: "haruhi", sub1: "asakura", sub2: "shamisen" },
      B: { main: "yuki", sub1: "kyon", sub2: "future1096" },
    },
  });
  const team = sim.teamB;
  const bot = sim.botBySeat("B");
  for (let index = 0; index < 3; index += 1) {
    team.cooldowns.scout = 0;
    assert.equal(team.launchScout(5), true, "长门骚扰重编组测试应先建立集中侦察机");
  }
  bot.scoutDoctrine.nextRetaskAt = 0;
  const retasked = bot.retaskYukiCombatScouts({
    mode: "harass",
    mission: "forward-harass",
    primaryZoneId: 5,
    coverageZoneIds: [5, 2, 8],
    patrolRadius: 126,
  });
  const zones = team.scouts.map((scout) => scout.zone?.id);
  assert.ok(retasked >= 2, "长门骚扰应将过度集中的侦察机重新编组到相邻战区");
  assert.ok(zones.includes(2) && zones.includes(8), "长门骚扰应覆盖多个候选战区");
}

function haruhiLocaleContract() {
  const locales = [
    { code: "zh", name: "我在这里！", marker: "永久解锁", announcement: "我在这里！" },
    { code: "ja", name: "ここにいる！", marker: "恒久", announcement: "ここにいる！" },
    { code: "en", name: "I'm Here!", marker: "permanent", announcement: "I'm Here!" },
  ];
  for (const locale of locales) {
    setLocale(locale.code, { force: true, notify: false });
    assert.equal(skillText("haruhi", "flagship", "name"), locale.name, `${locale.code} 春日旗舰名称应同步上游重做`);
    const description = skillText("haruhi", "flagship", "description");
    assert.ok(description.includes("1.15"), `${locale.code} 春日旗舰说明应标明15%全队强化`);
    assert.ok(description.includes(locale.marker), `${locale.code} 春日旗舰说明应标明永久支援解锁`);
    assert.equal(t("我在这里！"), locale.announcement, `${locale.code} 春日旗舰战斗提示应本地化`);
  }
  setLocale("zh", { force: true, notify: false });
}

characterDefinitionContract();
shamisenCatPawContract();
future1096FormContract();
yukiCombatScoutContract();
asakuraVisionWaveContract();
asakuraVisionWaveRuntimeContract();
hiddenVisionWaveSnapshotContract();
asakuraVisionWaveTeamBuffContract();
yukiRadarContract();
haruhiFlagshipReworkContract();
haruhiPermanentSupportRuntimeContract();
haruhiAiOpeningFlagshipContract();
haruhiAiEnergyReserveContract();
yukiAiScoutDoctrineContract();
yukiAiScreenCoverageContract();
yukiAiHarassRetaskContract();
haruhiLocaleContract();
await portraitResourceConsumerContract();
console.log("character update verification passed");
