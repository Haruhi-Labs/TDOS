import {
  AUTO_SCOUT_COOLDOWN_MULTIPLIER,
  EMERGENCY_BRAKE_COST,
  MANUAL_SCOUT_COOLDOWN,
  MatchSimulation,
  TICK_DT,
} from "../shared/game-core.js";

function runSteps(sim, seconds) {
  const steps = Math.floor(seconds / TICK_DT);
  for (let i = 0; i < steps; i += 1) {
    sim.update(TICK_DT);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function closeRangeCombatCheck() {
  const sim = new MatchSimulation({ mode: "pvp", worldSize: 1440 });

  const aMain = sim.teamA.ships.main;
  const bMain = sim.teamB.ships.main;

  aMain.x = 650;
  aMain.y = 720;
  aMain.command.x = aMain.x;
  aMain.command.y = aMain.y;
  aMain.route = null;
  aMain.throttle = 0.25;

  bMain.x = 770;
  bMain.y = 720;
  bMain.command.x = bMain.x;
  bMain.command.y = bMain.y;
  bMain.route = null;
  bMain.throttle = 0.25;

  for (const ship of [sim.teamA.ships.sub1, sim.teamA.ships.sub2]) {
    ship.x = aMain.x - 16;
    ship.y = aMain.y + (ship.key === "sub1" ? 12 : -12);
    ship.command.x = ship.x;
    ship.command.y = ship.y;
    ship.route = null;
    ship.throttle = 0.25;
  }
  for (const ship of [sim.teamB.ships.sub1, sim.teamB.ships.sub2]) {
    ship.x = bMain.x + 16;
    ship.y = bMain.y + (ship.key === "sub1" ? 12 : -12);
    ship.command.x = ship.x;
    ship.command.y = ship.y;
    ship.route = null;
    ship.throttle = 0.25;
  }

  runSteps(sim, 10);

  assert(sim.teamA.visibleEnemyIds.size > 0, "近距离场景下，A队未建立敌方可见集");
  assert(sim.teamB.visibleEnemyIds.size > 0, "近距离场景下，B队未建立敌方可见集");
  assert(sim.teamA.hullRatio() < 0.995 || sim.teamB.hullRatio() < 0.995, "近距离场景下未出现有效伤害");
}

function speedAndEnergyRuleCheck() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: {
        main: "haruhi",
        sub1: "yuki",
        sub2: "future1096",
      },
      B: {
        main: "kyon",
        sub1: "tsuruya",
        sub2: "koizumi",
      },
    },
  });
  const teamA = sim.teamA;

  assert(Math.round(teamA.ships.main.effectiveSpeed()) === 31, "未分离时主舰队航速未按最慢成员计算");
  const combinedEnergy = teamA.ships.main.energy + teamA.ships.sub1.energy + teamA.ships.sub2.energy;
  assert(Math.round(teamA.availableEnergyForShip(teamA.ships.main)) === Math.round(combinedEnergy), "未分离时舰队能量未按全队加总");

  teamA.split(1);
  assert(Math.round(teamA.ships.main.effectiveSpeed()) === 33, "一级分离后主舰队航速未改为主舰队内最慢者");
  assert(Math.round(teamA.ships.sub1.effectiveSpeed()) === 31, "一级分离后独立副舰航速异常");
  assert(Math.round(teamA.availableEnergyForShip(teamA.ships.sub1)) === Math.round(teamA.ships.sub1.energy), "分离后副舰能量未独立计算");

  teamA.split(2);
  assert(Math.round(teamA.ships.sub2.effectiveSpeed()) === 37, "二级分离后1096独立航速异常");
}

function emergencyBrakeCheck() {
  const sim = new MatchSimulation({ mode: "pvp", worldSize: 1440 });
  const teamA = sim.teamA;
  const main = teamA.ships.main;

  main.angle = 0;
  main.speed = main.effectiveSpeed();
  main.command.x = main.x + 420;
  main.command.y = main.y;
  main.route = null;

  const beforeEnergy = teamA.availableEnergyForShip(main);
  const ok = sim.applyActionForSeat("A", { type: "emergency_brake", shipKey: "main" });
  assert(ok, "急刹动作触发失败");
  assert(teamA.availableEnergyForShip(main) <= beforeEnergy - EMERGENCY_BRAKE_COST + 0.01, "急刹未正确扣除能量");
  assert(main.speed < main.effectiveSpeed() * 0.4, "急刹未立即显著压低速度");

  runSteps(sim, 0.4);
  assert(main.speed < 6, "急刹持续期内减速仍不明显");
  assert(main.effects.brakeCooldownUntil > sim.elapsed, "急刹未进入冷却");
}

function autoScoutCheck() {
  const manualSim = new MatchSimulation({ mode: "pvp", worldSize: 1440 });
  const manualOk = manualSim.applyActionForSeat("A", { type: "launch_scout", zoneId: 3 });
  assert(manualOk, "手动侦察机释放失败");
  assert(Math.abs(manualSim.teamA.cooldowns.scout - MANUAL_SCOUT_COOLDOWN) < 1e-6, "手动侦察机冷却异常");

  const autoSim = new MatchSimulation({ mode: "pvp", worldSize: 1440 });
  const autoConfigOk = autoSim.applyActionForSeat("A", { type: "configure_auto_scout", enabled: true, zoneId: 7 });
  assert(autoConfigOk, "自动侦察开关配置失败");

  runSteps(autoSim, TICK_DT * 1.5);

  assert(autoSim.teamA.scouts.length >= 1, "自动侦察未在可释放时自动派出");
  assert(autoSim.teamA.scouts[0].zone?.id === 7, "自动侦察未飞向指定战区");
  assert(Math.abs(autoSim.teamA.cooldowns.scout - MANUAL_SCOUT_COOLDOWN * AUTO_SCOUT_COOLDOWN_MULTIPLIER) < 0.08, "自动侦察未使用双倍冷却");
  const serialized = autoSim.serializeState().teams.A.autoScout;
  assert(serialized?.enabled && serialized.zoneId === 7, "自动侦察状态未序列化到战斗快照");
}

function splitFormationCheck() {
  const sim = new MatchSimulation({ mode: "pvp", worldSize: 1440 });
  const teamA = sim.teamA;
  const main = teamA.ships.main;
  const sub1 = teamA.ships.sub1;
  const sub2 = teamA.ships.sub2;

  main.setBezierRoute(undefined, undefined, 980, 720, 1, true);
  runSteps(sim, 1.2);
  teamA.split(1);
  runSteps(sim, 3);

  const sub1Distance = Math.hypot(sub1.x - main.x, sub1.y - main.y);
  const sub2Distance = Math.hypot(sub2.x - main.x, sub2.y - main.y);

  assert(!sub1.isAttached() && sub1.route, "一级分离后副舰一应进入独立散开航线");
  assert(sub2.isAttached(), "一级分离后副舰二应保持附着");
  assert(!sub2.route, "一级分离后副舰二不应被额外分配散开航线");
  assert(sub2Distance < 28, "一级分离后未被释放的副舰二不应明显散开");
  assert(sub1Distance > sub2Distance + 35, "一级分离后应只有被释放的副舰一明显脱离编队");
}

