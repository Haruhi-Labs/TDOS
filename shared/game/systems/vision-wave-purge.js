const LEGACY_HOSTILE_PAIRS = Object.freeze([
  Object.freeze(["A", "B"]),
  Object.freeze(["B", "A"]),
]);
const LEGACY_FRIENDLY_PAIRS = Object.freeze([
  Object.freeze(["A", "A"]),
  Object.freeze(["B", "B"]),
]);

// 波带阶段只消费目标查询与效果操作，不持有对局、舰队或可写角色组件。
export function resolveVisionWavePurges(port) {
  const hostilePairs = typeof port.hostilePairs === "function" ? port.hostilePairs() : LEGACY_HOSTILE_PAIRS;
  const friendlyPairs = typeof port.friendlyPairs === "function" ? port.friendlyPairs() : LEGACY_FRIENDLY_PAIRS;

  // 必须在任何净化前固定全部命中；清掉一方波带不能抹掉它本帧已扫到的目标。
  const hostileSamples = hostilePairs.map(([sourceSeat, targetSeat]) => ({
    targetSeat,
    targets: port.targets(sourceSeat, targetSeat),
  }));
  const friendlySamples = friendlyPairs.map(([sourceSeat, targetSeat]) => port.targets(sourceSeat, targetSeat));

  for (const targets of friendlySamples) {
    for (const target of targets) {
      if (port.clearNegative(target)) port.present(target, true);
    }
  }
  for (const { targetSeat, targets } of hostileSamples) {
    for (const target of targets) {
      if (port.clearPositive(targetSeat, target)) port.present(target, false);
    }
  }
}
