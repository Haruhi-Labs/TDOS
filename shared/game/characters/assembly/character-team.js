import { CHARACTER_EXTENSIONS } from "./registry.js";
import { compileHooks, composeCapabilities, TEAM_HOOKS, projectExtensions } from "./extension-contract.js";

export function createTeamCharacters(team, facing, extensions = CHARACTER_EXTENSIONS) {
  const parts = extensions.filter((extension) => extension.createTeam).map((extension) => extension.createTeam(team, facing));
  const hooks = compileHooks(parts, TEAM_HOOKS);
  const capabilities = composeCapabilities(parts);
  let effectView;
  const result = {
    get effects() {
      const fields = projectExtensions(parts, "effects");
      if (!effectView || Object.keys(fields).some((key) => fields[key] !== effectView[key])) effectView = Object.freeze(fields);
      return effectView;
    },
    initializeMembers: () => hooks.all("initializeMembers"),
    clearPositive: (preserve) => hooks.all("clearPositive", preserve).some(Boolean),
    afterMovement: (dt) => hooks.all("afterMovement", dt),
  };
  for (const key of Object.keys(capabilities)) if (Object.hasOwn(result, key)) throw new Error(`角色能力覆盖生命周期：${key}`);
  Object.defineProperties(result, Object.getOwnPropertyDescriptors(capabilities));
  return Object.freeze(result);
}