function initialFormationStabilityCheck() {
  const loadout = {
    main: "future1096",
    sub1: "haruhi",
    sub2: "kyon",
  };
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: { A: loadout, B: loadout },
  });

  const formationError = (team, ship) => {
    const main = team.ships.main;
    const scale = 0.5;
    const ox = ship.formationOffset.x * scale;
    const oy = ship.formationOffset.y * scale;
    const cos = Math.cos(main.angle);
    const sin = Math.sin(main.angle);
    const expectedX = main.x + ox * cos - oy * sin;
    const expectedY = main.y + ox * sin + oy * cos;
    return Math.hypot(ship.x - expectedX, ship.y - expectedY);
  };

  for (const seat of ["A", "B"]) {
    const team = sim.teamBySeat(seat);
    for (const ship of [team.ships.sub1, team.ships.sub2, ...team.extraShips]) {
      assert(formationError(team, ship) < 0.01, `${seat}队附着舰未按自身朝向生成在编队位置`);
    }
  }

  runSteps(sim, 3);
  for (const seat of ["A", "B"]) {
    const team = sim.teamBySeat(seat);
    for (const ship of [team.ships.sub1, team.ships.sub2, ...team.extraShips]) {
      assert(formationError(team, ship) < 0.5, `${seat}队静止开局时附着舰异常散开`);
      assert(ship.speed < 0.2, `${seat}队静止开局时附着舰仍在自行推进`);
    }
  }
}

function future1096LeaderHandoverCheck() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: {
        main: "future1096",
        sub1: "haruhi",
        sub2: "koizumi",
      },
      B: {
        main: "kyon",
        sub1: "tsuruya",
        sub2: "yuki",
      },
    },
  });
  const teamA = sim.teamA;
  const originalMain = teamA.ships.main;
  const twin = teamA.extraShips.find((ship) => ship.slotKey === "twin");
  const expectedMaxHp = Math.round(originalMain.base.hp * 0.75);

  assert(originalMain.maxHp === expectedMaxHp, "1096 主舰舰体上限不是常规旗舰的75%");
  assert(twin && twin.maxHp === expectedMaxHp, "1096 僚舰舰体上限不是常规旗舰的75%");
  assert(originalMain.hp === expectedMaxHp && twin.hp === expectedMaxHp, "1096 双舰开局生命值未与舰体上限一致");

  originalMain.takeDamage(originalMain.maxHp * 2, null, sim);

  assert(teamA.ships.main.id === twin.id, "1096 主舰被击毁后未由剩余舰体接管主舰位");
  assert(teamA.ships.main.alive, "1096 主舰接管后剩余舰体不应死亡");
  assert(teamA.ships.main.canControl(), "1096 主舰接管后剩余舰体应可继续操作");
}

function flagshipLossAutoSplitCheck() {
  const sim = new MatchSimulation({ mode: "pvp", worldSize: 1440 });
  const teamA = sim.teamA;
  const main = teamA.ships.main;

  main.takeDamage(main.maxHp * 2, null, sim);

  assert(teamA.splitLevel === 2, "主舰被击毁后剩余舰队未自动完成分离");
  assert(!teamA.ships.sub1.isAttached(), "主舰被击毁后副舰一仍处于附着状态");
  assert(!teamA.ships.sub2.isAttached(), "主舰被击毁后副舰二仍处于附着状态");
  assert(teamA.ships.sub1.route && teamA.ships.sub2.route, "主舰被击毁后自动分离未为剩余副舰生成脱离航线");
}

function skippedSplitLevelCheck() {
  const sim = new MatchSimulation({ mode: "pvp", worldSize: 1440 });
  const teamA = sim.teamA;
  const sub1 = teamA.ships.sub1;
  const sub2 = teamA.ships.sub2;

  sub1.takeDamage(sub1.maxHp * 2, null, sim);

  assert(teamA.splitLevel === 1, "副舰一未分离时被击毁后，分离层级未自动跳到一级已完成");
  assert(!teamA.split(1), "副舰一已阵亡时不应仍允许一级分离");
  assert(teamA.split(2), "副舰一已阵亡时应直接允许二级分离");
  assert(!sub2.isAttached(), "副舰一已阵亡后，二级分离未正确释放副舰二");
}

function yukiPassiveCheck() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: {
        main: "yuki",
        sub1: "haruhi",
        sub2: "koizumi",
      },
      B: {
        main: "kyon",
        sub1: "tsuruya",
        sub2: "future1096",
      },
    },
  });
  const teamA = sim.teamA;
  const main = teamA.ships.main;

  assert(teamA.areSkillsDisabled(), "有希旗舰被动未封印全队技能");
  const beforeCharges = main.reviveCharges;
  main.takeDamage(main.maxHp * 2, null, sim);
  assert(beforeCharges === 1, "有希旗舰未为舰船提供额外命数");
  assert(main.alive, "有希旗舰被动未触发复活");
  assert(main.reviveCharges === 0, "复活后命数未正确扣除");
}

function koizumiFlagshipInvulnCheck() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: {
        main: "koizumi",
        sub1: "haruhi",
        sub2: "yuki",
      },
      B: {
        main: "kyon",
        sub1: "tsuruya",
        sub2: "future1096",
      },
    },
  });
  const teamA = sim.teamA;
  const main = teamA.ships.main;
  const beforeHp = main.hp;

  const castOk = teamA.castFlagshipSkill();
  assert(castOk, "古泉旗舰技能释放失败");
  assert(Math.abs(teamA.effects.taxiUntil - sim.elapsed - 12) < 1e-6, "古泉旗舰技能加速未持续12秒");
  assert(Math.abs(teamA.effects.taxiInvulnUntil - sim.elapsed - 6) < 1e-6, "古泉旗舰技能无敌未持续6秒");
  assert(Math.abs(teamA.accelerationModifierForShip(main) - 1.75) < 1e-6, "古泉旗舰技能未使全舰队加速度×1.75");

  runSteps(sim, 5.9);
  main.takeDamage(220, null, sim);
  assert(main.hp === beforeHp, "古泉旗舰技能前6秒无敌未生效");

  runSteps(sim, 0.2);
  main.takeDamage(220, null, sim);
  assert(main.hp < beforeHp, "古泉旗舰技能无敌结束后仍未恢复正常受伤");
}

function koizumiBlinkStrikeCheck() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: {
        main: "haruhi",
        sub1: "koizumi",
        sub2: "yuki",
      },
      B: {
        main: "kyon",
        sub1: "tsuruya",
        sub2: "future1096",
      },
    },
  });
  const teamA = sim.teamA;
  const sub1 = teamA.ships.sub1;
  const enemyMain = sim.teamB.ships.main;

  teamA.split(1);
  sub1.energy = sub1.maxEnergy;
  sub1.x = 720;
  sub1.y = 720;
  sub1.angle = 0;
  sub1.command.x = sub1.x;
  sub1.command.y = sub1.y;
  sub1.route = null;
  enemyMain.x = 980;
  enemyMain.y = 720;
  enemyMain.command.x = enemyMain.x;
  enemyMain.command.y = enemyMain.y;
  enemyMain.route = null;

  const startX = sub1.x;
  const castOk = teamA.castSubSkill("sub1", { targetX: 1120, targetY: 720 });
  assert(castOk, "古泉分舰技能闪现释放失败");
  assert(sub1.x > startX + 200, "古泉分舰技能未闪现到有效距离");
  assert(sub1.effects.nextShotDamageMultiplier === 4, "古泉分舰技能未为下一次攻击附加4倍伤害");

  sim.teamA.computeVisibility(sim.teamB);
  sub1.cooldown = 0;
  sim.projectiles = [];
  sub1.tryAttack(sim, sim.teamB);
  assert(sim.projectiles.length === 1, "古泉分舰技能后未能正常攻击");
  assert(Math.round(sim.projectiles[0].damage) === Math.round(sub1.effectiveDamage() * 4), "古泉分舰技能未正确提升下一次攻击伤害");
  assert(sub1.effects.nextShotDamageMultiplier === 1, "古泉分舰技能的单次强化未在攻击后清除");

  teamA.cooldowns.sub1 = 0;
  sub1.energy = sub1.maxEnergy;
  const beforeY = sub1.y;
  const castInPlaceOk = teamA.castSubSkill("sub1", {});
  assert(castInPlaceOk, "古泉分舰技能未支持原地闪现释放");
  assert(Math.abs(sub1.y - beforeY) < 1e-6, "古泉分舰技能原地闪现时不应强制位移");
}

