import assert from "node:assert/strict";
import { MatchSimulation, throttleForGear } from "../../shared/game-core.js";
import { AI_ACTION_TYPES, aiActions } from "../../shared/game/ai/actions.js";
import { AI_ACTION_MODES, createActionPort } from "../../shared/game/ai/bridge/action-port.js";
import { validateMatchAction } from "../../shared/protocol/match-actions.js";

const LOADOUTS = {
  A: { main: "kyon", sub1: "tsuruya", sub2: "future1096" },
  B: { main: "yuki", sub1: "koizumi", sub2: "asakura" },
};

function createMatch(options = {}) {
  return new MatchSimulation({ mode: "pvp", worldSize: 1440, teamLoadouts: LOADOUTS, ...options });
}

function vocabularyCheck() {
  for (const action of [
    aiActions.launchScout({ zoneId: 5, shipKey: "main", seekPoint: { x: 1, y: 2 } }),
    aiActions.retaskScout({ scoutId: 1, zoneId: 5 }),
  ]) {
    assert.equal(validateMatchAction(action).ok, false, "AI 扩展动作不得通过对局动作协议校验");
    assert.deepEqual(JSON.parse(JSON.stringify(action)), action, "动作必须是纯数据");
  }
  for (const action of [
    aiActions.setRoute({ shipKey: "main", endX: 10, endY: 20, throttle: 1 }),
    aiActions.routeEnd({ shipKey: "main", endX: 10, endY: 20 }),
    aiActions.setThrottle({ shipKey: "main", throttle: 0.7 }),
    aiActions.split(1),
    aiActions.castFlagshipSkill(),
    aiActions.castSubSkill({ shipKey: "sub1", targetX: 3, targetY: 4 }),
  ]) {
    assert.equal(validateMatchAction(action).ok, true, `${action.type} 必须是合法的标准动作`);
  }
  assert.deepEqual(Object.keys(aiActions.castSubSkill({ shipKey: "sub2" })).sort(), ["shipKey", "type"]);
  assert.equal(aiActions.setRoute({ shipKey: "main", endX: 1, endY: 2, throttle: 1 }).anchorToMain, false);
}

function portCheck(mode) {
  const sim = createMatch();
  const team = sim.teamB;
  const port = createActionPort(sim, "B", { mode });

  const first = port.observe();
  assert.equal(port.observe(), first, "没有动作提交时必须复用同一份观测");
  assert.equal(port.submit(aiActions.split(1)), true);
  assert.equal(team.splitLevel, 1);
  const afterSplit = port.observe();
  assert.notEqual(afterSplit, first, "动作提交后观测必须重建");
  assert.equal(afterSplit.self.splitLevel, 1);
  assert.equal(port.submit(aiActions.split(1)), false, "重复分离应被拒绝");

  assert.equal(port.submit(aiActions.setRoute({ shipKey: "sub1", endX: 700, endY: 500, throttle: 1.4 })), true);
  assert.equal(team.ships.sub1.route.anchorToMain, false);
  assert.equal(team.ships.sub1.throttle, throttleForGear(4));
  assert.equal(port.submit(aiActions.routeEnd({ shipKey: "sub1", endX: 640, endY: 520 })), true);
  assert.deepEqual(team.ships.sub1.route.p2, { x: 640, y: 520 });
  assert.equal(port.submit(aiActions.setThrottle({ shipKey: "sub1", throttle: 0.72 })), true);
  assert.equal(team.ships.sub1.throttle, throttleForGear(2), "档位值必须归一到离散档");

  team.ships.main.energy = team.ships.main.maxEnergy;
  assert.equal(port.submit(aiActions.launchScout({
    zoneId: 4,
    shipKey: "main",
    seekPoint: { x: 300, y: 400 },
    patrolCenter: { x: 310, y: 410 },
    patrolRadius: 80,
    mission: "battlefield",
  })), true);
  const scout = team.scouts.at(-1);
  assert.deepEqual(scout.command, { x: 300, y: 400 }, "扩展发射动作必须把寻的点交给侦察机");
  assert.equal(scout.mission, "battlefield");
  assert.equal(port.submit(aiActions.retaskScout({
    scoutId: scout.id,
    zoneId: 6,
    seekPoint: { x: 900, y: 700 },
    mission: "forward-harass",
  })), true);
  assert.equal(scout.zone.id, 6);
  assert.equal(scout.mission, "forward-harass");
  assert.equal(port.submit(aiActions.retaskScout({ scoutId: -1, zoneId: 6 })), false);
  assert.equal(port.submit({ type: "unknown_action" }), false);
}

function permissionCheck() {
  // 标准执行链下 AI 与玩家受同样的操作权限约束；旧路径不做校验，仅用于行为对照。
  for (const mode of [AI_ACTION_MODES.DISPATCH, AI_ACTION_MODES.DIRECT]) {
    const sim = createMatch();
    const ship = sim.teamB.ships.main;
    const port = createActionPort(sim, "B", { mode });
    ship.throttle = throttleForGear(4);
    ship.effects.stunnedUntil = sim.elapsed + 5;
    assert.equal(ship.canControl(), false);
    const accepted = port.submit(aiActions.setThrottle({ shipKey: "main", throttle: throttleForGear(1) }));
    if (mode === AI_ACTION_MODES.DISPATCH) {
      assert.equal(accepted, false, "禁控期间 AI 不得换挡");
      assert.equal(ship.throttle, throttleForGear(4));
      assert.deepEqual(port.permissionRejections, { count: 1, controlLocked: 1, firstTick: sim.tick });
    } else {
      assert.equal(accepted, true);
      assert.equal(ship.throttle, throttleForGear(1));
      assert.equal(port.permissionRejections.count, 0);
    }
  }
}

function runnerCheck() {
  const sim = createMatch({ aiSeats: ["B"] });
  const runner = sim.aiRunners.B;
  assert.equal(runner.port.mode, AI_ACTION_MODES.DISPATCH, "AI 默认经标准执行链下发动作");
  assert.equal(runner.policy, sim.botBySeat("B"));
  assert.equal(Object.hasOwn(runner.policy, "legacyWrite"), false, "AI 不得绕过端口保存己方舰队的写入入口");
  assert.equal(createMatch({ aiSeats: ["B"], aiActionMode: "direct" }).aiRunners.B.port.mode, AI_ACTION_MODES.DIRECT);
  assert.equal(AI_ACTION_TYPES.AI_LAUNCH_SCOUT, "ai_launch_scout");
}

export function runAiActionsSuite() {
  vocabularyCheck();
  portCheck(AI_ACTION_MODES.DISPATCH);
  portCheck(AI_ACTION_MODES.DIRECT);
  permissionCheck();
  runnerCheck();
}
