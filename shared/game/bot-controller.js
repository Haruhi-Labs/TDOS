// AI 控制器的对外门面。决策逻辑在 ai/policy/ 下；这里只为对局循环、调试页和测试提供兼容入口：
// 外部调用只接受数据；刷新观测不再为真实实体提供隐式转换通道。
import { RulePolicy } from "./ai/policy/rule-policy.js";

export class BotController extends RulePolicy {
  #observationPort;
  constructor(port, options) {
    super(port, options);
    this.#observationPort = port;
    const entries = new Map();
    const proxy = new Proxy(this, {
      set(target, property, value) {
        // 仅允许声明过的配置入口；代理不能成为状态字段或新属性的写入后门。
        let owner = target;
        while (owner && !Object.hasOwn(owner, property)) owner = Object.getPrototypeOf(owner);
        const descriptor = owner && Object.getOwnPropertyDescriptor(owner, property);
        if (!descriptor?.set) return false;
        assertDataArgument(value);
        descriptor.set.call(target, value);
        return true;
      },
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (typeof value !== "function" || property === "constructor" || Object.hasOwn(target, property)) return value;
        if (!entries.has(property)) entries.set(property, (...args) => {
          for (const arg of args) assertDataArgument(arg);
          port.invalidate();
          const result = value.apply(target, args);
          // 配置操作的链式返回保持在门面内，不能泄露绕过数据校验的原始策略。
          return result === target ? proxy : result;
        });
        return entries.get(property);
      },
    });
    return proxy;
  }

  // 校验用：观测先经 JSON 往返再交给决策。
  get strictObservation() {
    return this.#observationPort.strict;
  }

  set strictObservation(value) {
    this.#observationPort.strict = Boolean(value);
    this.#observationPort.invalidate();
  }
}

function assertDataArgument(value, seen = new Set()) {
  if (typeof value === "function") throw new TypeError("AI 决策入口不接受持有外部能力的回调");
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
