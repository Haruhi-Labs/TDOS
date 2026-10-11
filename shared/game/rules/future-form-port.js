import { FutureFlagshipForm } from "../future-flagship-form.js";

export function createTeamFutureForm(team) {
  return new FutureFlagshipForm({
    enabled: () => team.mainCharacterId() === "future1096",
    transition: ({ form, speedRatio, cooldownRatio }) => {
      for (const ship of team.getPlayerShips()) {
        ship.rescaleFormMotion(speedRatio, cooldownRatio);
        if (ship.alive) team.match.spawnFloatingTextKey(
          ship.x + 10, ship.y - 12, `${form}形态`, {}, form === "A" ? "#8eefff" : "#ffd28e",
        );
      }
    },
  });
}
