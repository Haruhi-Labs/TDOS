import assert from "node:assert/strict";
import { MatchSimulation } from "../shared/game-core.js";

function retire(team) { for (const ship of team.getAllShips()) ship.retireWithoutLoss(); }
for (const winner of ["A", "B", null]) {
  const match = new MatchSimulation({ seed: 30 });
  assert.throws(() => { match.phase = "finished"; }, TypeError);
  assert.throws(() => { match.winnerSeat = winner; }, TypeError);
  match.checkVictory();
  assert.equal(match.phase, "running", "双方存活时不能提前结束");
  if (winner !== "A") retire(match.teamA);
  if (winner !== "B") retire(match.teamB);
  assert.equal(match.phase, "running", "退场不提前跨越本帧的终局判定阶段");
  match.checkVictory();
  assert.equal(match.phase, "finished");
  assert.equal(match.winnerSeat, winner);
  const state = match.serializeState();
  const summary = match.statisticsSummary();
  assert.equal(state.winnerSeat, winner);
  assert.equal(summary.winnerSeat, winner);
  retire(match.teamA);
  retire(match.teamB);
  match.checkVictory();
  assert.equal(match.winnerSeat, winner, "终局只提交一次，后续退场不能重判胜者");
  const { elapsed, tick } = match;
  match.update(0.05);
  assert.equal(match.elapsed, elapsed);
  assert.equal(match.tick, tick);
}
console.log("终局所有权校验通过：资格判定、胜负原子发布、平局、只结算一次与终局停步。");
