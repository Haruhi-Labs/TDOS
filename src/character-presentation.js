import { CHARACTER_DEFS, characterDefinition } from "../shared/game/characters.js";
import { characterText, getLocale, skillText } from "./i18n.js";

const localized = new Map();

// 语言只属于展示投影；共享规则和正在运行的舰船都不随界面语言改写。
export function characterPresentation(id) {
  const definition = CHARACTER_DEFS[id];
  if (!definition) return undefined;
  const key = `${getLocale()}:${id}`;
  if (!localized.has(key)) {
    const skill = (mode, source) => Object.freeze({
      ...source,
      name: skillText(id, mode) || source.name,
      description: skillText(id, mode, "description") || source.description,
    });
    localized.set(key, Object.freeze({
      ...definition,
      name: characterText(id, "name") || definition.name,
      shortName: characterText(id, "shortName") || definition.shortName,
      title: characterText(id, "title") || definition.title,
      flavor: characterText(id, "flavor") || definition.flavor,
      flagshipSkill: skill("flagship", definition.flagshipSkill),
      subSkill: skill("sub", definition.subSkill),
    }));
  }
  return localized.get(key);
}

export function skillPresentation(id, mode = "flagship") {
  const character = characterPresentation(characterDefinition(id).id);
  return mode === "sub" ? character.subSkill : character.flagshipSkill;
}
