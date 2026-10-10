// 跨实体的数值、标识分配和纯辅助规则；不持有对局或实体引用。
import { CHARACTER_DEFS } from "../characters.js";

export const TAU = Math.PI * 2;
export const BEAM_CHARGE_DURATION = 1.05;
export const BEAM_VISUAL_DURATION = 0.26;
export const BEAM_BASE_RANGE = 1460;
export const BEAM_HIT_RADIUS = 11;
export const BEAM_DAMAGE_RATIOS = Object.freeze({
  single: 0.28,
  double: 0.21,
  triple: 0.18,
});
// 护盾逐颗结算剩余次数，但受击动画无需跟着炮弹数量无限增长。
// 15 次/秒已经能连续表现密集火力，同时把单人绘制和多人状态同步控制在稳定上限。
export const KOIZUMI_BARRIER_PROJECTILE_IMPACT_INTERVAL = 1 / 15;
export const FUTURE_1096_FORMS = Object.freeze({
  A: Object.freeze({ damageTaken: 2, speed: 1.5, fireRate: 2 }),
  B: Object.freeze({ damageTaken: 0.5, speed: 0.5, fireRate: 0.5 }),
});
export const FUTURE_1096_BASE_FORM = Object.freeze({ damageTaken: 1, speed: 1, fireRate: 1 });
export const DEG_TO_RAD = Math.PI / 180;

export function beamDamageRatioForHitCount(hitCount) {
  if (hitCount >= 3) return BEAM_DAMAGE_RATIOS.triple;
  if (hitCount === 2) return BEAM_DAMAGE_RATIOS.double;
  return BEAM_DAMAGE_RATIOS.single;
}

export const FLAGSHIP_TURN_PENALTIES = {
  1: 1.14,
  2: 0.88,
  3: 0.68,
  4: 0.62,
};


// 尾击:炮弹从目标「尾部射界」方向命中时伤害放大。判定范围与尾部射界(0x 火力带)完全一致——
// 即来袭方向相对目标朝向的夹角 |θ| > 150°(正后 60° 锥)。
export const REAR_STRIKE_MIN_DEG = 150;
export const REAR_STRIKE_MULT = 1.2;
// 小目标闪避:对体型小于参考半径的目标(侦察机/僚机等)炮弹有概率打空——半径越小概率越高,
// 上限温和,避免过度压制(主舰等正常体型半径≥参考值,完全不受影响)。
export const SMALL_TARGET_REF_RADIUS = 8;
export const SMALL_TARGET_MAX_MISS = 0.3;
// 编队取舍:不分离(同队 ≥2 艘)时,受到的伤害有该比例改由同队其它船平摊(集体抗压);
// 分离/单飞(同队仅 1 艘)时开火频率 ×该倍率(火力更猛)。二者由「同队成员数」互斥切换。
export const FORMATION_DAMAGE_SHARE = 0.3;
export const SOLO_FIRE_RATE_BONUS = 1.2;
// 长门旗舰将本队释放的侦察机改造为战斗僚机。视野引用长门舰船基础值，
// 攻击射程与这份视野保持一致；射速引用长门舰炮基础值，伤害集中定义在这里。
export const YUKI_COMBAT_SCOUT_STATS = Object.freeze({
  vision: CHARACTER_DEFS.yuki.stats.vision,
  damage: 16,
  fireRate: CHARACTER_DEFS.yuki.stats.fireRate,
});
export const YUKI_COMBAT_SCOUT_LAUNCH_COUNT = 1;

export const TEAM_COLORS = {
  A: "#65d9ff",
  B: "#ff8692",
};

export const TEAM_PROJECTILE_COLORS = {
  A: "#9be8ff",
  B: "#ffc0bd",
};

export const HARUHI_SUPPORT_ANNOUNCEMENT_KEYS = Object.freeze({
  alien: "找到了宇宙人！",
  time_traveler: "找到了未来人！",
  otherworlder: "找到了异世界人！",
  esper: "找到了超能力者！",
});

export function normalizeAiSeats(mode = "pvp", aiSeats) {
  let source = aiSeats;
  if (source === undefined) {
    source = mode === "ai" ? ["B"] : [];
  }

  if (source === "all") {
    source = ["A", "B"];
  } else if (!Array.isArray(source)) {
    if (source && typeof source === "object") {
      source = Object.entries(source)
        .filter(([, enabled]) => Boolean(enabled))
        .map(([seat]) => seat);
    } else if (source == null) {
      source = [];
    } else {
      source = [source];
    }
  }

  return Array.from(
    new Set(
      source
        .map((seat) => String(seat || "").trim().toUpperCase())
        .filter((seat) => seat === "A" || seat === "B"),
    ),
  );
}

let globalEntityId = 1;
// 带种子的对局使用自己的计数器，初值与递增方式和全局计数器相同；其余对局沿用全局计数器。
export function nextEntityId(match) {
  const local = match?.entityIds;
  if (local) {
    local.value += 1;
    return local.value;
  }
  globalEntityId += 1;
  return globalEntityId;
}

export function __resetEntityIds(state = 1) {
  globalEntityId = state;
}
