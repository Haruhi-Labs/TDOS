import { visionWavesCoverEntity } from "./vision-wave.js";

export function createVisionWavePurgePort(match) {
  const handles = new WeakMap();
  const ships = new WeakMap();
  function handleFor(ship) {
    let handle = handles.get(ship);
    if (!handle) {
      handle = Object.freeze({ id: ship.id });
      handles.set(ship, handle);
      ships.set(handle, ship);
    }
    return handle;
  }
  function shipFor(handle) {
    const ship = ships.get(handle);
    if (!ship) throw new TypeError("无效的波带目标句柄");
    return ship;
  }
  return Object.freeze({
    targets: (sourceSeat, targetSeat) => {
      const source = match.teamBySeat(sourceSeat);
      return match.teamBySeat(targetSeat).getAllShips().filter(
        (ship) => ship.alive && visionWavesCoverEntity(source, ship),
      ).map(handleFor);
    },
    clearNegative: (handle) => shipFor(handle).clearNegativeEffects(),
    clearPositive: (seat, handle) => match.teamBySeat(seat).clearActiveSkillBuffsForShip(shipFor(handle)),
    present: (handle, friendly) => {
      const ship = shipFor(handle);
      match.spawnFloatingTextKey(ship.x + 10, ship.y - 10, "净化", {}, friendly ? "#9eefff" : "#ff9db5");
    },
  });
}
