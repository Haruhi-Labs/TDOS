import assert from "node:assert/strict";
import * as legacy from "../../shared/game/haruhi-flagship.js";
import {
  createSupportState, unlockSupport, tickSupportSource, supportOrbGeometry,
  supportOtherworlderReady, triggerSupportOtherworlder,
} from "../../shared/game/haruhi-support.js";
import {
  bunnyHaruhiSupportSource, unlockBunnyHaruhiSupport, updateBunnyHaruhiSupport,
} from "../../shared/game/bunny-haruhi-support.js";
import { createBunnyHaruhiState } from "../../shared/game/bunny-haruhi.js";

function fixture() {
  const team = {
    match: { elapsed: 0 }, effects: {}, marks: [], ships: {},
    mainCharacterId: () => "haruhi", haruhiFlagship: legacy.createHaruhiFlagshipState(),
    markActiveSkillEffectStarted(key) { this.marks.push(key); },
  };
  team.ships.main = {
    id: 1, characterId: "haruhi", slotKey: "main", team, alive: true,
    x: 100, y: 200, radius: 10, effectiveVision: () => 100,
  };
  team.ships.sub1 = {
    id: 2, characterId: "bunny_haruhi", slotKey: "sub1", team, alive: true,
    x: 500, y: 600, radius: 12.8, effectiveVision: () => 172,
    bunnyHaruhi: createBunnyHaruhiState(),
  };
  return team;
}

function seededRandom(seed) {
  let calls = 0;
  return {
    next() {
      calls += 1;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    },
    get calls() { return calls; },
  };
}

function factoryAndUnlockCheck() {
  const a = createSupportState(7);
  const b = createSupportState();
  assert.deepEqual(Object.keys(a), [
    "supporters", "alienNextAt", "timeTravelerNextAt", "queuedBeamAt", "otherworlderReadyAt", "esperAngle",
  ], "旧状态字段及顺序不增加停用标记");
  assert.equal(a.esperAngle, 7 - Math.PI * 2);
  a.supporters.add("esper");
  a.queuedBeamAt.push(1);
  assert.equal(b.supporters.size, 0);
  assert.deepEqual(b.queuedBeamAt, []);
  assert.deepEqual(createBunnyHaruhiState().support, legacy.createHaruhiFlagshipState());
  const team = fixture();
  const oldRandom = seededRandom(0x48415255);
  const results = Array.from({ length: 5 }, () => legacy.activateHaruhiFlagship(team, 16, oldRandom.next));
  // 已与抽取前实现核对；此夹具不包含Match构造时的随机数消费。
  assert.deepEqual(results, ["esper", "alien", "time_traveler", "otherworlder", null]);
  assert.equal(oldRandom.calls, 4);
  assert.equal(team.marks.length, 5);
  team.match.elapsed = 20;
  assert.equal(legacy.activateHaruhiFlagship(team, 16, oldRandom.next), null);
  assert.equal(oldRandom.calls, 4);
  assert.equal(team.effects.haruhiBoostUntil, 36);
  assert.equal(team.haruhiFlagship.alienNextAt, 6);
  assert.equal(team.haruhiFlagship.timeTravelerNextAt, 10);
  assert.equal(team.haruhiFlagship.otherworlderReadyAt, 0);
  const source = bunnyHaruhiSupportSource(team.ships.sub1, true);
  const newRandom = seededRandom(0x48415255);
  assert.deepEqual(Array.from({ length: 4 }, () => unlockBunnyHaruhiSupport(source, 5, newRandom.next)),
    ["esper", "time_traveler", "otherworlder", null]);
  assert.equal(newRandom.calls, 3);
  assert.equal(source.state.timeTravelerNextAt, 15);
  assert.equal(source.state.otherworlderReadyAt, 5);
  assert.equal(source.state.supporters.has("alien"), false);
  for (const [roll, expected] of [[-1, "alien"], [NaN, "alien"], [undefined, "alien"], [Infinity, "esper"], [1, "esper"]]) {
    assert.equal(unlockSupport(createSupportState(), legacy.HARUHI_SUPPORTS, 0, () => roll), expected);
  }
  assert.equal(unlockSupport(b, [], 0, () => { throw new Error("空池不应消费随机数"); }), null);
}

