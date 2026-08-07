import assert from "node:assert/strict";
import {
  cooldownProgressRatio,
  resolveCooldownDuration,
  setCooldownProgress,
} from "../src/battle/cooldown-progress.js";

assert.equal(cooldownProgressRatio(20, 20), 1, "冷却开始时阴影覆盖整个按钮");
assert.equal(cooldownProgressRatio(10, 20), 0.5, "冷却过半时阴影覆盖半个按钮");
assert.equal(cooldownProgressRatio(0, 20), 0, "冷却结束时阴影完全退去");
assert.equal(cooldownProgressRatio(Number.NaN, 20), 0, "异常剩余时间安全回退");
assert.equal(cooldownProgressRatio(30, 20), 1, "异常超量冷却限制在完整按钮内");

const autoScoutDuration = resolveCooldownDuration({
  remaining: 5.1,
  suggestedDuration: 5.2,
});
assert.equal(autoScoutDuration, 5.2, "自动侦察使用完整双倍冷却周期");
assert.equal(resolveCooldownDuration({
  remaining: 2.5,
  suggestedDuration: 2.6,
  previousRemaining: 2.7,
  previousDuration: autoScoutDuration,
  active: true,
}), 5.2, "同一轮侦察冷却跨过阈值时不跳动");
assert.equal(resolveCooldownDuration({
  remaining: 18,
  suggestedDuration: 18,
  previousRemaining: 0.1,
  previousDuration: 20,
  active: true,
}), 18, "剩余时间上跳时识别为新一轮冷却");

function fakeButton() {
  const classes = new Set();
  const properties = new Map();
  return {
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
    style: {
      setProperty: (name, value) => properties.set(name, value),
      removeProperty: (name) => properties.delete(name),
      getPropertyValue: (name) => properties.get(name) || "",
    },
  };
}

const selectedSkillButton = fakeButton();
setCooldownProgress(selectedSkillButton, 15, 20, "sub1:first");
assert.ok(
  Math.abs(setCooldownProgress(selectedSkillButton, 5, 12, "sub2:second") - (5 / 12)) < 1e-6,
  "切换舰船后按新技能的冷却周期计算",
);

const stableButton = fakeButton();
assert.equal(setCooldownProgress(stableButton, 8, 10, "flagship"), 0.8, "冷却遮罩初始比例异常");
assert.equal(
  setCooldownProgress(stableButton, 8.08, 10, "flagship"),
  0.8,
  "同一轮冷却的小幅校时回跳仍会令遮罩反向抖动",
);
assert.equal(
  stableButton.style.getPropertyValue("--cooldown-offset"),
  "-20.000%",
  "冷却遮罩未转换为稳定的整层平移距离",
);
assert.equal(
  setCooldownProgress(stableButton, 9, 10, "flagship"),
  0.9,
  "真正的新一轮冷却未能重新覆盖按钮",
);

console.log("冷却按钮阴影进度计算检查通过");
