import { MatchSimulation } from "../../shared/game-core.js";
import {
  TUTORIAL_ATTACK_TARGET,
  TUTORIAL_MOVE_TARGET,
  tutorialEventStepSatisfied,
  tutorialMobileDockLayout,
  tutorialTargetContainsPoint,
} from "../../src/tutorial.js";
import { assert, runSteps } from "./helpers.mjs";

function tutorialBattleRulesCheck() {
  const sim = new MatchSimulation({
    mode: "ai",
    worldSize: 1440,
    tutorialMode: true,
    teamLoadouts: {
      A: { main: "haruhi", sub1: "yuki", sub2: "kyon" },
      B: { main: "kyon", sub1: "tsuruya", sub2: "koizumi" },
    },
  });

  for (const ship of sim.teamB.getAllShips()) {
    assert(ship.maxHp === 400 && ship.maxEnergy === 80, "教程敌舰未使用固定舰体/能量上限");
    assert(ship.base.speed === 20 && ship.base.turnRate === 0.4, "教程敌舰未使用固定航速/转向");
    assert(ship.base.vision === 50 && ship.base.range === 100, "教程敌舰未使用固定视野/射程");
    assert(ship.base.damage === 5 && ship.base.fireRate === 0.08, "教程敌舰未使用低伤害/极慢射速");
  }
  assert(sim.teamB.areSkillsDisabled(), "教程敌方技能未被禁用");
  assert(!sim.teamB.castFlagshipSkill(), "教程敌方仍能发动旗舰技能");
  assert(sim.teamB.launchScout(5), "教程敌方角色技能禁用时侦察机也被错误禁用");
  sim.teamB.scouts = [];
  sim.teamB.cooldowns.scout = 0;

  const enemyStart = { x: sim.teamB.ships.main.x, y: sim.teamB.ships.main.y };
  runSteps(sim, 0.8);
  assert(!sim.teamB.ships.main.route, "教程自由战前敌方AI仍在下达航线");
  assert(Math.hypot(sim.teamB.ships.main.x - enemyStart.x, sim.teamB.ships.main.y - enemyStart.y) < 0.01, "教程自由战前敌舰仍在移动");

  const playerMain = sim.teamA.ships.main;
  playerMain.takeDamage(playerMain.maxHp * 10, null, sim);
  assert(playerMain.alive && playerMain.hp >= playerMain.maxHp * 0.25, "教程友军1/4舰体锁定未生效");

  playerMain.x = 720;
  playerMain.y = 720;
  playerMain.command = { x: 720, y: 720 };
  playerMain.cooldown = 0;
  const enemyMain = sim.teamB.ships.main;
  enemyMain.x = 840;
  enemyMain.y = 720;
  enemyMain.command = { x: 840, y: 720 };
  sim.teamA.computeVisibility(sim.teamB);
  sim.projectiles = [];
  runSteps(sim, 0.2);
  assert(sim.projectiles.length === 0, "教程交火解锁前友军仍会自动开火");
  sim.setCombatEnabled("A", true);
  runSteps(sim, 0.2);
  assert(sim.projectiles.some((item) => item.team === sim.teamA), "教程交火解锁后友军没有恢复自动开火");

  sim.setAiEnabled("B", true);
  sim.setCombatEnabled("B", true);
  runSteps(sim, 0.2);
  assert(sim.bot.moveTimer > 0 || sim.teamB.ships.main.route, "教程自由战开始后敌方AI没有恢复运行");
}

function tutorialTargetGeometryCheck() {
  assert(tutorialTargetContainsPoint(TUTORIAL_MOVE_TARGET, TUTORIAL_MOVE_TARGET), "教程移动目标中心未被接受");
  assert(
    tutorialTargetContainsPoint(
      { x: TUTORIAL_MOVE_TARGET.x + TUTORIAL_MOVE_TARGET.radius, y: TUTORIAL_MOVE_TARGET.y },
      TUTORIAL_MOVE_TARGET,
    ),
    "教程移动目标边缘未被接受",
  );
  assert(
    !tutorialTargetContainsPoint(
      { x: TUTORIAL_MOVE_TARGET.x + TUTORIAL_MOVE_TARGET.radius + 1, y: TUTORIAL_MOVE_TARGET.y },
      TUTORIAL_MOVE_TARGET,
    ),
    "教程移动目标范围外坐标被错误接受",
  );
  assert(
    tutorialTargetContainsPoint(
      { x: TUTORIAL_ATTACK_TARGET.x - 20, y: TUTORIAL_ATTACK_TARGET.y + 20 },
      TUTORIAL_ATTACK_TARGET,
    ),
    "教程三舰集结区域内坐标未被接受",
  );
  assert(!tutorialTargetContainsPoint({ x: "无效", y: 0 }, TUTORIAL_MOVE_TARGET), "教程目标接受了非法坐标");
}

function tutorialEventTriggerCheck() {
  const selectedEarly = new Set(["sub1"]);
  assert(
    !tutorialEventStepSatisfied("yuki_skill", { selectedShips: selectedEarly, yukiSkillCast: false }),
    "教程在长门技能释放前错误推进",
  );
  assert(
    tutorialEventStepSatisfied("yuki_skill", { selectedShips: selectedEarly, yukiSkillCast: true }),
    "提前选择长门后成功释放技能仍无法推进",
  );

  const castEarly = { selectedShips: new Set(), yukiSkillCast: true };
  assert(!tutorialEventStepSatisfied("yuki_skill", castEarly), "教程在尚未选择长门时错误推进");
  castEarly.selectedShips.add("sub1");
  assert(tutorialEventStepSatisfied("yuki_skill", castEarly), "长门选择与技能事件顺序影响步骤完成判定");

  assert(tutorialEventStepSatisfied("scout", { scoutLaunched: true }), "侦察机成功派出后步骤未完成");
  assert(tutorialEventStepSatisfied("split_yuki", { splitLevelReached: 1 }), "一级分离状态未被步骤识别");
  assert(tutorialEventStepSatisfied("split_kyon", { splitLevelReached: 2 }), "二级分离状态未被步骤识别");
  assert(
    tutorialEventStepSatisfied("battle_skills", { usedBattleSkills: new Set(["kyon", "flagship"]) }),
    "战斗技能的释放顺序影响步骤完成判定",
  );
}

function tutorialMobileDockCheck() {
  const buttons = [
    { top: 500, bottom: 540 }, { top: 500, bottom: 540 }, { top: 500, bottom: 540 },
    { top: 546, bottom: 586 }, { top: 546, bottom: 586 }, { top: 546, bottom: 586 },
    { top: 592, bottom: 632 }, { top: 592, bottom: 632 }, { top: 592, bottom: 632 },
  ];
  const dock = tutorialMobileDockLayout({
    buttonRects: buttons,
    hudRect: { top: 390, bottom: 660, left: 8, right: 382 },
    viewportWidth: 390,
    viewportHeight: 668,
  });
  assert(dock.topBoundary === 592, "移动教程说明区没有落在倒数第二排按钮之下");
  assert(dock.bottomInset === 16, "移动教程说明区没有保留HUD底部内距");
  assert(dock.maxHeight === 60, "移动教程说明区高度越过了倒数第二排按钮边界");
  assert(dock.leftInset === 16, "移动教程说明区左侧没有对齐HUD内边距");
  assert(dock.rightInset === 16, "移动教程说明区右侧没有对齐HUD内边距");
}

export function runTutorialSuite() {
  tutorialTargetGeometryCheck();
  tutorialEventTriggerCheck();
  tutorialMobileDockCheck();
  tutorialBattleRulesCheck();
}
