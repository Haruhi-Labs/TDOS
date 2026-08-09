import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

let getLatestUnreadAnnouncement;
try {
  ({ getLatestUnreadAnnouncement } = await import("../src/announcement-center.js"));
} catch (_error) {
  // The initial RED run intentionally reaches this branch before the announcement center exists.
}

assert.equal(typeof getLatestUnreadAnnouncement, "function", "announcement center should expose latest-unread selection");

assert.deepEqual(
  getLatestUnreadAnnouncement?.([
    { id: "latest", readAt: null },
    { id: "older", readAt: null },
  ]),
  { id: "latest", readAt: null },
  "the latest release should be announced when the account has not confirmed it",
);
assert.equal(
  getLatestUnreadAnnouncement?.([
    { id: "latest", readAt: 1_800_000_000_000 },
    { id: "older", readAt: null },
  ]),
  null,
  "an already-confirmed latest release must not surface an older announcement as a new login interruption",
);

const [main, menu, historyView, styles] = await Promise.all([
  readFile(new URL("../src/main.js", import.meta.url), "utf8"),
  readFile(new URL("../src/menu.js", import.meta.url), "utf8"),
  readFile(new URL("../src/announcements-view.js", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
]);

assert.match(main, /"\/announcements"/, "the application router should register the announcement history page");
assert.match(main, /createAnnouncementCenter/, "authenticated startup should initialize the announcement center");
assert.match(menu, /data-menu-announcements/, "the main menu should expose an announcement-history icon");
assert.match(menu, /haruhi:announcement-state/, "the menu icon should react to the current unread announcement state");
assert.match(historyView, /announcement-history/, "announcement history should render as a dedicated route view");
assert.match(historyView, /markAnnouncementRead/, "announcement history should let users acknowledge older unread entries");
assert.match(styles, /\.announcement-overlay/, "announcement login notices should have dedicated overlay styling");
assert.match(styles, /\.announcement-history/, "announcement history should have responsive page styling");

console.log("announcement UI verification passed");
