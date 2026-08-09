import {
  AUTO_SCOUT_COOLDOWN_MULTIPLIER,
  CHARACTER_DEFS,
  ENERGY_GEAR_PROFILES,
  EMERGENCY_BRAKE_COST,
  MANUAL_SCOUT_COOLDOWN,
  MatchSimulation,
  THROTTLE_GEAR_VALUES,
  TICK_DT,
  YUKI_RADAR_ROTATION_SECONDS,
  energyRateForThrottle,
  normalizeThrottleToGear,
  throttleForGear,
  throttleGearForValue,
} from "../../shared/game-core.js";
import {
  HARUHI_OTHERWORLDER_DAMAGE_RATIO,
  HARUHI_OTHERWORLDER_KNOCKBACK_DURATION,
  HARUHI_SUPPORTS,
} from "../../shared/game/haruhi-flagship.js";
import { assert, runSteps } from "./helpers.mjs";

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

function throttleGearCheck() {
  assert(
    JSON.stringify(THROTTLE_GEAR_VALUES) === JSON.stringify([0, 0.4, 0.7, 1, 1.4]),
    "统一推进档位映射发生漂移",
  );
  assert(throttleForGear(0) === 0 && throttleForGear(4) === 1.4, "档位转推进值异常");
  assert(throttleGearForValue(0.68) === 2, "推进值未归入最近档位");
  assert(normalizeThrottleToGear(1.22) === 1.4, "连续推进值未归一到合法档位");
  assert(normalizeThrottleToGear(undefined, 0) === 0, "无效输入未保留当前P档");
  assert(ENERGY_GEAR_PROFILES.length === THROTTLE_GEAR_VALUES.length, "能量曲线与推进档位数量不一致");

  for (const character of Object.values(CHARACTER_DEFS)) {
    const rates = THROTTLE_GEAR_VALUES.map((throttle) => (
      energyRateForThrottle(character.stats.energyRegen, character.stats.moveDrain, throttle)
    ));
    for (let gear = 1; gear < rates.length; gear += 1) {
      assert(rates[gear - 1] > rates[gear], `${character.name}的能量净变化未随档位严格下降`);
    }
    assert(rates[3] > 0, `${character.name}在前进3档无法小幅回能`);
    assert(rates[4] < 0, `${character.name}在前进4档没有持续耗能`);
    assert(rates[0] >= 13 && rates[0] <= 19, `${character.name}的P档回能超出合理范围`);
  }

  const sim = new MatchSimulation({ mode: "pvp", worldSize: 1440 });
  const main = sim.teamA.ships.main;
  const parked = sim.applyActionForSeat("A", { type: "set_throttle", shipKey: "main", throttle: 0 });
  assert(parked && main.throttle === 0, "P档动作未被权威模拟接受");

  const invalid = sim.applyActionForSeat("A", { type: "set_throttle", shipKey: "main", throttle: "无效" });
  assert(!invalid && main.throttle === 0, "非法推进动作未被拒绝或破坏了当前档位");

  const routed = sim.applyActionForSeat("A", {
    type: "set_route",
    shipKey: "main",
    endX: main.x + 400,
    endY: main.y,
    throttle: 0,
  });
  assert(routed && main.route && main.throttle === 0, "P档下未能保留待执行航线");
  const startX = main.x;
  const startRouteProgress = main.route.t;
  runSteps(sim, 0.5);
  assert(Math.abs(main.x - startX) < 0.01, "P档舰船仍在移动");
  assert(Math.abs(main.route.t - startRouteProgress) < 1e-9, "P档仍在暗中推进航线进度");

  const forward = sim.applyActionForSeat("A", { type: "set_throttle", shipKey: "main", throttle: 1.22 });
  assert(forward && main.throttle === 1.4, "前进档未在服务端归一为合法档位");
  runSteps(sim, 0.5);
  assert(main.x > startX, "从P档切入前进档后未沿原航线恢复航行");

  main.energy = 50;
  main.throttle = throttleForGear(0);
  sim.teamA.updateEnergy(1);
  const parkedEnergy = main.energy;
  assert(
    Math.abs(parkedEnergy - 50 - energyRateForThrottle(main.baseEnergyRegen(), main.moveEnergyDrain(), 0)) < 1e-6,
    "权威模拟未按P档曲线回能",
  );
  main.energy = 50;
  main.throttle = throttleForGear(4);
  sim.teamA.updateEnergy(1);
  assert(main.energy < 50, "权威模拟中的前进4档未实际消耗能量");
}

function boundaryRouteThrottleCheck() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "haruhi", sub1: "shamisen", sub2: "yuki" },
    },
  });
  sim.setCombatEnabled("A", false);
  sim.setCombatEnabled("B", false);
  sim.teamA.splitLevel = 1;

  const ship = sim.teamA.ships.sub1;
  ship.x = 386.8224975466728;
  ship.y = 81.78382992744446;
  ship.angle = -1.8277443451855133;
  ship.speed = 39.80041355709545;
  ship.setBezierRoute(
    792.2996597643942,
    472.72552649490535,
    48,
    366.6995639011146,
    throttleForGear(2),
    false,
  );
  runSteps(sim, 3.1);

  assert(ship.route?.p1.y < 8, "边界换挡回归场景未生成地图外控制点");
  assert(
    sim.teamA.availableEnergyForShip(ship) >= ship.maxEnergy * 0.99,
    "边界换挡回归场景没有保持满能量",
  );
  const startX = ship.x;
  const startY = ship.y;
  const shifted = sim.applyActionForSeat("A", {
    type: "set_throttle",
    shipKey: "sub1",
    throttle: throttleForGear(3),
  });
  assert(shifted && ship.throttle === throttleForGear(3), "三味线分舰切入前进3档失败");
  runSteps(sim, 0.5);
  assert(
    Math.hypot(ship.x - startX, ship.y - startY) >= 8,
    "地图外航线前视点令满能量三味线换挡后视觉停转",
  );
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

function yukiBurstScoutStabilityCheck() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "haruhi", sub1: "yuki", sub2: "koizumi" },
      B: { main: "kyon", sub1: "haruhi", sub2: "tsuruya" },
    },
  });
  sim.combatEnabled.A = false;
  sim.combatEnabled.B = false;
  sim.teamA.split(1);
  assert(sim.teamA.castSubSkill("sub1"), "长门副舰侦察机技能释放失败");
  assert(sim.teamA.scouts.length === 16, "长门副舰技能未生成完整侦察机群");

  const scout = sim.teamA.scouts[0];
  runSteps(sim, 2.5);
  assert(scout.mode === "orbit", "长门副舰侦察机未进入环绕阶段");
  assert(
    Math.abs(scout.orbitSpeed) >= 2.4 && Math.abs(scout.orbitSpeed) <= 4.8,
    "长门副舰侦察机未保持高速环绕角速度",
  );

  let stoppedFrames = 0;
  let maxStep = 0;
  let maxRadiusError = 0;
  for (let index = 0; index < 60; index += 1) {
    const previousX = scout.x;
    const previousY = scout.y;
    sim.update(TICK_DT);
    const step = Math.hypot(scout.x - previousX, scout.y - previousY);
    if (step < 0.05) stoppedFrames += 1;
    maxStep = Math.max(maxStep, step);
    maxRadiusError = Math.max(
      maxRadiusError,
      Math.abs(Math.hypot(scout.x - scout.anchor.x, scout.y - scout.anchor.y) - scout.anchorRadius),
    );
  }

  assert(stoppedFrames === 0, "长门副舰侦察机环绕仍出现走一帧停一帧的抖动");
  assert(maxStep < 3, "长门副舰侦察机环绕单帧位移仍存在异常跳变");
  assert(maxRadiusError < 1e-6, "长门副舰侦察机未沿稳定圆轨道运动");
}

