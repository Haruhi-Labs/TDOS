import { validateModeDefinition } from "../../shared/modes/mode-definition.js";

const modes = new Map();
const order = [];

export function resetPrototypeRegistry() {
  modes.clear();
  order.length = 0;
}

export function registerPrototypeMode(mode) {
  validateModeDefinition(mode);
  if (modes.has(mode.id)) {
    throw new Error(`Duplicate mode id: ${mode.id}`);
  }
  modes.set(mode.id, mode);
  order.push(mode.id);
  return mode;
}

export function getPrototypeMode(id) {
  return modes.get(id) || null;
}

export function listPrototypeModes({ includeDisabled = false } = {}) {
  return order
    .map((id) => modes.get(id))
    .filter(Boolean)
    .filter((mode) => includeDisabled || mode.status !== "disabled");
}

export function listPrototypeModeIds() {
  return [...order];
}
