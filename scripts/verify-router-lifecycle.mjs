import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (await readFile(new URL("../src/router.js", import.meta.url), "utf8"))
  .replace('import { t } from "./i18n.js";', 'const t = (value) => value;')
  .replace('const RAW_BASE = import.meta.env.BASE_URL || "/";', 'const RAW_BASE = "/";');
const { createRouter } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

const listeners = new Map();
const addCalls = [];
const removeCalls = [];
const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
const originalLocation = globalThis.location;
const originalHistory = globalThis.history;

function add(target, type, handler) {
  addCalls.push([target, type]);
  listeners.set(`${target}:${type}`, handler);
}

function remove(target, type) {
  removeCalls.push([target, type]);
  listeners.delete(`${target}:${type}`);
}

globalThis.document = {
  addEventListener(type, handler) { add("document", type, handler); },
  removeEventListener(type) { remove("document", type); },
};
globalThis.window = {
  addEventListener(type, handler) { add("window", type, handler); },
  removeEventListener(type) { remove("window", type); },
};
globalThis.location = { pathname: "/" };
globalThis.history = {
  pushState() {},
  replaceState() {},
};

try {
  let mounts = 0;
  let unmounts = 0;
  const router = createRouter({
    routes: { "/": { mount: () => { mounts += 1; return () => { unmounts += 1; }; } } },
    outlet: { innerHTML: "" },
    notFound: { mount: () => () => { unmounts += 1; } },
  });

  router.start();
  await new Promise((resolve) => setImmediate(resolve));
  router.start();
  assert.equal(addCalls.filter((entry) => entry.join(":") === "document:click").length, 1, "router start should register click handling once");
  assert.equal(addCalls.filter((entry) => entry.join(":") === "window:popstate").length, 1, "router start should register history handling once");

  router.stop();
  assert.equal(unmounts, 1, "router stop should unmount the active route");
  assert.deepEqual(removeCalls, [["document", "click"], ["window", "popstate"]], "router stop should remove registered listeners");
  router.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(mounts, 1, "router refresh must not remount a stopped application");
} finally {
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
  globalThis.location = originalLocation;
  globalThis.history = originalHistory;
}

console.log("router lifecycle verification passed");
