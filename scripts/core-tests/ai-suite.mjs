import {
  CHARACTER_DEFS,
  MatchSimulation,
  SCOUT_LAUNCH_COST,
  TICK_DT,
  energyRateForThrottle,
  randomAiLoadout,
  throttleForGear,
} from "../../shared/game-core.js";
import { assert, runSteps } from "./helpers.mjs";

function aiEngageCheck() {
  const sim = new MatchSimulation({ mode: "ai", worldSize: 1440 });
  assert(!sim.bot.legacy, "单人 AI 在未显式指定时错误启用了旧版对照策略");
  const legacySim = new MatchSimulation({
    mode: "ai",
    worldSize: 1440,
    legacyAiSeats: ["B"],
  });
  assert(legacySim.bot.legacy, "调试场景显式指定后没有启用旧版 AI 对照策略");
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
  const aiMain = sim.teamB.ships.main;
  const enemyMain = sim.teamA.ships.main;
  const spawnIntel = { x: bot.enemyIntel.main.x, y: bot.enemyIntel.main.y };

  // 反应延迟测试显式把目标放进视野；出生点距离属于独立平衡参数。
  enemyMain.x = aiMain.x - Math.min(100, aiMain.effectiveVision() * 0.65);
  enemyMain.y = aiMain.y;
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

function aiYukiRadarIntelCheck() {
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.34;
    assert(randomAiLoadout().main === "yuki", "长门旗舰仍未进入随机 AI 主舰池");
  } finally {
    Math.random = originalRandom;
  }

  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    aiSeats: ["B"],
    teamLoadouts: {
      A: { main: "haruhi", sub1: "koizumi", sub2: "tsuruya" },
      B: { main: "yuki", sub1: "kyon", sub2: "future1096" },
    },
  });
  const bot = sim.botBySeat("B");
  const aiTeam = sim.teamB;
  const enemyMain = sim.teamA.ships.main;
  const radarPoint = { x: 260, y: 250 };

  enemyMain.x = 150;
  enemyMain.y = 160;
  enemyMain.command = { x: enemyMain.x, y: enemyMain.y };
  enemyMain.route = null;
  sim.elapsed = 1;
  aiTeam.radarPassive.contacts.set(enemyMain.id, {
    id: enemyMain.id,
    targetId: enemyMain.id,
    x: radarPoint.x,
    y: radarPoint.y,
    angle: 0.4,
    kind: "disturbance",
    characterId: null,
    clarity: 0.3,
    uncertainty: 150,
    detectedAt: 0.6,
    expiresAt: 3.8,
  });

  bot.refreshIntel();
  const estimate = bot.primaryEnemyEstimate();
  assert(estimate?.radarDerived && estimate.source === "radar", "长门 AI 未吸收雷达误差接触");
  assert(estimate.characterId === null, "远距离雷达接触令 AI 提前获知了敌方角色");
  assert(
    Math.hypot(estimate.x - radarPoint.x, estimate.y - radarPoint.y) < 60,
    "长门 AI 未按雷达提供的误差坐标进行判断",
  );
  assert(
    Math.hypot(estimate.x - enemyMain.x, estimate.y - enemyMain.y) > 80,
    "长门 AI 绕过雷达误差读取了敌舰真实位置",
  );

  bot.belief.w.fill(0);
  bot.updateBelief(TICK_DT);
  const peak = bot.beliefPeak();
  assert(peak && Math.hypot(peak.x - radarPoint.x, peak.y - radarPoint.y) < 230, "雷达接触未引导 AI 的搜索占据图");
}

