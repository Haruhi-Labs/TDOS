import { Scout } from "../../shared/game/model/scout.js";
import { Wingman } from "../../shared/game/model/wingman.js";
import { Ship } from "../../shared/game/model/ship.js";

// 场景布置也走实体操作；快照等普通数据仍按原值构造，不开放生产私有存储。
export function setScenarioField(target, key, value) {
  if (target instanceof Scout || target instanceof Wingman) {
    if (key === "x" || key === "y") target.displaceTo(key === "x" ? value : target.x, key === "y" ? value : target.y);
    else if (key === "speed") target.setFlightSpeed(value);
    else throw new Error(`飞行器场景字段 ${key} 需要使用领域操作`);
    return value;
  }
  if (!(target instanceof Ship)) { target[key] = value; return value; }
  if (key === "x" || key === "y") target.displaceTo(key === "x" ? value : target.x, key === "y" ? value : target.y);
  else if (key === "route") {
    if (value !== null) throw new Error("场景航线必须通过 setBezierRoute 建立");
    target.clearRoute();
  }
  else if (key === "command") target.followTarget(value);
  else if (key === "cooldown") target.resetAttackCycle(value);
  else if (key === "forcedKnockback") {
    if (value) target.beginForcedKnockback(value);
    else target.clearControlEffects();
  }
  else if (key === "hp") {
    if (value >= target.hp) target.restoreHull(value - target.hp);
    else target.drainHull(target.hp - value);
  }
  else if (key === "energy") target.restoreEnergy(value - target.energy);
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
