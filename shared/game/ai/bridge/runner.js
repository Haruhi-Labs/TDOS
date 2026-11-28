// 每个 AI 席位的运行器：创建动作端口与策略，并在每个逻辑帧驱动策略一次。
// 当前版本仅允许在精确 A/B 双舰队对立拓扑上启动内置 AI 策略，多席或非 A/B 拓扑明确拒绝。
import { BotController } from "../bot-controller.js";
import { createActionPort } from "./action-port.js";
import { isLegacyTwoFleetMatch } from "./observation.js";

export function createAiRunner(match, seat, { params } = {}) {
  const port = createActionPort(match, seat);
  if (!isLegacyTwoFleetMatch(match)) {
    throw new Error(`当前版本不支持在多席或非 A/B 拓扑下启用 AI（席位：${seat}）`);
  }
  const rngMap = match?.aiRng;
  const rng = rngMap && Object.hasOwn(rngMap, seat) ? rngMap[seat] : null;
  if (!rng || typeof rng.range !== "function") {
    throw new Error(`席位 ${seat} 缺少独立的 AI 随机流`);
  }
  if (params !== undefined && (!params || typeof params !== "object" || Array.isArray(params))) {
    throw new TypeError(`席位 ${seat} 的 AI 参数必须是普通对象`);
  }
  const policy = new BotController(port, { rng, params });
  return {
    seat,
    port,
    policy,
    update(dt, elapsed) {
      policy.update(dt, elapsed);
    },
  };
}
