import { haruhiBoostActive } from "../haruhi-flagship.js";
import { bunnyCompanionForm, bunnyReliableState } from "../bunny-companion-runtime.js";
import { bunnyStageEnabled } from "../bunny-haruhi-runtime.js";
import { isKoizumiOrbActive } from "../koizumi-orb.js";

const formFacts = (form) => form ? Object.freeze({ form: form.form, positiveSuppressed: form.positiveSuppressed, immunityUntil: form.immunityUntil }) : null;

// 实体读取只发生在适配边界；求值器得到按当前时刻采样的事实，不得到实体或回调。
// 不跨阶段缓存：变身、封印、转队与死亡在同帧后续查询中立即可见。
export function sampleAttributeFacts(ship) {
  const team = ship.team;
  return Object.freeze({
    now: team.match.elapsed,
    effects: ship.effects,
    characterId: ship.characterId,
    base: ship.base,
    futureForm: team.future1096FormDefinition(),
    futureEnabled: team.mainCharacterId() === "future1096",
    haruhiBoost: haruhiBoostActive(team),
    enabled: !team.areSkillsDisabled(),
    form: formFacts(ship.bunnyHaruhi),
    companionForm: ship.bunnyCompanion ? formFacts(bunnyCompanionForm(ship)) : null,
    reliable: ship.bunnyReliable ? bunnyReliableState(ship) : null,
    stage: ship.bunnyStageExposure || null,
    stageEnabled: ship.bunnyStageExposure ? bunnyStageEnabled(ship) : false,
    shock: ship.heroPowerShock,
    orbActive: isKoizumiOrbActive(ship),
  });
}
