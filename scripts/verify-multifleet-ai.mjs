import assert from "node:assert/strict";
import {
  DEFAULT_WORLD_SIZE,
  MatchSimulation,
  TICK_DT,
  throttleForGear,
  __resetEntityIds,
} from "../shared/game-core.js";
import { createSeededRng } from "../shared/game/foundation/rng.js";
import { buildZones, clamp } from "../shared/game/foundation/math.js";
import { CHARACTER_ASSEMBLY } from "../shared/game/characters/assembly/character-assembly.js";
import { Team } from "../shared/game/model/team.js";
import { Scout } from "../shared/game/model/scout.js";
import { Projectile } from "../shared/game/model/projectile.js";
import { ProjectileSystem } from "../shared/game/systems/projectile-system.js";
import {
  normalizeAiSeats,
  isSupportedAiTopology,
  assertSupportedAiSeatsForTopology,
} from "../shared/game/model/model-support.js";
import { normalizeMatchTopology } from "../shared/game/runtime/match-topology.js";
import {
  createFleetRegistry,
  createSeatAiRngMap,
} from "../shared/game/runtime/fleet-registry.js";
import { createHostileView } from "../shared/game/adapters/combat-targets.js";
import { resolveBattleMode } from "../shared/game/runtime/battle-mode.js";
import {
  OBSERVATION_SCHEMA,
  MULTI_FLEET_OBSERVATION_SCHEMA,
  buildObservation,
  buildMultiFleetObservation,
  observeEnemySpawn,
  observeEnemySpawns,
} from "../shared/game/ai/bridge/observation.js";
import { createActionPort } from "../shared/game/ai/bridge/action-port.js";
import { createAiRunner } from "../shared/game/ai/bridge/runner.js";
import { aiActions } from "../shared/game/ai/actions.js";
import {
  resolveAiParams,
  validateAiParamsForSeats,
  resolveSeatAiParams,
} from "../shared/game/ai/params/index.js";
import { ObservationView } from "../shared/game/ai/policy/observation-view.js";
import {
  createPolicyProgram,
  POLICY_PROGRAM_EFFECTS,
} from "../shared/game/ai/policy/policy-program.js";
import { updateRadarPassive } from "../shared/game/characters/yuki/radar-port.js";
import { ensureShamisenHuntTarget } from "../shared/game/characters/shamisen/hunt.js";
import { setScenarioField } from "./core-tests/ship-fixture.mjs";

function makeFleetConfig(seat, sideId, loadout, spawn) {
  return {
    seat,
    sideId,
    name: `舰队_${seat}`,
    loadout,
    spawn,
  };
}

