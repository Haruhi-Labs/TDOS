import assert from "node:assert/strict";
import {
  evaluateRulesetCompatibility,
  RULESET_VERSION,
} from "../shared/protocol/ruleset-version.js";

assert.match(RULESET_VERSION, /^ruleset-\d{8}-\d{2}$/, "规则版本必须使用可审计的日期序号格式");

assert.deepEqual(evaluateRulesetCompatibility(RULESET_VERSION), {
  compatible: true,
  status: "compatible",
  localVersion: RULESET_VERSION,
  remoteVersion: RULESET_VERSION,
});

assert.deepEqual(evaluateRulesetCompatibility(""), {
  compatible: true,
  status: "legacy",
  localVersion: RULESET_VERSION,
  remoteVersion: "",
});

const mismatch = evaluateRulesetCompatibility("ruleset-20260701-01");
assert.equal(mismatch.compatible, false);
assert.equal(mismatch.status, "mismatch");
assert.equal(mismatch.localVersion, RULESET_VERSION);
assert.equal(mismatch.remoteVersion, "ruleset-20260701-01");

console.log(`规则版本校验通过：当前 ${RULESET_VERSION}，兼容旧端并拒绝显式版本冲突。`);
