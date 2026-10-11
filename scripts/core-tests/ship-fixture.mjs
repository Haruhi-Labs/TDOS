import { Ship } from "../../shared/game/model/ship.js";

// 场景布置也走实体操作；快照等普通数据仍按原值构造，不开放生产私有存储。
export function setScenarioField(target, key, value) {
  if (!(target instanceof Ship)) { target[key] = value; return value; }
  if (key === "x" || key === "y") target.displaceTo(key === "x" ? value : target.x, key === "y" ? value : target.y);
  else if (key === "hp" || key === "energy") target.applyResourcePlan({ [key]: value });
  else if (key === "speed") target.setFlightSpeed(value);
  else if (key === "angle") target.setFlightHeading(value);
  else if (key === "throttle") target.followTarget(target.command, value);
  else if (key === "alive") {
    if (!value) target.retireWithoutLoss();
    else if (!target.alive) throw new Error("场景复活需要重新构造实体");
  } else if (key === "collisionSlowUntil") target.applyCollisionSlow(value, Infinity);
  else if (["previousX", "previousY", "previousAngle"].includes(key)) {
    const { x, y, angle, speed } = target;
    target.applyKnockbackSample(key === "previousX" ? value : target.previousX, key === "previousY" ? value : target.previousY, false);
    target.setFlightHeading(key === "previousAngle" ? value : target.previousAngle);
    target.captureFlightOrigin();
    target.applyKnockbackSample(x, y, false);
    target.setFlightHeading(angle);
    target.setFlightSpeed(speed);
  } else target[key] = value;
  return value;
}

export function assignScenario(target, ...sources) {
  for (const source of sources) for (const [key, value] of Object.entries(source)) setScenarioField(target, key, value);
  return target;
}
