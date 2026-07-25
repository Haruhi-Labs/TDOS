import {
  buildResultRenderKey,
  resolveViewerMatchResult,
} from "../shared/match-result.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const cases = [
  { viewerSeat: "A1", winnerAllianceId: "A", fleetDefeated: false, expected: "win" },
  { viewerSeat: "A2", winnerAllianceId: "A", fleetDefeated: false, expected: "win" },
  { viewerSeat: "A1", winnerAllianceId: "A", fleetDefeated: true, expected: "win" },
  { viewerSeat: "A2", winnerAllianceId: "A", fleetDefeated: true, expected: "win" },
  { viewerSeat: "B1", winnerAllianceId: "A", fleetDefeated: false, expected: "lose" },
  { viewerSeat: "B2", winnerAllianceId: "A", fleetDefeated: true, expected: "lose" },
  { viewerSeat: "B1", winnerAllianceId: "B", fleetDefeated: true, expected: "win" },
  { viewerSeat: "B2", winnerAllianceId: "B", fleetDefeated: false, expected: "win" },
];

for (const item of cases) {
  const viewerAllianceId = item.viewerSeat.startsWith("B") ? "B" : "A";
  const result = resolveViewerMatchResult({
    mode: "pvp2v2",
    winnerSeat: item.winnerAllianceId,
    winnerAllianceId: item.winnerAllianceId,
    viewerSeat: item.viewerSeat,
    viewerAllianceId,
  });
  assert(
    result === item.expected,
    `${item.viewerSeat} vs winner ${item.winnerAllianceId} (fleetDefeated=${item.fleetDefeated}) expected ${item.expected}, got ${result}`,
  );
  // fleetDefeated must never be an input to the pure resolver.
  assert(
    resolveViewerMatchResult({
      mode: "pvp2v2",
      winnerAllianceId: item.winnerAllianceId,
      viewerSeat: item.viewerSeat,
      viewerAllianceId,
      fleetDefeated: item.fleetDefeated,
    }) === item.expected,
    "fleetDefeated must not change alliance result",
  );
}

// Seat-only derivation when viewerAllianceId is missing.
assert(
  resolveViewerMatchResult({
    mode: "pvp2v2",
    winnerAllianceId: "A",
    viewerSeat: "A1",
  }) === "win",
  "A1 should win from seat derivation when alliance is omitted",
);
assert(
  resolveViewerMatchResult({
    mode: "pvp2v2",
    winnerSeat: "A",
    viewerSeat: "B2",
  }) === "lose",
  "B2 should lose when winnerSeat is A",
);

// Incomplete first paint -> later correction via fingerprint change.
const incompleteKey = buildResultRenderKey({
  roomId: "room-1",
  winnerAllianceId: "A",
  viewerSeat: "A1",
  playerCount: 4,
  result: "draw",
});
const completeKey = buildResultRenderKey({
  roomId: "room-1",
  winnerAllianceId: "A",
  viewerAllianceId: "A",
  viewerSeat: "A1",
  playerCount: 4,
  result: "win",
});
assert(incompleteKey !== completeKey, "result fingerprint must change when viewer alliance becomes known");

// 1v1 remains seat-based.
assert(
  resolveViewerMatchResult({
    mode: "pvp",
    winnerSeat: "A",
    viewerSeat: "A",
  }) === "win",
  "1v1 winner seat A should win for seat A",
);
assert(
  resolveViewerMatchResult({
    mode: "pvp",
    winnerSeat: "A",
    viewerSeat: "B",
  }) === "lose",
  "1v1 winner seat A should lose for seat B",
);
assert(
  resolveViewerMatchResult({
    mode: "pvp",
    winnerSeat: null,
    winnerAllianceId: null,
    viewerSeat: "A",
  }) === "draw",
  "missing winner should be draw",
);

// Same alliance must always agree.
for (const winnerAllianceId of ["A", "B"]) {
  const a1 = resolveViewerMatchResult({
    mode: "pvp2v2",
    winnerAllianceId,
    viewerSeat: "A1",
    viewerAllianceId: "A",
  });
  const a2 = resolveViewerMatchResult({
    mode: "pvp2v2",
    winnerAllianceId,
    viewerSeat: "A2",
    viewerAllianceId: "A",
  });
  const b1 = resolveViewerMatchResult({
    mode: "pvp2v2",
    winnerAllianceId,
    viewerSeat: "B1",
    viewerAllianceId: "B",
  });
  const b2 = resolveViewerMatchResult({
    mode: "pvp2v2",
    winnerAllianceId,
    viewerSeat: "B2",
    viewerAllianceId: "B",
  });
  assert(a1 === a2, `A1/A2 must agree for winner ${winnerAllianceId}`);
  assert(b1 === b2, `B1/B2 must agree for winner ${winnerAllianceId}`);
  assert(a1 !== b1, `opposing alliances must disagree for winner ${winnerAllianceId}`);
}

console.log("2v2 result verification passed");