function legacySchedulingCheck() {
  const team = fixture();
  let calls = 0;
  const random = () => ++calls / 100;
  for (let i = 0; i < 4; i += 1) legacy.activateHaruhiFlagship(team, 16, random);
  assert.equal(calls, 4);
  const events = [];
  const hooks = {
    dt: 0,
    launchAlienWingmen: (ship) => events.push(["alien", ship.id, random()]),
    launchRandomBeam: (ship) => events.push(["beam", ship.id, random()]),
  };
  team.match.elapsed = 30;
  legacy.updateHaruhiFlagship(team, hooks);
  assert.deepEqual(events, [
    ["alien", 1, 0.05], ["alien", 1, 0.06], ["alien", 1, 0.07], ["alien", 1, 0.08], ["alien", 1, 0.09],
    ["beam", 1, 0.1], ["beam", 1, 0.11], ["beam", 1, 0.12], ["beam", 1, 0.13],
    ["beam", 1, 0.14], ["beam", 1, 0.15], ["beam", 1, 0.16],
  ], "追帧事件先后与回调取随机数的位置必须不变");
  assert.equal(calls, 16);
  assert.equal(team.haruhiFlagship.alienNextAt, 36);
  assert.equal(team.haruhiFlagship.timeTravelerNextAt, 40);
  assert.deepEqual(team.haruhiFlagship.queuedBeamAt, [30.3, 30.6]);
  legacy.updateHaruhiFlagship(team, hooks);
  assert.equal(calls, 16);
  team.match.elapsed = 30.3 - 5e-10;
  legacy.updateHaruhiFlagship(team, hooks);
  assert.equal(calls, 17, "保留旧时间比较容差");
  team.ships.main.alive = false;
  team.match.elapsed = 50;
  legacy.updateHaruhiFlagship(team, hooks);
  assert.equal(calls, 17);
  assert.deepEqual(team.haruhiFlagship.queuedBeamAt, []);
  assert.equal(team.haruhiFlagship.timeTravelerNextAt, 40);
  assert.equal(Object.hasOwn(team.haruhiFlagship, "suspended"), false);
  assert.equal(legacy.haruhiEsperOrb(team), null);
  assert.equal(legacy.haruhiOtherworlderReady(team), false);
  const invalid = fixture();
  invalid.mainCharacterId = () => "bunny_haruhi";
  const before = structuredClone(invalid.haruhiFlagship);
  assert.equal(legacy.activateHaruhiFlagship(invalid, 16, random), null);
  legacy.updateHaruhiFlagship(invalid, hooks);
  assert.equal(legacy.hasHaruhiSupport(invalid, "esper"), false);
  assert.deepEqual(invalid.haruhiFlagship, before);
  assert.equal(calls, 17);
  legacy.updateHaruhiFlagship(null);
  assert.equal(legacy.haruhiEsperOrb(null), null);
  assert.equal(legacy.triggerHaruhiOtherworlder(null), false);
}

function geometryAndCooldownCheck() {
  const team = fixture();
  team.haruhiFlagship.supporters = new Set(legacy.HARUHI_SUPPORTS);
  const oldOrb = legacy.haruhiEsperOrb(team);
  assert.deepEqual(oldOrb, {
    x: 200, y: 200, angle: 0, orbitRadius: 100,
    radius: 10 * 0.92, absorbRadius: 10 * 0.92 * 3,
  });
  assert.equal(legacy.triggerHaruhiOtherworlder(team), true);
  assert.equal(legacy.triggerHaruhiOtherworlder(team), false);
  team.match.elapsed = 8;
  assert.equal(legacy.haruhiOtherworlderReady(team), true);
  const view = legacy.serializeHaruhiFlagship(team);
  assert.deepEqual(Object.keys(view), ["boostActive", "supporters", "otherworlderReady", "esperOrb"]);
  assert.deepEqual(view.supporters, ["alien", "time_traveler", "otherworlder", "esper"]);
  team.haruhiFlagship.otherworlderReadyAt = 37;
  const source = bunnyHaruhiSupportSource(team.ships.sub1, true);
  source.state.supporters = new Set(["esper", "otherworlder"]);
  const newOrb = supportOrbGeometry(source);
  assert.equal(newOrb.x, 672);
  assert.equal(newOrb.y, 600);
  assert.equal(newOrb.orbitRadius, 172);
  assert.equal(triggerSupportOtherworlder(source, 0), true);
  assert.equal(source.state.otherworlderReadyAt, 8);
  assert.equal(supportOtherworlderReady(source, 7.99), false);
  assert.equal(supportOtherworlderReady(source, 8), true);
  assert.equal(team.haruhiFlagship.otherworlderReadyAt, 37, "新来源不能改写旧来源状态");
  assert.deepEqual(legacy.haruhiEsperOrb(team), oldOrb);
  assert.equal(supportOrbGeometry({ ...source, enabled: false }), null);
  assert.equal(triggerSupportOtherworlder({ ...source, enabled: false }, 8), false);
  team.ships.sub1.alive = false;
  assert.equal(supportOrbGeometry(source), null);
  assert.equal(supportOtherworlderReady(source, 8), false);
}

