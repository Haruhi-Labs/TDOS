import assert from "node:assert/strict";
import {
  DEFAULT_WORLD_SIZE,
  MatchSimulation,
  TICK_DT,
  __resetEntityIds,
} from "../shared/game-core.js";
import { matchActions } from "../shared/protocol/match-actions.js";
import { createSeededRng } from "../shared/game/foundation/rng.js";
import { buildZones, clamp } from "../shared/game/foundation/math.js";
import { CHARACTER_ASSEMBLY } from "../shared/game/characters/assembly/character-assembly.js";
import {
  TEAM_COLORS,
  TEAM_HUNT_COLORS,
  TEAM_PROJECTILE_COLORS,
} from "../shared/game/model/model-support.js";
import { Team } from "../shared/game/model/team.js";
import { normalizeMatchTopology, defaultLegacySpawns } from "../shared/game/runtime/match-topology.js";
import {
  BATTLE_UPDATE_PHASES,
  createFleetRegistry,
  createSeatAiRngMap,
  createSeatSwitchBoard,
  dispatchSeatAction,
  runBattleUpdatePhases,
} from "../shared/game/runtime/fleet-registry.js";
import { createActionPort } from "../shared/game/ai/bridge/action-port.js";

function sampleLoadout(index = 0) {
  const presets = [
    { main: "kyon", sub1: "asakura", sub2: "koizumi" },
    { main: "haruhi", sub1: "tsuruya", sub2: "yuki" },
    { main: "koizumi", sub1: "future1096", sub2: "asakura" },
    { main: "yuki", sub1: "kyon", sub2: "shamisen" },
    { main: "tsuruya", sub1: "haruhi", sub2: "future1096" },
    { main: "asakura", sub1: "shamisen", sub2: "kyon" },
  ];
  return { ...presets[index % presets.length] };
}

function makeFleetConfig(seat, sideId, index) {
  return {
    seat,
    sideId,
    name: `舰队_${seat}`,
    loadout: sampleLoadout(index),
    spawn: {
      x: 220 + (index % 3) * 420,
      y: 260 + Math.floor(index / 3) * 760,
      facing: (index % 2 === 0) ? 0 : Math.PI,
    },
  };
}

// 为组件夹具提供真实 Team 构造与领域操作所需的最小宿主（不引入任何生产绕过开关）。
function createTeamFixtureHost(topology, seed = 101) {
  const worldSize = DEFAULT_WORLD_SIZE;
  const zones = buildZones(worldSize);
  const rng = createSeededRng(seed);
  const recordedActions = [];
  const host = {
    worldSize,
    mapPadding: 34,
    elapsed: 0,
    tick: 0,
    zones,
    rng,
    entityIds: { value: 1 },
    rules: CHARACTER_ASSEMBLY.rules,
    shipEffects: CHARACTER_ASSEMBLY.shipEffects,
    projectShip: CHARACTER_ASSEMBLY.projectShip,
    bursts: [],
    floatingTexts: [],
    recordedActions,
    clampX(x, padding = 0) { return clamp(x, padding, worldSize - padding); },
    clampY(y, padding = 0) { return clamp(y, padding, worldSize - padding); },
    zoneById(zoneId) {
      const safeId = clamp(Number(zoneId) || 5, 1, 9);
      return zones.find((zone) => zone.id === safeId) || zones[4];
    },
    recordAction(seat, action) { recordedActions.push({ seat, action }); },
    recordAttack() {},
    recordDamage() {},
    recordShipLoss() {},
    spawnFloatingText() {},
    spawnFloatingTextKey() {},
    spawnAnnouncementKey() {},
    spawnBurst() {},
    spawnProjectile() { return null; },
    queueHeroPower() {},
  };

  const teams = topology.fleets.map((fleet) => new Team(
    host,
    fleet.seat,
    fleet.name,
    fleet.spawn.x,
    fleet.spawn.y,
    fleet.spawn.facing,
    {
      loadout: fleet.loadout,
      sideId: fleet.sideId,
      presentation: fleet.presentation,
    },
  ));
  const registry = createFleetRegistry(topology, teams);
  host.teamBySeat = (seat) => registry.teamBySeat(seat);
  host.allTeams = () => registry.allTeams();
  host.enemyTeamsOf = (seat) => registry.enemyTeamsOf(seat);
  host.alliedTeamsOf = (seat) => registry.alliedTeamsOf(seat);
  // 组件夹具仅提供空可见集桩以验证本队技能与同阵营资源隔离，多敌队 enemyTeamBySeat 拒绝在下方独立断言。
  host.enemyTeamBySeat = () => ({ visibleEnemyIds: new Set() });
  return { host, teams, registry };
}

function teamStateSnapshot(team) {
  return JSON.stringify({
    seat: team.seat,
    sideId: team.sideId,
    splitLevel: team.splitLevel,
    cooldowns: team.cooldowns,
    autoScout: team.autoScout,
    scouts: team.scouts.map((s) => ({ id: s.id, x: s.x, y: s.y, alive: s.alive })),
    ships: ["main", "sub1", "sub2"].map((key) => {
      const ship = team.ships[key];
      return {
        key,
        x: ship.x,
        y: ship.y,
        hp: ship.hp,
        energy: ship.energy,
        throttle: ship.throttle,
        route: ship.route ? { ...ship.route } : null,
      };
    }),
  });
}

