import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [main, menu, profile, online, vite, accountClient, authView] = await Promise.all([
  readFile(new URL("../src/main.js", import.meta.url), "utf8"),
  readFile(new URL("../src/menu.js", import.meta.url), "utf8"),
  readFile(new URL("../src/profile-view.js", import.meta.url), "utf8"),
  readFile(new URL("../src/online.js", import.meta.url), "utf8"),
  readFile(new URL("../vite.config.js", import.meta.url), "utf8"),
  readFile(new URL("../src/account-client.js", import.meta.url), "utf8"),
  readFile(new URL("../src/auth-view.js", import.meta.url), "utf8"),
]);

assert.match(main, /createAuthGate/, "application startup should be controlled by the authentication gate");
assert.match(main, /accountClient\.getMe/, "application startup should check the current account session");
assert.match(main, /"\/leaderboard"/, "main router should register the leaderboard page");
assert.match(menu, /leaderboard/i, "main menu should link to the leaderboard page");
assert.match(profile, /account-client/, "profile page should use the account API client");
assert.match(accountClient, /profile\/avatar/, "account client should expose an avatar upload action");
assert.match(profile, /signature/i, "profile page should expose the signature field");
assert.doesNotMatch(profile, /data-account-action="register"/, "profile page should not retain a second guest registration form");
assert.match(profile, /if \(!account\) \{\s*onSignedOut\?\.\(\);/, "profile page should return missing accounts to the authentication gate");
assert.match(profile, /error\.status === 401\) \{\s*onSignedOut\?\.\(\);/, "expired profile requests should return to the authentication gate");
assert.match(online, /if \(!opened\) \{\s*void accountClient\.getMe\(\)/, "an initial online WebSocket failure should re-check the account session");
assert.match(online, /if \(!user\) onSignedOut\?\.\(\);/, "an expired online session should return to the authentication gate");
assert.match(online, /event\.code === 4001\) \{\s*onSignedOut\?\.\(\);/, "a server-authenticated close should return online users to the authentication gate");
assert.match(authView, /name="confirmPassword"/, "registration view should render a confirmation-password input");
assert.match(authView, /validateRegistration/, "registration view should validate confirmation before registration");
assert.match(online, /user\.elo/, "online room rendering should show the mode Elo from public player summaries");
assert.match(online, /getUser\(/, "online user rows should load public player details on demand");
assert.match(vite, /"\/api"/, "Vite dev server should proxy account API requests");
assert.match(
  vite,
  /"\/api"\s*:\s*\{[\s\S]*?changeOrigin\s*:\s*false/,
  "Vite API proxy must preserve the browser Host so backend Origin validation remains same-origin",
);
assert.match(
  vite,
  /"\/ws"\s*:\s*\{[\s\S]*?changeOrigin\s*:\s*false/,
  "Vite WebSocket proxy must preserve the browser Host so Origin validation remains same-origin",
);

console.log("account UI contract verification passed");
