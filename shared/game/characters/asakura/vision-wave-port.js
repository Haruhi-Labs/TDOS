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
    friendlyPairs: () => Object.freeze(
      match.allTeams().map((team) => Object.freeze([team.seat, team.seat])),
    ),
    hostilePairs: () => Object.freeze(
      match.hostilePairs().map(([source, target]) => Object.freeze([source.seat, target.seat])),
    ),
    targets: (sourceSeat, targetSeat) => {
      const source = match.teamBySeat(sourceSeat);
      const target = match.teamBySeat(targetSeat);
      if (!source || !target) return [];
      return target.getAllShips().filter(
        (ship) => ship.alive && visionWavesCoverEntity(source, ship),
      ).map(handleFor);
    },
    clearNegative: (handle) => shipFor(handle).clearNegativeEffects(),
    clearPositive: (seat, handle) => {
      const team = match.teamBySeat(seat);
      return team ? team.clearActiveSkillBuffsForShip(shipFor(handle)) : false;
    },
    present: (handle, friendly) => {
      const ship = shipFor(handle);
      match.spawnFloatingTextKey(ship.x + 10, ship.y - 10, "净化", {}, friendly ? "#9eefff" : "#ff9db5");
    },
  });
}
