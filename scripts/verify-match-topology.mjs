import assert from "node:assert/strict";
import { MatchSimulation, DEFAULT_WORLD_SIZE, DEFAULT_TEAM_LOADOUT, DEFAULT_AI_LOADOUT } from "../shared/game-core.js";
import { resolveBattleMode } from "../shared/game/runtime/battle-mode.js";
import {
  TEAM_COLORS,
  TEAM_PROJECTILE_COLORS,
  FLEET_PRESENTATION_PALETTE,
  normalizeAiSeats,
  nextEntityId,
  __resetEntityIds,
} from "../shared/game/model/model-support.js";
import { normalizeMatchTopology, defaultLegacySpawns } from "../shared/game/runtime/match-topology.js";
import { createTeamRelations } from "../shared/game/rules/team-relations.js";

function sampleLoadout(index = 0) {
  const presets = [
    { main: "haruhi", sub1: "koizumi", sub2: "future1096" },
    { main: "kyon", sub1: "tsuruya", sub2: "yuki" },
    { main: "asakura", sub1: "shamisen", sub2: "haruhi" },
    { main: "yuki", sub1: "kyon", sub2: "koizumi" },
    { main: "tsuruya", sub1: "future1096", sub2: "asakura" },
    { main: "shamisen", sub1: "bunny_haruhi", sub2: "kyon" },
  ];
  return { ...presets[index % presets.length] };
}

function makeFleet(seat, sideId, index, extra = {}) {
  return {
    seat,
    sideId,
    name: `舰队_${seat}`,
    loadout: sampleLoadout(index),
    spawn: { x: 200 + index * 180, y: 300 + (index % 2) * 400, facing: index * 0.5 },
    ...extra,
  };
}

// ===== 四席两阵营：稳定输入顺序与精确盟友/敌方查询 =====
{
  // 故意交错阵营输入顺序，验证 seatOrder 和查询输出保持输入顺序，不按字母或阵营重排。
  const fourSeatInput = {
    fleets: [
      makeFleet("P4", "side2", 0),
      makeFleet("P1", "side1", 1),
      makeFleet("P3", "side2", 2),
      makeFleet("P2", "side1", 3),
    ],
  };
  const topology = normalizeMatchTopology(fourSeatInput);
  assert.deepEqual(topology.seatOrder, ["P4", "P1", "P3", "P2"], "seatOrder 必须严格保持输入顺序");
  assert.deepEqual(topology.fleets.map((f) => f.seat), ["P4", "P1", "P3", "P2"]);

  const relations = createTeamRelations(topology);
  assert.deepEqual(relations.seatOrder, ["P4", "P1", "P3", "P2"]);

  assert.equal(relations.sideOfSeat("P1"), "side1");
  assert.equal(relations.sideOfSeat("P2"), "side1");
  assert.equal(relations.sideOfSeat("P3"), "side2");
  assert.equal(relations.sideOfSeat("P4"), "side2");

  // 逐席校验盟友（排除自身）与敌方集合及顺序
  assert.deepEqual(relations.alliedSeatsOf("P1"), ["P2"]);
  assert.deepEqual(relations.enemySeatsOf("P1"), ["P4", "P3"]);
  assert.deepEqual(relations.alliedSeatsOf("P2"), ["P1"]);
  assert.deepEqual(relations.enemySeatsOf("P2"), ["P4", "P3"]);
  assert.deepEqual(relations.alliedSeatsOf("P3"), ["P4"]);
  assert.deepEqual(relations.enemySeatsOf("P3"), ["P1", "P2"]);
  assert.deepEqual(relations.alliedSeatsOf("P4"), ["P3"]);
  assert.deepEqual(relations.enemySeatsOf("P4"), ["P1", "P2"]);

  // 同盟含自身，敌方不含自身
  assert.equal(relations.areAllies("P1", "P1"), true);
  assert.equal(relations.areAllies("P1", "P2"), true);
  assert.equal(relations.areAllies("P2", "P1"), true);
  assert.equal(relations.areAllies("P1", "P3"), false);
  assert.equal(relations.areEnemies("P1", "P1"), false);
  assert.equal(relations.areEnemies("P1", "P2"), false);
  assert.equal(relations.areEnemies("P1", "P3"), true);
  assert.equal(relations.areEnemies("P3", "P1"), true);
  assert.equal(relations.areEnemies("P1", "P4"), true);
}