function beamSkillCheck() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: {
        main: "haruhi",
        sub1: "koizumi",
        sub2: "future1096",
      },
      B: {
        main: "kyon",
        sub1: "tsuruya",
        sub2: "yuki",
      },
    },
  });
  const teamA = sim.teamA;
  const teamB = sim.teamB;

  teamA.split(1);
  teamA.split(2);
  teamA.ships.sub2.energy = teamA.ships.sub2.maxEnergy;

  const sub2 = teamA.ships.sub2;
  const enemyMain = teamB.ships.main;
  sub2.x = 680;
  sub2.y = 700;
  enemyMain.x = 840;
  enemyMain.y = 700;

  const before = teamB.hullRatio();
  const castOk = teamA.castSubSkill("sub2", { targetX: enemyMain.x, targetY: enemyMain.y });
  runSteps(sim, 0.35);
  const chargingVisible = teamA.beams.some((beam) => beam.phase === "charge");
  runSteps(sim, 1.2);
  const after = teamB.hullRatio();

  assert(castOk, "1096光线触发失败");
  assert(chargingVisible, "1096光线未进入蓄力阶段");
  assert(after < before, "1096光线未造成伤害");
  assert(before - after >= 0.18, "1096光线伤害明显偏低");
}

function tsuruyaFlagshipActiveCheck() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: {
        main: "tsuruya",
        sub1: "haruhi",
        sub2: "koizumi",
      },
      B: {
        main: "kyon",
        sub1: "yuki",
        sub2: "future1096",
      },
    },
  });
  const teamA = sim.teamA;
  const main = teamA.ships.main;

  main.hp = main.maxHp * 0.6;
  teamA.cooldowns.sub1 = 10;
  const beforeHp = main.hp;
  const castOk = teamA.castFlagshipSkill();
  assert(castOk, "鹤屋旗舰技能释放失败");

  runSteps(sim, 1);

  assert(main.hp > beforeHp + main.maxHp * 0.009, "鹤屋旗舰技能未按每秒1%最大生命恢复");
  assert(teamA.cooldowns.sub1 < 8.1, "鹤屋旗舰技能未使技能冷却流逝速度翻倍");
}

function fireArcDensityCheck() {
  const sim = new MatchSimulation({ mode: "pvp", worldSize: 1440 });
  const ship = sim.teamA.ships.main;
  const target = sim.teamB.ships.main;

  ship.x = 720;
  ship.y = 720;
  ship.angle = 0;
  ship.cooldown = 0;
  target.x = 860;
  target.y = 720;
  sim.teamA.computeVisibility(sim.teamB);
  ship.tryAttack(sim, sim.teamB);
  assert(sim.projectiles.length === 1, "前方射界应允许正常开火");
  const frontDamage = sim.projectiles[0].damage;
  const frontCooldown = ship.cooldown;

  sim.projectiles = [];
  ship.cooldown = 0;
  target.x = 720;
  target.y = 860;
  sim.teamA.computeVisibility(sim.teamB);
  ship.tryAttack(sim, sim.teamB);
  assert(sim.projectiles.length === 1, "侧舷射界应允许开火");
  const broadsideDamage = sim.projectiles[0].damage;
  const broadsideCooldown = ship.cooldown;

  sim.projectiles = [];
  ship.cooldown = 0;
  target.x = 600;
  target.y = 720;
  sim.teamA.computeVisibility(sim.teamB);
  ship.tryAttack(sim, sim.teamB);
  assert(sim.projectiles.length === 0, "舰尾 0 倍射界不应开火");

  assert(Math.abs(frontDamage - broadsideDamage) < 1e-6, "射界不应通过修改单发伤害实现");
  assert(broadsideCooldown < frontCooldown * 0.8, "1.5 倍射界未体现为更高火力密度");
}

function kyonUniformFireRateCheck() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "kyon", sub1: "haruhi", sub2: "yuki" },
      B: { main: "koizumi", sub1: "tsuruya", sub2: "future1096" },
    },
  });
  const ship = sim.teamA.ships.main;
  const target = sim.teamB.ships.main;
  ship.x = 720;
  ship.y = 720;
  ship.angle = 0;

  const directions = [
    { x: 860, y: 720, label: "正前" },
    { x: 720, y: 860, label: "侧舷" },
    { x: 600, y: 720, label: "舰尾" },
  ];
  const expectedCooldown = 1 / (ship.effectiveFireRate() * 1.5);
  for (const direction of directions) {
    target.x = direction.x;
    target.y = direction.y;
    assert(Math.abs(ship.broadsideMultiplier(target) - 1.5) < 1e-6, `阿虚旗舰${direction.label}方向射速不是1.5×`);
    ship.cooldown = 0;
    sim.projectiles = [];
    sim.teamA.computeVisibility(sim.teamB);
    ship.tryAttack(sim, sim.teamB);
    assert(sim.projectiles.length === 1, `阿虚旗舰${direction.label}方向未能开火`);
    assert(Math.abs(ship.cooldown - expectedCooldown) < 1e-6, `阿虚旗舰${direction.label}方向实际射速不是1.5×`);
  }
}

function haruhiBlindfireCheck() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: {
        main: "kyon",
        sub1: "haruhi",
        sub2: "yuki",
      },
      B: {
        main: "future1096",
        sub1: "koizumi",
        sub2: "tsuruya",
      },
    },
  });
  const teamA = sim.teamA;
  const sub1 = teamA.ships.sub1;
  const main = teamA.ships.main;
  const enemyMain = sim.teamB.ships.main;

  teamA.split(1);
  sub1.x = 720;
  sub1.y = 720;
  sub1.angle = 0;
  sub1.command.x = sub1.x;
  sub1.command.y = sub1.y;
  sub1.route = null;
  main.x = 260;
  main.y = 240;
  main.command.x = main.x;
  main.command.y = main.y;
  main.route = null;

  enemyMain.x = 1090;
  enemyMain.y = 720;
  enemyMain.command.x = enemyMain.x;
  enemyMain.command.y = enemyMain.y;
  enemyMain.route = null;

  sim.teamA.computeVisibility(sim.teamB);
  assert(!sim.teamA.visibleEnemyIds.has(enemyMain.id), "春日盲射测试布置错误，敌方本应处于视野外");

  sub1.cooldown = 0;
  sim.projectiles = [];
  sub1.tryAttack(sim, sim.teamB);
  assert(sim.projectiles.length === 0, "春日未开技能时不应攻击视野外目标");

  const castOk = teamA.castSubSkill("sub1");
  assert(castOk, "春日分舰技能释放失败");
  sub1.cooldown = 0;
  sim.projectiles = [];
  sub1.tryAttack(sim, sim.teamB);
  assert(sim.projectiles.length === 1, "春日分舰技能未允许对视野外最近敌人进行盲射");
}

