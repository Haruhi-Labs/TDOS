// 把决策结果表达为动作并经端口提交；返回值是动作是否被接受。
// this 仅为冻结的读取/操作能力上下文；阶段结果返回给状态所有者消费。
import { aiActions } from "../actions.js";

export const commandsMethods = {
  // 以下方法把决策结果表达为动作并提交；返回值是动作是否被接受。
  writeSplit(level) {
    return this.port.submit(aiActions.split(level));
  },

  writeThrottle(shipKey, throttle) {
    return this.port.submit(aiActions.setThrottle({ shipKey, throttle }));
  },

  writeRoute(shipKey, endX, endY, throttle) {
    return this.port.submit(aiActions.setRoute({ shipKey, endX, endY, throttle }));
  },

  writeRouteEndpoint(shipKey, endX, endY) {
    return this.port.submit(aiActions.routeEnd({ shipKey, endX, endY }));
  },

  writeLaunchScout(zoneId, { fromShipKey, ...orders }) {
    return this.port.submit(aiActions.launchScout({ zoneId, shipKey: fromShipKey, ...orders }));
  },

  writeScoutMission(scoutId, orders) {
    return this.port.submit(aiActions.retaskScout({ scoutId, ...orders }));
  },

  writeFlagshipSkill() {
    return this.port.submit(aiActions.castFlagshipSkill());
  },

  writeSubSkill(shipKey, target = {}) {
    return this.port.submit(aiActions.castSubSkill({ shipKey, ...target }));
  },
};