function aiYukiScoutDoctrineCheck() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    aiSeats: ["B"],
    teamLoadouts: {
      A: { main: "haruhi", sub1: "asakura", sub2: "shamisen" },
      B: { main: "yuki", sub1: "kyon", sub2: "future1096" },
    },
  });
  const bot = sim.botBySeat("B");
  const team = sim.teamB;
  const enemyMain = sim.teamA.ships.main;
  const spawnFocus = bot.primaryEnemyEstimate();
  const searchContext = bot.buildTacticalContext(team.ships.main, spawnFocus);
  const firstScreenPlan = bot.planScoutDeployment(searchContext);

  assert(firstScreenPlan?.mode === "screen", "长门AI缺乏情报时没有建立前沿警戒线");
  assert([2, 5, 8].includes(firstScreenPlan.zoneId), "长门AI前沿警戒没有部署在双方之间的中线战区");
  assert(
    team.launchScout(firstScreenPlan.zoneId, {
      seekPoint: firstScreenPlan.seekPoint,
      patrolCenter: firstScreenPlan.seekPoint,
      patrolRadius: firstScreenPlan.patrolRadius,
      mission: firstScreenPlan.mission,
    }),
    "长门AI前沿警戒测试未能释放首架战斗僚机",
  );
  team.cooldowns.scout = 0;
  const secondScreenPlan = bot.planScoutDeployment(searchContext);
  assert([2, 5, 8].includes(secondScreenPlan.zoneId), "长门AI第二个警戒点离开了前沿战区");
  assert(secondScreenPlan.zoneId !== firstScreenPlan.zoneId, "长门AI没有优先补齐尚未覆盖的前沿战区");

  team.scouts = [];
  for (const zoneId of [2, 5, 8]) {
    for (const ship of team.fleetMembersForShip("main")) ship.energy = ship.maxEnergy;
    team.cooldowns.scout = 0;
    assert(team.launchScout(zoneId), `长门AI战场调度测试未能在${zoneId}战区建立警戒点`);
  }

  enemyMain.x = 930;
  enemyMain.y = 240;
  enemyMain.angle = 0;
  enemyMain.speed = 31;
  enemyMain.command = { x: 1200, y: 240 };
  enemyMain.route = null;
  bot.rememberContact(enemyMain, "visible");
  const visibleFocus = bot.primaryEnemyEstimate();
  const battleContext = bot.buildTacticalContext(team.ships.main, visibleFocus);
  const battlePlan = bot.planScoutDeployment(battleContext);

  assert(["concentrate", "intercept"].includes(battlePlan.mode), "长门AI确认敌方动向后没有转入战场集中或拦截");
  assert(battlePlan.predictedZoneId === 3, "长门AI没有根据敌舰向右航行的动向预测下一战区");
  assert(
    battlePlan.primaryZoneId === 3 || battlePlan.coverageZoneIds.includes(3),
    "长门AI的战场部署没有覆盖敌方预计进入的战区",
  );
  bot.scoutDoctrine.nextRetaskAt = 0;
  const retasked = bot.retaskYukiCombatScouts(battlePlan);
  const primaryCount = team.scouts.filter((scout) => scout.zone?.id === battlePlan.primaryZoneId).length;
  assert(retasked >= 1, "长门AI由警戒转入接敌时没有重新编组既有战斗僚机");
  assert(primaryCount >= 2, "长门AI没有把足够僚机集中到主战场");

  const stored = bot.enemyIntel.entities.get(enemyMain.id);
  stored.source = "visible";
  stored.seenAt = sim.elapsed - 6;
  const memoryFocus = bot.projectContact(stored, 1.8);
  const harassContext = bot.buildTacticalContext(team.ships.main, memoryFocus);
  const harassPlan = bot.planScoutDeployment(harassContext);
  assert(harassPlan.mode === "harass", "长门AI对较旧但可追踪的敌情没有转入多战区骚扰");
  assert(harassPlan.coverageZoneIds.length >= 3, "长门AI骚扰方案没有准备多个候选战区");
}

function aiYukiScoutCadenceCheck() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    aiSeats: ["B"],
    teamLoadouts: {
      A: { main: "haruhi", sub1: "asakura", sub2: "shamisen" },
      B: { main: "yuki", sub1: "kyon", sub2: "future1096" },
    },
  });
  let launches = 0;
  const launchScout = sim.teamB.launchScout.bind(sim.teamB);
  sim.teamB.launchScout = (...args) => {
    const launched = launchScout(...args);
    if (launched) launches += 1;
    return launched;
  };
  runSteps(sim, 12);
  assert(launches >= 3, "长门AI在前12秒没有积极建立至少三个侦察节点");
  assert(sim.botBySeat("B").scoutDoctrine.deployments === launches, "长门AI侦察战术状态与实际部署次数不一致");
}

function aiCombatScoutThreatCheck() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    aiSeats: ["A"],
    teamLoadouts: {
      A: { main: "kyon", sub1: "haruhi", sub2: "koizumi" },
      B: { main: "yuki", sub1: "tsuruya", sub2: "future1096" },
    },
  });
  const bot = sim.botBySeat("A");
  const aiMain = sim.teamA.ships.main;
  assert(sim.teamB.launchScout(5), "AI威胁测试未能生成长门战斗僚机");
  const combatScout = sim.teamB.scouts[0];
  combatScout.x = aiMain.x + 120;
  combatScout.y = aiMain.y;
  bot.rememberContact(combatScout, "visible");

  const contact = bot.knownEnemyContacts().find((item) => item.id === combatScout.id);
  assert(contact?.combatCapable, "AI默认威胁列表忽略了可见的长门战斗僚机");
  assert(bot.contactCombatValue(contact) > 0.17, "AI仍把长门战斗僚机按无威胁侦察机估值");
  assert(
    bot.estimateVisionRange(contact) === CHARACTER_DEFS.yuki.stats.vision,
    "AI未按舰船级视野估算长门战斗僚机感知范围",
  );
  assert(bot.shipThreatSnapshot(aiMain).sources >= 1, "AI局部威胁判断未计入长门战斗僚机火力");
}

