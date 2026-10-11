import assert from "node:assert/strict";
import { MatchSimulation } from "../shared/game-core.js";
import { AircraftOperations } from "../shared/game/systems/aircraft-operations.js";

const match = new MatchSimulation({ seed: 721 });
const team = match.teamA;
assert.throws(() => { team.scouts = []; }, TypeError);
assert.throws(() => { team.ships.main = {}; }, TypeError);
assert.throws(() => { team.ships = {}; }, TypeError);
assert.throws(() => { team.extraShips = []; }, TypeError);
assert.throws(() => team.extraShips.push({}), TypeError);
assert.throws(() => team.scouts.push({}), TypeError);
assert.throws(() => { team.autoScout.enabled = true; }, TypeError);
const history = team.autoScout;
team.configureAutoScout(true, 2);
assert.equal(history.enabled, false);
const sequence = [];
const aircraft = new AircraftOperations({ sameMatch: () => true, owns: () => true });
const scout = { id: 1, kind: "scout", alive: true, update: () => sequence.push("侦察机") };
const wingman = { id: 2, kind: "wingman", alive: true, update: () => sequence.push("僚机") };
aircraft.addScout(scout);
aircraft.addWingman(wingman);
const roster = aircraft.scouts;
assert.equal(aircraft.scouts, roster, "成员未变更时复用只读集合");
aircraft.advance(1);
assert.deepEqual(sequence, ["侦察机", "僚机"]);
scout.alive = false;
assert.equal(aircraft.scouts.length, 1, "退场集合须保留到原清理阶段");
aircraft.collectRetired();
assert.equal(aircraft.scouts.length, 0);
assert.equal(roster.length, 1, "旧集合视图不得被清理操作修改");
console.log("航空编组校验通过：集合及自动任务只读、生产与生命周期独立、原更新和清理顺序不变。");

const { Scout } = await import('../shared/game/model/scout.js');
const { Wingman } = await import('../shared/game/model/wingman.js');
const zoneInput = { ...match.zoneById(1) };
const anchor = { x: 300, y: 320 };
const realScout = new Scout(team, 300, 300, { zone: zoneInput, anchor });
const realWingman = new Wingman(team, 310, 310, zoneInput);
for (const entity of [realScout, realWingman]) {
  for (const key of ['team', 'x', 'y', 'alive', 'hp', 'life', 'cooldown', 'zone', 'command', 'id', 'kind']) {
    assert.throws(() => { entity[key] = null; }, TypeError, `${entity.kind}.${key} 禁止外部直接改写`);
  }
  assert.throws(() => { entity.command.x = -1; }, TypeError);
  assert.throws(() => { entity.zone.x = -1; }, TypeError);
}
zoneInput.x = -99;
anchor.x = -99;
assert.notEqual(realScout.zone.x, -99);
assert.notEqual(realWingman.zone.x, -99);
assert.equal(realScout.anchor.x, 300);
assert.equal(team.addScout(realScout), true);
assert.equal(team.addScout(realScout), false);
assert.equal(team.addScout(realWingman), false);
assert.equal(match.teamB.addScout(realScout), false);
assert.equal(team.addWingman(realWingman), true);
assert.equal(team.addWingman(realWingman), false);
const beforeTransfer = team.scouts;
const unrelated = new MatchSimulation({ mode: 'pvp', seed: 99 });
assert.equal(realScout.transferToTeam(unrelated.teamA, unrelated.zoneById(5)), false);
assert.equal(realWingman.transferToTeam(unrelated.teamA, unrelated.zoneById(5)), false);
assert.equal(team.scouts, beforeTransfer);
assert.equal(realScout.transferToTeam(match.teamB, match.zoneById(5)), true);
assert.equal(realWingman.transferToTeam(match.teamB, match.zoneById(5)), true);
assert.equal(team.scouts.includes(realScout), false);
assert.equal(match.teamB.scouts.filter((entity) => entity === realScout).length, 1);
const commandHistory = realScout.command;
realScout.guideTo({ x: 700, y: 700 });
assert.notEqual(commandHistory.x, realScout.command.x);
for (const key of ['match', 'seat', 'name', 'color', 'projectileColor']) {
  assert.throws(() => { team[key] = null; }, TypeError);
}
console.log('飞行器内部状态校验通过：私有运动、武器、寿命和任务状态，输入隔离，转队与成员发布一致。');

const { createAircraftPort } = await import('../shared/game/rules/aircraft-port.js');
const { launchBurstScouts, launchHaruhiAlienWingmen, launchHaruhiRandomBeam } = await import('../shared/game/rules/character-launch.js');
for (const operation of ['launchBurstScouts', 'launchHaruhiAlienWingmen', 'launchHaruhiRandomBeam']) {
  assert.equal(operation in team, false, '角色发射不能绕回舰队门面');
  assert.equal(operation in aircraft, false, '通用航空组件不能决定角色发射规则');
}
const aircraftPort = createAircraftPort(team);
assert.equal('randomRange' in aircraftPort, false);
assert.equal('spawnBurst' in aircraftPort.world, false);
const oldMembers = team.scouts;
launchBurstScouts(team, team.ships.sub1);
assert.equal(team.scouts.length, oldMembers.length + 16);
assert.equal(oldMembers.length, 0, '角色发射不能改写已发布成员集合');
assert.ok(team.scouts.every((unit) => unit.team === team && unit.pattern === 'burst'));
launchHaruhiAlienWingmen(team, team.ships.main);
assert.equal(team.scouts.length, 17);
assert.equal(team.scouts.at(-1).combatCapable, true);
assert.equal(launchHaruhiRandomBeam(team, team.ships.main), true);
assert.equal(team.beams.length, 1);
console.log('角色发射边界通过：技能机群及支援规则独立于通用航空组件，生成仍进入统一成员集合。');