// 递归检查观测 DTO：只允许纯数据、严禁实体实例、函数、动作端口或随机源泄漏，且全部冻结。
function assertPureFrozenDto(value, path = "root", seen = new Set()) {
  if (value === null || value === undefined) return;
  const kind = typeof value;
  assert.notEqual(kind, "function", `${path} 不得包含函数或实体方法`);
  assert.notEqual(kind, "symbol", `${path} 不得包含 symbol`);
  if (kind !== "object") return;
  assert.equal(seen.has(value), false, `${path} 不得包含循环引用`);
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, `${path} 必须冻结不可写`);
  const proto = Object.getPrototypeOf(value);
  assert.ok(
    Array.isArray(value) || proto === Object.prototype || proto === null,
    `${path} 必须是普通对象或数组，不得包含实体类实例`,
  );
  if (!Array.isArray(value)) {
    for (const forbidden of ["submit", "fork", "takeDamage", "setBezierRoute", "match", "team", "rng", "port"]) {
      assert.equal(Object.hasOwn(value, forbidden), false, `${path} 不得泄露内部能力或引用字段 ${forbidden}`);
    }
  }
  for (const [key, child] of Object.entries(value)) {
    assertPureFrozenDto(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

// 多舰队 AI 边界测试宿主：复用真实 Team/Ship/Scout/Projectile 与舰队注册表，不绕过生产开局校验。
function createMultiFleetAiHost(topology, { seed = 601, publicEnemySpawns = false } = {}) {
  const worldSize = DEFAULT_WORLD_SIZE;
  const zones = buildZones(worldSize);
  const rng = createSeededRng(seed);
  const projectiles = new ProjectileSystem((profile) => new Projectile(profile));
  const recordedActions = [];
  const recordedAttacks = [];
  const recordedDamage = [];
  const recordedShipLosses = [];

  const host = {
    worldSize,
    mapPadding: 34,
    elapsed: 0,
    tick: 0,
    zones,
    rng,
    aiRng: createSeatAiRngMap(rng, topology.seatOrder),
    entityIds: { value: 1 },
    rules: CHARACTER_ASSEMBLY.rules,
    shipEffects: CHARACTER_ASSEMBLY.shipEffects,
    projectShip: CHARACTER_ASSEMBLY.projectShip,
    publicEnemySpawns,
    bunnyHaruhiActive: false,
    recordedActions,
    recordedAttacks,
    recordedDamage,
    recordedShipLosses,
    get projectiles() {
      return projectiles.items;
    },
    clampX(x, padding = 0) { return clamp(x, padding, worldSize - padding); },
    clampY(y, padding = 0) { return clamp(y, padding, worldSize - padding); },
    zoneById(zoneId) {
      const safeId = clamp(Number(zoneId) || 5, 1, 9);
      return zones.find((zone) => zone.id === safeId) || zones[4];
    },
    recordAction(seat, action) { recordedActions.push({ seat, action }); },
    recordAttack(seat, kind, hitCount = 0) { recordedAttacks.push({ seat, kind, hitCount }); },
    recordDamage(source, target, amount, kind) {
      recordedDamage.push({
        sourceSeat: source?.team?.seat || null,
        targetSeat: target?.team?.seat || null,
        amount,
        kind,
      });
    },
    recordShipLoss(seat) { recordedShipLosses.push(seat); },
    spawnFloatingText() {},
    spawnFloatingTextKey() {},
    spawnAnnouncementKey() {},
    spawnBurst() {},
    spawnProjectile(profile) { return projectiles.spawn(profile); },
    discardProjectilesFrom(sourceId) { projectiles.discardFrom(sourceId); },
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
  const hostileViews = new Map(
    topology.seatOrder.map((seat) => [seat, createHostileView(registry, seat)]),
  );

  host.topology = topology;
  host.seatOrder = registry.seatOrder;
  host.relations = registry.relations;
  host.allTeams = () => registry.allTeams();
  host.teamBySeat = (seat) => registry.teamBySeat(seat);
  host.alliedTeamsOf = (seat) => registry.alliedTeamsOf(seat);
  host.enemyTeamsOf = (seat) => registry.enemyTeamsOf(seat);
  host.hostilePairs = () => registry.hostilePairs();
  host.hostileUnorderedPairs = () => registry.hostileUnorderedPairs();
  host.enemyTeamBySeat = (seat) => registry.enemyTeamBySeat(seat);
  host.hostileView = (seat) => hostileViews.get(seat);
  host.refreshVisibility = () => {
    for (const team of host.allTeams()) {
      team.computeVisibility(host.hostileView(team.seat));
    }
  };

  return host;
}

function placeFleet(team, x, y) {
  for (const [offsetIndex, key] of ["main", "sub1", "sub2"].entries()) {
    const ship = team.ships[key];
    setScenarioField(ship, "x", x + offsetIndex * 18);
    setScenarioField(ship, "y", y + offsetIndex * 12);
    ship.followTarget({ x: ship.x, y: ship.y });
    ship.clearRoute();
  }
}

// 1. 观测白名单与防泄漏：队友、可见敌、不可见敌共存，隐藏敌真实坐标/角色/实体方法不泄露。
function testObservationIsolationAndWhitelist() {
  const topology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", { main: "haruhi", sub1: "koizumi", sub2: "asakura" }, { x: 260, y: 260, facing: 0 }),
      makeFleetConfig("P2", "side1", { main: "yuki", sub1: "kyon", sub2: "tsuruya" }, { x: 340, y: 310, facing: 0 }),
      makeFleetConfig("P3", "side2", { main: "tsuruya", sub1: "future1096", sub2: "koizumi" }, { x: 310, y: 260, facing: Math.PI }),
      makeFleetConfig("P4", "side3", { main: "tsuruya", sub1: "kyon", sub2: "shamisen" }, { x: 1187.41293, y: 1123.87654, facing: Math.PI }),
    ],
  });
  const host = createMultiFleetAiHost(topology, { seed: 611, publicEnemySpawns: false });
  const p1 = host.teamBySeat("P1");
  const p2 = host.teamBySeat("P2");
  const p3 = host.teamBySeat("P3");
  const p4 = host.teamBySeat("P4");

  // P3 在 P1 视野内，P4 远离所有 P1 视野源且拥有精确可识别的小数坐标。
  placeFleet(p1, 260, 260);
  placeFleet(p2, 300, 310);
  placeFleet(p3, 330, 260);
  placeFleet(p4, 1187.41293, 1123.87654);

  // 通过合法旗舰技能激活编队增益，验证看不见 P4 时其增益不会进入观测。
  setScenarioField(p3.ships.main, "energy", p3.ships.main.maxEnergy);
  setScenarioField(p4.ships.main, "energy", p4.ships.main.maxEnergy);
  assert.equal(p3.castFlagshipSkill(), true);
  assert.equal(p4.castFlagshipSkill(), true);
  host.refreshVisibility();

  const port = createActionPort(host, "P1");
  const obs = port.observe();
  assertPureFrozenDto(obs, "multiFleetObs");
  assert.equal(obs.schema, MULTI_FLEET_OBSERVATION_SCHEMA, "多席观测必须带显式 schema 标识");
  assert.equal(obs.selfSeat, "P1");
  assert.equal(obs.selfSideId, "side1");
  assert.equal(obs.privileged, null, "多席观测不得把旧 1v1 跨迷雾特权扩大到全部敌队");
  assert.equal(obs.publicEnemySpawns, null, "出生点不公开的新玩法不得泄露敌方出生坐标");
  assert.equal(port.enemySpawns(), null);
  assert.throws(() => observeEnemySpawn(host, "P1"), Error, "多席拓扑不得误用单敌方出生点接口");

  // 校验队友摘要：仅含许可摘要，不泄露能量/冷却/航线/雷达/视野，也不混入敌对列表。
  assert.equal(obs.allies.length, 1);
  assert.equal(obs.allies[0].seat, "P2");
  assert.equal(obs.allies[0].sideId, "side1");
  assert.deepEqual(Object.keys(obs.allies[0]).sort(), ["alive", "aliveShipCount", "hullRatio", "seat", "sideId"]);

  // 可见敌只包含 P3，不含队友 P2，也不含隐藏敌 P4。
  const visibleSeats = new Set(obs.visibleHostiles.map((entry) => entry.sourceSeat));
  assert.deepEqual([...visibleSeats], ["P3"], "可见敌列表只应包含视野内的 P3");
  assert.ok(obs.visibleHostiles.every((entry) => entry.sourceType === "vision"));
  assert.equal(obs.visibleHostiles.some((entry) => entry.sourceSeat === "P2"), false, "队友不得出现在可见敌列表中");
  assert.equal(obs.visibleHostiles.some((entry) => entry.sourceSeat === "P4"), false, "不可见敌不得出现在可见敌列表中");

  // 序列化全文检索：不可见敌 P4 的坐标、角色以及任何 P4 席位信息均不得泄漏。
  const serialized = JSON.stringify(obs);
  const externalViewText = JSON.stringify({
    allies: obs.allies,
    visibleHostiles: obs.visibleHostiles,
    hostileEffects: obs.hostileEffects,
    publicEnemySpawns: obs.publicEnemySpawns,
    privileged: obs.privileged,
  });
  assert.equal(serialized.includes("1187.41293"), false, "不得泄漏隐藏敌舰 X 坐标");
  assert.equal(serialized.includes("1123.87654"), false, "不得泄漏隐藏敌舰 Y 坐标");
  assert.equal(serialized.includes("P4"), false, "无任何合法感知来源时不得泄漏隐藏敌方席位");
  assert.equal(externalViewText.includes("shamisen"), false, "外部观测不得泄漏隐藏敌舰角色 shamisen");
  assert.equal(externalViewText.includes("kyon"), false, "外部观测不得泄漏隐藏敌舰角色 kyon");
  assert.equal(obs.hostileEffects.visibleTeamBuffs.map((entry) => entry.sourceSeat).join(","), "P3");

  // 若模式显式允许公开出生点，只返回冻结开局出生坐标，而非实时移动后的隐藏坐标。
  const publicHost = createMultiFleetAiHost(topology, { seed: 612, publicEnemySpawns: true });
  placeFleet(publicHost.teamBySeat("P4"), 999.12345, 888.54321);
  const spawns = observeEnemySpawns(publicHost, "P1");
  assert.ok(Array.isArray(spawns) && spawns.length === 2, "公开出生模式下应返回全部敌对舰队的开局出生集合");
  assert.deepEqual(spawns.map((entry) => entry.seat), ["P3", "P4"]);
  const p4Spawn = spawns.find((entry) => entry.seat === "P4");
  assert.equal(p4Spawn.x, 1187.41293, "公开出生事实只能来自开局冻结坐标，不得泄漏移动后的实时坐标");
  assert.equal(p4Spawn.y, 1123.87654);
  assert.equal(p4Spawn.sourceType, "public_spawn");
}