function aiAsakuraVisionWaveDecisionCheck() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    aiSeats: ["B"],
    teamLoadouts: {
      A: { main: "haruhi", sub1: "koizumi", sub2: "yuki" },
      B: { main: "asakura", sub1: "kyon", sub2: "future1096" },
    },
  });
  const bot = sim.botBySeat("B");
  const aiTeam = sim.teamB;
  const aiMain = aiTeam.ships.main;
  const enemyTeam = sim.teamA;
  const enemyMain = enemyTeam.ships.main;

  aiMain.x = 900;
  aiMain.y = 720;
  aiMain.command = { x: aiMain.x, y: aiMain.y };
  aiMain.route = null;
  for (const ship of enemyTeam.getAllShips()) {
    ship.x = 760;
    ship.y = 720;
    ship.command = { x: ship.x, y: ship.y };
    ship.route = null;
  }
  aiTeam.computeVisibility(enemyTeam);
  bot.rememberContact(enemyMain, "visible");
  const context = bot.buildTacticalContext(aiMain, bot.selectEnemyFocus(aiMain));

  enemyMain.effects.critUntil = sim.elapsed + 0.1;
  assert(
    !bot.shouldCastFlagshipSkill(context.focus, context),
    "朝仓 AI 仍会为来不及净化的即将到期增益浪费技能",
  );

  enemyMain.effects.critUntil = sim.elapsed + 5;
  bot.flagshipTimer = 0;
  bot.tryFlagshipSkill(context);
  assert(aiTeam.hasActiveVisionWaveSkill(), "朝仓 AI 未对可及时净化的可见增益释放视野波");
  runSteps(sim, 0.8);
  assert(!enemyMain.hasEffect("critUntil"), "朝仓 AI 释放的视野波未在扫到时净化敌方增益");
}

function aiVisionWaveBuffCounterplayCheck() {
  const createScenario = (difficulty) => {
    const sim = new MatchSimulation({
      mode: "pvp",
      worldSize: 1440,
      aiSeats: ["B"],
      aiDifficulty: difficulty,
      teamLoadouts: {
        A: { main: "asakura", sub1: "haruhi", sub2: "yuki" },
        B: { main: "tsuruya", sub1: "kyon", sub2: "future1096" },
      },
    });
    const bot = sim.botBySeat("B");
    const enemyMain = sim.teamA.ships.main;
    const aiMain = sim.teamB.ships.main;
    const kyon = sim.teamB.ships.sub1;
    sim.teamB.split(1);
    enemyMain.x = 760;
    enemyMain.y = 720;
    enemyMain.command = { x: enemyMain.x, y: enemyMain.y };
    enemyMain.route = null;
    aiMain.x = 900;
    aiMain.y = 720;
    aiMain.command = { x: aiMain.x, y: aiMain.y };
    aiMain.route = null;
    kyon.x = 920;
    kyon.y = 748;
    kyon.command = { x: kyon.x, y: kyon.y };
    kyon.route = null;
    kyon.hp = kyon.maxHp * 0.6;
    sim.teamB.computeVisibility(sim.teamA);
    bot.rememberContact(enemyMain, "visible");
    assert(sim.teamA.castFlagshipSkill(), `${difficulty} 场景下朝仓视野波释放失败`);
    const context = bot.buildTacticalContext(aiMain, bot.selectEnemyFocus(aiMain));
    return { sim, bot, context, aiMain, kyon };
  };

  for (const difficulty of ["hard", "master"]) {
    const { bot, context, aiMain, kyon } = createScenario(difficulty);
    assert(
      !bot.shouldCastFlagshipSkill(context.focus, context),
      `${difficulty} AI 仍会顶着朝仓视野波释放旗舰增益`,
    );
    assert(
      !bot.shouldCastSubSkill(kyon, context.focus, context),
      `${difficulty} AI 仍会顶着朝仓视野波释放分舰增益`,
    );
    bot.flagshipTimer = 0;
    bot.subTimers.sub1 = 0;
    bot.tryFlagshipSkill(context);
    bot.trySubSkill("sub1", context);
    assert(aiMain.team.effects.sponsorUntil <= bot.team.match.elapsed, `${difficulty} AI 未实际暂缓旗舰增益`);
    assert(!kyon.hasEffect("reliableUntil"), `${difficulty} AI 未实际暂缓分舰增益`);
  }

  const normal = createScenario("normal");
  assert(
    normal.bot.shouldCastFlagshipSkill(normal.context.focus, normal.context),
    "普通 AI 被错误加入困难以上的视野波反制逻辑",
  );
  assert(
    normal.bot.shouldCastSubSkill(normal.kyon, normal.context.focus, normal.context),
    "普通 AI 的分舰增益被错误延迟",
  );

  const safe = createScenario("hard");
  safe.sim.teamA.visionWaveSkill.activeUntil = 0;
  safe.sim.teamA.visionWaveSkill.pulsesRemaining = 0;
  safe.sim.teamA.visionWaveSkill.waves.length = 0;
  assert(
    safe.bot.shouldCastFlagshipSkill(safe.context.focus, safe.context),
    "视野波结束后困难 AI 没有恢复旗舰增益施放",
  );
  assert(
    safe.bot.shouldCastSubSkill(safe.kyon, safe.context.focus, safe.context),
    "视野波结束后困难 AI 没有恢复分舰增益施放",
  );
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
        main: "tsuruya",
        sub1: "haruhi",
        sub2: "koizumi",
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

  assert(aiTeam.effects.sponsorUntil > sim.elapsed, "AI高能接敌时未积极释放旗舰技能");
  assert(aiTeam.ships.sub1.hasEffect("critUntil"), "AI高能接敌时未积极释放分舰技能");
}

