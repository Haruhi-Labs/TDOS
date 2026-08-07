import assert from "node:assert/strict";
import {
  MATCH_ACTION_TYPES,
  isMatchAction,
  matchActions,
  validateMatchAction,
} from "../shared/protocol/match-actions.js";
import {
  createLocalBattleActionTransport,
  createRemoteBattleActionTransport,
} from "../src/battle/action-transport.js";
import { localThrottleForShip } from "../src/battle/throttle.js";
import { MatchSimulation } from "../shared/game-core.js";

const actions = [
  matchActions.setRoute({ shipKey: "main", endX: 300, endY: 400, throttle: 1 }),
  matchActions.routeControl({ shipKey: "main", controlX: 250, controlY: 350 }),
  matchActions.routeEnd({ shipKey: "main", endX: 500, endY: 600 }),
  matchActions.setThrottle({ shipKey: "main", throttle: 1.4 }),
  matchActions.clearRoute({ shipKey: "main" }),
  matchActions.split(1),
  matchActions.launchScout({ shipKey: "sub1", zoneId: 3 }),
  matchActions.configureAutoScout({ enabled: true, zoneId: 4 }),
  matchActions.emergencyBrake("main"),
  matchActions.castFlagshipSkill(5),
  matchActions.castSubSkill({ shipKey: "sub1", targetX: 700, targetY: 800 }),
];

assert.equal(actions.length, Object.keys(MATCH_ACTION_TYPES).length, "每种权威动作都应有统一构造器");
for (const action of actions) {
  assert.equal(isMatchAction(action), true, `构造器生成了非法动作：${action.type}`);
}
assert.deepEqual(matchActions.split(2), { type: "split", level: 2 }, "分离动作协议发生变化");
assert.deepEqual(matchActions.emergencyBrake("sub1"), {
  type: "emergency_brake",
  shipKey: "sub1",
}, "急刹动作协议发生变化");
assert.equal(validateMatchAction({ type: "set_route", endX: "无效", endY: 0 }).ok, false, "非法航线应被协议层拒绝");
assert.equal(validateMatchAction({ type: "split", level: 3 }).ok, false, "非法分离等级应被协议层拒绝");
assert.equal(validateMatchAction({ type: "未来动作" }).ok, false, "未知动作类型应被协议层拒绝");

const localAccepted = [];
const localTransport = createLocalBattleActionTransport({
  getSimulation: () => ({
    applyActionForSeat(seat, action) {
      localAccepted.push({ seat, action });
      return true;
    },
  }),
  seat: "A",
  onAccepted: (action) => localAccepted.push({ accepted: action.type }),
});
assert.equal(localTransport.send(matchActions.split(1)), true, "本地传输应返回模拟器动作结果");
assert.deepEqual(localAccepted, [
  { seat: "A", action: { type: "split", level: 1 } },
  { accepted: "split" },
], "本地传输不得改写动作或席位");

let connected = true;
let sequence = 40;
const envelopes = [];
const remoteTransport = createRemoteBattleActionTransport({
  canSend: () => connected,
  nextSequence: () => ++sequence,
  sendEnvelope: (envelope) => envelopes.push(envelope),
  now: () => 123456,
});
assert.equal(remoteTransport.send(matchActions.setThrottle({ shipKey: "main", throttle: 1 })), 41, "远程动作应返回输入序号");
assert.deepEqual(envelopes[0], {
  type: "input",
  seq: 41,
  action: { type: "set_throttle", shipKey: "main", throttle: 1 },
  clientTime: 123456,
}, "远程输入信封格式发生变化");
connected = false;
assert.equal(remoteTransport.send(matchActions.split(1)), null, "断线状态不得分配或发送动作序号");
assert.equal(sequence, 41, "被拒绝的动作不得消耗输入序号");
assert.equal(remoteTransport.send({ type: "未知" }), null, "远程传输不得发送未知动作");

const soloSimulation = new MatchSimulation({ mode: "pvp", worldSize: 1440 });
const staleRenderedShip = soloSimulation.serializeState().teams.A.ships.main;
const soloTransport = createLocalBattleActionTransport({
  getSimulation: () => soloSimulation,
  seat: "A",
});
assert.equal(
  soloTransport.send(matchActions.setThrottle({ shipKey: "main", throttle: 1.4 })),
  true,
  "单人换挡动作未被本地权威模拟接受",
);
const localCommandThrottle = localThrottleForShip(
  soloSimulation.teamA.ships.main,
  staleRenderedShip,
);
assert.equal(localCommandThrottle, 1.4, "单人控制链错误采用了上一逻辑帧的显示档位");
assert.equal(
  soloTransport.send(matchActions.setRoute({
    shipKey: "main",
    endX: soloSimulation.teamA.ships.main.x + 400,
    endY: soloSimulation.teamA.ships.main.y,
    throttle: localCommandThrottle,
  })),
  true,
  "单人换挡后同帧续设航线失败",
);
assert.equal(soloSimulation.teamA.ships.main.throttle, 1.4, "单人同帧续设航线把档位回滚到了旧显示态");

console.log("战斗动作协议校验通过：动作构造、校验及本地/远程传输接口保持统一。");