// 2. 多敌方猎杀、波纹、雷达、弹体来源归属：标记与雷达不提升普通视野，队友不进敌方威胁列表。
function testMultiSourceHostileEffectsAndAttribution() {
  const topology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", { main: "yuki", sub1: "koizumi", sub2: "haruhi" }, { x: 240, y: 240, facing: 0 }),
      makeFleetConfig("P2", "side1", { main: "shamisen", sub1: "tsuruya", sub2: "kyon" }, { x: 260, y: 310, facing: 0 }),
      makeFleetConfig("P3", "side1", { main: "asakura", sub1: "tsuruya", sub2: "kyon" }, { x: 280, y: 360, facing: 0 }),
      makeFleetConfig("P4", "side2", { main: "shamisen", sub1: "koizumi", sub2: "kyon" }, { x: 1120, y: 240, facing: Math.PI }),
      makeFleetConfig("P5", "side3", { main: "shamisen", sub1: "koizumi", sub2: "tsuruya" }, { x: 1160, y: 1160, facing: Math.PI }),
      makeFleetConfig("P6", "side2", { main: "asakura", sub1: "koizumi", sub2: "kyon" }, { x: 1080, y: 320, facing: Math.PI }),
      makeFleetConfig("P7", "side3", { main: "asakura", sub1: "koizumi", sub2: "tsuruya" }, { x: 1080, y: 1080, facing: Math.PI }),
    ],
  });
  const host = createMultiFleetAiHost(topology, { seed: 621 });
  const p1 = host.teamBySeat("P1");
  const p2 = host.teamBySeat("P2");
  const p3 = host.teamBySeat("P3");
  const p4 = host.teamBySeat("P4");
  const p5 = host.teamBySeat("P5");
  const p6 = host.teamBySeat("P6");
  const p7 = host.teamBySeat("P7");

  placeFleet(p1, 240, 240);
  placeFleet(p2, 260, 310);
  placeFleet(p3, 280, 360);
  placeFleet(p4, 1120, 240);
  placeFleet(p5, 1160, 1160);
  placeFleet(p6, 1080, 320);
  placeFleet(p7, 1080, 1080);

  // 触发三味线猎杀，并按确定随机值让多敌方分别锁定 P1 的不同舰船、队友 P2 锁定敌方 P4。
  const p4Candidates = host.hostileView("P4").getVictoryShips();
  const p5Candidates = host.hostileView("P5").getVictoryShips();
  const p2Candidates = host.hostileView("P2").getVictoryShips();
  const indexOfShip = (candidates, ship) => {
    const index = candidates.findIndex((item) => item.id === ship.id);
    assert.ok(index >= 0, "预期目标必须在敌对候选集中");
    return (index + 0.5) / candidates.length;
  };
  ensureShamisenHuntTarget(p4, host.hostileView("P4"), () => indexOfShip(p4Candidates, p1.ships.main));
  ensureShamisenHuntTarget(p5, host.hostileView("P5"), () => indexOfShip(p5Candidates, p1.ships.sub1));
  ensureShamisenHuntTarget(p2, host.hostileView("P2"), () => indexOfShip(p2Candidates, p4.ships.main));
  assert.equal(p4.shamisenHunt.targetId, p1.ships.main.id);
  assert.equal(p5.shamisenHunt.targetId, p1.ships.sub1.id);
  assert.equal(p2.shamisenHunt.targetId, p4.ships.main.id);

  // 通过合法旗舰技能让队友 P3 以及敌方 P6、P7 的朝仓各自发射公开视野波。
  for (const team of [p3, p6, p7]) {
    setScenarioField(team.ships.main, "energy", team.ships.main.maxEnergy);
    assert.equal(team.castFlagshipSkill(), true);
  }

  // 推进长门 P1 的私有雷达，覆盖多敌方目标但不开启普通视野。
  for (let tick = 0; tick < 360; tick += 1) {
    host.elapsed += TICK_DT;
    host.tick += 1;
    updateRadarPassive(p1, host.hostileView("P1"), TICK_DT);
  }

  // 在 P1 视野内放置 1 颗队友 P2 弹体与 1 颗敌方 P4 弹体，以及 1 颗视野外敌方 P5 弹体。
  host.spawnProjectile({
    team: p2, sourceId: p2.ships.main.id, x: 250, y: 250, vx: 10, vy: 0, targetX: 500, targetY: 250, damage: 10, color: p2.projectileColor,
  });
  host.spawnProjectile({
    team: p4, sourceId: p4.ships.main.id, x: 255, y: 245, vx: -10, vy: 0, targetX: 240, targetY: 240, damage: 10, color: p4.projectileColor,
  });
  host.spawnProjectile({
    team: p5, sourceId: p5.ships.main.id, x: 1150, y: 1150, vx: -10, vy: 0, targetX: 240, targetY: 240, damage: 10, color: p5.projectileColor,
  });

  host.refreshVisibility();
  const obsP1 = buildMultiFleetObservation(host, "P1");
  assertPureFrozenDto(obsP1, "obsP1");

  // 视野外的敌方虽然被雷达扫到并有猎杀/视野波，但绝不能升级为 visibleHostiles。
  assert.equal(obsP1.visibleHostiles.length, 0, "雷达与猎杀标记不得将不可见敌提升为普通视野");

  // 多敌方猎杀来源准确归属，且不包含队友 P2。
  assert.deepEqual(
    obsP1.hostileEffects.huntedBy.map((entry) => ({ sourceSeat: entry.sourceSeat, shipId: entry.shipId, shipKey: entry.shipKey, sourceType: entry.sourceType })),
    [
      { sourceSeat: "P4", shipId: p1.ships.main.id, shipKey: "main", sourceType: "hunt_mark" },
      { sourceSeat: "P5", shipId: p1.ships.sub1.id, shipKey: "sub1", sourceType: "hunt_mark" },
    ],
  );
  assert.equal(obsP1.hostileEffects.huntedBy.some((entry) => entry.sourceSeat === "P2"), false, "队友不得进入敌方猎杀威胁列表");

  // 多敌方视野波准确归属，且不包含队友 P3。
  assert.deepEqual(
    obsP1.hostileEffects.visionWaves.map((entry) => entry.sourceSeat),
    ["P6", "P7"],
    "敌方视野波必须按 seatOrder 归属到对应敌方来源，且排除队友",
  );
  assert.ok(obsP1.hostileEffects.visionWaves.every((entry) => entry.sourceType === "public_wave" && entry.waves.length >= 1));

  // 长门私有雷达包含带误差接触且标注 sourceType: "radar"，不泄露真实坐标。
  assert.ok(obsP1.hostileEffects.radarContacts.length > 0, "长门旗舰应保留敌方雷达接触");
  assert.ok(obsP1.hostileEffects.radarContacts.every((contact) => contact.sourceType === "radar"));
  const rawRadar = p1.serializeRadarPassive();
  for (const contact of obsP1.hostileEffects.radarContacts) {
    const raw = rawRadar.contacts.find((item) => item.targetId === contact.targetId);
    assert.ok(raw, "雷达接触必须来自己方私有雷达");
    assert.equal(contact.x, raw.x, "雷达接触必须保留带误差坐标");
    assert.equal(contact.y, raw.y);
  }

  // 视野内弹体只收录敌方 P4，排除队友 P2 与视野外敌方 P5。
  assert.equal(obsP1.hostileEffects.projectiles.length, 1);
  assert.equal(obsP1.hostileEffects.projectiles[0].sourceSeat, "P4");
  assert.equal(obsP1.hostileEffects.projectiles[0].sourceType, "vision");

  // 验证猎杀方 P2 的 huntMarks：跨敌对舰队定位 P4 目标，不暴露角色/席位/血量，也不升级为普通视野。
  const obsP2 = buildMultiFleetObservation(host, "P2");
  assert.equal(obsP2.visibleHostiles.length, 0, "猫爪猎杀标记不得转化为普通视野");
  assert.equal(obsP2.hostileEffects.huntMarks.length, 1);
  assert.deepEqual(Object.keys(obsP2.hostileEffects.huntMarks[0]).sort(), ["sourceType", "targetId", "visible", "x", "y"]);
  assert.equal(obsP2.hostileEffects.huntMarks[0].targetId, p4.ships.main.id);
  assert.equal(obsP2.hostileEffects.huntMarks[0].sourceType, "hunt_mark");
  assert.equal(obsP2.hostileEffects.huntMarks[0].visible, false);
}

