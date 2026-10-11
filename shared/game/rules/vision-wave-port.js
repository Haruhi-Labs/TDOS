import { visionWavesCoverEntity } from "../vision-wave.js";

export function createVisionWavePurgePort(match) {
  return Object.freeze({
    targets: (sourceSeat, targetSeat) => {
      const source = match.teamBySeat(sourceSeat);
      return match.teamBySeat(targetSeat).getAllShips().filter(
        (ship) => ship.alive && visionWavesCoverEntity(source, ship),
      );
    },
    clearNegative: (ship) => ship.clearNegativeEffects(),
    clearPositive: (seat, ship) => match.teamBySeat(seat).clearActiveSkillBuffsForShip(ship),
    present: (ship, friendly) => match.spawnFloatingTextKey(
      ship.x + 10, ship.y - 10, "净化", {}, friendly ? "#9eefff" : "#ff9db5",
    ),
  });
}
