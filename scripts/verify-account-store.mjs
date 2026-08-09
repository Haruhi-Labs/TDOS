import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let createAccountStore;
try {
  ({ createAccountStore } = await import("../server/account-store.js"));
} catch (_error) {
  // The first RED run intentionally reaches this branch before the module exists.
}

assert.equal(
  typeof createAccountStore,
  "function",
  "account storage should export createAccountStore(options)",
);

const tempDir = await mkdtemp(path.join(tmpdir(), "tdos-account-store-"));
const databasePath = path.join(tempDir, "accounts.sqlite");

let store = null;
let announcementStore = null;
try {
  store = createAccountStore({
    databasePath,
    sessionSecret: "test-session-secret-that-is-long-enough",
  });

  const registration = store.register({ username: "Haruhi", password: "strong-password-123" });
  const eventLoopTurn = new Promise((resolve) => setImmediate(() => resolve("yielded")));
  assert.equal(
    await Promise.race([eventLoopTurn, Promise.resolve(registration).then(() => "registered")]),
    "yielded",
    "password hashing must yield the game server event loop",
  );
  const haruhi = await registration;
  assert.equal(haruhi.username, "Haruhi", "registration should retain the username");
  assert.ok(haruhi.id, "registration should assign a persistent user ID");
  const startingRating = store.getRating(haruhi.id);
  assert.equal(startingRating.elo, 1000, "the global Elo should start at 1000");
  assert.deepEqual(
    { wins: startingRating.wins, losses: startingRating.losses, games: startingRating.games },
    { wins: 0, losses: 0, games: 0 },
    "a new global rating should start with no recorded games",
  );
  await assert.rejects(
    () => store.register({ username: "haruhi", password: "another-strong-password" }),
    /username/i,
    "usernames should be unique without case distinctions",
  );
  assert.equal(
    await store.authenticate({ username: "Haruhi", password: "wrong-password" }),
    null,
    "authentication should reject a wrong password",
  );
  assert.equal(
    (await store.authenticate({ username: "haruhi", password: "strong-password-123" })).id,
    haruhi.id,
    "authentication should accept the registered username without case distinctions",
  );

  const session = store.createSession(haruhi.id);
  assert.ok(session.token.length >= 32, "a session should return an opaque random token");
  assert.equal(store.getSessionUser(session.token).id, haruhi.id, "the token should resolve its user");
  const databaseBytes = await readFile(databasePath);
  assert.equal(
    databaseBytes.includes(Buffer.from(session.token)),
    false,
    "the database must never store the raw browser session token",
  );
  store.revokeSession(session.token);
  assert.equal(store.getSessionUser(session.token), null, "logout should invalidate the session");

  const yuki = await store.register({ username: "Yuki", password: "strong-password-456" });
  const mikuru = await store.register({ username: "Mikuru", password: "strong-password-789" });
  const itsuki = await store.register({ username: "Itsuki", password: "strong-password-012" });
  const settlement = store.settleCompetitiveMatch({
    matchId: "test-match-1",
    mode: "pvp2v2",
    winnerAllianceId: "A",
    finishedAt: 1_700_000_000_000,
    players: [
      { userId: haruhi.id, allianceId: "A" },
      { userId: yuki.id, allianceId: "A" },
      { userId: mikuru.id, allianceId: "B" },
      { userId: itsuki.id, allianceId: "B" },
    ],
  });
  assert.equal(settlement.settled, true, "a human 2v2 result should settle once");
  assert.equal(store.getRating(haruhi.id).elo, 1016, "equal-rating winners should gain 16 Elo");
  assert.equal(store.getRating(mikuru.id).elo, 984, "equal-rating losers should lose 16 Elo");
  const replay = store.settleCompetitiveMatch({
    matchId: "test-match-1",
    mode: "pvp2v2",
    winnerAllianceId: "A",
    finishedAt: 1_700_000_000_000,
    players: [
      { userId: haruhi.id, allianceId: "A" },
      { userId: yuki.id, allianceId: "A" },
      { userId: mikuru.id, allianceId: "B" },
      { userId: itsuki.id, allianceId: "B" },
    ],
  });
  assert.equal(replay.settled, false, "replaying a completed match ID must not settle twice");
  assert.equal(store.getRating(haruhi.id).elo, 1016, "idempotency must retain the first Elo result");
  assert.equal(store.getLeaderboard(1)[0].userId, haruhi.id, "leaderboard should sort by Elo");

  const laterSettlement = store.settleCompetitiveMatch({
    matchId: "test-match-2",
    mode: "stellar3v3",
    winnerAllianceId: "B",
    finishedAt: 1_700_000_001_000,
    players: [
      { userId: haruhi.id, allianceId: "A" },
      { userId: yuki.id, allianceId: "A" },
      { userId: mikuru.id, allianceId: "B" },
      { userId: itsuki.id, allianceId: "B" },
    ],
  });
  assert.equal(laterSettlement.settled, true, "a later settled match should be available to history queries");
  const haruhiHistory = store.getMatchHistory(haruhi.id, 20);
  assert.deepEqual(
    haruhiHistory.map((entry) => entry.matchId),
    ["test-match-2", "test-match-1"],
    "match history should return the signed-in player's newest settled matches first",
  );
  assert.deepEqual(
    haruhiHistory[0],
    {
      matchId: "test-match-2",
      mode: "stellar3v3",
      outcome: "loss",
      eloBefore: 1016,
      eloAfter: 999,
      eloDelta: -17,
      finishedAt: 1_700_000_001_000,
    },
    "match history should preserve the player's recorded outcome and Elo change",
  );
  assert.equal(store.getMatchHistory(haruhi.id, 1).length, 1, "match history should honor a requested recent-result limit");
  const unplayed = await store.register({ username: "Kyon", password: "strong-password-321" });
  assert.deepEqual(store.getMatchHistory(unplayed.id, 20), [], "match history must never return another account's matches");

  const announcementDatabasePath = path.join(tempDir, "announcements.sqlite");
  const releaseNotes = [
    {
      id: "v-test-1",
      version: "1.0.0-test",
      publishedAt: "2026-08-01T00:00:00.000Z",
      title: "First release",
      changes: ["First change"],
    },
    {
      id: "v-test-2",
      version: "1.1.0-test",
      publishedAt: "2026-08-02T00:00:00.000Z",
      title: "Second release",
      changes: ["Second change"],
    },
  ];
  announcementStore = createAccountStore({
    databasePath: announcementDatabasePath,
    sessionSecret: "announcement-session-secret-that-is-long-enough",
    releaseNotes,
    clock: () => 1_800_000_000_000,
  });
  const announcementUser = await announcementStore.register({ username: "Nagato", password: "strong-password-654" });
  const initialAnnouncements = announcementStore.getAnnouncements(announcementUser.id);
  assert.deepEqual(
    initialAnnouncements.map(({ id, version, readAt }) => ({ id, version, readAt })),
    [
      { id: "v-test-2", version: "1.1.0-test", readAt: null },
      { id: "v-test-1", version: "1.0.0-test", readAt: null },
    ],
    "announcements should be synchronized and returned newest first for the signed-in account",
  );
  const acknowledged = announcementStore.markAnnouncementRead(announcementUser.id, "v-test-2");
  assert.equal(acknowledged.readAt, 1_800_000_000_000, "acknowledging an announcement should record the account-specific read time");
  assert.equal(
    announcementStore.markAnnouncementRead(announcementUser.id, "v-test-2").readAt,
    acknowledged.readAt,
    "acknowledging the same announcement twice must be idempotent",
  );
  const anotherUser = await announcementStore.register({ username: "Asahina", password: "strong-password-987" });
  assert.equal(
    announcementStore.getAnnouncements(anotherUser.id)[0].readAt,
    null,
    "one account reading an announcement must not mark it read for another account",
  );
  announcementStore.close();
  const revisedReleaseNote = {
    ...releaseNotes[1],
    title: "Updated test announcement",
    changes: ["Second change", "Corrected release-note detail"],
  };
  announcementStore = createAccountStore({
    databasePath: announcementDatabasePath,
    sessionSecret: "announcement-session-secret-that-is-long-enough",
    releaseNotes: [revisedReleaseNote],
    clock: () => 1_800_000_000_001,
  });
  assert.deepEqual(
    announcementStore.getAnnouncements(announcementUser.id).map((entry) => entry.id),
    ["v-test-2", "v-test-1"],
    "published announcement history must survive a later source-list reduction",
  );
  const revisedAnnouncement = announcementStore.getAnnouncements(announcementUser.id).find((entry) => entry.id === "v-test-2");
  assert.deepEqual(
    revisedAnnouncement?.changes,
    revisedReleaseNote.changes,
    "restarting with a corrected same-ID announcement must refresh its published changes",
  );
  assert.equal(
    revisedAnnouncement?.readAt,
    acknowledged.readAt,
    "refreshing a same-ID announcement must preserve its account-specific read state",
  );

  console.log("account store verification passed");
} finally {
  announcementStore?.close();
  store?.close();
  await rm(tempDir, { recursive: true, force: true });
}
