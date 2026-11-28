import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MatchSimulation, DEFAULT_WORLD_SIZE, TICK_DT } from "../shared/game-core.js";
import { GAME_VERSION } from "../shared/game-version.js";
import { RULESET_VERSION } from "../shared/protocol/ruleset-version.js";
import {
  BATTLE_MODE_CAPABILITIES,
  hasLivingFleetUnits,
  resolveBattleMode,
} from "../shared/game/runtime/battle-mode.js";
import { MatchTelemetry } from "../shared/game/runtime/match-telemetry.js";
import {
  defaultFfaSpawns,
  defaultLegacySpawns,
  defaultTeamSpawns,
} from "../shared/game/runtime/match-topology.js";
import {
  MULTI_FLEET_STATE_SCHEMA,
  OUTCOME_SHAPES,
  buildVictoryFacts,
  evaluateSideEliminationOutcome,
  participantOutcomeForSeat,
  validateModeOutcome,
} from "../shared/game/rules/side-outcome.js";
import { Ship } from "../shared/game/model/ship.js";
import { Scout } from "../shared/game/model/scout.js";
import { Wingman } from "../shared/game/model/wingman.js";
import { convertBunnyCompanion } from "../shared/game/characters/bunny-haruhi/companion-runtime.js";
import { buildMultiFleetStatisticsRecord, buildServerMatchStatisticsRecord } from "../server/statistics-records.js";
import { createStatisticsStore } from "../server/statistics-store.js";
import { nextEntityId, __resetEntityIds } from "../shared/game/model/model-support.js";

const SAMPLE_LOADOUTS = [
  { main: "haruhi", sub1: "yuki", sub2: "koizumi" },
  { main: "kyon", sub1: "tsuruya", sub2: "future1096" },
  { main: "asakura", sub1: "shamisen", sub2: "haruhi" },
  { main: "yuki", sub1: "kyon", sub2: "koizumi" },
  { main: "tsuruya", sub1: "future1096", sub2: "asakura" },
  { main: "shamisen", sub1: "kyon", sub2: "yuki" },
];

function loadoutAt(index) {
  return { ...SAMPLE_LOADOUTS[index % SAMPLE_LOADOUTS.length] };
}

function buildTeamFleets(formatId, overrides = {}) {
  const spawns = defaultTeamSpawns(formatId, DEFAULT_WORLD_SIZE);
  const perSide = formatId === "2v2" ? 2 : 3;
  const fleets = [];
  for (let i = 0; i < perSide; i += 1) {
    const seat = `P${i + 1}`;
    fleets.push({
      seat,
      sideId: "side1",
      name: `蓝方_${seat}`,
      loadout: overrides[seat]?.loadout || loadoutAt(i),
      spawn: overrides[seat]?.spawn || { ...spawns.side1[i] },
    });
  }
  for (let i = 0; i < perSide; i += 1) {
    const seat = `P${perSide + i + 1}`;
    fleets.push({
      seat,
      sideId: "side2",
      name: `红方_${seat}`,
      loadout: overrides[seat]?.loadout || loadoutAt(perSide + i),
      spawn: overrides[seat]?.spawn || { ...spawns.side2[i] },
    });
  }
  return fleets;
}

function buildFfaFleets(count, overrides = {}) {
  const spawns = defaultFfaSpawns(count, DEFAULT_WORLD_SIZE);
  return Array.from({ length: count }, (_, idx) => {
    const seat = `F${idx + 1}`;
    return {
      seat,
      sideId: `solo_${idx + 1}`,
      name: `混战_${seat}`,
      loadout: overrides[seat]?.loadout || loadoutAt(idx),
      spawn: overrides[seat]?.spawn || { ...spawns[idx] },
    };
  });
}

function destroyShipByCombatDamage(targetShip, attackerShip, match) {
  let guard = 0;
  while (targetShip.alive && guard < 20) {
    targetShip.takeDamage(Math.max(targetShip.maxHp, 500), attackerShip, match, "projectile");
    guard += 1;
  }
  assert.equal(targetShip.alive, false, `舰船 ${targetShip.id} 应通过合法伤害被摧毁`);
}

function destroyFleetPrimaryShips(targetTeam, attackerShip, match) {
  for (const key of ["sub1", "sub2", "main"]) {
    const ship = targetTeam.ships[key];
    if (ship.alive) destroyShipByCombatDamage(ship, attackerShip, match);
  }
}

function destroyAllFleetUnits(targetTeam, attackerShip, match) {
  for (const ship of [...targetTeam.extraShips]) {
    if (ship.alive) destroyShipByCombatDamage(ship, attackerShip, match);
  }
  destroyFleetPrimaryShips(targetTeam, attackerShip, match);
  for (const scout of [...targetTeam.scouts]) {
    if (scout.alive) scout.takeDamage(10, attackerShip, match);
  }
  for (const wingman of [...targetTeam.wingmen]) {
    if (wingman.alive) wingman.takeDamage(wingman.maxHp + 50, attackerShip, match);
  }
}

