// AI 与对局之间的端口：读取只有观测，写入只有动作。
// 端口是 AI 侧唯一持有实时 Team 的位置，决策代码通过它提交动作并得知是否被接受。
import { applyMatchAction } from "../../action-dispatcher.js";
import { normalizeThrottleToGear } from "../../throttle.js";
import { AI_ACTION_TYPES } from "../actions.js";
import {
  buildObservation,
  observeEnemyEntity,
  observeEnemySpawn,
  snapshotVisibleCharacterTactics,
} from "./observation.js";

export const AI_ACTION_MODES = Object.freeze({
  // 与标准动作相同的执行链和权限校验。
  DISPATCH: "dispatch",
  // 直接调用领域方法、不做操作权限校验的旧路径，仅用于与改造前行为对照。
  DIRECT: "direct",
});

function pureData(value) {
  return JSON.parse(JSON.stringify(value));
}

function scoutOptions(action) {
  return {
    seekPoint: action.seekPoint,
    patrolCenter: action.patrolCenter,
    patrolRadius: action.patrolRadius ?? undefined,
    mission: action.mission ?? undefined,
  };
}

function applyScoutAction(team, action) {
  if (action.type === AI_ACTION_TYPES.AI_LAUNCH_SCOUT) {
    return team.launchScout(action.zoneId, { fromShipKey: action.shipKey, ...scoutOptions(action) });
  }
  if (action.type === AI_ACTION_TYPES.AI_RETASK_SCOUT) {
    const scout = team.scouts.find((item) => item.id === action.scoutId && item.alive);
    return Boolean(scout) && team.assignScoutMission(scout, { zoneId: action.zoneId, ...scoutOptions(action) });
  }
  return null;
}

function applyDirect(team, action) {
  const scoutResult = applyScoutAction(team, action);
  if (scoutResult !== null) return scoutResult;
  const ship = team.ships[action.shipKey];
  switch (action.type) {
    case AI_ACTION_TYPES.SPLIT:
      return team.split(action.level);
    case AI_ACTION_TYPES.SET_ROUTE:
      ship.setBezierRoute(undefined, undefined, action.endX, action.endY, action.throttle, false);
      return true;
    case AI_ACTION_TYPES.ROUTE_END:
      ship.setRouteEndpoint(action.endX, action.endY, false);
      return true;
    case AI_ACTION_TYPES.SET_THROTTLE:
      ship.throttle = normalizeThrottleToGear(action.throttle, ship.throttle);
      return true;
    case AI_ACTION_TYPES.CAST_FLAGSHIP_SKILL:
      return team.castFlagshipSkill();
    case AI_ACTION_TYPES.CAST_SUB_SKILL: {
      const { type, shipKey, ...options } = action;
      return Object.keys(options).length > 0 ? team.castSubSkill(shipKey, options) : team.castSubSkill(shipKey);
    }
    default:
      return false;
  }
}

function applyDispatch(team, action) {
  const scoutResult = applyScoutAction(team, action);
  return scoutResult !== null ? scoutResult : applyMatchAction(team, action);
}

// 这三类动作在旧路径下必定生效；经标准执行链被拒绝，说明权限校验改变了结果。
const PERMISSION_CHECKED_TYPES = new Set([
  AI_ACTION_TYPES.SET_ROUTE,
  AI_ACTION_TYPES.ROUTE_END,
  AI_ACTION_TYPES.SET_THROTTLE,
]);

export function createActionPort(match, seat, { mode = AI_ACTION_MODES.DISPATCH } = {}) {
  const team = match.teamBySeat(seat);
  let observation = null;
  const port = {
    seat,
    mode,
    // 校验用：观测先经 JSON 往返再交给决策，证明决策没有依赖实时对象引用或非纯数据值。
    strict: false,
    // 兼容外部读取与难度让分写入；决策代码不得使用。
    team,
    // 标准执行链拒绝、而旧路径会生效的动作计数，用于归因两种模式的行为差异。
    permissionRejections: { count: 0, controlLocked: 0, firstTick: null },

    invalidate() {
      observation = null;
    },

    // 自上次构建后没有外部刷新或动作提交时复用同一份观测。
    observe() {
      if (!observation) {
        const built = buildObservation(match, seat);
        observation = port.strict ? pureData(built) : built;
      }
      return observation;
    },

    // 把属于本对局的实时实体换成观测数据；其余值原样返回。
    observeLive(value, lookupOwnShip) {
      const liveTeam = value && typeof value === "object" ? value.team : null;
      if (!liveTeam || liveTeam.match !== match) return value;
      if (liveTeam.seat === seat) return lookupOwnShip(value.id) || value;
      const entity = observeEnemyEntity(value, match.elapsed);
      return port.strict ? pureData(entity) : entity;
    },

    // 调用方直接给出的实体描述没有公开战术字段时，按同一口径补算。
    observeTactics(entity) {
      return snapshotVisibleCharacterTactics(entity, match.elapsed);
    },

    enemySpawn() {
      return observeEnemySpawn(match, seat);
    },

    // 立即执行并返回是否被接受。被拒绝的动作也可能触发规则层的状态整理，因此一律让观测失效。
    submit(action) {
      const dispatch = port.mode === AI_ACTION_MODES.DISPATCH;
      const accepted = Boolean(dispatch ? applyDispatch(team, action) : applyDirect(team, action));
      if (dispatch && !accepted && PERMISSION_CHECKED_TYPES.has(action.type)) {
        const ship = team.ships[action.shipKey];
        port.permissionRejections.count += 1;
        if (ship?.alive && !ship.canControl()) port.permissionRejections.controlLocked += 1;
        port.permissionRejections.firstTick ??= match.tick;
      }
      observation = null;
      return accepted;
    },
  };
  return port;
}