// ===== 三席混战（三独立阵营）：对称关系且无 A/B 回退 =====
{
  const ffaTopology = normalizeMatchTopology({
    fleets: [
      makeFleet("alpha", "f1", 0),
      makeFleet("beta", "f2", 1),
      makeFleet("gamma", "f3", 2),
    ],
  });
  const relations = createTeamRelations(ffaTopology);
  const seats = ["alpha", "beta", "gamma"];
  assert.deepEqual(relations.seatOrder, seats);

  for (const left of seats) {
    assert.deepEqual(relations.alliedSeatsOf(left), [], "混战各席排除自身后无盟友");
    assert.deepEqual(
      relations.enemySeatsOf(left),
      seats.filter((seat) => seat !== left),
      "混战每席恰有两名按输入顺序排列的敌人",
    );
    for (const right of seats) {
      assert.equal(relations.areAllies(left, right), left === right);
      assert.equal(relations.areEnemies(left, right), left !== right);
      assert.equal(relations.areEnemies(left, right), relations.areEnemies(right, left), "敌对关系必须对称");
    }
  }
  assert.equal(relations.sideOfSeat("A"), null, "非 A/B 拓扑不得把 A 映射为有效席位");
  assert.equal(relations.sideOfSeat("B"), null, "非 A/B 拓扑不得把 B 映射为有效席位");
  assert.equal(relations.areAllies("A", "alpha"), false);
  assert.equal(relations.areEnemies("A", "alpha"), false);
  assert.equal(relations.areEnemies("A", "B"), false);
}

