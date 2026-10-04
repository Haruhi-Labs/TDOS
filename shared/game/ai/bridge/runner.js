// 每个 AI 席位的运行器：创建动作端口与策略，并在每个逻辑帧驱动策略一次。
import { BotController } from "../../bot-controller.js";
import { createActionPort } from "./action-port.js";

export function createAiRunner(match, seat, { actionMode } = {}) {
  const port = createActionPort(match, seat, actionMode ? { mode: actionMode } : undefined);
  const policy = new BotController(port, { rng: match.aiRng[seat] });
  return {
    seat,
    port,
    policy,
    update(dt, elapsed) {
      policy.update(dt, elapsed);
    },
  };
}
