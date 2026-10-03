import { BUNNY_HARUHI_CONFIG as BUNNY } from "./bunny-haruhi-config.js";

const SHIP_HULL_SIZE_SCALE = 1.28;

export const CHARACTER_ORDER = [
  "haruhi",
  "koizumi",
  "yuki",
  "future1096",
  "kyon",
  "tsuruya",
  "asakura",
  "shamisen",
  "bunny_haruhi",
];

export const CHARACTER_DEFS = {
  bunny_haruhi: {
    id: BUNNY.characterId, name: "兔女郎春日", shortName: "兔女郎春日",
    title: "舞台与变身支援舰", flavor: "让整个战场听见这首歌", stats: BUNNY.baseStats,
    flagshipSkill: {
      id: BUNNY.flagshipSkillId, name: "Lost my music", type: "passive", cost: 0,
      description: "以视野为舞台，入场敌舰先受压制，久留后获得强化。",
    },
    subSkill: {
      id: BUNNY.subSkillId, name: "God knows…", type: "active",
      cost: BUNNY.form.energyCost, cooldown: BUNNY.form.cooldownSeconds, target: BUNNY.form.target,
      description: "按固定次序变身并解锁支援，激奏首次召唤阿虚。",
    },
  },
  haruhi: {
    id: "haruhi",
    name: "凉宫春日",
    shortName: "春日",
    title: "团长型火力旗舰",
    flavor: "可靠的领导者与突击手",
    stats: {
      hp: 880, energy: 130, speed: 33, turnRate: 0.36, accel: 1.02,
      energyRegen: 12.5, moveDrain: 8.2, vision: 172, range: 520,
      damage: 29, fireRate: 0.47, radius: 10 * SHIP_HULL_SIZE_SCALE,
    },
    flagshipSkill: {
      id: "im_here", name: "我在这里！", type: "active", cooldown: 22, cost: 68,
      duration: 16, target: "none",
      description: "广播己方位置，16秒内使敌方获得全舰队的真实视野，期间全舰队获得属性增强。每次使用可随机发现一位宇宙人、未来人、异世界人、超能力者，提供常驻支援。",
    },
    subSkill: {
      id: "hero_power", name: "勇者之力", type: "active", cooldown: 10, cost: 60,
      chargeDuration: 0.8, radiusZoneRatio: 0.5, lockDuration: 2, recoveryDuration: 3,
      target: "none",
      description: "短暂蓄力后冲击附近区域，对敌舰造成2秒眩晕与3秒减速，期间伤害加深20%，并不分敌我地击毁技能范围内所有侦察机和僚机。",
    },
  },
  koizumi: {
    id: "koizumi",
    name: "古泉一树",
    shortName: "古泉",
    title: "均衡型机动指挥舰",
    flavor: "能够出现在他应该出现的任何地方",
    stats: {
      hp: 760, energy: 120, speed: 35, turnRate: 0.43, accel: 1.18,
      energyRegen: 12, moveDrain: 7.7, vision: 160, range: 500,
      damage: 23, fireRate: 0.5, radius: 9 * SHIP_HULL_SIZE_SCALE,
    },
    flagshipSkill: {
      id: "closed_space_barrier", name: "超能力屏障", type: "passive",
      description: "在视野边界制造一圈护盾，吸收子弹、光线的攻击。护盾受到15次攻击后被击破，5秒内没有敌方攻击穿过护盾边界才会恢复。冲撞类技能可以直接击破护盾。",
    },
    subSkill: {
      id: "esper", name: "超能力粒子", type: "active", cooldown: 15, cost: 50,
      duration: 8, silenceDuration: 5, stunDuration: 1, target: "none",
      description: "化身在战场中高速游曳的红色粒子，无法攻击、免疫伤害和控制，冲撞敌人时造成击退和沉默，并在冲撞时发出覆盖战场的能量波，接触到能量波的敌人眩晕1秒。技能结束后自动回到战场中央。",
    },
  },
  yuki: {
    id: "yuki",
    name: "长门有希",
    shortName: "有希",
    title: "高感知统合支援舰",
    flavor: "资讯统合思念体级别的情报能力",
    stats: {
      hp: 720, energy: 170, speed: 31, turnRate: 0.48, accel: 0.94,
      energyRegen: 14.8, moveDrain: 7.2, vision: 205, range: 540,
      damage: 24, fireRate: 0.44, radius: 9 * SHIP_HULL_SIZE_SCALE,
    },
    flagshipSkill: {
      id: "data_overmind_radar", name: "资讯统合雷达", type: "passive",
      description: "被动以雷达扫描全图，可识别敌人动向，距离越近识别越清晰，在较近的距离内可以辨识敌方角色。每次释放侦察机时，改为释放一架战斗僚机，拥有较大视野和射击能力。",
    },
    subSkill: {
      id: "apm_overdrive", name: "apm上万", type: "active", cooldown: 24,
      cost: 60, target: "none",
      description: "向8个方向各射出一对高速侦察机。",
    },
  },
  future1096: {
    id: "future1096",
    name: "朝比奈1096",
    shortName: "1096",
    title: "高速光束突击舰",
    flavor: "mikuru bea----m!!!",
    stats: {
      hp: 640, energy: 125, speed: 37, turnRate: 0.5, accel: 1.15,
      energyRegen: 11.4, moveDrain: 7.9, vision: 165, range: 550,
      damage: 20, fireRate: 0.54, radius: 8 * SHIP_HULL_SIZE_SCALE,
    },
    flagshipSkill: {
      id: "past_future_me", name: "过去与未来的我", type: "active", cooldown: 10,
      target: "none",
      description: "初始无形态，使用时在A、B形态之间切换。A形态舰队射速提升、受到伤害增加、速度提升；B形态舰队射速降低、受到伤害减少、速度降低。",
    },
    subSkill: {
      id: "beam_1096", name: "1096光线", type: "active", cooldown: 12,
      cost: 74, target: "point",
      description: "蓄力后向指定方向发射光线，命中时造成和最大生命值有关的伤害。总伤随着击中数量增加，但对单舰船的伤害随着击中数量递减。",
    },
  },
  kyon: {
    id: "kyon",
    name: "阿虚",
    shortName: "阿虚",
    title: "稳定型近战指挥舰",
    flavor: "普普通通的普通人",
    stats: {
      hp: 900, energy: 115, speed: 34, turnRate: 0.45, accel: 1.1,
      energyRegen: 11, moveDrain: 8.1, vision: 158, range: 490,
      damage: 24, fireRate: 0.52, radius: 10 * SHIP_HULL_SIZE_SCALE,
    },
    flagshipSkill: {
      id: "reality_seeker", name: "在虚构世界里寻求现实感的人才有问题", type: "passive",
      description: "被动提升全舰队转向、加速、机动能力，且各方向火力密度一致，均为1.5倍，不受射界影响。",
    },
    subSkill: {
      id: "reliable_normal", name: "靠谱的普通人", type: "active", cooldown: 18,
      cost: 42, duration: 14, target: "none",
      description: "14秒内小幅提升机动、速度、伤害、加速能力，并立刻恢复18%最大生命值。",
    },
  },
  tsuruya: {
    id: "tsuruya",
    name: "鹤屋学姐",
    shortName: "鹤屋",
    title: "高周转支援舰",
    flavor: "拥有钞能力的独特战局干扰者",
    stats: {
      hp: 700, energy: 145, speed: 36, turnRate: 0.47, accel: 1.22,
      energyRegen: 12.8, moveDrain: 7.5, vision: 166, range: 480,
      damage: 22, fireRate: 0.56, radius: 9 * SHIP_HULL_SIZE_SCALE,
    },
    flagshipSkill: {
      id: "secret_sponsor", name: "神秘赞助人", type: "active", cooldown: 20,
      cost: 60, duration: 8, target: "none",
      description: "8秒内全队技能冷却速度变为两倍，并每秒回复全队1%最大生命值。",
    },
    subSkill: {
      id: "money_power", name: "钞能力", type: "active", cooldown: 24,
      cost: 66, target: "zone",
      description: "令一个战区内的敌方僚机和侦察机叛变。",
    },
  },
  asakura: {
    id: "asakura",
    name: "朝仓凉子",
    shortName: "朝仓",
    title: "高速猎杀渗透舰",
    flavor: "情报与突进,一往无前的刀锋女王",
    stats: {
      hp: 760, energy: 132, speed: 38, turnRate: 0.52, accel: 1.24,
      energyRegen: 12.2, moveDrain: 8, vision: 168, range: 505,
      damage: 25, fireRate: 0.58, radius: 8 * SHIP_HULL_SIZE_SCALE,
    },
    flagshipSkill: {
      id: "no_escape", name: "资讯压制", type: "active", cooldown: 24,
      cost: 64, duration: 6, pulseInterval: 1, target: "none",
      description: "6秒内持续发射覆盖整个战场的视野波，获得被波及处的真实视野，对接触到视野波的舰船施加驱散效果，清除敌方正面buff和己方负面buff。",
    },
    subSkill: {
      id: "blade_queen", name: "刀锋女王", type: "active", cooldown: 20,
      cost: 52, duration: 10, target: "none",
      speedMultiplier: 1.45, accelerationMultiplier: 1.26, turnMultiplier: 1.12,
      minimumGear: 3, damageRatio: 0.15, hitInterval: 1, rangeMultiplier: 1.25,
      description: "10秒内航速大幅提升，无视碰撞体积，并围绕舰船产生刀锋，对接触到的敌人造成每秒15%最大生命值伤害。",
    },
  },
  shamisen: {
    id: "shamisen",
    name: "三味线",
    shortName: "三味线",
    title: "连击型灵巧舰",
    flavor: "会说话的三花猫，悄无声息地留下抓痕",
    stats: {
      hp: 720, energy: 150, speed: 39, turnRate: 0.55, accel: 1.28,
      energyRegen: 13.6, moveDrain: 7.4, vision: 174, range: 500,
      damage: 18, fireRate: 0.7, radius: 7 * SHIP_HULL_SIZE_SCALE,
    },
    flagshipSkill: {
      id: "hunt_decree", name: "猫爪印记", type: "passive",
      damageMultiplier: 1.5,
      description: "开局时随机标记一名猎杀目标，追踪其位置但不会获得真实视野，己方对其造成的攻击类伤害变为1.5倍，击杀后自动标记下一名敌人。双方均能看到标记的存在。",
    },
    subSkill: {
      id: "cat_paw_barrage", name: "猫爪乱舞", type: "active", cooldown: 22,
      cost: 52, duration: 12, target: "none", fireRateMultiplier: 1.15, triggerHits: 4,
      burstDamage: 80, markDuration: 8,
      description: "12秒内射速提升，自身子弹变为猫爪，命中同一敌舰4次时引爆抓痕，造成额外80点伤害。",
    },
  },
};

