import { STATUS_EFFECT_DEFS } from "./status-effect-definitions.js";
import { CHARACTER_EXTENSIONS } from "../characters/assembly/registry.js";
import { compileHooks } from "../characters/assembly/extension-contract.js";

export function statusEffectNames(effects) {
  return effects.map(({ id }) => STATUS_EFFECT_DEFS[id].name);
}

// 只负责统一寿命格式与声明顺序；效果是否存在及其参数归角色声明。
export function createStatusProjector(extensions, definitions = STATUS_EFFECT_DEFS) {
  const hooks = compileHooks(extensions.map((extension) => ({
    hooks: { projectStatus: extension.statusEffects || [] },
  })), ["projectStatus"]);
  return (ship) => {
    if (!ship.alive) return [];
    const now = ship.team.match.elapsed;
    const statuses = [];
    const add = (id, expiresAt = null, duration = null, detail = {}) => {
      if (!Object.hasOwn(definitions, id)) throw new Error(`未声明的状态图标：${id}`);
      if (expiresAt !== null && expiresAt <= now) return;
      statuses.push({ id, expiresAt, duration, remaining: expiresAt === null ? null : Math.max(0, expiresAt - now), ...detail });
    };
    const timed = (id, expiresAt, duration) => add(id, Number(expiresAt) || 0, Math.max(duration, (Number(expiresAt) || 0) - now));
    hooks.all("projectStatus", ship, Object.freeze({ add, timed }));
    return statuses;
  };
}

export const serializeShipStatusEffects = createStatusProjector(CHARACTER_EXTENSIONS);
