import { registerPrototypeMode } from "../registry.js";
import { standardAiOneVsOne } from "./standard-ai-1v1.js";
import { validationSurvivalPreset } from "./validation-survival.js";

let registered = false;

export function registerBuiltInPrototypeModes() {
  if (registered) return;
  registerPrototypeMode(standardAiOneVsOne);
  registerPrototypeMode(validationSurvivalPreset);
  registered = true;
}

export function resetBuiltInPrototypeRegistrationFlag() {
  registered = false;
}