function asakuraFlagshipCheck() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: {
        main: "asakura",
        sub1: "haruhi",
        sub2: "yuki",
      },
      B: {
        main: "koizumi",
        sub1: "haruhi",
        sub2: "tsuruya",
      },
    },
  });
  const teamA = sim.teamA;
  const teamB = sim.teamB;
  const enemyMain = teamB.ships.main;
  const enemySub1 = teamB.ships.sub1;

  const enemyFlagOk = teamB.castFlagshipSkill();
  teamB.split(1);
  const enemySubOk = teamB.castSubSkill("sub1");
  assert(enemyFlagOk && enemySubOk, "朝仓旗舰测试前置敌方增益释放失败");

  enemyMain.x = 1180;
  enemyMain.y = 720;
  enemyMain.command.x = enemyMain.x;
  enemyMain.command.y = enemyMain.y;
  enemyMain.route = null;
  sim.teamA.computeVisibility(sim.teamB);
  assert(!sim.teamA.visibleEnemyIds.has(enemyMain.id), "朝仓旗舰测试布置错误，敌方应处于视野外");

  const castOk = teamA.castFlagshipSkill();
  assert(castOk, "朝仓旗舰技能释放失败");
  sim.teamA.computeVisibility(sim.teamB);

  assert(teamB.effects.taxiUntil <= sim.elapsed, "朝仓旗舰技能未清除敌方团队主动增益");
  assert(teamB.effects.taxiInvulnUntil <= sim.elapsed, "朝仓旗舰技能未清除敌方无敌效果");
  assert(!enemySub1.hasEffect("critUntil"), "朝仓旗舰技能未清除敌方舰船主动增益");
  assert(sim.teamA.visibleEnemyIds.has(enemyMain.id), "朝仓旗舰技能未揭示敌方位置");
  assert(Math.abs(teamA.effects.revealEnemiesUntil - sim.elapsed - 4) < 1e-6, "朝仓旗舰技能揭示时间不是4秒");

  runSteps(sim, 3.9);
  sim.teamA.computeVisibility(sim.teamB);
  assert(sim.teamA.visibleEnemyIds.has(enemyMain.id), "朝仓旗舰技能未完整揭示敌方位置4秒");

  runSteps(sim, 0.2);
  sim.teamA.computeVisibility(sim.teamB);
  assert(!sim.teamA.visibleEnemyIds.has(enemyMain.id), "朝仓旗舰技能揭示结束后仍持续显示敌方位置");
}

function asakuraBladeQueenCheck() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: {
        main: "haruhi",
        sub1: "asakura",
        sub2: "yuki",
      },
      B: {
        main: "kyon",
        sub1: "koizumi",
        sub2: "tsuruya",
      },
    },
  });
  const teamA = sim.teamA;
  const sub1 = teamA.ships.sub1;
  const enemyMain = sim.teamB.ships.main;
  const baseSpeed = sub1.baseSpeed();

  teamA.split(1);
  sub1.energy = sub1.maxEnergy;
  sub1.x = 720;
  sub1.y = 720;
  sub1.command.x = sub1.x;
  sub1.command.y = sub1.y;
  sub1.route = null;
  sub1.cooldown = 999;
  enemyMain.x = sub1.x + sub1.radius + enemyMain.radius;
  enemyMain.y = 720;
  enemyMain.command.x = enemyMain.x;
  enemyMain.command.y = enemyMain.y;
  enemyMain.route = null;
  enemyMain.cooldown = 999;

  // 敌方未分离(3 艘同队),受到的伤害有 30% 平摊给同队其它船,故按「敌方编队总血量损失」判定
  // 才稳健(技能总伤害不变、只是被重新分配)。否则接触主舰只承担 70%,会假性低于阈值。
  const enemyFleetHp = () => sim.teamB.getAllShips().reduce((sum, ship) => sum + ship.hp, 0);
  const beforeFleetHp = enemyFleetHp();
  const castOk = teamA.castSubSkill("sub1");
  assert(castOk, "朝仓分舰技能释放失败");
  assert(sub1.baseSpeed() > baseSpeed * 1.3, "朝仓分舰技能未显著提升速度");

  runSteps(sim, 1);

  assert(beforeFleetHp - enemyFleetHp() > enemyMain.maxHp * 0.015, "朝仓分舰技能未对接触敌舰造成持续伤害");
}

function aiEngageCheck() {
  const sim = new MatchSimulation({ mode: "ai", worldSize: 1440 });
  runSteps(sim, 70);

  const aDamaged = sim.teamA.hullRatio() < 0.995;
  const bDamaged = sim.teamB.hullRatio() < 0.995;
  assert(aDamaged || bDamaged, "AI对战70秒内未出现任何伤害");
}

function aiFogOfWarCheck() {
  const sim = new MatchSimulation({ mode: "ai", worldSize: 1440 });
  const bot = sim.bot;
  const aiMain = sim.teamB.ships.main;
  const enemyMain = sim.teamA.ships.main;
  const knownSpawn = { x: enemyMain.x, y: enemyMain.y };

  enemyMain.x = 180;
  enemyMain.y = 240;
  enemyMain.command.x = enemyMain.x;
  enemyMain.command.y = enemyMain.y;
  enemyMain.route = null;

  bot.issueMovement();

  assert(aiMain.route, "AI在失去情报时未生成搜索路线");
  const hiddenDist = Math.hypot(aiMain.route.p2.x - enemyMain.x, aiMain.route.p2.y - enemyMain.y);
  const spawnDist = Math.hypot(aiMain.route.p2.x - knownSpawn.x, aiMain.route.p2.y - knownSpawn.y);
  assert(hiddenDist > 200, "AI在未侦测到敌人时仍直接锁定了真实位置");
  assert(spawnDist < hiddenDist, "AI在无视野时应优先按出生点与搜索区推进");
}

function aiReactionDelayCheck() {
  const sim = new MatchSimulation({ mode: "ai", worldSize: 1440 });
  const bot = sim.bot;
  const enemyMain = sim.teamA.ships.main;
  const spawnIntel = { x: bot.enemyIntel.main.x, y: bot.enemyIntel.main.y };

  enemyMain.x = 860;
  enemyMain.y = 720;
  enemyMain.angle = Math.PI;
  enemyMain.command.x = enemyMain.x;
  enemyMain.command.y = enemyMain.y;
  enemyMain.route = null;

  sim.teamB.computeVisibility(sim.teamA);
  bot.refreshIntel();

  const immediate = bot.primaryEnemyEstimate();
  const immediateToSpawn = Math.hypot(immediate.x - spawnIntel.x, immediate.y - spawnIntel.y);
  const immediateToVisible = Math.hypot(immediate.x - enemyMain.x, immediate.y - enemyMain.y);
  assert(immediateToSpawn < immediateToVisible, "AI对新视野的反应过快，未体现感知延迟");

  runSteps(sim, 0.45);

  const delayed = bot.primaryEnemyEstimate();
  assert(delayed && delayed.source !== "spawn", "AI在反应延迟后未吸收可见情报");
  assert(Math.hypot(delayed.x - enemyMain.x, delayed.y - enemyMain.y) < 180, "AI在反应延迟后未转向新可见目标");
}

function aiSearchSweepCheck() {
  const sim = new MatchSimulation({ mode: "ai", worldSize: 1440 });
  const bot = sim.bot;
  const aiTeam = sim.teamB;
  const enemyMain = sim.teamA.ships.main;

  aiTeam.split(1);
  aiTeam.split(2);
  for (const ship of [aiTeam.ships.sub1, aiTeam.ships.sub2]) {
    ship.route = null;
    ship.command.x = ship.x;
    ship.command.y = ship.y;
  }

  enemyMain.x = 180;
  enemyMain.y = 240;
  enemyMain.command.x = enemyMain.x;
  enemyMain.command.y = enemyMain.y;
  enemyMain.route = null;

  bot.issueMovement();

  const sub1Route = aiTeam.ships.sub1.route;
  const sub2Route = aiTeam.ships.sub2.route;
  assert(sub1Route && sub2Route, "AI搜索阶段未为双副舰生成分头搜索路线");
  const spread = Math.hypot(sub1Route.p2.x - sub2Route.p2.x, sub1Route.p2.y - sub2Route.p2.y);
  assert(spread > 180, "AI失联搜索时副舰展开宽度不足");
}

