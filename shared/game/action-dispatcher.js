import { normalizeThrottleToGear } from "./throttle.js";

function controllableShip(team, shipKey, { requireRoute = false } = {}) {
  const ship = team.ships[String(shipKey || "main")];
  if (!ship || !ship.alive || !ship.canControl() || (requireRoute && !ship.route)) return null;
  return ship;
}

export function applyMatchAction(team, action) {
  if (!action || typeof action !== "object") return false;
  const type = String(action.type || "");

  if (type === "set_route") {
    const ship = controllableShip(team, action.shipKey);
    if (!ship) return false;
    const endX = Number(action.endX);
    const endY = Number(action.endY);
    const controlX = Number(action.controlX);
    const controlY = Number(action.controlY);
    const throttle = Number(action.throttle);
    if (!Number.isFinite(endX) || !Number.isFinite(endY)) return false;
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

  if (type === "route_control") {
    const ship = controllableShip(team, action.shipKey, { requireRoute: true });
    if (!ship) return false;
    const controlX = Number(action.controlX);
    const controlY = Number(action.controlY);
    if (!Number.isFinite(controlX) || !Number.isFinite(controlY)) return false;
    ship.setRouteControl(controlX, controlY, false);
    return true;
  }

  if (type === "route_end") {
    const ship = controllableShip(team, action.shipKey, { requireRoute: true });
    if (!ship) return false;
    const endX = Number(action.endX);
    const endY = Number(action.endY);
    if (!Number.isFinite(endX) || !Number.isFinite(endY)) return false;
    ship.setRouteEndpoint(endX, endY, false);
    return true;
  }

  if (type === "set_throttle") {
    const ship = controllableShip(team, action.shipKey);
    if (!ship) return false;
    const throttle = Number(action.throttle);
    if (!Number.isFinite(throttle)) return false;
    ship.throttle = normalizeThrottleToGear(throttle, ship.throttle);
    return true;
  }

  if (type === "clear_route") {
    const ship = controllableShip(team, action.shipKey);
    if (!ship) return false;
    ship.clearRoute();
    return true;
  }

  if (type === "split") {
    const level = Number(action.level);
    return level === 1 || level === 2 ? team.split(level) : false;
  }
  if (type === "launch_scout") {
    return team.launchScout(Number(action.zoneId) || 5, { fromShipKey: action.shipKey });
  }
  if (type === "configure_auto_scout") {
    return team.configureAutoScout(action.enabled, action.zoneId);
  }
  if (type === "emergency_brake") {
    return team.emergencyBrake(String(action.shipKey || "main"));
  }
  if (type === "cast_flagship_skill") {
    return team.castFlagshipSkill(Number(action.zoneId) || 5);
  }
  if (type === "cast_sub_skill") {
    return team.castSubSkill(String(action.shipKey || "sub1"), {
      zoneId: Number(action.zoneId) || 5,
      targetX: Number(action.targetX),
      targetY: Number(action.targetY),
    });
  }
  return false;
}
