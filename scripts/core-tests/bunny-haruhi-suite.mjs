import assert from "node:assert/strict";
import { BUNNY_HARUHI_CONFIG as C, BUNNY_FORMS, BUNNY_STAGE_PHASES } from "../../shared/game/bunny-haruhi-config.js";
import {
  createBunnyHaruhiState, createBunnyStageExposure, nextBunnyForm, planBunnyTransform,
  clearBunnyFormWindows, purgeBunnyForm, leaveBunnyStage, resolveBunnyStageExposure,
  cleanseBunnyStageControl, bunnyStatMultiplier, bunnyDamageTakenMultiplier,
  isBunnyDamageImmune, isBunnyBroadcasting, isBunnyControlLocked, bunnyStageSpeedFactor,
  canBunnyLaunchScout, resolveBunnyThrottle, bunnySelfDrainAmount, bunnyStageHealAmount, bunnyEnergyRate,
} from "../../shared/game/bunny-haruhi.js";
import {
  deriveBunnyCompanionBase, createBunnyCompanionState, planBunnyCompanionConversion,
  advanceBunnyCompanion, createBunnyReliableState, purgeBunnyReliable, expireBunnyReliable,
  bunnyReliableRecovery,
} from "../../shared/game/bunny-haruhi-companion.js";
import { CHARACTER_DEFS, CHARACTER_ORDER, normalizeLoadout } from "../../shared/game/characters.js";
import { energyRateForThrottle } from "../../shared/game/throttle.js";