function aiScoutAggressionCheck() {
  const sim = new MatchSimulation({ mode: "ai", worldSize: 1440 });
  runSteps(sim, 4.6);
  assert(sim.teamB.scouts.length >= 1, "AI在缺乏情报的开局阶段放侦察机过慢");
}

function aiRetreatJudgementCheck() {
  const sim = new MatchSimulation({ mode: "ai", worldSize: 1440 });
  const bot = sim.bot;
  const aiMain = sim.teamB.ships.main;
  const enemyMain = sim.teamA.ships.main;

  aiMain.x = 980;
  aiMain.y = 720;
  aiMain.hp = aiMain.maxHp * 0.22;
  aiMain.energy = aiMain.maxEnergy * 0.14;
  aiMain.command.x = aiMain.x;
  aiMain.command.y = aiMain.y;
  aiMain.route = null;

  enemyMain.x = 860;
  enemyMain.y = 720;
  enemyMain.command.x = enemyMain.x;
  enemyMain.command.y = enemyMain.y;
  enemyMain.route = null;

  bot.rememberContact(enemyMain, "visible");
  const context = bot.buildTacticalContext(aiMain, bot.selectEnemyFocus(aiMain));
  bot.issueMovement(context);

  assert(["kite", "regroup", "recover"].includes(bot.mode), "AI残血近距离遭遇时未进入保守机动模式");
  const startDist = Math.hypot(aiMain.x - enemyMain.x, aiMain.y - enemyMain.y);
  const endDist = Math.hypot(aiMain.route.p2.x - enemyMain.x, aiMain.route.p2.y - enemyMain.y);
  assert(endDist > startDist + 50, "AI残血时未明显拉开与敌方主舰的距离");
}

function aiFocusSelectionCheck() {
  const sim = new MatchSimulation({ mode: "ai", worldSize: 1440 });
  const bot = sim.bot;
  const aiMain = sim.teamB.ships.main;
  const enemyMain = sim.teamA.ships.main;
  const enemySub1 = sim.teamA.ships.sub1;

  sim.teamA.split(1);
  aiMain.x = 1040;
  aiMain.y = 720;
  enemyMain.x = 760;
  enemyMain.y = 720;
  enemySub1.x = 900;
  enemySub1.y = 690;
  enemySub1.hp = enemySub1.maxHp * 0.16;

  bot.rememberContact(enemyMain, "visible");
  bot.rememberContact(enemySub1, "visible");
  const focus = bot.selectEnemyFocus(aiMain);

  assert(focus && focus.id === enemySub1.id, "AI未优先锁定近距离低血量可击杀目标");
}

function aiSplitDisciplineCheck() {
  const sim = new MatchSimulation({ mode: "ai", worldSize: 1440 });
  const bot = sim.bot;
  const aiMain = sim.teamB.ships.main;

  sim.elapsed = 26;
  aiMain.hp = aiMain.maxHp * 0.28;
  aiMain.energy = aiMain.maxEnergy * 0.12;

  const context = bot.buildTacticalContext(aiMain, bot.primaryEnemyEstimate());
  bot.evaluateSplit(sim.elapsed, context);

  assert(sim.teamB.splitLevel === 0, "AI在低血低能且缺乏有效情报时仍过早分离");
}

function aiFireArcAwarenessCheck() {
  const sim = new MatchSimulation({
    mode: "ai",
    worldSize: 1440,
    teamLoadouts: {
      A: {
        main: "haruhi",
        sub1: "koizumi",
        sub2: "yuki",
      },
      B: {
        main: "haruhi",
        sub1: "future1096",
        sub2: "tsuruya",
      },
    },
  });
  const bot = sim.bot;
  const aiMain = sim.teamB.ships.main;
  const enemyMain = sim.teamA.ships.main;

  aiMain.x = 1080;
  aiMain.y = 720;
  aiMain.angle = Math.PI;
  aiMain.command.x = aiMain.x;
  aiMain.command.y = aiMain.y;
  aiMain.route = null;

  enemyMain.x = 760;
  enemyMain.y = 720;
  enemyMain.angle = Math.PI * 0.5;
  enemyMain.command.x = enemyMain.x;
  enemyMain.command.y = enemyMain.y;
  enemyMain.route = null;

  bot.rememberContact(enemyMain, "visible");
  const focus = bot.selectEnemyFocus(aiMain);
  const context = bot.buildTacticalContext(aiMain, focus);
  const mode = bot.chooseMode(context);
  const target = bot.computeMainTarget(mode, aiMain, focus, bot.combatCenter(focus));
  const currentEnemyDensity = bot.arcDensityFromState(focus.angle, focus.x, focus.y, aiMain.x, aiMain.y, sim.teamA.hasKyonFlagship());
  const targetIntentAngle = mode === "broadside"
    ? bot.broadsideIntentAngle(target.x, target.y, focus.x, focus.y, context.flankSign)
    : Math.atan2(focus.y - target.y, focus.x - target.x);
  const exchange = bot.evaluateArcExchange(aiMain, focus, {
    x: target.x,
    y: target.y,
    intentAngle: targetIntentAngle,
    preferredRange: aiMain.effectiveRange() * 0.9,
  }, 1.2);

  assert(mode === "broadside", "敌方侧舷威胁明显时，AI未优先选择提升射界效率的机动");
  assert(exchange.enemyDensity < currentEnemyDensity, "AI未主动规避敌方更高火力扇区");
  assert(exchange.ownDensity >= 1.4, "AI未主动争取己方高火力密度射界");
}

function aiProbePressureCheck() {
  const sim = new MatchSimulation({ mode: "ai", worldSize: 1440 });
  const bot = sim.bot;
  const aiMain = sim.teamB.ships.main;
  const enemyMain = sim.teamA.ships.main;

  enemyMain.x = 640;
  enemyMain.y = 720;
  enemyMain.angle = Math.PI;
  enemyMain.command.x = enemyMain.x;
  enemyMain.command.y = enemyMain.y;
  enemyMain.route = null;

  bot.rememberContact(enemyMain, "visible");
  runSteps(sim, 1.4);

  const context = bot.currentContext || bot.buildTacticalContext(aiMain, bot.selectEnemyFocus(aiMain));
  assert(context.trackableIntel || context.intelSolid, "AI未正确保留可追击的最后情报");

  const startDist = Math.hypot(aiMain.x - enemyMain.x, aiMain.y - enemyMain.y);
  runSteps(sim, 5);
  const currentDist = Math.hypot(aiMain.x - enemyMain.x, aiMain.y - enemyMain.y);
  assert(currentDist < startDist - 55, "AI对可追击记忆目标的压制推进仍偏消极");
}

function aiSplitInitiativeCheck() {
  const sim = new MatchSimulation({
    mode: "ai",
    worldSize: 1440,
    teamLoadouts: {
      A: {
        main: "haruhi",
        sub1: "koizumi",
        sub2: "tsuruya",
      },
      B: {
        main: "kyon",
        sub1: "yuki",
        sub2: "tsuruya",
      },
    },
  });
  const bot = sim.bot;
  const aiMain = sim.teamB.ships.main;
  const enemyMain = sim.teamA.ships.main;

  enemyMain.x = 760;
  enemyMain.y = 720;
  enemyMain.angle = 0;
  enemyMain.command.x = enemyMain.x;
  enemyMain.command.y = enemyMain.y;
  enemyMain.route = null;

  bot.rememberContact(enemyMain, "visible");
  const context = bot.buildTacticalContext(aiMain, bot.selectEnemyFocus(aiMain));

  assert(bot.shouldSplit(1, context, 10.5), "AI在高质量侦察副舰存在时仍未倾向提前一级分离");
}