// ===== 1. 纯阵营终局真值表与校验契约 =====
{
  const twoOnTwo = (a1, a2, b1, b2) => evaluateSideEliminationOutcome({
    elapsed: 12.5,
    fleets: [
      { seat: "P1", sideId: "side1", alive: a1 },
      { seat: "P3", sideId: "side2", alive: b1 },
      { seat: "P2", sideId: "side1", alive: a2 },
      { seat: "P4", sideId: "side2", alive: b2 },
    ],
  });

  assert.equal(twoOnTwo(true, true, true, true), null);
  assert.equal(twoOnTwo(false, true, true, false), null, "双方各有至少一名队友存活时继续");
  assert.deepEqual(
    twoOnTwo(false, true, false, false),
    { type: "win", winnerSideId: "side1", winnerSeats: ["P1", "P2"] },
    "胜方 winnerSeats 按 seatOrder 包含已淘汰队友",
  );
  assert.deepEqual(
    twoOnTwo(false, false, false, true),
    { type: "win", winnerSideId: "side2", winnerSeats: ["P3", "P4"] },
  );
  assert.deepEqual(
    twoOnTwo(false, false, false, false),
    { type: "draw", winnerSideId: null, winnerSeats: [] },
  );

  // 混战三/二/一/零存活阵营真值表
  const ffaTruth = (s1, s2, s3) => evaluateSideEliminationOutcome({
    elapsed: 30,
    fleets: [
      { seat: "F1", sideId: "solo_1", alive: s1 },
      { seat: "F2", sideId: "solo_2", alive: s2 },
      { seat: "F3", sideId: "solo_3", alive: s3 },
    ],
  });
  assert.equal(ffaTruth(true, true, true), null);
  assert.equal(ffaTruth(true, false, true), null);
  assert.deepEqual(ffaTruth(false, true, false), { type: "win", winnerSideId: "solo_2", winnerSeats: ["F2"] });
  assert.deepEqual(ffaTruth(false, false, false), { type: "draw", winnerSideId: null, winnerSeats: [] });

  // 非法输入与结果形态校验拒绝
  assert.throws(() => evaluateSideEliminationOutcome(null), TypeError);
  assert.throws(() => evaluateSideEliminationOutcome({ fleets: [] }), TypeError);
  assert.throws(() => evaluateSideEliminationOutcome({
    fleets: [{ seat: "P1", sideId: "side1", alive: true }, { seat: "P2", sideId: "side1", alive: false }],
  }), Error, "单阵营不得进入阵营终局求值");
  assert.throws(() => evaluateSideEliminationOutcome({
    fleets: [{ seat: "P1", sideId: "side1", alive: true }, { seat: "P1", sideId: "side2", alive: true }],
  }), Error, "重复席位必须拒绝");

  const sampleFleets = [
    { seat: "P1", sideId: "side1", alive: false },
    { seat: "P2", sideId: "side1", alive: true },
    { seat: "P3", sideId: "side2", alive: false },
    { seat: "P4", sideId: "side2", alive: false },
  ];
  assert.throws(() => validateModeOutcome({ type: "win", winnerSideId: "side1", winnerSeats: ["P2"] }, {
    outcomeShape: OUTCOME_SHAPES.SIDE_RESULT,
    fleets: sampleFleets,
  }), Error, "漏掉已淘汰队友的 winnerSeats 必须拒绝");
  assert.throws(() => validateModeOutcome({ type: "win", winnerSideId: "side1", winnerSeats: ["P2", "P1"] }, {
    outcomeShape: OUTCOME_SHAPES.SIDE_RESULT,
    fleets: sampleFleets,
  }), Error, "乱序 winnerSeats 必须拒绝");
  assert.throws(() => validateModeOutcome({ type: "win", winnerSideId: "unknown", winnerSeats: ["P1", "P2"] }, {
    outcomeShape: OUTCOME_SHAPES.SIDE_RESULT,
    fleets: sampleFleets,
  }), Error, "未知赢家阵营必须拒绝");
  assert.throws(() => validateModeOutcome({ type: "draw", winnerSideId: "side1", winnerSeats: [] }, {
    outcomeShape: OUTCOME_SHAPES.SIDE_RESULT,
    fleets: sampleFleets,
  }), Error, "平局附带非 null winnerSideId 必须拒绝");
  assert.throws(() => validateModeOutcome({ type: "draw", winnerSideId: null, winnerSeats: ["P1"] }, {
    outcomeShape: OUTCOME_SHAPES.SIDE_RESULT,
    fleets: sampleFleets,
  }), Error, "平局附带非空 winnerSeats 必须拒绝");
  assert.throws(() => validateModeOutcome({ type: "draw", winnerSideId: null, winnerSeats: [], reason: "   " }, {
    outcomeShape: OUTCOME_SHAPES.SIDE_RESULT,
    fleets: sampleFleets,
  }), TypeError, "空白终局原因必须拒绝");

  const withReason = validateModeOutcome({
    type: "win",
    winnerSideId: "side1",
    winnerSeats: ["P1", "P2"],
    reason: "阵营全歼",
  }, { outcomeShape: OUTCOME_SHAPES.SIDE_RESULT, fleets: sampleFleets });
  assert.equal(withReason.phase, "finished");
  assert.equal(withReason.winnerSeat, null, "阵营模式不得伪造代表席位作为 winnerSeat");
  assert.equal(withReason.endReason, "阵营全歼");
  assert.deepEqual(withReason.outcome, {
    type: "win",
    winnerSideId: "side1",
    winnerSeats: ["P1", "P2"],
    reason: "阵营全歼",
  });
  assert.equal(participantOutcomeForSeat(withReason.outcome, "P1", "side1"), "win");
  assert.equal(participantOutcomeForSeat(withReason.outcome, "P3", "side2"), "loss");
}

// ===== 2. 真实 2v2 与 3v3 阵营存活聚合与淘汰席位边界 =====
{
  const match2v2 = new MatchSimulation({
    battleMode: "team_elimination",
    formatId: "2v2",
    seed: 101,
    fleets: buildTeamFleets("2v2"),
  });
  assert.equal(match2v2.battleMode, "team_elimination");
  assert.equal(match2v2.formatId, "2v2");
  assert.equal(match2v2.phase, "running");
  assert.equal(match2v2.outcome, null);
  assert.equal(match2v2.winnerSeat, null);
  assert.equal(match2v2.teamA, null);
  assert.equal(match2v2.teamB, null);

  const p1 = match2v2.teamBySeat("P1");
  const p2 = match2v2.teamBySeat("P2");
  const p3 = match2v2.teamBySeat("P3");
  destroyAllFleetUnits(p1, p3.ships.main, match2v2);
  match2v2.update(TICK_DT);

  assert.equal(hasLivingFleetUnits(p1), false);
  assert.equal(hasLivingFleetUnits(p2), true);
  assert.equal(match2v2.phase, "running", "2v2 一名队友全灭但另一名仍活时全局必须继续");
  assert.equal(match2v2.outcome, null);
  assert.equal(match2v2.applyActionForSeat("P1", { type: "set_throttle", shipKey: "main", throttle: 2 }), false, "淘汰席位操作主舰必须被拒绝");
  assert.equal(match2v2.applyActionForSeat("P1", { type: "launch_scout", zoneId: 5 }), false, "淘汰席位发射侦察机必须被拒绝");
  assert.equal(p1.visibleEnemyIds.size, 0, "淘汰席位不得自动获得全图观众视野");

  // 消灭同阵营最后一名队友后才终局
  destroyAllFleetUnits(p2, p3.ships.main, match2v2);
  match2v2.update(TICK_DT);
  assert.equal(match2v2.phase, "finished");
  assert.equal(match2v2.winnerSeat, null, "新模式不得伪造代表席位作为赢家");
  assert.deepEqual(match2v2.outcome, {
    type: "win",
    winnerSideId: "side2",
    winnerSeats: ["P3", "P4"],
  });

  // 3v3 逐名消灭两名队友仍继续，第三名死亡才终局
  const match3v3 = new MatchSimulation({
    battleMode: "team_elimination",
    formatId: "3v3",
    seed: 102,
    fleets: buildTeamFleets("3v3"),
  });
  const s1Attacker = match3v3.teamBySeat("P1").ships.main;
  destroyAllFleetUnits(match3v3.teamBySeat("P4"), s1Attacker, match3v3);
  match3v3.update(TICK_DT);
  assert.equal(match3v3.phase, "running", "3v3 阵营仅淘汰 1 人时继续");

  destroyAllFleetUnits(match3v3.teamBySeat("P5"), s1Attacker, match3v3);
  match3v3.update(TICK_DT);
  assert.equal(match3v3.phase, "running", "3v3 阵营淘汰 2 人、第 3 人仍活时继续");

  destroyAllFleetUnits(match3v3.teamBySeat("P6"), s1Attacker, match3v3);
  match3v3.update(TICK_DT);
  assert.equal(match3v3.phase, "finished");
  assert.deepEqual(match3v3.outcome, {
    type: "win",
    winnerSideId: "side1",
    winnerSeats: ["P1", "P2", "P3"],
  });
}

