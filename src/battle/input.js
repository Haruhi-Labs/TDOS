// 共享战场命中检测:世界坐标 → 战区/航线把手/己方舰。纯函数,状态显式传入。
import { distance } from "../../shared/game-core.js";
import { ROUTE_HANDLE_RADIUS } from "./render.js";

export function zoneFromPoint(state, x, y) {
  const zones = state && state.zones ? state.zones : [];
  return zones.find((zone) => x >= zone.x && x < zone.x + zone.width && y >= zone.y && y < zone.y + zone.height) || null;
}

export function routeHandleAtPoint(route, x, y) {
  if (!route) {
    return null;
  }
  // 抓取半径明显大于绘制半径(11),让控制点/端点更好点中、减少"盲区"
  const grab = ROUTE_HANDLE_RADIUS + 15;
  if (distance(x, y, route.p1.x, route.p1.y) <= grab) {
    return "control";
  }
  if (distance(x, y, route.p2.x, route.p2.y) <= grab) {
    return "end";
  }
  return null;
}

// 点选己方可控舰:取命中范围内最近的一艘;移动端手指粗,命中垫大一倍
export function shipAtPoint(team, x, y, mobileMode = false) {
  if (!team || !team.ships) {
    return null;
  }
  let best = null;
  let bestDist = Infinity;
  const hitPadding = mobileMode ? 28 : 14;
  for (const ship of Object.values(team.ships)) {
    if (!ship || !ship.alive || !ship.canControl) {
      continue;
    }
    const d = distance(x, y, ship.x, ship.y);
    if (d <= ship.radius + hitPadding && d < bestDist) {
      best = ship;
      bestDist = d;
    }
  }
  return best;
}
