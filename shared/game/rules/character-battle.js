import { CHARACTER_EXTENSIONS } from "./extensions/index.js";
import { compileBattle, composeCapabilities } from "./extension-contract.js";

export function createBattleCharacters(match, extensions = CHARACTER_EXTENSIONS) {
  const parts = extensions.filter((extension) => extension.createBattle).map((extension) => extension.createBattle(match));
  const battle = compileBattle(parts);
  const result = { advance: battle.advance, run: battle.run, schedule: battle.schedule };
  const capabilities = composeCapabilities(parts);
  for (const key of Object.keys(capabilities)) if (Object.hasOwn(result, key)) throw new Error(`角色能力覆盖调度器：${key}`);
  Object.defineProperties(result, Object.getOwnPropertyDescriptors(capabilities));
  battle.initialize();
  return Object.freeze(result);
}