function aiYukiVisionLeadCheck() {
  const sim = new MatchSimulation({
    mode: "ai",
    worldSize: 1440,
    teamLoadouts: {
      A: {
        main: "haruhi",
        sub1: "koizumi",
        sub2: "tsuruya",
      },
      B: {
        main: "kyon",
        sub1: "yuki",
        sub2: "tsuruya",
      },
    },
  });
  const bot = sim.bot;
  const aiTeam = sim.teamB;
  const aiMain = aiTeam.ships.main;
  const yuki = aiTeam.ships.sub1;
  const enemyMain = sim.teamA.ships.main;

  aiTeam.split(1);

  aiMain.x = 1100;
  aiMain.y = 760;
  aiMain.command.x = aiMain.x;
  aiMain.command.y = aiMain.y;
  aiMain.route = null;

  yuki.x = 1030;
  yuki.y = 700;
  yuki.command.x = yuki.x;
  yuki.command.y = yuki.y;
  yuki.route = null;

  enemyMain.x = 790;
  enemyMain.y = 720;
  enemyMain.angle = 0;
  enemyMain.command.x = enemyMain.x;
  enemyMain.command.y = enemyMain.y;
  enemyMain.route = null;

  bot.rememberContact(enemyMain, "visible");
  const context = bot.buildTacticalContext(aiMain, bot.selectEnemyFocus(aiMain));
  bot.issueMovement(context);

  assert(aiMain.route && yuki.route, "AI未为主舰与长门生成协同路线");

  const enemyVision = bot.estimateVisionRange(context.focus);
  const yukiTargetDist = Math.hypot(yuki.route.p2.x - enemyMain.x, yuki.route.p2.y - enemyMain.y);
  const mainTargetDist = Math.hypot(aiMain.route.p2.x - enemyMain.x, aiMain.route.p2.y - enemyMain.y);

  assert(yukiTargetDist > enemyVision + 6, "长门前探仍会直接闯入敌方视野");
  assert(yukiTargetDist < yuki.effectiveVision() - 4, "长门前探距离过远，未利用自身视野锁定敌舰");
  assert(mainTargetDist > yukiTargetDist + 24, "长门前探时主舰未保持更安全的火力支援位置");
}

function aiWoundedDetachedRetreatCheck() {
  const sim = new MatchSimulation({ mode: "ai", worldSize: 1440 });
  const bot = sim.bot;
  const aiTeam = sim.teamB;
  const aiMain = aiTeam.ships.main;
  const sub1 = aiTeam.ships.sub1;
  const sub2 = aiTeam.ships.sub2;
  const enemyMain = sim.teamA.ships.main;

  aiTeam.split(1);
  aiTeam.split(2);

  aiMain.x = 1080;
  aiMain.y = 720;
  aiMain.command.x = aiMain.x;
  aiMain.command.y = aiMain.y;
  aiMain.route = null;

  sub1.x = 1020;
  sub1.y = 780;
  sub1.command.x = sub1.x;
  sub1.command.y = sub1.y;
  sub1.route = null;
  sub1.hp = sub1.maxHp * 0.22;
  sub1.energy = sub1.maxEnergy * 0.14;

  sub2.x = 1020;
  sub2.y = 660;
  sub2.command.x = sub2.x;
  sub2.command.y = sub2.y;
  sub2.route = null;

  enemyMain.x = 790;
  enemyMain.y = 720;
  enemyMain.angle = 0;
  enemyMain.command.x = enemyMain.x;
  enemyMain.command.y = enemyMain.y;
  enemyMain.route = null;

  bot.rememberContact(enemyMain, "visible");
  const context = bot.buildTacticalContext(aiMain, bot.selectEnemyFocus(aiMain));
  const detachedPlan = bot.planDetachedRoles(aiMain, context.focus, context);
  bot.issueMovement(context);

  assert(detachedPlan.roles.sub1 === "rear", "低状态副舰未被识别为后撤保命单位");
  assert(sub1.route && sub2.route, "AI未为分离副舰生成完整路线");

  const mainTargetDist = Math.hypot(aiMain.route.p2.x - enemyMain.x, aiMain.route.p2.y - enemyMain.y);
  const sub1TargetDist = Math.hypot(sub1.route.p2.x - enemyMain.x, sub1.route.p2.y - enemyMain.y);
  const sub2TargetDist = Math.hypot(sub2.route.p2.x - enemyMain.x, sub2.route.p2.y - enemyMain.y);

  assert(sub1TargetDist > mainTargetDist + 48, "残血副舰未明显后撤到主舰后方");
  assert(sub1TargetDist > sub2TargetDist + 36, "残血副舰未比健康副舰保持更安全距离");
}

function aiSectorEncirclementCheck() {
  const sim = new MatchSimulation({ mode: "ai", worldSize: 1440 });
  const bot = sim.bot;
  const aiTeam = sim.teamB;
  const enemyMain = sim.teamA.ships.main;

  aiTeam.split(1);
  aiTeam.split(2);

  enemyMain.x = 760;
  enemyMain.y = 520;
  enemyMain.angle = 0;
  enemyMain.command.x = enemyMain.x;
  enemyMain.command.y = enemyMain.y;
  enemyMain.route = null;

  bot.rememberContact(enemyMain, "visible");
  const stored = bot.enemyIntel.entities.get(enemyMain.id);
  stored.seenAt = sim.elapsed - 6.4;
  if (bot.enemyIntel.main && bot.enemyIntel.main.id === enemyMain.id) {
    bot.enemyIntel.main.seenAt = sim.elapsed - 6.4;
  }

  enemyMain.x = 180;
  enemyMain.y = 200;
  enemyMain.command.x = enemyMain.x;
  enemyMain.command.y = enemyMain.y;
  enemyMain.route = null;

  bot.issueMovement();

  const focus = bot.primaryEnemyEstimate();
  const mainRoute = aiTeam.ships.main.route;
  const sub1Route = aiTeam.ships.sub1.route;
  const sub2Route = aiTeam.ships.sub2.route;
  assert(mainRoute && sub1Route && sub2Route, "AI未为扇区围堵生成完整三路围堵路线");

  const forward = { x: Math.cos(focus.angle), y: Math.sin(focus.angle) };
  const side = { x: -forward.y, y: forward.x };
  const relMain = { x: mainRoute.p2.x - focus.x, y: mainRoute.p2.y - focus.y };
  const rel1 = { x: sub1Route.p2.x - focus.x, y: sub1Route.p2.y - focus.y };
  const rel2 = { x: sub2Route.p2.x - focus.x, y: sub2Route.p2.y - focus.y };
  const frontMain = relMain.x * forward.x + relMain.y * forward.y;
  const front1 = rel1.x * forward.x + rel1.y * forward.y;
  const front2 = rel2.x * forward.x + rel2.y * forward.y;
  const side1 = rel1.x * side.x + rel1.y * side.y;
  const side2 = rel2.x * side.x + rel2.y * side.y;

  assert(frontMain > 70, "AI围堵时主舰未同步前顶到目标前方扇区");
  assert(front1 > 100 && front2 > 100, "AI围堵时未把副舰布到目标前方扇区");
  assert(side1 * side2 < 0, "AI围堵时双副舰未分占目标两侧扇区");
}

