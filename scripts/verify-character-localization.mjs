import assert from "node:assert/strict";
import { CHARACTER_DEFS, CHARACTER_ORDER, MatchSimulation } from "../shared/game-core.js";
import { characterPresentation, skillPresentation } from "../src/character-presentation.js";
import { getLocale, setLocale, shipCharacterName, skillText } from "../src/i18n.js";
import { CHARACTER_TEXT } from "../src/i18n/catalog.js";
import { battleSkillMeta } from "../src/battle/bunny-haruhi-view.js";

const originalLocale = getLocale();
const simulation = new MatchSimulation({ seed: 232 });
const initial = simulation.serializeState();
const definitions = JSON.stringify(CHARACTER_DEFS);
const views = new Map();
try {
  for (const locale of ["zh", "en", "ja", "zh"]) {
    setLocale(locale, { notify: false });
    for (const id of CHARACTER_ORDER) {
      const presentation = characterPresentation(id);
      const key = `${locale}:${id}`;
      if (views.has(key)) assert.equal(presentation, views.get(key), "切回语言复用独立的不可变投影");
      views.set(key, presentation);
      assert.equal(presentation.name, CHARACTER_TEXT[locale][id].name);
      assert.equal(presentation.title, CHARACTER_TEXT[locale][id].title);
      assert.equal(presentation.stats, CHARACTER_DEFS[id].stats, "展示数值读取同一份只读规则配置");
      assert.equal(shipCharacterName({ characterId: id }), presentation.name);
      assert.throws(() => { presentation.name = "外部改写"; }, TypeError);
      for (const mode of ["flagship", "sub"]) {
        const meta = skillPresentation(id, mode);
        const rule = CHARACTER_DEFS[id][mode === "sub" ? "subSkill" : "flagshipSkill"];
        assert.equal(meta.name, skillText(id, mode));
        assert.equal(meta.description, skillText(id, mode, "description"));
        assert.equal(meta.cooldown, rule.cooldown);
        assert.equal(meta.cost, rule.cost);
        assert.equal(battleSkillMeta(id, mode).name, meta.name, "战场技能按钮也必须消费展示投影");
        assert.throws(() => { meta.cost = 0; }, TypeError);
      }
    }
    assert.equal(JSON.stringify(CHARACTER_DEFS), definitions, "语言切换不能改写共享定义");
    assert.deepEqual(simulation.serializeState(), initial, "语言切换不能改写进行中的权威快照");
    assert.deepEqual(new MatchSimulation({ seed: 232 }).serializeState(), initial,
      "不同界面语言下新建的权威状态必须一致");
  }
  assert.equal(characterPresentation("未注册角色"), undefined);
  assert.equal(skillPresentation("未注册角色").id, CHARACTER_DEFS.haruhi.flagshipSkill.id);
} finally {
  setLocale(originalLocale, { notify: false });
}
console.log("角色本地化校验通过：三语言九角色投影、技能与数值分层、切换复用、权威状态语言无关。");
