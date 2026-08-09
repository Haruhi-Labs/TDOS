import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

let RELEASE_NOTES;
let getReleaseNoteForVersion;
try {
  ({ RELEASE_NOTES, getReleaseNoteForVersion } = await import("../server/release-notes.js"));
} catch (_error) {
  // This test intentionally starts RED before the release-note source exists.
}

const packageInfo = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(packageInfo.version, "1.0.5", "the complete character update must be released as version 1.0.5");
const [menu, viteConfig] = await Promise.all([
  readFile(new URL("../src/menu.js", import.meta.url), "utf8"),
  readFile(new URL("../vite.config.js", import.meta.url), "utf8"),
]);

assert.ok(Array.isArray(RELEASE_NOTES), "release notes should be maintained in a version-controlled source list");
assert.equal(typeof getReleaseNoteForVersion, "function", "release notes should be addressable by release version");

const currentRelease = getReleaseNoteForVersion?.(packageInfo.version);
const priorRelease = getReleaseNoteForVersion?.("1.0.2");
assert.ok(currentRelease, "the current package version must have a matching release announcement");
assert.ok(priorRelease, "the previous 1.0.2 release note should remain available in history");
assert.equal(currentRelease?.version, packageInfo.version, "the announcement must use the package version as its release identity");
assert.match(currentRelease?.id || "", /^[a-z0-9][a-z0-9-]*$/u, "release announcement IDs must be stable URL-safe identifiers");
assert.ok(Array.isArray(currentRelease?.changes) && currentRelease.changes.length > 0, "release announcements must contain at least one change entry");
assert.ok(
  /3v3.*刷新.*房间.*强制关闭.*资料卡/u.test((priorRelease?.changes || []).join(" ")),
  "the 1.0.2 announcement must describe 3v3 refresh recovery, creator room closure, and battle profile-strip removal",
);
assert.match(
  (currentRelease?.changes || []).join(" "),
  /三味线|三味線|shamisen/i,
  "the 1.0.5 announcement must announce the Shamisen character",
);
assert.match(
  (currentRelease?.changes || []).join(" "),
  /1096.*A.*B|形态|フォーム/i,
  "the 1.0.5 announcement must describe the 1096 form update",
);
assert.match(
  (currentRelease?.changes || []).join(" "),
  /朝仓|朝倉|Asakura/i,
  "the 1.0.5 announcement must describe the Asakura vision-wave update",
);
assert.match(
  (currentRelease?.changes || []).join(" "),
  /我在这里|ここにいる|I'm Here/i,
  "the 1.0.5 announcement must describe Haruhi's flagship rework",
);
assert.match(
  (currentRelease?.changes || []).join(" "),
  /宇宙人.*未来人.*异世界人.*超能力者|Alien.*Time Traveler.*Otherworlder.*Esper/i,
  "the 1.0.5 announcement must list Haruhi's permanent supports",
);
assert.match(menu, /__APP_VERSION__/, "the menu version label should use the build-injected package version");
assert.match(viteConfig, /__APP_VERSION__/, "the Vite build should inject the package version into the client");
assert.match(packageInfo.scripts.build, /verify-announcements/, "the normal production build must enforce the release-announcement contract");

console.log("announcement release-note verification passed");
