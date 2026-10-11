import * as geometry from "./geometry.js";
import * as evaluation from "./evaluation.js";
import { scoreMode, planMode } from "./mode.js";

// 唯一采样边界：纯算法收到普通数据，不取得策略查询、动作端口或整个策略对象。
export function createFactCalculations(read, invoke) {
  const value = () => read("params").value;
  const world = () => read("obs").world;
  const friendly = () => {
    const self = read("obs").self;
    return { valueParams: value(), ships: invoke("ownShips", []), wingmen: self.wingmen, scouts: self.scouts };
  };
  const contacts = (maxAge) => ({ valueParams: value(), contacts: invoke("knownEnemyContacts", [{ maxAge }]) });
  const arcs = () => {
    const obs = read("obs");
    return { worldSize: obs.world.size, ownUniform: obs.self.flags.kyonFlagship, enemyUniform: obs.privileged.enemyHasKyonFlagship };
  };
  return Object.freeze({
    zoneForPoint: (x, y) => geometry.zoneForPoint(world().zones, x, y),
    zoneCenter: (id) => geometry.zoneCenter(world().zones, id),
    safeRoutePadding: (extra) => geometry.safeRoutePadding(world().size, extra),
    edgePressure: (ship) => geometry.edgePressure(world().size, ship),
    stableNoise: geometry.stableNoise,
    pointEdgeClearance: (x, y) => geometry.pointEdgeClearance(world().size, x, y),
    arcDensityFromState: geometry.arcDensityFromState,
    broadsideIntentAngle: geometry.broadsideIntentAngle,
    contactHpRatio: (contact) => evaluation.contactHpRatio(value(), contact),
    contactCombatValue: (contact) => evaluation.contactCombatValue(value(), contact),
    shipCombatValue: (ship) => evaluation.shipCombatValue(value(), ship),
    friendlyPowerAround: (x, y, radius) => evaluation.friendlyPowerAround(friendly(), x, y, radius),
    enemyThreatAround: (x, y, radius, maxAge = 8) => evaluation.enemyThreatAround(contacts(maxAge), x, y, radius),
    enemyIsolationScore: (contact, maxAge = 6) => evaluation.enemyIsolationScore(contacts(maxAge), contact),
    estimateVisionRange: evaluation.estimateVisionRange,
    shipVitality: (ship) => evaluation.shipVitality(value(), ship),
    shipThreatSnapshot: (ship, maxAge = 7) => evaluation.shipThreatSnapshot({ ...friendly(), ...contacts(maxAge) }, ship),
    escapeTargetForShip: (ship, x, y, maxAge = 7) => evaluation.escapeTargetForShip({ ...contacts(maxAge), worldSize: world().size }, ship, x, y),
    evaluateArcExchange: (...args) => evaluation.evaluateArcExchange(arcs(), ...args),
    preferredFlankSign: (main, contact) => evaluation.preferredFlankSign({ ...arcs(), searchSign: read("searchSweepSign") }, main, contact),
    scoreMode: (mode, context) => scoreMode(read("params").mode, mode, context),
    planMode: (context) => planMode({ modeParams: read("params").mode, currentMode: read("mode"), currentTimer: read("modeTimer") }, context, read("rng").range),
  });
}
