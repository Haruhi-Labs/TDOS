import { standardEliminationMode } from "../../../shared/modes/standard-elimination.js";
import { DEFAULT_TEAM_LOADOUT, DEFAULT_AI_LOADOUT } from "../../../shared/game-core.js";

// 运行预设：标准歼灭规则 + A human / B ai
export const standardAiOneVsOne = {
  ...standardEliminationMode,
  id: "standard-ai-1v1",
  name: "标准歼灭 · AI 1v1",
  description: "玩家 A 对抗 AI B，使用标准歼灭胜负。",
  runtimePreset: {
    controlA: "human",
    controlB: "ai",
    teamNameA: "实验舰队 A",
    teamNameB: "统合思念体 AI",
    defaultLoadoutA: DEFAULT_TEAM_LOADOUT,
    defaultLoadoutB: DEFAULT_AI_LOADOUT,
    aiDifficulty: "normal",
  },
};