const resources = { hp: 880, maxHp: 880, energy: 0, maxEnergy: 130 };
const near = (actual, expected, message = "") => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} 应接近 ${expected} ${message}`);
const cast = (state, now = 0, tick = 0, values = {}) => planBunnyTransform(state, { ...resources, ...values }, now, tick);
const enter = (state, now, inside = true, sourceShipId = 1) => resolveBunnyStageExposure(state, {
  now, tick: Math.round(now * 30), inside, sourceShipId,
});
const advance = (state, now, flags = {}) => advanceBunnyCompanion(state, {
  now, tick: Math.round(now * 30), alive: true, ownerAlive: true,
  sameOwnerTeam: true, canAct: true, ...flags,
});

function configAndFactoryCheck() {
  function frozen(value) {
    assert.ok(Object.isFrozen(value));
    for (const child of Object.values(value)) if (child && typeof child === "object") frozen(child);
  }
  frozen(C);
  frozen(BUNNY_FORMS);
  frozen(BUNNY_STAGE_PHASES);
  assert.throws(() => { C.bless.multipliers.damage = 4; }, TypeError);
  assert.deepEqual(C.supportIds, ["time_traveler", "otherworlder", "esper"]);
  assert.equal(C.form.energyCost, 0);
  assert.equal(CHARACTER_DEFS.bunny_haruhi.stats, C.baseStats);
  assert.equal(CHARACTER_ORDER.includes("bunny_haruhi"), true);
  assert.equal(normalizeLoadout({ main: "bunny_haruhi" }).main, "bunny_haruhi");
  const a = createBunnyHaruhiState();
  const b = createBunnyHaruhiState();
  a.visitedForms.add("bless");
  a.support.supporters.add("esper");
  a.support.queuedBeamAt.push(3);
  assert.equal(b.visitedForms.size, 0);
  assert.equal(b.support.supporters.size, 0);
  assert.deepEqual(b.support.queuedBeamAt, []);
  assert.equal(b.form, "neutral");
  assert.equal(b.companionSpawned, false);
  assert.notEqual(createBunnyStageExposure(), createBunnyStageExposure());
  const first = createBunnyCompanionState(1, "A", 10);
  first.followOffset.forward = 99;
  assert.equal(createBunnyCompanionState(1, "A", 10).followOffset.forward, -28);
}

function transformSequenceCheck() {
  let state = createBunnyHaruhiState();
  const expected = ["bless", "knows", "bless", "encore", "bless", "knows", "bless", "knows", "bless", "knows"];
  let rewards = 0;
  let spawns = 0;
  expected.forEach((form, index) => {
    const before = structuredClone(state);
    assert.equal(nextBunnyForm(state), form);
    const result = cast(state, index * 30, index * 900);
    assert.deepEqual(state, before, "计算方案不能提前写回权威状态");
    assert.equal(result.ok, true);
    assert.equal(result.state.form, form);
    assert.equal(result.state.successfulCasts, index + 1);
    assert.equal(result.cooldownSeconds, 30);
    assert.equal(result.state.scoutsDisabled, true);
    rewards += Number(result.unlockSupport);
    spawns += Number(result.spawnCompanion);
    if (form === "encore") {
      assert.equal(index * 30, 90);
      assert.equal(result.state.formStartedAt, 90);
    }
    state = result.state;
  });
  assert.equal(rewards, 3);
  assert.equal(spawns, 1);
  assert.deepEqual([...state.visitedForms], ["bless", "knows", "encore"]);
  assert.equal(state.companionSpawned, true);
  assert.equal(nextBunnyForm({ ...state, form: "encore", successfulCasts: 1 }), "knows");
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => nextBunnyForm({ successfulCasts: value }), RangeError);
  }
  const fresh = createBunnyHaruhiState();
  const before = structuredClone(fresh);
  assert.deepEqual(cast(fresh, 0, 0, { hp: 132 }), { ok: false, reason: "insufficient_hp" });
  assert.deepEqual(cast(fresh, 0, 0, { hp: 0 }), { ok: false, reason: "dead" });
  assert.deepEqual(fresh, before);
  assert.ok(cast(fresh, 0, 0, { hp: 132.0001 }).hp > 0);
  const bless = cast(fresh);
  assert.equal(bless.hp, 748);
  assert.equal(bless.energy, 104);
  assert.equal(cast(fresh, 0, 0, { energy: 120 }).energy, 120);
  assert.equal(cast(fresh, 0, 0, { energy: 0, maxEnergy: 0 }).energy, 0);
  const knows = cast(bless.state, 30, 900);
  assert.equal(knows.state.immunityUntil, 34);
  assert.equal(knows.state.drainUntil, 46);
  assert.equal(knows.state.broadcastUntil, 46);
  const next = cast(knows.state, 31, 930);
  assert.equal(next.state.immunityUntil, 0);
  assert.equal(next.state.drainUntil, 0);
  assert.equal(next.state.broadcastUntil, 0);
  const encore = cast(next.state, 90, 2700, { hp: 600, energy: 5 });
  assert.equal(encore.hp, 776);
  assert.equal(encore.energy, 5);
  assert.equal(cast(next.state, 90, 2700).hp, 880);
  const cleared = clearBunnyFormWindows(knows.state);
  assert.equal(cleared.drainUntil, 0);
  assert.deepEqual(cleared.visitedForms, knows.state.visitedForms);
  assert.equal(cleared.scoutsDisabled, true);
  assert.throws(() => cast(fresh, NaN), RangeError);
  assert.throws(() => cast(fresh, 0, -1), RangeError);
  assert.throws(() => cast(fresh, 0, 0, { hp: 881 }), RangeError);
}

function multiplierAndPurgeCheck() {
  const bless = cast(createBunnyHaruhiState(), 0, 1).state;
  const knows = cast(bless, 30, 900).state;
  const stage = { ...createBunnyStageExposure(), inside: true, phase: "entranced" };
  const reliable = createBunnyReliableState(99, 30, 900);
  const queryInputs = structuredClone({ bless, knows, stage, reliable });
  const keys = ["speed", "turnRate", "accel", "range", "vision", "damage", "fireRate", "regen", "hp", "toString"];
  const blessExpected = [1.15, 1.2, 1.2, 1.1, 1.1, 1.25, 1.2, 1, 1, 1];
  const knowsExpected = [0.8, 0.8, 0.8, 0.8, 0.8, 0.7, 0.7, 1, 1, 1];
  keys.forEach((key, index) => {
    assert.equal(bunnyStatMultiplier({}, key, 30), 1);
    near(bunnyStatMultiplier({ form: bless }, key, 30), blessExpected[index]);
    near(bunnyStatMultiplier({ form: knows }, key, 30), knowsExpected[index]);
  });
  near(bunnyStatMultiplier({ form: bless }, "damage", 30) * bunnyStatMultiplier({ form: bless }, "fireRate", 30), 1.5);
  near(bunnyStatMultiplier({ form: knows }, "damage", 30) * bunnyStatMultiplier({ form: knows }, "fireRate", 30), 0.49);
  near(bunnyStatMultiplier({ form: bless, stage, reliable }, "damage", 30), 1.25 * 1.2 * 1.06);
  near(2 * bunnyStatMultiplier({ form: bless, stage }, "damage", 30), 3);
  assert.equal(bunnyStatMultiplier({ reliable }, "turnRate", 35.999), 1.2);
  assert.equal(bunnyStatMultiplier({ reliable }, "turnRate", 36), 1);
  assert.equal(bunnyStatMultiplier({ form: bless, stage, reliable, enabled: false }, "speed", 30), 1);
  assert.equal(bunnyStatMultiplier({ form: knows, enabled: false }, "speed", 30), 0.8);
  assert.equal(bunnyDamageTakenMultiplier(bless), 1.2);
  assert.equal(bunnyDamageTakenMultiplier(knows), 1);
  assert.equal(bunnyDamageTakenMultiplier(), 1);
  assert.equal(isBunnyDamageImmune(knows, 33.999), true);
  assert.equal(isBunnyDamageImmune(knows, 34), false);
  assert.equal(isBunnyDamageImmune(knows, 31, false), false);
  assert.equal(isBunnyBroadcasting(bless, 999), true);
  assert.equal(isBunnyBroadcasting(knows, 45.999), true);
  assert.equal(isBunnyBroadcasting(knows, 46), false);
  assert.equal(isBunnyBroadcasting(bless, 1, false), false);
  const purged = purgeBunnyForm(bless, 2);
  assert.equal(bunnyStatMultiplier({ form: purged }, "damage", 30), 1);
  assert.equal(bunnyDamageTakenMultiplier(purged), 1.2);
  assert.equal(isBunnyBroadcasting(purged, 30), true);
  assert.equal(purgeBunnyForm(bless, 1), bless);
  assert.equal(cast(purged, 30, 900).state.positiveSuppressed, false);
  const purgedKnows = purgeBunnyForm(knows, 901);
  assert.equal(isBunnyDamageImmune(purgedKnows, 31), false);
  assert.equal(purgedKnows.drainUntil, 46);
  assert.equal(purgedKnows.broadcastUntil, 46);
  assert.equal(purgeBunnyForm(knows, 900), knows);
  const ownBuff = purgeBunnyReliable(reliable, 901);
  assert.equal(ownBuff.suppressed, true);
  assert.equal(reliable.suppressed, false, "只涤除对应接收者");
  assert.equal(purgeBunnyReliable(reliable, 900), reliable);
  assert.equal(bunnyStatMultiplier({ reliable: ownBuff }, "damage", 31), 1);
  assert.equal(canBunnyLaunchScout(), true);
  assert.equal(canBunnyLaunchScout(purged), false);
  assert.equal(resolveBunnyThrottle(undefined, 0.7), 0.7);
  assert.equal(resolveBunnyThrottle({ form: "encore" }, 0), 1.4);
  assert.equal(resolveBunnyThrottle({ form: "encore" }, 0.7, false), 0.7);
  assert.deepEqual({ bless, knows, stage, reliable }, queryInputs, "查询与涤除方案不得写回输入状态");
}

function stageLifecycleCheck() {
  const original = createBunnyStageExposure();
  let state = enter(original, 0).state;
  assert.equal(original.inside, false);
  assert.equal(state.phase, "speechless");
  assert.equal(isBunnyControlLocked(state, 0.499), true);
  assert.equal(isBunnyControlLocked(state, 0.5), false);
  near(bunnyStageSpeedFactor(state, 0.5), 0);
  near(bunnyStageSpeedFactor(state, 1.25), 0.5);
  near(bunnyStageSpeedFactor(state, 2), 1);
  assert.equal(bunnyStageSpeedFactor(state, 0.1, false), 1);
  assert.equal(isBunnyControlLocked(state, 0.1, false), false);
  near(bunnyStatMultiplier({ stage: state }, "speed", 0) * bunnyStageSpeedFactor(state, 1.25), 0.45);
  assert.equal(bunnyStatMultiplier({ stage: state }, "fireRate", 0), 0.9);
  assert.equal(bunnyStatMultiplier({ stage: state }, "regen", 0), 0);
  assert.equal(bunnyStatMultiplier({ stage: state }, "damage", 0), 1);
  near(bunnyEnergyRate(state, 12.5, 8.2, 1.4), -13.53);
  near(bunnyEnergyRate(state, 12.5, 8.2, 0), 0);
  near(bunnyEnergyRate(state, 12.5, 8.2, 1.4, false), energyRateForThrottle(12.5, 8.2, 1.4));
  near(bunnyEnergyRate(undefined, 0, 8.2, 0), 1.2);
  const clean = cleanseBunnyStageControl(state);
  assert.equal(isBunnyControlLocked(clean, 0.1), false);
  assert.equal(clean.nextEntryControlAt, 15);
  assert.equal(enter(clean, 0.1).state.lockUntil, 0, "同次入场不重新施加已驱散控制");
  assert.equal(enter(state, 9.999).state.phase, "speechless");
  const entranced = enter(state, 10);
  assert.equal(entranced.state.phase, "entranced");
  assert.equal(entranced.healRatio, 0.15);
  assert.equal(enter(entranced.state, 10).healRatio, 0);
  assert.equal(bunnyStatMultiplier({ stage: entranced.state }, "regen", 10), 1);
  assert.equal(bunnyStatMultiplier({ stage: entranced.state }, "speed", 10), 1.2);
  const left = leaveBunnyStage(entranced.state);
  assert.equal(left.sourceShipId, null);
  assert.equal(left.enteredAt, null);
  assert.equal(left.phase, "none");
  assert.equal(left.firstEntranceHealConsumed, true);
  assert.equal(left.nextEntryControlAt, 15);
  assert.equal(isBunnyControlLocked(left, 0), false);
  state = enter(left, 14.999).state;
  assert.equal(state.lockUntil, 0);
  assert.equal(enter(state, 25).healRatio, 0, "满血首次入迷也已消耗治疗资格");
  state = enter(leaveBunnyStage(state), 15).state;
  assert.equal(state.lockUntil, 15.5);
  assert.equal(state.nextEntryControlAt, 30);
  const sourceChanged = enter(state, 16, true, 2).state;
  assert.equal(sourceChanged.enteredAt, 16);
  assert.equal(sourceChanged.firstEntranceHealConsumed, true);
  assert.equal(sourceChanged.lockUntil, 0);
  assert.deepEqual(enter(sourceChanged, 16, false).state, leaveBunnyStage(sourceChanged));
  assert.throws(() => enter(original, 0, true, null), RangeError);
}

function sustainCheck() {
  const knows = cast(cast(createBunnyHaruhiState()).state, 30, 900).state;
  const drain = (from, to, hp = 880, enabled = true, state = knows) => bunnySelfDrainAmount(state, { from, to, hp, maxHp: 880, enabled });
  near(drain(0, 50), 70.4);
  near(drain(29, 30), 0);
  near(drain(45.5, 46.5), 2.2);
  near(drain(46, 47), 0);
  near(drain(30, 46, 2), 1);
  near(drain(30, 46, 0), 0);
  near(drain(30, 46, 0.5), 0);
  near(drain(30, 46, 880, false), 0);
  near(drain(46, 60, 880, true), 0, "解除封印不补发过期自损");
  near(drain(30, 46, 880, true, clearBunnyFormWindows(knows)), 0);
  near(drain(30, 46, 880, true, purgeBunnyForm(knows, 901)), 70.4);
  let hp = 880;
  for (let i = 0; i < 510; i += 1) hp -= drain(30 + i / 30, 30 + (i + 1) / 30, hp);
  near(hp, 809.6);
  const stage = enter(createBunnyStageExposure(), 5).state;
  const heal = (from, to, value = 400, state = stage) => bunnyStageHealAmount(state, { from, to, hp: value, maxHp: 880 });
  near(heal(14.5, 15.5), 1.76);
  near(heal(5, 15), 0);
  near(heal(15, 25), 35.2);
  near(heal(15, 25, 879), 1);
  near(heal(15, 25, 880), 0);
  near(heal(15, 25, 0), 0);
  near(heal(15, 25, 400, leaveBunnyStage(stage)), 0);
  near(bunnyStageHealAmount(stage, { from: 15, to: 25, hp: 400, maxHp: 880, enabled: false }), 0);
  hp = 400;
  for (let i = 0; i < 600; i += 1) hp += heal(5 + i / 30, 5 + (i + 1) / 30, hp);
  near(hp, 435.2);
  assert.throws(() => drain(3, 2), RangeError);
}

function companionLifecycleCheck() {
  const base = deriveBunnyCompanionBase();
  const expected = {
    hp: 308, energy: 65, damage: 11.6, fireRate: 0.282, speed: 33, turnRate: 0.36,
    accel: 1.02, range: 416, vision: 103.2, energyRegen: 6.25, moveDrain: 4.1, radius: 8.96,
  };
  for (const [key, value] of Object.entries(expected)) near(base[key], value);
  assert.ok(Object.isFrozen(base));
  assert.notEqual(base, C.baseStats);
  assert.throws(() => deriveBunnyCompanionBase({}), RangeError);
  assert.throws(() => createBunnyCompanionState(1, "C", 0), RangeError);
  let state = createBunnyCompanionState(1, "A", 10);
  const before = structuredClone(state);
  assert.equal(advance(state, 29.999).triggerReliable, false);
  let step = advance(state, 30);
  assert.deepEqual(state, before);
  assert.equal(step.triggerReliable, true);
  assert.equal(step.state.nextReliableAt, 50);
  assert.equal(step.state.reliableUntil, 36);
  assert.equal(advance(step.state, 30).triggerReliable, false);
  assert.equal(advance(step.state, 36).state.reliableUntil, 0);
  for (const flags of [{ canAct: false }, { enabled: false }, { sameOwnerTeam: false }]) {
    step = advance(state, 30, flags);
    assert.equal(step.triggerReliable, false);
    assert.equal(step.state.nextReliableAt, 50);
    assert.equal(advance(step.state, 31).triggerReliable, false);
    assert.equal(advance(step.state, 50).triggerReliable, true);
  }
  step = advance(state, 100);
  assert.equal(step.triggerReliable, true);
  assert.equal(step.state.nextReliableAt, 120);
  const converted = planBunnyCompanionConversion(step.state, 101);
  assert.equal(converted.clearReliable, true);
  assert.equal(converted.clearProjectiles, true);
  state = converted.state;
  assert.equal(state.ownerShipId, 1);
  assert.equal(state.ownerSeat, "A");
  assert.equal(state.nextReliableAt, null);
  assert.equal(state.reliableUntil, 0);
  assert.equal(advance(state, 105.999).returnToOwner, false);
  step = advance(state, 106);
  assert.equal(step.returnToOwner, true);
  assert.equal(step.triggerReliable, false);
  assert.equal(step.state.nextReliableAt, 126);
  assert.equal(step.clearProjectiles, true);
  assert.equal(advance(step.state, 106).returnToOwner, false);
  assert.equal(advance(step.state, 126).triggerReliable, true);
  step = advance(state, 106, { ownerAlive: false });
  assert.equal(step.retire, true);
  assert.equal(step.returnToOwner, false, "同帧母舰死亡优先于归还");
  assert.equal(step.state.nextReliableAt, null);
  assert.equal(step.clearReliable, true);
  step = advance(state, 106, { alive: false });
  assert.equal(step.returnToOwner, false);
  assert.equal(step.retire, false, "已死亡实体不重复退场");
  assert.equal(step.clearReliable, true);
  const reliable = createBunnyReliableState(99, 30, 900);
  assert.equal(expireBunnyReliable(reliable, 35.999), reliable);
  assert.equal(expireBunnyReliable(reliable, 36), null);
  assert.equal(expireBunnyReliable(reliable, 31, false), null);
  assert.deepEqual(bunnyReliableRecovery({ hp: 400, maxHp: 880, energy: 0, maxEnergy: 130 }), { hp: 452.8, energy: 19.5 });
  assert.deepEqual(bunnyReliableRecovery({ hp: 879, maxHp: 880, energy: 129, maxEnergy: 130 }), { hp: 880, energy: 130 });
  assert.deepEqual(bunnyReliableRecovery({ hp: 0, maxHp: 880, energy: 5, maxEnergy: 130 }), { hp: 0, energy: 5 });
}

export function runBunnyHaruhiSuite() {
  const originalRandom = Math.random;
  const originalNow = Date.now;
  try {
    Math.random = () => { throw new Error("纯规则不能消费随机数"); };
    Date.now = () => { throw new Error("纯规则不能读取墙钟"); };
    configAndFactoryCheck();
    transformSequenceCheck();
    multiplierAndPurgeCheck();
    stageLifecycleCheck();
    sustainCheck();
    companionLifecycleCheck();
  } finally {
    Math.random = originalRandom;
    Date.now = originalNow;
  }
}
