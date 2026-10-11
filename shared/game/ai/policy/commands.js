// 把决策结果表达为动作并经端口提交；返回值是动作是否被接受。
// 每个算法显式声明事实和查询输入；执行算法按需重读动作后的事实。
import { aiActions } from "../actions.js";

export const commandsMethods = {
  // 以下方法把决策结果表达为动作并提交；返回值是动作是否被接受。
  writeSplit({ port: capPort }, level) {
    return capPort.submit(aiActions.split(level));
  },

  writeThrottle({ port: capPort }, shipKey, throttle) {
    return capPort.submit(aiActions.setThrottle({ shipKey, throttle }));
  },

  writeRoute({ port: capPort }, shipKey, endX, endY, throttle) {
    return capPort.submit(aiActions.setRoute({ shipKey, endX, endY, throttle }));
  },

  writeRouteEndpoint({ port: capPort }, shipKey, endX, endY) {
    return capPort.submit(aiActions.routeEnd({ shipKey, endX, endY }));
  },

  writeLaunchScout({ port: capPort }, zoneId, { fromShipKey, ...orders }) {
    return capPort.submit(aiActions.launchScout({ zoneId, shipKey: fromShipKey, ...orders }));
  },

  writeScoutMission({ port: capPort }, scoutId, orders) {
    return capPort.submit(aiActions.retaskScout({ scoutId, ...orders }));
  },

  writeFlagshipSkill({ port: capPort }) {
    return capPort.submit(aiActions.castFlagshipSkill());
  },

  writeSubSkill({ port: capPort }, shipKey, target = {}) {
    return capPort.submit(aiActions.castSubSkill({ shipKey, ...target }));
  },
};
