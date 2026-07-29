import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { createAccountStore } from "../server/account-store.js";
import { settleCompletedRoom } from "../server/competitive-settlement.js";

function seedLegacyRatings(databasePath) {
  const db = new Database(databasePath);
  const createdAt = 1_700_000_000_000;
  db.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
    CREATE TABLE users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE,
      password_salt BLOB NOT NULL, password_hash BLOB NOT NULL, signature TEXT NOT NULL DEFAULT '',
      avatar_key TEXT, loadout_json TEXT, username_changed_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE ratings (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, mode TEXT NOT NULL, elo INTEGER NOT NULL,
      wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, games INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, mode)
    );
    CREATE INDEX ratings_leaderboard ON ratings(mode, elo DESC, games DESC);
    CREATE TABLE matches (
      id TEXT PRIMARY KEY, mode TEXT NOT NULL, winner_alliance_id TEXT NOT NULL,
      finished_at INTEGER NOT NULL, settled_at INTEGER NOT NULL
    );
    CREATE TABLE match_players (
      match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, alliance_id TEXT NOT NULL,
      elo_before INTEGER NOT NULL, elo_after INTEGER NOT NULL, elo_delta INTEGER NOT NULL, outcome TEXT NOT NULL,
      PRIMARY KEY (match_id, user_id)
    );
    CREATE INDEX match_players_user ON match_players(user_id, match_id);
  `);
  db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)").run(createdAt);
  db.prepare(
    `INSERT INTO users (
      id, username, username_key, password_salt, password_hash, signature,
      avatar_key, loadout_json, username_changed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, '', NULL, NULL, NULL, ?, ?)`,
  ).run("legacy-user", "Legacy", "legacy", Buffer.alloc(16), Buffer.alloc(64), createdAt, createdAt);
  const insertRating = db.prepare(
    "INSERT INTO ratings (user_id, mode, elo, wins, losses, games, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  insertRating.run("legacy-user", "pvp2v2", 1148, 12, 3, 15, createdAt);
  insertRating.run("legacy-user", "stellar3v3", 872, 2, 9, 11, createdAt);
  db.close();
}

function seedInterruptedV1Schema(databasePath) {
  const db = new Database(databasePath);
  const createdAt = 1_700_000_000_000;
  db.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
    CREATE TABLE users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE,
      password_salt BLOB NOT NULL, password_hash BLOB NOT NULL, signature TEXT NOT NULL DEFAULT '',
      avatar_key TEXT, loadout_json TEXT, username_changed_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
  `);
  db.prepare(
    `INSERT INTO users (
      id, username, username_key, password_salt, password_hash, signature,
      avatar_key, loadout_json, username_changed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, '', NULL, NULL, NULL, ?, ?)`,
  ).run("interrupted-user", "Interrupted", "interrupted", Buffer.alloc(16), Buffer.alloc(64), createdAt, createdAt);
  db.close();
}

const tempDir = await mkdtemp(path.join(tmpdir(), "tdos-unified-rating-"));
const legacyPath = path.join(tempDir, "legacy.sqlite");
const interruptedV1Path = path.join(tempDir, "interrupted-v1.sqlite");
const freshPath = path.join(tempDir, "fresh.sqlite");
let migratedStore = null;
let store = null;