// ===== 默认配置与等价显式 A/B 配置初始化完全一致，不增加随机或实体 ID 消费 =====
{
  const spawns = defaultLegacySpawns(DEFAULT_WORLD_SIZE);
  const expectedCenterY = DEFAULT_WORLD_SIZE * 0.5;
  const expectedRetreat = (DEFAULT_WORLD_SIZE / 3) * 0.25;
  assert.equal(spawns.A.x, DEFAULT_WORLD_SIZE * 0.35 - expectedRetreat);
  assert.equal(spawns.A.y, expectedCenterY);
  assert.equal(spawns.A.facing, 0);
  assert.equal(spawns.B.x, DEFAULT_WORLD_SIZE * 0.65 + expectedRetreat);
  assert.equal(spawns.B.y, expectedCenterY);
  assert.equal(spawns.B.facing, Math.PI);

  // 归一化本身不得消耗全局随机或实体 ID
  const originalRandom = Math.random;
  let randomCalls = 0;
  Math.random = () => {
    randomCalls += 1;
    return 0.5;
  };
  __resetEntityIds(100);
  try {
    const defaultPvp = normalizeMatchTopology({ mode: "pvp" });
    const explicitPvp = normalizeMatchTopology({
      mode: "pvp",
      fleets: [
        { seat: "A", sideId: "side1", name: "玩家A舰队", loadout: { ...DEFAULT_TEAM_LOADOUT }, spawn: { ...spawns.A } },
        { seat: "B", sideId: "side2", name: "玩家B舰队", loadout: { ...DEFAULT_TEAM_LOADOUT }, spawn: { ...spawns.B } },
      ],
    });
    assert.deepEqual(defaultPvp, explicitPvp, "旧默认 PVP 与等价显式 A/B 归一化结果必须完全一致");
    assert.equal(randomCalls, 0, "归一化不得消耗随机数");
    assert.equal(nextEntityId(), 101, "归一化不得消耗全局实体 ID");
  } finally {
    Math.random = originalRandom;
  }

  // 真实 MatchSimulation 初始化对比（PVP、AI、Tutorial 三种旧入口）
  const pairs = [
    [
      { mode: "pvp", seed: 2026 },
      {
        mode: "pvp",
        seed: 2026,
        fleets: [
          { seat: "A", sideId: "side1", name: "玩家A舰队", loadout: { ...DEFAULT_TEAM_LOADOUT }, spawn: { ...spawns.A } },
          { seat: "B", sideId: "side2", name: "玩家B舰队", loadout: { ...DEFAULT_TEAM_LOADOUT }, spawn: { ...spawns.B } },
        ],
      },
    ],
    [
      { mode: "ai", seed: 2027 },
      {
        mode: "ai",
        seed: 2027,
        fleets: [
          { seat: "A", sideId: "side1", name: "玩家A舰队", loadout: { ...DEFAULT_TEAM_LOADOUT }, spawn: { ...spawns.A } },
          { seat: "B", sideId: "side2", name: "统合思念体AI舰队", loadout: { ...DEFAULT_AI_LOADOUT }, spawn: { ...spawns.B } },
        ],
      },
    ],
    [
      { mode: "ai", tutorialMode: true, seed: 2028 },
      {
        mode: "ai",
        tutorialMode: true,
        seed: 2028,
        fleets: [
          { seat: "A", sideId: "side1", name: "玩家A舰队", loadout: { ...DEFAULT_TEAM_LOADOUT }, spawn: { ...spawns.A } },
          { seat: "B", sideId: "side2", name: "统合思念体AI舰队", loadout: { ...DEFAULT_AI_LOADOUT }, spawn: { ...spawns.B } },
        ],
      },
    ],
  ];

  for (const [legacyOpts, explicitOpts] of pairs) {
    const legacyMode = resolveBattleMode(legacyOpts);
    const explicitMode = resolveBattleMode(explicitOpts);
    assert.deepEqual(legacyMode.topology, explicitMode.topology);
    assert.deepEqual(legacyMode.teamNames, explicitMode.teamNames);
    assert.deepEqual(legacyMode.teamLoadouts, explicitMode.teamLoadouts);
    assert.deepEqual(legacyMode.aiSeats, explicitMode.aiSeats);
    assert.equal(legacyMode.rules, explicitMode.rules);

    const simLegacy = new MatchSimulation(legacyOpts);
    const simExplicit = new MatchSimulation(explicitOpts);
    assert.deepEqual(simLegacy.teamA.loadout, simExplicit.teamA.loadout);
    assert.deepEqual(simLegacy.teamB.loadout, simExplicit.teamB.loadout);
    for (const slot of ["main", "sub1", "sub2"]) {
      assert.equal(simLegacy.teamA.ships[slot].id, simExplicit.teamA.ships[slot].id, "实体 ID 分配必须一致");
      assert.equal(simLegacy.teamB.ships[slot].id, simExplicit.teamB.ships[slot].id, "实体 ID 分配必须一致");
      assert.equal(simLegacy.teamA.ships[slot].x, simExplicit.teamA.ships[slot].x);
      assert.equal(simLegacy.teamA.ships[slot].y, simExplicit.teamA.ships[slot].y);
      assert.equal(simLegacy.teamB.ships[slot].x, simExplicit.teamB.ships[slot].x);
      assert.equal(simLegacy.teamB.ships[slot].y, simExplicit.teamB.ships[slot].y);
    }
    assert.equal(simLegacy.entityIds.value, simExplicit.entityIds.value, "实体 ID 计数必须一致");
    assert.equal(simLegacy.rng.next(), simExplicit.rng.next(), "主随机流消费必须一致");
    assert.equal(simLegacy.aiRng.A.next(), simExplicit.aiRng.A.next(), "AI A 随机流消费必须一致");
    assert.equal(simLegacy.aiRng.B.next(), simExplicit.aiRng.B.next(), "AI B 随机流消费必须一致");
    assert.deepEqual(simLegacy.serializeState(), simExplicit.serializeState(), "初始权威快照必须逐字节一致");
  }
}