// ===== 四/六席注册、精确实例查找、未知席位拒绝且无状态副作用 =====
{
  const fourTopology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", 0),
      makeFleetConfig("P2", "side1", 1),
      makeFleetConfig("P3", "side2", 2),
      makeFleetConfig("P4", "side2", 3),
    ],
  });
  const { host, teams, registry } = createTeamFixtureHost(fourTopology, 201);

  assert.equal(registry.allTeams().length, 4);
  for (let i = 0; i < teams.length; i += 1) {
    assert.equal(registry.teamBySeat(fourTopology.seatOrder[i]), teams[i]);
    assert.equal(registry.hasSeat(fourTopology.seatOrder[i]), true);
  }
  for (const invalidSeat of ["unknown", "A", "B", "__proto__", "constructor", "toString", "", null, undefined, 0]) {
    assert.equal(registry.teamBySeat(invalidSeat), null, `未知席位 ${String(invalidSeat)} 必须返回 null`);
    assert.equal(registry.hasSeat(invalidSeat), false);
  }

  const beforeSnapshots = teams.map(teamStateSnapshot);
  const probes = [
    matchActions.setRoute({ shipKey: "main", endX: 600, endY: 600, throttle: 1 }),
    matchActions.setThrottle({ shipKey: "main", throttle: 0 }),
    matchActions.split(1),
    matchActions.launchScout({ shipKey: "main", zoneId: 5 }),
    matchActions.castSubSkill({ shipKey: "sub1" }),
  ];
  for (const invalidSeat of ["unknown", "A", "B", "__proto__", "constructor", null]) {
    for (const action of probes) {
      assert.equal(dispatchSeatAction(registry, invalidSeat, action), false, "未知席位动作必须被拒绝");
    }
  }
  assert.deepEqual(teams.map(teamStateSnapshot), beforeSnapshots, "未知席位动作不得修改任何玩家状态或回落到最后一队");
  assert.equal(host.recordedActions.length, 0, "未知席位动作不得记录成功事件");

  // 六席注册表同样准确查找并保留输入顺序
  const sixTopology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", 0),
      makeFleetConfig("P2", "side1", 1),
      makeFleetConfig("P3", "side1", 2),
      makeFleetConfig("P4", "side2", 3),
      makeFleetConfig("P5", "side2", 4),
      makeFleetConfig("P6", "side2", 5),
    ],
  });
  const { teams: sixTeams, registry: sixRegistry } = createTeamFixtureHost(sixTopology, 202);
  assert.equal(sixRegistry.allTeams().length, 6);
  assert.deepEqual(sixRegistry.allTeams().map((team) => team.seat), ["P1", "P2", "P3", "P4", "P5", "P6"]);
  assert.equal(sixRegistry.teamBySeat("P6"), sixTeams[5]);
  assert.equal(sixRegistry.teamBySeat("A"), null);

  // 重复席位、缺项、未知席位、阵营错位均先失败，不发布半构造注册表
  assert.throws(() => createFleetRegistry(fourTopology, teams.slice(0, 3)), /缺少/, "缺少席位必须拒绝构造");
  assert.throws(() => createFleetRegistry(fourTopology, [...teams, teams[0]]), /重复/, "重复席位必须拒绝构造");
  assert.throws(
    () => createFleetRegistry(fourTopology, [...teams.slice(0, 3), { seat: "P9", sideId: "side2" }]),
    /未在拓扑中注册/,
    "未在拓扑声明的席位必须拒绝构造",
  );
  assert.throws(
    () => createFleetRegistry(fourTopology, [...teams.slice(0, 3), { seat: "P4", sideId: "side1" }]),
    /sideId.*不一致/,
    "sideId 与拓扑不一致必须拒绝构造",
  );
  assert.throws(() => createFleetRegistry(fourTopology, null), TypeError);

  // 真实 MatchSimulation 的未知席位寻址、动作、雷达与 AI 动作端口拒绝
  const realMatch = new MatchSimulation({ mode: "pvp", seed: 203 });
  assert.equal(realMatch.teamBySeat("unknown"), null);
  assert.equal(realMatch.teamBySeat("C"), null);
  assert.equal(realMatch.teamBySeat("__proto__"), null);
  assert.equal(realMatch.botBySeat("constructor"), null);
  assert.equal(realMatch.serializeRadarForSeat("unknown"), null);
  const realStateBefore = JSON.stringify(realMatch.serializeState());
  const realSummaryBefore = JSON.stringify(realMatch.statisticsSummary());
  for (const badSeat of ["unknown", "C", "__proto__", null, undefined]) {
    assert.equal(realMatch.applyActionForSeat(badSeat, matchActions.split(1)), false);
    assert.equal(realMatch.applyActionForSeat(badSeat, matchActions.setThrottle({ shipKey: "main", throttle: 0 })), false);
    assert.throws(() => createActionPort(realMatch, badSeat), /未知席位/, "AI 动作端口必须拒绝未知席位");
  }
  assert.equal(JSON.stringify(realMatch.serializeState()), realStateBefore, "真实对局未知席位动作不得修改 A/B 状态");
  assert.equal(JSON.stringify(realMatch.statisticsSummary()), realSummaryBefore, "真实对局未知席位动作不得写入统计");
}

