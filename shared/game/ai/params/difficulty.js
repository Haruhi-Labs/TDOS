// 单人难度由两部分组成：
//  1. AI 决策参数的覆盖层——只影响 AI 怎么想：
//     reactionMult 放大感知延迟，AI 看到并响应玩家动作更慢；
//     replanMult   放大改航间隔，AI 调整走位更不勤；
//     advancedCounterplay 困难以上才启用针对技能的高级反制（破盾编组、躲避视野波净化等）。
//  2. 对局级让分——属于规则层，由 MatchSimulation 写入 AI 所控舰队，与决策无关：
//     statMult    舰队数值缩放（血量与伤害）；
//     focusLowHp  开火时锁定射程内血量最低的敌人，其余难度与玩家同规则取最近。
// 注：极限（满状态 AI，也是基准与默认席位）的锁血是经明确要求开放的最高难度特性，
// 与历史上被移除的「全 AI 默认偷偷锁血」不同——仅在玩家主动选择极限档时生效。

export const AI_DIFFICULTY_OVERLAYS = Object.freeze({
  // 反应约 0.75 秒、峰值约 1.4 秒，改航约 3.2 到 5.2 秒：迟钝
  easy: Object.freeze({
    difficulty: Object.freeze({ reactionMult: 9.0, replanMult: 2.4 }),
    features: Object.freeze({ advancedCounterplay: false }),
  }),
  // 反应约 0.37 秒，改航约 2.3 到 3.7 秒
  normal: Object.freeze({
    difficulty: Object.freeze({ reactionMult: 4.5, replanMult: 1.7 }),
    features: Object.freeze({ advancedCounterplay: false }),
  }),
  // 反应约 0.18 秒
  hard: Object.freeze({
    difficulty: Object.freeze({ reactionMult: 2.2, replanMult: 1.25 }),
    features: Object.freeze({ advancedCounterplay: true }),
  }),
  // 满状态 AI：反应最快
  master: Object.freeze({
    difficulty: Object.freeze({ reactionMult: 1.0, replanMult: 1.0 }),
    features: Object.freeze({ advancedCounterplay: true }),
  }),
});

export const AI_HANDICAPS = Object.freeze({
  easy: Object.freeze({ statMult: 0.8, focusLowHp: false }), // 数值×0.8：脆
  normal: Object.freeze({ statMult: 1.0, focusLowHp: false }),
  hard: Object.freeze({ statMult: 1.2, focusLowHp: false }), // 数值×1.2：更肉更痛
  master: Object.freeze({ statMult: 1.2, focusLowHp: true }), // 数值×1.2（与困难持平）并智能集火残血
});

export function normalizeAiDifficulty(level) {
  return Object.hasOwn(AI_DIFFICULTY_OVERLAYS, level) ? level : "master";
}

export function aiHandicapFor(level) {
  return AI_HANDICAPS[normalizeAiDifficulty(level)];
}
