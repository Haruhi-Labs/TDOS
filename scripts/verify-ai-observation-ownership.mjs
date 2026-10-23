import assert from "node:assert/strict";
import { MatchSimulation } from "../shared/game-core.js";
import { createActionPort } from "../shared/game/ai/bridge/action-port.js";
import { ObservationView } from "../shared/game/ai/policy/observation-view.js";

for (const strict of [false, true]) {
  const match = new MatchSimulation({ mode: "pvp", seed: 910, aiSeats: [] });
  const port = createActionPort(match, "A");
  port.strict = strict;
  const observation = port.observe();
  const hp = observation.self.ships.main.hp;
  assert.throws(() => { observation.self.ships.main.hp = 13; }, TypeError);
  assert.throws(() => { observation.world.zones[0].x = 13; }, TypeError);
  assert.equal(port.observe(), observation, "未失效的采样可安全复用");
  assert.equal(port.observe().self.ships.main.hp, hp);
  const view = new ObservationView();
  const ships = view.ships(observation);
  assert.throws(() => ships.pop(), TypeError);
  assert.equal(view.visible(observation).add, undefined);
  assert.equal(view.ship(observation, ships[0].id), ships[0]);
  assert.equal(view.shipById, undefined, "可写索引不能发布");
  match.teamA.ships.main.takeDamage(10, null, match);
  port.submit({ type: "invalid" });
  const next = port.observe();
  assert.notEqual(next, observation, "拒绝动作后也要重新采样");
  assert.equal(observation.self.ships.main.hp, hp, "历史观测保持稳定");
  assert.equal(view.ship(next, ships[0].id).hp, match.teamA.ships.main.hp);
}
console.log("AI 观测所有权校验通过：深只读、私有索引、历史稳定和动作后失效。");
