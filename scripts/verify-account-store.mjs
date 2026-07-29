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
  assert.equal(store.getRating(haruhi.id, "pvp2v2").elo, 1000, "2v2 Elo should start at 1000");
  assert.equal(store.getRating(haruhi.id, "stellar3v3").elo, 1000, "3v3 Elo should start at 1000");
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
  assert.equal(store.getRating(haruhi.id, "pvp2v2").elo, 1016, "equal-rating winners should gain 16 Elo");
  assert.equal(store.getRating(mikuru.id, "pvp2v2").elo, 984, "equal-rating losers should lose 16 Elo");
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
  assert.equal(store.getRating(haruhi.id, "pvp2v2").elo, 1016, "idempotency must retain the first Elo result");
  assert.equal(store.getLeaderboard("pvp2v2", 1)[0].userId, haruhi.id, "leaderboard should sort by Elo");

  console.log("account store verification passed");
} finally {
  store?.close();
  await rm(tempDir, { recursive: true, force: true });
}
