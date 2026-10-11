import { copyPlainData, freezePlainData } from "../../../../data/plain-data.js";

// 角色决策只消费这一份数据契约；不接收策略对象、随机源、执行端口或能力回调。
export function characterDecisionFacts({ obs, mode, energyHigh, skillAimLead, aimPadding, searchZoneId }) {
  return freezePlainData(copyPlainData({ obs, mode, energyHigh, skillAimLead, aimPadding, searchZoneId }));
}

export function characterDecisionInput(input) {
  return freezePlainData(copyPlainData(input));
}
