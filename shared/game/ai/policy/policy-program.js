import { viewMethods } from "./view.js";
import { commandsMethods } from "./commands.js";
import { debugStateMethods } from "./debug-state.js";
import { geometryMethods } from "./geometry.js";
import { evaluationMethods } from "./evaluation.js";
import { energyMethods } from "./energy.js";
import { contextMethods } from "./context.js";
import { splitMethods } from "./split.js";
import { modeMethods } from "./mode.js";
import { scoutMethods } from "./scout.js";
import { skillsMethods } from "./skills.js";
import { detachedMethods } from "./detached.js";
import { targetsMethods } from "./targets.js";
import { movementMethods } from "./movement.js";

const METHODS = Object.freeze({
  ...viewMethods,
  ...commandsMethods,
  ...debugStateMethods,
  ...geometryMethods,
  ...evaluationMethods,
  ...energyMethods,
  ...contextMethods,
  ...splitMethods,
  ...modeMethods,
  ...scoutMethods,
  ...skillsMethods,
  ...detachedMethods,
  ...targetsMethods,
  ...movementMethods,
});
const READS = Object.freeze([
  "obs",
  "currentContext",
  "lastTacticalPlan",
  "rememberedMain",
  "rememberedContacts",
  "seat",
  "mode",
  "modeTimer",
  "moveTimer",
  "scoutTimer",
  "flagshipTimer",
  "subTimers",
  "searchZoneId",
  "knownContactCount",
  "pendingContactCount",
  "lastScoutDecision",
  "scoutDoctrine",
  "lastFlagshipDecision",
  "lastSubSkillDecision",
  "lastSplitDecision",
  "params",
  "searchSweepSign",
  "profile",
  "stuckTimer",
  "lastMainPos",
  "koizumiOrbSteerTimer",
  "reactionMult",
]);
const OPERATIONS = Object.freeze([
  "ownShips",
  "ownShipById",
  "knownEnemyContacts",
  "primaryEnemyEstimate",
  "projectContact",
  "predictEnemyVector",
  "planYukiDeployment",
  "beliefZoneWeights",
]);

// 查询算法没有动作端口、随机流或其他执行算法。每个执行入口只获得声明的副作用能力。
// 子调用总以自己的能力上下文运行，不能继承调用方的写权限。
export const POLICY_PROGRAM_EFFECTS = Object.freeze(Object.fromEntries(Object.entries({
  ...Object.fromEntries(Object.keys(commandsMethods).map((name) => [name, ["port"]])),
  enforceEnergyThrottleCaps: ["writeThrottle"],
  executeSplit: ["writeSplit"],
  issueShipRoute: ["writeRoute", "writeThrottle", "writeRouteEndpoint"],
  executeOrbSteering: ["issueShipRoute"],
  executeMovement: ["issueShipRoute", "computeSearchTarget", "rng"],
  computeSearchTarget: ["rng"],
  planMode: ["rng"],
}).map(([name, capabilities]) => [name, Object.freeze(capabilities)])));

export function createPolicyProgram(read, invoke) {
  let visionWaveBuffDeferrals = 0;
  const queries = Object.create(null);
  const contexts = new Map();
  const evaluate = (name, args) => {
    const result = METHODS[name].apply(contexts.get(name) || queries, args);
    if (name === "incomingVisionWaveWillPurge" && result) visionWaveBuffDeferrals += 1;
    return result;
  };
  for (const name of READS) Object.defineProperty(queries, name, { get: () => read(name) });
  for (const name of OPERATIONS) queries[name] = (...args) => invoke(name, args);
  for (const name of Object.keys(METHODS)) {
    if (!Object.hasOwn(POLICY_PROGRAM_EFFECTS, name)) queries[name] = (...args) => evaluate(name, args);
  }
  Object.freeze(queries);
  for (const [name, capabilities] of Object.entries(POLICY_PROGRAM_EFFECTS)) {
    const context = Object.create(queries);
    for (const capability of capabilities) {
      if (capability === "port" || capability === "rng")
        Object.defineProperty(context, capability, { get: () => read(capability) });
      else Object.defineProperty(context, capability, { value: (...args) => evaluate(capability, args) });
    }
    contexts.set(name, Object.freeze(context));
  }
  return Object.freeze({
    get metrics() { return Object.freeze({ visionWaveBuffDeferrals }); },
    run(name, ...args) {
      if (!Object.hasOwn(METHODS, name)) throw new Error(`未声明的策略计算：${name}`);
      return evaluate(name, args);
    },
  });
}