export const DEFAULT_TEAM_LOADOUT = Object.freeze({
  main: "haruhi",
  sub1: "koizumi",
  sub2: "future1096",
});

export const DEFAULT_AI_LOADOUT = Object.freeze({
  main: "kyon",
  sub1: "tsuruya",
  sub2: "yuki",
});

// 鹤屋旗舰偏纯支援，仍不进入随机 AI 主舰池；其余被动旗舰均有完整 AI 情报适配。
const AI_MAIN_EXCLUDE = new Set(["tsuruya"]);

export function randomAiLoadout() {
  // 首版只开放显式阵容；主、副舰共用旧池，顺序及随机数消费与旧版一致。
  const pool = CHARACTER_ORDER.filter((id) => id !== "bunny_haruhi");
  const mainPool = pool.filter((id) => !AI_MAIN_EXCLUDE.has(id));
  const main = mainPool[Math.floor(Math.random() * mainPool.length)];
  const rest = pool.filter((id) => id !== main);
  for (let index = rest.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [rest[index], rest[other]] = [rest[other], rest[index]];
  }
  return { main, sub1: rest[0], sub2: rest[1] };
}

export function characterDefinition(characterId) {
  return CHARACTER_DEFS[characterId] || CHARACTER_DEFS[DEFAULT_TEAM_LOADOUT.main];
}