// ===== 同 sideId 两支独立 Team 的资源、编队、航线、冷却严格隔离 =====
{
  const topology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", 0),
      makeFleetConfig("P2", "side1", 1),
      makeFleetConfig("P3", "side2", 2),
      makeFleetConfig("P4", "side2", 3),
    ],
  });
  const { registry } = createTeamFixtureHost(topology, 301);
  const p1 = registry.teamBySeat("P1");
  const p2 = registry.teamBySeat("P2");
  const p3 = registry.teamBySeat("P3");
  const p4 = registry.teamBySeat("P4");

  assert.equal(p1.sideId, "side1");
  assert.equal(p2.sideId, "side1");
  assert.equal(p1.ships.main.team.sideId, "side1", "实体当前阵营经 entity.team.sideId 派生");
  assert.equal(Object.hasOwn(p1.ships.main, "sideId"), false, "舰船实体不得新增可写 sideId 副本");

  const p2Before = teamStateSnapshot(p2);
  const p3Before = teamStateSnapshot(p3);
  const p4Before = teamStateSnapshot(p4);
  const p1EnergyBefore = p1.availableEnergyForShip("main");

  assert.equal(dispatchSeatAction(registry, "P1", matchActions.setRoute({ shipKey: "main", endX: 480, endY: 510, throttle: 1.4 })), true);
  assert.equal(dispatchSeatAction(registry, "P1", matchActions.split(1)), true);
  assert.equal(dispatchSeatAction(registry, "P1", matchActions.launchScout({ shipKey: "main", zoneId: 5 })), true);
  assert.equal(dispatchSeatAction(registry, "P1", matchActions.castSubSkill({ shipKey: "sub1" })), true);

  assert.ok(p1.ships.main.route !== null, "P1 主舰航线应生效");
  assert.equal(p1.splitLevel, 1, "P1 分离等级应变化");
  assert.equal(p1.scouts.length, 1, "P1 应放出侦察机");
  assert.ok(p1.cooldowns.scout > 0, "P1 侦察机冷却应启动");
  assert.ok(p1.cooldowns.sub1 > 0, "P1 副舰技能冷却应启动");
  assert.ok(p1.availableEnergyForShip("main") < p1EnergyBefore, "P1 能量应独立扣减");

  assert.equal(teamStateSnapshot(p2), p2Before, "同 sideId 的 P2 航线、分离、能量、冷却和侦察机不得受 P1 操作影响");
  assert.equal(teamStateSnapshot(p3), p3Before, "敌方 P3 状态不得受 P1 操作影响");
  assert.equal(teamStateSnapshot(p4), p4Before, "敌方 P4 状态不得受 P1 操作影响");
}

// ===== 容器只读、sideId/颜色只读、历史开关视图隔离 =====
{
  const topology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", 0),
      makeFleetConfig("P2", "side1", 1),
      makeFleetConfig("P3", "side2", 2),
      makeFleetConfig("P4", "side2", 3),
    ],
  });
  const { registry } = createTeamFixtureHost(topology, 401);
  const p1 = registry.teamBySeat("P1");

  assert.throws(() => { registry.allTeams().push(p1); }, TypeError);
  assert.throws(() => { registry.allTeams()[0] = null; }, TypeError);
  assert.throws(() => { registry.alliedTeamsOf("P1").push(p1); }, TypeError);
  assert.throws(() => { registry.enemyTeamsOf("P1").push(p1); }, TypeError);
  assert.throws(() => { registry.hostilePairs().push([]); }, TypeError);
  assert.throws(() => { registry.hostilePairs()[0][0] = null; }, TypeError);
  assert.throws(() => { registry.hostileUnorderedPairs().push([]); }, TypeError);
  assert.throws(() => { registry.hostileUnorderedPairs()[0][0] = null; }, TypeError);
  assert.throws(() => { registry.seatOrder.push("X"); }, TypeError);
  assert.throws(() => { registry.teamBySeat = () => null; }, TypeError);

  assert.throws(() => { p1.sideId = "side2"; }, TypeError);
  assert.throws(() => { p1.seat = "P2"; }, TypeError);
  assert.throws(() => { p1.color = "#000000"; }, TypeError);
  assert.throws(() => { p1.projectileColor = "#000000"; }, TypeError);
  assert.throws(() => { p1.huntColor = "#000000"; }, TypeError);

  const switches = createSeatSwitchBoard(topology.seatOrder, true);
  const history0 = switches.snapshot;
  assert.throws(() => { history0.P1 = false; }, TypeError);
  assert.equal(switches.set("P2", false), true);
  const history1 = switches.snapshot;
  assert.deepEqual(history0, { P1: true, P2: true, P3: true, P4: true }, "历史开关视图不得跟随未来写入变化");
  assert.deepEqual(history1, { P1: true, P2: false, P3: true, P4: true });
  assert.equal(switches.set("P2", false), false, "重复设置相同值不得重建视图");
  assert.equal(switches.snapshot, history1);
  for (const invalidSeat of ["A", "B", "unknown", "__proto__", null]) {
    assert.equal(switches.set(invalidSeat, false), false);
    assert.equal(switches.isEnabled(invalidSeat), false);
  }
  assert.equal(switches.snapshot, history1, "未知席位设置不得修改开关视图");

  // 真实对局兼容 getter 只读
  const realMatch = new MatchSimulation({ mode: "pvp", seed: 402 });
  assert.throws(() => { realMatch.teamA = realMatch.teamB; }, TypeError);
  assert.throws(() => { realMatch.teamB = realMatch.teamA; }, TypeError);
}

