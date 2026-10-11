import assert from "node:assert/strict";
import { MatchSimulation } from "../shared/game-core.js";
import { Ship } from "../shared/game/model/ship.js";

const match = new MatchSimulation({ mode: "pvp", seed: 911 });
const a = match.teamA;
const b = match.teamB;
const ship = a.ships.main;
for (const key of ["hp", "energy", "maxHp", "maxEnergy", "x", "y", "angle", "speed", "throttle", "alive", "team", "formationOffset", "id", "key", "slotKey", "isAuxiliary"]) {
  assert.throws(() => { ship[key] = null; }, TypeError, `${key} 不得绕过所有者直接写入`);
}
assert.throws(() => { ship.formationOffset.x = 5; }, TypeError);
assert.throws(() => { a.statMult = 100; }, TypeError);
assert.equal(a.addAuxiliaryShip(b.ships.main), false);
assert.equal(ship.transferToTeam(b), false, "固定槽位不能经额外成员转移入口离队");
const extra = new Ship(a, "probe", 500, 500, 0, { characterId: "kyon", isAuxiliary: true });
assert.equal(a.addAuxiliaryShip(extra), true);
assert.equal(a.addAuxiliaryShip(extra), false);
assert.equal(b.addAuxiliaryShip(extra), false);
const original = a.extraShips;
const other = new MatchSimulation({ mode: "pvp", seed: 913 });
assert.equal(extra.transferToTeam(other.teamA), false);
assert.equal(a.extraShips, original, "无效转移不能先移除原成员");
const duplicate = new Ship(b, "probe", 500, 500, 0, { characterId: "kyon", isAuxiliary: true });
b.addAuxiliaryShip(duplicate);
assert.equal(extra.transferToTeam(b), false, "目标键冲突必须在事务之前拒绝");
b.removeAuxiliaryShip(duplicate);
assert.equal(extra.transferToTeam(b), true);
assert.equal(extra.team, b);
assert.equal(a.extraShips.includes(extra), false);
assert.equal(b.extraShips.filter((item) => item === extra).length, 1);
assert.equal(original.includes(extra), true, "历史集合不追随发布改变");
ship.takeDamage(ship.maxHp * 100, null, match);
assert.equal(ship.hp, 0);
assert.equal(ship.alive, false, "合法承伤同时完成死亡事务");
console.log("舰船基础状态与成员归属校验通过：私有字段、不可变偏移、唯一发布和转移原子拒绝。");
