// 跨实体的数值、标识分配和纯辅助规则；不持有对局或实体引用。
import { CHARACTER_DEFS } from "../characters/catalog.js";
import { freezePlainData } from "../../data/plain-data.js";

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
export { FUTURE_1096_FORMS, FUTURE_1096_BASE_FORM } from "../characters/future1096/flagship-form.js";
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

export const TEAM_HUNT_COLORS = Object.freeze({
  A: "#8fe8ff",
  B: "#ff9eb8",
});

// 非 A/B 席位按 seatOrder 下标从该固定调色板派生展示色值，不从外部配置注入。
export const FLEET_PRESENTATION_PALETTE = freezePlainData([
  { color: TEAM_COLORS.A, projectileColor: TEAM_PROJECTILE_COLORS.A, huntColor: TEAM_HUNT_COLORS.A },
  { color: TEAM_COLORS.B, projectileColor: TEAM_PROJECTILE_COLORS.B, huntColor: TEAM_HUNT_COLORS.B },
  { color: "#7ce38b", projectileColor: "#b4f2bd", huntColor: "#9ef0a9" },
  { color: "#ffd166", projectileColor: "#ffe5a3", huntColor: "#ffdc85" },
  { color: "#c49bff", projectileColor: "#dec7ff", huntColor: "#d3b5ff" },
  { color: "#ff9f5a", projectileColor: "#ffc79c", huntColor: "#ffb57d" },
  { color: "#5ce1d6", projectileColor: "#9ef0e8", huntColor: "#82ebe1" },
  { color: "#f78fb3", projectileColor: "#fbc0d4", huntColor: "#faa7c4" },
]);

export const HARUHI_SUPPORT_ANNOUNCEMENT_KEYS = Object.freeze({
  alien: "找到了宇宙人！",
  time_traveler: "找到了未来人！",
  otherworlder: "找到了异世界人！",
  esper: "找到了超能力者！",
});

export function normalizeAiSeats(mode = "pvp", aiSeats, registeredSeats) {
  if (registeredSeats !== undefined) {
    if (!registeredSeats || typeof registeredSeats[Symbol.iterator] !== "function" || typeof registeredSeats === "string") {
      throw new TypeError("已注册席位集合必须是可迭代对象");
    }
    const orderedSeats = [];
    const registeredSet = new Set();
    for (const seat of registeredSeats) {
      if (typeof seat !== "string" || seat.length === 0) {
        throw new TypeError("已注册席位必须是非空字符串");
      }
      if (!registeredSet.has(seat)) {
        registeredSet.add(seat);
        orderedSeats.push(seat);
      }
    }

    if (aiSeats === undefined) {
      if (mode === "ai") {
        if (orderedSeats.length === 2 && orderedSeats[0] === "A" && orderedSeats[1] === "B") {
          return ["B"];
        }
        throw new Error("显式席位拓扑在 ai 模式下必须明确指定 aiSeats");
      }
      return [];
    }
    if (aiSeats === "all") {
      return [...orderedSeats];
    }
    if (aiSeats === null) {
      return [];
    }

    let candidates;
    if (Array.isArray(aiSeats)) {
      candidates = aiSeats;
    } else if (typeof aiSeats === "object") {
      candidates = [];
      for (const [seat, enabled] of Object.entries(aiSeats)) {
        if (!registeredSet.has(seat)) {
          throw new Error(`非法 AI 席位：${seat} 不在已注册席位集合中`);
        }
        if (Boolean(enabled)) {
          candidates.push(seat);
        }
      }
    } else {
      candidates = [aiSeats];
    }

    const result = [];
    const seen = new Set();
    for (const seat of candidates) {
      if (typeof seat !== "string" || !registeredSet.has(seat)) {
        throw new Error(`非法 AI 席位：${String(seat)} 不在已注册席位集合中`);
      }
      if (!seen.has(seat)) {
        seen.add(seat);
        result.push(seat);
      }
    }
    return result;
  }

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
