import assert from "node:assert/strict";
import {
  buildServerUrlCandidates,
  defaultServerUrl,
  isLocalHostname,
} from "../src/online/connection-target.js";

assert.equal(isLocalHostname("localhost"), true);
assert.equal(isLocalHostname("192.168.1.20"), true);
assert.equal(isLocalHostname("172.31.0.8"), true);
assert.equal(isLocalHostname("haruyuki.cn"), false);

const forced = buildServerUrlCandidates({
  locationObject: {
    search: "?ws=wss%3A%2F%2Fdebug.example%2Fsocket",
    protocol: "https:",
    host: "haruyuki.cn",
    hostname: "haruyuki.cn",
  },
  baseUrl: "/test-game/",
});
assert.deepEqual(forced, ["wss://debug.example/socket"]);

const production = buildServerUrlCandidates({
  locationObject: {
    search: "",
    protocol: "https:",
    host: "haruyuki.cn",
    hostname: "haruyuki.cn",
  },
  baseUrl: "/test-game/",
});
assert.deepEqual(production, [
  "wss://haruyuki.cn/test-game/ws/",
  "wss://haruyuki.cn:21246/",
]);
assert.equal(
  defaultServerUrl({
    locationObject: {
      search: "",
      protocol: "https:",
      host: "haruyuki.cn",
      hostname: "haruyuki.cn",
    },
    baseUrl: "/test-game/",
  }),
  production[0],
);

const local = buildServerUrlCandidates({
  locationObject: {
    search: "",
    protocol: "http:",
    host: "127.0.0.1:5174",
    hostname: "127.0.0.1",
  },
  baseUrl: "/",
});
assert.deepEqual(local, [
  "ws://127.0.0.1:5174/ws/",
  "ws://127.0.0.1:21246/",
  "ws://localhost:21246/",
]);

console.log("联机组件校验通过：强制地址、测试站同源代理和本地备用连接顺序保持一致。");
