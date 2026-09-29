import { GAME_VERSION } from "../shared/game-version.js";
import { buildServerMatchStatisticsRecord, buildSoloStatisticsRecord } from "../server/statistics-records.js";
import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStatisticsStore } from "../server/statistics-store.js";
import { MatchSimulation } from "../shared/game-core.js";

const dataDir = await mkdtemp(join(tmpdir(), "haruhi-statistics-"));
let time = Date.UTC(2026, 7, 13, 12, 0, 0);

function participant(seat, clientId, loadout) {
  return {
    seat,
    isBot: false,
    player: { clientId, nickname: `玩家${seat}`, faction: seat === "A" ? "blue" : "red", locale: "zh" },
    loadout,
    finalState: {
      splitLevel: 2,
      hullRatio: seat === "A" ? 0.5 : 0,
      ships: {
        main: { alive: seat === "A", hp: 50, maxHp: 100, energy: 12, maxEnergy: 80 },
      },
    },
  };
}

const lineupA = { main: "haruhi", sub1: "yuki", sub2: "koizumi" };
const lineupB = { main: "shamisen", sub1: "asakura", sub2: "future1096" };

function record(id, mode, winnerSeat, participants) {
  return {
    id,
    mode,
    source: mode === "solo" ? "client_solo" : "server",
    verified: mode === "multiplayer",
    gameVersion: GAME_VERSION,
    buildId: "test-build",
    rulesetVersion: "test-ruleset",
    startedAt: time - 90_000,
    finishedAt: time,
    durationSeconds: 90,
    tick: 2700,
    winnerSeat,
    participants,
    telemetry: {
      teams: {
        A: { attacks: { projectileFired: 30, projectileHits: 14 }, damageDealt: { projectile: 42 } },
        B: { attacks: { projectileFired: 22, projectileHits: 8 }, damageDealt: { projectile: 25 } },
      },
    },
  };
}

