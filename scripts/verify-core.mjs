import { MatchSimulation, TICK_DT } from "../shared/game-core.js";

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

function aiEngageCheck() {
  const sim = new MatchSimulation({ mode: "ai", worldSize: 1440 });
  runSteps(sim, 70);

  const aDamaged = sim.teamA.hullRatio() < 0.995;
  const bDamaged = sim.teamB.hullRatio() < 0.995;
  assert(aDamaged || bDamaged, "AI对战70秒内未出现任何伤害");
}

function main() {
  closeRangeCombatCheck();
  speedAndEnergyRuleCheck();
  splitFormationCheck();
  yukiPassiveCheck();
  beamSkillCheck();
  fireArcDensityCheck();
  aiEngageCheck();
  console.log("核心战斗逻辑校验通过");
}

main();