function aiHaruhiFlagshipAggressionCheck() {
  const sim = new MatchSimulation({
    mode: "ai",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "kyon", sub1: "asakura", sub2: "shamisen" },
      B: { main: "haruhi", sub1: "yuki", sub2: "future1096" },
    },
  });
  const bot = sim.bot;
  const team = sim.teamB;

  assert(bot.flagshipTimer === 0, "春日AI开局仍在等待通用旗舰技能观察窗");
  sim.update(TICK_DT);
  assert(team.haruhiFlagship.supporters.size === 1, "春日AI没有在开局立即解锁首个常驻支援");
  assert(team.effects.haruhiBoostUntil > sim.elapsed, "春日AI开局没有成功施放团队强化");
  assert(bot.flagshipTimer > team.cooldowns.flagship, "春日AI的下一次检查没有与真实冷却安全对齐");

  for (const supporter of ["alien", "time_traveler", "otherworlder", "esper"]) {
    team.haruhiFlagship.supporters.add(supporter);
  }
  for (const ship of team.fleetMembersForShip("main")) {
    ship.energy = ship.maxEnergy;
  }
  team.cooldowns.flagship = 0;
  bot.flagshipTimer = 0;
  bot.tryFlagshipSkill(bot.currentContext);
  assert(bot.lastFlagshipDecision.cast, "春日AI集齐常驻支援后仍会等待接敌条件才施放团队强化");
  assert(bot.flagshipTimer >= team.cooldowns.flagship, "春日AI施放后没有按冷却到点安排下一次检查");

  const meta = CHARACTER_DEFS.haruhi.flagshipSkill;
  for (const ship of team.fleetMembersForShip("main")) {
    ship.energy = 0;
  }
  team.ships.main.energy = meta.cost + SCOUT_LAUNCH_COST - 1;
  team.cooldowns.flagship = 2;
  bot.flagshipTimer = 2;
  assert(bot.shouldReserveEnergyForHaruhiFlagship(), "春日旗舰技能即将冷却完成时没有预留施放能量");
  assert(!bot.shouldLaunchScout(bot.currentContext), "侦察机仍会抢占春日即将施放旗舰技能所需的能量");
}

function aiKoizumiOrbSteeringCheck() {
  const sim = new MatchSimulation({
    mode: "ai",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "haruhi", sub1: "yuki", sub2: "tsuruya" },
      B: { main: "kyon", sub1: "koizumi", sub2: "future1096" },
    },
  });
  const bot = sim.bot;
  const team = sim.teamB;
  const koizumi = team.ships.sub1;
  const target = sim.teamA.ships.main;
  team.split(1);
  koizumi.x = 980;
  koizumi.y = 720;
  koizumi.angle = Math.PI;
  koizumi.command = { x: koizumi.x, y: koizumi.y };
  koizumi.route = null;
  koizumi.energy = koizumi.maxEnergy;
  target.x = 650;
  target.y = 760;
  target.angle = 0;
  target.speed = 0;
  target.command = { x: target.x, y: target.y };
  target.route = null;

  bot.rememberContact(target, "visible");
  const context = bot.buildTacticalContext(team.ships.main, bot.selectEnemyFocus(team.ships.main));
  bot.subTimers.sub1 = 0;
  bot.trySubSkill("sub1", context);
  assert(koizumi.koizumiOrb?.phase === "active", "古泉AI接敌时没有释放光球冲撞技能");

  bot.koizumiOrbSteerTimer = 0;
  bot.steerActiveKoizumiOrbs(context);
  assert(koizumi.route, "古泉AI进入光球形态后没有生成冲撞路线");
  assert(
    Math.hypot(koizumi.route.p2.x - target.x, koizumi.route.p2.y - target.y) < 45,
    "古泉AI光球路线没有瞄准敌舰的运动预判位置",
  );
  const initialDistance = Math.hypot(koizumi.x - target.x, koizumi.y - target.y);
  runSteps(sim, 0.8);
  assert(koizumi.speed > 110, "古泉AI光球没有进入明显的高速运动状态");
  assert(
    Math.hypot(koizumi.x - target.x, koizumi.y - target.y) < initialDistance - 70,
    "古泉AI没有沿光球冲撞路线快速逼近目标",
  );
}