// ===== 非法输入、歧义字段及未支持拓扑明确拒绝且不产生部分世界 =====
{
  const invalidTopologyCases = [
    ["options 为 null", null],
    ["options 为数组", []],
    ["fleets 为空数组（不等于缺省）", { fleets: [] }],
    ["fleets 非数组", { fleets: "A,B" }],
    ["fleets 为 null", { fleets: null }],
    ["fleets 成员非对象", { fleets: [null] }],
    ["重复 seat", { fleets: [makeFleet("P1", "side1", 0), makeFleet("P1", "side2", 1)] }],
    ["缺少 sideId", { fleets: [makeFleet("P1", undefined, 0), makeFleet("P2", "side2", 1)] }],
    ["空字符串 sideId", { fleets: [makeFleet("P1", "", 0), makeFleet("P2", "side2", 1)] }],
    ["纯空格 sideId", { fleets: [makeFleet("P1", "   ", 0), makeFleet("P2", "side2", 1)] }],
    ["非法 seat（数字开头）", { fleets: [makeFleet("1P", "side1", 0), makeFleet("P2", "side2", 1)] }],
    ["非法 seat（含空格）", { fleets: [makeFleet("P 1", "side1", 0), makeFleet("P2", "side2", 1)] }],
    ["非法 seat（原型键 __proto__）", { fleets: [makeFleet("__proto__", "side1", 0), makeFleet("P2", "side2", 1)] }],
    ["非法 seat（超长 33 位）", { fleets: [makeFleet("a".repeat(33), "side1", 0), makeFleet("P2", "side2", 1)] }],
    ["非法 seat（非 ASCII）", { fleets: [makeFleet("甲队", "side1", 0), makeFleet("P2", "side2", 1)] }],
    ["非法 seat（非字符串）", { fleets: [makeFleet(123, "side1", 0), makeFleet("P2", "side2", 1)] }],
    ["非法 sideId（超长 33 位）", { fleets: [makeFleet("P1", "s".repeat(33), 0), makeFleet("P2", "side2", 1)] }],
    ["非法 sideId（含非法字符）", { fleets: [makeFleet("P1", "side/1", 0), makeFleet("P2", "side2", 1)] }],
    ["空舰队名称", { fleets: [makeFleet("P1", "side1", 0, { name: "  " }), makeFleet("P2", "side2", 1)] }],
    ["spawn 缺失", { fleets: [makeFleet("P1", "side1", 0, { spawn: null }), makeFleet("P2", "side2", 1)] }],
    ["spawn.x 为 NaN", { fleets: [makeFleet("P1", "side1", 0, { spawn: { x: NaN, y: 100, facing: 0 } })] }],
    ["spawn.y 为 Infinity", { fleets: [makeFleet("P1", "side1", 0, { spawn: { x: 100, y: Infinity, facing: 0 } })] }],
    ["spawn.facing 非数字", { fleets: [makeFleet("P1", "side1", 0, { spawn: { x: 100, y: 100, facing: "0" } })] }],
    ["spawn.x 越界（负值）", { fleets: [makeFleet("P1", "side1", 0, { spawn: { x: -1, y: 100, facing: 0 } })] }],
    ["spawn.y 越界（超地图）", { fleets: [makeFleet("P1", "side1", 0, { spawn: { x: 100, y: 2000, facing: 0 } })] }],
    ["loadout 缺失", { fleets: [makeFleet("P1", "side1", 0, { loadout: null })] }],
    ["loadout 缺少槽位 sub2", { fleets: [makeFleet("P1", "side1", 0, { loadout: { main: "haruhi", sub1: "kyon" } })] }],
    ["loadout 未知角色", { fleets: [makeFleet("P1", "side1", 0, { loadout: { main: "unknown", sub1: "kyon", sub2: "yuki" } })] }],
    ["loadout 原型键角色", { fleets: [makeFleet("P1", "side1", 0, { loadout: { main: "toString", sub1: "kyon", sub2: "yuki" } })] }],
    ["loadout 角色重复", { fleets: [makeFleet("P1", "side1", 0, { loadout: { main: "haruhi", sub1: "haruhi", sub2: "yuki" } })] }],
    ["歧义：fleets 与 teamNames 并存", { fleets: [makeFleet("A", "side1", 0), makeFleet("B", "side2", 1)], teamNames: { A: "旧名" } }],
    ["歧义：fleets 与 teamLoadouts 并存", { fleets: [makeFleet("A", "side1", 0), makeFleet("B", "side2", 1)], teamLoadouts: { A: sampleLoadout(0) } }],
    ["非法 worldSize（NaN）", { worldSize: NaN, fleets: [makeFleet("P1", "side1", 0)] }],
    ["非法 worldSize（负数）", { worldSize: -100, fleets: [makeFleet("P1", "side1", 0)] }],
  ];

  for (const [label, badOptions] of invalidTopologyCases) {
    assert.throws(
      () => normalizeMatchTopology(badOptions),
      Error,
      `normalizeMatchTopology 必须拒绝非法配置：${label}`,
    );
  }

  // 未支持的运行配置必须在创建任何实体之前拒绝
  const unsupportedRuntimeCases = [
    [
      "四席 2v2 尚未在旧模式开放",
      {
        mode: "pvp",
        fleets: [
          makeFleet("P1", "side1", 0),
          makeFleet("P2", "side1", 1),
          makeFleet("P3", "side2", 2),
          makeFleet("P4", "side2", 3),
        ],
      },
    ],
    [
      "三席混战尚未在旧模式开放",
      {
        mode: "pvp",
        fleets: [
          makeFleet("alpha", "f1", 0),
          makeFleet("beta", "f2", 1),
          makeFleet("gamma", "f3", 2),
        ],
      },
    ],
    [
      "非 A/B 两席尚未在旧模式开放",
      {
        mode: "pvp",
        fleets: [makeFleet("P1", "side1", 0), makeFleet("P2", "side2", 1)],
      },
    ],
    [
      "B 在 A 之前顺序不符合旧模式",
      {
        mode: "pvp",
        fleets: [makeFleet("B", "side2", 0), makeFleet("A", "side1", 1)],
      },
    ],
    [
      "A 与 B 同阵营不是对立双舰队",
      {
        mode: "pvp",
        fleets: [makeFleet("A", "side1", 0), makeFleet("B", "side1", 1)],
      },
    ],
    [
      "显式拓扑含未注册 AI 席位",
      {
        mode: "pvp",
        aiSeats: ["C"],
        fleets: [makeFleet("A", "side1", 0), makeFleet("B", "side2", 1)],
      },
    ],
    [
      "旧模式不静默忽略自定义出生坐标",
      {
        mode: "pvp",
        fleets: [
          makeFleet("A", "side1", 0, { spawn: { x: 100, y: 200, facing: 0 } }),
          makeFleet("B", "side2", 1, { spawn: { x: 1300, y: 1200, facing: Math.PI } }),
        ],
      },
    ],
  ];

  // createTeamRelations 直接调用时也必须拒绝非法或不自洽的拓扑数据
  assert.throws(() => createTeamRelations(null), TypeError);
  assert.throws(() => createTeamRelations({ fleets: [] }), Error);
  assert.throws(() => createTeamRelations({ fleets: [makeFleet("P1", "side1", 0), makeFleet("P1", "side2", 1)] }), Error);
  assert.throws(() => createTeamRelations({
    fleets: [makeFleet("P1", "side1", 0), makeFleet("P2", "side2", 1)],
    seatOrder: ["P2", "P1"],
  }), Error, "seatOrder 与 fleets 不一致时必须拒绝");

  __resetEntityIds(500);
  for (const [label, badRuntimeOpts] of unsupportedRuntimeCases) {
    assert.throws(
      () => resolveBattleMode(badRuntimeOpts),
      Error,
      `resolveBattleMode 必须拒绝未支持运行配置：${label}`,
    );
    assert.throws(
      () => new MatchSimulation(badRuntimeOpts),
      Error,
      `MatchSimulation 必须拒绝未支持运行配置：${label}`,
    );
  }
  assert.equal(nextEntityId(), 501, "拒绝非法或未支持运行配置时不得创建部分世界或消耗实体 ID");

  // model-support.js 的 normalizeAiSeats 显式注册集合验证 + 旧调用兼容
  assert.deepEqual(normalizeAiSeats("ai"), ["B"], "无注册集合时保持旧默认");
  assert.deepEqual(normalizeAiSeats("pvp", "all"), ["A", "B"]);
  assert.deepEqual(normalizeAiSeats("pvp", ["a", "C"]), ["A"], "无注册集合时保持旧过滤语义");
  assert.deepEqual(normalizeAiSeats("pvp", ["P1", "P3"], ["P1", "P2", "P3", "P4"]), ["P1", "P3"]);
  assert.deepEqual(normalizeAiSeats("pvp", "all", ["P1", "P2", "P3"]), ["P1", "P2", "P3"]);
  assert.deepEqual(normalizeAiSeats("pvp", { P2: true, P4: false }, ["P1", "P2", "P3", "P4"]), ["P2"]);
  assert.deepEqual(normalizeAiSeats("ai", undefined, ["A", "B"]), ["B"]);
  assert.deepEqual(normalizeAiSeats("pvp", undefined, ["P1", "P2"]), []);
  assert.throws(() => normalizeAiSeats("pvp", ["p1"], ["P1", "P2"]), Error, "显式注册集合下 AI 席位大小写敏感");
  assert.throws(() => normalizeAiSeats("pvp", ["X"], ["P1", "P2"]), Error, "显式注册集合拒绝未知 AI 席位");
  assert.throws(() => normalizeAiSeats("pvp", { X: true }, ["P1", "P2"]), Error, "显式注册集合拒绝未知 AI 席位映射");
  assert.throws(() => normalizeAiSeats("ai", undefined, ["P1", "P2"]), Error, "无 B 席时 ai 模式必须显式指定 aiSeats");
}