function yukiFlagshipCombatScoutCheck() {
  const yukiSim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "yuki", sub1: "haruhi", sub2: "koizumi" },
      B: { main: "kyon", sub1: "tsuruya", sub2: "future1096" },
    },
  });
  const yukiTeam = yukiSim.teamA;
  const yukiStats = CHARACTER_DEFS.yuki.stats;
  assert(yukiTeam.launchScout(5, { fromShipKey: "sub1" }), "长门旗舰队伍未能从副舰释放侦察机");
  assert(yukiTeam.scouts.length === 2, "长门旗舰每次没有同时释放两架战斗僚机");
  const [combatScout, escortScout] = yukiTeam.scouts;
  for (const scout of yukiTeam.scouts) {
    assert(scout.combatCapable, "长门旗舰未将己方侦察机强化为战斗僚机");
    assert(scout.vision === yukiStats.vision, "长门战斗僚机视野未提升到普通舰船级别");
    assert(scout.attackRange === scout.vision, "长门战斗僚机射程未与自身视野保持一致");
    assert(scout.effectiveDamage() === 16, "长门战斗僚机基础伤害不是16");
    assert(
      Math.abs(scout.effectiveFireRate() - yukiStats.fireRate) < 1e-9,
      "长门战斗僚机射速不是常规舰炮射速",
    );
  }
  assert(
    Math.hypot(combatScout.x - escortScout.x, combatScout.y - escortScout.y) > 0,
    "长门同时释放的两架战斗僚机完全重叠",
  );

  const enemyMain = yukiSim.teamB.ships.main;
  for (const [index, scout] of yukiTeam.scouts.entries()) {
    scout.x = 680;
    scout.y = 712 + index * 16;
    scout.cooldown = 0;
  }
  enemyMain.x = 800;
  enemyMain.y = 720;
  for (const ship of yukiTeam.getAllShips()) ship.cooldown = 999;
  yukiTeam.visibleEnemyIds.add(enemyMain.id);
  yukiSim.projectiles = [];
  yukiTeam.stepCombat(yukiSim.teamB);
  assert(yukiSim.projectiles.length === 2, "两架长门战斗僚机未通过权威战斗循环同时开火");
  assert(
    new Set(yukiSim.projectiles.map((projectile) => projectile.sourceId)).size === 2,
    "两架长门战斗僚机的弹丸来源标记错误",
  );
  assert(yukiSim.projectiles.every((projectile) => projectile.damage === 16), "长门战斗僚机弹丸伤害不是16");
  for (const scout of yukiTeam.scouts) {
    assert(
      Math.abs(scout.cooldown - 1 / yukiStats.fireRate) < 1e-9,
      "长门战斗僚机攻击间隔不是常规舰炮频率",
    );
  }
  yukiTeam.stepCombat(yukiSim.teamB);
  assert(yukiSim.projectiles.length === 2, "长门战斗僚机无视攻击冷却连续开火");

  for (const scout of yukiTeam.scouts) scout.cooldown = 0;
  enemyMain.x = combatScout.x + combatScout.vision + 10;
  enemyMain.y = combatScout.y;
  yukiSim.projectiles = [];
  yukiTeam.stepCombat(yukiSim.teamB);
  assert(
    yukiSim.projectiles.length === 0,
    "长门战斗僚机向自身视野外目标开火",
  );

  const normalSim = new MatchSimulation({ mode: "pvp", worldSize: 1440 });
  const normalTeam = normalSim.teamA;
  assert(normalTeam.launchScout(5), "普通旗舰队伍未能释放对照侦察机");
  assert(normalTeam.scouts.length === 1, "非长门旗舰队伍也一次释放了多架侦察机");
  const normalScout = normalTeam.scouts[0];
  assert(!normalScout.combatCapable, "非长门旗舰的侦察机被错误强化为战斗僚机");
  assert(normalScout.vision === 95, "非长门旗舰的普通侦察机视野被意外改动");
  normalScout.x = 680;
  normalScout.y = 720;
  const normalEnemy = normalSim.teamB.ships.main;
  normalEnemy.x = 800;
  normalEnemy.y = 720;
  for (const ship of normalTeam.getAllShips()) ship.cooldown = 999;
  normalTeam.visibleEnemyIds.add(normalEnemy.id);
  normalSim.projectiles = [];
  normalTeam.stepCombat(normalSim.teamB);
  assert(normalSim.projectiles.length === 0, "非长门旗舰的普通侦察机错误开火");
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

