// 具名参数预设：以覆盖层的形式表达一组成套的行为差异。

export const AI_PARAM_PRESETS = Object.freeze({
  // 旧版 AI：关闭全部升级，行为回到升级前的基线，用于推演页的新旧对照。
  legacy: Object.freeze({
    features: Object.freeze({
      characterPriority: false,
      closeout: false,
      barrierTactics: false,
      skillAimLead: false,
      advancedCounterplay: false,
      visionEngage: false,
      formationLeash: false,
    }),
  }),
});
