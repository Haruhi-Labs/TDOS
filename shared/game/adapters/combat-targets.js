// 敌对集合视图适配器：为按集合读取敌对目标的战斗系统提供冻结的只读敌对集合组合。
// 视图只暴露 getEntities / getAllShips / getVictoryShips，严禁冒充完整 Team 供依赖舰队身份的逻辑消费。

const FORBIDDEN_TEAM_FIELDS = new Set([
  "ships",
  "seat",
  "sideId",
  "match",
  "scouts",
  "wingmen",
  "extraShips",
  "effects",
  "cooldowns",
  "visibleEnemyIds",
  "loadout",
  "splitLevel",
  "autoScout",
  "beams",
  "color",
  "projectileColor",
  "huntColor",
  "name",
  "statMult",
  "aiFocusLowHp",
  "focusHpFrac",
  "damageFloorRatio",
  "energy",
  "visionWaveSkill",
  "future1096Form",
  "fleetEnergyForShip",
  "availableEnergyForShip",
  "spendEnergyForShip",
  "castFlagshipSkill",
  "castSubSkill",
  "areSkillsDisabled",
  "areScoutsDisabled",
  "getPlayerShips",
  "getVisionSources",
  "hasLivingShips",
  "hullRatio",
  "serialize",
  "computeVisibility",
  "stepCombat",
  "resolveChargedBeams",
]);

function collectFromEnemies(enemies, methodName) {
  if (enemies.length === 0) {
    return [];
  }
  // 单敌队等价：直接返回该敌队对应方法的结果，保持元素与顺序完全一致。
  if (enemies.length === 1) {
    return enemies[0][methodName]();
  }
  const combined = [];
  for (let i = 0; i < enemies.length; i += 1) {
    const items = enemies[i][methodName]();
    for (let j = 0; j < items.length; j += 1) {
      combined.push(items[j]);
    }
  }
  return combined;
}

export function createHostileView(registry, seat) {
  if (!registry || typeof registry.hasSeat !== "function" || typeof registry.enemyTeamsOf !== "function") {
    throw new TypeError("创建敌对集合视图需要有效的舰队注册表");
  }
  if (typeof seat !== "string" || !registry.hasSeat(seat)) {
    throw new Error(`未知席位 ${String(seat)}，无法创建敌对集合视图`);
  }

  // 敌对舰队列表来自冻结拓扑并已按 seatOrder 排序；每次调用方法即时读取当前成员与存活状态。
  const enemies = registry.enemyTeamsOf(seat);
  const target = Object.freeze({
    getEntities() {
      return collectFromEnemies(enemies, "getEntities");
    },
    getAllShips() {
      return collectFromEnemies(enemies, "getAllShips");
    },
    getVictoryShips() {
      return collectFromEnemies(enemies, "getVictoryShips");
    },
  });

  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === "string" && FORBIDDEN_TEAM_FIELDS.has(prop)) {
        throw new TypeError(`敌对集合视图不提供 Team 字段或能力：${prop}`);
      }
      return Reflect.get(obj, prop, receiver);
    },
  });
}
