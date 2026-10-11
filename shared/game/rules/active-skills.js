import { CHARACTER_EXTENSIONS } from "./extensions/index.js";
import { compileActiveSkills } from "./extension-contract.js";

// 技能效果来自同一角色声明；公共资格、资源、退款和成功冷却的消费时机不变。
const skills = compileActiveSkills(CHARACTER_EXTENSIONS);
export function executeFlagshipEffect(characterId, port, meta) { return skills.execute("flagship", characterId, port, meta); }
export function executeSubEffect(characterId, port, meta) { return skills.execute("sub", characterId, port, meta); }