// ===== 原入参隔离、嵌套冻结与重复查询无副作用 =====
{
  const originalLoadout = { main: "haruhi", sub1: "koizumi", sub2: "future1096" };
  const originalSpawn = { x: 300, y: 400, facing: 0.25 };
  const input = {
    fleets: [
      { seat: "P1", sideId: "side1", name: "一队", loadout: originalLoadout, spawn: originalSpawn },
      makeFleet("P2", "side2", 1),
    ],
  };

  const topology = normalizeMatchTopology(input);
  const relations = createTeamRelations(topology);
  const savedAllies = relations.alliedSeatsOf("P1");
  const savedEnemies = relations.enemySeatsOf("P1");

  // 篡改原嵌套配置不得污染已归一化结果
  originalLoadout.main = "kyon";
  originalSpawn.x = 9999;
  input.fleets[0].name = "被篡改";
  input.fleets.push(makeFleet("P3", "side1", 2));

  assert.equal(topology.fleets.length, 2);
  assert.equal(topology.fleets[0].name, "一队");
  assert.equal(topology.fleets[0].loadout.main, "haruhi");
  assert.equal(topology.fleets[0].spawn.x, 300);

  // 返回对象和嵌套对象必须全部不可写
  assert.throws(() => { topology.seatOrder = []; }, TypeError);
  assert.throws(() => { topology.seatOrder.push("P9"); }, TypeError);
  assert.throws(() => { topology.fleets.push(makeFleet("P9", "side9", 0)); }, TypeError);
  assert.throws(() => { topology.fleets[0].sideId = "hack"; }, TypeError);
  assert.throws(() => { topology.fleets[0].loadout.main = "kyon"; }, TypeError);
  assert.throws(() => { topology.fleets[0].spawn.x = 0; }, TypeError);
  assert.throws(() => { topology.fleets[0].presentation.color = "#000000"; }, TypeError);

  assert.throws(() => { relations.seatOrder.push("P9"); }, TypeError);
  assert.throws(() => { savedAllies.push("P2"); }, TypeError);
  assert.throws(() => { savedEnemies.push("P1"); }, TypeError);
  assert.throws(() => { relations.sideOfSeat = () => "hack"; }, TypeError);

  // 重复查询及原型键探测无副作用
  for (let i = 0; i < 3; i += 1) {
    assert.deepEqual(relations.alliedSeatsOf("P1"), savedAllies);
    assert.deepEqual(relations.enemySeatsOf("P1"), savedEnemies);
    assert.equal(relations.sideOfSeat("__proto__"), null);
    assert.equal(relations.sideOfSeat("constructor"), null);
    assert.equal(relations.sideOfSeat("toString"), null);
    assert.equal(relations.areAllies("constructor", "toString"), false);
    assert.equal(relations.areEnemies("constructor", "toString"), false);
  }

  // 即便合法席位名恰好与 Object.prototype 属性同名，基于 Map 的查找依然安全
  const protoNamed = normalizeMatchTopology({
    fleets: [makeFleet("constructor", "side1", 0), makeFleet("toString", "side2", 1)],
  });
  const protoRel = createTeamRelations(protoNamed);
  assert.equal(protoRel.sideOfSeat("constructor"), "side1");
  assert.equal(protoRel.sideOfSeat("toString"), "side2");
  assert.equal(protoRel.sideOfSeat("valueOf"), null);
  assert.equal(protoRel.areEnemies("constructor", "toString"), true);
  assert.equal(protoRel.areAllies("constructor", "valueOf"), false);
}

