import assert from "node:assert/strict";
import { MatchSimulation } from "../shared/game-core.js";
import {
  buildRlObservation,
  RL_OBSERVATION_SCHEMA_VERSION,
} from "../shared/training/observation.js";
import {
  applyRlAction,
  buildRlActionMask,
  decodeRlAction,
  RL_ACTION_SCHEMA_VERSION,
} from "../shared/training/actions.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function walkKeys(value, visitor) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walkKeys(item, visitor);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    visitor(key, child);
    walkKeys(child, visitor);
  }
}

function fairnessCheck() {
  const simulation = new MatchSimulation({
    mode: "pvp",
    randomSeed: 711,
    teamLoadouts: {
      A: { main: "haruhi", sub1: "future1096", sub2: "yuki" },
      B: { main: "kyon", sub1: "asakura", sub2: "shamisen" },
    },
  });
  simulation.teamA.visibleEnemyIds.clear();
  const hidden = simulation.teamB.ships.main;
  const before = clone(buildRlObservation(simulation, "A"));

  hidden.x += 173;
  hidden.y -= 91;
  hidden.hp -= 123;
  hidden.energy -= 19;
  hidden.angle += 0.7;
  hidden.characterId = "asakura";
  const after = clone(buildRlObservation(simulation, "A"));
  assert.deepEqual(after, before, "隐藏敌舰真值改变后，玩家观察不应发生变化");

  simulation.teamA.visibleEnemyIds.add(hidden.id);
  let visible = buildRlObservation(simulation, "A").opponent.visibleEntities;
  assert.equal(visible.length, 1, "进入真实视野的敌舰没有进入观察");
  assert.equal(visible[0].x, hidden.x, "可见敌舰位置与权威状态不一致");
  assert.equal(visible[0].characterToken, null, "未确认角色名时泄露了角色身份");
  assert.equal("route" in visible[0], false, "敌方航线不属于玩家可见信息");
  assert.equal("controlKey" in visible[0], false, "未确认敌舰时泄露了控制槽位");

  hidden.nameRevealed = true;
  visible = buildRlObservation(simulation, "A").opponent.visibleEntities;
  assert.equal(visible[0].characterToken, "asakura", "已确认角色名没有进入观察");

  const forbidden = /belief|threat|utility|strategy|focus|suggest|targetRecommendation/i;
  walkKeys(buildRlObservation(simulation, "A"), (key) => {
    assert.equal(forbidden.test(key), false, `观察中出现了禁止的策略派生字段：${key}`);
  });
}

function radarPrivacyCheck() {
  const simulation = new MatchSimulation({
    mode: "pvp",
    randomSeed: 812,
    teamLoadouts: {
      A: { main: "yuki", sub1: "koizumi", sub2: "kyon" },
      B: { main: "haruhi", sub1: "future1096", sub2: "asakura" },
    },
  });
  const target = simulation.teamB.ships.sub1;
  simulation.teamA.visibleEnemyIds.clear();
  simulation.teamA.radarPassive.contacts.set(target.id, {
    id: target.id,
    targetId: target.id,
    x: target.x - 84,
    y: target.y + 57,
    angle: target.angle + 0.31,
    kind: "afterimage",
    characterId: "future1096",
    clarity: 0.72,
    uncertainty: 61,
    distanceRatio: 0.42,
    detectedAt: 1.2,
    expiresAt: 4.1,
    seed: 99127,
  });

  const ownRadar = buildRlObservation(simulation, "A").privateSensors.radar;
  assert(ownRadar?.active, "长门旗舰席位没有获得私有雷达观察");
  assert.equal(ownRadar.contacts.length, 1, "雷达回波数量错误");
  assert.equal(ownRadar.contacts[0].x, target.x - 84, "雷达误差坐标没有保留");
  assert.equal(ownRadar.contacts[0].characterToken, "future1096", "近距回波角色标识没有保留");
  assert.equal("targetId" in ownRadar.contacts[0], false, "雷达观察泄露了真实实体关联");
  assert.equal("id" in ownRadar.contacts[0], false, "雷达观察泄露了真实实体编号");
  assert.equal("distanceRatio" in ownRadar.contacts[0], false, "雷达观察泄露了可反解的真实距离比例");
  assert.equal(ownRadar.contacts[0].clarity, 0.7, "雷达清晰度没有按视觉粒度量化");
  assert.equal(ownRadar.contacts[0].uncertainty, 60, "雷达误差范围没有按视觉粒度量化");
  assert.equal(buildRlObservation(simulation, "B").privateSensors.radar, null, "对方席位看到了长门私有雷达");
}