function initialSpawnPositionCheck() {
  const worldSize = 1440;
  const zoneWidth = worldSize / 3;
  const retreatDistance = zoneWidth * 0.25;
  const sim = new MatchSimulation({ mode: "pvp", worldSize });
  const aMain = sim.teamA.ships.main;
  const bMain = sim.teamB.ships.main;
  const zoneIdAt = (ship) => sim.zones.find((zone) => (
    ship.x >= zone.x
    && ship.x <= zone.x + zone.width
    && ship.y >= zone.y
    && ship.y <= zone.y + zone.height
  ))?.id;

  assert(Math.abs(aMain.x - (worldSize * 0.35 - retreatDistance)) < 1e-9, "A方未向己方后方移动四分之一战区");
  assert(Math.abs(bMain.x - (worldSize * 0.65 + retreatDistance)) < 1e-9, "B方未向己方后方移动四分之一战区");
  assert(Math.abs(aMain.y - worldSize * 0.5) < 1e-9, "A方出生点纵坐标发生意外变化");
  assert(Math.abs(bMain.y - worldSize * 0.5) < 1e-9, "B方出生点纵坐标发生意外变化");
  assert(Math.abs((worldSize - bMain.x) - aMain.x) < 1e-9, "双方出生点不再关于地图中心对称");
  assert(zoneIdAt(aMain) === 4, "A方出生点未落入己方中路战区");
  assert(zoneIdAt(bMain) === 6, "B方出生点未落入己方中路战区");
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

function future1096FormSwitchCheck() {
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
  const ships = teamA.getPlayerShips();
  for (const ship of ships) {
    ship.speed = ship.baseSpeed() * 0.8;
  }
  const baseline = new Map(ships.map((ship) => [ship.id, {
    maxHp: ship.maxHp,
    hp: ship.hp,
    speed: ship.baseSpeed(),
    actualSpeed: ship.speed,
    fireRate: ship.effectiveFireRate(),
  }]));

  assert(teamA.future1096Form === null, "1096 旗舰开局不应预设形态");
  assert(teamA.extraShips.length === 0, "1096 旧版双舰被动仍在生成僚舰");
  for (const ship of ships) ship.cooldown = 0.8;

  assert(sim.applyActionForSeat("A", { type: "cast_flagship_skill" }), "1096 首次切换A形态失败");
  assert(teamA.future1096Form === "A", "1096 首次使用未进入A形态");
  assert(teamA.cooldowns.flagship === 10, "1096 旗舰技能冷却不是10秒");
  assert(!teamA.castFlagshipSkill(), "1096 旗舰技能在冷却中仍可切换形态");
  for (const ship of ships) {
    const base = baseline.get(ship.id);
    assert(ship.maxHp === base.maxHp, "A形态不应再改变全队生命上限");
    assert(ship.hp === base.hp, "A形态切换不应改变全队当前生命");
    assert(Math.abs(ship.damageTakenMultiplier() - 2) < 1e-9, "A形态未使全队受到伤害变为200%");
    assert(Math.abs(ship.baseSpeed() / base.speed - 1.5) < 1e-9, "A形态未使全队航速变为150%");
    assert(Math.abs(ship.speed / base.actualSpeed - 1.5) < 1e-9, "A形态未立即把全队实际航速提升50%");
    assert(Math.abs(ship.effectiveFireRate() / base.fireRate - 2) < 1e-9, "A形态未使全队射速变为200%");
    assert(Math.abs(ship.cooldown - 0.4) < 1e-9, "A形态未同步换算当前攻击间隔");
    const hpBeforeDamage = ship.hp;
    ship.takeDamage(20, null, sim, false);
    assert(Math.abs(hpBeforeDamage - ship.hp - 40) < 1e-9, "A形态易伤未在最终承伤阶段生效");
    ship.hp = ship.maxHp * 0.4;
    ship.cooldown = 0.25;
  }

  const maxHpDamageProbe = teamA.ships.main;
  maxHpDamageProbe.hp = maxHpDamageProbe.maxHp;
  maxHpDamageProbe.takeDamage(maxHpDamageProbe.maxHp * 0.1, null, sim, false);
  assert(
    Math.abs(maxHpDamageProbe.hp - maxHpDamageProbe.maxHp * 0.8) < 1e-9,
    "A形态未对按最大生命值结算的伤害应用易伤，或仍在改写生命上限",
  );
  maxHpDamageProbe.hp = maxHpDamageProbe.maxHp * 0.4;

  const movingMain = teamA.ships.main;
  const movingMainBase = baseline.get(movingMain.id);
  const startX = movingMain.x;
  movingMain.command.x = movingMain.x + 600;
  movingMain.command.y = movingMain.y;
  runSteps(sim, 0.25);
  assert(
    movingMain.x - startX > movingMainBase.actualSpeed * 0.25 * 1.25,
    "A形态切换后的短时实际位移未体现显著提速",
  );
  // 还原为切换瞬间的状态，隔离后续 B 形态倍率断言。
  for (const ship of ships) {
    const base = baseline.get(ship.id);
    ship.speed = base.actualSpeed * 1.5;
    ship.cooldown = 0.25;
  }

  teamA.cooldowns.flagship = 0;
  assert(teamA.castFlagshipSkill(), "1096 切换B形态失败");
  assert(teamA.future1096Form === "B", "1096 第二次使用未进入B形态");
  for (const ship of ships) {
    const base = baseline.get(ship.id);
    assert(ship.maxHp === base.maxHp, "B形态不应再改变全队生命上限");
    assert(Math.abs(ship.hp / ship.maxHp - 0.4) < 1e-9, "B形态切换不应改变当前生命");
    assert(Math.abs(ship.damageTakenMultiplier() - 0.5) < 1e-9, "B形态未使全队受到伤害降为50%");
    assert(Math.abs(ship.baseSpeed() / base.speed - 0.5) < 1e-9, "B形态未使全队航速变为50%");
    assert(Math.abs(ship.speed / base.actualSpeed - 0.5) < 1e-9, "B形态未立即把全队实际航速降为50%");
    assert(Math.abs(ship.effectiveFireRate() / base.fireRate - 0.5) < 1e-9, "B形态未使全队射速变为50%");
    assert(Math.abs(ship.cooldown - 1) < 1e-9, "B形态未同步换算当前攻击间隔");
    const hpBeforeDamage = ship.hp;
    ship.takeDamage(20, null, sim, false);
    assert(Math.abs(hpBeforeDamage - ship.hp - 10) < 1e-9, "B形态减伤未在最终承伤阶段生效");
  }

  assert(teamA.serialize().future1096Form === "B", "1096 当前形态未进入权威快照");
  teamA.cooldowns.flagship = 0;
  assert(teamA.castFlagshipSkill() && teamA.future1096Form === "A", "1096 后续使用没有交替回到A形态");
  for (const ship of ships) {
    const base = baseline.get(ship.id);
    assert(ship.maxHp === base.maxHp, "B形态切回A形态时生命上限发生变化");
    assert(Math.abs(ship.damageTakenMultiplier() - 2) < 1e-9, "B形态切回A形态时易伤没有恢复");
    assert(Math.abs(ship.speed / base.actualSpeed - 1.5) < 1e-9, "B形态切回A形态时实际航速没有同步恢复");
  }
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
  const enemyMain = sim.teamB.ships.main;
  const zoneWidth = sim.zones[0].width;

  assert(!teamA.areSkillsDisabled(), "长门新雷达被动仍错误封印全队技能");
  const initialRadar = sim.serializeRadarForSeat("A");
  assert(initialRadar?.active, "长门旗舰雷达未在开局自动启用");
  assert(Math.abs(initialRadar.rotationSeconds - 2.2) < 1e-9, "长门雷达没有以2.2秒一圈旋转");
  assert(initialRadar.angularVelocity < 0, "长门雷达没有沿画布视觉逆时针方向旋转");

  const originalMainPose = { x: main.x, y: main.y, angle: main.angle };
  const angleBeforeMovement = initialRadar.angle;
  main.x += 180;
  main.y -= 110;
  main.angle += 1.7;
  sim.elapsed += 1;
  teamA.updateRadarPassive(sim.teamB, 1);
  const angleAfterMovement = sim.serializeRadarForSeat("A").angle;
  const sweptAfterMovement = (angleBeforeMovement - angleAfterMovement + Math.PI * 2) % (Math.PI * 2);
  assert(
    Math.abs(sweptAfterMovement - (Math.PI * 2) / YUKI_RADAR_ROTATION_SECONDS) < 1e-9,
    "长门雷达角速度受到旗舰位移、转向或速度状态影响",
  );
  Object.assign(main, originalMainPose);

  const alignRadarToBearingZero = () => {
    teamA.radarPassive.epochAngle = ((Math.PI * 2) / YUKI_RADAR_ROTATION_SECONDS) * sim.elapsed;
    teamA.radarPassive.angle = 0;
    teamA.radarPassive.contacts.clear();
    sim.elapsed += TICK_DT;
  };

  // 出生点间距属于对局平衡参数；雷达分档测试显式摆到「一个战区内」的适中距离，
  // 避免出生点调整意外改变本用例要验证的雷达语义。
  enemyMain.x = main.x + zoneWidth * 0.85;
  enemyMain.y = main.y;
  const energyBeforeScan = main.energy;
  alignRadarToBearingZero();
  teamA.computeVisibility(sim.teamB);
  assert(!teamA.visibleEnemyIds.has(enemyMain.id), "长门雷达测试前置敌舰应在常规视野外");
  teamA.updateRadarPassive(sim.teamB, TICK_DT);
  const mediumRadar = sim.serializeRadarForSeat("A");
  const mediumContact = mediumRadar.contacts.find((contact) => contact.targetId === enemyMain.id);
  assert(mediumContact, "长门雷达波扫过视野外敌舰时未生成回波");
  assert(mediumContact.kind === "afterimage", "适中距离的雷达回波未显示为舰队残影");
  assert(mediumContact.characterId === enemyMain.characterId, "适中距离的雷达残影未携带角色身份");
  assert(Math.hypot(enemyMain.x - main.x, enemyMain.y - main.y) <= zoneWidth, "角色识别测试目标不在一个战区宽度内");
  assert(main.energy === energyBeforeScan, "长门被动雷达错误消耗了能量");
  assert(!teamA.visibleEnemyIds.has(enemyMain.id), "长门雷达回波错误转化成了真实视野");

  enemyMain.x = main.x + zoneWidth + 1;
  enemyMain.y = main.y;
  alignRadarToBearingZero();
  teamA.computeVisibility(sim.teamB);
  teamA.updateRadarPassive(sim.teamB, TICK_DT);
  const outsideIdentifyContact = sim.serializeRadarForSeat("A").contacts.find((contact) => contact.targetId === enemyMain.id);
  assert(outsideIdentifyContact?.kind === "disturbance", "超过一个战区宽度后仍显示可辨识的舰队残影");
  assert(outsideIdentifyContact.characterId === null, "超过一个战区宽度后仍泄露角色身份");

  enemyMain.x = sim.worldSize - 10;
  enemyMain.y = main.y;
  alignRadarToBearingZero();
  teamA.computeVisibility(sim.teamB);
  teamA.updateRadarPassive(sim.teamB, TICK_DT);
  const farContact = sim.serializeRadarForSeat("A").contacts.find((contact) => contact.targetId === enemyMain.id);
  assert(farContact?.kind === "disturbance", "远距离雷达回波未降级为水面扰动");
  assert(farContact.characterId === null, "远距离雷达扰动错误泄露了角色身份");
  assert(farContact.uncertainty > mediumContact.uncertainty, "雷达距离变远后误差范围没有增大");
  assert(farContact.clarity < mediumContact.clarity, "雷达距离变远后清晰度没有降低");
  assert(
    Math.hypot(farContact.x - enemyMain.x, farContact.y - enemyMain.y) <= farContact.uncertainty + 1e-6,
    "雷达估算位置超出了声明的误差范围",
  );

  enemyMain.x = main.x + 100;
  enemyMain.y = main.y;
  alignRadarToBearingZero();
  teamA.computeVisibility(sim.teamB);
  assert(teamA.visibleEnemyIds.has(enemyMain.id), "近距离敌舰未进入任意常规视野");
  teamA.updateRadarPassive(sim.teamB, TICK_DT);
  assert(
    !sim.serializeRadarForSeat("A").contacts.some((contact) => contact.targetId === enemyMain.id),
    "已在常规视野内的敌舰仍显示雷达扫描效果",
  );
  assert(enemyMain.nameRevealed, "长门雷达扫过真实视野内敌舰后未永久确认角色名");

  enemyMain.x = main.x + zoneWidth + 120;
  teamA.computeVisibility(sim.teamB);
  assert(!teamA.visibleEnemyIds.has(enemyMain.id), "角色名持续显示测试中的敌舰未离开真实视野");
  assert(
    sim.teamB.serialize().ships.main.nameRevealed,
    "敌舰离开真实视野后，长门雷达确认的角色名未沿用持续显示状态",
  );

  main.takeDamage(main.maxHp * 2, null, sim);
  assert(!main.alive, "旧版长门复活效果未从新雷达被动中移除");
  assert(sim.serializeRadarForSeat("A") === null, "长门旗舰被击毁后雷达仍从无来源位置工作");
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

function koizumiOrbRamCheck() {
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
        main: "haruhi",
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
  enemyMain.x = 790;
  enemyMain.y = 730;
  enemyMain.command.x = enemyMain.x;
  enemyMain.command.y = enemyMain.y;
  enemyMain.route = null;

  const meta = CHARACTER_DEFS.koizumi.subSkill;
  assert(meta.cooldown === 15 && meta.duration === 8, "古泉光球技能持续或冷却配置不正确");
  const castOk = teamA.castSubSkill("sub1");
  assert(castOk, "古泉分舰光球技能释放失败");
  assert(sub1.koizumiOrb?.phase === "active", "古泉释放后未进入高速光球状态");
  assert(Math.abs(teamA.cooldowns.sub1 - 15) < 1e-6, "古泉光球技能未进入15秒冷却");

  teamA.visibleEnemyIds.add(enemyMain.id);
  sub1.cooldown = 0;
  sim.projectiles = [];
  sub1.tryAttack(sim, sim.teamB);
  assert(sim.projectiles.length === 0, "古泉处于光球形态时仍能正常射击");

  sim.teamB.visibleEnemyIds = new Set([sub1.id]);
  enemyMain.cooldown = 0;
  enemyMain.tryAttack(sim, teamA);
  assert(sim.projectiles.length === 0, "敌舰仍会把古泉光球选为射击目标");

  const hpBeforeRam = enemyMain.hp;
  sub1.koizumiOrb.previousX = 720;
  sub1.koizumiOrb.previousY = 720;
  sub1.x = 810;
  sub1.y = 720;
  sim.resolveKoizumiOrbContacts();
  assert(enemyMain.hp === hpBeforeRam, "古泉光球冲撞错误造成了伤害");
  assert(enemyMain.forcedKnockback, "古泉光球冲撞没有触发侧向击飞");
  assert(
    Math.abs(enemyMain.forcedKnockback.toY - enemyMain.forcedKnockback.fromY) > sub1.effectiveVision() * 0.8,
    "古泉光球没有把目标向侧面击飞约一个视野距离",
  );
  assert(enemyMain.isSilenced(), "古泉光球冲撞没有令目标沉默");
  assert(!sim.teamB.castFlagshipSkill(), "被古泉撞击沉默的旗舰仍能释放技能");

  const firstSilenceUntil = enemyMain.effects.silencedUntil;
  sim.elapsed += 1;
  sub1.koizumiOrb.hitAt.delete(enemyMain.id);
  sub1.koizumiOrb.previousX = enemyMain.x - 50;
  sub1.koizumiOrb.previousY = enemyMain.y;
  sub1.x = enemyMain.x + 50;
  sub1.y = enemyMain.y;
  sim.resolveKoizumiOrbContacts();
  assert(enemyMain.effects.silencedUntil > firstSilenceUntil + 0.9, "重复撞击没有刷新5秒沉默时间");

  const returnSim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "haruhi", sub1: "koizumi", sub2: "yuki" },
      B: { main: "kyon", sub1: "tsuruya", sub2: "future1096" },
    },
  });
  returnSim.teamA.split(1);
  const returning = returnSim.teamA.ships.sub1;
  returning.x = 180;
  returning.y = 260;
  returning.command = { x: 1200, y: 1180 };
  returning.angle = -0.15;
  returning.energy = returning.maxEnergy;
  assert(returnSim.teamA.castSubSkill("sub1"), "古泉自动归航测试无法释放技能");
  runSteps(returnSim, 8.1);
  assert(returning.koizumiOrb?.phase === "returning", "8秒结束后古泉未进入光球归航阶段");
  assert(!returning.canControl(), "古泉自动归航期间仍可接受手动航线");
  let returnGuard = 0;
  while (returning.koizumiOrb && returnGuard < 360) {
    returnSim.update(1 / 30);
    returnGuard += 1;
  }
  assert(!returning.koizumiOrb, "古泉光球没有在合理时间内完成强制归航");
  assert(Math.hypot(returning.x - 720, returning.y - 720) < 1e-6, "古泉没有在战场中央恢复正常形态");
  assert(returning.canControl(), "古泉恢复正常形态后没有恢复控制权");
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
  const enemyFleetHpBefore = teamB.getAllShips().reduce((sum, ship) => sum + ship.hp, 0);
  const castOk = teamA.castSubSkill("sub2", { targetX: enemyMain.x, targetY: enemyMain.y });
  assert(castOk, "1096光线触发失败");
  const chargingBeam = teamA.beams.find((beam) => beam.phase === "charge");
  assert(chargingBeam, "1096光线未创建蓄力轨迹");
  assert(Math.abs(chargingBeam.maxLife - 1.05) < 1e-9, "1096光线蓄力时间不是1.05秒");
  const initialBeamVector = {
    x: chargingBeam.x2 - chargingBeam.x1,
    y: chargingBeam.y2 - chargingBeam.y1,
  };
  sub2.y += 90;
  teamA.update(TICK_DT);
  const movedBeam = teamA.beams.find((beam) => beam.phase === "charge");
  assert(movedBeam, "1096光线在移动测试中提前结束蓄力");
  const movedBeamDx = movedBeam.x2 - movedBeam.x1;
  const movedBeamDy = movedBeam.y2 - movedBeam.y1;
  const directionCross = initialBeamVector.x * movedBeamDy - initialBeamVector.y * movedBeamDx;
  const directionScale = Math.max(1, Math.hypot(initialBeamVector.x, initialBeamVector.y) * Math.hypot(movedBeamDx, movedBeamDy));
  assert(Math.abs(movedBeam.x1 - sub2.x) < 1e-6 && Math.abs(movedBeam.y1 - sub2.y) < 1e-6, "1096光线发射点未跟随舰船移动");
  assert(
    Math.abs(directionCross) / directionScale < 1e-9
      && initialBeamVector.x * movedBeamDx + initialBeamVector.y * movedBeamDy > 0,
    "1096光线随舰船移动时没有保持原始发射方向",
  );
  sub2.y -= 90;
  teamA.update(TICK_DT);

  runSteps(sim, 0.35);
  const chargingVisible = teamA.beams.some((beam) => beam.phase === "charge");
  runSteps(sim, 1.2);
  const after = teamB.hullRatio();
  const enemyFleetHpAfter = teamB.getAllShips().reduce((sum, ship) => sum + ship.hp, 0);

  assert(chargingVisible, "1096光线未进入蓄力阶段");
  assert(after < before, "1096光线未造成伤害");
  assert(enemyFleetHpBefore - enemyFleetHpAfter >= enemyMain.maxHp * 0.25, "1096光线未命中点击坐标处的目标或伤害明显偏低");
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

