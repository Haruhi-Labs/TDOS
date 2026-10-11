import assert from "node:assert/strict";
import { MatchSimulation } from "../shared/game-core.js";
import { SearchNavigation } from "../shared/game/ai/policy/search-navigation.js";

const match = new MatchSimulation({ mode: "ai", seed: 912 });
const bot = match.bot;
const before = bot.searchZoneId;
const focus = { id: 123, key: "main", slotKey: "main", x: 400, y: 400, angle: 0, speed: 0, source: "visible", visible: true, age: 0, zoneId: 1 };
const main = bot.obs.self.ships.main;
const zone = bot.pickScoutZoneId(main, focus);
for (let i = 0; i < 3; i += 1) {
  assert.equal(bot.pickScoutZoneId(main, focus), zone);
  assert.equal(bot.acquireSearchCenter(main, focus).zoneId, 1);
}
assert.equal(bot.searchZoneId, before, "重复查询不能推进搜索意图");
assert.throws(() => { bot.searchZoneId = 9; }, TypeError);
const search = new SearchNavigation(4, 0);
const input = { main: { x: 0, y: 0 }, focus, zones: match.zones };
const proposal = search.planCenter(input);
assert.equal(search.state.zoneId, 4);
assert.throws(() => { search.state.zoneId = 9; }, TypeError);
assert.throws(() => search.consume({ ...proposal }), /不属于/);
search.consume(proposal);
assert.equal(search.state.zoneId, 1);
assert.throws(() => search.consume(proposal), /失效/);
const stale = search.planCenter(input);
search.contact(8);
assert.throws(() => search.consume(stale), /失效/);
assert.equal(search.state.zoneId, 8);
console.log("AI 搜索所有权校验通过：纯查询、独占状态、显式消费及过期候选拒绝。");