// ===== 固定阶段按注册顺序完成全部舰队，不逐队跑整帧、不重复推进 =====
{
  // 使用故意交错的 4 席顺序，验证严格按 seatOrder 推进
  const customOrder = ["P4", "P1", "P3", "P2"];
  const topology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P4", "side2", 0),
      makeFleetConfig("P1", "side1", 1),
      makeFleetConfig("P3", "side2", 2),
      makeFleetConfig("P2", "side1", 3),
    ],
  });
  const fixtures = topology.fleets.map((fleet) => Object.freeze({ seat: fleet.seat, sideId: fleet.sideId }));
  const registry = createFleetRegistry(topology, fixtures);
  const aiSwitches = createSeatSwitchBoard(registry.seatOrder, true);
  const combatSwitches = createSeatSwitchBoard(registry.seatOrder, true);

  const trace = [];
  runBattleUpdatePhases({
    allTeams: () => registry.allTeams(),
    beforeAi: () => trace.push("beforeAi"),
    isAiEnabled: (seat) => aiSwitches.isEnabled(seat),
    runAi: (seat) => trace.push(`ai:${seat}`),
    updateTeam: (team) => trace.push(`teamUpdate:${team.seat}`),
    afterTeams: () => trace.push("afterTeams"),
    resolveShipCollisions: () => trace.push("hullCollisions"),
    afterHull: () => trace.push("afterHull"),
    resolveScoutClashes: () => trace.push("scoutClashes"),
    beforeVisibility: () => trace.push("beforeVisibility"),
    computeVisibility: (team) => trace.push(`visibility:${team.seat}`),
    beforeBeams: () => trace.push("beforeBeams"),
    resolveChargedBeams: (team) => trace.push(`chargedBeams:${team.seat}`),
    isCombatEnabled: (seat) => combatSwitches.isEnabled(seat),
    stepCombat: (team) => trace.push(`combat:${team.seat}`),
    updateProjectiles: () => trace.push("projectiles"),
    updateVisualEffects: () => trace.push("visualEffects"),
    afterVisuals: () => trace.push("afterVisuals"),
    checkVictory: () => trace.push("checkVictory"),
  }, TICK_DT);

  const expectedTrace = [
    "beforeAi",
    ...customOrder.map((seat) => `ai:${seat}`),
    ...customOrder.map((seat) => `teamUpdate:${seat}`),
    "afterTeams",
    "hullCollisions",
    "afterHull",
    "scoutClashes",
    "beforeVisibility",
    ...customOrder.map((seat) => `visibility:${seat}`),
    "beforeBeams",
    ...customOrder.map((seat) => `chargedBeams:${seat}`),
    ...customOrder.map((seat) => `combat:${seat}`),
    "projectiles",
    "visualEffects",
    "afterVisuals",
    "checkVictory",
  ];
  assert.deepEqual(trace, expectedTrace, "每阶段必须按 seatOrder 跑完所有注册舰队再进入下一阶段");
  assert.equal(BATTLE_UPDATE_PHASES.length, 16);

  // 真实 MatchSimulation 的帧内阶段顺序比对
  const realMatch = new MatchSimulation({ mode: "ai", aiSeats: ["A", "B"], seed: 501 });
  const realTrace = [];
  for (const seat of ["A", "B"]) {
    const origRunner = realMatch.aiRunners[seat];
    realMatch.aiRunners[seat] = {
      update(dt, elapsed) {
        realTrace.push(`ai:${seat}`);
        return origRunner.update(dt, elapsed);
      },
    };
    const team = realMatch.teamBySeat(seat);
    for (const [method, label] of [
      ["update", "teamUpdate"],
      ["computeVisibility", "visibility"],
      ["resolveChargedBeams", "chargedBeams"],
      ["stepCombat", "combat"],
    ]) {
      const orig = team[method].bind(team);
      team[method] = (...args) => {
        realTrace.push(`${label}:${seat}`);
        return orig(...args);
      };
    }
  }
  for (const [method, label] of [
    ["resolveShipCollisions", "hullCollisions"],
    ["resolveScoutClashes", "scoutClashes"],
    ["updateProjectiles", "projectiles"],
    ["updateVisualEffects", "visualEffects"],
    ["checkVictory", "checkVictory"],
  ]) {
    const orig = realMatch[method].bind(realMatch);
    realMatch[method] = (...args) => {
      realTrace.push(label);
      return orig(...args);
    };
  }
  realMatch.update(TICK_DT);
  assert.deepEqual(realTrace, [
    "ai:A",
    "ai:B",
    "teamUpdate:A",
    "teamUpdate:B",
    "hullCollisions",
    "scoutClashes",
    "visibility:A",
    "visibility:B",
    "chargedBeams:A",
    "chargedBeams:B",
    "combat:A",
    "combat:B",
    "projectiles",
    "visualEffects",
    "checkVictory",
  ], "真实 MatchSimulation 的阶段调用轨迹必须严格匹配原帧序");
}

