// AI 与对局之间的端口：读取只有观测，写入只有动作。
// 实时 Team 仅保留在桥接闭包；决策代码无法取得实体或切换到绕过校验的执行路径。
import { applyMatchAction } from "../../action-dispatcher.js";
import { AI_ACTION_TYPES } from "../actions.js";
import { freezePlainData } from "../../../data/plain-data.js";
import {
  buildObservation,
  observeEnemySpawn,
} from "./observation.js";

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

function applyDispatch(team, action) {
  const scoutResult = applyScoutAction(team, action);
  return scoutResult !== null ? scoutResult : applyMatchAction(team, action);
}

// 保留拒绝原因计数供诊断；所有动作只有同一条执行链。
const PERMISSION_CHECKED_TYPES = new Set([
  AI_ACTION_TYPES.SET_ROUTE,
  AI_ACTION_TYPES.ROUTE_END,
  AI_ACTION_TYPES.SET_THROTTLE,
]);

export function createActionPort(match, seat) {
  const team = match.teamBySeat(seat);
  let observation = null;
  const permissionRejections = { count: 0, controlLocked: 0, firstTick: null };
  const port = {
    seat,
    // 校验用：观测先经 JSON 往返再交给决策，证明决策没有依赖实时对象引用或非纯数据值。
    strict: false,
    // 标准执行链拒绝、而旧路径会生效的动作计数，用于归因两种模式的行为差异。
    get permissionRejections() { return Object.freeze({ ...permissionRejections }); },

    invalidate() {
      observation = null;
    },

    // 自上次构建后没有外部刷新或动作提交时复用同一份观测。
    observe() {
      if (!observation) {
        const built = buildObservation(match, seat);
        observation = freezePlainData(port.strict ? pureData(built) : built);
      }
      return observation;
    },

    enemySpawn() {
      return freezePlainData(observeEnemySpawn(match, seat));
    },

    // 立即执行并返回是否被接受。被拒绝的动作也可能触发规则层的状态整理，因此一律让观测失效。
    submit(action) {
      const accepted = Boolean(applyDispatch(team, action));
      if (!accepted && PERMISSION_CHECKED_TYPES.has(action.type)) {
        const ship = team.ships[action.shipKey];
        permissionRejections.count += 1;
        if (ship?.alive && !ship.canControl()) permissionRejections.controlLocked += 1;
        permissionRejections.firstTick ??= match.tick;
      }
      observation = null;
      return accepted;
    },
  };
  return port;
}