function aiKoizumiBarrierDefenseCheck() {
  const sim = new MatchSimulation({
    mode: "ai",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "kyon", sub1: "asakura", sub2: "future1096" },
      B: { main: "koizumi", sub1: "yuki", sub2: "shamisen" },
    },
  });
  const bot = sim.bot;
  const team = sim.teamB;
  const main = team.ships.main;
  const enemyMain = sim.teamA.ships.main;
  team.split(1);
  team.split(2);
  main.x = 980;
  main.y = 720;
  main.command = { x: main.x, y: main.y };
  main.route = null;
  team.ships.sub1.x = 1010;
  team.ships.sub1.y = 680;
  team.ships.sub2.x = 1010;
  team.ships.sub2.y = 760;
  enemyMain.x = 650;
  enemyMain.y = 720;
  enemyMain.command = { x: enemyMain.x, y: enemyMain.y };
  enemyMain.route = null;

  bot.rememberContact(enemyMain, "visible");
  let context = bot.buildTacticalContext(main, bot.selectEnemyFocus(main));
  bot.issueMovement(context);
  const barrierRadius = context.barrierTactics.own.radius;
  assert(context.barrierTactics.own.active, "古泉旗舰AI没有识别己方闭锁空间");
  assert(
    Math.hypot(main.route.p2.x - enemyMain.x, main.route.p2.y - enemyMain.y) >= barrierRadius + 30,
    "古泉旗舰AI没有把敌舰保持在能量圈外",
  );
  for (const ship of [team.ships.sub1, team.ships.sub2]) {
    assert(ship.route, "古泉旗舰AI没有为盾内副舰规划路线");
    assert(
      Math.hypot(ship.route.p2.x - main.route.p2.x, ship.route.p2.y - main.route.p2.y) <= barrierRadius - 16,
      "古泉旗舰AI让副舰主动驶出能量圈保护范围",
    );
  }

  team.koizumiBarrier.disabledAt = sim.elapsed;
  team.koizumiBarrier.disabledUntil = sim.elapsed + 5;
  bot.modeTimer = 0;
  context = bot.buildTacticalContext(main, bot.selectEnemyFocus(main));
  const beforeDistance = Math.hypot(main.x - enemyMain.x, main.y - enemyMain.y);
  bot.issueMovement(context);
  assert(["kite", "regroup"].includes(bot.mode), "闭锁空间失效后古泉旗舰AI没有转入短时防守");
  assert(
    Math.hypot(main.route.p2.x - enemyMain.x, main.route.p2.y - enemyMain.y) > beforeDistance + 80,
    "闭锁空间失效后古泉旗舰AI没有主动拉开距离等待恢复",
  );
  assert(main.throttle === throttleForGear(4), "闭锁空间失效后古泉旗舰AI没有使用四档脱离");
}

function aiKoizumiBarrierThreatEvasionCheck() {
  const sim = new MatchSimulation({
    mode: "ai",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "kyon", sub1: "asakura", sub2: "yuki" },
      B: { main: "koizumi", sub1: "future1096", sub2: "shamisen" },
    },
  });
  const bot = sim.bot;
  const ownMain = sim.teamB.ships.main;
  const enemyMain = sim.teamA.ships.main;
  const asakura = sim.teamA.ships.sub1;
  sim.teamA.split(1);
  ownMain.x = 900;
  ownMain.y = 720;
  enemyMain.x = 590;
  enemyMain.y = 720;
  asakura.x = ownMain.x - ownMain.effectiveVision() - 80;
  asakura.y = 720;
  asakura.energy = asakura.maxEnergy;
  assert(sim.teamA.castSubSkill("sub1"), "破盾威胁测试未能开启刀锋女王");
  asakura.speed = asakura.effectiveSpeed();

  bot.rememberContact(enemyMain, "visible");
  bot.rememberContact(asakura, "visible");
  const focus = bot.selectEnemyFocus(ownMain);
  const context = bot.buildTacticalContext(ownMain, focus);
  assert(focus.id === asakura.id, "古泉旗舰AI没有优先处理正在逼近的破盾舰");
  assert(context.barrierTactics.incoming?.kind === "blade_queen", "古泉旗舰AI没有识别刀锋女王破盾威胁");
  bot.issueMovement(context);
  assert(ownMain.throttle === throttleForGear(4), "破盾舰逼近时古泉旗舰AI没有高速移动盾心规避");
  assert(
    Math.hypot(ownMain.route.p2.x - asakura.x, ownMain.route.p2.y - asakura.y)
      > Math.hypot(ownMain.x - asakura.x, ownMain.y - asakura.y) + 70,
    "破盾舰逼近时古泉旗舰AI没有与威胁拉开距离",
  );
}

function aiKoizumiBarrierBreachCheck() {
  const sim = new MatchSimulation({
    mode: "ai",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "koizumi", sub1: "yuki", sub2: "shamisen" },
      B: { main: "kyon", sub1: "asakura", sub2: "future1096" },
    },
  });
  sim.setCombatEnabled("A", false);
  sim.setCombatEnabled("B", false);
  const bot = sim.bot;
  const defendingMain = sim.teamA.ships.main;
  const asakura = sim.teamB.ships.sub1;
  sim.teamB.split(1);
  defendingMain.x = 650;
  defendingMain.y = 720;
  defendingMain.command = { x: defendingMain.x, y: defendingMain.y };
  defendingMain.route = null;
  asakura.x = 940;
  asakura.y = 720;
  asakura.angle = Math.PI;
  asakura.energy = asakura.maxEnergy;
  asakura.command = { x: asakura.x, y: asakura.y };
  asakura.route = null;

  const hiddenContext = bot.buildTacticalContext(
    sim.teamB.ships.main,
    bot.primaryEnemyEstimate(),
  );
  assert(!hiddenContext.barrierTactics.enemy, "AI在识别古泉旗舰前偷看了隐藏的能量圈信息");
  bot.rememberContact(defendingMain, "visible");
  const context = bot.buildTacticalContext(sim.teamB.ships.main, bot.selectEnemyFocus(sim.teamB.ships.main));
  assert(context.barrierTactics.enemy?.active, "AI没有识别已确认的敌方闭锁空间");
  assert(context.barrierTactics.breachShipKey === "sub1", "AI没有选择朝仓分舰承担破盾任务");
  bot.subTimers.sub1 = 0;
  bot.trySubSkill("sub1", context);
  assert(asakura.hasEffect("bladeQueenUntil"), "AI没有为破盾主动开启刀锋女王");
  bot.issueMovement(context);
  assert(bot.lastTacticalPlan.detachedPlan.roles.sub1 === "breach", "朝仓分舰没有进入专门破盾角色");
  assert(
    Math.hypot(asakura.route.p2.x - defendingMain.x, asakura.route.p2.y - defendingMain.y) < 8,
    "朝仓破盾路线没有径直瞄准古泉能量圈圆心",
  );

  // 本测试验证的是破盾决策与执行，持续提供等价于可见状态的旗舰接触，避免反应延迟
  // 把手工挪动前的出生点轨迹掺入预判而令测试结果依赖随机改航时机。
  for (let tick = 0; tick < Math.ceil(4.8 / TICK_DT); tick += 1) {
    bot.rememberContact(defendingMain, "visible");
    sim.update(TICK_DT);
  }
  assert(!sim.teamA.serialize().koizumiBarrier.active, "朝仓破盾AI没有在技能窗口内实际撞破闭锁空间");
  assert(
    sim.koizumiBarrierImpacts.some((impact) => impact.kind === "ram" && impact.ramKind === "blade_queen"),
    "朝仓破盾AI没有产生真实的刀锋女王破盾事件",
  );
}

