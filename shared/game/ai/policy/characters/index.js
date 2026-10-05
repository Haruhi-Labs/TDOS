// 角色 AI 档案的注册表。通用决策代码按角色编号取档案，不直接写角色分支。
// 档案字段（均可缺省）：
//   splitBias(SU)               分离效用里的角色偏置，SU 为 params.split.utility
//   intelLeadBias(D)            前探舰评分里的角色偏置，D 为 params.detached.intelLead
//   detachedDefaultRole         分离后没有特殊任务时的默认角色
//   splitsEarlyAgainstBarrier   面对敌方能量圈时提前分离去破盾
//   flagship / sub              技能档案：
//     purgeableBuff             技能增益会被视野波净化，来波时暂缓施放
//     timerFollowsCooldown      判断节拍直接跟随技能冷却
//     energyFloors(K)           施放后的能量底线，缺省用通用底线
//     shouldCast(policy, view)  施放条件；缺省表示通过通用前置条件即可施放
//     target(policy, view)      需要目标的技能返回动作载荷，返回 null 表示不带目标
//     decideAlone(...)          完全自行决定，不经过通用前置条件
import asakura from "./asakura.js";
import bunnyHaruhi from "./bunny-haruhi.js";
import future1096 from "./future1096.js";
import haruhi from "./haruhi.js";
import koizumi from "./koizumi.js";
import kyon from "./kyon.js";
import shamisen from "./shamisen.js";
import tsuruya from "./tsuruya.js";
import yuki from "./yuki.js";

const PROFILES = new Map(
  [asakura, bunnyHaruhi, future1096, haruhi, koizumi, kyon, shamisen, tsuruya, yuki].map((profile) => [profile.id, profile]),
);
const EMPTY_PROFILE = Object.freeze({ id: null });

export function characterProfile(characterId) {
  return PROFILES.get(characterId) || EMPTY_PROFILE;
}