function haruhiFlagshipReworkCheck() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "haruhi", sub1: "yuki", sub2: "koizumi" },
      B: { main: "kyon", sub1: "tsuruya", sub2: "future1096" },
    },
  });
  sim.setCombatEnabled("A", false);
  sim.setCombatEnabled("B", false);
  const teamA = sim.teamA;
  const teamB = sim.teamB;
  teamA.splitLevel = 2;
  teamB.splitLevel = 2;
  const haruhi = teamA.ships.main;
  const target = teamB.ships.main;
  for (const ship of [...teamA.getAllShips(), ...teamB.getAllShips()]) {
    ship.throttle = 0;
    ship.speed = 0;
    ship.command = { x: ship.x, y: ship.y };
    ship.route = null;
  }

  const baseStats = {
    speed: haruhi.effectiveSpeed(),
    turnRate: haruhi.effectiveTurnRate(),
    accel: haruhi.baseAcceleration(),
    range: haruhi.effectiveRange(),
    vision: haruhi.effectiveVision(),
    damage: haruhi.effectiveDamage(),
    fireRate: haruhi.effectiveFireRate(),
  };
  teamB.computeVisibility(teamA);
  assert(!teamB.visibleEnemyIds.has(haruhi.id), "春日旗舰技能测试前置错误，本舰原本就处于敌方真实视野");
  assert(teamA.castFlagshipSkill(), "春日旗舰技能首次释放失败");
  teamB.computeVisibility(teamA);
  assert(teamB.visibleEnemyIds.has(haruhi.id), "春日旗舰技能期间没有向敌方显示主舰真实视野");
  assert(
    teamB.visibleEnemyIds.has(teamA.ships.sub1.id) && teamB.visibleEnemyIds.has(teamA.ships.sub2.id),
    "春日旗舰技能期间没有向敌方显示全部分舰的真实视野",
  );
  assert(Math.abs(teamA.effects.haruhiBoostUntil - 16) < 1e-9, "春日全队强化没有保留原技能16秒持续时间");
  assert(Math.abs(haruhi.effectiveSpeed() / baseStats.speed - 1.15) < 1e-9, "春日旗舰技能未提升15%航速");
  assert(Math.abs(haruhi.effectiveTurnRate() / baseStats.turnRate - 1.15) < 1e-9, "春日旗舰技能未提升15%机动");
  assert(Math.abs(haruhi.baseAcceleration() / baseStats.accel - 1.15) < 1e-9, "春日旗舰技能未提升15%加速度");
  assert(Math.abs(haruhi.effectiveRange() / baseStats.range - 1.15) < 1e-9, "春日旗舰技能未提升15%射程");
  assert(Math.abs(haruhi.effectiveVision() / baseStats.vision - 1.15) < 1e-9, "春日旗舰技能未提升15%视野");
  assert(Math.abs(haruhi.effectiveDamage() / baseStats.damage - 1.15) < 1e-9, "春日旗舰技能未提升15%伤害");
  assert(Math.abs(haruhi.effectiveFireRate() / baseStats.fireRate - 1.15) < 1e-9, "春日旗舰技能未提升15%射速");

  const hpBeforeReduction = haruhi.hp;
  haruhi.takeDamage(100, null, sim, false);
  assert(Math.abs(hpBeforeReduction - haruhi.hp - 85) < 1e-9, "春日旗舰技能未减免15%伤害");
  assert(
    sim.floatingTexts.some((label) => label.textKey === "我在这里！" && label.emphasis === "announcement"),
    "春日广播没有生成醒目的全局位置文字",
  );

  for (let cast = 1; cast < HARUHI_SUPPORTS.length; cast += 1) {
    teamA.cooldowns.flagship = 0;
    for (const ship of teamA.getAllShips()) ship.energy = ship.maxEnergy;
    assert(teamA.castFlagshipSkill(), `春日旗舰技能第${cast + 1}次释放失败`);
  }
  assert(teamA.haruhiFlagship.supporters.size === 4, "春日四次使用没有找到四种不重复的常驻支援");
  assert(
    HARUHI_SUPPORTS.every((id) => teamA.haruhiFlagship.supporters.has(id)),
    "春日常驻支援集合不完整",
  );

  runSteps(sim, 6.05);
  assert(teamA.scouts.length === 1, "宇宙人没有每6秒释放一架战斗僚机");
  assert(teamA.scouts.every((scout) => scout.combatCapable), "宇宙人释放的僚机没有长门旗舰战斗能力");
  assert(
    teamA.scouts.every((scout) => scout.damage === 16 && scout.vision === CHARACTER_DEFS.yuki.stats.vision),
    "宇宙人僚机属性未与长门旗舰战斗僚机保持一致",
  );

  runSteps(sim, 4.7);
  assert(teamA.beams.filter((beam) => beam.phase === "charge").length === 3, "未来人没有以0.3秒间隔错开发射三发1096光线");
  assert(teamA.beams.every((beam) => Math.abs(beam.maxLife - 1.05) < 1e-9), "未来人光线没有复用1096蓄力规则");

  const orb = teamA.serialize().haruhiFlagship.esperOrb;
  assert(orb && Math.abs(Math.hypot(orb.x - haruhi.x, orb.y - haruhi.y) - haruhi.effectiveVision()) < 1e-6, "超能力者光球没有在春日视野半径上公转");
  assert(Math.abs(orb.absorbRadius - orb.radius * 3) < 1e-9, "超能力者光球的子弹吸收半径不是自身半径的三倍");

  const radialX = (orb.x - haruhi.x) / orb.orbitRadius;
  const radialY = (orb.y - haruhi.y) / orb.orbitRadius;
  target.x = orb.x + radialX * 90;
  target.y = orb.y + radialY * 90;
  target.angle = Math.atan2(haruhi.y - target.y, haruhi.x - target.x);
  target.cooldown = 0;
  teamB.visibleEnemyIds = new Set([haruhi.id]);
  const haruhiHpBeforeOrb = haruhi.hp;
  sim.projectiles = [];
  target.tryAttack(sim, teamA);
  assert(sim.projectiles.length === 1, "超能力者光球测试未生成敌方子弹");
  for (let step = 0; step < 120 && sim.projectiles.length > 0; step += 1) {
    sim.updateProjectiles(TICK_DT);
  }
  assert(sim.projectiles.length === 0 && haruhi.hp === haruhiHpBeforeOrb, "超能力者光球没有吸收附近的敌方子弹");

  haruhi.x = 560;
  haruhi.y = 720;
  haruhi.angle = 0;
  haruhi.speed = haruhi.effectiveSpeed() * throttleForGear(2) + 1;
  haruhi.throttle = throttleForGear(2);
  haruhi.command = { x: 1000, y: haruhi.y };
  target.x = haruhi.x - haruhi.radius - target.radius + 6;
  target.y = haruhi.y;
  target.command = { x: target.x, y: target.y };
  const hpBeforeRearContact = target.hp;
  sim.update(TICK_DT);
  assert(!target.forcedKnockback, "异世界人支援被舰尾碰撞错误触发");
  assert(target.hp === hpBeforeRearContact, "异世界人舰尾碰撞错误造成了伤害");
  assert(teamA.serialize().haruhiFlagship.otherworlderReady, "异世界人舰尾碰撞错误消耗了8秒冷却");

  haruhi.x = 560;
  haruhi.y = 720;
  haruhi.speed = haruhi.effectiveSpeed() * throttleForGear(2) + 1;
  haruhi.command = { x: 1000, y: haruhi.y };
  target.x = haruhi.x;
  target.y = haruhi.y + haruhi.radius + target.radius - 6;
  target.command = { x: target.x, y: target.y };
  const hpBeforeSideContact = target.hp;
  sim.update(TICK_DT);
  assert(!target.forcedKnockback, "异世界人支援被侧面碰撞错误触发");
  assert(target.hp === hpBeforeSideContact, "异世界人侧面碰撞错误造成了伤害");
  assert(teamA.serialize().haruhiFlagship.otherworlderReady, "异世界人侧面碰撞错误消耗了8秒冷却");

  haruhi.x = 560;
  haruhi.y = 720;
  haruhi.speed = 0;
  haruhi.throttle = 0;
  haruhi.command = { x: haruhi.x, y: haruhi.y };
  target.x = haruhi.x + haruhi.radius + target.radius - 1;
  target.y = haruhi.y;
  target.command = { x: target.x, y: target.y };
  const hpBeforeStationaryBowContact = target.hp;
  sim.update(TICK_DT);
  assert(!target.forcedKnockback, "异世界人支援被原地调整后的舰首接触错误触发");
  assert(target.hp === hpBeforeStationaryBowContact, "异世界人原地舰首接触错误造成了伤害");
  assert(teamA.serialize().haruhiFlagship.otherworlderReady, "异世界人原地舰首接触错误消耗了8秒冷却");

  haruhi.x = 560;
  haruhi.y = 720;
  haruhi.speed = haruhi.effectiveSpeed() * throttleForGear(2) - 2;
  haruhi.command = { x: haruhi.x, y: haruhi.y };
  target.x = haruhi.x + haruhi.radius + target.radius - 1;
  target.y = haruhi.y;
  target.command = { x: target.x, y: target.y };
  const hpBeforeSlowBowContact = target.hp;
  sim.update(TICK_DT);
  assert(!target.forcedKnockback, "异世界人支援在未达到二档实际航速时错误触发");
  assert(target.hp === hpBeforeSlowBowContact, "异世界人低速舰首接触错误造成了伤害");
  assert(teamA.serialize().haruhiFlagship.otherworlderReady, "异世界人低速舰首接触错误消耗了8秒冷却");

  haruhi.x = 560;
  haruhi.y = 720;
  haruhi.speed = haruhi.effectiveSpeed() * throttleForGear(2) + 1;
  haruhi.throttle = throttleForGear(2);
  haruhi.command = { x: 1000, y: haruhi.y };
  target.x = haruhi.x + haruhi.radius + target.radius - 1;
  target.y = haruhi.y;
  target.command = { x: target.x, y: target.y };
  const hpBeforeImpact = target.hp;
  const impactStartX = target.x;
  sim.update(TICK_DT);
  assert(target.forcedKnockback, "异世界人碰撞没有进入强制击退状态");
  assert(
    Math.abs(hpBeforeImpact - target.hp - target.maxHp * HARUHI_OTHERWORLDER_DAMAGE_RATIO) < 1e-6,
    "异世界人碰撞伤害不符合15%最大生命口径",
  );
  assert(!teamA.serialize().haruhiFlagship.otherworlderReady, "异世界人碰撞后没有进入8秒冷却");
  runSteps(sim, HARUHI_OTHERWORLDER_KNOCKBACK_DURATION * 0.5);
  assert(target.x > impactStartX + haruhi.effectiveVision() * 0.45, "异世界人击退距离明显不足一个视野");
  runSteps(sim, HARUHI_OTHERWORLDER_KNOCKBACK_DURATION * 0.6);
  assert(!target.forcedKnockback, "异世界人击退完成后仍在锁定敌方控制");
  assert(target.speed < 2, "异世界人击退完成后敌舰没有从接近零速重新加速");

  teamA.effects.haruhiBoostUntil = sim.elapsed;
  for (const ship of teamA.getAllShips()) {
    ship.x = 120;
    ship.y = 120;
  }
  for (const ship of teamB.getAllShips()) {
    ship.x = 1240;
    ship.y = 1240;
  }
  teamB.computeVisibility(teamA);
  assert(
    teamA.getAllShips().every((ship) => !teamB.visibleEnemyIds.has(ship.id)),
    "春日旗舰技能结束后己方舰队仍被敌方全图真实看见",
  );
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
  const ownMain = teamA.ships.main;
  const enemyMain = teamB.ships.main;
  const enemySub1 = teamB.ships.sub1;
  sim.combatEnabled.A = false;
  sim.combatEnabled.B = false;

  const enemyFlagOk = teamB.castFlagshipSkill();
  teamB.split(1);
  const enemySubOk = teamB.castSubSkill("sub1");
  assert(enemyFlagOk && enemySubOk, "朝仓旗舰测试前置敌方增益释放失败");
  runSteps(sim, TICK_DT);

  for (const ship of [...teamA.getAllShips(), ...teamB.getAllShips()]) {
    ship.speed = 0;
    ship.throttle = 0;
    ship.command.x = ship.x;
    ship.command.y = ship.y;
    ship.route = null;
  }
  enemyMain.x = ownMain.x + 500;
  enemyMain.y = ownMain.y;
  enemyMain.command = { x: enemyMain.x, y: enemyMain.y };
  enemySub1.x = ownMain.x + 900;
  enemySub1.y = ownMain.y;
  enemySub1.command = { x: enemySub1.x, y: enemySub1.y };
  sim.teamA.computeVisibility(sim.teamB);
  assert(!sim.teamA.visibleEnemyIds.has(enemyMain.id), "朝仓旗舰测试布置错误，敌方应处于视野外");

  const castOk = teamA.castFlagshipSkill();
  assert(castOk, "朝仓旗舰技能释放失败");
  sim.teamA.computeVisibility(sim.teamB);

  assert(teamB.effects.taxiUntil > sim.elapsed, "朝仓旗舰技能仍在施放瞬间净化敌方团队增益");
  assert(teamB.effects.taxiInvulnUntil > sim.elapsed, "朝仓旗舰技能仍在施放瞬间净化敌方无敌效果");
  assert(enemySub1.hasEffect("critUntil"), "朝仓旗舰技能仍在施放瞬间净化敌方舰船增益");
  assert(!sim.teamA.visibleEnemyIds.has(enemyMain.id), "朝仓旗舰技能仍在施放瞬间全图揭示敌方");

  const firstWave = teamA.visionWaveSkill.waves[0];
  assert(firstWave, "朝仓旗舰技能未立即发射首个视野波");
  assert(firstWave.speed === 480, "朝仓视野波未使用全场统一的固定传播速度");
  assert(firstWave.width >= 1440 * 0.11, "朝仓视野波宽度未提升到原来的两倍");

  let seenByFirstWave = false;
  for (let step = 0; step < Math.ceil(1.4 / TICK_DT); step += 1) {
    sim.update(TICK_DT);
    if (teamA.visibleEnemyIds.has(enemyMain.id)) seenByFirstWave = true;
  }
  assert(seenByFirstWave, "朝仓视野波扫过敌舰时未获得真实视野");
  assert(!teamA.visibleEnemyIds.has(enemyMain.id), "朝仓视野波离开后仍持续保留敌舰视野");
  assert(teamB.effects.taxiUntil <= sim.elapsed, "朝仓视野波扫到敌舰后未清除团队主动增益");
  assert(teamB.effects.taxiInvulnUntil <= sim.elapsed, "朝仓视野波扫到敌舰后未清除团队无敌效果");
  assert(enemySub1.hasEffect("critUntil"), "尚未被视野波扫到的敌舰被提前净化");

  runSteps(sim, 0.7);
  assert(!enemySub1.hasEffect("critUntil"), "敌舰被视野波扫到后未清除自身主动增益");
  assert(sim.floatingTexts.some((item) => item.textKey === "净化"), "视野波净化生效时未显示反馈");

  runSteps(sim, 4.2);
  assert(teamA.visionWaveSkill.sequence === 6, "朝仓旗舰技能未在6秒内按每秒一次发射6个视野波");
  assert(teamA.serialize().visionWaves.length > 0, "朝仓视野波未进入单人/多人共享序列化状态");
  runSteps(sim, 3);
  assert(!teamA.hasActiveVisionWaveSkill(), "朝仓旗舰技能超过6秒后仍保持激活");
  assert(teamA.visionWaveSkill.waves.length === 0, "朝仓旗舰技能结束后仍残留过期视野波");
}

