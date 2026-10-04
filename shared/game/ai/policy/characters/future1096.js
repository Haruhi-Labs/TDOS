import { predictCharacterSkillAim } from "../tactics/character-counterplay.js";

export default {
  id: "future1096",
  splitBias: (SU) => SU.future1096Bias,
  intelLeadBias: (D) => D.future1096Bias,
  detachedDefaultRole: "flank",
  flagship: {
    // 形态切换：未开形态时择机开启，A 形态偏防守，B 形态偏进攻。
    shouldCast(policy, { K, estimate, context }) {
      const form = policy.obs.self.future1096Form;
      const hull = policy.obs.self.hullRatio;
      const pressure = Number(context?.defensivePressure) || 0;
      const aggression = Number(context?.skillAggression) || 0;
      if (!form) {
        return Boolean(
          estimate.source !== "spawn"
          && (estimate.visible || estimate.age <= K.future1096OpenAge)
          && hull > K.future1096OpenHull
          && (aggression > K.future1096OpenAggression || context?.trackableIntel),
        );
      }
      if (form === "A") {
        return hull < K.future1096DefendHull || pressure > K.future1096DefendPressure || policy.mode === "recover";
      }
      return hull > K.future1096AttackHull && pressure < K.future1096AttackPressure && aggression > K.future1096AttackAggression;
    },
  },
  sub: {
    shouldCast(policy, { K, estimate, context, blockedByBarrier }) {
      if (blockedByBarrier) {
        return false;
      }
      return Boolean(
        estimate
        && estimate.source !== "spawn"
        && (estimate.visible || estimate.age <= K.future1096Age)
        && (((context?.skillAggression) || 0) > K.future1096Aggression || context?.emergencyCommit),
      );
    },
    // 光线蓄力期间方向已经锁定；按公开的航向和航速预判落点，
    // 避免高难度 AI 仍把固定射线瞄在移动目标的旧位置。
    target(policy, { T, estimate }) {
      if (!(estimate && estimate.source !== "spawn" && (estimate.visible || estimate.age <= 1.6))) {
        return null;
      }
      const aim = predictCharacterSkillAim(
        estimate,
        policy.params.features.skillAimLead ? T.future1096AimLead : 0,
        policy.obs.world.size,
        policy.safeRoutePadding(4),
      );
      return {
        targetX: aim?.x ?? estimate.x,
        targetY: aim?.y ?? estimate.y,
      };
    },
  },
};
