export const MATCH_ACTION_TYPES = Object.freeze({
  SET_ROUTE: "set_route",
  ROUTE_CONTROL: "route_control",
  ROUTE_END: "route_end",
  SET_THROTTLE: "set_throttle",
  CLEAR_ROUTE: "clear_route",
  SPLIT: "split",
  LAUNCH_SCOUT: "launch_scout",
  CONFIGURE_AUTO_SCOUT: "configure_auto_scout",
  EMERGENCY_BRAKE: "emergency_brake",
  CAST_FLAGSHIP_SKILL: "cast_flagship_skill",
  CAST_SUB_SKILL: "cast_sub_skill",
});

const MATCH_ACTION_TYPE_SET = new Set(Object.values(MATCH_ACTION_TYPES));

function action(type, payload = {}) {
  return { type, ...payload };
}

export const matchActions = Object.freeze({
  setRoute: (payload) => action(MATCH_ACTION_TYPES.SET_ROUTE, payload),
  routeControl: (payload) => action(MATCH_ACTION_TYPES.ROUTE_CONTROL, payload),
  routeEnd: (payload) => action(MATCH_ACTION_TYPES.ROUTE_END, payload),
  setThrottle: (payload) => action(MATCH_ACTION_TYPES.SET_THROTTLE, payload),
  clearRoute: (payload) => action(MATCH_ACTION_TYPES.CLEAR_ROUTE, payload),
  split: (level) => action(MATCH_ACTION_TYPES.SPLIT, { level }),
  launchScout: (payload) => action(MATCH_ACTION_TYPES.LAUNCH_SCOUT, payload),
  configureAutoScout: (payload) => action(MATCH_ACTION_TYPES.CONFIGURE_AUTO_SCOUT, payload),
  emergencyBrake: (shipKey) => action(MATCH_ACTION_TYPES.EMERGENCY_BRAKE, { shipKey }),
  castFlagshipSkill: (zoneId) => action(MATCH_ACTION_TYPES.CAST_FLAGSHIP_SKILL, { zoneId }),
  castSubSkill: (payload) => action(MATCH_ACTION_TYPES.CAST_SUB_SKILL, payload),
});

export function validateMatchAction(actionValue) {
  if (!actionValue || typeof actionValue !== "object") {
    return { ok: false, type: "", reason: "动作必须是对象" };
  }
  const type = String(actionValue.type || "");
  if (!MATCH_ACTION_TYPE_SET.has(type)) {
    return { ok: false, type, reason: "未知动作类型" };
  }

  if (type === MATCH_ACTION_TYPES.SET_ROUTE) {
    const endX = Number(actionValue.endX);
    const endY = Number(actionValue.endY);
    if (!Number.isFinite(endX) || !Number.isFinite(endY)) {
      return { ok: false, type, reason: "航线终点无效" };
    }
  } else if (type === MATCH_ACTION_TYPES.ROUTE_CONTROL) {
    if (!Number.isFinite(Number(actionValue.controlX)) || !Number.isFinite(Number(actionValue.controlY))) {
      return { ok: false, type, reason: "航线控制点无效" };
    }
  } else if (type === MATCH_ACTION_TYPES.ROUTE_END) {
    if (!Number.isFinite(Number(actionValue.endX)) || !Number.isFinite(Number(actionValue.endY))) {
      return { ok: false, type, reason: "航线终点无效" };
    }
  } else if (type === MATCH_ACTION_TYPES.SET_THROTTLE) {
    if (!Number.isFinite(Number(actionValue.throttle))) {
      return { ok: false, type, reason: "推进档位无效" };
    }
  } else if (type === MATCH_ACTION_TYPES.SPLIT) {
    const level = Number(actionValue.level);
    if (level !== 1 && level !== 2) {
      return { ok: false, type, reason: "分离等级无效" };
    }
  }
  return { ok: true, type, reason: "" };
}

export function isMatchAction(actionValue) {
  return validateMatchAction(actionValue).ok;
}