try {
  const simulation = new MatchSimulation({ mode: "ai" });
  for (let index = 0; index < 60; index += 1) simulation.update(1 / 30);
  assert.equal(Object.hasOwn(simulation.serializeState(), "telemetry"), false, "统计计数不得进入实时网络快照");
  assert.ok(Buffer.byteLength(JSON.stringify(simulation.statisticsSummary())) < 4096, "单局结算摘要应保持小体积");

  const store = createStatisticsStore({ dataDir, hashSalt: "测试盐", now: () => time });
  await store.ready();

  const soloResult = await store.record(record("solo:event-1", "solo", "A", [
    participant("A", "solo-player", lineupA),
    { ...participant("B", "", lineupB), isBot: true, player: {} },
  ]));
  assert.equal(soloResult.accepted, true, "合法单人结算应写入");

  time += 1000;
  const pvpResult = await store.record(record("server:room:1", "multiplayer", "B", [
    participant("A", "player-a", lineupA),
    participant("B", "player-b", lineupB),
  ]), { trusted: true });
  assert.equal(pvpResult.accepted, true, "服务端多人结算应写入");
  assert.equal((await store.record(record("server:room:1", "multiplayer", "B", [
    participant("A", "player-a", lineupA),
    participant("B", "player-b", lineupB),
  ]), { trusted: true })).reason, "duplicate", "重复对局必须去重");

  const publicStats = store.publicLeaderboard();
  assert.equal(publicStats.modes.solo.matches, 1, "单人对局数错误");
  assert.deepEqual(publicStats.modes.solo.lineups[0], { lineup: lineupA, games: 1, winRate: 100 }, "单人阵容聚合错误");
  assert.equal(publicStats.modes.multiplayer.matches, 1, "多人对局数应按整局而非双方出场计数");
  assert.equal(publicStats.modes.multiplayer.lineups.length, 2, "多人双方阵容都应计入出场");
  assert.equal(publicStats.modes.multiplayer.lineups.find((row) => row.lineup.main === "haruhi").winRate, 0, "败方胜率错误");
  assert.equal(publicStats.modes.multiplayer.lineups.find((row) => row.lineup.main === "shamisen").winRate, 100, "胜方胜率错误");
  assert.equal(JSON.stringify(publicStats).includes("player-a"), false, "公开榜单不得泄露玩家标识");
  assert.equal(JSON.stringify(publicStats).includes("玩家A"), false, "公开榜单不得泄露玩家昵称");

  await store.flush();
  const log = await readFile(join(dataDir, "matches-2026-08.jsonl"), "utf8");
  assert.equal(log.trim().split("\n").length, 2, "每局只应追加一条日志");
  assert.equal(log.includes("solo-player"), false, "磁盘档案不得保存原始匿名客户端标识");
  assert.equal(log.includes("player-a"), false, "磁盘档案不得保存原始多人客户端标识");
  assert.ok(log.includes("damageDealt"), "磁盘档案应保留战斗汇总供后续分析");

  const restored = createStatisticsStore({ dataDir, hashSalt: "测试盐", now: () => time });
  await restored.ready();
  assert.deepEqual(restored.publicLeaderboard().modes, publicStats.modes, "重启后榜单应从追加日志完整恢复");
  assert.equal(restored.diagnostics().trackedPlayers, 3, "私有玩家聚合应覆盖单人与多人玩家");

  const historical = { ...record("history:1", "multiplayer", "A", [
    participant("A", "player-a", lineupA), participant("B", "player-b", lineupB),
  ]), gameVersion: "v0.2" };
  await store.record(historical, { trusted: true });
  const legacy = { ...historical, id: "legacy:1" };
  delete legacy.gameVersion;
  await store.record(legacy, { trusted: true });
  assert.equal(store.publicLeaderboard().modes.multiplayer.matches, 1, "历史记录不应污染当前版本");
  assert.equal(store.publicLeaderboard("v0.2").modes.multiplayer.lineups.find(row => row.lineup.main === "haruhi").winRate, 100);
  assert.equal(store.publicLeaderboard("unversioned").modes.multiplayer.matches, 1, "旧日志应进入未标记版本桶");
  assert.equal(store.publicLeaderboard("v99.0").modes.multiplayer.matches, 0, "空版本不得回退到全量数据");
  const spoofed = { ...record("solo:spoof", "solo", "A", [participant("A", "solo-player", lineupA)]), gameVersion: "v99.0" };
  assert.equal((await store.record(spoofed)).reason, "version_mismatch", "不能由客户端创造未知版本");
  const hotfix = { ...historical, id: "hotfix:1", gameVersion: GAME_VERSION, buildId: "hotfix-other-sha" };
  await store.record(hotfix, { trusted: true });
  assert.equal(store.publicLeaderboard().modes.multiplayer.matches, 2, "热更新应归入同一公开版本");
  const reloaded = createStatisticsStore({ dataDir, now: () => time });
  await reloaded.ready();
  for (const version of [GAME_VERSION, "v0.2", "unversioned"]) {
    assert.deepEqual(reloaded.publicLeaderboard(version).modes, store.publicLeaderboard(version).modes, "重启后版本分桶不一致");
  }
  assert.deepEqual(new Set(reloaded.publicLeaderboard().versions), new Set([GAME_VERSION, "v0.2", "unversioned"]));
  const authoritative = buildServerMatchStatisticsRecord({
    room: { id: "record-test", mode: "pvp", match: simulation, seats: { A: "a", B: "b" }, createdAt: time },
    getPlayerById: () => ({ gameVersion: "v99.0" }),
  });
  assert.equal(authoritative.gameVersion, GAME_VERSION, "多人版本必须来自服务端");
  assert.equal(buildSoloStatisticsRecord({ gameVersion: "v0.2" }, {}).gameVersion, "v0.2", "单人不得被重标为服务端版本");
  assert.equal(buildSoloStatisticsRecord({}, {}).gameVersion, undefined, "旧端缺失版本不得被猜测填充");
  const oldClient = { ...spoofed, id: "solo:old-client", gameVersion: "v0.2" };
  assert.equal((await store.record(oldClient)).accepted, true, "已发布旧版客户端仍应归入原版本");
  await store.flush();
  const schema1 = { ...legacy, id: "schema1:raw", schemaVersion: 1 };
  const logPath = join(dataDir, "matches-2026-08.jsonl");
  await appendFile(logPath, JSON.stringify(schema1) + "\n");
  const beforeRestore = await readFile(logPath, "utf8");
  const migrated = createStatisticsStore({ dataDir, now: () => time });
  await migrated.ready();
  assert.equal(migrated.publicLeaderboard("unversioned").modes.multiplayer.matches, 2);
  assert.equal(await readFile(logPath, "utf8"), beforeRestore, "加载旧日志不得覆盖原始数据");

  console.log("胜率统计存储校验通过：去重、匿名化、持久化恢复、单人/多人聚合与公开字段隔离均正常。");
} finally {
  await rm(dataDir, { recursive: true, force: true });
}
