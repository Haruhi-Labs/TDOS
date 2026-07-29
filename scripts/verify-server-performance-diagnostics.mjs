import assert from "node:assert/strict";
import { createServerPerformanceDiagnostics } from "../server/performance-diagnostics.js";

let now = 0;
const logs = [];
const diagnostics = createServerPerformanceDiagnostics({
  enabled: true,
  now: () => now,
  reportIntervalMs: 1_000,
  log: (line) => logs.push(line),
});
assert.equal(diagnostics.enabled, true, "enabled diagnostics must expose their state to hot-path callers");

diagnostics.record("inputs", 3);
diagnostics.record("inputs", 7);
diagnostics.record("simulation", 11);
diagnostics.record("snapshotBuild", 13);
diagnostics.record("snapshotSend", 17);
diagnostics.recordEventLoopDelay(23);
diagnostics.recordCatchupDrop();

now = 1_000;
assert.equal(
  diagnostics.flush({ activeRooms: 0, players: 6 }),
  false,
  "diagnostics must stay quiet while no matches are active",
);
assert.equal(logs.length, 0, "idle diagnostics must not emit a log line");

assert.equal(
  diagnostics.flush({ activeRooms: 1, players: 6 }),
  true,
  "active matches must emit a periodic diagnostics line",
);
assert.equal(logs.length, 1, "an active interval must emit one compact log line");
assert.match(logs[0], /rooms=1 players=6/, "diagnostics must report active room and player counts");
assert.match(logs[0], /input=3\.0\/7\.0ms/, "diagnostics must report rolling input p50/p95");
assert.match(logs[0], /sim=11\.0\/11\.0ms/, "diagnostics must report rolling simulation p50/p95");
assert.match(logs[0], /snapshot=13\.0\/13\.0ms\+17\.0\/17\.0ms/, "diagnostics must report snapshot build and send p50/p95");
assert.match(logs[0], /loop=23\.0\/23\.0ms/, "diagnostics must report rolling event-loop delay");
assert.match(logs[0], /catchupDrops=1/, "diagnostics must report interval catch-up drops");

now = 2_000;
assert.equal(
  diagnostics.flush({ activeRooms: 1, players: 6 }),
  true,
  "subsequent active intervals must still report",
);
assert.match(logs[1], /catchupDrops=0/, "reported catch-up drops must reset for the next interval");

const disabled = createServerPerformanceDiagnostics({
  enabled: false,
  now: () => now,
  log: (line) => logs.push(line),
});
assert.equal(disabled.enabled, false, "disabled diagnostics must let hot-path callers skip timing work");
disabled.record("simulation", 10);
disabled.recordCatchupDrop();
assert.equal(disabled.flush({ activeRooms: 1, players: 6 }), false, "disabled diagnostics must impose no reporting behavior");
assert.equal(logs.length, 2, "disabled diagnostics must never log");

console.log("server performance diagnostics verification passed");
