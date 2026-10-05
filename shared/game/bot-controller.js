// AI 控制器的对外门面。决策逻辑在 ai/policy/ 下；这里只为对局循环、调试页和测试提供兼容入口：
// 外部调用任一方法时先刷新观测，并把传入的实时舰船换成观测数据。
import { RulePolicy } from "./ai/policy/rule-policy.js";

export class BotController extends RulePolicy {
  constructor(port, options) {
    super(port, options);
    this.entryDepth = 0;
    this.entryGuards = new Map();
    return new Proxy(this, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        return typeof value === "function" && property !== "constructor" && !Object.hasOwn(target, property)
          ? target.guardedEntry(property, value)
          : value;
      },
    });
  }

  // 内部互相调用直接走原型方法，不经过这里。
  guardedEntry(name, method) {
    let guard = this.entryGuards.get(name);
    if (!guard) {
      guard = (...args) => {
        if (this.entryDepth > 0) return method.apply(this, args);
        this.port.invalidate();
        this.entryDepth = 1;
        try {
          return method.apply(this, args.map((arg) => this.observeArgument(arg)));
        } finally {
          this.entryDepth = 0;
        }
      };
      this.entryGuards.set(name, guard);
    }
    return guard;
  }

  observeArgument(arg) {
    return this.port.observeLive(arg, (id) => this.ownShipById(id));
  }

  // 兼容外部读取己方舰队；决策代码不得使用。
  get team() {
    return this.port.team;
  }

  // 校验用：观测先经 JSON 往返再交给决策。
  get strictObservation() {
    return this.port.strict;
  }

  set strictObservation(value) {
    this.port.strict = Boolean(value);
    this.port.invalidate();
  }
}
