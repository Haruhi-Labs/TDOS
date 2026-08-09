import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [serverSource, onlineSource, styles] = await Promise.all([
  readFile(new URL("../server/server.js", import.meta.url), "utf8"),
  readFile(new URL("../src/online.js", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
]);

const tickRoomsStart = serverSource.indexOf("function tickRooms() {");
const finalizationStart = serverSource.indexOf('if (room.match.phase === "finished" && room.status !== "finished")', tickRoomsStart);
const snapshotAccumulatorStart = serverSource.indexOf("room.snapshotAccumulator += TICK_DT;", tickRoomsStart);
const finalizationBlock = serverSource.slice(finalizationStart, finalizationStart + 700);

assert.ok(finalizationStart > tickRoomsStart, "the server should finalize a completed room inside tickRooms");
assert.ok(
  finalizationStart < snapshotAccumulatorStart,
  "the server must finalize and settle a completed match before sending any final snapshot",
);
assert.ok(
  finalizationBlock.indexOf("sendRoomStateToMembers(room);") < finalizationBlock.indexOf("sendSnapshot(room);"),
  "the settled room state must be sent before the final snapshot can show the result screen",
);

assert.match(
  serverSource,
  /ratingChange:\s*isMember\s*\?\s*ratingChangeForUser\(room\.ratingSettlement, viewer\.userId\)\s*:\s*null/,
  "room state should expose only the member's settled rating change",
);
assert.match(
  onlineSource,
  /pendingRatingChange/,
  "the online client should retain the rating change until the result screen closes",
);
assert.match(
  onlineSource,
  /message\.self\?\.ratingChange/,
  "the online client should read the authoritative rating change from room state",
);
assert.match(
  onlineSource,
  /function showRatingChangeNotice\(/,
  "the online client should render a rating change notice after results close",
);
assert.match(
  onlineSource,
  /showRatingChangeNotice\(pendingRatingChange\)/,
  "returning from the result screen should show the retained rating change",
);
assert.match(styles, /\.rating-change-overlay/, "the rating change notice should have a dedicated overlay style");
assert.match(styles, /\.rating-change-delta\.is-gain/, "rating gains should have a distinct visual state");
assert.match(styles, /\.rating-change-delta\.is-loss/, "rating losses should have a distinct visual state");

console.log("rating change notice verification passed");