// 3. 动作防越权：带他人 shipKey、他人 seat/sideId、他人 scoutId 或原型键时不能越权控制队友或敌人。
function testActionAuthorizationIsolation() {
  const topology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", { main: "haruhi", sub1: "koizumi", sub2: "asakura" }, { x: 240, y: 240, facing: 0 }),
      makeFleetConfig("P2", "side1", { main: "yuki", sub1: "kyon", sub2: "tsuruya" }, { x: 240, y: 540, facing: 0 }),
      makeFleetConfig("P3", "side2", { main: "koizumi", sub1: "future1096", sub2: "tsuruya" }, { x: 1180, y: 240, facing: Math.PI }),
      makeFleetConfig("P4", "side2", { main: "kyon", sub1: "asakura", sub2: "shamisen" }, { x: 1180, y: 540, facing: Math.PI }),
    ],
  });
  const host = createMultiFleetAiHost(topology, { seed: 631 });
  const p1 = host.teamBySeat("P1");
  const p2 = host.teamBySeat("P2");
  const p3 = host.teamBySeat("P3");
  const p4 = host.teamBySeat("P4");

  const allyScout = new Scout(p2, 300, 540, { zone: host.zoneById(1) });
  p2.addScout(allyScout);
  const enemyScout = new Scout(p3, 1100, 240, { zone: host.zoneById(3) });
  p3.addScout(enemyScout);

  const snapshotFleet = (team) => JSON.stringify({
    splitLevel: team.splitLevel,
    ships: ["main", "sub1", "sub2"].map((k) => ({
      k,
      throttle: team.ships[k].throttle,
      route: team.ships[k].route ? { p2: team.ships[k].route.p2 } : null,
      energy: team.ships[k].energy,
    })),
    scouts: team.scouts.map((s) => ({ id: s.id, zoneId: s.zone?.id ?? null })),
  });

  const beforeP2 = snapshotFleet(p2);
  const beforeP3 = snapshotFleet(p3);
  const beforeP4 = snapshotFleet(p4);
  const portP1 = createActionPort(host, "P1");

  // 尝试用各种越权载体控制 P2/P3/P4。
  assert.equal(portP1.submit({ type: "set_throttle", shipKey: "P2.main", throttle: throttleForGear(1) }), false);
  assert.equal(portP1.submit({ type: "set_throttle", shipKey: "P3:main", throttle: throttleForGear(1) }), false);
  assert.equal(portP1.submit({ type: "set_throttle", shipKey: "toString", throttle: throttleForGear(1) }), false);
  assert.equal(portP1.submit({ type: "set_throttle", shipKey: "main", throttle: throttleForGear(1), seat: "P2" }), false);
  assert.equal(portP1.submit({ type: "set_throttle", shipKey: "main", throttle: throttleForGear(1), sideId: "side2" }), false);
  assert.equal(portP1.submit({ type: "set_route", shipKey: "P2.main", endX: 900, endY: 900, throttle: 1, sideId: "side1" }), false);
  assert.equal(portP1.submit({ type: "cast_sub_skill", shipKey: "sub1", sideId: "side1" }), false);
  assert.equal(portP1.submit(aiActions.retaskScout({ scoutId: allyScout.id, zoneId: 9 })), false);
  assert.equal(portP1.submit(aiActions.retaskScout({ scoutId: enemyScout.id, zoneId: 9 })), false);

  // 同阵营 sideId 附加在合法本席动作上不具跨队授权效力，最多只能作用本席合法槽位。
  assert.equal(portP1.submit({ type: "set_throttle", shipKey: "main", throttle: throttleForGear(1), sideId: "side1" }), true);
  assert.equal(p1.ships.main.throttle, throttleForGear(1), "本席合法槽位应被更新");
  assert.equal(snapshotFleet(p2), beforeP2, "同阵营队友状态不得被修改");
  assert.equal(snapshotFleet(p3), beforeP3, "敌方 P3 状态不得被修改");
  assert.equal(snapshotFleet(p4), beforeP4, "敌方 P4 状态不得被修改");
}

