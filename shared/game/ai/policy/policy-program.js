import { createFactCalculations } from "./fact-calculations.js";
import { POLICY_PROGRAM_INPUTS } from "./policy-inputs.js";
import { viewMethods } from "./view.js";
import { commandsMethods } from "./commands.js";
import { debugStateMethods } from "./debug-state.js";
import { energyMethods } from "./heuristics/energy.js";
import { contextMethods } from "./heuristics/context.js";
import { splitMethods } from "./heuristics/split.js";
import { scoutMethods } from "./heuristics/scout.js";
import { skillsMethods } from "./heuristics/skills.js";
import { detachedMethods } from "./heuristics/detached.js";
import { targetsMethods } from "./heuristics/targets.js";
import { movementMethods } from "./heuristics/movement.js";

const METHODS = Object.freeze({
  ...viewMethods,
  ...commandsMethods,
  ...debugStateMethods,
  ...energyMethods,
  ...contextMethods,
  ...splitMethods,
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
  issueShipRoute: ["writeRoute", "writeThrottle", "writeRouteEndpoint"],
  executeOrbSteering: ["issueShipRoute"],
  executeMovement: ["issueShipRoute", "computeSearchTarget", "rng"],
  computeSearchTarget: ["rng"],
  planMode: ["rng"],
}).map(([name, capabilities]) => [name, Object.freeze(capabilities)])));

export function createPolicyProgram(read, invoke) {
  let visionWaveBuffDeferrals = 0;
  const calculations = createFactCalculations(read, invoke);
  const contexts = new Map();
  const evaluate = (name, args) => {
    const result = Object.hasOwn(calculations, name) ? calculations[name](...args) : METHODS[name](contexts.get(name), ...args);
    if (name === "incomingVisionWaveWillPurge" && result) visionWaveBuffDeferrals += 1;
    return result;
  };
  for (const name of Object.keys(METHODS)) {
    const context = Object.create(null);
    for (const input of POLICY_PROGRAM_INPUTS[name]) {
      const effects = POLICY_PROGRAM_EFFECTS[name] || [];
      if (input === "port" || input === "rng" || Object.hasOwn(POLICY_PROGRAM_EFFECTS, input)) {
        if (!effects.includes(input)) throw new Error(`策略计算 ${name} 未声明执行能力 ${input}`);
      }
      if (READS.includes(input)) {
        if (Object.hasOwn(POLICY_PROGRAM_EFFECTS, name)) context[input] = () => read(input);
        else Object.defineProperty(context, input, { get: () => read(input) });
      } else if (input === "port" || input === "rng") Object.defineProperty(context, input, { get: () => read(input) });
      else if (OPERATIONS.includes(input)) context[input] = (...args) => invoke(input, args);
      else if (Object.hasOwn(METHODS, input) || Object.hasOwn(calculations, input)) context[input] = (...args) => evaluate(input, args);
      else throw new Error(`策略计算 ${name} 存在未知输入 ${input}`);
    }
    contexts.set(name, Object.freeze(context));
  }
  return Object.freeze({
    get metrics() { return Object.freeze({ visionWaveBuffDeferrals }); },
    run(name, ...args) {
      if (!Object.hasOwn(METHODS, name) && !Object.hasOwn(calculations, name)) throw new Error(`未声明的策略计算：${name}`);
      return evaluate(name, args);
    },
  });
}
