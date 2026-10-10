import { runAiSuite } from "./core-tests/ai-suite.mjs";
import { runRulesSuite } from "./core-tests/rules-suite.mjs";
import { runTutorialSuite } from "./core-tests/tutorial-suite.mjs";
import { runBunnyHaruhiSuite } from "./core-tests/bunny-haruhi-suite.mjs";
import { runHaruhiSupportSuite } from "./core-tests/haruhi-support-suite.mjs";
import { runBunnyHaruhiIntegrationSuite } from "./core-tests/bunny-haruhi-integration-suite.mjs";
import { runBunnyCompanionSuite } from "./core-tests/bunny-companion-suite.mjs";
import { runBunnyAiSuite } from "./core-tests/bunny-ai-suite.mjs";
import { runRngSuite } from "./core-tests/rng-suite.mjs";
import { runAiObservationSuite } from "./core-tests/ai-observation-suite.mjs";
import { runAiActionsSuite } from "./core-tests/ai-actions-suite.mjs";
import { runAiParamsSuite } from "./core-tests/ai-params-suite.mjs";
import { runAiPolicySuite } from "./core-tests/ai-policy-suite.mjs";

const suites = new Map([
  ["rules", runRulesSuite],
  ["ai", runAiSuite],
  ["tutorial", runTutorialSuite],
  ["bunny-haruhi", runBunnyHaruhiSuite],
  ["haruhi-support", runHaruhiSupportSuite],
  ["bunny-haruhi-integration", runBunnyHaruhiIntegrationSuite],
  ["bunny-companion", runBunnyCompanionSuite],
  ["bunny-ai", runBunnyAiSuite],
  ["rng", runRngSuite],
  ["ai-observation", runAiObservationSuite],
  ["ai-actions", runAiActionsSuite],
  ["ai-params", runAiParamsSuite],
  ["ai-policy", runAiPolicySuite],
]);
const requestedSuites = process.argv.slice(2);
const suiteNames = requestedSuites.length > 0 ? requestedSuites : [...suites.keys()];

for (const name of suiteNames) {
  const runSuite = suites.get(name);
  if (!runSuite) {
    throw new Error(`未知核心测试领域：${name}`);
  }
  runSuite();
  console.log(`核心测试通过：${name}`);
}
console.log("核心战斗逻辑校验通过");