// ===== 3. “所有舰机”精确资格边界（主副舰、额外舰、侦察机、僚机、伴随舰、弹体/特效） =====
{
  // 3a. 主舰死、副舰活 → 继续；仅余普通额外舰 → 继续；额外舰死 → 终局
  const mExtra = new MatchSimulation({
    battleMode: "ffa_elimination",
    seed: 201,
    fleets: buildFfaFleets(3),
  });
  const f1 = mExtra.teamBySeat("F1");
  const f2 = mExtra.teamBySeat("F2");
  const f3 = mExtra.teamBySeat("F3");
  destroyAllFleetUnits(f3, f2.ships.main, mExtra);
  destroyShipByCombatDamage(f1.ships.main, f2.ships.main, mExtra);
  mExtra.update(TICK_DT);
  assert.equal(mExtra.phase, "running", "主舰死但副舰仍活时必须继续");

  const extraShip = new Ship(f1, "aux_probe", f1.ships.sub1.x + 20, f1.ships.sub1.y, 0, {
    characterId: "kyon",
    isAuxiliary: true,
    attachToMain: false,
  });
  f1.addAuxiliaryShip(extraShip);
  destroyShipByCombatDamage(f1.ships.sub1, f2.ships.main, mExtra);
  destroyShipByCombatDamage(f1.ships.sub2, f2.ships.main, mExtra);
  mExtra.update(TICK_DT);
  assert.equal(mExtra.phase, "running", "主副舰全死但额外舰仍活时必须继续");

  destroyShipByCombatDamage(extraShip, f2.ships.main, mExtra);
  mExtra.update(TICK_DT);
  assert.equal(mExtra.phase, "finished");
  assert.deepEqual(mExtra.outcome, { type: "win", winnerSideId: "solo_2", winnerSeats: ["F2"] });

  // 3b. 主副舰全死、仅余侦察机 → 继续；自然到期后立即淘汰终局
  const mScout = new MatchSimulation({
    battleMode: "ffa_elimination",
    seed: 202,
    fleets: buildFfaFleets(3),
  });
  const sF1 = mScout.teamBySeat("F1");
  const sF2 = mScout.teamBySeat("F2");
  const sF3 = mScout.teamBySeat("F3");
  destroyAllFleetUnits(sF3, sF2.ships.main, mScout);
  const shortScout = new Scout(sF1, sF1.ships.main.x, sF1.ships.main.y, {
    zone: mScout.zoneById(5),
    life: TICK_DT * 2.5,
  });
  assert.equal(sF1.addScout(shortScout), true);
  destroyFleetPrimaryShips(sF1, sF2.ships.main, mScout);
  mScout.update(TICK_DT);
  assert.equal(shortScout.alive, true);
  assert.equal(mScout.phase, "running", "主副舰全死但仅余存活侦察机时必须继续");

  mScout.update(TICK_DT);
  assert.equal(mScout.phase, "running", "侦察机尚未到期时继续");
  mScout.update(TICK_DT);
  assert.equal(shortScout.alive, false, "侦察机自然到期后 alive 为 false");
  assert.equal(mScout.phase, "finished", "侦察机自然到期回收后立即终局");
  assert.deepEqual(mScout.outcome, { type: "win", winnerSideId: "solo_2", winnerSeats: ["F2"] });

  // 3c. 主副舰全死、仅余僚机 → 继续；被击毁后立即终局
  const mWingman = new MatchSimulation({
    battleMode: "ffa_elimination",
    seed: 203,
    fleets: buildFfaFleets(3),
  });
  const wF1 = mWingman.teamBySeat("F1");
  const wF2 = mWingman.teamBySeat("F2");
  const wF3 = mWingman.teamBySeat("F3");
  destroyAllFleetUnits(wF3, wF2.ships.main, mWingman);
  const wingman = new Wingman(wF1, wF1.ships.main.x, wF1.ships.main.y, mWingman.zoneById(5));
  assert.equal(wF1.addWingman(wingman), true);
  destroyFleetPrimaryShips(wF1, wF2.ships.main, mWingman);
  mWingman.update(TICK_DT);
  assert.equal(mWingman.phase, "running", "主副舰全死仅余僚机时必须继续");

  wingman.takeDamage(wingman.maxHp + 50, wF2.ships.main, mWingman);
  mWingman.update(TICK_DT);
  assert.equal(mWingman.phase, "finished", "最后僚机被击毁后立即终局");
  assert.deepEqual(mWingman.outcome, { type: "win", winnerSideId: "solo_2", winnerSeats: ["F2"] });

  // 3d. 仅余已发射的弹体/爆炸特效 → 不计入存活，立即终局
  const mProjOnly = new MatchSimulation({
    battleMode: "ffa_elimination",
    seed: 204,
    fleets: buildFfaFleets(3),
  });
  const pF1 = mProjOnly.teamBySeat("F1");
  const pF2 = mProjOnly.teamBySeat("F2");
  const pF3 = mProjOnly.teamBySeat("F3");
  destroyAllFleetUnits(pF3, pF2.ships.main, mProjOnly);
  mProjOnly.spawnProjectile({
    team: pF1,
    source: pF1.ships.main,
    x: pF1.ships.main.x,
    y: pF1.ships.main.y,
    vx: 120,
    vy: 0,
    damage: 10,
    color: pF1.projectileColor,
    radius: 3,
    life: 5,
    kind: "projectile",
  });
  mProjOnly.spawnBurst(pF1.ships.main.x, pF1.ships.main.y, "#fff", 10);
  destroyAllFleetUnits(pF1, pF2.ships.main, mProjOnly);
  mProjOnly.update(TICK_DT);
  assert.ok(mProjOnly.projectiles.length > 0, "飞行中的弹体仍存在");
  assert.equal(mProjOnly.phase, "finished", "弹体与表现效果不得计入舰机存活资格");
  assert.deepEqual(mProjOnly.outcome, { type: "win", winnerSideId: "solo_2", winnerSeats: ["F2"] });

  // 3e. 兔女郎伴随舰：母舰死亡时伴随舰同帧退场；临时策反给敌方时按当前归属存活，原母舰死亡后伴随舰退场并判负
  const spawnBunnyCompanion = (team) => {
    team.configureFormation(2);
    for (let turn = 0; turn < 4; turn += 1) {
      team.startCooldown("sub1", 0);
      assert.equal(team.castSubSkill("sub1"), true, "兔女郎副舰应能合法推进形态以生成伴随舰");
    }
    assert.equal(team.extraShips.length, 1, "兔女郎春日达到最终形态后应生成伴随舰");
    return team.extraShips[0];
  };
  const bunnyFleets = buildFfaFleets(3, {
    F1: { loadout: { main: "kyon", sub1: "bunny_haruhi", sub2: "yuki" } },
    F2: { loadout: { main: "tsuruya", sub1: "koizumi", sub2: "asakura" } },
    F3: { loadout: { main: "haruhi", sub1: "shamisen", sub2: "future1096" } },
  });
  const mBunnyRetire = new MatchSimulation({
    battleMode: "ffa_elimination",
    seed: 205,
    fleets: bunnyFleets,
  });
  const bF1 = mBunnyRetire.teamBySeat("F1");
  const bF2 = mBunnyRetire.teamBySeat("F2");
  const bF3 = mBunnyRetire.teamBySeat("F3");
  destroyAllFleetUnits(bF3, bF2.ships.main, mBunnyRetire);
  const retiredCompanion = spawnBunnyCompanion(bF1);
  destroyFleetPrimaryShips(bF1, bF2.ships.main, mBunnyRetire);
  mBunnyRetire.update(TICK_DT);
  assert.equal(retiredCompanion.alive, false, "母舰死亡后伴随舰在帧尾清理退场");
  assert.equal(mBunnyRetire.phase, "finished", "伴随舰随母舰死亡退场后不得阻止终局");
  assert.deepEqual(mBunnyRetire.outcome, { type: "win", winnerSideId: "solo_2", winnerSeats: ["F2"] });

  // 临时策反伴随舰场景
  const mBunnyConverted = new MatchSimulation({
    battleMode: "ffa_elimination",
    seed: 206,
    fleets: bunnyFleets,
  });
  const cF1 = mBunnyConverted.teamBySeat("F1");
  const cF2 = mBunnyConverted.teamBySeat("F2");
  const cF3 = mBunnyConverted.teamBySeat("F3");
  destroyAllFleetUnits(cF3, cF1.ships.main, mBunnyConverted);
  const companion = spawnBunnyCompanion(cF1);
  assert.equal(convertBunnyCompanion(companion, cF2, mBunnyConverted.zoneById(5)), true, "F2 应成功临时策反 F1 的伴随舰");
  destroyFleetPrimaryShips(cF2, cF1.ships.main, mBunnyConverted);
  mBunnyConverted.update(TICK_DT);
  assert.equal(companion.team, cF2);
  assert.equal(companion.alive, true);
  assert.equal(mBunnyConverted.phase, "running", "F2 主副舰全灭但仍持有存活的被策反伴随舰时继续存活");

  // 当原母舰（cF1.ships.sub1）死亡，伴随舰退场，F2 失去最后单位立即判负
  destroyShipByCombatDamage(cF1.ships.sub1, cF2.ships.main, mBunnyConverted);
  mBunnyConverted.update(TICK_DT);
  assert.equal(companion.alive, false, "原母舰死亡后被策反的伴随舰也应退场");
  assert.equal(mBunnyConverted.phase, "finished", "被策反伴随舰退场后 F2 失去最后单位立即终局");
  assert.deepEqual(mBunnyConverted.outcome, { type: "win", winnerSideId: "solo_1", winnerSeats: ["F1"] });

  // 3f. 旧模式 standard 仍维持旧 countsForVictory 语义（仅余侦察机仍判终局）
  const legacyStandard = new MatchSimulation({ mode: "pvp", seed: 207 });
  const legacyScout = new Scout(legacyStandard.teamA, 500, 500, { zone: legacyStandard.zoneById(5), life: 20 });
  assert.equal(legacyStandard.teamA.addScout(legacyScout), true);
  destroyFleetPrimaryShips(legacyStandard.teamA, legacyStandard.teamB.ships.main, legacyStandard);
  legacyStandard.update(TICK_DT);
  assert.equal(legacyScout.alive, true);
  assert.equal(legacyStandard.phase, "finished", "旧 standard 模式仍按旧舰船资格判终局，不受新模式资格影响");
  assert.equal(legacyStandard.winnerSeat, "B");
  assert.equal(legacyStandard.outcome, null);
}