function aiKoizumiBarrierNoBreakerInfiltrationCheck() {
  const sim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    aiSeats: ["B"],
    aiDifficulty: "master",
    teamLoadouts: {
      A: { main: "koizumi", sub1: "yuki", sub2: "tsuruya" },
      // 刻意使用完全不具备破盾冲撞的阵容，验证策略不依赖系统匹配克制角色。
      B: { main: "kyon", sub1: "yuki", sub2: "shamisen" },
    },
  });
  sim.setCombatEnabled("A", false);
  const bot = sim.botBySeat("B");
  const defendingMain = sim.teamA.ships.main;
  const attackingTeam = sim.teamB;
  const attackingMain = attackingTeam.ships.main;
  defendingMain.x = 650;
  defendingMain.y = 720;
  defendingMain.command = { x: defendingMain.x, y: defendingMain.y };
  defendingMain.route = null;
  attackingMain.x = 930;
  attackingMain.y = 720;
  attackingMain.angle = Math.PI;
  attackingMain.command = { x: attackingMain.x, y: attackingMain.y };
  attackingMain.route = null;

  bot.rememberContact(defendingMain, "visible");
  let context = bot.buildTacticalContext(attackingMain, bot.selectEnemyFocus(attackingMain));
  assert(!context.barrierTactics.breachShipKey, "无破盾阵容被AI凭空分配了破盾能力");
  assert(context.barrierTactics.infiltration?.phase === "stage", "无破盾阵容没有先在能量圈外组织突入");
  assert(
    context.barrierTactics.infiltration.splitShipKeys.length === 2,
    "无破盾阵容没有准备拆分舰队形成多方向切入",
  );

  let maximumInsideCount = 0;
  let sawCommit = false;
  let sawSeparatedApproaches = false;
  const maximumTicks = Math.ceil(30 / TICK_DT);
  for (let tick = 0; tick < maximumTicks; tick += 1) {
    sim.update(TICK_DT);
    context = bot.currentContext;
    const infiltration = context?.barrierTactics?.infiltration;
    if (infiltration?.phase === "commit") sawCommit = true;
    const routes = attackingTeam.getPlayerShips()
      .filter((ship) => ship.route)
      .map((ship) => ship.route.p2);
    if (
      routes.length === 3
      && Math.max(
        Math.hypot(routes[0].x - routes[1].x, routes[0].y - routes[1].y),
        Math.hypot(routes[0].x - routes[2].x, routes[0].y - routes[2].y),
        Math.hypot(routes[1].x - routes[2].x, routes[1].y - routes[2].y),
      ) > 150
    ) {
      sawSeparatedApproaches = true;
    }
    const radius = context?.barrierTactics?.enemy?.radius || defendingMain.effectiveVision();
    const insideCount = attackingTeam.getPlayerShips().filter((ship) => (
      ship.alive
      && Math.hypot(ship.x - defendingMain.x, ship.y - defendingMain.y)
        <= radius - Math.max(8, ship.radius)
    )).length;
    maximumInsideCount = Math.max(maximumInsideCount, insideCount);
  }

  assert(attackingTeam.splitLevel === 2, "无破盾阵容没有完成多路突入所需的舰队拆分");
  assert(sawSeparatedApproaches, "无破盾阵容没有从不同角度接近古泉能量圈");
  assert(sawCommit, "无破盾阵容在集结完成后没有同步突入能量圈");
  assert(maximumInsideCount >= 2, "无破盾阵容没有形成至少两舰同时入圈的交叉火力");
  assert(sim.teamA.hullRatio() < 0.9, "无破盾阵容进入圈内后仍未能对古泉舰队造成有效伤害");
  assert(
    sim.teamA.koizumiBarrier.disabledAt === null,
    "无破盾阵容错误地产生了破盾碰撞事件",
  );

  const normalSim = new MatchSimulation({
    mode: "pvp",
    worldSize: 1440,
    aiSeats: ["B"],
    aiDifficulty: "normal",
    teamLoadouts: {
      A: { main: "koizumi", sub1: "yuki", sub2: "tsuruya" },
      B: { main: "kyon", sub1: "yuki", sub2: "shamisen" },
    },
  });
  const normalBot = normalSim.botBySeat("B");
  const normalDefender = normalSim.teamA.ships.main;
  const normalAttacker = normalSim.teamB.ships.main;
  normalDefender.x = 650;
  normalDefender.y = 720;
  normalAttacker.x = 892;
  normalAttacker.y = 720;
  normalBot.rememberContact(normalDefender, "visible");
  const normalContext = normalBot.buildTacticalContext(
    normalAttacker,
    normalBot.selectEnemyFocus(normalAttacker),
  );
  assert(normalContext.barrierTactics.infiltration, "普通AI没有掌握进入能量圈内才能有效攻击的基本规则");
  assert(
    normalContext.barrierTactics.infiltration.splitShipKeys.length === 0,
    "普通AI错误启用了困难以上的多路同步突入",
  );
  normalBot.issueMovement(normalContext);
  assert(
    Math.hypot(normalAttacker.route.p2.x - normalDefender.x, normalAttacker.route.p2.y - normalDefender.y)
      < normalContext.barrierTactics.enemy.radius,
    "普通AI没有以现有编队直接进入古泉能量圈",
  );
}

