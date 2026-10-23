/**
 * 声明是普通对象，不持有可写世界状态；仅填写实际需要的扩展点。
 * timedAttributes: [[顺序, {until: 截止字段, multipliers: 属性倍率表}]]，仅数据。
 * statusEffects: [[顺序, (ship, {add, timed}) => void]]，只读投影。
 * ship.hooks / createTeam().hooks: [[顺序, 函数]]，消费语义见 ship-effects.js。
 * createBattle().operations: {名称: {phases: {阶段: 顺序}, run(dt)}}。
 * activeSkills / rules / queries / projectShip / projectTeam 见角色导航。
 * 顺序只用于同一钩子或阶段内排序，冲突立即拒绝；不依赖注册数组次序。
 */
// 阶段语义固定；角色只声明阶段内的确定顺序，不拥有调度器或其他角色实例。
export const BATTLE_PHASES = Object.freeze(["beforeAi", "afterTeams", "afterHull", "beforeVisibility", "beforeBeams", "afterVisuals"]);
export const SHIP_HOOKS = Object.freeze(["initialize", "clearControl", "clearPositive", "hasNegative", "clearNegative", "expireMarks", "registerClawHit", "advanceMovement", "prepareShotDamage", "onProjectileHit", "castExclusiveSubSkill", "consumeBarrierRam"]);
export const TEAM_HOOKS = Object.freeze(["initializeMembers", "clearPositive", "afterMovement"]);

export function compileHooks(parts, allowed) {
  const hooks = Object.fromEntries(allowed.map((key) => [key, []]));
  for (const part of parts) for (const [name, entries] of Object.entries(part.hooks || {})) {
    if (!Object.hasOwn(hooks, name)) throw new Error(`未声明的角色钩子：${name}`);
    for (const [order, run] of entries) {
      if (!Number.isFinite(order) || typeof run !== "function" || hooks[name].some((entry) => entry.order === order)) throw new Error(`角色钩子顺序冲突：${name}`);
      hooks[name].push({ order, run });
    }
  }
  for (const entries of Object.values(hooks)) { entries.sort((a, b) => a.order - b.order); Object.freeze(entries); }
  return Object.freeze({
    all: (name, ...args) => hooks[name].map(({ run }) => run(...args)),
    some: (name, ...args) => hooks[name].some(({ run }) => run(...args)),
    first(name, fallback, ...args) {
      for (const { run } of hooks[name]) { const result = run(...args); if (result !== null && result !== undefined) return result; }
      return fallback;
    },
    reduce(name, value, ...args) { for (const { run } of hooks[name]) value = run(value, ...args); return value; },
  });
}

// 普通定时属性只声明数据；在既有定时增益阶段按明确顺序相乘，不执行角色回调。
export function compileTimedAttributes(extensions) {
  const entries = extensions.flatMap((extension) => extension.timedAttributes || []);
  const orders = new Set();
  const keys = new Set(["speed", "turnRate", "accel", "range", "vision", "damage", "fireRate"]);
  return Object.freeze(entries.map(([order, { until, multipliers }]) => {
    if (!Number.isFinite(order) || orders.has(order)) throw new Error("定时属性顺序冲突");
    orders.add(order);
    if (typeof until !== "string" || !until || !multipliers || typeof multipliers !== "object") throw new Error("定时属性需要截止字段与倍率表");
    for (const [key, value] of Object.entries(multipliers)) {
      if (!keys.has(key) || !Number.isFinite(value) || value <= 0) throw new Error(`无效的定时属性倍率：${key}`);
    }
    return Object.freeze({ order, until, multipliers: Object.freeze({ ...multipliers }) });
  }).sort((a, b) => a.order - b.order));
}

export function composeCapabilities(parts) {
  const result = Object.create(null);
  for (const part of parts) for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(part.capabilities || {}))) {
    if (Object.hasOwn(result, key)) throw new Error(`角色能力重复：${key}`);
    Object.defineProperty(result, key, descriptor);
  }
  return Object.freeze(result);
}

export function compileBattle(parts) {
  const operations = Object.create(null);
  const phases = Object.fromEntries(BATTLE_PHASES.map((name) => [name, []]));
  for (const part of parts) for (const [name, operation] of Object.entries(part.operations || {})) {
    if (Object.hasOwn(operations, name)) throw new Error(`角色操作重复：${name}`);
    operations[name] = operation.run;
    for (const [phase, order] of Object.entries(operation.phases)) {
      if (!Object.hasOwn(phases, phase)) throw new Error(`未声明的角色阶段：${phase}`);
      if (!Number.isFinite(order) || phases[phase].some((entry) => entry.order === order)) throw new Error(`角色阶段顺序冲突：${phase}`);
      phases[phase].push({ name, order });
    }
  }
  const schedule = Object.freeze(Object.fromEntries(Object.entries(phases).map(([phase, entries]) => [phase, Object.freeze(entries.sort((a, b) => a.order - b.order).map((entry) => entry.name))])));
  const initialize = compileHooks(parts.map((part) => ({ hooks: part.initialize ? { initialize: part.initialize } : {} })), ["initialize"]);
  return Object.freeze({
    schedule,
    initialize: () => initialize.all("initialize"),
    advance(phase, dt) {
      if (!Object.hasOwn(schedule, phase)) throw new Error(`未声明的角色阶段：${phase}`);
      for (const name of schedule[phase]) operations[name](dt);
    },
    run(name) {
      if (!Object.hasOwn(operations, name)) throw new Error(`未声明的角色操作：${name}`);
      return operations[name]();
    },
  });
}

export function projectExtensions(extensions, kind, entity) {
  const fields = {};
  for (const extension of extensions) {
    const project = extension[kind];
    if (!project) continue;
    for (const [key, value] of Object.entries(project(entity))) {
      if (Object.hasOwn(fields, key)) throw new Error(`角色投影字段重复：${key}`);
      fields[key] = value;
    }
  }
  return fields;
}

export function compileActiveSkills(extensions) {
  const entries = new Map();
  for (const extension of extensions) {
    if (entries.has(extension.id)) throw new Error(`角色编号重复：${extension.id}`);
    const skills = extension.activeSkills || {};
    for (const [slot, execute] of Object.entries(skills)) {
      if (!["flagship", "sub"].includes(slot) || typeof execute !== "function") throw new Error(`未声明的主动技能槽位：${slot}`);
    }
    entries.set(extension.id, Object.freeze({ ...skills }));
  }
  return Object.freeze({
    execute(slot, id, port, meta) {
      if (!["flagship", "sub"].includes(slot)) throw new Error(`未声明的主动技能槽位：${slot}`);
      const execute = entries.get(id)?.[slot];
      return execute ? execute(port, meta) : false;
    },
  });
}
