import { setScenarioField } from './ship-fixture.mjs';
import { unlockSupport } from "../../shared/game/haruhi-support.js";
import assert from "node:assert/strict";
import { MatchSimulation, __resetEntityIds, TICK_DT, CHARACTER_DEFS, CHARACTER_ORDER, energyRateForThrottle } from "../../shared/game-core.js";
import { normalizeLoadout } from "../../shared/game/characters.js";
import { validateMatchAction } from "../../shared/protocol/match-actions.js";
import { createInputQueue } from "../../server/input-queue.js";
import { applyStatePatch, createStatePatch, quantizeNetworkState } from "../../shared/network-patch.js";
import {
  resolveBunnyStages, advanceBunnyRules, cleanupBunnySources, refreshBunnyVisibility,
} from "../../shared/game/bunny-haruhi-runtime.js";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} 应接近 ${b}`);
function simulation(stage = false, enabled = true, opponentMain = "kyon") {
  const sim = new MatchSimulation({
    mode: "pvp", aiSeats: [], allowExperimentalBunnyHaruhi: enabled,
    teamLoadouts: {
      A: { main: stage ? "bunny_haruhi" : "haruhi", sub1: stage ? "kyon" : "bunny_haruhi", sub2: "yuki" },
      B: { main: opponentMain, sub1: "asakura", sub2: "yuki" },
    },
  });
  for (const team of [sim.teamA, sim.teamB]) {
    team.configureFormation(2);
    sim.combatEnabled[team.seat] = false;
    team.getPlayerShips().forEach((ship, i) => {
      setScenarioField(ship, 'x', team.seat === "A" ? 200 : 1200);
      setScenarioField(ship, 'y', 300 + i * 300);
      ship.command = { x: ship.x, y: ship.y };
      setScenarioField(ship, 'throttle', 0);
    });
  }
  return sim;
}
const cast = (sim) => sim.applyActionForSeat("A", { type: "cast_sub_skill", shipKey: "sub1" });

function exposureCheck() {
  const sim = simulation(true);
  const source = sim.teamA.ships.main;
  const target = sim.teamB.ships.sub1;
  setScenarioField(target, 'x', source.x + 172);
  setScenarioField(target, 'y', source.y);
  target.command = { x: target.x, y: target.y };
  setScenarioField(target, 'hp', 300);
  setScenarioField(target, 'energy', 90);
  setScenarioField(target, 'throttle', 1);
  const hpMax = target.maxHp;
  resolveBunnyStages(sim);
  assert.equal(target.isControlLocked(), true, "中心恰好在边界时入场");
  assert.equal(target.isSilenced(), true);
  assert.equal(sim.teamB.ships.main.bunnyStageExposure, undefined);
  assert.equal(sim.applyActionForSeat("B", { type: "cast_sub_skill", shipKey: "sub1" }), false);
  sim.teamB.updateEnergy(0.1);
  near(target.energy, 90 - target.base.moveDrain * 0.1);
  setScenarioField(target, 'throttle', 0);
  sim.teamB.updateEnergy(0.1);
  near(target.energy, 90 - target.base.moveDrain * 0.1);
  sim.teamB.configureFormation(0);
  const position = { x: target.x, y: target.y };
  target.update(TICK_DT);
  assert.deepEqual({ x: target.x, y: target.y }, position, "编队跟随不能越过舞台锁");
  sim.teamB.configureFormation(2);
  assert.equal(target.clearNegativeEffects(), true);
  assert.equal(target.isControlLocked(), false);
  assert.equal(target.isSilenced(), true, "驱散控制不删除被动光环");
  resolveBunnyStages(sim);
  assert.equal(target.isControlLocked(), false, "同次成员采样不重施控制");
  sim.elapsed = 10;
  sim.tick = 300;
  advanceBunnyRules(sim);
  assert.equal(target.bunnyStageExposure.phase, "entranced");
  assert.equal(target.isSilenced(), false);
  near(target.hp, 300 + hpMax * 0.15);
  const hp = target.hp;
  advanceBunnyRules(sim);
  resolveBunnyStages(sim);
  near(target.hp, hp);
  sim.elapsed = 11;
  advanceBunnyRules(sim);
  near(target.hp, hp + hpMax * 0.004);
  sim.teamB.setRestrictions({ characters: true });
  near(target.statWithBuffs("damage", 10), 12, "目标封印不应关闭敌方光环");
  setScenarioField(target, 'x', target.x + (1));
  resolveBunnyStages(sim);
  assert.equal(target.bunnyStageExposure.inside, false);
  assert.equal(target.bunnyStageExposure.firstEntranceHealConsumed, true);
  setScenarioField(target, 'x', target.x - (1));
  resolveBunnyStages(sim);
  assert.equal(target.isControlLocked(), false, "15秒内重入不触发锁定");
  sim.elapsed = 22;
  advanceBunnyRules(sim);
  assert.equal(target.bunnyStageExposure.firstEntranceHealConsumed, true);
  setScenarioField(source, 'alive', false);
  cleanupBunnySources(sim);
  assert.equal(target.bunnyStageExposure.phase, "none");
  assert.equal(target.bunnyStageExposure.nextEntryControlAt, 15);
}

function transformCheck() {
  const sim = simulation();
  const ship = sim.teamA.ships.sub1;
  setScenarioField(ship, 'energy', 0);
  setScenarioField(ship, 'hp', 132);
  const before = JSON.stringify(sim.serializeState());
  assert.equal(cast(sim), false);
  assert.equal(JSON.stringify(sim.serializeState()), before, "失败无资源/奖励/快照副作用");
  setScenarioField(ship, 'hp', 880);
  setScenarioField(ship, 'speed', 10);
  ship.cooldown = 2;
  const oldRate = ship.effectiveFireRate();
  assert.equal(cast(sim), true, "零能量仍可施放无能耗变身");
  near(ship.hp, 748);
  near(ship.energy, 104);
  near(ship.speed, 11.5);
  near(ship.cooldown, 2 * oldRate / ship.effectiveFireRate());
  assert.equal(sim.teamA.cooldowns.sub1, 30);
  assert.equal(ship.bunnyHaruhi.support.supporters.size, 1);
  assert.equal(sim.teamA.launchScout(5, { fromShipKey: "sub1" }), false);
  assert.equal(sim.teamA.launchScout(5, { fromShipKey: "main" }), true);
  const action = { type: "cast_sub_skill", shipKey: "sub1" };
  for (const field of ["form", "hp", "successfulCasts", "supporters", "allowExperimentalBunnyHaruhi"]) {
    assert.equal(validateMatchAction({ ...action, [field]: "encore" }).ok, false);
    assert.equal(sim.applyActionForSeat("A", { ...action, [field]: "encore" }), false);
  }
  assert.equal(sim.applyActionForSeat("A", { ...action, shipKey: "main" }), false);
  assert.equal(ship.clearActiveSkillBuffs(), false, "同tick新施放保留");
  sim.tick += 1;
  assert.equal(ship.clearActiveSkillBuffs(), true);
  near(ship.statWithBuffs("damage", 10), 10);
  near(ship.damageTakenMultiplier(), 1.2);
  sim.teamA.startCooldown("sub1", 0);
  assert.equal(cast(sim), true);
  assert.equal(ship.bunnyHaruhi.form, "knows");
  const protectedHp = ship.hp;
  const partner = sim.teamA.ships.main;
  const partnerHp = partner.hp;
  sim.teamA.configureFormation(0);
  ship.takeDamage(100, sim.teamB.ships.main, sim);
  near(ship.hp, protectedHp);
  near(partner.hp, partnerHp, "免伤在分摊之前判断");
  sim.teamA.configureFormation(2);
  sim.elapsed = 16;
  sim.tick = 480;
  advanceBunnyRules(sim);
  near(ship.hp, 748 - 70.4);
  assert.equal(ship.isDamageImmune(), false);
  const expiredHp = ship.hp;
  advanceBunnyRules(sim);
  near(ship.hp, expiredHp);
  sim.teamA.startCooldown("sub1", 0);
  assert.equal(cast(sim), true);
  sim.teamA.startCooldown("sub1", 0);
  assert.equal(cast(sim), true);
  assert.equal(ship.bunnyHaruhi.form, "encore");
  assert.equal(ship.bunnyHaruhi.companionSpawnPending, undefined);
  assert.equal(ship.bunnyHaruhi.companionSpawned, true);
  assert.equal(sim.teamA.extraShips[0].id, ship.bunnyHaruhi.companionId);
  assert.equal(ship.bunnyHaruhi.support.supporters.size, 3);
  setScenarioField(ship, 'throttle', 0);
  assert.equal(ship.throttle, 1.4, "直接赋值也必须锁档");
  sim.applyActionForSeat("A", { type: "set_throttle", shipKey: "sub1", throttle: 0.4 });
  assert.equal(ship.throttle, 1.4);
  sim.applyActionForSeat("A", { type: "set_route", shipKey: "sub1", endX: 700, endY: 800, throttle: 0 });
  assert.equal(ship.throttle, 1.4);
  sim.teamA.setRestrictions({ characters: true });
  setScenarioField(ship, 'throttle', 0.4);
  assert.equal(ship.throttle, 0.4);
  sim.teamA.setRestrictions({ characters: false });
  assert.equal(ship.throttle, 1.4);
  sim.teamA.startCooldown("sub1", 0);
  assert.equal(cast(sim), true);
  assert.equal(ship.throttle, 1.4, "离开encore保留当前档位");
  setScenarioField(ship, 'throttle', 0.4);
  assert.equal(ship.throttle, 0.4);
  const snapshot = ship.serialize().bunnyHaruhi;
  assert.equal(Object.hasOwn(snapshot, "visitedForms"), false);
  assert.equal(Object.hasOwn(snapshot, "support"), false);
  assert.deepEqual(sim.serializeState().teams.A.loadout, sim.teamA.loadout);
}

function encoreMovementCheck() {
  const sim = simulation();
  const ship = sim.teamA.ships.sub1;
  sim.elapsed = 90;
  for (let i = 0; i < 4; i += 1) {
    sim.teamA.startCooldown("sub1", 0);
    assert.equal(cast(sim), true);
  }
  const sampleSpeed = (target, energy) => {
    setScenarioField(target, 'x', 200);
    setScenarioField(target, 'y', 600);
    setScenarioField(target, 'angle', 0);
    setScenarioField(target, 'speed', 0);
    target.route = null;
    target.command = { x: 900, y: 600 };
    setScenarioField(target, 'throttle', 1.4);
    setScenarioField(target, 'energy', energy);
    target.update(TICK_DT);
    return target.speed;
  };
  const fullSpeed = sampleSpeed(ship, 100);
  assert.ok(fullSpeed > 0);
  near(sampleSpeed(ship, 0), fullSpeed);
  setScenarioField(ship, 'energy', 100);
  const energyRate = energyRateForThrottle(ship.baseEnergyRegen(), ship.moveEnergyDrain(), 1.4);
  assert.ok(energyRate < 0);
  sim.teamA.updateEnergy(TICK_DT);
  near(ship.energy, 100 + energyRate * TICK_DT);
  setScenarioField(ship, 'energy', 0.001);
  sim.teamA.updateEnergy(TICK_DT);
  assert.equal(ship.energy, 0, "耗尽后能量钳到0，不停止4档移动");
  near(sampleSpeed(ship, ship.energy), fullSpeed);
  const companion = sim.teamA.extraShips[0];
  const companionSpeed = sampleSpeed(companion, 100);
  near(sampleSpeed(companion, 0), companionSpeed * 0.15);
  ship.stunUntil(91);
  assert.equal(sampleSpeed(ship, 0), 0, "激奏不免疫控制");
  ship.clearTimedEffect("stunnedUntil", false);
  sim.teamA.setRestrictions({ characters: true });
  near(sampleSpeed(ship, 0), fullSpeed * 0.15);
  sim.teamA.setRestrictions({ characters: false });
  sim.elapsed = 100 - TICK_DT;
  near(sampleSpeed(ship, 0), fullSpeed);
  const locked = ship.serialize();
  assert.equal(locked.bunnyHaruhi.lockedGear, 4);
  const effect = locked.statusEffects.find(({ id }) => id === "bunny_encore");
  assert.equal(effect.duration, 10);
  near(effect.remaining, TICK_DT);
  sim.elapsed = 100;
  near(sampleSpeed(ship, 0), fullSpeed * 0.15);
  assert.equal(ship.throttle, 1.4, "到期保留当前档位");
  assert.equal(ship.bunnyHaruhi.form, "encore", "到期不切形态或重置序列");
  assert.equal(ship.bunnyHaruhi.successfulCasts, 4);
  assert.equal(ship.serialize().bunnyHaruhi.lockedGear, null);
  assert.equal(ship.serialize().statusEffects.some(({ id }) => id === "bunny_encore"), false);
  sim.applyActionForSeat("A", { type: "set_throttle", shipKey: "sub1", throttle: 0.4 });
  assert.equal(ship.throttle, 0.4);
  sim.teamA.setRestrictions({ characters: true });
  sim.elapsed += TICK_DT;
  sim.teamA.setRestrictions({ characters: false });
  assert.equal(ship.throttle, 0.4, "封印解除不能补发已到期锁档");
}

function publicationAndBroadcastCheck() {
  assert.equal(CHARACTER_DEFS.bunny_haruhi.id, "bunny_haruhi");
  assert.equal(CHARACTER_ORDER.includes("bunny_haruhi"), true);
  assert.equal(normalizeLoadout({ sub1: "bunny_haruhi" }).sub1, "bunny_haruhi");
  assert.ok(simulation(false, false).teamA.ships.sub1.bunnyHaruhi, "公开阵容不再依赖实验开关");
  const old = new MatchSimulation({ mode: "pvp", aiSeats: [] });
  assert.equal(old.bunnyHaruhiActive, undefined);
  assert.equal(old.teamA.ships.sub1.bunnyHaruhi, undefined);
  assert.equal(Object.hasOwn(old.teamA.ships.main.serialize(), "bunnyHaruhi"), false);
  const sim = simulation();
  assert.equal(cast(sim), true);
  assert.equal(sim.teamB.visibleEnemyIds.has(sim.teamA.ships.sub1.id), true);
  assert.equal(sim.teamB.visibleEnemyIds.has(sim.teamA.ships.main.id), true);
  sim.teamA.startCooldown("sub1", 0);
  assert.equal(cast(sim), true);
  assert.equal(sim.teamB.visibleEnemyIds.has(sim.teamA.ships.sub1.id), true);
  assert.equal(sim.teamB.visibleEnemyIds.has(sim.teamA.ships.main.id), false, "knows仅广播自身");
  sim.teamA.setRestrictions({ skills: true });
  refreshBunnyVisibility(sim);
  assert.equal(sim.teamB.visibleEnemyIds.has(sim.teamA.ships.sub1.id), false);
  sim.teamA.setRestrictions({ skills: false });
  setScenarioField(sim.teamA.ships.sub1, 'alive', false);
  sim.update(0);
  assert.equal(sim.teamB.visibleEnemyIds.has(sim.teamA.ships.main.id), false);
  const stage = simulation(true);
  const main = stage.teamA.ships.main;
  const ally = stage.teamA.ships.sub1;
  setScenarioField(ally, 'x', main.x + 100);
  setScenarioField(ally, 'y', main.y);
  refreshBunnyVisibility(stage);
  assert.equal(stage.teamB.visibleEnemyIds.has(main.id), true);
  assert.equal(stage.teamB.visibleEnemyIds.has(ally.id), true);
  setScenarioField(ally, 'x', main.x + 173);
  refreshBunnyVisibility(stage);
  assert.equal(stage.teamB.visibleEnemyIds.has(ally.id), false);
  assert.equal(stage.teamA.castSubSkill("main"), false);
  assert.equal(stage.teamA.castFlagshipSkill(), false);
}

function tickOrderingCheck() {
  const sim = simulation(true);
  const source = sim.teamA.ships.main;
  const target = sim.teamB.ships.sub1;
  setScenarioField(target, 'x', source.x + 172.1);
  setScenarioField(target, 'y', source.y);
  setScenarioField(target, 'angle', Math.PI);
  target.command = { x: source.x, y: source.y };
  setScenarioField(target, 'throttle', 1);
  setScenarioField(target, 'speed', 33);
  target.cooldown = 0;
  sim.combatEnabled.B = true;
  resolveBunnyStages(sim);
  assert.equal(target.bunnyStageExposure, undefined);
  sim.update(TICK_DT);
  assert.equal(target.bunnyStageExposure.inside, true);
  assert.equal(target.isControlLocked(), true);
  assert.equal(target.speed, 0);
  assert.equal(sim.projectiles.length, 0, "移动后入场必须在开火前锁定");
  const extra = new target.constructor(sim.teamB, "extra", target.x, target.y, target.angle, {
    characterId: "kyon", isAuxiliary: true, attachToMain: false,
  });
  sim.teamB.addAuxiliaryShip(extra);
  resolveBunnyStages(sim);
  assert.equal(extra.bunnyStageExposure, undefined, "舞台不处理召唤物");
  const both = simulation(true, true, "bunny_haruhi");
  const a = both.teamA.ships.main;
  const b = both.teamB.ships.main;
  setScenarioField(b, 'x', a.x + 100);
  setScenarioField(b, 'y', a.y);
  resolveBunnyStages(both);
  both.elapsed = 10;
  both.tick = 300;
  advanceBunnyRules(both);
  near(both.teamA.bunnyStage.radius, 172);
  near(both.teamB.bunnyStage.radius, 172);
  assert.equal(a.bunnyStageExposure.phase, "entranced");
  assert.equal(b.bunnyStageExposure.phase, "entranced");
  resolveBunnyStages(both);
  near(both.teamA.bunnyStage.radius, 172 * 1.2);
  near(both.teamB.bunnyStage.radius, 172 * 1.2);
}

function supportIntegrationCheck() {
  const sim = simulation();
  const ship = sim.teamA.ships.sub1;
  unlockSupport(ship, ["time_traveler"], 0, () => 0);
  sim.elapsed = 10 - TICK_DT;
  sim.update(TICK_DT);
  assert.equal(sim.teamA.beams.length, 1);
  assert.equal(sim.teamA.beams[0].shipKey, "sub1");
  near(sim.teamA.beams[0].x1, ship.x);
  sim.teamA.setRestrictions({ skills: true });
  sim.update(TICK_DT);
  assert.deepEqual(ship.bunnyHaruhi.support.queuedBeamAt, []);
  sim.teamA.setRestrictions({ skills: false });
  sim.update(TICK_DT);
  near(ship.bunnyHaruhi.support.timeTravelerNextAt, sim.elapsed + 10);
  const ram = simulation(false, true, "koizumi");
  const attacker = ram.teamA.ships.sub1;
  const defender = ram.teamB.ships.main;
  const radius = defender.effectiveVision();
  unlockSupport(attacker, ["otherworlder"], 0, () => 0);
  setScenarioField(attacker, 'x', defender.x - radius + 1);
  setScenarioField(attacker, 'y', defender.y);
  setScenarioField(attacker, 'previousX', attacker.x - 2);
  setScenarioField(attacker, 'previousY', attacker.y);
  setScenarioField(attacker, 'angle', 0);
  setScenarioField(attacker, 'speed', 100);
  ram.resolveKoizumiBarrierRamContacts();
  assert.equal(ram.teamB.koizumiBarrier.remainingHits, 0);
  assert.equal(attacker.bunnyHaruhi.support.otherworlderReadyAt, 8);
}

function authorityCheck() {
  const original = Math.random;
  function replay(queued) {
    let seed = 48151;
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    __resetEntityIds();
    const sim = simulation(false, true, "bunny_haruhi");
    const queue = createInputQueue();
    const player = { id: "a" };
    const room = { seats: { A: "a", B: "b" }, match: sim };
    const result = [];
    let previous = quantizeNetworkState(sim.serializeState());
    for (let i = 0; i < 330; i += 1) {
      const action = i === 0 ? { type: "cast_sub_skill", shipKey: "sub1" }
        : i === 10 ? { type: "cast_sub_skill", shipKey: "sub1", form: "encore" }
        : { type: "set_throttle", shipKey: "sub1", throttle: 0 };
      if (queued) {
        queue.queueInput(player, { seq: i + 1, action });
        queue.applyQueuedInputs(room, (id) => id === "a" ? player : null);
      } else sim.applyActionForSeat("A", action);
      if (i === 20) {
        const ship = sim.teamA.ships.sub1;
        setScenarioField(ship, 'x', sim.teamB.ships.main.x - 100);
        setScenarioField(ship, 'y', sim.teamB.ships.main.y);
        ship.command = { x: ship.x, y: ship.y };
      }
      sim.update(TICK_DT);
      result.push(JSON.stringify(sim.serializeState()));
      const next = quantizeNetworkState(sim.serializeState());
      const patch = JSON.parse(JSON.stringify(createStatePatch(previous, next)));
      assert.deepEqual(applyStatePatch(previous, patch), next, "新形态与舞台摘要必须经过差量协议往返还原");
      previous = next;
    }
    return result;
  }
  try { assert.deepEqual(replay(false), replay(true)); } finally { Math.random = original; }
}

export function runBunnyHaruhiIntegrationSuite() {
  exposureCheck();
  transformCheck();
  encoreMovementCheck();
  publicationAndBroadcastCheck();
  tickOrderingCheck();
  supportIntegrationCheck();
  authorityCheck();
}
