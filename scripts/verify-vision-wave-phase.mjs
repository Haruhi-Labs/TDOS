import { ScenarioSimulation, sampleScenarioTime } from "./core-tests/scenario-simulation.mjs";
import assert from "node:assert/strict";
import { resolveVisionWavePurges } from "../shared/game/systems/vision-wave-purge.js";


// 编号是阶段中的不透明目标，阶段无需取得真实舰船或其组件。
const trace = [];
let mutated = false;
const port = {
  targets(source, target) {
    assert.equal(mutated, false, "所有命中必须在第一次净化前采样");
    trace.push(`采样${source}${target}`);
    return source === target ? [`友军${source}`, `无效果${source}`] : [`敌军${target}`];
  },
  clearNegative(target) {
    mutated = true;
    trace.push(`清负面${target}`);
    return !target.startsWith("无效果");
  },
  clearPositive(seat, target) {
    trace.push(`清正面${seat}${target}`);
    return seat === "B";
  },
  present: (target, friendly) => trace.push(`反馈${target}${friendly}`),
};
resolveVisionWavePurges(port);
assert.deepEqual(trace, [
  "采样AB", "采样BA", "采样AA", "采样BB",
  "清负面友军A", "反馈友军Atrue", "清负面无效果A",
  "清负面友军B", "反馈友军Btrue", "清负面无效果B",
  "清正面B敌军B", "反馈敌军Bfalse", "清正面A敌军A",
]);

const sim = new ScenarioSimulation({ seed: 365, teamLoadouts: {
  A: { main: "asakura", sub1: "haruhi", sub2: "yuki" },
  B: { main: "asakura", sub1: "koizumi", sub2: "tsuruya" },
} });
for (const team of [sim.teamA, sim.teamB]) {
  team.ships.main.displaceTo(720, 720);
  assert.equal(team.castFlagshipSkill(), true);
  // 非本帧效果才能被净化，保持原有保护约定。
  team.ships.main.silenceUntil(10);
}
const sampled = sim.visionWavePurgePort.targets("A", "A");
assert.equal(sampled[0].id, sim.teamA.ships.main.id);
assert.notEqual(sampled[0], sim.teamA.ships.main, "阶段不得获得真实舰船作为目标句柄");
assert.equal(sampled[0].team, undefined);
assert.throws(() => { sampled[0].hp = 0; }, TypeError);
assert.equal(sim.visionWavePurgePort.targets("A", "A")[0], sampled[0], "复用独立只读句柄，避免每帧分配");
assert.throws(() => sim.visionWavePurgePort.clearNegative({ id: sampled[0].id }), /无效的波带目标句柄/);
sampleScenarioTime(sim, { tick: sim.tick + (1) });
const beforeInvalidOwner = JSON.stringify(sim.serializeState());
assert.equal(sim.teamA.clearActiveSkillBuffsForShip(sim.teamB.ships.main), false);
assert.equal(sim.teamA.clearActiveSkillBuffsForShip(null), false);
const enemyHandle = sim.visionWavePurgePort.targets("A", "B")[0];
assert.equal(sim.visionWavePurgePort.clearPositive("A", enemyHandle), false);
assert.equal(JSON.stringify(sim.serializeState()), beforeInvalidOwner, "错误所有者不得先清理自身或他人的增益");
sim.resolveVisionWavePurges();
assert.equal(sim.teamA.ships.main.isSilenced(), false);
assert.equal(sim.teamB.ships.main.isSilenced(), false);
assert.equal(sim.teamA.hasActiveVisionWaveSkill(), false);
assert.equal(sim.teamB.hasActiveVisionWaveSkill(), false, "A 方的净化不能令 B 方已采样命中失效");
assert.deepEqual(sim.floatingTexts.filter((label) => label.textKey === "净化").map((label) => label.color),
  ["#9eefff", "#9eefff", "#ff9db5", "#ff9db5"]);

const original = sim.visionWavePurgePort;
assert.throws(() => { original.targets = () => []; }, TypeError);
let sampleCount = 0;
sim.visionWavePurgePort = { targets: () => { sampleCount += 1; return []; } };
sim.resolveVisionWavePurges();
assert.equal(sampleCount, 4, "对局编排必须使用装配的阶段端口");

// 多席显式配对端口：先完成全部敌对与本舰队采样，再按先本舰队负面、后敌方正面顺序提交。
const multiTrace = [];
let multiMutated = false;
resolveVisionWavePurges({
  hostilePairs: () => [["P1", "P3"], ["P3", "P1"], ["P3", "P2"]],
  friendlyPairs: () => [["P1", "P1"], ["P2", "P2"], ["P3", "P3"]],
  targets(source, target) {
    assert.equal(multiMutated, false, "多席波带采样必须在首次净化前全部完成");
    multiTrace.push(`采样:${source}->${target}`);
    return source === target ? [`本队:${source}`] : [`敌对:${source}->${target}`];
  },
  clearNegative(target) {
    multiMutated = true;
    multiTrace.push(`清负面:${target}`);
    return true;
  },
  clearPositive(seat, target) {
    multiMutated = true;
    multiTrace.push(`清正面:${seat}:${target}`);
    return true;
  },
  present(target, friendly) {
    multiTrace.push(`反馈:${target}:${friendly}`);
  },
});
assert.deepEqual(multiTrace.slice(0, 6), [
  "采样:P1->P3", "采样:P3->P1", "采样:P3->P2",
  "采样:P1->P1", "采样:P2->P2", "采样:P3->P3",
]);
assert.equal(multiTrace[6], "清负面:本队:P1");
assert.equal(multiTrace.at(-2), "清正面:P2:敌对:P3->P2");
console.log("波带净化阶段校验通过：多席配对全采样、先负面后正面、仅有效净化反馈及可替换端口。");
