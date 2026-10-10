// AI 的动作词表：标准对局动作，加上两种只供 AI 使用的侦察机扩展动作。
// 扩展动作不属于 shared/protocol 的对局动作协议，网络输入校验会把它们当作未知类型拒绝。
import { MATCH_ACTION_TYPES, matchActions } from "../../protocol/match-actions.js";

export const AI_ACTION_TYPES = Object.freeze({
  SET_ROUTE: MATCH_ACTION_TYPES.SET_ROUTE,
  ROUTE_END: MATCH_ACTION_TYPES.ROUTE_END,
  SET_THROTTLE: MATCH_ACTION_TYPES.SET_THROTTLE,
  SPLIT: MATCH_ACTION_TYPES.SPLIT,
  CAST_FLAGSHIP_SKILL: MATCH_ACTION_TYPES.CAST_FLAGSHIP_SKILL,
  CAST_SUB_SKILL: MATCH_ACTION_TYPES.CAST_SUB_SKILL,
  // 带寻的点、巡逻中心与任务标签的侦察机发射。
  AI_LAUNCH_SCOUT: "ai_launch_scout",
  // 给已升空的侦察机重新指派战区与任务。
  AI_RETASK_SCOUT: "ai_retask_scout",
});

function scoutOrders({ zoneId, seekPoint = null, patrolCenter = null, patrolRadius = null, mission = null }) {
  const point = (value) => (
    value && Number.isFinite(value.x) && Number.isFinite(value.y) ? { x: value.x, y: value.y } : null
  );
  return {
    zoneId,
    seekPoint: point(seekPoint),
    patrolCenter: point(patrolCenter),
    patrolRadius: Number.isFinite(patrolRadius) ? patrolRadius : null,
    mission: mission || null,
  };
}

export const aiActions = Object.freeze({
  // AI 的航线不锚定旗舰，控制点由规则层按默认方式生成。
  setRoute: ({ shipKey, endX, endY, throttle }) => (
    matchActions.setRoute({ shipKey, endX, endY, throttle, anchorToMain: false })
  ),
  routeEnd: ({ shipKey, endX, endY }) => matchActions.routeEnd({ shipKey, endX, endY }),
  setThrottle: ({ shipKey, throttle }) => matchActions.setThrottle({ shipKey, throttle }),
  split: (level) => matchActions.split(level),
  castFlagshipSkill: () => ({ type: MATCH_ACTION_TYPES.CAST_FLAGSHIP_SKILL }),
  // 只携带调用方实际给出的目标字段。
  castSubSkill: ({ shipKey, zoneId, targetX, targetY }) => {
    const action = { type: MATCH_ACTION_TYPES.CAST_SUB_SKILL, shipKey };
    if (zoneId !== undefined) action.zoneId = zoneId;
    if (targetX !== undefined) action.targetX = targetX;
    if (targetY !== undefined) action.targetY = targetY;
    return action;
  },
  launchScout: ({ shipKey, ...orders }) => ({
    type: AI_ACTION_TYPES.AI_LAUNCH_SCOUT,
    shipKey,
    ...scoutOrders(orders),
  }),
  retaskScout: ({ scoutId, ...orders }) => ({
    type: AI_ACTION_TYPES.AI_RETASK_SCOUT,
    scoutId,
    ...scoutOrders(orders),
  }),
});
