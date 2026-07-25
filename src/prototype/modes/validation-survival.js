import { validationSurvivalMode } from "../../../shared/modes/validation-survival.js";
import { DEFAULT_TEAM_LOADOUT, DEFAULT_AI_LOADOUT } from "../../../shared/game-core.js";

// 运行预设：限时生存验证 + A human / B ai
export const validationSurvivalPreset = {
  ...validationSurvivalMode,
  id: "validation-survival",
  name: "限时生存验证",
  description: "A 坚持指定秒数获胜；用于验证平台可扩展性（第二模式）。",
  runtimePreset: {
    controlA: "human",
    controlB: "ai",
    teamNameA: "生存实验舰队",
    teamNameB: "压迫 AI",
    defaultLoadoutA: DEFAULT_TEAM_LOADOUT,
    defaultLoadoutB: DEFAULT_AI_LOADOUT,
    aiDifficulty: "normal",
  },
};
