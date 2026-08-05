import { normalizeThrottleToGear } from "./throttle.js";
import {
  MATCH_ACTION_TYPES,
  validateMatchAction,
} from "../protocol/match-actions.js";

function controllableShip(team, shipKey, { requireRoute = false } = {}) {
  const ship = team.ships[String(shipKey || "main")];
  if (!ship || !ship.alive || !ship.canControl() || (requireRoute && !ship.route)) return null;
  return ship;
}

export function applyMatchAction(team, action) {
  const validation = validateMatchAction(action);
  if (!validation.ok) return false;
  const type = validation.type;

  if (type === MATCH_ACTION_TYPES.SET_ROUTE) {
    const ship = controllableShip(team, action.shipKey);
    if (!ship) return false;
    const endX = Number(action.endX);
    const endY = Number(action.endY);
    const controlX = Number(action.controlX);
    const controlY = Number(action.controlY);
    const throttle = Number(action.throttle);
    ship.setBezierRoute(
      Number.isFinite(controlX) ? controlX : undefined,
      Number.isFinite(controlY) ? controlY : undefined,
      endX,
      endY,
      Number.isFinite(throttle) ? throttle : ship.throttle,
      action.anchorToMain !== false,
    );
    return true;
  }

  if (type === MATCH_ACTION_TYPES.ROUTE_CONTROL) {
    const ship = controllableShip(team, action.shipKey, { requireRoute: true });
    if (!ship) return false;
    const controlX = Number(action.controlX);
    const controlY = Number(action.controlY);
    ship.setRouteControl(controlX, controlY, false);
    return true;
  }

  if (type === MATCH_ACTION_TYPES.ROUTE_END) {
    const ship = controllableShip(team, action.shipKey, { requireRoute: true });
    if (!ship) return false;
    const endX = Number(action.endX);
    const endY = Number(action.endY);
    ship.setRouteEndpoint(endX, endY, false);
    return true;
  }

  if (type === MATCH_ACTION_TYPES.SET_THROTTLE) {
    const ship = controllableShip(team, action.shipKey);
    if (!ship) return false;
    const throttle = Number(action.throttle);
    ship.throttle = normalizeThrottleToGear(throttle, ship.throttle);
    return true;
  }

  if (type === MATCH_ACTION_TYPES.CLEAR_ROUTE) {
    const ship = controllableShip(team, action.shipKey);
    if (!ship) return false;
    ship.clearRoute();
    return true;
  }

  if (type === MATCH_ACTION_TYPES.SPLIT) {
    const level = Number(action.level);
    return level === 1 || level === 2 ? team.split(level) : false;
  }
  if (type === MATCH_ACTION_TYPES.LAUNCH_SCOUT) {
    return team.launchScout(Number(action.zoneId) || 5, { fromShipKey: action.shipKey });
  }
  if (type === MATCH_ACTION_TYPES.CONFIGURE_AUTO_SCOUT) {
    return team.configureAutoScout(action.enabled, action.zoneId);
  }
  if (type === MATCH_ACTION_TYPES.EMERGENCY_BRAKE) {
    return team.emergencyBrake(String(action.shipKey || "main"));
  }
  if (type === MATCH_ACTION_TYPES.CAST_FLAGSHIP_SKILL) {
    return team.castFlagshipSkill(Number(action.zoneId) || 5);
  }
  if (type === MATCH_ACTION_TYPES.CAST_SUB_SKILL) {
    return team.castSubSkill(String(action.shipKey || "sub1"), {
      zoneId: Number(action.zoneId) || 5,
      targetX: Number(action.targetX),
      targetY: Number(action.targetY),
    });
  }
  return false;
}
