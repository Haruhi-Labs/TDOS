import assert from "node:assert/strict";
import { MatchSimulation, TICK_DT } from "../../shared/game-core.js";
import { buildObservation, observeEnemySpawn } from "../../shared/game/ai/bridge/observation.js";
import { runSteps, withSeededRandom } from "./helpers.mjs";

function createMatch(teamLoadouts, options = {}) {
  return new MatchSimulation({ mode: "pvp", worldSize: 1440, aiSeats: ["B"], teamLoadouts, ...options });
}

function hold(ship, x, y) {
  ship.x = x;
  ship.y = y;
  ship.command = { x, y };
  ship.route = null;
}

function pureDataCheck() {
  const sim = createMatch({
    A: { main: "koizumi", sub1: "asakura", sub2: "bunny_haruhi" },
    B: { main: "yuki", sub1: "haruhi", sub2: "shamisen" },
  }, { aiSeats: ["A", "B"] });
  withSeededRandom(11, () => runSteps(sim, 25));
  for (const seat of ["A", "B"]) {
    const observation = buildObservation(sim, seat);
    assert.deepEqual(
      JSON.parse(JSON.stringify(observation)),
      observation,
      `${seat} 席观测必须是可 JSON 往返的纯数据`,
    );
    assert.equal(observation.self.seat, seat);
    assert.equal(observation.time, sim.elapsed);
  }
}

function fogCheck() {
  const sim = createMatch({
    A: { main: "kyon", sub1: "tsuruya", sub2: "future1096" },
    B: { main: "haruhi", sub1: "koizumi", sub2: "asakura" },
  });
  const enemyMain = sim.teamA.ships.main;
  const aiMain = sim.teamB.ships.main;
  // 把敌方旗舰放到带可识别小数的位置，且远离 AI 的全部视野源。
  hold(enemyMain, 137.628413, 211.904377);
  sim.teamB.computeVisibility(sim.teamA);
  const hidden = buildObservation(sim, "B");
  assert.equal(hidden.enemy.visible.length, 0, "视野外的敌方实体不得进入观测");
  assert.equal(hidden.enemy.visibleTeamBuffs, null, "没有可见敌舰时不得给出敌方编队增益");
  const text = JSON.stringify(hidden);
  assert.ok(!text.includes("137.628413") && !text.includes("211.904377"), "观测泄漏了不可见敌舰的坐标");
  assert.deepEqual(Object.keys(hidden.privileged).sort(), [
    "enemyAliveCount", "enemyHasKyonFlagship", "enemyHullRatio", "hasHiddenEnemyShip",
  ], "越过迷雾的读取必须集中在 privileged 且不得新增");
  assert.equal(hidden.privileged.enemyHullRatio, sim.teamA.hullRatio());
  assert.equal(hidden.privileged.enemyAliveCount, 3);
  assert.equal(hidden.privileged.enemyHasKyonFlagship, true);
  assert.equal(hidden.privileged.hasHiddenEnemyShip, true);

  hold(enemyMain, aiMain.x - aiMain.effectiveVision() * 0.5, aiMain.y);
  sim.teamB.computeVisibility(sim.teamA);
  const seen = buildObservation(sim, "B");
  const contact = seen.enemy.visible.find((entity) => entity.id === enemyMain.id);
  assert.ok(contact, "视野内的敌舰必须进入观测");
  assert.equal(contact.x, enemyMain.x);
  assert.equal(contact.characterId, "kyon");
  assert.ok(seen.enemy.visibleTeamBuffs, "看见敌舰后可以读取公开的编队增益");

  // 可见集合来自上一帧，观测不得包含已被击沉的实体。
  enemyMain.alive = false;
  assert.equal(buildObservation(sim, "B").enemy.visible.some((entity) => entity.id === enemyMain.id), false);
}

