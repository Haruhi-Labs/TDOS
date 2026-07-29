import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAccountStore } from "../server/account-store.js";

let settleCompletedRoom;
try {
  ({ settleCompletedRoom } = await import("../server/competitive-settlement.js"));
} catch (_error) {
  // The initial RED run intentionally reaches this branch before the adapter exists.
}

assert.equal(
  typeof settleCompletedRoom,
  "function",
  "competitive settlement should export settleCompletedRoom(store, room)",
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
  assert.equal(mixedHumanBotMatch.settled, false, "a 3v3 with any AI-controlled seat must not affect Elo");

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
