import { shouldTransformBunny } from "../tactics/bunny-stage.js";

export default {
  id: "bunny_haruhi",
  sub: {
    // 变身的资格校验与资源判断都在舞台战术里，不走通用的能量底线与净化暂缓。
    decideAlone: (ship, estimate, context) => shouldTransformBunny(ship, estimate, context),
  },
};