function ownStateCheck() {
  const sim = createMatch({
    A: { main: "kyon", sub1: "tsuruya", sub2: "future1096" },
    B: { main: "haruhi", sub1: "koizumi", sub2: "asakura" },
  });
  const team = sim.teamB;
  team.split(1);
  const observation = buildObservation(sim, "B");
  for (const key of ["main", "sub1", "sub2"]) {
    const live = team.ships[key];
    const ship = observation.self.ships[key];
    assert.equal(ship.stats.range, live.effectiveRange());
    assert.equal(ship.stats.vision, live.effectiveVision());
    assert.equal(ship.attached, live.isAttached());
    assert.equal(ship.canControl, live.canControl());
    assert.equal(ship.throttle, live.throttle);
    assert.deepEqual(ship.fleet.memberIds, team.fleetMembersForShip(live).map((member) => member.id));
    assert.equal(ship.fleet.energy, team.fleetEnergyForShip(live).current);
  }
  assert.equal(observation.self.splitLevel, 1);
  assert.equal(observation.self.ships.sub1.attached, false);
  assert.equal(observation.self.ships.sub2.attached, true);
  assert.equal(observation.self.radar, null, "非长门旗舰不应有雷达接触");
  assert.equal(observation.self.hunt, null, "非三味线旗舰不应有猎杀标记");
  assert.deepEqual(
    observeEnemySpawn(sim, "B"),
    (({ id, key, slotKey, x, y, angle }) => ({ id, key, slotKey, x, y, angle }))(sim.teamA.ships.main),
  );
}

function radarAndHuntCheck() {
  const sim = createMatch({
    A: { main: "shamisen", sub1: "tsuruya", sub2: "kyon" },
    B: { main: "yuki", sub1: "koizumi", sub2: "asakura" },
  }, { aiSeats: [] });
  withSeededRandom(23, () => {
    let radar = null;
    for (let tick = 0; tick < 600 && !radar?.contacts.length; tick += 1) {
      sim.update(TICK_DT);
      radar = buildObservation(sim, "B").self.radar;
    }
    assert.ok(radar?.contacts.length > 0, "长门旗舰的观测应包含雷达接触");
    const privateRadar = sim.serializeRadarForSeat("B");
    for (const contact of radar.contacts) {
      const source = privateRadar.contacts.find((item) => item.targetId === contact.targetId);
      assert.ok(source, "观测中的雷达接触必须来自己方私有雷达");
      assert.equal(contact.x, source.x, "雷达接触必须保留带误差的位置，不得替换为真实坐标");
      assert.equal(contact.y, source.y);
    }
  });

  const hunter = buildObservation(sim, "A");
  const target = sim.teamB.getAllShips().find((ship) => ship.id === sim.teamA.shamisenHunt.targetId);
  assert.deepEqual(Object.keys(hunter.self.hunt).sort(), ["targetId", "visible", "x", "y"], "猎杀标记只暴露编号、位置与是否可见");
  assert.equal(hunter.self.hunt.x, target.x);
  assert.deepEqual(buildObservation(sim, "B").self.hunted, { shipId: target.id, shipKey: target.key });
  assert.equal(hunter.self.radar, null);
}

function facadeCheck() {
  const sim = createMatch({
    A: { main: "kyon", sub1: "tsuruya", sub2: "future1096" },
    B: { main: "haruhi", sub1: "koizumi", sub2: "asakura" },
  });
  const bot = sim.botBySeat("B");
  assert.equal(Object.hasOwn(bot, "enemy"), false, "AI 不得持有敌方舰队引用");
  const aiMain = sim.teamB.ships.main;
  // 测试直接改实时状态后调用内部方法，门面必须先刷新观测并把实时舰船换成观测数据。
  aiMain.energy = aiMain.maxEnergy * 0.5;
  const before = bot.energyProfile(aiMain).current;
  aiMain.energy = 0;
  assert.ok(bot.energyProfile(aiMain).current < before, "外部调用没有刷新观测");
  assert.equal(bot.energyProfile("main").current, sim.teamB.fleetEnergyForShip("main").current);
}

export function runAiObservationSuite() {
  pureDataCheck();
  fogCheck();
  ownStateCheck();
  radarAndHuntCheck();
  facadeCheck();
}
