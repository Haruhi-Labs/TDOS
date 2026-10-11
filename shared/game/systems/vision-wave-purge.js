// 波带阶段只消费目标查询与效果操作，不持有对局、舰队或可写角色组件。
export function resolveVisionWavePurges(port) {
  // 必须在任何净化前固定四组命中；清掉一方波带不能抹掉它本帧已扫到的目标。
  const targetsFromA = port.targets("A", "B");
  const targetsFromB = port.targets("B", "A");
  const alliesFromA = port.targets("A", "A");
  const alliesFromB = port.targets("B", "B");

  for (const target of [...alliesFromA, ...alliesFromB]) {
    if (port.clearNegative(target)) port.present(target, true);
  }
  for (const target of targetsFromA) {
    if (port.clearPositive("B", target)) port.present(target, false);
  }
  for (const target of targetsFromB) {
    if (port.clearPositive("A", target)) port.present(target, false);
  }
}
