import { CHARACTER_RULES } from "./character-rules.js";
import { SHIP_EFFECTS } from "./ship-effects.js";
import { projectShip } from "./ship-projection.js";
import { projectTeam } from "./team-projection.js";
import { createTeamCharacters } from "./character-team.js";
import { createBattleCharacters } from "./character-battle.js";

// 角色装配的唯一入口：能力、实体扩展、队级状态、对局阶段与协议投影一起登记。
export const CHARACTER_ASSEMBLY = Object.freeze({
  rules: CHARACTER_RULES,
  shipEffects: SHIP_EFFECTS,
  projectShip,
  projectTeam,
  createTeam: createTeamCharacters,
  createBattle: createBattleCharacters,
});
