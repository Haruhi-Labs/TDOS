// AI 控制器的对外门面。决策逻辑在 ai/policy/ 下；这里只为对局循环、调试页和测试提供兼容入口：
// 外部调用只接受数据；刷新观测不再为真实实体提供隐式转换通道。
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
          for (const arg of args) assertDataArgument(arg);
          return method.apply(this, args);
        } finally {
          this.entryDepth = 0;
        }
      };
      this.entryGuards.set(name, guard);
    }
    return guard;
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

function assertDataArgument(value, seen = new Set()) {
  if (!value || typeof value !== "object") return;
  const prototype = Object.getPrototypeOf(value);
  const collection = value instanceof Set || value instanceof Map;
  if ((!Array.isArray(value) && !collection && prototype !== Object.prototype && prototype !== null) || seen.has(value)) {
    throw new TypeError("AI 决策入口只接受观测数据，不接受实体或循环引用");
  }
  seen.add(value);
  for (const child of collection ? value instanceof Map ? [...value].flat() : value : Object.values(value)) assertDataArgument(child, seen);
  seen.delete(value);
}
