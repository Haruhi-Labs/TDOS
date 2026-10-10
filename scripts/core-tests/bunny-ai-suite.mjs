import assert from "node:assert/strict";
import { MatchSimulation, randomAiLoadout, __resetEntityIds, TICK_DT } from "../../shared/game-core.js";
import { observeOwnShip, snapshotVisibleCharacterTactics } from "../../shared/game/ai/bridge/observation.js";
import * as bunnyTactics from "../../shared/game/ai/policy/tactics/bunny-stage.js";
import { withSeededRandom } from "./helpers.mjs";

// 战术模块只接收观测数据；测试直接改实时舰船，这里在每次调用前重新观测。
const shouldTransformBunny = (ship, ...rest) => bunnyTactics.shouldTransformBunny(observeOwnShip(ship), ...rest);
const bunnyStageRoute = (ship, ...rest) => bunnyTactics.bunnyStageRoute(observeOwnShip(ship), ...rest);

const bunny = { main: "kyon", sub1: "bunny_haruhi", sub2: "yuki" };
function legacyRandomLoadout() {
  const pool = ["haruhi", "koizumi", "yuki", "future1096", "kyon", "tsuruya", "asakura", "shamisen"];
  const mainPool = pool.filter((id) => id !== "tsuruya");
  const main = mainPool[Math.floor(Math.random() * mainPool.length)];
  const rest = pool.filter((id) => id !== main);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return { main, sub1: rest[0], sub2: rest[1] };
}

export function runBunnyAiSuite() {
  for (let seed = 1; seed <= 64; seed++) {
    const sample = (pick) => withSeededRandom(seed, () => [Array.from({ length: 16 }, pick), Math.random()]);
    assert.deepEqual(sample(randomAiLoadout), sample(legacyRandomLoadout), "旧主副舰候选顺序、随机结果及后续随机数必须一致");
  }
  withSeededRandom(407, () => {
    const sim = new MatchSimulation({ mode: "pvp", aiSeats: ["A"], teamLoadouts: { A: bunny } });
    const ship = sim.teamA.ships.sub1;
    const estimate = { x: ship.x + 100, y: ship.y, source: "visible", visible: true, age: 0 };
    assert.equal(shouldTransformBunny(ship, estimate), false, "附着时不能变身");
    sim.teamA.splitLevel = 2;
    assert.equal(shouldTransformBunny(ship, { ...estimate, source: "spawn" }), false);
    assert.equal(shouldTransformBunny(ship, { ...estimate, visible: false, age: 4 }), false);
    ship.hp = ship.maxHp * 0.35;
    assert.equal(shouldTransformBunny(ship, estimate), false, "保留生命支付后的撤退余量");
    ship.hp = ship.maxHp;
    assert.equal(shouldTransformBunny(ship, estimate), true);
    assert.equal(sim.teamA.castSubSkill("sub1"), true);
    assert.equal(shouldTransformBunny(ship, estimate), false, "领域冷却不可绕过");
    sim.teamA.cooldowns.sub1 = 0;
    assert.equal(shouldTransformBunny(ship, estimate, null), true, "战术上下文未形成时仍可使用已有接触情报");
    assert.equal(shouldTransformBunny(ship, estimate, { killWindow: true }), false, "有击杀机会时保留攻击形态");
    ship.hp = ship.maxHp * 0.4;
    assert.equal(shouldTransformBunny(ship, estimate), true, "低血时尝试免伤撤退");
    assert.equal(shouldTransformBunny(ship, { ...estimate, x: ship.x + 500 }), false, "远处威胁不提前耗尽短暂免伤，避免随后低速暴露");
    ship.hp = ship.maxHp;
    for (let i = 0; i < 3; i++) {
      sim.teamA.cooldowns.sub1 = 0;
      assert.equal(shouldTransformBunny(ship, estimate), true);
      assert.equal(sim.teamA.castSubSkill("sub1"), true);
    }
    sim.teamA.cooldowns.sub1 = 0;
    assert.equal(ship.bunnyHaruhi.form, "encore");
    assert.equal(shouldTransformBunny(ship, estimate), false, "健康且阿虚存活时保留激奏");
    sim.teamA.extraShips[0].alive = false;
    assert.equal(shouldTransformBunny(ship, estimate), true);

    const target = { x: 400, y: 400 };
    const stage = { ...estimate, x: 400, y: 400, bunnyStageRadius: 172 };
    const outside = bunnyStageRoute(ship, target, stage, 20);
    assert.ok(Math.hypot(outside.x - 400, outside.y - 400) > 172);
    assert.equal(bunnyStageRoute(ship, target, { ...stage, visible: false, age: 5 }, 20), target, "不能精准绕开失效记忆中的舞台");
    ship.bunnyStageExposure = { inside: true, enteredAt: 11, phase: "speechless" };
    assert.equal(bunnyStageRoute(ship, target, stage, 20), target, "健康舰允许撑到入迷");
    ship.hp = ship.maxHp * 0.4;
    assert.notEqual(bunnyStageRoute(ship, target, stage, 20), target);
    assert.equal(Object.hasOwn(snapshotVisibleCharacterTactics(sim.teamA.ships.main, 20), "bunnyStageRadius"), false);
  });
  // 真正运行 Bot 的指定主/副舰阵容；两边都用同一规则入口，不给阿虚创建 Bot 舰位。
  for (const slot of ["main", "sub1"]) withSeededRandom(410, () => {
    __resetEntityIds();
    const loadout = slot === "main" ? { main: "bunny_haruhi", sub1: "kyon", sub2: "yuki" } : bunny;
    const sim = new MatchSimulation({ mode: "pvp", aiSeats: ["A", "B"], teamLoadouts: { A: loadout } });
    for (let i = 0; i < 3600 && !sim.winnerSeat; i++) sim.update(TICK_DT);
    for (const team of [sim.teamA, sim.teamB]) for (const unit of team.getAllShips()) {
      assert.ok([unit.x, unit.y, unit.hp, unit.energy].every(Number.isFinite));
    }
    if (slot === "sub1") assert.ok(sim.teamA.ships.sub1.bunnyHaruhi.successfulCasts > 0, "指定阵容 AI 必须实际变身");
    assert.deepEqual(Object.keys(sim.bots), ["A", "B"]);
  });
}