// ===== 前席修改后席开关当帧即时生效，时钟每帧仅推进一次 =====
{
  const topology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", 0),
      makeFleetConfig("P2", "side1", 1),
      makeFleetConfig("P3", "side2", 2),
      makeFleetConfig("P4", "side2", 3),
    ],
  });
  const registry = createFleetRegistry(
    topology,
    topology.fleets.map((fleet) => Object.freeze({ seat: fleet.seat, sideId: fleet.sideId })),
  );
  const aiSwitches = createSeatSwitchBoard(registry.seatOrder, true);
  const combatSwitches = createSeatSwitchBoard(registry.seatOrder, true);
  const calls = [];
  let allowP3Ai = false;
  let allowP4Combat = false;
  let clockTicks = 0;

  function stepFixtureFrame() {
    clockTicks += 1;
    runBattleUpdatePhases({
      allTeams: () => registry.allTeams(),
      isAiEnabled: (seat) => aiSwitches.isEnabled(seat),
      runAi: (seat) => {
        calls.push(`ai:${seat}`);
        if (seat === "P1") aiSwitches.set("P3", allowP3Ai);
      },
      updateTeam: () => {},
      computeVisibility: () => {},
      resolveChargedBeams: () => {},
      isCombatEnabled: (seat) => combatSwitches.isEnabled(seat),
      stepCombat: (team) => {
        calls.push(`combat:${team.seat}`);
        if (team.seat === "P2") combatSwitches.set("P4", allowP4Combat);
      },
    }, TICK_DT);
  }

  stepFixtureFrame();
  assert.equal(clockTicks, 1);
  assert.deepEqual(
    calls,
    ["ai:P1", "ai:P2", "ai:P4", "combat:P1", "combat:P2", "combat:P3"],
    "前席在当帧关闭后席 AI 与常规战斗后，后席同帧必须遵从新值",
  );

  calls.length = 0;
  allowP3Ai = true;
  allowP4Combat = true;
  stepFixtureFrame();
  assert.equal(clockTicks, 2);
  assert.deepEqual(
    calls,
    ["ai:P1", "ai:P2", "ai:P3", "ai:P4", "combat:P1", "combat:P2", "combat:P3", "combat:P4"],
    "前席在当帧恢复后席开关后，后席同帧必须恢复执行",
  );

  // 真实 MatchSimulation 验证时钟只推进一次且后席同帧遵从新值
  const realMatch = new MatchSimulation({ mode: "ai", aiSeats: ["A", "B"], seed: 505 });
  const realCalls = [];
  realMatch.aiRunners = {
    A: { update() { realCalls.push("ai:A"); realMatch.setAiEnabled("B", false); } },
    B: { update() { realCalls.push("ai:B"); } },
  };
  realMatch.teamA.stepCombat = () => { realCalls.push("combat:A"); realMatch.setCombatEnabled("B", false); };
  realMatch.teamB.stepCombat = () => { realCalls.push("combat:B"); };
  const tickBefore = realMatch.tick;
  const elapsedBefore = realMatch.elapsed;
  realMatch.update(TICK_DT);
  assert.deepEqual(realCalls, ["ai:A", "combat:A"]);
  assert.equal(realMatch.tick, tickBefore + 1, "单次 update 时钟只能推进 1 tick");
  assert.equal(realMatch.elapsed, elapsedBefore + TICK_DT, "单次 update 推进时长必须精确等于 1 个 TICK_DT");
}