function publicEffectCheck() {
  const simulation = new MatchSimulation({ mode: "pvp", randomSeed: 913 });
  simulation.projectiles.push({
    id: 9001,
    team: simulation.teamB,
    x: 400,
    y: 500,
    targetX: 700,
    targetY: 600,
    speed: 240,
    radius: 2,
    visualKind: "cat_paw",
    alive: true,
    damage: 99999,
    sourceId: simulation.teamB.ships.main.id,
  });
  simulation.teamB.visionWaveSkill.waves.push({
    id: 2,
    x: 880,
    y: 720,
    emittedAt: 0,
    speed: 480,
    width: 115,
    expiresAt: 4,
  });
  const observation = buildRlObservation(simulation, "A");
  assert.equal(observation.publicEffects.projectiles[0].relation, "opponent", "公开弹丸阵营关系错误");
  assert.equal(observation.publicEffects.projectiles[0].visualToken, "cat_paw", "公开弹丸视觉类别丢失");
  assert.equal("damage" in observation.publicEffects.projectiles[0], false, "公开弹丸泄露了不可见伤害数值");
  assert.equal("sourceId" in observation.publicEffects.projectiles[0], false, "公开弹丸泄露了不可见射手关联");
  assert.equal(observation.publicEffects.visionWaves[0].relation, "opponent", "敌方可见视野波没有进入观察");
}

function actionContractCheck() {
  const simulation = new MatchSimulation({
    mode: "pvp",
    randomSeed: 1014,
    teamLoadouts: {
      A: { main: "haruhi", sub1: "future1096", sub2: "koizumi" },
      B: { main: "yuki", sub1: "kyon", sub2: "asakura" },
    },
  });
  const initialMask = buildRlActionMask(simulation, "A");
  assert.equal(initialMask.schemaVersion, RL_ACTION_SCHEMA_VERSION);
  assert.deepEqual(initialMask.ships.map((item) => item.navigation[1]), [true, false, false], "编队状态下可控舰掩码错误");
  assert.deepEqual(initialMask.split, [true, true, false], "初始分离动作掩码错误");
  assert.equal(initialMask.flagshipSkill, true, "合法旗舰技能被错误屏蔽");

  const decoded = decodeRlAction(simulation, "A", {
    ships: [{
      navigation: "route",
      end: { x: 0, y: -0.5 },
      control: { x: -0.5, y: 0 },
      gear: 4,
    }],
    split: 1,
    scout: { launch: true, sourceShip: 0, zone: 9 },
    flagshipSkill: { cast: true, zone: 3 },
  });
  assert.deepEqual(
    decoded.map((action) => action.type),
    ["set_route", "split", "launch_scout", "cast_flagship_skill"],
    "组合策略动作没有映射到统一权威协议",
  );
  const results = applyRlAction(simulation, "A", {
    ships: [{
      navigation: "route",
      end: { x: 0, y: -0.5 },
      control: { x: -0.5, y: 0 },
      gear: 4,
    }],
    split: 1,
  });
  assert(results.every((result) => result.accepted), "合法策略动作未被权威执行器接受");
  assert.equal(simulation.teamA.splitLevel, 1, "一级分离没有生效");
  assert.equal(simulation.teamA.ships.main.throttle, 1.4, "策略档位没有映射到四档");
  assert(simulation.teamA.ships.main.route, "策略航线没有创建");

  const detachedMask = buildRlActionMask(simulation, "A");
  assert.equal(detachedMask.ships[1].navigation[1], true, "分离后的副舰没有获得移动动作");
  assert.equal(detachedMask.ships[1].castSubSkill, true, "分离后的副舰合法技能被屏蔽");
  const subActions = decodeRlAction(simulation, "A", {
    ships: [{}, {
      castSubSkill: true,
      skillTarget: { x: 1, y: 0 },
      skillZone: 6,
    }],
  });
  assert.equal(subActions.at(-1)?.type, "cast_sub_skill", "通用副舰技能动作没有生成");
  assert(Number.isFinite(subActions.at(-1)?.targetX), "点目标技能没有得到通用目标坐标");

  const passiveSimulation = new MatchSimulation({
    mode: "pvp",
    randomSeed: 1115,
    teamLoadouts: {
      A: { main: "yuki", sub1: "haruhi", sub2: "koizumi" },
    },
  });
  assert.equal(buildRlActionMask(passiveSimulation, "A").flagshipSkill, false, "被动旗舰技能不应生成施放动作");
}

assert.equal(RL_OBSERVATION_SCHEMA_VERSION, 1);
fairnessCheck();
radarPrivacyCheck();
publicEffectCheck();
actionContractCheck();
console.log("强化学习公平观察与通用动作契约校验通过。");
