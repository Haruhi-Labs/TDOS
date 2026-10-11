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
  "port",
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
  "rng",
  "profile",
  "stuckTimer",
  "lastMainPos",
  "koizumiOrbSteerTimer",
  "reactionMult",
]);
const OPERATIONS = Object.freeze([
  "chooseMode",
  "ownShips",
  "ownShipById",
  "knownEnemyContacts",
  "primaryEnemyEstimate",
  "projectContact",
  "predictEnemyVector",
  "planYukiDeployment",
  "beliefZoneWeights",
  "advanceSearchCenter",
]);

// 启发式只能读取事实并调用列出的领域操作，不能取得策略对象或写入其字段。
export function createPolicyProgram(read, invoke) {
  const context = {};
  for (const name of READS) Object.defineProperty(context, name, { get: () => read(name) });
  for (const name of OPERATIONS) context[name] = (...args) => invoke(name, args);
  for (const [name, method] of Object.entries(METHODS)) context[name] = (...args) => method.apply(context, args);
  Object.freeze(context);
  return Object.freeze({ run(name, ...args) {
    if (!Object.hasOwn(METHODS, name)) throw new Error(`未声明的策略计算：${name}`);
    return METHODS[name].apply(context, args);
  } });
}