// ===== 默认 1v1 / 单人 / 教程迁移等价性与兼容别名 =====
{
  const spawns = defaultLegacySpawns(DEFAULT_WORLD_SIZE);
  const loadouts = {
    A: { main: "kyon", sub1: "asakura", sub2: "koizumi" },
    B: { main: "haruhi", sub1: "tsuruya", sub2: "yuki" },
  };
  const actionsByTick = new Map([
    [1, [
      ["A", matchActions.setRoute({ shipKey: "main", endX: 480, endY: 560, throttle: 1 })],
      ["B", matchActions.setRoute({ shipKey: "main", endX: 1020, endY: 880, throttle: 1 })],
    ]],
    [4, [["A", matchActions.split(1)], ["B", matchActions.split(1)]]],
    [8, [["A", matchActions.launchScout({ shipKey: "main", zoneId: 5 })], ["B", matchActions.launchScout({ shipKey: "main", zoneId: 5 })]]],
    [15, [["A", matchActions.castSubSkill({ shipKey: "sub2" })], ["B", matchActions.castFlagshipSkill()]]],
  ]);

  __resetEntityIds();
  const legacyPvp = new MatchSimulation({
    mode: "pvp",
    seed: 601,
    teamNames: { A: "玩家A舰队", B: "玩家B舰队" },
    teamLoadouts: loadouts,
  });
  __resetEntityIds();
  const explicitPvp = new MatchSimulation({
    mode: "pvp",
    seed: 601,
    fleets: [
      { seat: "A", sideId: "side1", name: "玩家A舰队", loadout: loadouts.A, spawn: spawns.A },
      { seat: "B", sideId: "side2", name: "玩家B舰队", loadout: loadouts.B, spawn: spawns.B },
    ],
  });

  // 精确兼容别名断言
  assert.equal(legacyPvp.teamA, legacyPvp.teamBySeat("A"));
  assert.equal(legacyPvp.teamB, legacyPvp.teamBySeat("B"));
  assert.deepEqual(legacyPvp.allTeams(), [legacyPvp.teamA, legacyPvp.teamB]);
  assert.equal(legacyPvp.botA, null);
  assert.equal(legacyPvp.bot, null);
  assert.equal(legacyPvp.enemyTeamBySeat("A"), legacyPvp.teamB);
  assert.equal(legacyPvp.enemyTeamBySeat("B"), legacyPvp.teamA);

  // 快照不因 Team 新增 sideId / huntColor 而追加未知字段
  const teamSnapA = legacyPvp.teamA.serialize();
  assert.equal(Object.hasOwn(teamSnapA, "sideId"), false, "旧 A/B 快照不得追加 sideId 字段");
  assert.equal(Object.hasOwn(teamSnapA, "huntColor"), false, "旧 A/B 快照不得追加 huntColor 字段");

  for (let tick = 0; tick < 60; tick += 1) {
    for (const [seat, action] of actionsByTick.get(tick) || []) {
      assert.equal(legacyPvp.applyActionForSeat(seat, action), explicitPvp.applyActionForSeat(seat, action));
    }
    legacyPvp.update(TICK_DT);
    explicitPvp.update(TICK_DT);
    assert.equal(
      JSON.stringify(legacyPvp.serializeState()),
      JSON.stringify(explicitPvp.serializeState()),
      `1v1 第 ${tick + 1} 帧状态必须逐字节一致`,
    );
  }
  assert.deepEqual(legacyPvp.statisticsSummary(), explicitPvp.statisticsSummary());

  // 单人 AI 复现与兼容别名
  const solo1 = new MatchSimulation({ mode: "ai", seed: 602 });
  const solo2 = new MatchSimulation({ mode: "ai", seed: 602 });
  assert.equal(solo1.botA, null);
  assert.equal(solo1.bot, solo1.bots.B);
  assert.equal(solo1.botBySeat("B"), solo1.bot);
  for (let tick = 0; tick < 45; tick += 1) {
    solo1.update(TICK_DT);
    solo2.update(TICK_DT);
    assert.equal(JSON.stringify(solo1.serializeState()), JSON.stringify(solo2.serializeState()));
  }

  // 教程模式显式 A/B 初始化与推进保持一致
  const tutorial1 = new MatchSimulation({ mode: "ai", tutorialMode: true, seed: 603 });
  const tutorial2 = new MatchSimulation({ mode: "ai", tutorialMode: true, seed: 603 });
  assert.deepEqual(tutorial1.combatEnabled, { A: false, B: false });
  assert.deepEqual(tutorial1.aiEnabled, { A: true, B: false });
  assert.equal(tutorial1.teamA.damageFloorRatio, 0.25);
  assert.equal(tutorial1.teamB.forceCharacterSkillsDisabled, true);
  for (let tick = 0; tick < 30; tick += 1) {
    tutorial1.update(TICK_DT);
    tutorial2.update(TICK_DT);
    assert.equal(JSON.stringify(tutorial1.serializeState()), JSON.stringify(tutorial2.serializeState()));
  }
}