try {
  seedLegacyRatings(legacyPath);
  migratedStore = createAccountStore({
    databasePath: legacyPath,
    sessionSecret: "unified-rating-migration-test-session-secret",
  });
  const legacyRating = migratedStore.getRating("legacy-user");
  assert.deepEqual(
    { userId: legacyRating.userId, elo: legacyRating.elo, wins: legacyRating.wins, losses: legacyRating.losses, games: legacyRating.games },
    { userId: "legacy-user", elo: 1000, wins: 0, losses: 0, games: 0 },
    "the unified-rating migration should reset every legacy account into one global rating",
  );
  migratedStore.close();
  migratedStore = null;

  const migratedDb = new Database(legacyPath, { readonly: true });
  assert.deepEqual(
    migratedDb.prepare("PRAGMA table_info(ratings)").all().map((column) => column.name),
    ["user_id", "elo", "wins", "losses", "games", "updated_at"],
    "the ratings table should no longer contain a per-mode column",
  );
  assert.equal(migratedDb.prepare("SELECT COUNT(*) AS count FROM ratings").get().count, 1);
  migratedDb.close();

  seedInterruptedV1Schema(interruptedV1Path);
  const accountStoreUrl = pathToFileURL(path.resolve("server/account-store.js")).href;
  const interruptedStartup = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { createAccountStore } from ${JSON.stringify(accountStoreUrl)};
       const store = createAccountStore({
         databasePath: process.env.UNIFIED_RATING_TEST_DATABASE,
         sessionSecret: "unified-rating-interrupted-v1-session-secret",
       });
       store.close();`,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, UNIFIED_RATING_TEST_DATABASE: interruptedV1Path },
    },
  );
  assert.equal(
    interruptedStartup.status,
    0,
    `a partially initialized v1 database should resume migration without recreating existing tables: ${interruptedStartup.stderr}`,
  );
  migratedStore = createAccountStore({
    databasePath: interruptedV1Path,
    sessionSecret: "unified-rating-interrupted-v1-session-secret",
  });
  assert.deepEqual(
    migratedStore.getRating("interrupted-user"),
    {
      userId: "interrupted-user",
      elo: 1000,
      wins: 0,
      losses: 0,
      games: 0,
      updatedAt: 1_700_000_000_000,
    },
    "a partially initialized v1 database should resume migration without recreating existing tables",
  );
  migratedStore.close();
  migratedStore = null;

  store = createAccountStore({
    databasePath: freshPath,
    sessionSecret: "unified-rating-store-test-session-secret",
  });
  const users = await Promise.all(
    ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"].map((username) =>
      store.register({ username, password: `strong-password-${username}` }),
    ),
  );
  const [alpha, bravo, charlie, delta, echo, foxtrot] = users;

  const oneVsOne = settleCompletedRoom(store, {
    id: "public-1v1",
    mode: "pvp",
    visibility: "public",
    result: {
      winnerAllianceId: "A",
      finishedAt: 1_700_000_100_000,
      players: [
        { seat: "A", allianceId: "A", userId: alpha.id, isBot: false },
        { seat: "B", allianceId: "B", userId: bravo.id, isBot: false },
      ],
    },
  });
  assert.equal(oneVsOne.settled, true, "a complete public 1v1 should settle the global rating");
  assert.equal(store.getRating(alpha.id).elo, 1016, "equal-rating 1v1 winners should receive 16 Elo");
  assert.equal(store.getRating(bravo.id).elo, 984, "equal-rating 1v1 losers should lose 16 Elo");

  const twoVsTwo = settleCompletedRoom(store, {
    id: "public-2v2",
    mode: "pvp2v2",
    visibility: "public",
    result: {
      winnerAllianceId: "A",
      finishedAt: 1_700_000_101_000,
      players: [
        { seat: "A1", allianceId: "A", userId: alpha.id, isBot: false },
        { seat: "A2", allianceId: "A", userId: charlie.id, isBot: false },
        { seat: "B1", allianceId: "B", userId: delta.id, isBot: false },
        { seat: "B2", allianceId: "B", userId: echo.id, isBot: false },
      ],
    },
  });
  assert.equal(twoVsTwo.settled, true, "a complete public 2v2 should share the same global rating");
  assert.equal(store.getRating(alpha.id).games, 2, "a 2v2 result should increment the same rating row used by 1v1");

  const threeVsThree = settleCompletedRoom(store, {
    id: "public-3v3",
    mode: "stellar3v3",
    visibility: "public",
    result: {
      winnerAllianceId: "A",
      finishedAt: 1_700_000_102_000,
      players: [
        { seat: "A1", allianceId: "A", userId: alpha.id, isBot: false },
        { seat: "A2", allianceId: "A", userId: charlie.id, isBot: false },
        { seat: "A3", allianceId: "A", userId: foxtrot.id, isBot: false },
        { seat: "B1", allianceId: "B", userId: bravo.id, isBot: false },
        { seat: "B2", allianceId: "B", userId: delta.id, isBot: false },
        { seat: "B3", allianceId: "B", userId: echo.id, isBot: false },
      ],
    },
  });
  assert.equal(threeVsThree.settled, true, "a complete public 3v3 should share the same global rating");
  assert.equal(store.getRating(alpha.id).games, 3, "all three modes should accumulate into one total games counter");

  const privateBefore = store.getRating(alpha.id).elo;
  const privateMatch = settleCompletedRoom(store, {
    id: "private-1v1",
    mode: "pvp",
    visibility: "private",
    result: {
      winnerAllianceId: "A",
      finishedAt: 1_700_000_103_000,
      players: [
        { seat: "A", allianceId: "A", userId: alpha.id, isBot: false },
        { seat: "B", allianceId: "B", userId: bravo.id, isBot: false },
      ],
    },
  });
  assert.equal(privateMatch.settled, false, "private rooms should remain unranked");
  assert.equal(store.getRating(alpha.id).elo, privateBefore, "private results must not alter the global rating");

  store.close();
  store = null;
  console.log("unified rating verification passed");
} finally {
  migratedStore?.close();
  store?.close();
  await rm(tempDir, { recursive: true, force: true });
}