function explicitSourceCheck() {
  const team = fixture();
  const ship = team.ships.sub1;
  assert.equal(bunnyHaruhiSupportSource(null, true), null);
  assert.equal(bunnyHaruhiSupportSource(team.ships.main, true), null);
  assert.equal(bunnyHaruhiSupportSource({ ...ship }, true), null, "不能把额外实体当成真实副舰槽位");
  const oldCharacter = ship.characterId;
  ship.characterId = "haruhi";
  assert.equal(bunnyHaruhiSupportSource(ship, true), null);
  ship.characterId = oldCharacter;
  assert.equal(bunnyHaruhiSupportSource(ship).enabled, false, "启用必须显式传入");
  const source = bunnyHaruhiSupportSource(ship, true);
  assert.equal(source.sourceShip, ship);
  assert.notEqual(source.state, team.haruhiFlagship);
  const originalOldState = structuredClone(team.haruhiFlagship);
  unlockBunnyHaruhiSupport(source, 0, () => 0);
  const emitters = [];
  const hooks = { launchRandomBeam: (emitter) => emitters.push(emitter) };
  tickSupportSource(source, 10, 0, hooks);
  assert.deepEqual(emitters, [ship]);
  assert.deepEqual(source.state.queuedBeamAt, [10.3, 10.6]);
  ship.silencedUntil = 100;
  updateBunnyHaruhiSupport(bunnyHaruhiSupportSource(ship, true), 10.3, 0, hooks);
  assert.equal(emitters.length, 2, "沉默不停止常驻支援");
  updateBunnyHaruhiSupport(bunnyHaruhiSupportSource(ship, false), 10.4, 0, hooks);
  assert.deepEqual(source.state.queuedBeamAt, []);
  assert.equal(source.state.suspended, true);
  assert.equal(unlockBunnyHaruhiSupport(bunnyHaruhiSupportSource(ship, false), 12, () => {
    throw new Error("封印期间不得抽取支援");
  }), null);
  updateBunnyHaruhiSupport(bunnyHaruhiSupportSource(ship, true), 100, 0, hooks);
  assert.equal(source.state.timeTravelerNextAt, 110);
  assert.equal(Object.hasOwn(source.state, "suspended"), false);
  assert.equal(emitters.length, 2, "封印恢复不补发积压或取消的光线");
  updateBunnyHaruhiSupport(source, 110, 0, hooks);
  assert.equal(emitters.length, 3);
  ship.alive = false;
  updateBunnyHaruhiSupport(source, 110.3, 0, hooks);
  assert.equal(emitters.length, 3);
  assert.deepEqual(source.state.queuedBeamAt, []);
  assert.deepEqual(team.haruhiFlagship, originalOldState);
  assert.equal(unlockBunnyHaruhiSupport(null, 0, () => 0), null);
  updateBunnyHaruhiSupport(null, 0, 0);
}

export function runHaruhiSupportSuite() {
  factoryAndUnlockCheck();
  legacySchedulingCheck();
  geometryAndCooldownCheck();
  explicitSourceCheck();
}