export function slotLabel(slotKey) {
  if (slotKey === "main") return "主舰";
  if (slotKey === "sub1") return "副舰一";
  if (slotKey === "sub2") return "副舰二";
  return "舰船";
}

export function normalizeLoadout(loadout = {}, fallback = DEFAULT_TEAM_LOADOUT) {
  const used = new Set();
  const fallbackList = [fallback.main, fallback.sub1, fallback.sub2, ...CHARACTER_ORDER];

  function pick(candidate) {
    if (candidate && CHARACTER_DEFS[candidate] && !used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    const next = fallbackList.find((id) => CHARACTER_DEFS[id] && !used.has(id));
    used.add(next);
    return next;
  }

  return {
    main: pick(loadout.main),
    sub1: pick(loadout.sub1),
    sub2: pick(loadout.sub2),
  };
}

export function cloneLoadout(loadout = DEFAULT_TEAM_LOADOUT) {
  const safe = normalizeLoadout(loadout, DEFAULT_TEAM_LOADOUT);
  return { main: safe.main, sub1: safe.sub1, sub2: safe.sub2 };
}

export function skillMetaForCharacter(characterId, mode = "flagship") {
  const character = characterDefinition(characterId);
  return mode === "sub" ? character.subSkill : character.flagshipSkill;
}