// ===== 未知席位既非盟友也非敌方，大小写敏感 =====
{
  const topology = normalizeMatchTopology({
    fleets: [makeFleet("P1", "side1", 0), makeFleet("P2", "side2", 1)],
  });
  const relations = createTeamRelations(topology);

  const unknowns = ["X", "Y", "p1", "p2", "", null, undefined, 123, {}, "__proto__", "hasOwnProperty"];
  for (const unknown of unknowns) {
    assert.equal(relations.sideOfSeat(unknown), null, `未知席位 ${String(unknown)} 的阵营必须为 null`);
    assert.deepEqual(relations.alliedSeatsOf(unknown), []);
    assert.deepEqual(relations.enemySeatsOf(unknown), []);
    assert.equal(Object.isFrozen(relations.alliedSeatsOf(unknown)), true);
    assert.equal(Object.isFrozen(relations.enemySeatsOf(unknown)), true);
    assert.equal(relations.areAllies(unknown, unknown), false, "两个相同未知 ID 不得视为盟友");
    assert.equal(relations.areEnemies(unknown, unknown), false, "两个相同未知 ID 不得视为敌方");
    assert.equal(relations.areAllies("P1", unknown), false);
    assert.equal(relations.areAllies(unknown, "P1"), false);
    assert.equal(relations.areEnemies("P1", unknown), false);
    assert.equal(relations.areEnemies(unknown, "P1"), false);
  }
  assert.equal(relations.areAllies("X", "Y"), false, "两个不同未知 ID 不得视为盟友");
  assert.equal(relations.areEnemies("X", "Y"), false, "两个不同未知 ID 不得视为敌方");
}