// ===== 真实多席开局拒绝 & 多敌队/未知席位调用旧单敌队接口明确拒绝 =====
{
  const fourSeatConfig = {
    fleets: [
      makeFleetConfig("P1", "side1", 0),
      makeFleetConfig("P2", "side1", 1),
      makeFleetConfig("P3", "side2", 2),
      makeFleetConfig("P4", "side2", 3),
    ],
  };
  const sixSeatConfig = {
    fleets: [
      makeFleetConfig("P1", "side1", 0),
      makeFleetConfig("P2", "side1", 1),
      makeFleetConfig("P3", "side1", 2),
      makeFleetConfig("P4", "side2", 3),
      makeFleetConfig("P5", "side2", 4),
      makeFleetConfig("P6", "side2", 5),
    ],
  };
  const threeFfaConfig = {
    fleets: [
      makeFleetConfig("alpha", "f1", 0),
      makeFleetConfig("beta", "f2", 1),
      makeFleetConfig("gamma", "f3", 2),
    ],
  };
  const twoCustomConfig = {
    fleets: [
      makeFleetConfig("P1", "side1", 0),
      makeFleetConfig("P2", "side2", 1),
    ],
  };

  for (const config of [fourSeatConfig, sixSeatConfig, threeFfaConfig, twoCustomConfig]) {
    assert.throws(() => new MatchSimulation(config), /仅支持 A\/B/, "未完成的多席或非 A/B 真实对局必须明确拒绝");
  }

  // 多敌方调用旧单敌队接口必须明确拒绝，不静默返回第一项
  const fourTopology = normalizeMatchTopology(fourSeatConfig);
  const fourRegistry = createFleetRegistry(
    fourTopology,
    fourTopology.fleets.map((f) => Object.freeze({ seat: f.seat, sideId: f.sideId })),
  );
  for (const seat of fourTopology.seatOrder) {
    assert.throws(() => fourRegistry.enemyTeamBySeat(seat), /enemyTeamBySeat/, "四席两方调用 enemyTeamBySeat 必须拒绝");
  }

  const ffaTopology = normalizeMatchTopology(threeFfaConfig);
  const ffaRegistry = createFleetRegistry(
    ffaTopology,
    ffaTopology.fleets.map((f) => Object.freeze({ seat: f.seat, sideId: f.sideId })),
  );
  for (const seat of ffaTopology.seatOrder) {
    assert.throws(() => ffaRegistry.enemyTeamBySeat(seat), /enemyTeamBySeat/, "三席混战调用 enemyTeamBySeat 必须拒绝");
  }

  // 即使 2v1 中 P1 只有一个敌队，总舰队数为 3 也必须拒绝双舰队兼容入口
  const asymmetricTopology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", 0),
      makeFleetConfig("P2", "side1", 1),
      makeFleetConfig("P3", "side2", 2),
    ],
  });
  const asymmetricRegistry = createFleetRegistry(
    asymmetricTopology,
    asymmetricTopology.fleets.map((f) => Object.freeze({ seat: f.seat, sideId: f.sideId })),
  );
  assert.throws(() => asymmetricRegistry.enemyTeamBySeat("P1"), /enemyTeamBySeat/);
  assert.throws(() => asymmetricRegistry.enemyTeamBySeat("P3"), /enemyTeamBySeat/);

  // 真实 A/B 对局对未知席位调用 enemyTeamBySeat 也必须拒绝（不再回落 teamA）
  const realMatch = new MatchSimulation({ mode: "pvp", seed: 701 });
  for (const badSeat of ["C", "unknown", "__proto__", null, undefined]) {
    assert.throws(() => realMatch.enemyTeamBySeat(badSeat), /未知席位/);
  }
}

