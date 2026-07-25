// 统一模式接口：平台 runtime 只通过这些字段/函数与具体模式交互。

export const MODE_STATUS = Object.freeze({
  EXPERIMENTAL: "experimental",
  CANDIDATE: "candidate",
  PRODUCTION: "production",
  DISABLED: "disabled",
});

const STATUS_SET = new Set(Object.values(MODE_STATUS));
const PARAM_TYPES = new Set(["number", "boolean", "select"]);

function isFunction(value) {
  return typeof value === "function";
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function validateParameterSchema(schema, modeId = "mode") {
  assert(Array.isArray(schema), `${modeId}: parameterSchema must be an array`);
  const keys = new Set();
  for (const field of schema) {
    assert(field && typeof field === "object", `${modeId}: parameter field must be object`);
    assert(typeof field.key === "string" && field.key.trim(), `${modeId}: parameter key required`);
    assert(!keys.has(field.key), `${modeId}: duplicate parameter key ${field.key}`);
    keys.add(field.key);
    assert(typeof field.label === "string" && field.label.trim(), `${modeId}: parameter label required for ${field.key}`);
    assert(PARAM_TYPES.has(field.type), `${modeId}: unsupported parameter type ${field.type}`);
    if (field.type === "number") {
      assert(Number.isFinite(Number(field.default)), `${modeId}: number default required for ${field.key}`);
    }
    if (field.type === "boolean") {
      assert(typeof field.default === "boolean", `${modeId}: boolean default required for ${field.key}`);
    }
    if (field.type === "select") {
      assert(Array.isArray(field.options) && field.options.length > 0, `${modeId}: select options required for ${field.key}`);
    }
  }
  return true;
}

export function normalizeModeParameters(schema, input = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const out = {};
  for (const field of schema || []) {
    const key = field.key;
    if (field.type === "boolean") {
      out[key] = Object.prototype.hasOwnProperty.call(raw, key) ? Boolean(raw[key]) : Boolean(field.default);
      continue;
    }
    if (field.type === "select") {
      const options = (field.options || []).map((item) => (typeof item === "object" ? item.value : item));
      const value = Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : field.default;
      out[key] = options.includes(value) ? value : field.default;
      continue;
    }
    // number
    const fallback = Number(field.default);
    let value = Object.prototype.hasOwnProperty.call(raw, key) ? Number(raw[key]) : fallback;
    if (!Number.isFinite(value)) value = fallback;
    if (Number.isFinite(Number(field.min))) value = Math.max(Number(field.min), value);
    if (Number.isFinite(Number(field.max))) value = Math.min(Number(field.max), value);
    out[key] = value;
  }
  return out;
}

export function validateModeDefinition(mode) {
  assert(mode && typeof mode === "object", "mode definition must be an object");
  assert(typeof mode.id === "string" && mode.id.trim(), "mode.id is required");
  assert(typeof mode.name === "string" && mode.name.trim(), "mode.name is required");
  assert(STATUS_SET.has(mode.status), `mode.status invalid: ${mode.status}`);
  assert(Number.isFinite(Number(mode.version)), "mode.version must be a number");
  assert(Array.isArray(mode.parameterSchema), "mode.parameterSchema must be an array");
  validateParameterSchema(mode.parameterSchema, mode.id);
  assert(mode.defaultParameters && typeof mode.defaultParameters === "object", "mode.defaultParameters required");
  assert(isFunction(mode.createInitialModeState), `${mode.id}: createInitialModeState required`);
  assert(isFunction(mode.updateModeState), `${mode.id}: updateModeState required`);
  assert(isFunction(mode.resolveOutcome), `${mode.id}: resolveOutcome required`);
  assert(isFunction(mode.buildDiagnostics), `${mode.id}: buildDiagnostics required`);
  if (mode.serializeModeState != null) {
    assert(isFunction(mode.serializeModeState), `${mode.id}: serializeModeState must be function`);
  }
  return true;
}

export function createEmptyOutcome() {
  return {
    finished: false,
    winnerAllianceId: null,
    winnerSeat: null,
    reason: null,
    label: null,
  };
}
