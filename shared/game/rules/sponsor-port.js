import { SponsorEffect } from "../sponsor-effect.js";

export function createTeamSponsor(team) {
  return new SponsorEffect({
    now: () => team.match.elapsed,
    tick: () => team.match.tick,
    activated: () => {
      for (const ship of team.getAllShips()) {
        if (ship.alive) team.match.spawnFloatingTextKey(ship.x + 10, ship.y - 10, "赞助", {}, "#ffd27e");
      }
    },
    restoreHullFraction: (fraction, dt) => {
      for (const ship of team.getAllShips()) {
        if (ship.alive) ship.restoreHull(ship.maxHp * fraction * dt);
      }
    },
  });
}