// 4. 动作前后观测及时失效（含成功、拒绝和扣费退款失败），历史观测不可变且无执行能力。
function testObservationInvalidationAndImmutability() {
  const topology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", { main: "haruhi", sub1: "future1096", sub2: "koizumi" }, { x: 240, y: 240, facing: 0 }),
      makeFleetConfig("P2", "side2", { main: "kyon", sub1: "tsuruya", sub2: "asakura" }, { x: 1180, y: 240, facing: Math.PI }),
      makeFleetConfig("P3", "side3", { main: "yuki", sub1: "shamisen", sub2: "kyon" }, { x: 720, y: 1180, facing: -Math.PI / 2 }),
    ],
  });
  const host = createMultiFleetAiHost(topology, { seed: 641 });
  const p1 = host.teamBySeat("P1");
  const port = createActionPort(host, "P1");

  const first = port.observe();
  assert.equal(port.observe(), first, "未提交动作时应复用当前冻结观测");
  assert.throws(() => { first.self.splitLevel = 2; }, TypeError);
  assert.throws(() => { first.visibleHostiles.push({}); }, TypeError);

  // 成功动作：分离 1 级，观测立即更新，历史对象保持旧值。
  assert.equal(port.submit(aiActions.split(1)), true);
  const afterSplit = port.observe();
  assert.notEqual(afterSplit, first);
  assert.equal(first.self.splitLevel, 0, "历史观测必须不可变");
  assert.equal(afterSplit.self.splitLevel, 1, "动作后应立即读取最新状态");
  assert.equal(afterSplit.self.ships.sub1.attached, false);

  // 失败但触发状态变化（眩晕控制锁定 + 外部能量变动 + 未来1096 瞄准失败扣费/退款路径）：必须立即失效观测。
  p1.ships.sub1.stunUntil(host.elapsed + 5);
  setScenarioField(p1.ships.sub1, "energy", 40);
  assert.equal(port.submit(aiActions.setThrottle({ shipKey: "sub1", throttle: throttleForGear(4) })), false);
  const afterLocked = port.observe();
  assert.notEqual(afterLocked, afterSplit, "被拒绝的动作也必须失效观测缓存");
  assert.equal(afterLocked.self.ships.sub1.canControl, false);
  assert.equal(afterLocked.self.ships.sub1.energy, 40);
  assert.equal(afterSplit.self.ships.sub1.canControl, true, "历史观测控制状态保持不变");

  // 未来 1096 副舰施放无效目标（NaN）经历标准执行路径失败退款后，观测同样立即刷新。
  p1.ships.sub1.stunUntil(0);
  setScenarioField(p1.ships.sub1, "energy", p1.ships.sub1.maxEnergy);
  const beforeCast = port.observe();
  setScenarioField(p1.ships.sub1, "hp", p1.ships.sub1.hp - 15);
  assert.equal(port.submit(aiActions.castSubSkill({ shipKey: "sub1", targetX: Number.NaN, targetY: Number.NaN })), false);
  const afterFailedCast = port.observe();
  assert.notEqual(afterFailedCast, beforeCast, "技能施放失败退款路径必须刷新观测");
  assert.equal(afterFailedCast.self.ships.sub1.hp, p1.ships.sub1.hp);
  assert.equal(afterFailedCast.self.ships.sub1.energy, p1.ships.sub1.maxEnergy, "失败退款后应读取到最新能量");
}

