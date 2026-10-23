import { DEFAULT_AI_LOADOUT, DEFAULT_TEAM_LOADOUT } from "../characters/catalog.js";
import { normalizeAiSeats } from "../model/model-support.js";

// 这是战斗规则配置，不是房间生命周期或客户端页面模式。
// 新胜负条件在这里选择纯求值器，不能取得终局字段的写权限。
const standard = Object.freeze({
  initialize() {},
  evaluateOutcome({ aAlive, bAlive }) {
    return aAlive && bAlive ? null : { winnerSeat: aAlive ? "A" : bAlive ? "B" : null };
  },
});

const tutorial = Object.freeze({
  evaluateOutcome: standard.evaluateOutcome,
  initialize({ worldSize, setTrainingDamageFloor, configureTrainingFleet, setCombatEnabled, setAiEnabled }) {
    setTrainingDamageFloor("A", 0.25);
    setCombatEnabled("A", false);
    setCombatEnabled("B", false);
    setAiEnabled("B", false);

    const trainingStats = {
      hp: 400,
      energy: 80,
      speed: 20,
      turnRate: 0.4,
      accel: 0.8,
      energyRegen: 4,
      moveDrain: 3,
      vision: 50,
      range: 100,
      damage: 5,
      fireRate: 0.08,
    };
    const positions = {
      main: { x: worldSize * 0.67, y: worldSize * 0.28 },
      sub1: { x: worldSize * 0.69, y: worldSize * 0.3 },
      sub2: { x: worldSize * 0.69, y: worldSize * 0.26 },
    };
    configureTrainingFleet("B", trainingStats, positions);
  },
});

const modes = Object.freeze({ standard, tutorial });

// 保留现有 options 协议；AI 席位、战斗规则、房间类型是不同维度。
export function resolveBattleMode(options = {}) {
  const mode = options.mode || "pvp";
  const aiSeats = normalizeAiSeats(mode, options.aiSeats);
  const battleMode = options.battleMode ?? (options.tutorialMode ? "tutorial" : "standard");
  if (!Object.hasOwn(modes, battleMode)) throw new Error(`未知战斗模式：${battleMode}`);
  return {
    mode, battleMode, aiSeats, tutorialMode: battleMode === "tutorial",
    rules: modes[battleMode],
    teamNames: {
      A: options.teamNames?.A || (aiSeats.includes("A") ? "观察方AI舰队A" : "玩家A舰队"),
      B: options.teamNames?.B || (aiSeats.includes("B") ? "统合思念体AI舰队" : "玩家B舰队"),
    },
    teamLoadouts: {
      A: options.teamLoadouts?.A || DEFAULT_TEAM_LOADOUT,
      B: options.teamLoadouts?.B || (aiSeats.includes("B") ? DEFAULT_AI_LOADOUT : DEFAULT_TEAM_LOADOUT),
    },
  };
}