function asakuraSimultaneousSkillPurgeCheck() {
  const bladeSim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "haruhi", sub1: "asakura", sub2: "yuki" },
      B: { main: "asakura", sub1: "koizumi", sub2: "tsuruya" },
    },
  });
  const bladeTeam = bladeSim.teamA;
  const purgingTeam = bladeSim.teamB;
  const asakuraSub = bladeTeam.ships.sub1;
  bladeTeam.split(1);

  assert(
    bladeSim.applyActionForSeat("A", { type: "cast_sub_skill", shipKey: "sub1" }),
    "同tick净化测试前置刀锋女王释放失败",
  );
  assert(
    bladeSim.applyActionForSeat("B", { type: "cast_flagship_skill" }),
    "同tick净化测试前置朝仓旗舰技能释放失败",
  );
  assert(asakuraSub.hasEffect("bladeQueenUntil"), "朝仓旗舰技能仍在施放瞬间清除刀锋女王");
  asakuraSub.x = purgingTeam.ships.main.x;
  asakuraSub.y = purgingTeam.ships.main.y;
  asakuraSub.command = { x: asakuraSub.x, y: asakuraSub.y };
  asakuraSub.route = null;
  asakuraSub.speed = 0;
  asakuraSub.throttle = 0;
  runSteps(bladeSim, TICK_DT);
  assert(!asakuraSub.hasEffect("bladeQueenUntil"), "朝仓视野波扫到目标后未清除刀锋女王");

  const mirrorSim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "asakura", sub1: "haruhi", sub2: "yuki" },
      B: { main: "asakura", sub1: "koizumi", sub2: "tsuruya" },
    },
  });
  const mirrorMainA = mirrorSim.teamA.ships.main;
  const mirrorMainB = mirrorSim.teamB.ships.main;
  mirrorMainA.x = mirrorMainB.x = 720;
  mirrorMainA.y = mirrorMainB.y = 720;
  for (const ship of [mirrorMainA, mirrorMainB]) {
    ship.command = { x: ship.x, y: ship.y };
    ship.route = null;
    ship.speed = 0;
    ship.throttle = 0;
  }
  assert(
    mirrorSim.applyActionForSeat("A", { type: "cast_flagship_skill" }),
    "朝仓镜像测试A方技能释放失败",
  );
  assert(
    mirrorSim.applyActionForSeat("B", { type: "cast_flagship_skill" }),
    "朝仓镜像测试B方技能释放失败",
  );
  assert(
    mirrorSim.teamA.hasActiveVisionWaveSkill()
      && mirrorSim.teamB.hasActiveVisionWaveSkill()
      && mirrorSim.teamA.visionWaveSkill.waves.length === 1
      && mirrorSim.teamB.visionWaveSkill.waves.length === 1,
    "朝仓镜像同tick释放仍受座位处理顺序影响",
  );
  runSteps(mirrorSim, TICK_DT);
  assert(
    !mirrorSim.teamA.hasActiveVisionWaveSkill() && !mirrorSim.teamB.hasActiveVisionWaveSkill(),
    "双方视野波同帧互相扫到时仍受A/B席结算顺序影响",
  );
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

