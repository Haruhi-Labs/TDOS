import { observeOwnShip, observeEnemyEntity } from "../../shared/game/ai/bridge/observation.js";

// 旧场景用实体布置战场；在测试边界显式投影，生产 AI 不再承担夹具转换职责。
export function aiFixture(sim, seat = "B") {
  const policy = sim.botBySeat(seat);
  return new Proxy(policy, {
    get(target, key) {
      const value = target[key];
      if (typeof value !== "function") return value;
      return (...args) => value.apply(target, args.map((arg) => {
        if (!arg?.team || arg.team.match !== sim) return arg;
        return arg.team.seat === seat ? observeOwnShip(arg) : observeEnemyEntity(arg, sim.elapsed);
      }));
    },
  });
}