function aiBacklineFlankCheck() {
  const sim = new MatchSimulation({
    mode: "ai",
    worldSize: 1440,
    teamLoadouts: {
      A: {
        main: "haruhi",
        sub1: "koizumi",
        sub2: "tsuruya",
      },
      B: {
        main: "kyon",
        sub1: "future1096",
        sub2: "asakura",
      },
    },
  });
  const bot = sim.bot;
  const aiTeam = sim.teamB;
  const aiMain = aiTeam.ships.main;
  const sub1 = aiTeam.ships.sub1;
  const sub2 = aiTeam.ships.sub2;
  const enemyMain = sim.teamA.ships.main;

  aiTeam.split(1);
  aiTeam.split(2);

  aiMain.x = 1080;
  aiMain.y = 720;
  aiMain.command.x = aiMain.x;
  aiMain.command.y = aiMain.y;
  aiMain.route = null;

  sub1.x = 1020;
  sub1.y = 770;
  sub1.command.x = sub1.x;
  sub1.command.y = sub1.y;
  sub1.route = null;

  sub2.x = 1020;
  sub2.y = 670;
  sub2.command.x = sub2.x;
  sub2.command.y = sub2.y;
  sub2.route = null;

  enemyMain.x = 780;
  enemyMain.y = 720;
  enemyMain.angle = 0;
  enemyMain.command.x = enemyMain.x;
  enemyMain.command.y = enemyMain.y;
  enemyMain.route = null;

  bot.rememberContact(enemyMain, "visible");
  const context = bot.buildTacticalContext(aiMain, bot.selectEnemyFocus(aiMain));
  bot.issueMovement(context);

  assert(sub1.route && sub2.route, "AI未为绕后副舰生成路线");

  const rearAxis = { x: Math.cos(enemyMain.angle), y: Math.sin(enemyMain.angle) };
  const rear1 = (sub1.route.p2.x - enemyMain.x) * rearAxis.x + (sub1.route.p2.y - enemyMain.y) * rearAxis.y;
  const rear2 = (sub2.route.p2.x - enemyMain.x) * rearAxis.x + (sub2.route.p2.y - enemyMain.y) * rearAxis.y;

  assert(rear1 < -110 || rear2 < -110, "AI未主动把至少一支绕后副舰送到敌舰后方");
  assert(sub1.throttle >= 0.98 || sub2.throttle >= 0.98, "AI绕后副舰推进仍不够积极");
}

function aiOverwhelmedEscapeCheck() {
  const sim = new MatchSimulation({ mode: "ai", worldSize: 1440 });
  const bot = sim.bot;
  const aiTeam = sim.teamB;
  const aiMain = aiTeam.ships.main;
  const sub1 = aiTeam.ships.sub1;
  const sub2 = aiTeam.ships.sub2;
  const enemyMain = sim.teamA.ships.main;
  const enemySub1 = sim.teamA.ships.sub1;

  aiTeam.split(1);
  aiTeam.split(2);

  aiMain.x = 1100;
  aiMain.y = 720;
  aiMain.command.x = aiMain.x;
  aiMain.command.y = aiMain.y;
  aiMain.route = null;

  sub1.x = 890;
  sub1.y = 740;
  sub1.command.x = sub1.x;
  sub1.command.y = sub1.y;
  sub1.route = null;
  sub1.hp = sub1.maxHp * 0.42;
  sub1.energy = sub1.maxEnergy * 0.24;

  sub2.x = 1060;
  sub2.y = 650;
  sub2.command.x = sub2.x;
  sub2.command.y = sub2.y;
  sub2.route = null;

  enemyMain.x = 760;
  enemyMain.y = 700;
  enemyMain.angle = 0;
  enemyMain.command.x = enemyMain.x;
  enemyMain.command.y = enemyMain.y;
  enemyMain.route = null;

  enemySub1.x = 790;
  enemySub1.y = 785;
  enemySub1.angle = 0;
  enemySub1.command.x = enemySub1.x;
  enemySub1.command.y = enemySub1.y;
  enemySub1.route = null;

  bot.rememberContact(enemyMain, "visible");
  bot.rememberContact(enemySub1, "visible");
  const context = bot.buildTacticalContext(aiMain, bot.selectEnemyFocus(aiMain));
  bot.issueMovement(context);

  assert(sub1.route, "AI未为被围攻副舰生成脱困路线");

  const enemyCenterX = (enemyMain.x + enemySub1.x) * 0.5;
  const enemyCenterY = (enemyMain.y + enemySub1.y) * 0.5;
  const startDist = Math.hypot(sub1.x - enemyCenterX, sub1.y - enemyCenterY);
  const targetDist = Math.hypot(sub1.route.p2.x - enemyCenterX, sub1.route.p2.y - enemyCenterY);

  assert(targetDist > startDist + 90, "AI被围攻副舰未明显朝远离双火力源的方向脱困");
  assert(sub1.throttle >= 1.02, "AI被围攻副舰脱困时未提升推进输出");

  bot.scoutTimer = 10;
  bot.update(TICK_DT, sim.elapsed + TICK_DT);
  assert(bot.scoutTimer <= 0.45, "AI单舰受压时未立刻把侦察节奏提前到高压模式");
}

function aiEnergyRecoveryModeCheck() {
  const sim = new MatchSimulation({ mode: "ai", worldSize: 1440 });
  const bot = sim.bot;
  const aiTeam = sim.teamB;
  const aiMain = aiTeam.ships.main;
  const enemyMain = sim.teamA.ships.main;

  for (const ship of aiTeam.getAllShips()) {
    ship.energy = ship.maxEnergy * 0.08;
  }

  enemyMain.x = 640;
  enemyMain.y = 360;
  enemyMain.angle = 0;
  enemyMain.command.x = enemyMain.x;
  enemyMain.command.y = enemyMain.y;
  enemyMain.route = null;

  bot.rememberContact(enemyMain, "visible");
  const context = bot.buildTacticalContext(aiMain, {
    id: 999001,
    kind: "ship",
    slotKey: "main",
    characterId: enemyMain.characterId,
    x: enemyMain.x,
    y: enemyMain.y,
    angle: enemyMain.angle,
    speed: 0,
    age: 6.2,
    source: "memory",
    confidence: 0.57,
    uncertainty: 0,
    visible: false,
    zoneId: bot.zoneForPoint(enemyMain.x, enemyMain.y).id,
  });
  bot.issueMovement(context);

  assert(bot.mode === "harvest", "AI低能且无紧急接敌时未进入回能模式");
  assert(aiMain.route && aiMain.throttle <= 0.82, "AI低能回能时主舰油门仍过高");
}

function aiHighEnergySkillAggressionCheck() {
  const sim = new MatchSimulation({
    mode: "ai",
    worldSize: 1440,
    teamLoadouts: {
      A: {
        main: "haruhi",
        sub1: "koizumi",
        sub2: "tsuruya",
      },
      B: {
        main: "koizumi",
        sub1: "haruhi",
        sub2: "tsuruya",
      },
    },
  });
  const bot = sim.bot;
  const aiTeam = sim.teamB;
  const aiMain = aiTeam.ships.main;
  const enemyMain = sim.teamA.ships.main;

  aiTeam.split(1);
  aiMain.x = 980;
  aiMain.y = 720;
  aiMain.command.x = aiMain.x;
  aiMain.command.y = aiMain.y;
  aiMain.route = null;

  aiTeam.ships.sub1.x = 948;
  aiTeam.ships.sub1.y = 764;
  aiTeam.ships.sub1.command.x = aiTeam.ships.sub1.x;
  aiTeam.ships.sub1.command.y = aiTeam.ships.sub1.y;
  aiTeam.ships.sub1.route = null;

  enemyMain.x = 770;
  enemyMain.y = 720;
  enemyMain.angle = Math.PI;
  enemyMain.command.x = enemyMain.x;
  enemyMain.command.y = enemyMain.y;
  enemyMain.route = null;

  aiMain.energy = aiMain.maxEnergy * 0.9;
  aiTeam.ships.sub1.energy = aiTeam.ships.sub1.maxEnergy * 0.88;
  aiTeam.ships.sub2.energy = aiTeam.ships.sub2.maxEnergy * 0.9;
  bot.flagshipTimer = 0;
  bot.subTimers.sub1 = 0;

  bot.rememberContact(enemyMain, "visible");
  const context = bot.buildTacticalContext(aiMain, bot.selectEnemyFocus(aiMain));
  bot.tryFlagshipSkill(context);
  bot.trySubSkill("sub1", context);

  assert(aiTeam.effects.taxiUntil > sim.elapsed, "AI高能接敌时未积极释放旗舰技能");
  assert(aiTeam.ships.sub1.hasEffect("critUntil"), "AI高能接敌时未积极释放分舰技能");
}