function shamisenCatPawCheck() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "haruhi", sub1: "shamisen", sub2: "koizumi" },
      B: { main: "kyon", sub1: "tsuruya", sub2: "yuki" },
    },
  });
  const teamA = sim.teamA;
  const teamB = sim.teamB;
  teamA.split(1);
  teamB.split(1);
  teamB.split(2);
  const shamisen = teamA.ships.sub1;
  const target = teamB.ships.main;

  shamisen.x = 560;
  shamisen.y = 720;
  shamisen.angle = 0;
  shamisen.command = { x: shamisen.x, y: shamisen.y };
  shamisen.route = null;
  target.x = 700;
  target.y = 720;
  target.angle = Math.PI;
  target.command = { x: target.x, y: target.y };
  target.route = null;
  for (const ship of [teamB.ships.sub1, teamB.ships.sub2]) {
    ship.x = 1200;
    ship.y = ship.key === "sub1" ? 1200 : 1240;
    ship.command = { x: ship.x, y: ship.y };
    ship.route = null;
  }
  teamA.visibleEnemyIds = new Set([target.id]);

  const cast = teamA.castSubSkill("sub1");
  assert(cast, "三味线分舰技能释放失败");
  assert(shamisen.hasEffect("catPawUntil"), "三味线分舰技能没有进入猫爪弹状态");
  assert(teamA.cooldowns.sub1 === CHARACTER_DEFS.shamisen.subSkill.cooldown, "三味线技能冷却未引用角色定义");

  const hpBefore = target.hp;
  const shotDamage = shamisen.effectiveDamage();
  for (let hit = 1; hit <= 5; hit += 1) {
    shamisen.cooldown = 0;
    sim.projectiles = [];
    shamisen.tryAttack(sim, teamB);
    assert(sim.projectiles.length === 1, `三味线第${hit}发猫爪弹未生成`);
    const projectile = sim.projectiles[0];
    assert(projectile.visualKind === "cat_paw", "技能期间子弹没有切换为猫爪外观");
    projectile.x = target.x;
    projectile.y = target.y;
    projectile.targetX = target.x;
    projectile.targetY = target.y;
    projectile.resolveImpact(sim);
    projectile.alive = false;

    if (hit < 5) {
      assert(target.clawMarks.stacks === hit, `第${hit}次命中后的抓痕层数异常`);
      assert(target.serialize().clawMarks.stacks === hit, "抓痕层数未进入权威快照");
    }
  }

  const expectedLoss = shotDamage * 5 + CHARACTER_DEFS.shamisen.subSkill.burstDamage;
  assert(Math.abs((hpBefore - target.hp) - expectedLoss) < 1e-7, "三味线五层抓痕没有结算预期爆发伤害");
  assert(target.clawMarks.stacks === 0, "三味线五层爆发后没有清空抓痕计数");

  shamisen.cooldown = 0;
  sim.projectiles = [];
  shamisen.tryAttack(sim, teamB);
  const expiringProjectile = sim.projectiles[0];
  expiringProjectile.x = target.x;
  expiringProjectile.y = target.y;
  expiringProjectile.resolveImpact(sim);
  assert(target.clawMarks.stacks === 1, "三味线爆发后的新抓痕无法重新计数");
  sim.elapsed += CHARACTER_DEFS.shamisen.subSkill.markDuration + 0.01;
  assert(target.activeClawMarks().stacks === 0, "三味线抓痕超过持续时间后没有消退");

  sim.tick += 1;
  teamA.clearActiveSkillBuffsForShip(shamisen);
  assert(!shamisen.hasEffect("catPawUntil"), "朝仓净化逻辑无法移除三味线猫爪弹增益");
}

export function runRulesSuite() {
  closeRangeCombatCheck();
  speedAndEnergyRuleCheck();
  throttleGearCheck();
  boundaryRouteThrottleCheck();
  emergencyBrakeCheck();
  autoScoutCheck();
  yukiBurstScoutStabilityCheck();
  yukiFlagshipCombatScoutCheck();
  splitFormationCheck();
  initialSpawnPositionCheck();
  initialFormationStabilityCheck();
  future1096FormSwitchCheck();
  flagshipLossAutoSplitCheck();
  skippedSplitLevelCheck();
  yukiPassiveCheck();
  koizumiFlagshipInvulnCheck();
  koizumiOrbRamCheck();
  beamSkillCheck();
  tsuruyaFlagshipActiveCheck();
  fireArcDensityCheck();
  kyonUniformFireRateCheck();
  haruhiBlindfireCheck();
  haruhiFlagshipReworkCheck();
  asakuraFlagshipCheck();
  asakuraSimultaneousSkillPurgeCheck();
  asakuraBladeQueenCheck();
  shamisenCatPawCheck();
}
