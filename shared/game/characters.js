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
];

export const CHARACTER_DEFS = {
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
      description: "广播己方位置，16秒内令敌方持续获得对全舰队的真实视野，同时全舰队航速、机动、射程、视野、伤害与射速提升15%，并减免15%伤害。每次使用随机解锁一种常驻支援。",
    },
    subSkill: {
      id: "god_says_win", name: "神说会赢的", type: "active", cooldown: 20, cost: 60,
      duration: 8, target: "none",
      description: "8秒内自身攻击50%概率暴击，造成3倍伤害，并可盲射射界与射程内最近敌人。",
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
      id: "agency_power", name: "机关的力量", type: "active", cooldown: 18, cost: 58,
      duration: 12, target: "none", invulnerableDuration: 6,
      description: "全舰队加速度×1.75，持续12秒；前6秒全队无敌。",
    },
    subSkill: {
      id: "esper", name: "超能力", type: "active", cooldown: 22, cost: 50,
      blinkRange: 240, target: "optional_point",
      description: "闪现到240范围内的目标位置，并使下一次攻击伤害×4。",
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
      description: "被动持续以雷达扫描全图，可识别敌人动向，距离越近误差越小。在较近的距离内，可以辨识敌方角色。不会获得真实视野。己方每次释放两架战斗僚机，获得舰船级视野，并以常规舰炮射速发射16伤害的子弹。",
    },
    subSkill: {
      id: "apm_overdrive", name: "apm上万", type: "active", cooldown: 24,
      cost: 60, target: "none",
      description: "向8个方向各射出一对（共16架）高速侦察机。",
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
      description: "初始无形态。首次使用进入A形态：全队射速×2、受到伤害×2（易伤）、航速×1.5；再次使用进入B形态：全队射速×0.5、受到伤害×0.5（减伤50%）、航速×0.5。此后每次使用交替切换，冷却10秒。",
    },
    subSkill: {
      id: "beam_1096", name: "1096光线", type: "active", cooldown: 12,
      cost: 74, target: "point",
      description: "蓄力1.05秒后向指定方向发射光线，对命中的每个敌舰造成其最大生命值28%的伤害。",
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
      description: "全舰队转向×1.28、加速×1.16、最小转弯半径×0.62，且各朝向火力密度趋于一致（削弱侧舷强·船尾弱的差异）。各方向射速均×1.5。",
    },
    subSkill: {
      id: "reliable_normal", name: "靠谱的普通人", type: "active", cooldown: 18,
      cost: 42, duration: 14, target: "none",
      description: "14秒内转向×1.28、航速×1.08、伤害×1.08、加速×1.12，并立即回复18%最大生命。",
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
      description: "8秒内全队技能冷却流逝速度×2，并每秒回复全队1%最大生命。",
    },
    subSkill: {
      id: "money_power", name: "钞能力", type: "active", cooldown: 24,
      cost: 66, target: "zone",
      description: "令一个战区内的敌军僚机与侦察机叛变。",
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
      description: "6秒内每秒以自身为中心发射一圈视野波，获得波带覆盖区域的真实视野；敌舰被扫到时涤除其主动技能增益。敌方也能看见视野波。",
    },
    subSkill: {
      id: "blade_queen", name: "刀锋女王", type: "active", cooldown: 20,
      cost: 52, duration: 10, target: "none",
      description: "10秒内航速×1.45（加速×1.26、转向×1.12）并无视碰撞体积（可径直穿过敌舰）；接触敌舰瞬间造成其最大生命值15%的伤害，此后每持续重叠1秒再造成一次。",
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
      id: "shamisen_flagship_pending", name: "主舰能力待定", type: "passive",
      description: "主舰能力仍在设计中，当前不会产生额外效果。",
    },
    subSkill: {
      id: "cat_paw_barrage", name: "猫爪乱舞", type: "active", cooldown: 22,
      cost: 52, duration: 12, target: "none", triggerHits: 5,
      burstDamage: 80, markDuration: 8,
      description: "12秒内自身子弹变为猫爪。命中同一敌舰5次时引爆抓痕，额外造成80伤害；抓痕连续8秒未被刷新会消退。",
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

// 鹤屋旗舰偏纯支援，仍不进入随机 AI 主舰池；三味线主舰能力尚未设计，也暂不进入。
// 长门的新雷达被动已经有专门的误差情报适配，可以正常作为 AI 主舰参与标准对战。
const AI_MAIN_EXCLUDE = new Set(["tsuruya", "shamisen"]);

export function randomAiLoadout() {
  const pool = [...CHARACTER_ORDER];
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