// ===== 4. 混战依次剩 3/2/1/0 方与同帧全灭平局（无席位顺序偏置） =====
{
  const ffa4 = new MatchSimulation({
    battleMode: "ffa_elimination",
    seed: 301,
    fleets: buildFfaFleets(4),
  });
  const [f1, f2, f3, f4] = ["F1", "F2", "F3", "F4"].map((seat) => ffa4.teamBySeat(seat));
  destroyAllFleetUnits(f4, f1.ships.main, ffa4);
  ffa4.update(TICK_DT);
  assert.equal(ffa4.phase, "running", "混战剩 3 方继续");

  destroyAllFleetUnits(f1, f2.ships.main, ffa4);
  ffa4.update(TICK_DT);
  assert.equal(ffa4.phase, "running", "混战剩 2 方继续");

  destroyAllFleetUnits(f2, f3.ships.main, ffa4);
  ffa4.update(TICK_DT);
  assert.equal(ffa4.phase, "finished", "混战仅剩 1 方终局");
  assert.deepEqual(ffa4.outcome, { type: "win", winnerSideId: "solo_3", winnerSeats: ["F3"] });

  // 同帧全灭平局，正序和反序 seatOrder 均得到一致平局
  for (const reverseOrder of [false, true]) {
    const baseFleets = buildFfaFleets(3);
    const orderedFleets = reverseOrder ? [...baseFleets].reverse() : baseFleets;
    const drawMatch = new MatchSimulation({
      battleMode: "ffa_elimination",
      seed: 302,
      fleets: orderedFleets,
    });
    const t1 = drawMatch.teamBySeat("F1");
    const t2 = drawMatch.teamBySeat("F2");
    const t3 = drawMatch.teamBySeat("F3");
    destroyAllFleetUnits(t3, t1.ships.main, drawMatch);
    drawMatch.update(TICK_DT);
    assert.equal(drawMatch.phase, "running");

    // 同帧内令最后两方全部单位遭受致命伤害
    destroyAllFleetUnits(t1, t2.ships.main, drawMatch);
    destroyAllFleetUnits(t2, t1.ships.main, drawMatch);
    drawMatch.update(TICK_DT);
    assert.equal(drawMatch.phase, "finished");
    assert.equal(drawMatch.winnerSeat, null);
    assert.deepEqual(drawMatch.outcome, {
      type: "draw",
      winnerSideId: null,
      winnerSeats: [],
    }, `同帧全灭无论席位顺序(${reverseOrder ? "反序" : "正序"})都必须平局`);
  }
}

// ===== 5. 终局原子提交、幂等停步、外部写入拒绝与单次终局结算 =====
{
  const match = new MatchSimulation({
    battleMode: "team_elimination",
    seed: 401,
    fleets: buildTeamFleets("2v2"),
  });
  assert.throws(() => { match.phase = "finished"; }, TypeError);
  assert.throws(() => { match.winnerSeat = "P1"; }, TypeError);
  assert.throws(() => { match.outcome = { type: "win", winnerSideId: "side1", winnerSeats: ["P1", "P2"] }; }, TypeError);
  assert.throws(() => { match.endReason = "forced"; }, TypeError);

  const p1 = match.teamBySeat("P1");
  const p3 = match.teamBySeat("P3");
  const p4 = match.teamBySeat("P4");
  destroyAllFleetUnits(p3, p1.ships.main, match);
  destroyAllFleetUnits(p4, p1.ships.main, match);

  let finishedCallbacks = 0;
  let recordedFinish = false;
  const advanceAndObserve = () => {
    const prevPhase = match.phase;
    match.update(TICK_DT);
    if (prevPhase === "running" && match.phase === "finished") {
      finishedCallbacks += 1;
      recordedFinish = true;
    }
  };

  advanceAndObserve();
  assert.equal(recordedFinish, true);
  assert.equal(finishedCallbacks, 1);
  assert.equal(match.phase, "finished");
  const finalTick = match.tick;
  const finalElapsed = match.elapsed;
  const finalOutcomeJson = JSON.stringify(match.outcome);
  const finalStateJson = JSON.stringify(match.serializeState());
  const finalSummaryJson = JSON.stringify(match.statisticsSummary());

  // 终局后再次多次 update/checkVictory/serialize，时间、快照与结果纹丝不动
  for (let i = 0; i < 5; i += 1) {
    advanceAndObserve();
    match.checkVictory();
  }
  assert.equal(finishedCallbacks, 1, "终局只提交一次，不得重复触发结算回调");
  assert.equal(match.tick, finalTick, "终局后 tick 不得继续推进");
  assert.equal(match.elapsed, finalElapsed, "终局后 elapsed 不得继续推进");
  assert.equal(JSON.stringify(match.outcome), finalOutcomeJson, "终局后结果不得被覆盖");
  assert.equal(JSON.stringify(match.serializeState()), finalStateJson, "终局后重复 update/serialize 快照必须完全一致");
  assert.equal(JSON.stringify(match.statisticsSummary()), finalSummaryJson, "终局后统计摘要保持一致");

  // 即使后续胜方单位全部退场，再次 checkVictory 也绝不覆盖已提交的终局结果
  for (const ship of p1.getAllShips()) ship.retireWithoutLoss();
  for (const ship of match.teamBySeat("P2").getAllShips()) ship.retireWithoutLoss();
  match.checkVictory();
  assert.equal(JSON.stringify(match.outcome), finalOutcomeJson, "终局后胜方退场并再次 checkVictory 不得覆盖结果");
  assert.throws(() => { match.outcome.type = "draw"; }, TypeError);
  assert.throws(() => { match.outcome.winnerSeats.push("P3"); }, TypeError);
}