// 5. 多来源 ObservationView 与策略程序纯查询边界 + 旧 A/B 同种子重放与兼容投影一致性。
function testObservationViewAndLegacyReplayParity() {
  const topology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", { main: "haruhi", sub1: "koizumi", sub2: "asakura" }, { x: 240, y: 240, facing: 0 }),
      makeFleetConfig("P2", "side2", { main: "kyon", sub1: "tsuruya", sub2: "yuki" }, { x: 290, y: 240, facing: Math.PI }),
      makeFleetConfig("P3", "side3", { main: "shamisen", sub1: "asakura", sub2: "koizumi" }, { x: 240, y: 290, facing: -Math.PI / 2 }),
    ],
  });
  const host = createMultiFleetAiHost(topology, { seed: 651 });
  placeFleet(host.teamBySeat("P1"), 240, 240);
  placeFleet(host.teamBySeat("P2"), 290, 240);
  placeFleet(host.teamBySeat("P3"), 240, 290);
  host.refreshVisibility();

  const obs = createActionPort(host, "P1").observe();
  const view = new ObservationView();
  assert.ok(view.visibleHostiles(obs).length >= 2);
  assert.ok(view.visibleHostilesBySeat(obs, "P2").length > 0);
  assert.ok(view.visibleHostilesBySeat(obs, "P3").length > 0);
  assert.deepEqual(view.visibleHostilesBySeat(obs, "P1"), []);
  assert.deepEqual(view.visibleHostilesBySeat(obs, "toString"), []);
  assert.deepEqual(view.hostileSourceSeats(obs), ["P2", "P3"]);
  assert.throws(() => view.visibleHostiles(obs).push({}), TypeError);
  assert.throws(() => view.hostileSourceSeats(obs).push("P9"), TypeError);

  // 策略程序的多来源只读查询不拥有动作端口、随机流或调度写权。
  const program = createPolicyProgram(
    (key) => {
      if (key === "obs") return obs;
      throw new Error(`纯查询不应读取能力 ${key}`);
    },
    (key) => {
      throw new Error(`纯查询不应调用操作 ${key}`);
    },
  );
  assert.equal(POLICY_PROGRAM_EFFECTS.visibleHostiles, undefined);
  assert.equal(POLICY_PROGRAM_EFFECTS.visibleHostilesBySeat, undefined);
  assert.equal(POLICY_PROGRAM_EFFECTS.hostileEffects, undefined);
  assert.equal(program.run("visibleHostiles").length, obs.visibleHostiles.length);
  assert.equal(program.run("visibleHostilesBySeat", "P2").length, view.visibleHostilesBySeat(obs, "P2").length);
  assert.deepEqual(program.run("visibleHostilesBySeat", "constructor"), []);
  assert.equal(program.run("hostileEffects"), obs.hostileEffects);

  // 旧 A/B 同种子重放与兼容投影逐字节一致。
  const runLegacyTrace = () => {
    __resetEntityIds(1);
    const sim = new MatchSimulation({
      mode: "pvp",
      seed: 20261127,
      aiSeats: ["A", "B"],
      teamLoadouts: {
        A: { main: "yuki", sub1: "koizumi", sub2: "asakura" },
        B: { main: "shamisen", sub1: "haruhi", sub2: "future1096" },
      },
    });
    const obsA0 = buildObservation(sim, "A");
    const obsB0 = buildObservation(sim, "B");
    assert.equal(obsA0.schema, OBSERVATION_SCHEMA, "旧 A/B 必须保持原观测 schema");
    assert.equal(obsB0.schema, OBSERVATION_SCHEMA);
    for (let tick = 0; tick < 180; tick += 1) {
      sim.update(TICK_DT);
    }
    return {
      state: JSON.stringify(sim.serializeState()),
      debugA: JSON.stringify(sim.botBySeat("A").serializeDebugState()),
      debugB: JSON.stringify(sim.botBySeat("B").serializeDebugState()),
      obsA: JSON.stringify(buildObservation(sim, "A")),
      obsB: JSON.stringify(buildObservation(sim, "B")),
      rngA: sim.aiRng.A.next(),
      rngB: sim.aiRng.B.next(),
    };
  };
  const firstRun = runLegacyTrace();
  const secondRun = runLegacyTrace();
  assert.deepEqual(secondRun, firstRun, "相同种子与旧 A/B 席位重放必须产出完全一致的状态、观测、调试摘要与子流");
}