function aiKoizumiBarrierRangedCounterplayCheck() {
  const sim = new MatchSimulation({
    mode: "ai",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "koizumi", sub1: "yuki", sub2: "shamisen" },
      B: { main: "kyon", sub1: "yuki", sub2: "future1096" },
    },
  });
  const bot = sim.bot;
  const defendingMain = sim.teamA.ships.main;
  const future1096 = sim.teamB.ships.sub2;
  sim.teamB.split(1);
  sim.teamB.split(2);
  defendingMain.x = 650;
  defendingMain.y = 720;
  future1096.x = 940;
  future1096.y = 720;
  future1096.energy = future1096.maxEnergy;
  bot.rememberContact(defendingMain, "visible");
  let context = bot.buildTacticalContext(sim.teamB.ships.main, bot.selectEnemyFocus(sim.teamB.ships.main));
  context.skillAggression = 1.4;
  assert(!bot.shouldCastSubSkill(future1096, context.focus, context), "1096 AI仍会从盾外浪费光线");
  bot.modeTimer = 0;
  bot.issueMovement(context);
  const activeBarrierMainRange = Math.hypot(
    sim.teamB.ships.main.route.p2.x - defendingMain.x,
    sim.teamB.ships.main.route.p2.y - defendingMain.y,
  );

  future1096.x = defendingMain.x + 80;
  future1096.y = defendingMain.y;
  assert(bot.shouldCastSubSkill(future1096, context.focus, context), "1096 AI进入盾内后仍错误保留光线");

  // 关闭护盾后验证蓄力射线会对移动目标做前置量，而非瞄准旧位置。
  sim.teamA.koizumiBarrier.disabledAt = sim.elapsed;
  sim.teamA.koizumiBarrier.disabledUntil = sim.elapsed + 5;
  defendingMain.angle = Math.PI * 0.5;
  defendingMain.speed = 40;
  bot.rememberContact(defendingMain, "visible");
  context = bot.buildTacticalContext(sim.teamB.ships.main, bot.selectEnemyFocus(sim.teamB.ships.main));
  context.skillAggression = 1.4;
  assert(!context.barrierTactics.enemy.active, "AI没有识别闭锁空间的5秒失效窗口");
  bot.modeTimer = 0;
  bot.issueMovement(context);
  const breachWindowMainRange = Math.hypot(
    sim.teamB.ships.main.route.p2.x - defendingMain.x,
    sim.teamB.ships.main.route.p2.y - defendingMain.y,
  );
  assert(
    breachWindowMainRange < activeBarrierMainRange - 55,
    `AI没有在闭锁空间失效窗口集中压近：${activeBarrierMainRange.toFixed(1)}→${breachWindowMainRange.toFixed(1)}`,
  );
  bot.subTimers.sub2 = 0;
  bot.trySubSkill("sub2", context);
  const beam = sim.teamB.beams.at(-1);
  assert(beam && beam.phase === "charge", "1096 AI没有在破盾窗口释放光线");
  assert(beam.dirY > 0.08, "1096 AI光线没有按蓄力时间预判移动目标位置");
}

function aiHaruhiOtherworlderBarrierBreachCheck() {
  const sim = new MatchSimulation({
    mode: "ai",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "koizumi", sub1: "yuki", sub2: "shamisen" },
      B: { main: "haruhi", sub1: "yuki", sub2: "future1096" },
    },
  });
  const bot = sim.bot;
  const haruhi = sim.teamB.ships.main;
  const defendingMain = sim.teamA.ships.main;
  sim.teamB.haruhiFlagship.supporters.add("otherworlder");
  sim.teamB.haruhiFlagship.otherworlderReadyAt = sim.elapsed;
  haruhi.x = 980;
  haruhi.y = 720;
  defendingMain.x = 650;
  defendingMain.y = 720;
  bot.rememberContact(defendingMain, "visible");
  const context = bot.buildTacticalContext(haruhi, bot.selectEnemyFocus(haruhi));
  assert(context.barrierTactics.breachShipKey === "main", "春日获得异世界人后没有被选为破盾手");
  bot.issueMovement(context);
  assert(
    Math.hypot(haruhi.route.p2.x - defendingMain.x, haruhi.route.p2.y - defendingMain.y) < 8,
    "春日异世界人破盾路线没有对准古泉能量圈圆心",
  );
  assert(haruhi.throttle === throttleForGear(4), "春日异世界人破盾没有使用足够的冲撞航速");
}

