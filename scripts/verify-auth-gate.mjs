import assert from "node:assert/strict";

let createAuthGate;
try {
  ({ createAuthGate } = await import("../src/auth-gate.js"));
} catch (_error) {
  // The initial RED run intentionally reaches this branch before the gate exists.
}

assert.equal(typeof createAuthGate, "function", "auth gate should export createAuthGate(options)");

function makeHarness(getMe) {
  const calls = { start: 0, stop: 0, authMount: 0 };
  let authOptions = null;
  const gate = createAuthGate({
    root: { innerHTML: "" },
    router: {
      start() { calls.start += 1; },
      stop() { calls.stop += 1; },
    },
    authView: {
      mount(_root, options) {
        calls.authMount += 1;
        authOptions = options;
        return () => {};
      },
    },
    getMe,
  });
  return { gate, calls, authOptions: () => authOptions };
}

{
  const harness = makeHarness(async () => null);
  await harness.gate.start();
  assert.equal(harness.calls.start, 0, "a missing session must not start application routes");
  assert.equal(harness.calls.authMount, 1, "a missing session must mount the authentication view");
  harness.authOptions().onAuthenticated({ id: "user-1" });
  assert.equal(harness.calls.start, 1, "successful authentication must start application routes");
}

{
  const harness = makeHarness(async () => ({ id: "user-1" }));
  await harness.gate.start();
  assert.equal(harness.calls.authMount, 0, "an existing session must bypass the authentication view");
  assert.equal(harness.calls.start, 1, "an existing session must start the current route");
  harness.gate.signOut();
  assert.equal(harness.calls.stop, 1, "sign out must stop and unload the active route");
  assert.equal(harness.calls.authMount, 1, "sign out must return to the authentication view");
}

{
  const lifecycle = [];
  const gate = createAuthGate({
    root: { innerHTML: "" },
    router: {
      start() { lifecycle.push("route"); },
      stop() {},
    },
    authView: { mount: () => () => {} },
    getMe: async () => ({ id: "user-1" }),
    onAuthenticatedSession: () => lifecycle.push("announcements"),
  });
  await gate.start();
  assert.deepEqual(
    lifecycle,
    ["route", "announcements"],
    "the announcement check should begin only after authenticated routes start",
  );
}

{
  const lifecycle = [];
  const gate = createAuthGate({
    root: { innerHTML: "" },
    router: {
      start() { lifecycle.push("route"); },
      stop() {},
    },
    authView: { mount: () => () => {} },
    getMe: async () => ({ id: "user-1" }),
    onAuthenticatedSession: async () => { throw new Error("announcement network failure"); },
  });
  await gate.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(lifecycle, ["route"], "an announcement failure must not block authenticated routing");
}

console.log("auth gate verification passed");