// 6. 无效席位、缺少本席参数、多席/非 A/B 拓扑 AI 配置按定稿范围明确拒绝，旧单人/双席 AI 保持正常。
function testInvalidAndUnsupportedAiConfigurations() {
  const fourSeatTopology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", { main: "haruhi", sub1: "koizumi", sub2: "asakura" }, { x: 200, y: 200, facing: 0 }),
      makeFleetConfig("P2", "side1", { main: "yuki", sub1: "kyon", sub2: "tsuruya" }, { x: 200, y: 600, facing: 0 }),
      makeFleetConfig("P3", "side2", { main: "koizumi", sub1: "future1096", sub2: "tsuruya" }, { x: 1200, y: 200, facing: Math.PI }),
      makeFleetConfig("P4", "side2", { main: "kyon", sub1: "asakura", sub2: "shamisen" }, { x: 1200, y: 600, facing: Math.PI }),
    ],
  });
  const legacyAbTopology = normalizeMatchTopology({});
  const nonAbTwoFleetTopology = normalizeMatchTopology({
    fleets: [
      makeFleetConfig("P1", "side1", { main: "haruhi", sub1: "koizumi", sub2: "asakura" }, { x: 200, y: 200, facing: 0 }),
      makeFleetConfig("P2", "side2", { main: "kyon", sub1: "tsuruya", sub2: "yuki" }, { x: 1200, y: 200, facing: Math.PI }),
    ],
  });

  // 拓扑支持范围判断与守卫。
  assert.equal(isSupportedAiTopology(legacyAbTopology), true);
  assert.equal(isSupportedAiTopology(fourSeatTopology), false);
  assert.equal(isSupportedAiTopology(nonAbTwoFleetTopology), false);

  assert.doesNotThrow(() => assertSupportedAiSeatsForTopology(fourSeatTopology, []), "纯真人多席（无 AI 席位）不应被 AI 守卫误拒");
  assert.throws(() => assertSupportedAiSeatsForTopology(fourSeatTopology, ["P1"]), /不支持.*AI/, "多席拓扑启用 AI 必须明确拒绝");
  assert.throws(() => assertSupportedAiSeatsForTopology(nonAbTwoFleetTopology, ["P2"]), /不支持.*AI/, "非 A/B 拓扑启用 AI 必须明确拒绝");
  assert.throws(() => assertSupportedAiSeatsForTopology(legacyAbTopology, ["C"]), /未注册|非法/, "非法席位必须明确拒绝");

  // 多席宿主上调用 createAiRunner 必须明确拒绝，不回退 A/B 或偷偷启动旧策略。
  const multiHost = createMultiFleetAiHost(fourSeatTopology, { seed: 661 });
  assert.throws(() => createAiRunner(multiHost, "P1"), /不支持.*AI/);
  assert.throws(() => createAiRunner(multiHost, "A"), /未知席位|未注册/);
  assert.throws(() => createActionPort(multiHost, "P9"), /未知席位/);
  assert.throws(() => createActionPort(multiHost, "toString"), /未知席位/);
  assert.throws(() => buildObservation(multiHost, "P9"), /未知席位/);
  assert.throws(() => buildMultiFleetObservation(multiHost, "constructor"), /未知席位/);

  // 缺失独立随机流时拒绝启动 runner。
  const legacySim = new MatchSimulation({ mode: "pvp", seed: 662, aiSeats: [] });
  const brokenMatch = {
    allTeams: () => legacySim.allTeams(),
    teamBySeat: (seat) => legacySim.teamBySeat(seat),
    enemyTeamsOf: (seat) => legacySim.enemyTeamsOf(seat),
    alliedTeamsOf: (seat) => legacySim.alliedTeamsOf(seat),
    enemyTeamBySeat: (seat) => legacySim.enemyTeamBySeat(seat),
    seatOrder: legacySim.seatOrder,
    relations: legacySim.relations,
    aiRng: {},
  };
  assert.throws(() => createAiRunner(brokenMatch, "B"), /随机流/);

  // AI 参数按注册席位校验：拒绝未注册席位键、非法字段与缺失必选本席参数。
  assert.throws(
    () => validateAiParamsForSeats({ C: { overrides: { profile: { stuckTrigger: 1 } } } }, ["A", "B"]),
    /未注册|非法/,
  );
  assert.throws(
    () => validateAiParamsForSeats({ A: { unknownKey: 1 } }, ["A", "B"]),
    /未知/,
  );
  assert.throws(
    () => validateAiParamsForSeats({ A: {} }, ["A", "B"], { requiredSeats: ["A", "B"] }),
    /缺少.*B/,
  );
  assert.throws(
    () => resolveSeatAiParams("B", { registeredSeats: ["A", "B"], aiParams: { A: {} }, requireSeatEntry: true }),
    /缺少.*B/,
  );
  const resolved = resolveSeatAiParams("B", {
    registeredSeats: ["A", "B"],
    difficulty: "hard",
    aiParams: { B: { overrides: { profile: { stuckTrigger: 1.8 } } } },
    requireSeatEntry: true,
  });
  assert.equal(resolved.profile.stuckTrigger, 1.8);
  assert.equal(resolved.difficulty.reactionMult, resolveAiParams({ difficulty: "hard" }).difficulty.reactionMult);

  // MatchSimulation 构造时若 aiParams 包含未注册席位也应明确拒绝。
  assert.throws(
    () => new MatchSimulation({ mode: "ai", seed: 663, aiParams: { P9: {} } }),
    /未注册|非法/,
  );

  // 未显式传入 fleets（默认 A/B 拓扑）时，保留旧 A/B 大小写与空白归一化语义，同时拒绝归一化后仍未注册的席位。
  for (const legacyValidAiSeats of [["b"], " b ", { b: true }, { " a ": false, " b ": true }]) {
    const resolvedMode = resolveBattleMode({ mode: "pvp", aiSeats: legacyValidAiSeats });
    assert.deepEqual(resolvedMode.aiSeats, ["B"], `默认拓扑应兼容旧写法并归一化为 ["B"]：${JSON.stringify(legacyValidAiSeats)}`);
    assert.equal(resolvedMode.teamNames.B, "统合思念体AI舰队");
    const legacySimFromValid = new MatchSimulation({ mode: "pvp", seed: 667, aiSeats: legacyValidAiSeats });
    assert.deepEqual(legacySimFromValid.aiSeats, ["B"]);
  }
  const legacySeatSim = new MatchSimulation({ mode: "pvp", seed: 668, aiSeats: " b ", legacyAiSeats: ["b"] });
  assert.deepEqual(legacySeatSim.aiSeats, ["B"]);
  assert.equal(legacySeatSim.botBySeat("B").legacy, true);

  for (const invalidAiSeats of [["P9"], { P9: true }, { P9: false }, "P9", ["A", "P9"], ["b", "P9"], ["   "]]) {
    assert.throws(
      () => resolveBattleMode({ mode: "pvp", aiSeats: invalidAiSeats }),
      /非法 AI 席位/,
      `resolveBattleMode 必须拒绝默认拓扑下的无效 aiSeats：${JSON.stringify(invalidAiSeats)}`,
    );
    assert.throws(
      () => new MatchSimulation({ mode: "pvp", seed: 665, aiSeats: invalidAiSeats }),
      /非法 AI 席位/,
      `MatchSimulation 必须拒绝默认拓扑下的无效 aiSeats：${JSON.stringify(invalidAiSeats)}`,
    );
  }
  assert.throws(
    () => new MatchSimulation({ mode: "ai", seed: 666, legacyAiSeats: ["P9"] }),
    /非法 AI 席位/,
    "MatchSimulation 必须拒绝默认拓扑下的无效 legacyAiSeats",
  );
  // 显式 fleets 拓扑仍保持大小写敏感，不自动大写。
  const explicitAbFleets = legacyAbTopology.fleets.map(({ seat, sideId, name, loadout, spawn }) => ({
    seat, sideId, name, loadout, spawn,
  }));
  const explicitFourSeatFleets = fourSeatTopology.fleets.map(({ seat, sideId, name, loadout, spawn }) => ({
    seat, sideId, name, loadout, spawn,
  }));
  assert.throws(
    () => resolveBattleMode({ mode: "pvp", fleets: explicitAbFleets, aiSeats: ["b"] }),
    /非法 AI 席位/,
    "显式 fleets 拓扑下 AI 席位必须保持大小写敏感",
  );

  // 显式多席带 aiSeats 的 battleMode 解析明确拒绝。
  assert.throws(
    () => resolveBattleMode({ fleets: explicitFourSeatFleets, aiSeats: ["P1"] }),
    /不支持.*AI/,
  );
  assert.deepEqual(normalizeAiSeats("ai"), ["B"], "旧无注册集合调用仍保持默认 B");

  // 旧单人 AI 必须保持可玩。
  const solo = new MatchSimulation({ mode: "ai", seed: 664 });
  assert.deepEqual(solo.aiSeats, ["B"]);
  for (let tick = 0; tick < 60; tick += 1) solo.update(TICK_DT);
  assert.ok(solo.botBySeat("B").serializeDebugState().seat === "B");
}

testObservationIsolationAndWhitelist();
testMultiSourceHostileEffectsAndAttribution();
testActionAuthorizationIsolation();
testObservationInvalidationAndImmutability();
testObservationViewAndLegacyReplayParity();
testInvalidAndUnsupportedAiConfigurations();

console.log("多舰队 AI 观测与本席动作边界校验通过：权限隔离、多来源归属、防越权动作、观测失效、重放兼容与支持范围守卫均符合契约。");