// ===== 6. 2v2 已淘汰队友同胜、3v3 六人完整统计、混合存储重启恢复与查询隔离、副本与私有字段隔离 =====
{
  const dataDir = await mkdtemp(join(tmpdir(), "haruhi-side-stats-"));
  let clock = Date.UTC(2026, 10, 28, 12, 0, 0);
  try {
    // 6a. 2v2 获胜阵营中 P1 已淘汰，P1/P2 均记胜利
    const match2v2 = new MatchSimulation({
      battleMode: "team_elimination",
      formatId: "2v2",
      seed: 501,
      fleets: buildTeamFleets("2v2"),
    });
    const runningState = match2v2.serializeState();
    const runningStateJson = JSON.stringify(runningState);
    assert.equal(runningState.schema, MULTI_FLEET_STATE_SCHEMA);
    assert.deepEqual(runningState.seatOrder, ["P1", "P2", "P3", "P4"]);
    assert.equal(runningState.phase, "running");
    assert.equal(runningState.outcome, null);
    assert.equal(Object.hasOwn(runningState, "winnerSeat"), false, "多舰队快照不伪造 winnerSeat");
    assert.equal(Object.hasOwn(runningState, "telemetry"), false, "多舰队快照不得包含统计计数");
    for (const [seat, expectedSide] of [["P1", "side1"], ["P2", "side1"], ["P3", "side2"], ["P4", "side2"]]) {
      assert.equal(runningState.teams[seat].seat, seat);
      assert.equal(runningState.teams[seat].sideId, expectedSide);
    }
    assert.deepEqual(JSON.parse(runningStateJson), runningState, "多舰队快照必须可 JSON 无损往返");
    assert.throws(() => { runningState.phase = "finished"; }, TypeError, "新快照读模型必须冻结");
    assert.throws(() => { runningState.teams.P1.sideId = "side2"; }, TypeError);

    // P1 先全灭，再由 P2 击溃 side2
    match2v2.recordAction("P1", "set_route");
    match2v2.recordAttack("P2", "beam", 2);
    destroyAllFleetUnits(match2v2.teamBySeat("P1"), match2v2.teamBySeat("P3").ships.main, match2v2);
    match2v2.update(TICK_DT);
    destroyAllFleetUnits(match2v2.teamBySeat("P3"), match2v2.teamBySeat("P2").ships.main, match2v2);
    destroyAllFleetUnits(match2v2.teamBySeat("P4"), match2v2.teamBySeat("P2").ships.main, match2v2);
    match2v2.update(TICK_DT);

    const summary2v2 = match2v2.statisticsSummary();
    const summary2v2Json = JSON.stringify(summary2v2);
    assert.equal(summary2v2.schema, MULTI_FLEET_STATE_SCHEMA);
    assert.equal(summary2v2.formatId, "2v2");
    assert.equal(summary2v2.battleMode, "team_elimination");
    assert.deepEqual(summary2v2.outcome, { type: "win", winnerSideId: "side1", winnerSeats: ["P1", "P2"] });
    assert.equal(summary2v2.teams.P1.hullRatio, 0, "P1 确实已淘汰");
    assert.equal(summary2v2.teams.P1.outcome, "win", "获胜阵营已淘汰队友仍记为胜利");
    assert.equal(summary2v2.teams.P2.outcome, "win");
    assert.equal(summary2v2.teams.P3.outcome, "loss");
    assert.equal(summary2v2.teams.P4.outcome, "loss");
    assert.throws(() => { summary2v2.teams.P1.outcome = "loss"; }, TypeError, "多舰队统计副本必须冻结");

    // 篡改 JSON 拷贝不影响权威与历史读模型
    const mutableCopy = JSON.parse(summary2v2Json);
    mutableCopy.outcome.winnerSideId = "side2";
    mutableCopy.teams.P1.outcome = "loss";
    assert.equal(JSON.stringify(match2v2.statisticsSummary()), summary2v2Json, "修改副本不得回写权威");
    assert.equal(JSON.stringify(runningState), runningStateJson, "历史快照不得随后续推进变化");

    // 6b. 3v3 六名参与者完整产生遥测与结算
    const match3v3 = new MatchSimulation({
      battleMode: "team_elimination",
      formatId: "3v3",
      seed: 502,
      fleets: buildTeamFleets("3v3"),
    });
    for (const seat of ["P1", "P2", "P3", "P4", "P5", "P6"]) {
      match3v3.recordAction(seat, "set_route");
    }
    destroyAllFleetUnits(match3v3.teamBySeat("P4"), match3v3.teamBySeat("P1").ships.main, match3v3);
    destroyAllFleetUnits(match3v3.teamBySeat("P5"), match3v3.teamBySeat("P2").ships.main, match3v3);
    destroyAllFleetUnits(match3v3.teamBySeat("P6"), match3v3.teamBySeat("P3").ships.main, match3v3);
    match3v3.update(TICK_DT);
    const summary3v3 = match3v3.statisticsSummary();
    assert.deepEqual(Object.keys(summary3v3.teams), ["P1", "P2", "P3", "P4", "P5", "P6"]);
    assert.deepEqual(Object.keys(summary3v3.telemetry.teams), ["P1", "P2", "P3", "P4", "P5", "P6"]);
    for (const seat of ["P1", "P2", "P3", "P4", "P5", "P6"]) {
      assert.equal(summary3v3.telemetry.teams[seat].actions.set_route, 1, `第 ${seat} 名玩家统计不得丢失`);
    }

    // 6c. 混战 4 席记录
    const matchFfa = new MatchSimulation({
      battleMode: "ffa_elimination",
      formatId: "ffa",
      seed: 503,
      fleets: buildFfaFleets(4),
    });
    destroyAllFleetUnits(matchFfa.teamBySeat("F1"), matchFfa.teamBySeat("F2").ships.main, matchFfa);
    destroyAllFleetUnits(matchFfa.teamBySeat("F3"), matchFfa.teamBySeat("F2").ships.main, matchFfa);
    destroyAllFleetUnits(matchFfa.teamBySeat("F4"), matchFfa.teamBySeat("F2").ships.main, matchFfa);
    matchFfa.update(TICK_DT);
    const summaryFfa = matchFfa.statisticsSummary();

    // 先写入一条旧 schemaVersion=1 原始日志验证历史兼容恢复
    const store = createStatisticsStore({ dataDir, currentVersion: GAME_VERSION, hashSalt: "多席测试盐", now: () => clock });
    await store.ready();
    const logPath = join(dataDir, "matches-2026-11.jsonl");
    const legacySchema1Line = {
      schemaVersion: 1,
      id: "legacy:s1:1",
      mode: "multiplayer",
      source: "server",
      verified: true,
      gameVersion: GAME_VERSION,
      buildId: "legacy-build",
      rulesetVersion: RULESET_VERSION,
      startedAt: clock - 60_000,
      finishedAt: clock,
      durationSeconds: 60,
      tick: 1800,
      winnerSeat: "A",
      participants: [
        { seat: "A", isBot: false, player: { idHash: "hash_old_a", nickname: "旧A" }, loadout: loadoutAt(0), outcome: "win" },
        { seat: "B", isBot: false, player: { idHash: "hash_old_b", nickname: "旧B" }, loadout: loadoutAt(1), outcome: "loss" },
      ],
    };
    await appendFile(logPath, `${JSON.stringify(legacySchema1Line)}\n`, "utf8");

    // 重建 store 从旧记录恢复后再追加旧 1v1 与多格式新记录
    const mixedStore = createStatisticsStore({ dataDir, currentVersion: GAME_VERSION, hashSalt: "多席测试盐", now: () => clock });
    await mixedStore.ready();
    assert.equal(mixedStore.publicLeaderboard().modes.multiplayer.matches, 1, "应完整恢复旧 schema=1 记录");

    const record2v2 = buildMultiFleetStatisticsRecord({
      id: "server:room-2v2:1",
      summary: summary2v2,
      playersBySeat: {
        P1: { id: "secret-client-p1", name: "机密昵称P1", statisticsProfile: { clientId: "secret-client-p1", nickname: "机密昵称P1", faction: "blue", locale: "zh" } },
        P2: { id: "secret-client-p2", name: "机密昵称P2", statisticsProfile: { clientId: "secret-client-p2", nickname: "机密昵称P2", faction: "blue", locale: "zh" } },
        P3: { id: "secret-client-p3", name: "机密昵称P3", statisticsProfile: { clientId: "secret-client-p3", nickname: "机密昵称P3", faction: "red", locale: "zh" } },
        P4: { id: "secret-client-p4", name: "机密昵称P4", statisticsProfile: { clientId: "secret-client-p4", nickname: "机密昵称P4", faction: "red", locale: "zh" } },
      },
      hashSalt: "多席测试盐",
      now: clock,
    });
    const saved2v2 = await mixedStore.record(record2v2, { trusted: true });
    assert.equal(saved2v2.accepted, true);
    assert.equal(saved2v2.record.schemaVersion, 3);
    assert.equal(saved2v2.record.participants.length, 4);
    assert.deepEqual(
      saved2v2.record.participants.map((p) => [p.seat, p.sideId, p.outcome]),
      [["P1", "side1", "win"], ["P2", "side1", "win"], ["P3", "side2", "loss"], ["P4", "side2", "loss"]],
    );
    assert.equal(saved2v2.record.participants[0].contribution.actions.set_route, 1);
    assert.equal(saved2v2.record.participants[1].contribution.attacks.beamHits, 2);

    // 重复记录去重
    assert.equal((await mixedStore.record(record2v2, { trusted: true })).reason, "duplicate");

    // 通过 buildServerMatchStatisticsRecord 消费 3v3 结算读模型（不持有真实 Match）
    const record3v3 = buildServerMatchStatisticsRecord({
      room: {
        id: "room-3v3",
        mode: "pvp",
        startedAt: clock - 80_000,
        seats: { P1: "u1", P2: "u2", P3: "u3", P4: "u4", P5: "u5", P6: "u6" },
        match: { statisticsSummary: () => summary3v3 },
      },
      getPlayerById: (id) => ({ id, name: `玩家_${id}`, statisticsProfile: { clientId: `cid_${id}`, nickname: `玩家_${id}`, locale: "zh" } }),
      hashSalt: "多席测试盐",
      now: clock + 1000,
    });
    const saved3v3 = await mixedStore.record(record3v3, { trusted: true });
    assert.equal(saved3v3.accepted, true);
    assert.equal(saved3v3.record.participants.length, 6, "3v3 六名参与者必须全部记录且不截断");
    assert.deepEqual(saved3v3.record.participants.map((p) => p.seat), ["P1", "P2", "P3", "P4", "P5", "P6"]);

    const recordFfa = buildMultiFleetStatisticsRecord({
      id: "server:room-ffa:1",
      summary: summaryFfa,
      playersBySeat: {
        F1: { id: "ffa-u1", name: "混战1" },
        F2: { id: "ffa-u2", name: "混战2" },
        F3: { id: "ffa-u3", name: "混战3" },
        F4: { id: "ffa-u4", name: "混战4" },
      },
      hashSalt: "多席测试盐",
      now: clock + 2000,
    });
    const savedFfa = await mixedStore.record(recordFfa, { trusted: true });
    assert.equal(savedFfa.accepted, true);
    assert.equal(savedFfa.record.participants.length, 4);

    // 拒绝异常记录，绝不静默截断
    const truncatedOldMultiplayer = {
      id: "invalid:legacy:3players",
      mode: "multiplayer",
      gameVersion: GAME_VERSION,
      winnerSeat: "A",
      durationSeconds: 50,
      participants: [
        { seat: "A", isBot: false, player: { idHash: "a" }, loadout: loadoutAt(0) },
        { seat: "B", isBot: false, player: { idHash: "b" }, loadout: loadoutAt(1) },
        { seat: "P3", isBot: false, player: { idHash: "c" }, loadout: loadoutAt(2) },
      ],
    };
    assert.equal((await mixedStore.record(truncatedOldMultiplayer, { trusted: true })).reason, "invalid", "旧 1v1 超过 2 人必须拒绝而不能截断");
    assert.equal((await mixedStore.record({ ...record2v2, id: "invalid:2v2:mode", mode: "multiplayer" }, { trusted: true })).reason, "invalid", "禁止用旧 multiplayer 名称提交多舰队记录");
    assert.equal((await mixedStore.record({ ...record2v2, id: "invalid:2v2:3p", participants: record2v2.participants.slice(0, 3) }, { trusted: true })).reason, "invalid", "2v2 人数不足必须拒绝");
    assert.equal((await mixedStore.record({
      ...record2v2,
      id: "invalid:2v2:bad-outcome",
      outcome: { type: "win", winnerSideId: "side1", winnerSeats: ["P2"] },
    }, { trusted: true })).reason, "invalid", "胜方漏席位的统计记录必须拒绝");
    assert.equal((await mixedStore.record({
      ...recordFfa,
      id: "invalid:ffa:shared-side",
      participants: recordFfa.participants.map((p, idx) => idx === 1 ? { ...p, sideId: recordFfa.participants[0].sideId } : p),
    }, { trusted: true })).reason, "invalid", "混战共享阵营必须拒绝");

    // 严格查询隔离：旧公开榜单只含旧 1v1，不混入 2v2/3v3/ffa
    const legacyBoard = mixedStore.publicLeaderboard();
    assert.equal(legacyBoard.schemaVersion, 2);
    assert.equal(legacyBoard.modes.multiplayer.matches, 1, "旧 1v1 榜单不得混入 2v2/3v3/ffa");
    assert.equal(legacyBoard.modes.solo.matches, 0);

    const board2v2 = mixedStore.formatLeaderboard({ formatId: "2v2" });
    const board3v3 = mixedStore.formatLeaderboard({ formatId: "3v3" });
    const boardFfa = mixedStore.formatLeaderboard({ formatId: "ffa" });
    assert.equal(board2v2.schemaVersion, 3);
    assert.equal(board2v2.matches, 1);
    assert.equal(board2v2.lineups.reduce((sum, r) => sum + r.games, 0), 4);
    assert.equal(board3v3.matches, 1);
    assert.equal(board3v3.lineups.reduce((sum, r) => sum + r.games, 0), 6);
    assert.equal(boardFfa.matches, 1);
    assert.equal(boardFfa.lineups.reduce((sum, r) => sum + r.games, 0), 4);
    assert.throws(() => mixedStore.formatLeaderboard({ formatId: "2v2", battleMode: "ffa_elimination" }), Error, "格式与规则口径不匹配必须拒绝");

    // 公开查询输出绝无玩家私有字段，且修改副本不影响后续查询
    const allPublicText = JSON.stringify({ legacyBoard, board2v2, board3v3, boardFfa });
    for (const secret of ["secret-client-p1", "机密昵称P1", "cid_u1", "玩家_u1", "hash_old_a", "idHash"]) {
      assert.equal(allPublicText.includes(secret), false, `公开统计不得泄露私有字段：${secret}`);
    }
    legacyBoard.modes.multiplayer.matches = 999;
    board2v2.lineups[0].winRate = -1;
    assert.equal(mixedStore.publicLeaderboard().modes.multiplayer.matches, 1);
    assert.ok(mixedStore.formatLeaderboard({ formatId: "2v2" }).lineups[0].winRate >= 0);

    // 磁盘持久化无明文 clientId，且重启恢复后旧记录与全部新格式查询完全一致
    await mixedStore.flush();
    const rawLog = await readFile(logPath, "utf8");
    assert.equal(rawLog.includes("secret-client-p1"), false, "磁盘日志不得存明文 clientId");
    assert.equal(rawLog.includes("cid_u1"), false, "磁盘日志不得存明文 clientId");

    const restarted = createStatisticsStore({ dataDir, currentVersion: GAME_VERSION, hashSalt: "多席测试盐", now: () => clock });
    await restarted.ready();
    assert.deepEqual(restarted.publicLeaderboard().modes, mixedStore.publicLeaderboard().modes);
    assert.deepEqual(restarted.formatLeaderboard({ formatId: "2v2" }).lineups, mixedStore.formatLeaderboard({ formatId: "2v2" }).lineups);
    assert.deepEqual(restarted.formatLeaderboard({ formatId: "3v3" }).lineups, mixedStore.formatLeaderboard({ formatId: "3v3" }).lineups);
    assert.deepEqual(restarted.formatLeaderboard({ formatId: "ffa" }).lineups, mixedStore.formatLeaderboard({ formatId: "ffa" }).lineups);
    assert.equal((await restarted.record(record2v2, { trusted: true })).reason, "duplicate", "重启后去重集合必须完整恢复");

    // 从重启恢复后的存储继续追加新记录，再重启仍一致
    const record2v2Second = buildMultiFleetStatisticsRecord({
      id: "server:room-2v2:2",
      summary: summary2v2,
      playersBySeat: {
        P1: { id: "secret-client-p1", name: "机密昵称P1" },
        P2: { id: "secret-client-p2", name: "机密昵称P2" },
        P3: { id: "secret-client-p3", name: "机密昵称P3" },
        P4: { id: "secret-client-p4", name: "机密昵称P4" },
      },
      hashSalt: "多席测试盐",
      now: clock + 5000,
    });
    assert.equal((await restarted.record(record2v2Second, { trusted: true })).accepted, true);
    assert.equal(restarted.formatLeaderboard({ formatId: "2v2" }).matches, 2);
    assert.equal(restarted.publicLeaderboard().modes.multiplayer.matches, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

// ===== 7. 真实多席固定种子完整推进、确定性同动作回放与非法装配拒绝 =====
{
  const runDeterministicMultiFleet = (options, scriptActions) => {
    const sim = new MatchSimulation(options);
    const trace = [JSON.stringify(sim.serializeState())];
    for (let frame = 1; frame <= 90; frame += 1) {
      const actions = scriptActions[frame] || [];
      for (const [seat, action] of actions) {
        sim.applyActionForSeat(seat, action);
      }
      sim.update(TICK_DT);
      trace.push(JSON.stringify(sim.serializeState()));
    }
    return { trace, summary: sim.statisticsSummary(), phase: sim.phase };
  };

  const actions2v2 = {
    1: [
      ["P1", { type: "set_route", shipKey: "main", endX: 900, endY: 500, throttle: 2 }],
      ["P2", { type: "split", level: 1 }],
      ["P3", { type: "set_route", shipKey: "main", endX: 500, endY: 500, throttle: 2 }],
      ["P4", { type: "launch_scout", zoneId: 5 }],
    ],
    20: [
      ["P1", { type: "launch_scout", zoneId: 5 }],
      ["P3", { type: "split", level: 1 }],
    ],
    45: [
      ["P2", { type: "cast_flagship_skill", zoneId: 5 }],
      ["P4", { type: "set_route", shipKey: "main", endX: 600, endY: 720, throttle: 1 }],
    ],
  };

  const opts2v2 = { battleMode: "team_elimination", formatId: "2v2", seed: 202607, fleets: buildTeamFleets("2v2") };
  const run1 = runDeterministicMultiFleet(opts2v2, actions2v2);
  const run2 = runDeterministicMultiFleet(opts2v2, actions2v2);
  assert.deepEqual(run1.trace, run2.trace, "相同种子与动作轨迹下 2v2 逐帧状态必须完全确定");
  assert.deepEqual(run1.summary, run2.summary, "相同种子与动作轨迹下 2v2 结算摘要必须完全确定");

  const optsFfa = { battleMode: "ffa_elimination", formatId: "ffa", seed: 202608, fleets: buildFfaFleets(3) };
  const ffaActions = {
    1: [
      ["F1", { type: "set_route", shipKey: "main", endX: 720, endY: 720, throttle: 2 }],
      ["F2", { type: "set_route", shipKey: "main", endX: 720, endY: 720, throttle: 2 }],
      ["F3", { type: "set_route", shipKey: "main", endX: 720, endY: 720, throttle: 2 }],
    ],
    15: [
      ["F1", { type: "launch_scout", zoneId: 5 }],
      ["F2", { type: "split", level: 1 }],
    ],
  };
  const ffaRun1 = runDeterministicMultiFleet(optsFfa, ffaActions);
  const ffaRun2 = runDeterministicMultiFleet(optsFfa, ffaActions);
  assert.deepEqual(ffaRun1.trace, ffaRun2.trace, "相同种子与动作轨迹下混战逐帧状态必须完全确定");
  assert.deepEqual(ffaRun1.summary, ffaRun2.summary);

  // 非法配置提前拒绝且不消耗实体 ID
  const overlappingSpawns = buildTeamFleets("2v2");
  const legacyAb = defaultLegacySpawns(DEFAULT_WORLD_SIZE);
  overlappingSpawns[0].spawn = { ...legacyAb.A };
  overlappingSpawns[1].spawn = { ...legacyAb.A };

  const invalidModeConfigs = [
    ["team_elimination 缺 fleets", { battleMode: "team_elimination" }],
    ["ffa_elimination 缺 fleets", { battleMode: "ffa_elimination" }],
    ["team_elimination 启用 AI", { battleMode: "team_elimination", aiSeats: ["P1"], fleets: buildTeamFleets("2v2") }],
    ["team_elimination mode=ai", { mode: "ai", battleMode: "team_elimination", fleets: buildTeamFleets("2v2") }],
    ["team_elimination 非对称 2v1", { battleMode: "team_elimination", fleets: buildTeamFleets("2v2").slice(0, 3) }],
    ["team_elimination 声明格式冲突", { battleMode: "team_elimination", formatId: "3v3", fleets: buildTeamFleets("2v2") }],
    ["team_elimination 重叠出生坐标", { battleMode: "team_elimination", fleets: overlappingSpawns }],
    ["ffa_elimination 人数不足 2 人", { battleMode: "ffa_elimination", fleets: buildFfaFleets(3).slice(0, 2) }],
    ["ffa_elimination 共享阵营", {
      battleMode: "ffa_elimination",
      fleets: buildFfaFleets(3).map((f, idx) => idx === 1 ? { ...f, sideId: "solo_1" } : f),
    }],
    ["standard 传入 formatId=2v2", { battleMode: "standard", formatId: "2v2" }],
  ];
  __resetEntityIds(800);
  for (const [label, badOpts] of invalidModeConfigs) {
    assert.throws(() => resolveBattleMode(badOpts), Error, `resolveBattleMode 必须拒绝：${label}`);
    assert.throws(() => new MatchSimulation(badOpts), Error, `MatchSimulation 必须拒绝：${label}`);
  }
  assert.equal(nextEntityId(), 801, "拒绝非法模式配置时不得创建部分世界或消耗实体 ID");
  assert.equal(BATTLE_MODE_CAPABILITIES.team_elimination.supportsAi, false);
  assert.deepEqual(BATTLE_MODE_CAPABILITIES.team_elimination.supportedFormats, ["2v2", "3v3"]);
  assert.deepEqual(BATTLE_MODE_CAPABILITIES.ffa_elimination.supportedFormats, ["ffa"]);
}

// ===== 8. 胜负事实单次采样追加契约、旧模式零修改与 MatchTelemetry 键序逐字节兼容 =====
{
  // 8a. standard / tutorial 仍仅凭 { aAlive, bAlive } 即可独立求值
  const standardMode = resolveBattleMode({ battleMode: "standard" });
  const tutorialMode = resolveBattleMode({ battleMode: "tutorial" });
  assert.equal(tutorialMode.rules.evaluateOutcome, standardMode.rules.evaluateOutcome);
  assert.deepEqual(standardMode.rules.evaluateOutcome({ aAlive: true, bAlive: false }), { winnerSeat: "A" });
  assert.equal(standardMode.rules.evaluateOutcome({ aAlive: true, bAlive: true }), null);

  // 8b. A/B 拓扑下 checkVictory 仅采样一次即同时产出 aAlive/bAlive 与 fleets
  const abMatch = new MatchSimulation({ mode: "pvp", seed: 901 });
  let aSampleCount = 0;
  let bSampleCount = 0;
  const origA = abMatch.teamA.hasLivingShips.bind(abMatch.teamA);
  const origB = abMatch.teamB.hasLivingShips.bind(abMatch.teamB);
  abMatch.teamA.hasLivingShips = () => {
    aSampleCount += 1;
    return origA();
  };
  abMatch.teamB.hasLivingShips = () => {
    bSampleCount += 1;
    return origB();
  };
  abMatch.checkVictory();
  assert.equal(aSampleCount, 1, "A/B 拓扑下 teamA 存活资格在单次 checkVictory 中只能采样一次");
  assert.equal(bSampleCount, 1, "A/B 拓扑下 teamB 存活资格在单次 checkVictory 中只能采样一次");

  // 8c. 核验事实对象追加契约：A/B 拓扑含 aAlive/bAlive 与冻结 fleets；非 A/B 拓扑不附带 aAlive/bAlive
  const abFacts = buildVictoryFacts({
    elapsed: 5,
    fleets: [
      { seat: "A", sideId: "side1", alive: true },
      { seat: "B", sideId: "side2", alive: false },
    ],
    legacyAb: true,
  });
  assert.deepEqual(Object.keys(abFacts), ["elapsed", "aAlive", "bAlive", "fleets"]);
  assert.equal(abFacts.aAlive, true);
  assert.equal(abFacts.bAlive, false);
  assert.equal(abFacts.aAlive, abFacts.fleets[0].alive);
  assert.equal(abFacts.bAlive, abFacts.fleets[1].alive);
  assert.equal(Object.isFrozen(abFacts), true);
  assert.equal(Object.isFrozen(abFacts.fleets), true);
  assert.equal(Object.isFrozen(abFacts.fleets[0]), true);

  const multiFacts = buildVictoryFacts({
    elapsed: 5,
    fleets: [
      { seat: "P1", sideId: "side1", alive: true },
      { seat: "P2", sideId: "side1", alive: false },
      { seat: "P3", sideId: "side2", alive: true },
      { seat: "P4", sideId: "side2", alive: true },
    ],
    legacyAb: false,
  });
  assert.deepEqual(Object.keys(multiFacts), ["elapsed", "fleets"], "非 A/B 拓扑事实不得附带 aAlive/bAlive");
  assert.equal(Object.hasOwn(multiFacts, "aAlive"), false);
  assert.equal(Object.hasOwn(multiFacts, "bAlive"), false);
  assert.equal(Object.isFrozen(multiFacts), true);
  assert.equal(Object.isFrozen(multiFacts.fleets), true);
  assert.throws(() => buildVictoryFacts({
    elapsed: 5,
    fleets: [
      { seat: "P1", sideId: "side1", alive: true },
      { seat: "P2", sideId: "side2", alive: true },
    ],
    legacyAb: true,
  }), Error, "非 A/B 拓扑不得请求附带 aAlive/bAlive");

  const abModeVerify = resolveBattleMode({ mode: "pvp" });
  assert.equal(abModeVerify.outcomeShape, OUTCOME_SHAPES.LEGACY_SEAT);
  const teamModeVerify = resolveBattleMode({ battleMode: "team_elimination", fleets: buildTeamFleets("2v2") });
  assert.equal(teamModeVerify.outcomeShape, OUTCOME_SHAPES.SIDE_RESULT);

  // 使用真实 2v2 对局验证每席在 checkVictory 中各采样一次
  const mfMatch = new MatchSimulation({
    battleMode: "team_elimination",
    seed: 902,
    fleets: buildTeamFleets("2v2"),
  });
  const mfSamples = { P1: 0, P2: 0, P3: 0, P4: 0 };
  for (const seat of Object.keys(mfSamples)) {
    const team = mfMatch.teamBySeat(seat);
    const origGetAllShips = team.getAllShips.bind(team);
    team.getAllShips = () => {
      mfSamples[seat] += 1;
      return origGetAllShips();
    };
  }
  mfMatch.checkVictory();
  assert.deepEqual(mfSamples, { P1: 1, P2: 1, P3: 1, P4: 1 }, "多舰队 checkVictory 必须按 seatOrder 每席仅采样一次");

  // 8d. MatchTelemetry 在 A/B 拓扑下序列化键与顺序逐字节不变、未知席位返回 null
  const defaultTelemetry = new MatchTelemetry();
  const explicitAbTelemetry = new MatchTelemetry(["A", "B"]);
  assert.equal(
    JSON.stringify(defaultTelemetry.serialize()),
    JSON.stringify(explicitAbTelemetry.serialize()),
    "默认与显式 A/B 的 MatchTelemetry 序列化必须逐字节一致",
  );
  assert.deepEqual(Object.keys(explicitAbTelemetry.serialize().teams), ["A", "B"]);
  assert.deepEqual(
    Object.keys(explicitAbTelemetry.serialize().teams.A),
    ["actions", "attacks", "damageDealt", "damageTaken", "shipsLost"],
  );
  assert.equal(explicitAbTelemetry.serializeSeat("C"), null);
  assert.equal(explicitAbTelemetry.serializeSeat("__proto__"), null);
  assert.equal(explicitAbTelemetry.serializeSeat("constructor"), null);

  const fourSeatTelemetry = new MatchTelemetry(["P4", "P1", "P3", "P2"]);
  fourSeatTelemetry.recordAction("P3", "split");
  fourSeatTelemetry.recordDamage("P1", "P4", 42.556, "skill");
  fourSeatTelemetry.recordAction("unknown", "split");
  const serializedFour = fourSeatTelemetry.serialize();
  assert.deepEqual(Object.keys(serializedFour.teams), ["P4", "P1", "P3", "P2"], "多席遥测必须保持 seatOrder 键序");
  assert.equal(serializedFour.teams.P3.actions.split, 1);
  assert.equal(serializedFour.teams.P1.damageDealt.skill, 42.56);
  assert.equal(serializedFour.teams.P4.damageTaken.skill, 42.56);
  assert.equal(fourSeatTelemetry.serializeSeat("A"), null, "非 A/B 拓扑下 A 为未知席位并返回 null");
}

console.log("阵营终局、多舰队投影与统计口径校验通过：聚合、资格、平局、一次提交、确定性回放与存储隔离均满足契约。");