function aiEmergencyEnergyCommitCheck() {
  const sim = new MatchSimulation({
    mode: "ai",
    worldSize: 1440,
    teamLoadouts: {
      A: {
        main: "haruhi",
        sub1: "koizumi",
        sub2: "tsuruya",
      },
      B: {
        main: "koizumi",
        sub1: "haruhi",
        sub2: "tsuruya",
      },
    },
  });
  const bot = sim.bot;
  const aiTeam = sim.teamB;
  const aiMain = aiTeam.ships.main;
  const enemyMain = sim.teamA.ships.main;

  aiMain.x = 960;
  aiMain.y = 720;
  aiMain.command.x = aiMain.x;
  aiMain.command.y = aiMain.y;
  aiMain.route = null;

  enemyMain.x = 790;
  enemyMain.y = 720;
  enemyMain.angle = Math.PI;
  enemyMain.command.x = enemyMain.x;
  enemyMain.command.y = enemyMain.y;
  enemyMain.route = null;

  aiMain.energy = 30;
  aiTeam.ships.sub1.energy = 20;
  aiTeam.ships.sub2.energy = 30;
  bot.flagshipTimer = 0;

  bot.rememberContact(enemyMain, "visible");
  const context = bot.buildTacticalContext(aiMain, bot.selectEnemyFocus(aiMain));
  bot.issueMovement(context);
  bot.tryFlagshipSkill(context);

  assert(bot.mode !== "harvest", "AI接敌紧急时仍错误进入回能模式");
  assert(aiTeam.effects.taxiUntil > sim.elapsed, "AI接敌紧急时未优先把能量用于压制技能");
  assert(aiMain.route && aiMain.throttle >= 0.92, "AI接敌紧急时主舰推进仍过于保守");
}

function aiPressureCheck() {
  const sim = new MatchSimulation({ mode: "ai", worldSize: 1440 });
  const startDist = Math.hypot(
    sim.teamB.ships.main.x - sim.teamA.ships.main.x,
    sim.teamB.ships.main.y - sim.teamA.ships.main.y,
  );

  runSteps(sim, 8);

  const currentDist = Math.hypot(
    sim.teamB.ships.main.x - sim.teamA.ships.main.x,
    sim.teamB.ships.main.y - sim.teamA.ships.main.y,
  );
  assert(currentDist < startDist - 40, "AI开局压进不足，主舰未明显主动接近敌方");
}

function dualAiSeatCheck() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    aiSeats: ["A", "B"],
  });
  const aMain = sim.teamA.ships.main;
  const bMain = sim.teamB.ships.main;
  const startDist = Math.hypot(aMain.x - bMain.x, aMain.y - bMain.y);

  assert(sim.botBySeat("A"), "A席启用AI后未创建BotController");
  assert(sim.botBySeat("B"), "B席启用AI后未创建BotController");
  assert(sim.bot === sim.botBySeat("B"), "兼容接口 sim.bot 未继续指向 B 席 AI");

  runSteps(sim, 8);

  const currentDist = Math.hypot(aMain.x - bMain.x, aMain.y - bMain.y);
  assert(currentDist < startDist - 70, "双边 AI 对战时双方未明显主动接近");
}

function aiDebugSnapshotCheck() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    aiSeats: ["A", "B"],
  });

  runSteps(sim, 1.2);
  const state = sim.serializeState();

  assert(state.bots && state.bots.A && state.bots.B, "调试快照未包含双方 AI 状态");
  assert(typeof state.bots.A.mode === "string" && typeof state.bots.B.mode === "string", "AI 调试快照缺少当前模式");
  assert(state.bots.A.focus && Number.isFinite(state.bots.A.focus.x), "A 队 AI 调试快照缺少焦点目标");
  assert(state.bots.B.focus && Number.isFinite(state.bots.B.focus.y), "B 队 AI 调试快照缺少焦点目标");
  assert(state.bots.A.orders?.main && Number.isFinite(state.bots.A.orders.main.target?.x), "A 队 AI 调试快照缺少主舰命令");
  assert(state.bots.B.orders?.main && Number.isFinite(state.bots.B.orders.main.target?.y), "B 队 AI 调试快照缺少主舰命令");
  assert(Number.isFinite(state.bots.A.scoutDecision?.nextIn), "A 队 AI 调试快照缺少侦察计时");
  assert(Number.isFinite(state.bots.B.flagshipDecision?.nextIn), "B 队 AI 调试快照缺少旗舰技计时");
}

function aiEdgeRecoveryCheck() {
  const sim = new MatchSimulation({ mode: "ai", worldSize: 1440 });
  const bot = sim.bot;
  const aiMain = sim.teamB.ships.main;
  const enemyMain = sim.teamA.ships.main;

  aiMain.x = 1410;
  aiMain.y = 720;
  aiMain.angle = Math.PI;
  aiMain.command.x = aiMain.x;
  aiMain.command.y = aiMain.y;
  aiMain.route = null;

  enemyMain.x = 760;
  enemyMain.y = 720;
  enemyMain.command.x = enemyMain.x;
  enemyMain.command.y = enemyMain.y;
  enemyMain.route = null;

  bot.issueMovement();

  assert(aiMain.route, "AI靠边时未重新生成脱边路线");
  assert(aiMain.route.p2.x < 1320, "AI脱边路线终点仍过于贴近地图右边缘");

  const startX = aiMain.x;
  runSteps(sim, 4);
  assert(aiMain.x < startX - 55, "AI靠边后未明显驶离地图边缘");
}

function main() {
  closeRangeCombatCheck();
  speedAndEnergyRuleCheck();
  emergencyBrakeCheck();
  autoScoutCheck();
  splitFormationCheck();
  initialFormationStabilityCheck();
  future1096LeaderHandoverCheck();
  flagshipLossAutoSplitCheck();
  skippedSplitLevelCheck();
  yukiPassiveCheck();
  koizumiFlagshipInvulnCheck();
  koizumiBlinkStrikeCheck();
  beamSkillCheck();
  tsuruyaFlagshipActiveCheck();
  fireArcDensityCheck();
  kyonUniformFireRateCheck();
  haruhiBlindfireCheck();
  asakuraFlagshipCheck();
  asakuraBladeQueenCheck();
  aiFogOfWarCheck();
  aiReactionDelayCheck();
  aiSearchSweepCheck();
  aiScoutAggressionCheck();
  aiRetreatJudgementCheck();
  aiFocusSelectionCheck();
  aiSplitDisciplineCheck();
  aiFireArcAwarenessCheck();
  dualAiSeatCheck();
  aiDebugSnapshotCheck();
  aiProbePressureCheck();
  aiSplitInitiativeCheck();
  aiYukiVisionLeadCheck();
  aiWoundedDetachedRetreatCheck();
  aiSectorEncirclementCheck();
  aiBacklineFlankCheck();
  aiOverwhelmedEscapeCheck();
  aiEnergyRecoveryModeCheck();
  aiHighEnergySkillAggressionCheck();
  aiEmergencyEnergyCommitCheck();
  aiPressureCheck();
  aiEdgeRecoveryCheck();
  aiEngageCheck();
  console.log("核心战斗逻辑校验通过");
}

main();
