import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAccountStore } from "../server/account-store.js";

let settleCompletedRoom;
let ratingChangeForUser;
try {
  ({ settleCompletedRoom, ratingChangeForUser } = await import("../server/competitive-settlement.js"));
} catch (_error) {
  // The initial RED run intentionally reaches this branch before the adapter exists.
}

assert.equal(
  typeof settleCompletedRoom,
  "function",
  "competitive settlement should export settleCompletedRoom(store, room)",
);
assert.equal(
  typeof ratingChangeForUser,
  "function",
  "competitive settlement should expose a settled player's own rating change",
);

const tempDir = await mkdtemp(path.join(tmpdir(), "tdos-competitive-settlement-"));
const store = createAccountStore({
  databasePath: path.join(tempDir, "accounts.sqlite"),
  sessionSecret: "competitive-settlement-test-session-secret",
});

try {
  const a1 = await store.register({ username: "AOne", password: "strong-password-123" });
  const a2 = await store.register({ username: "ATwo", password: "strong-password-456" });
  const b1 = await store.register({ username: "BOne", password: "strong-password-789" });
  const b2 = await store.register({ username: "BTwo", password: "strong-password-012" });
  const a3 = await store.register({ username: "AThree", password: "strong-password-345" });
  const b3 = await store.register({ username: "BThree", password: "strong-password-678" });
  const room = {
    id: "room-42",
    mode: "pvp2v2",
    visibility: "public",
    result: {
      winnerAllianceId: "A",
      finishedAt: 1_700_000_000_000,
      players: [
        { seat: "A1", allianceId: "A", userId: a1.id, isBot: false },
        { seat: "A2", allianceId: "A", userId: a2.id, isBot: false },
        { seat: "B1", allianceId: "B", userId: b1.id, isBot: false },
        { seat: "B2", allianceId: "B", userId: b2.id, isBot: false },
      ],
    },
  };

  const settled = settleCompletedRoom(store, room);
  assert.equal(settled.settled, true, "a finished real online 2v2 should settle ratings");
  assert.equal(store.getRating(a1.id).elo, 1016, "winning users should receive team Elo");
  assert.equal(store.getRating(b1.id).elo, 984, "losing users should lose team Elo");
  assert.deepEqual(
    ratingChangeForUser(settled, a1.id),
    { before: 1000, after: 1016, delta: 16 },
    "a player should receive only their own authoritative rating change",
  );
  assert.equal(
    ratingChangeForUser({ settled: false, changes: settled.changes }, a1.id),
    null,
    "unsettled results must not expose a rating change",
  );
  assert.equal(
    settleCompletedRoom(store, room).settled,
    false,
    "calling the same finished room again must remain idempotent",
  );

  const ineligible = settleCompletedRoom(store, {
    id: "training-room",
    mode: "ai",
    visibility: "public",
    result: { winnerAllianceId: "A", finishedAt: 1_700_000_000_001, players: room.result.players },
  });
  assert.equal(ineligible.settled, false, "AI and training rooms must not affect competitive ratings");

  const botOnlySide = settleCompletedRoom(store, {
    id: "bot-only-side",
    mode: "stellar3v3",
    visibility: "public",
    result: {
      winnerAllianceId: "A",
      finishedAt: 1_700_000_000_002,
      players: [
        { seat: "A1", allianceId: "A", userId: a1.id, isBot: false },
        { seat: "B1", allianceId: "B", isBot: true },
      ],
    },
  });
  assert.equal(botOnlySide.settled, false, "both alliances need authenticated human users before Elo changes");

  const equalHumanOneVsOne = settleCompletedRoom(store, {
    id: "equal-human-1v1-room",
    mode: "stellar3v3",
    visibility: "public",
    result: {
      winnerAllianceId: "A",
      finishedAt: 1_700_000_000_003,
      players: [
        { seat: "A1", allianceId: "A", userId: a1.id, isBot: false },
        { seat: "A2", allianceId: "A", isBot: true },
        { seat: "A3", allianceId: "A", isBot: true },
        { seat: "B1", allianceId: "B", userId: b1.id, isBot: false },
        { seat: "B2", allianceId: "B", isBot: true },
        { seat: "B3", allianceId: "B", isBot: true },
      ],
    },
  });
  assert.equal(equalHumanOneVsOne.settled, true, "a public 3v3 with one authenticated human on each side should settle");
  assert.deepEqual(
    equalHumanOneVsOne.changes.map((change) => change.userId).sort(),
    [a1.id, b1.id].sort(),
    "only the authenticated human account seats should receive rating changes",
  );

  const equalHumanTwoVsTwo = settleCompletedRoom(store, {
    id: "equal-human-2v2-room",
    mode: "stellar3v3",
    visibility: "public",
    result: {
      winnerAllianceId: "B",
      finishedAt: 1_700_000_000_004,
      players: [
        { seat: "A1", allianceId: "A", userId: a1.id, isBot: false },
        { seat: "A2", allianceId: "A", userId: a2.id, isBot: false },
        { seat: "A3", allianceId: "A", isBot: true },
        { seat: "B1", allianceId: "B", userId: b1.id, isBot: false },
        { seat: "B2", allianceId: "B", userId: b2.id, isBot: false },
        { seat: "B3", allianceId: "B", isBot: true },
      ],
    },
  });
  assert.equal(equalHumanTwoVsTwo.settled, true, "a public 3v3 with two authenticated humans on each side should settle");
  assert.deepEqual(
    equalHumanTwoVsTwo.changes.map((change) => change.userId).sort(),
    [a1.id, a2.id, b1.id, b2.id].sort(),
    "only the four authenticated 2v2 account seats should receive rating changes",
  );

  const equalHumanThreeVsThree = settleCompletedRoom(store, {
    id: "equal-human-3v3-room",
    mode: "stellar3v3",
    visibility: "public",
    result: {
      winnerAllianceId: "A",
      finishedAt: 1_700_000_000_005,
      players: [
        { seat: "A1", allianceId: "A", userId: a1.id, isBot: false },
        { seat: "A2", allianceId: "A", userId: a2.id, isBot: false },
        { seat: "A3", allianceId: "A", userId: a3.id, isBot: false },
        { seat: "B1", allianceId: "B", userId: b1.id, isBot: false },
        { seat: "B2", allianceId: "B", userId: b2.id, isBot: false },
        { seat: "B3", allianceId: "B", userId: b3.id, isBot: false },
      ],
    },
  });
  assert.equal(equalHumanThreeVsThree.settled, true, "a complete public 3v3 should remain rated");
  assert.deepEqual(
    equalHumanThreeVsThree.changes.map((change) => change.userId).sort(),
    [a1.id, a2.id, a3.id, b1.id, b2.id, b3.id].sort(),
    "all six authenticated 3v3 account seats should receive rating changes",
  );

  const disconnectedHumanHandoff = settleCompletedRoom(store, {
    id: "disconnected-human-handoff-room",
    mode: "stellar3v3",
    visibility: "public",
    result: {
      winnerAllianceId: "B",
      finishedAt: 1_700_000_000_006,
      players: [
        { seat: "A1", allianceId: "A", userId: a1.id, isBot: true, disconnected: true },
        { seat: "A2", allianceId: "A", isBot: true },
        { seat: "A3", allianceId: "A", isBot: true },
        { seat: "B1", allianceId: "B", userId: b1.id, isBot: false },
        { seat: "B2", allianceId: "B", isBot: true },
        { seat: "B3", allianceId: "B", isBot: true },
      ],
    },
  });
  assert.equal(
    disconnectedHumanHandoff.settled,
    true,
    "an authenticated human account seat should remain rated after AI takes over its disconnected fleet",
  );
  assert.deepEqual(
    disconnectedHumanHandoff.changes.map((change) => change.userId).sort(),
    [a1.id, b1.id].sort(),
    "the AI controller itself must not gain a separate rating change",
  );

  const zeroHumanMatch = settleCompletedRoom(store, {
    id: "zero-human-room",
    mode: "stellar3v3",
    visibility: "public",
    result: {
      winnerAllianceId: "A",
      finishedAt: 1_700_000_000_007,
      players: [
        { seat: "A1", allianceId: "A", isBot: true },
        { seat: "A2", allianceId: "A", isBot: true },
        { seat: "A3", allianceId: "A", isBot: true },
        { seat: "B1", allianceId: "B", isBot: true },
        { seat: "B2", allianceId: "B", isBot: true },
        { seat: "B3", allianceId: "B", isBot: true },
      ],
    },
  });
  assert.equal(zeroHumanMatch.settled, false, "a 0v0 AI-only public 3v3 must remain unranked");

  const oneVsTwoHumanMatch = settleCompletedRoom(store, {
    id: "unequal-human-1v2-room",
    mode: "stellar3v3",
    visibility: "public",
    result: {
      winnerAllianceId: "A",
      finishedAt: 1_700_000_000_008,
      players: [
        { seat: "A1", allianceId: "A", userId: a1.id, isBot: false },
        { seat: "A2", allianceId: "A", isBot: true },
        { seat: "A3", allianceId: "A", isBot: true },
        { seat: "B1", allianceId: "B", userId: b1.id, isBot: false },
        { seat: "B2", allianceId: "B", userId: b2.id, isBot: false },
        { seat: "B3", allianceId: "B", isBot: true },
      ],
    },
  });
  assert.equal(oneVsTwoHumanMatch.settled, false, "a 1v2 human public 3v3 must remain unranked");

  const twoVsThreeHumanMatch = settleCompletedRoom(store, {
    id: "unequal-human-2v3-room",
    mode: "stellar3v3",
    visibility: "public",
    result: {
      winnerAllianceId: "B",
      finishedAt: 1_700_000_000_009,
      players: [
        { seat: "A1", allianceId: "A", userId: a1.id, isBot: false },
        { seat: "A2", allianceId: "A", userId: a2.id, isBot: false },
        { seat: "A3", allianceId: "A", isBot: true },
        { seat: "B1", allianceId: "B", userId: b1.id, isBot: false },
        { seat: "B2", allianceId: "B", userId: b2.id, isBot: false },
        { seat: "B3", allianceId: "B", userId: b3.id, isBot: false },
      ],
    },
  });
  assert.equal(twoVsThreeHumanMatch.settled, false, "a 2v3 human public 3v3 must remain unranked");

  const malformedSeatRoster = settleCompletedRoom(store, {
    id: "malformed-seat-roster-room",
    mode: "stellar3v3",
    visibility: "public",
    result: {
      winnerAllianceId: "A",
      finishedAt: 1_700_000_000_010,
      players: [
        { seat: "A1", allianceId: "A", userId: a1.id, isBot: false },
        { seat: "A2", allianceId: "A", isBot: true },
        { seat: "A2", allianceId: "A", isBot: true },
        { seat: "B1", allianceId: "B", userId: b1.id, isBot: false },
        { seat: "B2", allianceId: "B", isBot: true },
        { seat: "B3", allianceId: "B", isBot: true },
      ],
    },
  });
  assert.equal(malformedSeatRoster.settled, false, "a 3v3 result must preserve each of the six unique authoritative seats");

  const duplicateThreeVsThreeAccount = settleCompletedRoom(store, {
    id: "duplicate-human-account-room",
    mode: "stellar3v3",
    visibility: "public",
    result: {
      winnerAllianceId: "A",
      finishedAt: 1_700_000_000_011,
      players: [
        { seat: "A1", allianceId: "A", userId: a1.id, isBot: false },
        { seat: "A2", allianceId: "A", userId: a1.id, isBot: false },
        { seat: "A3", allianceId: "A", isBot: true },
        { seat: "B1", allianceId: "B", userId: b1.id, isBot: false },
        { seat: "B2", allianceId: "B", userId: b2.id, isBot: false },
        { seat: "B3", allianceId: "B", isBot: true },
      ],
    },
  });
  assert.equal(duplicateThreeVsThreeAccount.settled, false, "duplicate 3v3 account seats must remain unranked");

  const noWinnerMatch = settleCompletedRoom(store, {
    id: "no-winner-room",
    mode: "stellar3v3",
    visibility: "public",
    result: {
      winnerAllianceId: null,
      finishedAt: 1_700_000_000_012,
      players: [
        { seat: "A1", allianceId: "A", userId: a1.id, isBot: false },
        { seat: "A2", allianceId: "A", isBot: true },
        { seat: "A3", allianceId: "A", isBot: true },
        { seat: "B1", allianceId: "B", userId: b1.id, isBot: false },
        { seat: "B2", allianceId: "B", isBot: true },
        { seat: "B3", allianceId: "B", isBot: true },
      ],
    },
  });
  assert.equal(noWinnerMatch.settled, false, "a 3v3 result without a valid winning alliance must remain unranked");

  const privateEqualHumanMatch = settleCompletedRoom(store, {
    id: "private-equal-human-room",
    mode: "stellar3v3",
    visibility: "private",
    result: {
      winnerAllianceId: "A",
      finishedAt: 1_700_000_000_013,
      players: [
        { seat: "A1", allianceId: "A", userId: a1.id, isBot: false },
        { seat: "A2", allianceId: "A", isBot: true },
        { seat: "A3", allianceId: "A", isBot: true },
        { seat: "B1", allianceId: "B", userId: b1.id, isBot: false },
        { seat: "B2", allianceId: "B", isBot: true },
        { seat: "B3", allianceId: "B", isBot: true },
      ],
    },
  });
  assert.equal(privateEqualHumanMatch.settled, false, "private equal-human 3v3 rooms must remain unranked");

  const standardMixedMatch = settleCompletedRoom(store, {
    id: "standard-mixed-room",
    mode: "pvp2v2",
    visibility: "public",
    result: {
      winnerAllianceId: "A",
      finishedAt: 1_700_000_000_014,
      players: [
        { seat: "A1", allianceId: "A", userId: a1.id, isBot: false },
        { seat: "A2", allianceId: "A", isBot: true },
        { seat: "B1", allianceId: "B", userId: b1.id, isBot: false },
        { seat: "B2", allianceId: "B", isBot: true },
      ],
    },
  });
  assert.equal(standardMixedMatch.settled, false, "non-3v3 online modes must still require complete human rosters");

  const mixedHumanBotMatch = settleCompletedRoom(store, {
    id: "mixed-human-bot-room",
    mode: "stellar3v3",
    visibility: "public",
    result: {
      winnerAllianceId: "A",
      finishedAt: 1_700_000_000_003,
      players: [
        { seat: "A1", allianceId: "A", userId: a1.id, isBot: false },
        { seat: "A2", allianceId: "A", userId: a2.id, isBot: false },
        { seat: "A3", allianceId: "A", userId: a3.id, isBot: false },
        { seat: "B1", allianceId: "B", userId: b1.id, isBot: false },
        { seat: "B2", allianceId: "B", userId: b2.id, isBot: false },
        { seat: "B3", allianceId: "B", isBot: true },
      ],
    },
  });
  assert.equal(mixedHumanBotMatch.settled, false, "a 3v2 human public 3v3 must remain unranked");

  const incompleteMatch = settleCompletedRoom(store, {
    id: "incomplete-room",
    mode: "pvp2v2",
    visibility: "public",
    result: {
      winnerAllianceId: "A",
      finishedAt: 1_700_000_000_004,
      players: [
        { seat: "A1", allianceId: "A", userId: a1.id, isBot: false },
        { seat: "B1", allianceId: "B", userId: b1.id, isBot: false },
      ],
    },
  });
  assert.equal(incompleteMatch.settled, false, "only complete 1v1, 2v2, and 3v3 results may affect Elo");

  let duplicateUserMatch;
  assert.doesNotThrow(() => {
    duplicateUserMatch = settleCompletedRoom(store, {
      id: "duplicate-user-room",
      mode: "pvp2v2",
      visibility: "public",
      result: {
        winnerAllianceId: "A",
        finishedAt: 1_700_000_000_005,
        players: [
          { seat: "A1", allianceId: "A", userId: a1.id, isBot: false },
          { seat: "A2", allianceId: "A", userId: a1.id, isBot: false },
          { seat: "B1", allianceId: "B", userId: b1.id, isBot: false },
          { seat: "B2", allianceId: "B", userId: b2.id, isBot: false },
        ],
      },
    });
  }, "invalid duplicate account results must never throw through the game loop");
  assert.equal(duplicateUserMatch.settled, false, "duplicate account IDs must not affect Elo");

  console.log("competitive settlement verification passed");
} finally {
  store.close();
  await rm(tempDir, { recursive: true, force: true });
}