// ===== 两席（A/B）、四席两方、三席混战配对/开关/颜色/随机流全面核对 =====
{
  function verifyTopologyContract(label, topology, expectedPairs, expectedUnorderedPairs) {
    const { teams, registry } = createTeamFixtureHost(topology, 801);

    // allTeams 顺序精确一致
    assert.deepEqual(registry.allTeams().map((t) => t.seat), topology.seatOrder, `${label}: allTeams 顺序`);

    // hostilePairs 与 hostileUnorderedPairs 精确无漏无重
    const actualPairs = registry.hostilePairs().map(([l, r]) => [l.seat, r.seat]);
    const actualUnordered = registry.hostileUnorderedPairs().map(([l, r]) => [l.seat, r.seat]);
    assert.deepEqual(actualPairs, expectedPairs, `${label}: hostilePairs 必须精确匹配`);
    assert.deepEqual(actualUnordered, expectedUnorderedPairs, `${label}: hostileUnorderedPairs 必须精确匹配`);

    // alliedTeamsOf 与 enemyTeamsOf 不含自身且与关系层一致
    for (const seat of topology.seatOrder) {
      const allies = registry.alliedTeamsOf(seat).map((t) => t.seat);
      const enemies = registry.enemyTeamsOf(seat).map((t) => t.seat);
      assert.equal(allies.includes(seat), false, `${label}: 盟友集合不得含自身`);
      assert.equal(enemies.includes(seat), false, `${label}: 敌方集合不得含自身`);
      assert.deepEqual(allies, registry.relations.alliedSeatsOf(seat));
      assert.deepEqual(enemies, registry.relations.enemySeatsOf(seat));
    }

    // 开关字典键序与 seatOrder 一致
    const switches = createSeatSwitchBoard(topology.seatOrder, true);
    assert.deepEqual(Object.keys(switches.snapshot), topology.seatOrder, `${label}: 开关字典键序`);
    for (const seat of topology.seatOrder) {
      assert.equal(switches.snapshot[seat], true);
    }

    // ai:${seat} 派生与独立 fork 等价，且不消费父流
    const rootWithFork = createSeededRng(999);
    const rootControl = createSeededRng(999);
    const aiRng = createSeatAiRngMap(rootWithFork, topology.seatOrder);
    assert.deepEqual(Object.keys(aiRng), topology.seatOrder, `${label}: aiRng 键序`);
    for (const seat of topology.seatOrder) {
      const expectedFork = rootControl.fork(`ai:${seat}`);
      for (let step = 0; step < 5; step += 1) {
        assert.equal(aiRng[seat].next(), expectedFork.next(), `${label}: ai:${seat} 随机序列应一致`);
      }
    }
    for (let step = 0; step < 10; step += 1) {
      assert.equal(rootWithFork.next(), rootControl.next(), `${label}: 派生 ai:${topology.seatOrder.join(",")} 不得消费父流`);
    }

    // Team.color / projectileColor / huntColor 非空且只读，且与拓扑派生色值逐字节一致
    for (let i = 0; i < teams.length; i += 1) {
      const team = teams[i];
      const expectedPresentation = topology.fleets[i].presentation;
      assert.equal(typeof team.color, "string");
      assert.ok(team.color.length > 0);
      assert.equal(typeof team.projectileColor, "string");
      assert.ok(team.projectileColor.length > 0);
      assert.equal(typeof team.huntColor, "string");
      assert.ok(team.huntColor.length > 0);
      assert.equal(team.color, expectedPresentation.color);
      assert.equal(team.projectileColor, expectedPresentation.projectileColor);
      assert.equal(team.huntColor, expectedPresentation.huntColor);
      assert.throws(() => { team.color = "#111"; }, TypeError);
      assert.throws(() => { team.projectileColor = "#222"; }, TypeError);
      assert.throws(() => { team.huntColor = "#333"; }, TypeError);
    }
    return { teams, registry, switches };
  }

  // 1) 两席 A/B
  const abTopology = normalizeMatchTopology({});
  const ab = verifyTopologyContract("两席 A/B", abTopology, [["A", "B"], ["B", "A"]], [["A", "B"]]);
  assert.equal(ab.teams[0].color, TEAM_COLORS.A);
  assert.equal(ab.teams[0].projectileColor, TEAM_PROJECTILE_COLORS.A);
  assert.equal(ab.teams[0].huntColor, TEAM_HUNT_COLORS.A);
  assert.equal(ab.teams[1].color, TEAM_COLORS.B);
  assert.equal(ab.teams[1].projectileColor, TEAM_PROJECTILE_COLORS.B);
  assert.equal(ab.teams[1].huntColor, TEAM_HUNT_COLORS.B);
  assert.deepEqual(Object.keys(ab.switches.snapshot), ["A", "B"]);

  // 2) 四席两方
  const fourTopology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", 0),
      makeFleetConfig("P2", "side1", 1),
      makeFleetConfig("P3", "side2", 2),
      makeFleetConfig("P4", "side2", 3),
    ],
  });
  verifyTopologyContract(
    "四席两方",
    fourTopology,
    [
      ["P1", "P3"], ["P1", "P4"],
      ["P2", "P3"], ["P2", "P4"],
      ["P3", "P1"], ["P3", "P2"],
      ["P4", "P1"], ["P4", "P2"],
    ],
    [
      ["P1", "P3"], ["P1", "P4"],
      ["P2", "P3"], ["P2", "P4"],
    ],
  );

  // 3) 三席混战
  const ffaTopology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("alpha", "f1", 0),
      makeFleetConfig("beta", "f2", 1),
      makeFleetConfig("gamma", "f3", 2),
    ],
  });
  verifyTopologyContract(
    "三席混战",
    ffaTopology,
    [
      ["alpha", "beta"], ["alpha", "gamma"],
      ["beta", "alpha"], ["beta", "gamma"],
      ["gamma", "alpha"], ["gamma", "beta"],
    ],
    [
      ["alpha", "beta"], ["alpha", "gamma"],
      ["beta", "gamma"],
    ],
  );

  // Team 构造缺省回落与非 A/B 缺少必要字段的拒绝
  const dummyMatch = new MatchSimulation({ mode: "pvp", seed: 808 });
  const fallbackTeamA = new Team(dummyMatch, "A", "回落A", 300, 750, 0);
  assert.equal(fallbackTeamA.sideId, "side1");
  assert.equal(fallbackTeamA.color, TEAM_COLORS.A);
  assert.equal(fallbackTeamA.projectileColor, TEAM_PROJECTILE_COLORS.A);
  assert.equal(fallbackTeamA.huntColor, TEAM_HUNT_COLORS.A);
  assert.throws(() => new Team(dummyMatch, "P1", "缺阵营", 300, 750, 0), /sideId/);
  assert.throws(() => new Team(dummyMatch, "P1", "缺颜色", 300, 750, 0, { sideId: "side1" }), /展示颜色/);
}

console.log("舰队注册表校验通过：寻址隔离、资源独立、只读容器、帧序调度、同帧开关、旧对局等价、多席拒绝与配对/颜色/随机流契约全部覆盖。");
