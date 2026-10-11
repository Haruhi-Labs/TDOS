import assert from "node:assert/strict";
import { HaruhiFlagshipRuntime } from "../shared/game/haruhi-flagship-runtime.js";
import { HARUHI_SUPPORTS, createSupportState, initializeSupport, readSupportState, unlockSupport } from "../shared/game/haruhi-support.js";
import { MatchSimulation } from "../shared/game-core.js";

let now = 0, tick = 1, enabled = true, rolls = 0;
const support = {};
initializeSupport(support, createSupportState());
const events = [];
const runtime = new HaruhiFlagshipRuntime({
  enabled: () => enabled, now: () => now, tick: () => tick,
  random: () => { rolls += 1; return 0; },
  unlockSupport: (at, random) => {
    assert.equal(runtime.expiresAt, at + 16, "解锁支援前强化寿命必须已提交");
    events.push("unlock");
    return unlockSupport(support, HARUHI_SUPPORTS, at, random);
  },
  boostTempo: (multiplier) => {
    assert.equal(runtime.active(), true);
    assert.ok(readSupportState(support).supporters.size > 0, "属性换算前支援已解锁");
    assert.equal(multiplier, 1.15);
    events.push("tempo");
  },
  announce: (supporter) => events.push(supporter),
});
assert.equal(runtime.cast(16), true);
assert.deepEqual(events, ["unlock", "tempo", "alien"]);
assert.equal(runtime.clear(), false, "刚施放的强化不被同帧净化");
now = 2; tick = 2;
runtime.cast(16);
assert.equal(runtime.expiresAt, 18);
assert.deepEqual(events.slice(3), ["unlock", "time_traveler"], "续期不重复换算航速和冷却");
assert.equal(runtime.clear(), false);
tick = 3;
assert.equal(runtime.clear(), true);
assert.equal(runtime.active(), false);
assert.equal(readSupportState(support).supporters.size, 2, "净化强化不得撤销常驻支援");
assert.equal(runtime.clear(), false);
runtime.cast(16);
assert.deepEqual(events.slice(-3), ["unlock", "tempo", "otherworlder"]);
now = runtime.expiresAt;
assert.equal(runtime.active(), false, "到期边界即时关闭派生能力");
runtime.cast(16);
assert.deepEqual(events.slice(-3), ["unlock", "tempo", "esper"]);
runtime.cast(16);
assert.equal(events.at(-1), null);
assert.equal(rolls, 4, "全部解锁后续期不能额外取随机数");
assert.throws(() => { runtime.expiresAt = 999; }, TypeError);
enabled = false;
const count = events.length;
assert.equal(runtime.cast(16), false);
assert.equal(runtime.activate(16), null);
assert.equal(events.length, count);

const sim = new MatchSimulation({ seed: 205, teamLoadouts: { A: { main: "haruhi", sub1: "kyon", sub2: "yuki" } } });
const team = sim.teamA;
const ship = team.ships.sub1;
ship.setFlightSpeed(10); ship.cooldown = 8;
assert.equal(team.castFlagshipSkill(), true);
assert.equal(ship.speed, 11.5);
assert.equal(ship.cooldown, 8 / 1.15);
assert.throws(() => { team.effects.haruhiBoostUntil = 0; }, TypeError);
assert.equal(team.clearActiveTeamSkillBuffs(), false);
team.startCooldown("flagship", 0);
for (const member of team.getPlayerShips()) member.restoreEnergy(member.maxEnergy);
assert.equal(team.castFlagshipSkill(), true);
assert.equal(ship.speed, 11.5);
assert.equal(ship.cooldown, 8 / 1.15);
sim.tick += 1;
assert.equal(team.clearActiveTeamSkillBuffs(), true);
assert.equal(team.effects.haruhiBoostUntil, 0);
assert.equal(team.haruhiFlagship.supporters.size, 2);
console.log("春日旗舰生命周期校验通过：私有寿命、同帧保护、解锁与换算顺序、续期不重乘、净化保留支援。");
