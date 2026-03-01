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
  assert(sim.teamA.hullRatio() < 0.98 || sim.teamB.hullRatio() < 0.98, "近距离场景下未出现有效伤害");
}

function aiEngageCheck() {
  const sim = new MatchSimulation({ mode: "ai", worldSize: 1440 });
  runSteps(sim, 40);

  const aDamaged = sim.teamA.hullRatio() < 0.995;
  const bDamaged = sim.teamB.hullRatio() < 0.995;
  assert(aDamaged || bDamaged, "AI对战40秒内未出现任何伤害");
}

function beamSkillCheck() {
  const sim = new MatchSimulation({ mode: "pvp", worldSize: 1440 });
  const teamA = sim.teamA;
  const teamB = sim.teamB;

  teamA.split(1);
  teamA.split(2);
  teamA.energy = teamA.maxEnergy;

  const sub2 = teamA.ships.sub2;
  const enemyMain = teamB.ships.main;
  sub2.x = 680;
  sub2.y = 700;
  enemyMain.x = 840;
  enemyMain.y = 700;

  const before = teamB.hullRatio();
  const castOk = teamA.castBeam(enemyMain.x, enemyMain.y, teamB);
  runSteps(sim, 0.2);
  const after = teamB.hullRatio();

  assert(castOk, "二级分离后光束技能触发失败");
  assert(after < before, "光束技能未造成伤害");
}

function main() {
  closeRangeCombatCheck();
  aiEngageCheck();
  beamSkillCheck();
  console.log("核心战斗逻辑校验通过");
}

main();
