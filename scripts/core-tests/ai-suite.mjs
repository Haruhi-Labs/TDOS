import {
  MatchSimulation,
  SCOUT_LAUNCH_COST,
  TICK_DT,
  energyRateForThrottle,
  throttleForGear,
} from "../../shared/game-core.js";
import { assert, runSteps } from "./helpers.mjs";

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
  assert(sub1.throttle === throttleForGear(1), "低能残血副舰后撤时未降至前进1档回能");
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
  assert(sub1.throttle === throttleForGear(2), "AI被围攻副舰在低能量时未限制到前进2档");
  assert(
    energyRateForThrottle(sub1.baseEnergyRegen(), sub1.moveEnergyDrain(), sub1.throttle) > 0,
    "AI被围攻副舰降档后仍无法回能",
  );

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
  assert(aiMain.route && aiMain.throttle === throttleForGear(1), "AI低能回能时主舰未降至前进1档");
  const beforeRecovery = aiTeam.availableEnergyForShip(aiMain);
  aiTeam.updateEnergy(3);
  assert(aiTeam.availableEnergyForShip(aiMain) > beforeRecovery + 20, "AI降档后舰队能量未明显恢复");
}

function aiEnergyThrottleHysteresisCheck() {
  const sim = new MatchSimulation({ mode: "ai", worldSize: 1440 });
  const bot = sim.bot;
  const aiTeam = sim.teamB;
  const aiMain = aiTeam.ships.main;
  const setFleetEnergyRatio = (ratio) => {
    for (const ship of aiTeam.getAllShips()) {
      ship.energy = ship.maxEnergy * ratio;
    }
  };

  setFleetEnergyRatio(0.75);
  aiMain.throttle = throttleForGear(3);
  assert(bot.energyThrottleGearCap(aiMain) === 4, "AI能量充裕时未允许启动前进4档");

  setFleetEnergyRatio(0.6);
  aiMain.throttle = throttleForGear(3);
  assert(bot.energyThrottleGearCap(aiMain) === 3, "AI能量不足启动阈值时仍会新开前进4档");
  aiMain.throttle = throttleForGear(4);
  assert(bot.energyThrottleGearCap(aiMain) === 4, "AI前进4档迟滞区间未能稳定保持档位");

  setFleetEnergyRatio(0.5);
  bot.enforceEnergyThrottleCaps();
  assert(aiMain.throttle === throttleForGear(3), "AI前进4档降至退出阈值后未及时回到前进3档");

  setFleetEnergyRatio(0.75);
  aiMain.throttle = throttleForGear(4);
  let minimumRatio = 1;
  for (let i = 0; i < 30 / TICK_DT; i += 1) {
    aiTeam.updateEnergy(TICK_DT);
    bot.enforceEnergyThrottleCaps();
    minimumRatio = Math.min(minimumRatio, bot.energyProfile(aiMain).ratio);
  }
  assert(minimumRatio > 0.49, "AI持续航行仍会把舰队能量耗尽");
  assert(bot.energyProfile(aiMain).ratio > minimumRatio, "AI降档后未能自动恢复舰队能量");
}

function aiScoutEnergyReserveCheck() {
  const sim = new MatchSimulation({ mode: "ai", worldSize: 1440 });
  const bot = sim.bot;
  const aiTeam = sim.teamB;
  const enemyMain = sim.teamA.ships.main;

  aiTeam.split(1);
  const scoutSource = aiTeam.ships.sub1;
  scoutSource.x = 620;
  scoutSource.y = 720;
  scoutSource.command.x = scoutSource.x;
  scoutSource.command.y = scoutSource.y;
  scoutSource.route = null;
  scoutSource.energy = SCOUT_LAUNCH_COST + scoutSource.maxEnergy * 0.08;
  bot.scoutTimer = 0;
  enemyMain.x = scoutSource.x - 60;
  enemyMain.y = scoutSource.y;
  bot.rememberContact(enemyMain, "visible");
  const context = bot.buildTacticalContext(aiTeam.ships.main, bot.selectEnemyFocus(aiTeam.ships.main));
  const zoneId = bot.pickScoutZoneId(aiTeam.ships.main, context.focus);
  const sourceKey = bot.pickScoutSourceKey(zoneId, context.focus);

  assert(sourceKey === "sub1", "侦察能量预算回归未命中低能分离副舰");
  assert(
    !bot.allowEnergyCommit(sourceKey, SCOUT_LAUNCH_COST, context, {
      emergencyFloor: 0.12,
      normalFloor: 0.18,
      conserveFloor: 0.28,
    }),
    "AI仍会让低能分离副舰为侦察机耗尽能量",
  );
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

function aiEmergencyEnergyReserveCheck() {
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
  assert(aiMain.route && aiMain.throttle === throttleForGear(2), "AI紧急接敌时未按低能量限制前进档位");
  bot.tryFlagshipSkill(context);
  bot.enforceEnergyThrottleCaps();

  assert(bot.mode !== "harvest", "AI接敌紧急时仍错误进入回能模式");
  assert(aiTeam.effects.taxiUntil <= sim.elapsed, "AI接敌紧急时仍会为一次技能把舰队能量压到保底以下");
  assert(aiMain.throttle === throttleForGear(2), "AI保留技能能量后错误降档");
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

export function runAiSuite() {
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
  aiEnergyThrottleHysteresisCheck();
  aiScoutEnergyReserveCheck();
  aiHighEnergySkillAggressionCheck();
  aiEmergencyEnergyReserveCheck();
  aiPressureCheck();
  aiEdgeRecoveryCheck();
  aiEngageCheck();
}