function aiFuture1096FormDecisionCheck() {
  const sim = new MatchSimulation({
    mode: "ai",
    worldSize: 1440,
    teamLoadouts: {
      A: { main: "kyon", sub1: "haruhi", sub2: "yuki" },
      B: { main: "future1096", sub1: "koizumi", sub2: "asakura" },
    },
  });
  const bot = sim.bot;
  const aiTeam = sim.teamB;
  const enemyMain = sim.teamA.ships.main;
  bot.rememberContact(enemyMain, "visible");
  const estimate = bot.primaryEnemyEstimate();

  bot.flagshipTimer = 0;
  bot.tryFlagshipSkill({
    focus: estimate,
    skillAggression: 1,
    trackableIntel: true,
    defensivePressure: 0.1,
  });
  assert(aiTeam.future1096Form === "A", "1096 AI 接敌时未主动进入A形态");

  for (const ship of aiTeam.getPlayerShips()) {
    ship.hp = ship.maxHp * 0.5;
  }
  aiTeam.cooldowns.flagship = 0;
  bot.flagshipTimer = 0;
  bot.tryFlagshipSkill({
    focus: estimate,
    skillAggression: 0.1,
    trackableIntel: true,
    defensivePressure: 0.8,
  });
  assert(aiTeam.future1096Form === "B", "1096 AI 承压时未切换到B形态");
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
        main: "tsuruya",
        sub1: "haruhi",
        sub2: "koizumi",
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
  assert(aiTeam.effects.sponsorUntil <= sim.elapsed, "AI接敌紧急时仍会为一次技能把舰队能量压到保底以下");
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

function aiShamisenHuntIntelCheck() {
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.999;
    assert(randomAiLoadout().main === "shamisen", "三味线旗舰完成后仍未进入随机 AI 主舰池");
  } finally {
    Math.random = originalRandom;
  }

  try {
    Math.random = () => 0.37;
    const sim = new MatchSimulation({
      mode: "pvp",
      worldSize: 1440,
      aiSeats: ["A"],
      teamLoadouts: {
        A: { main: "shamisen", sub1: "koizumi", sub2: "yuki" },
        B: { main: "haruhi", sub1: "kyon", sub2: "tsuruya" },
      },
    });
    const bot = sim.botBySeat("A");
    const targetId = sim.teamA.shamisenHunt.targetId;
    sim.teamA.visibleEnemyIds = new Set();
    bot.refreshIntel();

    const contact = bot.enemyIntel.entities.get(targetId);
    assert(contact?.source === "hunt", "AI没有把无视野猎杀标记作为特殊追踪情报读取");
    assert(contact.characterId === null && contact.hp === null, "AI通过猎杀标记偷看了角色或血量");
    assert(!sim.teamA.visibleEnemyIds.has(targetId), "AI读取猎杀标记时错误获得了真实视野");
    assert(bot.selectEnemyFocus(sim.teamA.ships.main)?.id === targetId, "AI没有优先围绕猎杀目标规划战场");
  } finally {
    Math.random = originalRandom;
  }
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
  aiShamisenHuntIntelCheck();
  aiProbePressureCheck();
  aiSplitInitiativeCheck();
  aiYukiVisionLeadCheck();
  aiYukiRadarIntelCheck();
  aiYukiScoutDoctrineCheck();
  aiYukiScoutCadenceCheck();
  aiCombatScoutThreatCheck();
  aiAsakuraVisionWaveDecisionCheck();
  aiVisionWaveBuffCounterplayCheck();
  aiWoundedDetachedRetreatCheck();
  aiSectorEncirclementCheck();
  aiBacklineFlankCheck();
  aiOverwhelmedEscapeCheck();
  aiEnergyRecoveryModeCheck();
  aiEnergyThrottleHysteresisCheck();
  aiScoutEnergyReserveCheck();
  aiHighEnergySkillAggressionCheck();
  aiHaruhiFlagshipAggressionCheck();
  aiKoizumiOrbSteeringCheck();
  aiKoizumiBarrierDefenseCheck();
  aiKoizumiBarrierThreatEvasionCheck();
  aiKoizumiBarrierBreachCheck();
  aiKoizumiBarrierNoBreakerInfiltrationCheck();
  aiKoizumiBarrierRangedCounterplayCheck();
  aiHaruhiOtherworlderBarrierBreachCheck();
  aiFuture1096FormDecisionCheck();
  aiEmergencyEnergyReserveCheck();
  aiPressureCheck();
  aiEdgeRecoveryCheck();
  aiEngageCheck();
}