// ===== presentation 色值契约、不可注入、与关系查询解耦 =====
{
  // 原有颜色表保持原样，不追加新键也不修改值
  assert.deepEqual(Object.keys(TEAM_COLORS), ["A", "B"]);
  assert.deepEqual(Object.keys(TEAM_PROJECTILE_COLORS), ["A", "B"]);
  assert.equal(TEAM_COLORS.A, "#65d9ff");
  assert.equal(TEAM_COLORS.B, "#ff8692");
  assert.equal(TEAM_PROJECTILE_COLORS.A, "#9be8ff");
  assert.equal(TEAM_PROJECTILE_COLORS.B, "#ffc0bd");
  assert.ok(Array.isArray(FLEET_PRESENTATION_PALETTE) && FLEET_PRESENTATION_PALETTE.length >= 6);
  assert.ok(Object.isFrozen(FLEET_PRESENTATION_PALETTE));

  const legacyTopo = normalizeMatchTopology();
  assert.deepEqual(legacyTopo.fleets[0].presentation, {
    color: TEAM_COLORS.A,
    projectileColor: TEAM_PROJECTILE_COLORS.A,
    huntColor: "#8fe8ff",
  });
  assert.deepEqual(legacyTopo.fleets[1].presentation, {
    color: TEAM_COLORS.B,
    projectileColor: TEAM_PROJECTILE_COLORS.B,
    huntColor: "#ff9eb8",
  });

  const explicitAb = normalizeMatchTopology({
    fleets: [makeFleet("A", "side1", 0), makeFleet("B", "side2", 1)],
  });
  assert.deepEqual(explicitAb.fleets[0].presentation, legacyTopo.fleets[0].presentation);
  assert.deepEqual(explicitAb.fleets[1].presentation, legacyTopo.fleets[1].presentation);

  // 四席与六席新席位按 seatOrder 从固定调色板确定派生且非空
  for (const count of [4, 6]) {
    const fleets = Array.from({ length: count }, (_, idx) =>
      makeFleet(`P${idx + 1}`, idx < count / 2 ? "side1" : "side2", idx),
    );
    const topo = normalizeMatchTopology({ fleets });
    const topoRepeat = normalizeMatchTopology({ fleets });
    assert.deepEqual(
      topo.fleets.map((f) => f.presentation),
      topoRepeat.fleets.map((f) => f.presentation),
      "新席位 presentation 色值必须确定",
    );
    const uniqueColors = new Set();
    for (let idx = 0; idx < count; idx += 1) {
      const pres = topo.fleets[idx].presentation;
      assert.equal(typeof pres.color, "string");
      assert.ok(pres.color.length > 0);
      assert.equal(typeof pres.projectileColor, "string");
      assert.ok(pres.projectileColor.length > 0);
      assert.equal(typeof pres.huntColor, "string");
      assert.ok(pres.huntColor.length > 0);
      assert.deepEqual(pres, FLEET_PRESENTATION_PALETTE[idx % FLEET_PRESENTATION_PALETTE.length]);
      uniqueColors.add(pres.color);
    }
    assert.equal(uniqueColors.size, count, `${count} 席应获得互不相同的默认展示颜色`);
  }

  // 契约：输入中附带 presentation / color / projectileColor / huntColor 一律拒绝（禁止客户端注入）
  const colorInjectionCases = [
    ["注入 presentation", { fleets: [makeFleet("P1", "side1", 0, { presentation: { color: "#000", projectileColor: "#000", huntColor: "#000" } })] }],
    ["注入 color", { fleets: [makeFleet("P1", "side1", 0, { color: "#000000" })] }],
    ["注入 projectileColor", { fleets: [makeFleet("P1", "side1", 0, { projectileColor: "#000000" })] }],
    ["注入 huntColor", { fleets: [makeFleet("P1", "side1", 0, { huntColor: "#000000" })] }],
  ];
  for (const [label, opts] of colorInjectionCases) {
    assert.throws(() => normalizeMatchTopology(opts), Error, `必须拒绝输入颜色字段：${label}`);
  }

  // 关系查询不依赖颜色：互换输入顺序（改变色板下标），同席位对之间的敌我关系不变
  const order1 = normalizeMatchTopology({
    fleets: [makeFleet("P1", "side1", 0), makeFleet("P2", "side1", 1), makeFleet("P3", "side2", 2)],
  });
  const order2 = normalizeMatchTopology({
    fleets: [makeFleet("P3", "side2", 2), makeFleet("P2", "side1", 1), makeFleet("P1", "side1", 0)],
  });
  assert.notEqual(order1.fleets[0].presentation.color, order2.fleets[2].presentation.color, "顺序变化后颜色按 seatOrder 改变");
  const rel1 = createTeamRelations(order1);
  const rel2 = createTeamRelations(order2);
  for (const left of ["P1", "P2", "P3"]) {
    for (const right of ["P1", "P2", "P3"]) {
      assert.equal(rel1.areAllies(left, right), rel2.areAllies(left, right), "颜色变化不得影响同盟判定");
      assert.equal(rel1.areEnemies(left, right), rel2.areEnemies(left, right), "颜色变化不得影响敌对判定");
    }
  }
}

console.log("开局拓扑与阵营关系校验通过：全部行为断言满足契约。");
